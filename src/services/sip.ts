/**
 * SIP.js WebRTC Service - Simplified version
 * Handles browser-based SIP phone for making/receiving calls
 */

import { 
  UserAgent, 
  Registerer, 
  Inviter, 
  Invitation, 
  Session, 
  SessionState,
  RegistererState,
} from 'sip.js';

export type CallState = 'idle' | 'registering' | 'registered' | 'calling' | 'ringing' | 'answered' | 'on_hold' | 'ended' | 'error';
export type CallDirection = 'inbound' | 'outbound';

export interface SipConfig {
  wsServer: string;
  extension: string;
  password: string;
  displayName?: string;
  realm?: string;
  stunServer?: string;
  iceServers?: RTCIceServer[];
  debug?: boolean;
}

export interface CallInfo {
  id: string;
  direction: CallDirection;
  remoteNumber: string;
  remoteName?: string;
  state: CallState;
  startTime?: number;
  answerTime?: number;
  endTime?: number;
  duration?: number;
  muted: boolean;
  held: boolean;
}

type CallEventCallback = (event: string, data?: any) => void;

export type ConsultFailureReason = 'unavailable' | 'busy' | 'no-answer' | 'generic';
export interface ConsultFailure {
  reason: ConsultFailureReason;
  destination: string;
  message: string;
}

class SipService {
  private userAgent: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private currentSession: Session | null = null;
  private consultSession: Session | null = null;
  private config: SipConfig | null = null;
  private callbacks: Set<CallEventCallback> = new Set();

  private _registrationState: 'unregistered' | 'registering' | 'registered' | 'error' = 'unregistered';
  private _currentCall: CallInfo | null = null;
  private _consultCall: CallInfo | null = null;
  private _heldPartnerUuid: string | null = null;
  private _isIntentionalDisconnect: boolean = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts: number = 0;
  private _everRegistered: boolean = false;
  private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  // Attended-transfer consult tracking
  private _consultDestination: string | null = null;
  private _consultFailureReason: ConsultFailureReason | null = null;
  private _consultNoAnswerTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly CONSULT_NO_ANSWER_MS = 20_000;
  // After first successful registration we retry forever (with a delay cap);
  // before first success we stop after this many attempts to avoid infinite
  // looping on bad credentials.
  private static readonly INITIAL_REGISTER_RETRY_LIMIT = 5;
  private static readonly RECONNECT_MAX_DELAY_MS = 10_000;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 20_000;
  
  private remoteAudio: HTMLAudioElement | null = null;
  private ringtoneAudio: HTMLAudioElement | null = null;
  private ringtoneContext: AudioContext | null = null;
  private ringtoneOscId: number = 0;
  private ringbackOscId: number = 0;
  private selectedOutputDeviceId: string | null = null;
  private selectedInputDeviceId: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
      this.ringtoneAudio = this.buildRingtone();

