/**
 * Call Store - Manages softphone state
 * Zustand store for call management
 * 
 * Supports two modes:
 * 1. WebRTC (SIP.js) - Full in-browser softphone
 * 2. AMI Click-to-Call - Uses existing softphone, AMI originates call
 */

import { create } from 'zustand';
import { sipService, CallInfo, SipConfig } from '@services/sip';
import { api, isElectron } from '@services/api';
import { useVehicleStore } from '@store/vehicleStore';
import type { Vehicle } from '@apptypes/vehicle';

interface CallHistoryEntry {
  id: string;
  direction: 'inbound' | 'outbound';
  remoteNumber: string;
  remoteName?: string;
  customerName?: string;
  vehiclePlate?: string;
  timestamp: number;
  duration?: number;
  answered: boolean;
}

export interface ConferenceParticipant {
  memberId: string;
  channel: string;
  uuid: string;
  callerIdNum: string;
  callerIdName: string;
  admin: boolean;
  muted: boolean;
}

interface CallState {
  // Extension settings
  extension: string | null;
  password: string | null;
  displayName: string | null;
  pbxHost: string | null;
  
  // Call mode: 'webrtc' for in-browser, 'ami' for click-to-call via existing softphone
  callMode: 'webrtc' | 'ami';
  
  // Registration state
  registrationState: 'unregistered' | 'registering' | 'registered' | 'error';
  registrationError: string | null;
  
  // AMI status
  amiConnected: boolean;
  
  // Current call
  currentCall: CallInfo | null;
  callDuration: number;

  // Attended transfer state
  consultCall: CallInfo | null;
  transferPhase: 'idle' | 'dialing' | 'consulting' | 'failed';
  consultFailure: { reason: 'unavailable' | 'busy' | 'no-answer' | 'generic'; destination: string; message: string } | null;

  // Conference state
  isConference: boolean;
  conferenceRoom: string | null;
  holdRoom: string | null;
  conferenceParticipants: ConferenceParticipant[];
  heldChannelUuid: string | null;
  
  // Call history
  callHistory: CallHistoryEntry[];
  
  // Screen pop CRM data (set when screenPop WS event arrives)
  screenPopData: {
    customer?: { id: number; name: string; address?: string; phone1?: string; phone2?: string };
    vehicles?: { vehicleId: number; plateNumber: string; make?: string; model?: string }[];
  } | null;

  // UI state
  showDialpad: boolean;
  showCallHistory: boolean;
  incomingCallPopup: boolean;
  softphoneMinimized: boolean;
  softphoneVisible: boolean;
  
  // Audio devices
  selectedAudioInput: string | null;
  selectedAudioOutput: string | null;
  audioDevices: MediaDeviceInfo[];
  
  // Actions
  setExtension: (extension: string, password: string, displayName?: string) => void;
  setPbxHost: (host: string) => void;
  setCallMode: (mode: 'webrtc' | 'ami') => void;
  register: () => Promise<boolean>;
  unregister: () => Promise<void>;
  checkAmiStatus: () => Promise<void>;
  initializeDefaults: () => Promise<void>;
  makeCall: (destination: string, customerName?: string, vehiclePlate?: string) => Promise<boolean>;
  answerCall: () => Promise<boolean>;
  rejectCall: () => void;
  hangupCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  // Attended transfer actions
  startConsultCall: (destination: string) => Promise<boolean>;
  completeTransfer: () => Promise<boolean>;
  cancelConsult: () => Promise<void>;
  clearConsultFailure: () => void;
  resumeFromHold: () => Promise<void>;
  sendDtmf: (tone: string) => void;

  // Conference actions
  startConference: (destination: string) => Promise<boolean>;
  mergeConference: () => Promise<boolean>;
  addConferenceParticipant: (destination: string) => Promise<boolean>;
  kickConferenceParticipant: (memberId: string) => Promise<boolean>;
  muteConferenceParticipant: (memberId: string) => Promise<boolean>;
  endConference: () => Promise<void>;
  pollConferenceParticipants: () => Promise<void>;
  
  // UI actions
  toggleDialpad: () => void;
  toggleCallHistory: () => void;
  toggleSoftphone: () => void;
  minimizeSoftphone: () => void;
  dismissIncomingPopup: () => void;
  setScreenPopData: (data: CallState['screenPopData']) => void;
  
