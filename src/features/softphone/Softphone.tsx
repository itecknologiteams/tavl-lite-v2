/**
 * Softphone Component
 * In-browser SIP phone for making and receiving calls
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLayoutStore, FOOTER_HEIGHT } from '@store/layoutStore';
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Mic,
  MicOff,
  Pause,
  Play,
  Settings,
  X,
  Minimize2,
  Maximize2,
  Hash,
  User,
  Users,
  UserMinus,
  UserPlus,
  ArrowRightLeft,
  History,
  Wifi,
  WifiOff,
  Delete,
  MapPin,
  Car,
  Building2,
  Loader2,
} from 'lucide-react';
import { useCallStore } from '@store/callStore';
import type { ConferenceParticipant } from '@store/callStore';

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatPhoneNumber = (number: string): string => {
  if (!number) return '';
  const digits = number.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return number;
};

// --- DTMF Tone Generator (Web Audio API) -----------------------------------

const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  return _audioCtx;
}

function playDtmfTone(digit: string, durationMs = 120) {
  const freqs = DTMF_FREQUENCIES[digit];
  if (!freqs) return;

  try {
    const ctx = getAudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.15;
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.frequency.value = freqs[0];
    osc2.frequency.value = freqs[1];
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.connect(gain);
    osc2.connect(gain);

    const now = ctx.currentTime;
    osc1.start(now);
    osc2.start(now);

    gain.gain.setValueAtTime(0.15, now + durationMs / 1000 - 0.01);
    gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    osc1.stop(now + durationMs / 1000 + 0.02);
    osc2.stop(now + durationMs / 1000 + 0.02);
  } catch {
    // Audio playback is best-effort
  }
}

// --- Sub-components --------------------------------------------------------

function DialpadButton({
  digit,
  letters,
  onClick,
}: {
  digit: string;
  letters?: string;
  onClick: (digit: string) => void;
}) {
  const handlePress = useCallback(() => {
    playDtmfTone(digit);
    onClick(digit);
  }, [digit, onClick]);

  return (
    <button
      onClick={handlePress}
      className="flex flex-col items-center justify-center aspect-square w-full max-w-[3.25rem] rounded-full bg-slate-700/40 hover:bg-slate-600/60 active:bg-slate-500/60 active:scale-95 transition-all select-none"
    >
      <span className="text-lg font-semibold text-white leading-none">{digit}</span>
      {letters && (
        <span className="text-[9px] text-slate-400 tracking-widest mt-0.5">{letters}</span>
      )}
    </button>
  );
}

function CallControlButton({
  onClick,
  icon: Icon,
  label,
  active,
  activeClass,
  danger,
}: {
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  active?: boolean;
  activeClass?: string;
  danger?: boolean;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 min-w-0">
      <div
        className={`p-3 rounded-full transition-colors ${
          danger
            ? 'bg-red-500 hover:bg-red-600'
            : active
              ? activeClass || 'bg-primary-500/20 text-primary-400'
              : 'bg-slate-700/50 text-white hover:bg-slate-600/50'
        }`}
      >
        <Icon className={`w-5 h-5 ${danger ? 'text-white' : ''}`} />
      </div>
      <span
        className={`text-[10px] leading-tight ${
          danger ? 'text-red-400' : active ? 'text-white' : 'text-slate-500'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function CallHistoryItem({
  call,
  onCall,
}: {
  call: any;
  onCall: (number: string) => void;
}) {
  const Icon =
    call.direction === 'inbound'
      ? call.answered
        ? PhoneIncoming
        : PhoneMissed
      : PhoneOutgoing;

  const iconColor = call.answered
    ? call.direction === 'inbound'
      ? 'text-blue-400'
      : 'text-emerald-400'
    : 'text-red-400';

  return (
    <div
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer group"
      onClick={() => onCall(call.remoteNumber)}
    >
      <div className={`p-2 rounded-lg bg-slate-700/50 ${iconColor}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">
          {call.remoteName || formatPhoneNumber(call.remoteNumber)}
        </div>
        <div className="text-xs text-slate-500">
          {new Date(call.timestamp).toLocaleTimeString()}
          {call.duration && ` \u2022 ${formatDuration(call.duration)}`}
        </div>
      </div>
      <button className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-emerald-500/20 text-emerald-400 transition-opacity">
        <Phone className="w-4 h-4" />
      </button>
    </div>
  );
}

// --- Settings Panel --------------------------------------------------------

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const {
    extension,
    password,
    displayName,
    pbxHost,
    callMode,
    registrationState,
    registrationError,
    amiConnected,
    setExtension,
    setPbxHost,
    setCallMode,
    register,
    unregister,
    checkAmiStatus,
    audioDevices,
    selectedAudioInput,
    selectedAudioOutput,
    loadAudioDevices,
    setAudioInput,
    setAudioOutput,
  } = useCallStore();

  const [localExt, setLocalExt] = useState(extension || '');
  const [localPass, setLocalPass] = useState(password || '');
  const [localName, setLocalName] = useState(displayName || '');
  const [localHost, setLocalHost] = useState(pbxHost || '');
  const [isRegistering, setIsRegistering] = useState(false);
  const [wsTestResult, setWsTestResult] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const autoConnectRan = useRef(false);

  useEffect(() => {
    if (!localHost) {
      fetch('/api/calls/config')
        .then((r) => r.json())
        .then((d) => {
          const host = d?.config?.host || '';
          if (host && !localHost) setLocalHost(host);
        })
        .catch(() => {});
    }
    loadAudioDevices();
    if (callMode === 'ami') checkAmiStatus();
  }, []);

  const proxyWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

  const testWebSocket = async () => {
    setWsTestResult('testing');
    try {
      const ws = new WebSocket(proxyWsUrl, ['sip']);
      const timer = setTimeout(() => {
        ws.close();
        setWsTestResult('fail');
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        setWsTestResult('ok');
      };
      ws.onerror = () => {
        clearTimeout(timer);
        setWsTestResult('fail');
      };
    } catch {
      setWsTestResult('fail');
    }
  };

  const handleSaveAndRegister = async () => {
    if (!localExt || !localPass) return;
    setIsRegistering(true);
    if (localHost) setPbxHost(localHost);
    setExtension(localExt, localPass, localName || `Ext ${localExt}`);
    autoConnectRan.current = true;
    await register();
    setIsRegistering(false);
  };

  const handleUnregister = async () => {
    await unregister();
  };

  const handleSaveAmi = () => {
    if (!localExt || !localPass) return;
    if (localHost) setPbxHost(localHost);
    setExtension(localExt, localPass, localName || `Ext ${localExt}`);
    checkAmiStatus();
  };

  const inputDevices = audioDevices.filter((d) => d.kind === 'audioinput');
  const outputDevices = audioDevices.filter((d) => d.kind === 'audiooutput');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 shrink-0">
        <h3 className="text-sm font-semibold text-white">Phone Settings</h3>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Mode Selection */}
        <div>
          <label className="block text-[10px] font-medium text-slate-500 uppercase mb-2">
            Phone Mode
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setCallMode('webrtc')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                callMode === 'webrtc'
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-700/50 text-slate-400 hover:text-white'
              }`}
            >
              WebRTC (In-App)
            </button>
            <button
              onClick={() => setCallMode('ami')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                callMode === 'ami'
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-700/50 text-slate-400 hover:text-white'
              }`}
            >
              Click-to-Call
            </button>
          </div>
        </div>

        {/* PBX Server */}
        <div className="p-2 bg-slate-700/30 rounded-lg space-y-2">
          <label className="block text-[10px] font-medium text-slate-500 uppercase">
            PBX Server IP
          </label>
          <input
            type="text"
            value={localHost}
            onChange={(e) => {
              setLocalHost(e.target.value);
              setWsTestResult('idle');
            }}
            placeholder="e.g. 192.168.21.32"
            className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded text-white placeholder-slate-500 text-sm font-mono"
          />
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">
                Extension
              </label>
              <input
                type="text"
                value={localExt}
                onChange={(e) => setLocalExt(e.target.value)}
                placeholder="e.g. 100"
                className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded text-white placeholder-slate-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">
                Password
              </label>
              <input
                type="password"
                value={localPass}
                onChange={(e) => setLocalPass(e.target.value)}
                placeholder="Extension password"
                className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded text-white placeholder-slate-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* WebRTC Mode Settings */}
        {callMode === 'webrtc' && (
          <>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-2">
              <p className="text-[10px] text-blue-400 font-medium">Test PBX Connection</p>
              <p className="text-[10px] text-slate-400">
                Connection is proxied through the app server — no certificate setup needed.
              </p>
              <button
                onClick={testWebSocket}
                disabled={wsTestResult === 'testing'}
                className={`w-full px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                  wsTestResult === 'ok'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : wsTestResult === 'fail'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
              >
                {wsTestResult === 'testing'
                  ? 'Testing...'
                  : wsTestResult === 'ok'
                    ? 'Connected to PBX'
                    : wsTestResult === 'fail'
                      ? 'Failed \u2014 Check PBX Server IP'
                      : 'Test Connection'}
              </button>
            </div>

            {localExt && <ExtensionDiagnostics ext={localExt} />}

            <div
              className={`p-2 rounded-lg border ${
                registrationState === 'registered'
                  ? 'bg-emerald-500/10 border-emerald-500/20'
                  : registrationState === 'error'
                    ? 'bg-red-500/10 border-red-500/20'
                    : registrationState === 'registering'
                      ? 'bg-amber-500/10 border-amber-500/20'
                      : 'bg-slate-700/50 border-white/10'
              }`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`w-2 h-2 rounded-full ${
                    registrationState === 'registered'
                      ? 'bg-emerald-500'
                      : registrationState === 'error'
                        ? 'bg-red-500'
                        : registrationState === 'registering'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-slate-500'
                  }`}
                />
                <span
                  className={
                    registrationState === 'registered'
                      ? 'text-emerald-400'
                      : registrationState === 'error'
                        ? 'text-red-400'
                        : registrationState === 'registering'
                          ? 'text-amber-400'
                          : 'text-slate-400'
                  }
                >
                  {registrationState === 'registered'
                    ? `Registered (${extension}@${localHost})`
                    : registrationState === 'error'
                      ? 'Connection Failed'
                      : registrationState === 'registering'
                        ? 'Connecting...'
                        : 'Not Connected'}
                </span>
              </div>
              {registrationError && (
                <p className="text-[10px] text-red-400 mt-1">{registrationError}</p>
              )}
            </div>

            {registrationState === 'registered' ? (
              <button
                onClick={handleUnregister}
                className="w-full px-2 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-xs text-red-400 font-medium transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleSaveAndRegister}
                disabled={!localExt || !localPass || !localHost || isRegistering}
                className="w-full px-2 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 rounded text-xs text-white font-medium transition-colors"
              >
                {isRegistering ? 'Connecting...' : 'Connect to PBX'}
              </button>
            )}

            {registrationState === 'registered' && (
              <div className="space-y-2 pt-2 border-t border-white/10">
                <label className="block text-[10px] font-medium text-slate-500 uppercase">
                  Audio Devices
                </label>
                {inputDevices.length > 0 && (
                  <select
                    value={selectedAudioInput || ''}
                    onChange={(e) => setAudioInput(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded text-white text-xs"
                  >
                    <option value="">Select Microphone</option>
                    {inputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                )}
                {outputDevices.length > 0 && (
                  <select
                    value={selectedAudioOutput || ''}
                    onChange={(e) => setAudioOutput(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded text-white text-xs"
                  >
                    <option value="">Select Speaker</option>
                    {outputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </>
        )}

        {/* AMI Mode Settings */}
        {callMode === 'ami' && (
          <>
            <div className="p-2 bg-primary-500/10 border border-primary-500/20 rounded-lg">
              <p className="text-[10px] text-primary-400 mb-1 font-medium">Click-to-Call Mode</p>
              <p className="text-[10px] text-primary-300/80">
                Use a SIP softphone (Zoiper, MicroSIP, etc.) on your computer. When you click a
                phone number, your SIP phone will ring first, then connect you to the customer.
              </p>
            </div>

            <AmiStatusBadge connected={amiConnected} />

            <button
              onClick={handleSaveAmi}
              disabled={!localExt || !localPass}
              className="w-full px-2 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 rounded text-xs text-white font-medium transition-colors"
            >
              Save &amp; Connect
            </button>

            <SipSetupInstructions ext={localExt} pass={localPass} host={localHost} />
          </>
        )}
      </div>
    </div>
  );
}

function SipSetupInstructions({ ext, pass, host }: { ext: string; pass: string; host: string }) {
  return (
    <div className="p-2 bg-slate-700/30 rounded-lg">
      <p className="text-[10px] text-slate-400 font-medium mb-1">
        SIP Phone Setup (Zoiper/MicroSIP):
      </p>
      <ul className="text-[10px] text-slate-500 space-y-0.5">
        <li>
          &bull; Server: <span className="text-white font-mono">{host || 'enter above'}</span>
        </li>
        <li>
          &bull; Username: <span className="text-white font-mono">{ext || '\u2014'}</span>
        </li>
        <li>
          &bull; Password: <span className="text-white font-mono">{pass || '\u2014'}</span>
        </li>
        <li>&bull; Transport: UDP / Port 5060</li>
      </ul>
    </div>
  );
}

function AmiStatusBadge({ connected }: { connected: boolean }) {
  const [host, setHost] = useState('');
  useEffect(() => {
    fetch('/api/calls/ami/status')
      .then((r) => r.json())
      .then((d) => setHost(d.host || ''))
      .catch(() => {});
  }, [connected]);

  return (
    <div
      className={`p-2 rounded-lg border ${
        connected
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : 'bg-red-500/10 border-red-500/20'
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`}
        />
        <span className={connected ? 'text-emerald-400' : 'text-red-400'}>
          {connected ? 'Connected to PBX' : 'PBX Not Connected'}
        </span>
      </div>
      {connected && host && <p className="text-[10px] text-slate-400 mt-1">Server: {host}</p>}
    </div>
  );
}

function ExtensionDiagnostics({ ext }: { ext: string }) {
  const [diag, setDiag] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const check = async () => {
    if (!ext || !/^\d{2,5}$/.test(ext)) return;
    setLoading(true);
    setError('');
    setDiag(null);
    try {
      const r = await fetch(`/api/calls/extension-check/${ext}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Check failed');
      setDiag(d);
    } catch (e: any) {
      setError(e.message || 'Failed to check');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={check}
        disabled={loading || !ext || !/^\d{2,5}$/.test(ext)}
        className="w-full px-2 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 rounded text-xs text-white font-medium transition-colors flex items-center justify-center gap-1.5"
      >
        {loading ? (
          <>
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Checking...
          </>
        ) : (
          <>
            <Settings className="w-3 h-3" />
            Check Extension
          </>
        )}
      </button>

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      {diag && !diag.found && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-[10px] text-red-400 font-medium">
            Extension {ext} not found on PBX
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Create it in PBX Admin &rarr; Extensions first.
          </p>
        </div>
      )}

      {diag && diag.found && (
        <div
          className={`p-2 rounded-lg border space-y-1.5 ${
            diag.webrtcReady
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-amber-500/10 border-amber-500/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-white">Ext {diag.extension}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                diag.webrtcReady
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {diag.webrtcReady ? 'Ready' : 'Not Registered'}
            </span>
          </div>

          <p className="text-[10px] text-slate-400">State: {diag.state}</p>
          {diag.params.contact && (
            <p className="text-[10px] text-slate-400 truncate">Contact: {diag.params.contact}</p>
          )}

          {diag.issues?.length > 0 && (
            <div className="pt-1 border-t border-white/5">
              <p className="text-[10px] text-red-400 font-medium">Issues:</p>
              {diag.issues.map((i: string, idx: number) => (
                <p key={idx} className="text-[10px] text-red-300">
                  &bull; {i}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main Softphone --------------------------------------------------------

export default function Softphone({ railDocked = false }: { railDocked?: boolean } = {}) {
  const {
    extension,
    callMode,
    registrationState,
    amiConnected,
    currentCall,
    callDuration,
    callHistory,
    showDialpad,
    showCallHistory,
    softphoneMinimized,
    softphoneVisible,
    isConference,
    conferenceRoom,
    conferenceParticipants,
    heldChannelUuid,
    consultCall,
    transferPhase,
    makeCall,
    answerCall,
    rejectCall,
    hangupCall,
    toggleMute,
    toggleHold,
    sendDtmf,
    toggleDialpad,
    toggleCallHistory,
    minimizeSoftphone,
    toggleSoftphone,
    startConference,
    mergeConference,
    addConferenceParticipant,
    kickConferenceParticipant,
    muteConferenceParticipant,
    endConference,
    pollConferenceParticipants,
    startConsultCall,
    completeTransfer,
    cancelConsult,
    clearConsultFailure,
    resumeFromHold,
    consultFailure,
    register,
    checkAmiStatus,
  } = useCallStore();

  const trackBarHeight = useLayoutStore((s) => s.trackBarHeight);
  const softphoneBottom = FOOTER_HEIGHT + trackBarHeight + 20;

  const [dialNumber, setDialNumber] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [transferMode, setTransferMode] = useState(false);
  const [transferNumber, setTransferNumber] = useState('');
  const [conferenceMode, setConferenceMode] = useState(false);
  const [conferenceNumber, setConferenceNumber] = useState('');
  const [conferenceLoading, setConferenceLoading] = useState(false);
  const autoConnectRanMain = useRef(false);
  const confPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = callMode === 'ami' ? amiConnected : registrationState === 'registered';
  const isInCall =
    currentCall && ['calling', 'ringing', 'answered', 'on_hold'].includes(currentCall.state);

  useEffect(() => {
    if (autoConnectRanMain.current) return;
    if (!extension || registrationState !== 'unregistered') return;
    autoConnectRanMain.current = true;
    if (callMode === 'ami') {
      checkAmiStatus().then(() => {
        const store = useCallStore.getState();
        if (store.amiConnected) {
          useCallStore.setState({ registrationState: 'registered' });
        }
      });
    } else {
      register();
    }
  }, [extension, registrationState, callMode, register, checkAmiStatus]);

  useEffect(() => {
    if (isConference && conferenceRoom) {
      confPollRef.current = setInterval(() => {
        pollConferenceParticipants();
      }, 3000);
      return () => {
        if (confPollRef.current) clearInterval(confPollRef.current);
      };
    } else {
      if (confPollRef.current) {
        clearInterval(confPollRef.current);
        confPollRef.current = null;
      }
    }
  }, [isConference, conferenceRoom, pollConferenceParticipants]);

  useEffect(() => {
    if (!isInCall && isConference) {
      endConference();
      setConferenceMode(false);
      setConferenceNumber('');
    }
    if (!isInCall && transferMode) {
      setTransferMode(false);
      setTransferNumber('');
    }
  }, [isInCall, isConference, endConference, transferMode]);

  const handleStartConference = useCallback(async () => {
    if (!conferenceNumber) return;
    setConferenceLoading(true);
    const ok = await startConference(conferenceNumber);
    setConferenceLoading(false);
    if (ok) {
      setConferenceMode(false);
      setConferenceNumber('');
    }
  }, [conferenceNumber, startConference]);

  const handleAddParticipant = useCallback(async () => {
    if (!conferenceNumber) return;
    setConferenceLoading(true);
    await addConferenceParticipant(conferenceNumber);
    setConferenceLoading(false);
    setConferenceNumber('');
  }, [conferenceNumber, addConferenceParticipant]);

  const handleDialpadPress = useCallback(
    (digit: string) => {
      if (currentCall?.state === 'answered') {
        sendDtmf(digit);
      } else {
        setDialNumber((prev) => prev + digit);
      }
    },
    [currentCall, sendDtmf],
  );

  const handleCall = useCallback(async () => {
    if (!dialNumber) return;
    await makeCall(dialNumber);
    setDialNumber('');
  }, [dialNumber, makeCall]);

  const handleCallFromHistory = useCallback(
    async (number: string) => {
      await makeCall(number);
    },
    [makeCall],
  );

  const handleStartConsult = useCallback(async () => {
    if (!transferNumber) return;
    const ok = await startConsultCall(transferNumber);
    if (!ok) {
      alert('Could not start consult call. Make sure you are on an active call and the destination is valid.');
    }
  }, [transferNumber, startConsultCall]);

  const handleCompleteTransfer = useCallback(async () => {
    const ok = await completeTransfer();
    if (ok) {
      setTransferMode(false);
      setTransferNumber('');
    } else {
      alert('Transfer completion failed. The destination party may have hung up.');
    }
  }, [completeTransfer]);

  const handleCancelConsult = useCallback(async () => {
    await cancelConsult();
    setTransferMode(false);
    setTransferNumber('');
  }, [cancelConsult]);

  // --- Hidden: FAB to re-open ----------------------------------------------

  if (!softphoneVisible) {
    // When docked to the map control rail, the rail's phone button is the opener,
    // so we suppress the floating FAB (it would overlap the rail).
    if (railDocked) return null;
    return (
      <button
        onClick={toggleSoftphone}
        className="fixed left-2 sm:left-4 z-softphone p-3 bg-emerald-500 hover:bg-emerald-600 rounded-full shadow-lg shadow-emerald-500/25 transition-all duration-300"
        style={{ bottom: softphoneBottom }}
        title="Open Softphone"
      >
        <Phone className="w-5 h-5 text-white" />
      </button>
    );
  }

  // --- Visible softphone ---------------------------------------------------

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={`lg-panel-float fixed z-softphone left-2 right-2 sm:right-auto ${
        railDocked ? 'sm:left-16' : 'sm:left-4'
      } ${
        softphoneMinimized ? 'sm:w-60' : 'sm:w-80'
      } max-h-[calc(100vh-72px)] rounded-2xl overflow-x-hidden overflow-y-auto transition-all duration-300`}
      style={{ bottom: softphoneBottom }}
    >
      {/* ---- Header ---- */}
      <div className="lg-header-dense flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium text-white text-sm">Phone</span>
          {extension && (
            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded truncate max-w-[5rem]">
              {extension}
            </span>
          )}
          <div
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isConnected
                ? 'bg-emerald-500'
                : registrationState === 'registering'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-red-500'
            }`}
          />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="lg-icon-btn p-1.5 rounded-lg text-slate-400 hover:text-white"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={minimizeSoftphone}
            className="lg-icon-btn p-1.5 rounded-lg text-slate-400 hover:text-white"
          >
            {softphoneMinimized ? (
              <Maximize2 className="w-3.5 h-3.5" />
            ) : (
              <Minimize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={toggleSoftphone}
            className="lg-icon-btn p-1.5 rounded-lg text-slate-400 hover:text-red-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ---- Body ---- */}
      <div className="relative">
        {/* Minimized view */}
        {softphoneMinimized && (
          <div className="p-3">
            {isInCall ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {currentCall.remoteName || formatPhoneNumber(currentCall.remoteNumber)}
                  </div>
                  <div className="text-xs text-emerald-400">
                    {currentCall.state === 'answered'
                      ? formatDuration(callDuration)
                      : currentCall.state}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={toggleMute}
                    className={`p-2 rounded-lg transition-colors ${
                      currentCall.muted
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-slate-700/50 text-slate-400 hover:text-white'
                    }`}
                  >
                    {currentCall.muted ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={hangupCall}
                    className="p-2 bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                  >
                    <PhoneOff className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isConnected && registrationState === 'registered'
                        ? 'bg-emerald-500'
                        : registrationState === 'registering'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-red-500'
                    }`}
                  />
                  <span className="text-xs text-slate-400">
                    {isConnected && registrationState === 'registered'
                      ? `Ready${extension ? ` (${extension})` : ''}`
                      : registrationState === 'registering'
                        ? 'Checking...'
                        : registrationState === 'error'
                          ? 'Check settings'
                          : 'Offline'}
                  </span>
                </div>
                {(!isConnected || registrationState === 'error' || !extension) && (
                  <button
                    onClick={() => setShowSettings(true)}
                    className="text-xs text-primary-400 hover:text-primary-300"
                  >
                    Configure
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Full view */}
        {!softphoneMinimized && (
          <div>
            {isInCall ? (
              /* ----------- In-Call View ----------- */
              <div className="px-4 pt-3 pb-4">
                {/* Compact caller info */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-700/50 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {currentCall.remoteName || formatPhoneNumber(currentCall.remoteNumber)}
                    </div>
                    <div
                      className={`text-xs ${
                        currentCall.state === 'answered'
                          ? 'text-emerald-400'
                          : currentCall.state === 'ringing'
                            ? 'text-amber-400 animate-pulse'
                            : 'text-blue-400'
                      }`}
                    >
                      {currentCall.state === 'answered'
                        ? formatDuration(callDuration)
                        : currentCall.state === 'calling'
                          ? 'Calling...'
                          : currentCall.state === 'ringing'
                            ? 'Ringing...'
                            : currentCall.state}
                    </div>
                  </div>
                  {isConference && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-purple-500/15 rounded-full shrink-0">
                      <Users className="w-3 h-3 text-purple-400" />
                      <span className="text-[10px] text-purple-400 font-medium">
                        {conferenceParticipants.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* 3x2 control grid */}
                <div className="grid grid-cols-3 gap-y-4 gap-x-2 justify-items-center mt-5">
                  {/* Row 1, Col 1: Mute (always) */}
                  <CallControlButton
                    onClick={toggleMute}
                    icon={currentCall.muted ? MicOff : Mic}
                    label={currentCall.muted ? 'Unmute' : 'Mute'}
                    active={currentCall.muted}
                    activeClass="bg-red-500/20 text-red-400"
                  />

                  {/* Row 1, Col 2: Hold (normal) | Add (conference) */}
                  {!isConference ? (
                    <CallControlButton
                      onClick={toggleHold}
                      icon={currentCall.held ? Play : Pause}
                      label={currentCall.held ? 'Resume' : 'Hold'}
                      active={currentCall.held}
                      activeClass="bg-amber-500/20 text-amber-400"
                    />
                  ) : (
                    <CallControlButton
                      onClick={() => {
                        setConferenceMode(!conferenceMode);
                        setTransferMode(false);
                      }}
                      icon={UserPlus}
                      label="Add"
                      active={conferenceMode}
                      activeClass="bg-purple-500/20 text-purple-400"
                    />
                  )}

                  {/* Row 1, Col 3: Transfer (normal) | Keypad (conference) */}
                  {!isConference ? (
                    <CallControlButton
                      onClick={() => {
                        if (transferPhase !== 'idle') return; // block re-open during active consult
                        setTransferMode(!transferMode);
                        setConferenceMode(false);
                      }}
                      icon={ArrowRightLeft}
                      label="Transfer"
                      active={transferMode || transferPhase !== 'idle'}
                      activeClass="bg-blue-500/20 text-blue-400"
                    />
                  ) : (
                    <CallControlButton
                      onClick={toggleDialpad}
                      icon={Hash}
                      label="Keypad"
                      active={showDialpad}
                      activeClass="bg-primary-500/20 text-primary-400"
                    />
                  )}

                  {/* Row 2, Col 1: Conference (normal) | spacer */}
                  {!isConference ? (
                    <CallControlButton
                      onClick={() => {
                        setConferenceMode(!conferenceMode);
                        setTransferMode(false);
                      }}
                      icon={Users}
                      label="Conf."
                      active={conferenceMode}
                      activeClass="bg-purple-500/20 text-purple-400"
                    />
                  ) : (
                    <div />
                  )}

                  {/* Row 2, Col 2: Keypad (normal) | End (conference) */}
                  {!isConference ? (
                    <CallControlButton
                      onClick={toggleDialpad}
                      icon={Hash}
                      label="Keypad"
                      active={showDialpad}
                      activeClass="bg-primary-500/20 text-primary-400"
                    />
                  ) : (
                    <CallControlButton
                      onClick={hangupCall}
                      icon={PhoneOff}
                      label="End"
                      danger
                    />
                  )}

                  {/* Row 2, Col 3: End (normal) | spacer */}
                  {!isConference ? (
                    <CallControlButton
                      onClick={hangupCall}
                      icon={PhoneOff}
                      label="End"
                      danger
                    />
                  ) : (
                    <div />
                  )}
                </div>

                {/* In-call DTMF dialpad */}
                <AnimatePresence>
                  {showDialpad && isInCall && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-3 gap-2 justify-items-center pt-4">
                        <DialpadButton digit="1" onClick={handleDialpadPress} />
                        <DialpadButton digit="2" letters="ABC" onClick={handleDialpadPress} />
                        <DialpadButton digit="3" letters="DEF" onClick={handleDialpadPress} />
                        <DialpadButton digit="4" letters="GHI" onClick={handleDialpadPress} />
                        <DialpadButton digit="5" letters="JKL" onClick={handleDialpadPress} />
                        <DialpadButton digit="6" letters="MNO" onClick={handleDialpadPress} />
                        <DialpadButton digit="7" letters="PQRS" onClick={handleDialpadPress} />
                        <DialpadButton digit="8" letters="TUV" onClick={handleDialpadPress} />
                        <DialpadButton digit="9" letters="WXYZ" onClick={handleDialpadPress} />
                        <DialpadButton digit="*" onClick={handleDialpadPress} />
                        <DialpadButton digit="0" letters="+" onClick={handleDialpadPress} />
                        <DialpadButton digit="#" onClick={handleDialpadPress} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Attended Transfer panel */}
                {transferMode && !isConference && (
                  <div className="mt-4 space-y-2">
                    {transferPhase === 'idle' ? (
                      /* Stage 1: enter destination and call */
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={transferNumber}
                          onChange={(e) => setTransferNumber(e.target.value)}
                          placeholder="Transfer to..."
                          className="flex-1 px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm focus:border-blue-500/40 focus:outline-none"
                          onKeyDown={(e) => e.key === 'Enter' && handleStartConsult()}
                          autoFocus
                        />
                        <button
                          onClick={handleStartConsult}
                          disabled={!transferNumber}
                          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                        >
                          Call
                        </button>
                      </div>
                    ) : transferPhase === 'dialing' ? (
                      /* Stage 2: consult call is ringing */
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                          <span className="text-sm text-blue-300 truncate">Calling {consultCall?.remoteNumber}…</span>
                        </div>
                        <button
                          onClick={handleCancelConsult}
                          className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-xs text-red-400 shrink-0 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : transferPhase === 'failed' && consultFailure ? (
                      /* Stage 4: consult never connected — show reason, let agent retry or resume */
                      (() => {
                        const isSoft = consultFailure.reason === 'busy' || consultFailure.reason === 'no-answer';
                        const tone = isSoft
                          ? { wrap: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-300', dot: 'bg-amber-400' }
                          : { wrap: 'bg-red-500/10 border-red-500/30',   text: 'text-red-300',   dot: 'bg-red-400' };
                        return (
                          <div className="space-y-2">
                            <div className={`p-2 border rounded-lg flex items-start gap-2 ${tone.wrap}`}>
                              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${tone.dot}`} />
                              <div className="min-w-0">
                                <div className={`text-xs font-medium ${tone.text}`}>{consultFailure.message}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">Caller is still on hold.</div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => { clearConsultFailure(); setTransferNumber(''); }}
                                className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-xs text-white font-medium transition-colors"
                              >
                                Try another extension
                              </button>
                              <button
                                onClick={async () => { await resumeFromHold(); setTransferMode(false); setTransferNumber(''); }}
                                className="px-3 py-2 bg-slate-600 hover:bg-slate-500 rounded-lg text-xs text-white transition-colors"
                              >
                                Resume call
                              </button>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      /* Stage 3: consult connected — speak first, then complete */
                      <div className="space-y-2">
                        <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-xs text-emerald-300 truncate">
                            Speaking with {consultCall?.remoteNumber}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleCompleteTransfer}
                            className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-xs text-white font-medium transition-colors flex items-center justify-center gap-1.5"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            Complete Transfer
                          </button>
                          <button
                            onClick={handleCancelConsult}
                            className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-xs text-red-400 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Merge button — shown when customer is on hold waiting to be merged */}
                {isConference && heldChannelUuid && (
                  <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <div className="text-[10px] text-amber-400 mb-1.5">Customer on hold (MoH)</div>
                    <button
                      onClick={mergeConference}
                      className="w-full px-3 py-1.5 bg-amber-500 hover:bg-amber-600 rounded-lg text-xs text-white font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Merge — Join Customer to Conference
                    </button>
                  </div>
                )}

                {/* Conference participants — always visible during conference */}
                {isConference && conferenceParticipants.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <div className="text-[10px] text-slate-500 uppercase font-medium">
                      Participants
                    </div>
                    {conferenceParticipants.map((p) => (
                      <div
                        key={p.memberId || p.channel}
                        className="flex items-center justify-between p-2 bg-slate-700/30 rounded-lg"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs text-white truncate">
                              {p.callerIdName || p.callerIdNum || p.channel.split('-')[0]}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {p.callerIdNum}
                              {p.admin ? ' (host)' : ''}
                              {p.muted ? ' · muted' : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => muteConferenceParticipant(p.memberId)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              p.muted
                                ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                                : 'text-slate-500 hover:bg-white/10 hover:text-white'
                            }`}
                            title={p.muted ? 'Unmute participant' : 'Mute participant'}
                          >
                            {p.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => kickConferenceParticipant(p.memberId)}
                            className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                            title="Disconnect"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Conference panel — add participant input */}
                {conferenceMode && (
                  <div className="mt-4">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={conferenceNumber}
                        onChange={(e) => setConferenceNumber(e.target.value)}
                        placeholder="Number to add..."
                        className="flex-1 px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm focus:border-purple-500/40 focus:outline-none"
                        onKeyDown={(e) =>
                          e.key === 'Enter' &&
                          (isConference ? handleAddParticipant() : handleStartConference())
                        }
                      />
                      <button
                        onClick={isConference ? handleAddParticipant : handleStartConference}
                        disabled={!conferenceNumber || conferenceLoading}
                        className="px-3 py-2 bg-purple-500 hover:bg-purple-600 rounded-lg text-sm text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {conferenceLoading ? (
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5" />
                        )}
                        {isConference ? 'Add' : 'Start'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ----------- Idle / Dial View ----------- */
              <div className="px-4 pt-3 pb-4">
                {/* Number input with inline call button */}
                <div className="relative mb-3">
                  <input
                    type="text"
                    value={dialNumber}
                    onChange={(e) => setDialNumber(e.target.value)}
                    placeholder="Enter number..."
                    className="w-full pl-4 pr-[5.5rem] py-3 bg-slate-800/60 border border-white/10 rounded-xl text-white text-lg text-center font-mono placeholder-slate-600 focus:border-emerald-500/40 focus:outline-none transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && handleCall()}
                  />
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {dialNumber && (
                      <button
                        onClick={() => setDialNumber((prev) => prev.slice(0, -1))}
                        className="p-2 hover:bg-white/10 rounded-lg text-slate-500 transition-colors"
                        title="Backspace"
                      >
                        <Delete className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleCall}
                      disabled={!dialNumber || !isConnected}
                      className="p-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-600 rounded-xl text-white transition-colors"
                      title="Call"
                    >
                      <Phone className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>

                {/* Tab bar: Dialpad | History */}
                <div className="flex gap-1.5 mb-3 bg-slate-800/40 rounded-lg p-1">
                  <button
                    onClick={toggleDialpad}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      showDialpad
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Hash className="w-3.5 h-3.5" />
                    Dialpad
                  </button>
                  <button
                    onClick={toggleCallHistory}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      showCallHistory
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    History
                  </button>
                </div>

                {/* Dialpad grid */}
                <AnimatePresence>
                  {showDialpad && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-3 gap-2 justify-items-center py-2">
                        <DialpadButton digit="1" onClick={handleDialpadPress} />
                        <DialpadButton digit="2" letters="ABC" onClick={handleDialpadPress} />
                        <DialpadButton digit="3" letters="DEF" onClick={handleDialpadPress} />
                        <DialpadButton digit="4" letters="GHI" onClick={handleDialpadPress} />
                        <DialpadButton digit="5" letters="JKL" onClick={handleDialpadPress} />
                        <DialpadButton digit="6" letters="MNO" onClick={handleDialpadPress} />
                        <DialpadButton digit="7" letters="PQRS" onClick={handleDialpadPress} />
                        <DialpadButton digit="8" letters="TUV" onClick={handleDialpadPress} />
                        <DialpadButton digit="9" letters="WXYZ" onClick={handleDialpadPress} />
                        <DialpadButton digit="*" onClick={handleDialpadPress} />
                        <DialpadButton digit="0" letters="+" onClick={handleDialpadPress} />
                        <DialpadButton digit="#" onClick={handleDialpadPress} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Call History */}
                <AnimatePresence>
                  {showCallHistory && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="max-h-48 overflow-y-auto py-2 space-y-1">
                        {callHistory.length === 0 ? (
                          <div className="text-center py-4 text-sm text-slate-500">
                            No call history
                          </div>
                        ) : (
                          callHistory.map((call) => (
                            <CallHistoryItem
                              key={call.id}
                              call={call}
                              onCall={handleCallFromHistory}
                            />
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Status Bar */}
            <div className="px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.02] flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5">
                {isConnected ? (
                  <>
                    <Wifi className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">
                      {callMode === 'ami' ? 'Click-to-Call Ready' : 'WebRTC Ready'}
                    </span>
                  </>
                ) : registrationState === 'registering' ? (
                  <>
                    <Wifi className="w-3 h-3 text-amber-400 animate-pulse" />
                    <span className="text-amber-400">Connecting...</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3 text-red-400" />
                    <span className="text-red-400">Offline</span>
                  </>
                )}
              </div>
              <div className="text-slate-500">{extension || 'No ext'}</div>
            </div>
          </div>
        )}

        {/* ---- Settings overlay (slides in from right) ---- */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="absolute inset-0 z-10 bg-slate-900 rounded-b-2xl"
            >
              <SettingsPanel onClose={() => setShowSettings(false)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// --- Incoming Call Popup ---------------------------------------------------

export function IncomingCallPopup() {
  const { currentCall, incomingCallPopup, screenPopData, answerCall, rejectCall, dismissIncomingPopup } =
    useCallStore();
  const trackBarHeight = useLayoutStore((s) => s.trackBarHeight);
  const popupBottom = FOOTER_HEIGHT + trackBarHeight + 64;
  const [answering, setAnswering] = useState(false);
  // useRef so the guard survives SIP session cycles (callEnded → new incomingCall)
  // without getting stuck the way useState+disabled did.
  const answeringRef = useRef(false);

  const handleAnswer = useCallback(async () => {
    if (answeringRef.current) return;
    answeringRef.current = true;
    setAnswering(true);
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const ok = await answerCall();
        if (ok) return;

        // accept() failed — wait up to 3 s for a valid incoming call to be
        // available (same session survived, or FreeSWITCH retransmitted a new one).
        let elapsed = 0;
        while (elapsed < 3000) {
          await new Promise<void>(r => setTimeout(r, 300));
          elapsed += 300;
          const s = useCallStore.getState();
          if (s.incomingCallPopup && s.currentCall?.direction === 'inbound') break;
        }

        const s = useCallStore.getState();
        if (!s.incomingCallPopup || s.currentCall?.direction !== 'inbound') return;
      }
    } finally {
      answeringRef.current = false;
      setAnswering(false);
    }
  }, [answerCall]); // answeringRef intentionally excluded — it's a ref

  if (!incomingCallPopup || !currentCall || currentCall.direction !== 'inbound') {
    return null;
  }

  const customer = screenPopData?.customer;
  const vehicles = screenPopData?.vehicles;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 50, scale: 0.9 }}
      transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
      className="fixed left-2 right-2 sm:right-auto sm:left-4 sm:w-80 z-incoming-call max-h-[calc(100vh-72px)] bg-slate-900/97 backdrop-blur-xl rounded-2xl border border-emerald-500/30 shadow-2xl shadow-emerald-500/20 overflow-x-hidden overflow-y-auto transition-[bottom] duration-300"
      style={{ bottom: popupBottom }}
    >
      {/* Emerald glow strip at top */}
      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />

      <div className="p-4">
        {/* Header: icon + call info */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center animate-pulse shrink-0 mt-0.5">
            <PhoneIncoming className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-0.5">
              Incoming Call
            </div>
            <div className="text-sm font-semibold text-white truncate">
              {currentCall.remoteName || formatPhoneNumber(currentCall.remoteNumber)}
            </div>
            {currentCall.remoteName && (
              <div className="text-xs text-slate-500 truncate mt-0.5">
                {formatPhoneNumber(currentCall.remoteNumber)}
              </div>
            )}
          </div>
          <button
            onClick={dismissIncomingPopup}
            className="p-1 rounded-md text-slate-600 hover:text-slate-400 transition-colors cursor-pointer shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* CRM Customer block */}
        {customer && (
          <div className="mb-3 rounded-xl bg-slate-800/60 border border-white/5 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-sm font-semibold text-white truncate">{customer.name}</span>
            </div>
            {customer.address && (
              <div className="flex items-start gap-2">
                <MapPin className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
                <span className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{customer.address}</span>
              </div>
            )}
          </div>
        )}

        {/* Vehicles block */}
        {vehicles && vehicles.length > 0 && (
          <div className="mb-3 rounded-xl bg-slate-800/60 border border-white/5 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Car className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                Registered Vehicles
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {vehicles.slice(0, 5).map((v) => (
                <span
                  key={v.vehicleId}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-500/15 border border-primary-500/20 text-[11px] font-semibold text-primary-300 tracking-wide"
                >
                  {v.plateNumber}
                </span>
              ))}
              {vehicles.length > 5 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-700/60 text-[11px] text-slate-400">
                  +{vehicles.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={rejectCall}
            className="flex-1 py-2.5 bg-red-500/20 hover:bg-red-500 border border-red-500/30 hover:border-red-500 rounded-xl text-red-400 hover:text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer"
          >
            <PhoneOff className="w-4 h-4" />
            Decline
          </button>
          <button
            onClick={handleAnswer}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer ${answering ? 'bg-emerald-600' : 'bg-emerald-500 hover:bg-emerald-400'}`}
          >
            {answering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Phone className="w-4 h-4" />
            )}
            {answering ? 'Connecting…' : 'Answer'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