      // Send SIP BYE/REJECT when the page closes/refreshes (F5)
      // so FreeSWITCH doesn't keep ringing a dead channel.
      window.addEventListener('beforeunload', () => {
        if (this.currentSession) {
          try {
            if (this.currentSession.state === SessionState.Established) {
              this.currentSession.bye();
            } else if (this.currentSession instanceof Invitation) {
              this.currentSession.reject();
            } else if (this.currentSession instanceof Inviter) {
              this.currentSession.cancel();
            }
          } catch {}
        }
      });
    }
  }

  setAudioOutputDevice(deviceId: string | null) {
    this.selectedOutputDeviceId = deviceId;
    if (this.remoteAudio && deviceId && typeof (this.remoteAudio as any).setSinkId === 'function') {
      (this.remoteAudio as any).setSinkId(deviceId).catch(() => {});
    }
  }

  setAudioInputDevice(deviceId: string | null) {
    this.selectedInputDeviceId = deviceId;
  }

  private buildRingtone(): HTMLAudioElement | null {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const sampleRate = ctx.sampleRate;
      const duration = 2;
      const totalSamples = sampleRate * duration;
      const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
      const data = buffer.getChannelData(0);
      const ringDur = 0.4;
      const gapDur = 0.2;
      const cycleDur = ringDur + gapDur;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const cyclePos = t % cycleDur;
        if (cyclePos < ringDur) {
          data[i] = 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.15 * Math.sin(2 * Math.PI * 480 * t);
        }
      }
      this.ringtoneContext = ctx;
      const audio = new Audio();
      audio.loop = true;
      return audio;
    } catch {
      return null;
    }
  }

  private playRingtone() {
    if (!this.ringtoneContext) return;
    this.stopRingtone();
    const ctx = this.ringtoneContext;
    if (ctx.state === 'suspended') ctx.resume();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    gain.gain.value = 0.15;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    const id = ++this.ringtoneOscId;
    const pulse = () => {
      if (this.ringtoneOscId !== id) return;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + 0.4);
      setTimeout(() => { if (this.ringtoneOscId === id) pulse(); }, 600);
    };
    pulse();
    (this as any)._ringtoneOsc1 = osc1;
    (this as any)._ringtoneOsc2 = osc2;
    (this as any)._ringtoneGain = gain;
  }

  private stopRingtone() {
    this.ringtoneOscId++;
    try { (this as any)._ringtoneOsc1?.stop(); } catch {}
    try { (this as any)._ringtoneOsc2?.stop(); } catch {}
    (this as any)._ringtoneOsc1 = null;
    (this as any)._ringtoneOsc2 = null;
    (this as any)._ringtoneGain = null;
  }

  /** Standard North American ringback: 440+480 Hz, 2 s on / 4 s off */
  private playRingback() {
    if (!this.ringtoneContext) return;
    this.stopRingback();
    const ctx = this.ringtoneContext;
    if (ctx.state === 'suspended') ctx.resume();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    gain.gain.value = 0.12;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    const id = ++this.ringbackOscId;
    const pulse = () => {
      if (this.ringbackOscId !== id) return;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + 2.0);
      setTimeout(() => { if (this.ringbackOscId === id) pulse(); }, 6000);
    };
    pulse();
    (this as any)._ringbackOsc1 = osc1;
    (this as any)._ringbackOsc2 = osc2;
    (this as any)._ringbackGain = gain;
  }

  private stopRingback() {
    this.ringbackOscId++;
    try { (this as any)._ringbackOsc1?.stop(); } catch {}
    try { (this as any)._ringbackOsc2?.stop(); } catch {}
    (this as any)._ringbackOsc1 = null;
    (this as any)._ringbackOsc2 = null;
    (this as any)._ringbackGain = null;
  }

  get registrationState() { return this._registrationState; }
  get currentCall() { return this._currentCall; }
  get consultCall() { return this._consultCall; }
  get isRegistered() {
    // Check both internal state AND actual transport connection
    if (this._registrationState !== 'registered') return false;
    if (!this.userAgent) return false;
    // Check if transport is actually connected
    try {
      const transport = this.userAgent.transport as any;
      if (transport && typeof transport.isConnected === 'function') {
        return transport.isConnected();
      }
      // Fallback: trust our state
      return true;
    } catch {
      return this._registrationState === 'registered';
    }
  }
  
  // Method to check and sync actual connection state
  checkConnectionHealth(): boolean {
    if (!this.userAgent) {
      if (this._registrationState !== 'unregistered') {
        this._registrationState = 'unregistered';
        this.emit('registrationStateChanged', 'unregistered');
      }
      return false;
    }
    
    try {
      const transport = this.userAgent.transport as any;
      const isConnected = transport?.isConnected?.() ?? false;
      
      if (!isConnected && this._registrationState === 'registered') {
        console.log('⚠️ Health check: Transport disconnected but state was registered');
        this._registrationState = 'error';
        this.emit('registrationStateChanged', 'error');
        return false;
      }
      
      return isConnected && this._registrationState === 'registered';
    } catch {
      return false;
    }
  }
  get isInCall() {
    return this._currentCall !== null && 
           ['calling', 'ringing', 'answered', 'on_hold'].includes(this._currentCall.state);
  }

  subscribe(callback: CallEventCallback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private emit(event: string, data?: any) {
    this.callbacks.forEach(cb => cb(event, data));
  }

  /**
   * Test basic WebSocket connectivity before SIP.js
   */
  private async testWebSocket(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        console.log('🔌 Testing WebSocket:', url);
        const ws = new WebSocket(url, ['sip']);
        const timeout = setTimeout(() => {
          console.log('⏰ WebSocket test timeout');
          ws.close();
          resolve(false);
        }, 5000);

        ws.onopen = () => {
          console.log('✅ Test WebSocket opened');
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        };

        ws.onerror = (e) => {
          console.log('❌ Test WebSocket error:', e);
          clearTimeout(timeout);
          resolve(false);
        };

        ws.onclose = (e) => {
          console.log('🔌 Test WebSocket closed:', e.code, e.reason);
          if (e.code !== 1000) {
            clearTimeout(timeout);
            resolve(false);
          }
        };
      } catch (e) {
        console.error('❌ WebSocket test exception:', e);
        resolve(false);
      }
    });
  }

  /**
   * Register with SIP server
   */
  async register(config: SipConfig): Promise<boolean> {
    console.log('📞 SIP register called with config:', { wsServer: config.wsServer, extension: config.extension });
    
    if (this.userAgent) {
      console.log('📞 Cleaning up existing UserAgent');
      await this._teardown();
    }

    // Reset the intentional disconnect flag for new registration
    this._isIntentionalDisconnect = false;
    
    this.config = config;
    this._registrationState = 'registering';
    this.emit('registrationStateChanged', 'registering');

    return new Promise((resolve) => {
      try {
        const realm = config.realm || new URL(config.wsServer).hostname;
        const uri = UserAgent.makeURI(`sip:${config.extension}@${realm}`);
        
        if (!uri) {
          throw new Error('Invalid SIP URI');
        }

        console.log(`📞 Creating UserAgent for sip:${config.extension}@${realm}`);
        console.log(`📞 WebSocket server: ${config.wsServer}`);

        const iceServers: RTCIceServer[] = config.iceServers?.length
          ? config.iceServers
          : config.stunServer
            ? [{ urls: config.stunServer }]
            : [{ urls: 'stun:stun.l.google.com:19302' }];

        const uaOptions: any = {
          uri,
          transportOptions: {
            server: config.wsServer,
            connectionTimeout: 10,
            keepAliveInterval: 30,
          },
          authorizationUsername: config.extension,
          authorizationPassword: config.password,
          displayName: config.displayName || `Agent ${config.extension}`,
          logLevel: config.debug ? 'debug' : 'error',
          logBuiltinEnabled: true,
          sessionDescriptionHandlerFactoryOptions: {
            // Cap ICE gathering (SIP.js default is 5000ms) so answering/placing
            // never blocks waiting on a STUN server that can't be reached (e.g.
            // when the site's internet is down). After this timeout SIP.js
            // proceeds with the LAN host candidates — all that's needed for
            // browser <-> internal FreeSWITCH. This is the actual fix for the
            // "stuck on Connecting…" hang during internet outages; STUN config
            // is left unchanged so call setup behaves exactly as before.
            iceGatheringTimeout: 1000,
            peerConnectionConfiguration: {
              iceServers,
              iceCandidatePoolSize: 2,
            },
          },
          delegate: {
            onInvite: (invitation: Invitation) => this.handleIncomingCall(invitation),
          },
        };

        // NOTE: SIP.js transport option typings vary between versions.
        // We keep `uaOptions` as `any` to avoid compile-time failures while preserving runtime behavior.
        this.userAgent = new UserAgent(uaOptions);

        this.userAgent.transport.onDisconnect = (error?: Error) => {
          console.log('📞 Transport disconnected', error?.message, 'intentional:', this._isIntentionalDisconnect);
          if (this._isIntentionalDisconnect) return;
          this._scheduleReconnect(`transport-drop${error?.message ? ': ' + error.message : ''}`);
        };

        // Set up transport connect handler
        this.userAgent.transport.onConnect = () => {
          console.log('✅ WebSocket transport connected!');
        };

        // Start the UserAgent
        console.log('📞 Starting UserAgent...');
        this.userAgent.start().then(() => {
          console.log('✅ UserAgent started, creating Registerer');
          console.log('📞 Transport state:', (this.userAgent?.transport as any)?.state);
          
          if (!this.userAgent) {
            resolve(false);
            return;
          }

          // Create and set up registerer
          this.registerer = new Registerer(this.userAgent);
          
          this.registerer.stateChange.addListener((state) => {
            console.log(`📞 Registerer state changed: ${state} (current internal: ${this._registrationState})`);

            if (state === RegistererState.Registered) {
              console.log('✅ Successfully registered with SIP server!');
              this._registrationState = 'registered';
              this._reconnectAttempts = 0;
              this._everRegistered = true;
              this.emit('registrationStateChanged', 'registered');
              this._startHealthMonitor();
              resolve(true);
            } else if (state === RegistererState.Unregistered) {
              // Drop both from 'registered' (active session lost) and 'registering'
              // (transient PBX failure during a connect attempt). _scheduleReconnect
              // is a no-op if the disconnect was intentional or already scheduled.
              const wasRegistering = this._registrationState === 'registering';
              const wasActive = this._registrationState === 'registered' || wasRegistering;
              if (wasActive && !this._isIntentionalDisconnect) {
                this._scheduleReconnect('registrar-unregistered');
                if (wasRegistering) resolve(false);
                return;
              }
              this._registrationState = 'unregistered';
              this.emit('registrationStateChanged', 'unregistered');
              if (wasRegistering) resolve(false);
            } else if (state === RegistererState.Terminated) {
              if (this._registrationState === 'registering') {
                this._registrationState = 'unregistered';
                this.emit('registrationStateChanged', 'unregistered');
                resolve(false);
              }
            }
          });

          // Register
          console.log('📞 Sending REGISTER request...');
          this.registerer.register().catch((error) => {
            console.error('❌ Registration error:', error);
            this.emit('error', error);
            this._scheduleReconnect(`register-failed: ${error?.message || 'unknown'}`);
            resolve(false);
          });

          // Timeout after 15 seconds
          setTimeout(() => {
            if (this._registrationState === 'registering') {
              console.error('❌ Registration timeout');
              this.emit('error', new Error('Registration timeout'));
              this._scheduleReconnect('register-timeout');
              resolve(false);
            }
          }, 15000);

        }).catch((error) => {
          console.error('❌ Failed to start UserAgent:', error);
          this.emit('error', error);
          this._scheduleReconnect(`ua-start-failed: ${error?.message || 'unknown'}`);
          resolve(false);
        });

      } catch (error: any) {
        console.error('❌ SIP setup error:', error);
        this._registrationState = 'error';
        this.emit('registrationStateChanged', 'error');
        this.emit('error', error);
        resolve(false);
      }
    });
  }

  // Dismantle the current UserAgent without touching reconnect state.
  // Called internally before each register() attempt; leaves
  // _reconnectAttempts/_everRegistered/timer alone so reconnect bookkeeping
  // survives across a register→register cycle.
  private async _teardown() {
    this._isIntentionalDisconnect = true;
    try {
      if (this.currentSession) {
        this.hangup();
      }
      if (this.registerer) {
        try { await this.registerer.unregister(); } catch {}
        this.registerer = null;
      }
      if (this.userAgent) {
        try { await this.userAgent.stop(); } catch {}
        this.userAgent = null;
      }
    } catch (error) {
      console.error('Teardown error:', error);
    }
    // _isIntentionalDisconnect stays true; register() flips it back to false.
  }

  // Public unregister: tear down AND stop all auto-reconnect activity.
  // Called from user actions like logout, switching extensions, etc.
  async unregister() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._reconnectAttempts = 0;
    this._everRegistered = false;
    this._stopHealthMonitor();
    await this._teardown();
    this._registrationState = 'unregistered';
    this.emit('registrationStateChanged', 'unregistered');
  }

  private _scheduleReconnect(reason: string) {
    if (this._isIntentionalDisconnect) return;
    if (!this.config) return;
    if (this._reconnectTimer) return;

    // Before first successful registration, give up after N attempts so bad
    // credentials don't trigger an infinite loop. After first success, retry
    // forever with a delay cap — the extension worked once and the user wants
    // it to recover from any outage.
    if (!this._everRegistered && this._reconnectAttempts >= SipService.INITIAL_REGISTER_RETRY_LIMIT) {
      console.error(`📞 Reconnect: giving up after ${this._reconnectAttempts} attempts without ever registering (check credentials/network)`);
      this._registrationState = 'error';
      this.emit('registrationStateChanged', 'error');
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(2000 * Math.pow(2, this._reconnectAttempts - 1), SipService.RECONNECT_MAX_DELAY_MS);
    console.log(`📞 Reconnect scheduled in ${delay}ms (reason: ${reason}, attempt ${this._reconnectAttempts})`);
    this._registrationState = 'registering';
    this.emit('registrationStateChanged', 'registering');

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.config) this.register(this.config);
    }, delay);
  }

  // Watch for silent transport drops (laptop sleep, firewall idle timeout,
  // network blip) where transport.onDisconnect never fires. Reconnect when
  // we see the WS is dead but our state still says 'registered'.
  private _startHealthMonitor() {
    if (this._healthCheckInterval) return;
    this._healthCheckInterval = setInterval(() => {
      if (this._isIntentionalDisconnect) return;
      if (this._registrationState !== 'registered') return;
      if (!this.userAgent) return;
      try {
        const transport = this.userAgent.transport as any;
        const isConnected = transport?.isConnected?.() ?? true;
        if (!isConnected) {
          console.warn('📞 Health check: transport silently disconnected — triggering reconnect');
          this._scheduleReconnect('health-check-silent-drop');
        }
      } catch {}
    }, SipService.HEALTH_CHECK_INTERVAL_MS);
  }

  private _stopHealthMonitor() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  async call(destination: string, displayName?: string): Promise<boolean> {
    if (!this.userAgent || !this.isRegistered) {
      this.emit('error', new Error('Not registered'));
      return false;
    }

    if (this.isInCall) {
      this.emit('error', new Error('Already in a call'));
      return false;
    }

    try {
      const target = UserAgent.makeURI(`sip:${destination}@${this.config?.realm || new URL(this.config!.wsServer).hostname}`);
      if (!target) {
        throw new Error('Invalid destination');
      }

      // earlyMedia:true lets SIP.js apply the SDP answer from a provisional
      // response (183 Session Progress / 180-with-SDP) so the carrier's real
      // early-media audio flows before the call is answered.
      const inviter = new Inviter(this.userAgent, target, { earlyMedia: true });
      this.currentSession = inviter;

      this._currentCall = {
        id: `call-${Date.now()}`,
        direction: 'outbound',
        remoteNumber: destination,
        remoteName: displayName,
        state: 'calling',
        startTime: Date.now(),
        muted: false,
        held: false,
      };
      this.emit('callStateChanged', this._currentCall);
      this.setupSessionHandlers(inviter);

      const outConstraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (this.selectedInputDeviceId) {
        (outConstraints as any).deviceId = { ideal: this.selectedInputDeviceId };
      }

      await inviter.invite({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: outConstraints, video: false },
        },
        requestDelegate: {
          // When a provisional response carries audio (183 Session Progress, or
          // 180 with SDP), the network/carrier is sending real early media —
          // ringback, or an announcement like "the subscriber is busy /
          // unavailable / the call was declined". Play that real audio instead
          // of our synthetic ring so the agent hears what's actually happening.
          // A plain 180 Ringing (no SDP body) leaves the synthetic ringback
          // playing as a fallback, so there's never dead silence while ringing.
          onProgress: (response) => {
            try {
              if (response?.message?.body) {
                this.stopRingback();
                this.setupAudio(inviter);
              }
            } catch { /* ignore */ }
          },
          onReject: (response) => {
            console.log('📞 INVITE REJECTED by server:', response?.message?.statusCode, response?.message?.reasonPhrase);
          },
          onAccept: () => {
            console.log('📞 INVITE ACCEPTED (200 OK)');
          },
        },
      });

      // Debug instrumentation (coturn testing): surface the ICE outcome at a
      // visible log level so we can see exactly where/if connectivity fails.
      if (this.config?.debug) {
        try {
          const pc = (inviter.sessionDescriptionHandler as any)?.peerConnection as RTCPeerConnection | undefined;
          if (pc) {
            console.log('📞 ICE servers in use:', JSON.stringify((pc.getConfiguration?.().iceServers || []).map((s: any) => s.urls)));
            pc.addEventListener('iceconnectionstatechange', () => console.log('📞 iceConnectionState →', pc.iceConnectionState));
            pc.addEventListener('icegatheringstatechange', () => console.log('📞 iceGatheringState →', pc.iceGatheringState));
            pc.addEventListener('icecandidateerror', (e: any) => console.log('📞 ICE candidate error:', e.errorCode, '-', e.errorText, '-', e.url));
          } else {
            console.log('📞 (debug) no peerConnection on SDH after invite');
          }
        } catch (e) { console.log('📞 (debug) ICE hook failed:', e); }
      }

      return true;
    } catch (error: any) {
      if (typeof error?.message === 'string' && error.message.toLowerCase().includes('insecure context')) {
        console.error('❌ Call failed: insecure context. Use HTTPS or localhost.');
        this.emit('error', new Error('WebRTC needs HTTPS (or localhost). Please serve the app over HTTPS and trust the PBX cert.'));
        return false;
      }
      console.error('❌ Call failed:', error);
      this._currentCall = null;
      this.emit('error', error);
      return false;
    }
  }

  private handleIncomingCall(invitation: Invitation) {
    if (this.isInCall) {
      invitation.reject();
      return;
    }

    this.currentSession = invitation;
    const remoteId = invitation.remoteIdentity;
    
    this._currentCall = {
      id: `call-${Date.now()}`,
      direction: 'inbound',
      remoteNumber: remoteId.uri.user || 'Unknown',
      remoteName: remoteId.displayName || undefined,
      state: 'ringing',
      startTime: Date.now(),
      muted: false,
      held: false,
    };

    this.playRingtone();
    this.emit('incomingCall', this._currentCall);
    this.emit('callStateChanged', this._currentCall);
    this.setupSessionHandlers(invitation);

    // Pre-warm mic: obtain and immediately release a stream so the audio
    // pipeline is initialized before the agent clicks Answer.  This prevents
    // getUserMedia latency inside accept() from causing the first accept() to fail.
    navigator.mediaDevices?.getUserMedia({ audio: true, video: false })
      .then(stream => stream.getTracks().forEach(t => t.stop()))
      .catch(() => {});
  }

  async answer(): Promise<boolean> {
    if (!this.currentSession || !(this.currentSession instanceof Invitation)) {
      return false;
    }

    try {
      this.stopRingtone();

      const constraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (this.selectedInputDeviceId) {
        // Use 'ideal' not 'exact' — exact throws OverconstrainedError if device is
        // temporarily busy; ideal falls back to default device instead.
        (constraints as any).deviceId = { ideal: this.selectedInputDeviceId };
      }

      await this.currentSession.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: constraints, video: false },
        },
      });
      return true;
    } catch (error) {
      console.error('Answer failed:', error);
      this.emit('error', error);
      return false;
    }
  }

  reject() {
    if (this.currentSession instanceof Invitation) {
      this.currentSession.reject();
      this.stopRingtone();
    }
  }

  hangup() {
    if (!this.currentSession) return;

    try {
      if (this.currentSession.state === SessionState.Established) {
        this.currentSession.bye();
      } else if (this.currentSession instanceof Inviter) {
        this.currentSession.cancel();
      } else if (this.currentSession instanceof Invitation) {
        this.currentSession.reject();
      }
    } catch (error) {
      console.error('Hangup error:', error);
    }

    this.cleanupCall();
  }

  toggleMute(): boolean {
    if (!this.currentSession || !this._currentCall) return false;

    const pc = (this.currentSession.sessionDescriptionHandler as any)?.peerConnection as RTCPeerConnection;
    if (!pc) return false;

    const newMuted = !this._currentCall.muted;

    // Only toggle the audio track if not on hold (hold mutes independently)
    if (!this._currentCall.held) {
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === 'audio') {
          sender.track.enabled = !newMuted;
        }
      });
    }

    this._currentCall.muted = newMuted;
    this.emit('callStateChanged', this._currentCall);
    return newMuted;
  }

  /**
   * Toggle hold via FreeSWITCH server-side uuid_hold (plays MOH to customer).
   * Also mutes/unmutes local audio tracks to prevent audio leaking.
   */
  async toggleHold(extension?: string): Promise<boolean> {
    if (!this.currentSession || !this._currentCall) return false;
    if (this.currentSession.state !== SessionState.Established) return false;

    const newHeld = !this._currentCall.held;
    const ext = extension || this.config?.extension;

    try {
      if (ext) {
        const res = await fetch('/api/calls/hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extension: ext, hold: newHeld }),
        });
        const data = await res.json();
        if (!data.success) {
          console.error('Server-side hold failed:', data.error);
          return this._currentCall.held;
        }
      }

      const pc = (this.currentSession.sessionDescriptionHandler as any)?.peerConnection as RTCPeerConnection;
      if (pc) {
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind === 'audio') {
            sender.track.enabled = !newHeld && !this._currentCall!.muted;
          }
        });
      }

      this._currentCall.held = newHeld;
      this._currentCall.state = newHeld ? 'on_hold' : 'answered';
      this.emit('callStateChanged', this._currentCall);
      return newHeld;
    } catch (error) {
      console.error('Hold toggle failed:', error);
      return this._currentCall.held;
    }
  }

  /**
   * Start an attended (consultative) transfer:
   * 1. Hold Call A (plays MOH to customer, saves partnerUuid for later)
   * 2. Dial destination as Call B so agent can speak first
   */
  async startConsultCall(destination: string): Promise<boolean> {
    if (!this.currentSession || this.currentSession.state !== SessionState.Established) return false;
    if (!this.userAgent) return false;

    const ext = this.config?.extension;

    // Hold Call A server-side to play MOH to customer
    if (ext) {
      try {
        const res = await fetch('/api/calls/hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extension: ext, hold: true }),
        });
        const data = await res.json();
        if (!data.success) {
          console.error('Hold failed before consult:', data.error);
          return false;
        }
        this._heldPartnerUuid = data.partnerUuid || null;
      } catch (e) {
        console.error('Hold request failed:', e);
        return false;
      }
    }

    // Silence local audio for Call A
    const pcA = (this.currentSession.sessionDescriptionHandler as any)?.peerConnection as RTCPeerConnection;
    pcA?.getSenders().forEach(s => { if (s.track?.kind === 'audio') s.track.enabled = false; });

    if (this._currentCall) {
      this._currentCall.held = true;
      this._currentCall.state = 'on_hold';
      this.emit('callStateChanged', this._currentCall);
    }

    // Dial destination (Call B)
    const realm = this.config?.realm || new URL(this.config!.wsServer).hostname;
    const target = UserAgent.makeURI(`sip:${destination}@${realm}`);
    if (!target) return false;

    const inviter = new Inviter(this.userAgent, target);
    this.consultSession = inviter;
    this._consultDestination = destination;
    this._consultFailureReason = null;

    this._consultCall = {
      id: `consult-${Date.now()}`,
      direction: 'outbound',
      remoteNumber: destination,
      state: 'calling',
      startTime: Date.now(),
      muted: false,
      held: false,
    };
    this.emit('consultCallChanged', this._consultCall);
    this.setupConsultHandlers(inviter);

    const constraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (this.selectedInputDeviceId) (constraints as any).deviceId = { ideal: this.selectedInputDeviceId };

    // No-answer guard — if the destination never picks up within the window,
    // cancel the invite and tag it as a no-answer failure.
    if (this._consultNoAnswerTimer) clearTimeout(this._consultNoAnswerTimer);
    this._consultNoAnswerTimer = setTimeout(() => {
      this._consultNoAnswerTimer = null;
      if (this.consultSession === inviter && inviter.state !== SessionState.Established) {
        console.log(`📞 Consult no-answer timeout for ${destination}`);
        this._consultFailureReason = 'no-answer';
        try { inviter.cancel(); } catch { /* ignore */ }
      }
    }, SipService.CONSULT_NO_ANSWER_MS);

    try {
      await inviter.invite({
        sessionDescriptionHandlerOptions: { constraints: { audio: constraints, video: false } },
        requestDelegate: {
          onReject: (response) => {
            // Capture the SIP final response code so the Terminated handler can
            // surface a meaningful reason to the agent.
            const sc = response?.message?.statusCode;
            if (sc === 404 || sc === 480) this._consultFailureReason = 'unavailable';
            else if (sc === 486 || sc === 600 || sc === 603) this._consultFailureReason = 'busy';
            else this._consultFailureReason = 'generic';
            console.log(`📞 Consult invite rejected: SIP ${sc} → reason=${this._consultFailureReason}`);
          },
        },
      });
      return true;
    } catch (e) {
      console.error('Consult invite failed:', e);
      if (this._consultNoAnswerTimer) { clearTimeout(this._consultNoAnswerTimer); this._consultNoAnswerTimer = null; }
      this._consultFailureReason = this._consultFailureReason || 'generic';
      // Don't null out here — let setupConsultHandlers fire the Terminated path
      // which emits the failure and resets local state uniformly.
      return false;
    }
  }

  /**
   * Complete attended transfer: FreeSWITCH bridges the held customer with the destination.
   * Both SIP sessions will terminate as FS re-bridges.
   */
  async completeAttendedTransfer(): Promise<boolean> {
    if (!this.currentSession || !this.consultSession) return false;
    if (this.consultSession.state !== SessionState.Established) return false;
    if (!this._heldPartnerUuid) {
      console.error('No held partner UUID — cannot complete transfer');
      return false;
    }

    const ext = this.config?.extension;
    if (!ext) return false;

    try {
      const res = await fetch('/api/calls/attended-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension: ext, partnerAUuid: this._heldPartnerUuid }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Attended transfer failed:', data.error);
        return false;
      }
      // FS has bridged customer ↔ destination; clean up our sessions
      this._heldPartnerUuid = null;
      this._consultCall = null;
      this.emit('consultCallChanged', null);
      this.cleanupCall();
      return true;
    } catch (e) {
      console.error('Complete attended transfer error:', e);
      return false;
    }
  }

  /**
   * Cancel consult: hang up Call B and resume (unhold) Call A.
   */
  async cancelConsult(): Promise<void> {
    if (this._consultNoAnswerTimer) {
      clearTimeout(this._consultNoAnswerTimer);
      this._consultNoAnswerTimer = null;
    }
    // User-initiated cancel — clear any pending failure flag so the Terminated
    // handler doesn't surface a failure banner for a deliberate cancel.
    this._consultFailureReason = null;
    this._consultDestination = null;
    if (this.consultSession) {
      try {
        if (this.consultSession.state === SessionState.Established) {
          await this.consultSession.bye();
        } else if (this.consultSession instanceof Inviter) {
          await this.consultSession.cancel();
        }
      } catch { /* ignore */ }
      this.consultSession = null;
      this._consultCall = null;
      this.emit('consultCallChanged', null);
    }
    this.stopRingback();
    await this._resumeHeldCall();
  }

  // Public unhold for the failure-recovery UI: caller has been on hold
  // through a failed consult attempt; agent clicks "Resume call".
  async resumeHeldCall(): Promise<void> {
    await this._resumeHeldCall();
  }

  private _consultFailureMessage(reason: ConsultFailureReason, destination: string): string {
    switch (reason) {
      case 'unavailable': return `Extension ${destination} is unavailable — not registered or unreachable`;
      case 'busy':        return `Extension ${destination} is busy`;
      case 'no-answer':   return `Extension ${destination} did not answer`;
      case 'generic':
      default:            return `Could not reach extension ${destination}`;
    }
  }

  private async _resumeHeldCall(): Promise<void> {
    const ext = this.config?.extension;
    if (!ext || !this._currentCall?.held) return;
    try {
      const res = await fetch('/api/calls/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension: ext, hold: false }),
      });
      const data = await res.json();
      if (data.success) {
        const pcA = (this.currentSession?.sessionDescriptionHandler as any)?.peerConnection as RTCPeerConnection;
        pcA?.getSenders().forEach(s => { if (s.track?.kind === 'audio') s.track.enabled = !this._currentCall!.muted; });
        if (this._currentCall) {
          this._currentCall.held = false;
          this._currentCall.state = 'answered';
          this._heldPartnerUuid = null;
          this.emit('callStateChanged', this._currentCall);
          // Restore Call A audio
          if (this.currentSession) this.setupAudio(this.currentSession);
        }
      }
    } catch { /* ignore */ }
  }

  private setupConsultHandlers(session: Session) {
    session.stateChange.addListener((state) => {
      console.log('📞 Consult session state:', state);
      switch (state) {
        case SessionState.Establishing:
          if (this._consultCall) {
            this._consultCall.state = 'calling';
            this.emit('consultCallChanged', this._consultCall);
          }
          this.playRingback();
          break;
        case SessionState.Established:
          this.stopRingback();
          if (this._consultNoAnswerTimer) {
            clearTimeout(this._consultNoAnswerTimer);
            this._consultNoAnswerTimer = null;
          }
          if (this._consultCall) {
            this._consultCall.state = 'answered';
            this._consultCall.answerTime = Date.now();
            this.emit('consultCallChanged', this._consultCall);
          }
          this.setupAudio(session);
          break;
        case SessionState.Terminated: {
          this.stopRingback();
          if (this._consultNoAnswerTimer) {
            clearTimeout(this._consultNoAnswerTimer);
            this._consultNoAnswerTimer = null;
          }
          const neverConnected = this._consultCall?.state !== 'answered';
          const failureReason = this._consultFailureReason;
          const destination = this._consultDestination || this._consultCall?.remoteNumber || '';
          if (this._consultCall) {
            this.emit('consultCallChanged', null);
          }
          this.consultSession = null;
          this._consultCall = null;
          this._consultDestination = null;
          this._consultFailureReason = null;
          // If the consult never reached Established, the destination was
          // unreachable / busy / rejected / didn't answer. Surface the reason
          // and leave Call A on hold so the agent can retry another extension.
          if (neverConnected && this._currentCall?.held) {
            const reason: ConsultFailureReason = failureReason || 'generic';
            const message = this._consultFailureMessage(reason, destination);
            console.log(`📞 Consult failed: ${reason} — ${message}`);
            this.emit('consultFailed', { reason, destination, message } as ConsultFailure);
          }
          // If the consult HAD connected and then ended, Call A is still on hold
          // — agent must manually resume. (Behavior change: previously auto-resumed.)
          break;
        }
      }
    });
  }

  sendDtmf(tone: string) {
    if (!this.currentSession || this.currentSession.state !== SessionState.Established) {
      return;
    }

    let sent = false;

    // Strategy 1: RFC 2833 via RTCDTMFSender (in-band RTP)
    try {
      const dtmfSender = (this.currentSession.sessionDescriptionHandler as any)?.peerConnection
        ?.getSenders()
        .find((s: RTCRtpSender) => s.track?.kind === 'audio')
        ?.dtmf;

      if (dtmfSender && dtmfSender.canInsertDTMF !== false) {
        dtmfSender.insertDTMF(tone, 100, 70);
        sent = true;
      }
    } catch (error) {
      console.warn('RFC 2833 DTMF failed, falling back to SIP INFO:', error);
    }

    // Strategy 2: SIP INFO (out-of-band, works on more PBX configs)
    if (!sent) {
      try {
        this.currentSession.info({
          requestOptions: {
            body: {
              contentDisposition: 'render',
              contentType: 'application/dtmf-relay',
              content: `Signal=${tone}\r\nDuration=100`,
            },
          },
        });
        sent = true;
      } catch (error) {
        console.error('SIP INFO DTMF also failed:', error);
      }
    }

    if (!sent) {
      console.error(`DTMF tone '${tone}' could not be sent via any method`);
    }
  }

  private setupSessionHandlers(session: Session) {
    session.stateChange.addListener((state) => {
      console.log('📞 Session state:', state);

      switch (state) {
        case SessionState.Establishing:
          if (this._currentCall) {
            this._currentCall.state = 'calling';
            this.emit('callStateChanged', this._currentCall);
            if (this._currentCall.direction === 'outbound') {
              this.playRingback();
            }
          }
          break;

        case SessionState.Established:
          this.stopRingback();
          this.stopRingtone();
          if (this._currentCall) {
            this._currentCall.state = 'answered';
            this._currentCall.answerTime = Date.now();
            this.emit('callStateChanged', this._currentCall);
          }
          this.setupAudio(session);
          break;

        case SessionState.Terminated:
          this.stopRingback();
          this.stopRingtone();
          if (this._currentCall) {
            this._currentCall.state = 'ended';
            this._currentCall.endTime = Date.now();
            if (this._currentCall.answerTime) {
              this._currentCall.duration = Math.floor(
                (this._currentCall.endTime - this._currentCall.answerTime) / 1000
              );
            }
            this.emit('callEnded', this._currentCall);
          }
          this.cleanupCall();
          break;
      }
    });
  }

  private setupAudio(session: Session) {
    const pc = (session.sessionDescriptionHandler as any)?.peerConnection as RTCPeerConnection;
    if (!pc || !this.remoteAudio) return;

    const receivers = pc.getReceivers();
    const audioReceiver = receivers.find(r => r.track?.kind === 'audio');
    if (audioReceiver?.track) {
      const remoteStream = new MediaStream([audioReceiver.track]);
      this.remoteAudio.srcObject = remoteStream;
    }
  }

  private cleanupCall() {
    this.stopRingtone();
    if (this.remoteAudio) this.remoteAudio.srcObject = null;
    // If there was a consult session in progress, kill it too
    if (this.consultSession) {
      try {
        if (this.consultSession.state === SessionState.Established) this.consultSession.bye();
        else if (this.consultSession instanceof Inviter) this.consultSession.cancel();
      } catch { /* ignore */ }
      this.consultSession = null;
      this._consultCall = null;
      this._heldPartnerUuid = null;
      this.emit('consultCallChanged', null);
    }
    this.currentSession = null;
    this._currentCall = null;
    this.emit('callStateChanged', null);
  }

  getCallDuration(): number {
    if (!this._currentCall?.answerTime) return 0;
    const endTime = this._currentCall.endTime || Date.now();
    return Math.floor((endTime - this._currentCall.answerTime) / 1000);
  }
}

export const sipService = new SipService();
export default sipService;