  // Audio device actions
  loadAudioDevices: () => Promise<void>;
  setAudioInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
  
  // Internal
  _updateCallDuration: () => void;
}

// Load saved settings from localStorage
const loadSavedSettings = () => {
  if (typeof window === 'undefined') return { extension: null, password: null, displayName: null, pbxHost: null };
  try {
    const saved = localStorage.getItem('tavl_softphone_settings');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {}
  return { extension: null, password: null, displayName: null, pbxHost: null };
};

// Load PBX host from server config (used as fallback when user hasn't configured one)
const loadServerPbxHost = async (): Promise<string | null> => {
  try {
    const response = await fetch('/api/calls/config');
    const data = await response.json();
    if (data.success && data.config) {
      return data.config.host || null;
    }
  } catch (e) {
    console.warn('Could not load PBX host from server:', e);
  }
  return null;
};

// Save settings to localStorage
const saveSettings = (extension: string, password: string, displayName?: string, pbxHost?: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('tavl_softphone_settings', JSON.stringify({
      extension,
      password,
      displayName,
      pbxHost,
    }));
  } catch {}
};

// Load call history from localStorage
const loadCallHistory = (): CallHistoryEntry[] => {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem('tavl_call_history');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {}
  return [];
};

// Save call history
const saveCallHistory = (history: CallHistoryEntry[]) => {
  if (typeof window === 'undefined') return;
  try {
    // Keep last 50 calls
    const trimmed = history.slice(0, 50);
    localStorage.setItem('tavl_call_history', JSON.stringify(trimmed));
  } catch {}
};

// Screen pop: search vehicle by caller's phone number, fetch full details, and open panel
let _lastScreenPopPhone = '';
let _lastScreenPopTime = 0;

async function screenPopByPhone(rawPhone: string) {
  if (!rawPhone || rawPhone === 'Unknown') return;

  // Normalize: strip non-digits, remove country code +92/92, add leading 0
  let digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length > 10) digits = digits.substring(2);
  if (!digits.startsWith('0') && digits.length >= 7) digits = '0' + digits;

  if (digits.length < 7) return;

  const now = Date.now();
  if (_lastScreenPopPhone === digits && now - _lastScreenPopTime < 30_000) return;
  _lastScreenPopPhone = digits;
  _lastScreenPopTime = now;

  console.log(`📞 Screen Pop (SIP): Looking up vehicle for "${digits}" (raw: "${rawPhone}")`);

  try {
    // Step 1: Search by phone number
    const searchResp = await fetch(`/api/vehicles/search?term=${encodeURIComponent(digits)}`);
    const searchResult = await searchResp.json();
    const matches = searchResult.data || searchResult.vehicles;

    if (!searchResult.success || !matches?.length) {
      console.warn(`📞 Screen Pop (SIP): No vehicle found for "${digits}"`);
      return;
    }

    const objectId = parseInt(matches[0].ObjectId);
    const plateNumber = matches[0].PlateNumber || 'Unknown';
    console.log(`📞 Screen Pop (SIP): Found vehicle ${plateNumber} (ObjectId: ${objectId}), fetching details...`);

    // Step 2: Get full vehicle details (same as when user clicks a search result)
    const detailResp = await fetch(`/api/vehicles/${objectId}`);
    const detailResult = await detailResp.json();

    if (!detailResult.success || !detailResult.data) {
      console.warn(`📞 Screen Pop (SIP): Could not load details for ObjectId ${objectId}`);
      return;
    }

    const d = detailResult.data;

    // Step 3: Transform into Vehicle interface (same logic as useVehicleSearch)
    const parseLocalDateTime = (raw?: any): Date | null => {
      if (!raw) return null;
      if (raw instanceof Date) {
        if (isNaN(raw.getTime())) return null;
        return new Date(
          raw.getUTCFullYear(),
          raw.getUTCMonth(),
          raw.getUTCDate(),
          raw.getUTCHours(),
          raw.getUTCMinutes(),
          raw.getUTCSeconds(),
          raw.getUTCMilliseconds()
        );
      }
      if (typeof raw === 'string') {
        const s = raw.trim();
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          const [_, yy, mo, dd, hh, mm2, ss] = m;
          return new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm2), Number(ss));
        }
        if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            return new Date(
              d.getUTCFullYear(),
              d.getUTCMonth(),
              d.getUTCDate(),
              d.getUTCHours(),
              d.getUTCMinutes(),
              d.getUTCSeconds(),
              d.getUTCMilliseconds()
            );
          }
        }
      }
      const dt = new Date(raw);
      return isNaN(dt.getTime()) ? null : dt;
    };

    const vehicle: Vehicle = {
      objectId: String(d.objectId ?? objectId),
      vehicleId: d.id || String(objectId),
      name: d.plateNumber || plateNumber,
      registrationNumber: d.plateNumber || plateNumber,
      companyId: '0',
      companyName: d.description || matches[0].Description || 'Unknown',
      deviceId: d.imei || '',
      status: d.status || 'unknown',
      gpsData: {
        latitude: d.latitude,
        longitude: d.longitude,
        speed: d.speed,
        angle: d.angle,
        altitude: d.altitude,
        satellites: d.satellites,
        gpsTimeRaw: d.gpsTime ? String(d.gpsTime) : undefined,
        serverTimeRaw: d.serverTime ? String(d.serverTime) : undefined,
        gpsTime: parseLocalDateTime(d.gpsTime) || new Date(),
        serverTime: parseLocalDateTime(d.serverTime) || new Date(),
        valid: d.gpsValid,
        Ignition: d.ignition ?? d.Ignition,
        EngineCut: d.engineCut ?? d.EngineCut,
        Battery: d.battery ?? d.Battery,
        BackupBattery: d.backupBattery ?? d.BackupBattery,
        PowerVolt: d.powerVolt ?? d.PowerVolt,
        GsmSignal: d.gsmSignal ?? d.GsmSignal,
        HarshBrake: d.harshBrake ?? d.HarshBrake,
        HarshAccel: d.harshAccel ?? d.HarshAccel,
        HarshCorner: d.harshCorner ?? d.HarshCorner,
        Seatbelt: d.seatbelt ?? d.Seatbelt,
        FuelLevel: d.fuelLevel ?? d.FuelLevel,
      },
      meta: { source: 'screen_pop' },
    };

    // Step 4: Add to store, select, and focus map
    const store = useVehicleStore.getState();
    store.setVehicles([vehicle]);
    store.selectVehicle(vehicle);
    store.focusOnVehicle(vehicle);
    console.log(`📞 Screen Pop (SIP): Opened vehicle ${vehicle.name} for caller ${rawPhone}`);

  } catch (e) {
    console.warn('📞 Screen Pop (SIP): Failed:', e);
  }
}

export const useCallStore = create<CallState>((set, get) => {
  let durationTimer: NodeJS.Timeout | null = null;

  if (typeof window !== 'undefined') {
    sipService.subscribe((event, data) => {
      switch (event) {
        case 'registrationStateChanged':
          set({ registrationState: data });
          break;
        case 'callStateChanged':
          set({ currentCall: data });
          if (data?.state === 'answered' && !durationTimer) {
            durationTimer = setInterval(() => get()._updateCallDuration(), 1000);
          }
          if (!data || data.state === 'ended') {
            if (durationTimer) {
              clearInterval(durationTimer);
              durationTimer = null;
            }
            set({ callDuration: 0 });
          }
          break;
        case 'incomingCall':
          set({ incomingCallPopup: true, softphoneVisible: true, softphoneMinimized: false });
          // Trigger screen pop — look up vehicle by caller's phone number
          if (data?.remoteNumber) {
            screenPopByPhone(data.remoteNumber);
          }
          break;
        case 'callEnded':
          if (data) {
            const entry: CallHistoryEntry = {
              id: data.id,
              direction: data.direction,
              remoteNumber: data.remoteNumber,
              remoteName: data.remoteName,
              timestamp: data.startTime || Date.now(),
              duration: data.duration,
              answered: !!data.answerTime,
            };
            const history = [entry, ...get().callHistory];
            set({ callHistory: history });
            saveCallHistory(history);
          }
          // Don't clear screenPopData here — if accept() fails and FreeSWITCH
          // retransmits the INVITE, the popup re-opens and still needs the CRM data.
          // screenPopData is cleared explicitly on answer success, reject, or dismiss.
          set({ incomingCallPopup: false, consultCall: null, transferPhase: 'idle' });
          break;
        case 'consultCallChanged': {
          const consultCall: CallInfo | null = data;
          let transferPhase: 'idle' | 'dialing' | 'consulting' | 'failed' = 'idle';
          if (consultCall) {
            transferPhase = consultCall.state === 'answered' ? 'consulting' : 'dialing';
          } else {
            // If a consultFailure event arrived just before this null, preserve
            // the 'failed' phase instead of dropping back to 'idle'.
            const prevFailure = get().consultFailure;
            if (prevFailure) transferPhase = 'failed';
          }
          set({ consultCall, transferPhase });
          break;
        }
        case 'consultFailed': {
          const failure = data as { reason: 'unavailable' | 'busy' | 'no-answer' | 'generic'; destination: string; message: string };
          console.warn(`📞 Consult failed: ${failure.message}`);
          set({ consultFailure: failure, transferPhase: 'failed' });
          break;
        }
        case 'error':
          console.error('SIP Error:', data);
          break;
      }
    });
  }

  const savedSettings = loadSavedSettings();
  const savedHistory = loadCallHistory();

  return {
    // Initial state
    extension: savedSettings.extension,
    password: savedSettings.password,
    displayName: savedSettings.displayName,
    pbxHost: savedSettings.pbxHost,
    callMode: (typeof window !== 'undefined' && localStorage.getItem('tavl_call_mode') as 'webrtc' | 'ami') || 'webrtc',
    registrationState: 'unregistered',
    registrationError: null,
    amiConnected: false,
    currentCall: null,
    callDuration: 0,
    consultCall: null,
    transferPhase: 'idle' as const,
    consultFailure: null,
    callHistory: savedHistory,
    showDialpad: false,
    showCallHistory: false,
    screenPopData: null,
    incomingCallPopup: false,
    softphoneMinimized: false,
    // Hidden by default — opened via the map-rail phone button, or auto-shown on
    // an incoming call (see 'incomingCall' handler). Avoids the always-docked panel.
    softphoneVisible: false,
    selectedAudioInput: null,
    selectedAudioOutput: null,
    audioDevices: [],
    isConference: false,
    conferenceRoom: null,
    holdRoom: null,
    conferenceParticipants: [],
    heldChannelUuid: null,

    // Set extension credentials
    setExtension: (extension, password, displayName) => {
      set({ extension, password, displayName: displayName || `Ext ${extension}` });
      const { pbxHost } = get();
      saveSettings(extension, password, displayName, pbxHost || undefined);
      
      // For AMI mode, immediately set as "registered" if AMI is connected
      const { callMode, amiConnected } = get();
      if (callMode === 'ami' && amiConnected) {
        set({ registrationState: 'registered' });
      }
    },

    setPbxHost: (host) => {
      set({ pbxHost: host });
      const { extension, password, displayName } = get();
      saveSettings(extension || '', password || '', displayName || undefined, host);
    },

    // Set call mode
    setCallMode: (mode) => {
      set({ callMode: mode });
      if (typeof window !== 'undefined') {
        localStorage.setItem('tavl_call_mode', mode);
      }
    },

    checkAmiStatus: async () => {
      const { extension } = get();
      if (!extension) {
        set({ amiConnected: false, registrationState: 'unregistered', registrationError: null });
        return;
      }
      try {
        const response = await fetch('/api/calls/ami/status');
        const data = await response.json();
        const connected = data.success && data.connected;
        set({
          amiConnected: connected,
          registrationState: connected ? 'registered' : 'error',
          registrationError: connected ? null : 'PBX not connected',
        });
        console.log(`📞 AMI status: ${connected ? 'connected' : 'disconnected'}`);
      } catch {
        set({ amiConnected: false, registrationState: 'error', registrationError: 'Cannot reach server' });
      }
    },

    // Initialize PBX host from server if user hasn't configured one
    initializeDefaults: async () => {
      const { pbxHost } = get();
      if (!pbxHost) {
        const serverHost = await loadServerPbxHost();
        if (serverHost) {
          set({ pbxHost: serverHost });
          console.log(`📞 Loaded PBX host from server config: ${serverHost}`);
        }
      }
    },

    // Register with SIP server (WebRTC mode only)
    register: async () => {
      const { extension, password, displayName, callMode } = get();
      if (!extension || !password) {
        set({ registrationError: 'Extension and password required' });
        return false;
      }

      // If in AMI mode, just check AMI status
      if (callMode === 'ami') {
        await get().checkAmiStatus();
        if (get().amiConnected) {
          set({ registrationState: 'registered', registrationError: null });
          return true;
        } else {
          set({ registrationState: 'error', registrationError: 'AMI not connected' });
          return false;
        }
      }

      set({ registrationState: 'registering', registrationError: null });

      try {
        // Use user-configured PBX host, fall back to server config
        const { pbxHost: userHost } = get();
        let asteriskHost = userHost || '';

        if (!asteriskHost) {
          asteriskHost = await loadServerPbxHost() || '';
        }

        if (!asteriskHost) {
          set({ registrationState: 'error', registrationError: 'PBX Server IP not configured. Enter it in Phone Settings.' });
          return false;
        }

        // SIP WebSocket: connect through the app server's /ws/sip endpoint.
        // In dev (Vite), a custom plugin relays WS to the backend.
        // In production, Express serves everything on one port.
        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsServer = `${wsProtocol}://${window.location.host}/ws/sip`;

        // ICE servers: internal coturn STUN FIRST (on the FreeSWITCH host, no
        // internet needed) so calls keep working when the office internet is
        // down; public STUN second for resilience when internet IS up. On a real
        // agent (same /23 as FreeSWITCH) the coturn reflexive address equals the
        // agent's own LAN IP, which FreeSWITCH can reach directly. No TURN relay
        // (a co-located relay would carry FreeSWITCH's own IP → 488).
        //
        // The `tavl_use_coturn` flag (or ?coturn) is a VERIFICATION toggle: it drops
        // the public STUN so the session uses coturn ONLY — exactly the condition
        // during an internet outage. Lets us prove internet-independence without
        // actually downing the internet. Also enables SIP.js debug logging.
        const coturnOnly = (() => {
          try {
            return localStorage.getItem('tavl_use_coturn') === '1'
              || new URLSearchParams(window.location.search).has('coturn');
          } catch { return false; }
        })();

        const config: SipConfig = {
          wsServer,
          extension,
          password,
          displayName: displayName || undefined,
          realm: asteriskHost,
          iceServers: coturnOnly
            ? [{ urls: `stun:${asteriskHost}:3478` }]
            : [
                { urls: `stun:${asteriskHost}:3478` },
                { urls: 'stun:stun.l.google.com:19302' },
              ],
          debug: coturnOnly,
        };

        console.log('📞 Attempting WebRTC registration via proxy:', config.wsServer);
        console.log('📞 Extension:', extension, '@ realm:', asteriskHost);

        const result = await sipService.register(config);
        
        if (result) {
          set({ registrationState: 'registered', registrationError: null });
          return true;
        } else {
          // WebRTC failed - show specific error
          set({ 
            registrationState: 'error', 
            registrationError: 'WebRTC connection failed. Check console for details.'
          });
          return false;
        }
      } catch (error: any) {
        console.error('Registration error:', error);
        
        // Provide helpful error message
        let errorMsg = error.message || 'Registration failed';
        if (errorMsg.includes('WebSocket') || errorMsg.includes('connect')) {
          errorMsg = 'Cannot connect to PBX WebSocket. Server may not support WebRTC.';
        } else if (errorMsg.includes('401') || errorMsg.includes('auth')) {
          errorMsg = 'Authentication failed. Check your extension and password.';
        }
        
        set({ 
          registrationState: 'error', 
          registrationError: errorMsg
        });
        
        return false;
      }
    },

    // Unregister
    unregister: async () => {
      const { callMode } = get();
      if (callMode === 'webrtc') {
        await sipService.unregister();
      }
      set({ registrationState: 'unregistered' });
    },

    // Make outbound call
    makeCall: async (destination, customerName, vehiclePlate) => {
      const { extension, callMode, registrationState, amiConnected } = get();
      
      if (!extension) {
        alert('⚠️ Please configure your extension number first.\n\nOpen Phone settings and enter your extension.');
        return false;
      }

      // WebRTC mode - make call via SIP.js
      if (callMode === 'webrtc') {
        // Ensure we are registered; attempt auto-register once if not
        const isHealthy = sipService.checkConnectionHealth();
        if (!isHealthy || !sipService.isRegistered || registrationState !== 'registered') {
          console.warn('⚠️ WebRTC not registered, attempting re-register before call');
          const ok = await get().register();
          if (!ok || !sipService.isRegistered) {
            alert('⚠️ WebRTC not connected.\n\nPlease Register first, then try again.');
            return false;
          }
        }
        
        console.log(`📞 WebRTC call: ${extension} -> ${destination}`);
        
        // Format destination (remove spaces, dashes)
        const formattedDest = destination.replace(/[\s\-()]/g, '');
        
        const result = await sipService.call(formattedDest, customerName);
        
        if (result) {
          // Add to history
          const entry: CallHistoryEntry = {
            id: `call-${Date.now()}`,
            direction: 'outbound',
            remoteNumber: destination,
            remoteName: customerName,
            vehiclePlate,
            timestamp: Date.now(),
            answered: false, // Will be updated when call is answered
          };
          const history = [entry, ...get().callHistory];
          set({ callHistory: history });
          saveCallHistory(history);
        }
        
        return result;
      }

      // AMI mode - Originate call via Asterisk AMI
      // This makes the agent's SIP phone ring first, then connects to customer
      if (amiConnected) {
        console.log(`📞 AMI Originate: ${extension} -> ${destination}`);
        
        try {
          const response = await api.calls.originate({
            extension,
            destination,
            callerIdName: customerName || destination,
          }) as any;
          
          if (response.success) {
            // Add to history
            const entry: CallHistoryEntry = {
              id: response.actionId || `call-${Date.now()}`,
              direction: 'outbound',
              remoteNumber: destination,
              remoteName: customerName,
              vehiclePlate,
              timestamp: Date.now(),
              answered: false,
            };
            const history = [entry, ...get().callHistory];
            set({ callHistory: history });
            saveCallHistory(history);
            
            console.log(`✅ Call originated successfully - your phone will ring`);
            return true;
          } else {
            console.error('❌ AMI Originate failed:', response.error);
            alert(`Call failed: ${response.error || 'Unknown error'}\n\nMake sure your SIP phone is registered.`);
            return false;
          }
        } catch (error) {
          console.error('❌ AMI Originate error:', error);
          // Fall back to tel: link
        }
      }

      // Fallback: Click-to-Call mode - open tel: link + copy to clipboard
      // Add to history
      const entry: CallHistoryEntry = {
        id: `call-${Date.now()}`,
        direction: 'outbound',
        remoteNumber: destination,
        remoteName: customerName,
        vehiclePlate,
        timestamp: Date.now(),
        answered: true,
      };
      const history = [entry, ...get().callHistory];
      set({ callHistory: history });
      saveCallHistory(history);
      
      // Copy number to clipboard
      try {
        await navigator.clipboard.writeText(destination);
      } catch {}
      
      // Open tel: protocol (will trigger softphone if configured)
      window.open(`tel:${destination}`, '_self');
      
      console.log(`📞 Click-to-Call: ${destination} (copied to clipboard)`);
      return true;
    },

    // Answer incoming call
    answerCall: async () => {
      const result = await sipService.answer();
      if (result) {
        set({ incomingCallPopup: false });
      }
      return result;
    },

    // Reject incoming call
    rejectCall: () => {
      sipService.reject();
      set({ incomingCallPopup: false, screenPopData: null });
    },

    // Hangup current call
    hangupCall: () => {
      sipService.hangup();
    },

    // Toggle mute
    toggleMute: () => {
      const { currentCall, callMode, extension } = get();
      if (!currentCall) return;

      const newMuted = !currentCall.muted;

      if (callMode === 'webrtc') {
        // WebRTC: toggle the local audio track directly via SIP.js
        sipService.toggleMute();
      } else if (extension) {
        // AMI: mute server-side via FreeSWITCH uuid_audio (physical phone has no local track)
        fetch('/api/calls/mute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extension, mute: newMuted }),
        }).catch(err => console.error('Mute API error:', err));
      }

      // Always update store with a new reference so React re-renders the button
      set({ currentCall: { ...currentCall, muted: newMuted } });
    },

    // Toggle hold (server-side via FreeSWITCH uuid_hold + local mute)
    toggleHold: () => {
      const { extension } = get();
      sipService.toggleHold(extension || undefined);
    },

    // Attended transfer actions
    startConsultCall: async (destination) => {
      set({ transferPhase: 'dialing' });
      const ok = await sipService.startConsultCall(destination);
      if (!ok) set({ transferPhase: 'idle' });
      return ok;
    },

    completeTransfer: async () => {
      const ok = await sipService.completeAttendedTransfer();
      if (ok) set({ transferPhase: 'idle', consultCall: null });
      return ok;
    },

    cancelConsult: async () => {
      await sipService.cancelConsult();
      set({ transferPhase: 'idle', consultCall: null, consultFailure: null });
    },

    clearConsultFailure: () => {
      // Returns the transfer panel to its initial "enter destination" stage.
      // Caller remains on hold; agent can dial another extension to retry.
      set({ transferPhase: 'idle', consultFailure: null });
    },

    resumeFromHold: async () => {
      // Take the caller off hold and exit the transfer flow entirely.
      await sipService.resumeHeldCall();
      set({ transferPhase: 'idle', consultFailure: null, consultCall: null });
    },

    // Send DTMF
    sendDtmf: (tone) => {
      sipService.sendDtmf(tone);
    },

    // Conference actions
    startConference: async (destination) => {
      const { extension, currentCall } = get();
      console.log(`🎤 [CONF] startConference called: ext=${extension}, dest=${destination}, callState=${currentCall?.state}`);
      if (!extension) {
        console.error('🎤 [CONF] No extension configured');
        alert('Conference failed: No extension configured. Open Phone Settings first.');
        return false;
      }
      if (!currentCall || !['answered', 'on_hold'].includes(currentCall.state)) {
        console.error(`🎤 [CONF] No active answered call (state=${currentCall?.state})`);
        alert('Conference failed: You must be on an active call first.');
        return false;
      }

      try {
        console.log(`🎤 [CONF] Sending API request...`);
        const response = await fetch('/api/calls/conference/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extension, destination }),
        });
        const data = await response.json();
        console.log(`🎤 [CONF] API response:`, data);

        if (data.success && data.conferenceRoom) {
          set({
            isConference: true,
            conferenceRoom: data.conferenceRoom,
            holdRoom: data.holdRoom || null,
            heldChannelUuid: data.heldChannelUuid || null,
          });
          setTimeout(() => get().pollConferenceParticipants(), 2000);
          return true;
        } else {
          console.error('Conference start failed:', data.error);
          alert(`Conference failed: ${data.error || 'Unknown error'}`);
          return false;
        }
      } catch (error: any) {
        console.error('Conference start error:', error);
        alert(`Conference error: ${error.message}`);
        return false;
      }
    },

    mergeConference: async () => {
      const { conferenceRoom, holdRoom, heldChannelUuid } = get();
      if (!conferenceRoom || !heldChannelUuid) return false;
      try {
        const response = await fetch('/api/calls/conference/merge-held', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conferenceRoom, holdRoom, heldChannelUuid }),
        });
        const data = await response.json();
        if (data.success) {
          set({ heldChannelUuid: null });
          setTimeout(() => get().pollConferenceParticipants(), 1500);
          return true;
        }
        console.error('Merge held failed:', data.error);
        return false;
      } catch (error) {
        console.error('Merge held error:', error);
        return false;
      }
    },

    addConferenceParticipant: async (destination) => {
      const { conferenceRoom, extension } = get();
      if (!conferenceRoom) return false;

      try {
        const response = await fetch('/api/calls/conference/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destination, conferenceRoom, callerId: extension }),
        });
        const data = await response.json();
        if (data.success) {
          setTimeout(() => get().pollConferenceParticipants(), 2000);
          return true;
        }
        console.error('Add participant failed:', data.error);
        return false;
      } catch (error) {
        console.error('Add participant error:', error);
        return false;
      }
    },

    kickConferenceParticipant: async (memberId) => {
      const { conferenceRoom, conferenceParticipants } = get();
      if (!conferenceRoom) return false;

      const participant = conferenceParticipants.find(p => p.memberId === memberId);
      try {
        const response = await fetch('/api/calls/conference/kick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conferenceRoom, memberId, uuid: participant?.uuid }),
        });
        const data = await response.json();
        if (data.success) {
          setTimeout(() => get().pollConferenceParticipants(), 500);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    muteConferenceParticipant: async (memberId) => {
      const { conferenceRoom } = get();
      if (!conferenceRoom) return false;

      const participant = get().conferenceParticipants.find(p => p.memberId === memberId);
      if (!participant) return false;

      const newMuted = !participant.muted;

      // Optimistic update immediately so the button flips on click
      set({
        conferenceParticipants: get().conferenceParticipants.map(p =>
          p.memberId === memberId ? { ...p, muted: newMuted } : p
        ),
      });

      try {
        const response = await fetch('/api/calls/conference/mute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conferenceRoom, memberId, mute: newMuted }),
        });
        const data = await response.json();
        if (!data.success) {
          // Revert on failure
          set({
            conferenceParticipants: get().conferenceParticipants.map(p =>
              p.memberId === memberId ? { ...p, muted: !newMuted } : p
            ),
          });
          return false;
        }
        // Refresh from FS to confirm state
        setTimeout(() => get().pollConferenceParticipants(), 500);
        return true;
      } catch {
        // Revert on error
        set({
          conferenceParticipants: get().conferenceParticipants.map(p =>
            p.memberId === memberId ? { ...p, muted: !newMuted } : p
          ),
        });
        return false;
      }
    },

    endConference: async () => {
      const { conferenceRoom } = get();
      if (conferenceRoom) {
        try {
          await fetch('/api/calls/conference/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conferenceRoom }),
          });
        } catch (e) {
          console.error('Failed to end conference:', e);
        }
      }
      set({
        isConference: false,
        conferenceRoom: null,
        holdRoom: null,
        conferenceParticipants: [],
        heldChannelUuid: null,
      });
    },

    pollConferenceParticipants: async () => {
      const { conferenceRoom, isConference } = get();
      if (!conferenceRoom || !isConference) return;

      try {
        const response = await fetch(`/api/calls/conference/${conferenceRoom}/participants`);
        const data = await response.json();
        if (data.success) {
          set({ conferenceParticipants: data.participants });
          if (data.participants.length === 0) {
            set({ isConference: false, conferenceRoom: null, conferenceParticipants: [] });
          }
        }
      } catch {
        // Silently fail polling
      }
    },

    // UI toggles
    toggleDialpad: () => set((state) => ({ showDialpad: !state.showDialpad })),
    toggleCallHistory: () => set((state) => ({ showCallHistory: !state.showCallHistory })),
    toggleSoftphone: () => set((state) => ({ softphoneVisible: !state.softphoneVisible })),
    minimizeSoftphone: () => set((state) => ({ softphoneMinimized: !state.softphoneMinimized })),
    dismissIncomingPopup: () => set({ incomingCallPopup: false, screenPopData: null }),
    setScreenPopData: (data) => set({ screenPopData: data }),

    // Load audio devices
    loadAudioDevices: async () => {
      try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput');
        set({ audioDevices });
        
        // Set defaults if not set
        const { selectedAudioInput, selectedAudioOutput } = get();
        if (!selectedAudioInput) {
          const defaultInput = audioDevices.find(d => d.kind === 'audioinput');
          if (defaultInput) set({ selectedAudioInput: defaultInput.deviceId });
        }
        if (!selectedAudioOutput) {
          const defaultOutput = audioDevices.find(d => d.kind === 'audiooutput');
          if (defaultOutput) set({ selectedAudioOutput: defaultOutput.deviceId });
        }
      } catch (error) {
        console.error('Failed to load audio devices:', error);
      }
    },

    setAudioInput: (deviceId) => {
      set({ selectedAudioInput: deviceId });
      sipService.setAudioInputDevice(deviceId);
    },
    setAudioOutput: (deviceId) => {
      set({ selectedAudioOutput: deviceId });
      sipService.setAudioOutputDevice(deviceId);
    },

    // Update call duration
    _updateCallDuration: () => {
      const duration = sipService.getCallDuration();
      set({ callDuration: duration });
    },
  };
});

// Add API method for calls
declare module '@services/api' {
  interface ApiCalls {
    calls: {
      getConfig: () => Promise<any>;
      originate: (params: { extension: string; destination: string }) => Promise<any>;
    };
  }
}
