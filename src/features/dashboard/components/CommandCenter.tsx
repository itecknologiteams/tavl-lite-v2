import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Radio,
  Power,
  PowerOff,
  MapPin,
  RotateCcw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Send,
  Wifi,
  MessageSquare,
  History,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuthStore } from '@store/authStore';

interface CommandCenterProps {
  isOpen: boolean;
  onClose: () => void;
  vehicleId: number | null;
  vehicleName?: string;
}

interface DeviceInfo {
  objectId: number;
  plateNumber: string;
  description: string;
  imei: string;
  simNumber: string;
  moduleType: string;
  commandType: 'gprs' | 'sms' | 'unknown';
  availableCommands: string[];
  supported: boolean;
}

interface CommandResult {
  success: boolean;
  message: string;
  commandType?: string;
  commandSent?: string;
  alreadyQueued?: boolean;
}

// Map raw command text to human-readable labels
const COMMAND_LABELS: Record<string, string> = {
  'WHERE#': 'Get Location',
  'RESET#': 'CPU Reset',
  'REST#': 'CPU Reset',
  'RELAY,1#': 'Kill Engine',
  'RELAY,0#': 'Resume Engine',
  '64': 'Kill Engine',
  '65': 'Resume Engine',
  'map': 'Get Location',
  'setdigout 1': 'Kill Engine',
  'setdigout 0': 'Resume Engine',
  'setdigout 11': 'Kill Engine',
  'getgps': 'Get Location',
  'cpureset': 'CPU Reset',
  '*22*2#': 'Kill Engine',
  '*22*3#': 'Resume Engine',
  '*11*3#': 'Get Location',
  '*22*4#': 'CPU Reset',
  '<SPGS*IMB>': 'Kill Engine',
  '<SPGS*RLS>': 'Resume Engine',
};
function commandLabel(raw: string): string {
  const t = raw.trim();
  return COMMAND_LABELS[t] || t;
}

const COMMAND_INFO: Record<string, { icon: any; label: string; description: string; color: string; confirmRequired?: boolean }> = {
  kill: {
    icon: PowerOff,
    label: 'Kill Engine',
    description: 'Immobilize vehicle - engine will be disabled',
    color: 'red',
    confirmRequired: true,
  },
  resume: {
    icon: Power,
    label: 'Resume Engine',
    description: 'Re-enable engine operation',
    color: 'emerald',
    confirmRequired: true,
  },
  location: {
    icon: MapPin,
    label: 'Get Location',
    description: 'Request current GPS coordinates',
    color: 'blue',
  },
  reset: {
    icon: RotateCcw,
    label: 'CPU Reset',
    description: 'Restart the tracking device',
    color: 'orange',
    confirmRequired: true,
  },
};

export default function CommandCenter({ isOpen, onClose, vehicleId, vehicleName }: CommandCenterProps) {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmCommand, setConfirmCommand] = useState<string | null>(null);
  const userName = useAuthStore((state) => state.user?.name || state.user?.username || 'Unknown');

  // Fetch device info
  const fetchDeviceInfo = useCallback(async () => {
    if (!vehicleId) return;
    
    setLoading(true);
    setResult(null);
    setDevice(null);
    
    try {
      const response = await fetch(`/api/commands/device/${vehicleId}`);
      const data = await response.json();
      
      if (data.success) {
        setDevice(data.device);
      } else {
        setResult({ success: false, message: data.error || 'Failed to load device info' });
      }
    } catch (error: any) {
      setResult({ success: false, message: error.message });
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);
  
  // Fetch command history
  const fetchHistory = useCallback(async (showLoading = false) => {
    if (!vehicleId) return;
    
    if (showLoading) setHistoryLoading(true);
    
    try {
      const response = await fetch(`/api/commands/history/${vehicleId}?limit=20`);
      const data = await response.json();
      
      if (data.success) {
        setHistory(data);
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setHistoryLoading(false);
    }
  }, [vehicleId]);
  
  useEffect(() => {
    if (isOpen && vehicleId) {
      fetchDeviceInfo();
    } else {
      setDevice(null);
      setResult(null);
      setHistory(null);
      setShowHistory(false);
      setConfirmCommand(null);
    }
  }, [isOpen, vehicleId, fetchDeviceInfo]);
  
  // Fetch history when expanded
  useEffect(() => {
    if (showHistory && vehicleId) {
      fetchHistory(true); // Show loading on first fetch
    }
  }, [showHistory, vehicleId, fetchHistory]);
  
  // Auto-refresh history every 5 seconds while visible
  useEffect(() => {
    if (!showHistory || !vehicleId || !isOpen) return;
    
    const intervalId = setInterval(() => {
      fetchHistory(false); // Silent refresh
    }, 5000);
    
    return () => clearInterval(intervalId);
  }, [showHistory, vehicleId, isOpen, fetchHistory]);
  
  // Send command
  const sendCommand = async (command: string) => {
    if (!device) return;
    
    // Check if confirmation is needed
    const cmdInfo = COMMAND_INFO[command];
    if (cmdInfo?.confirmRequired && confirmCommand !== command) {
      setConfirmCommand(command);
      return;
    }
    
    setConfirmCommand(null);
    setSendingCommand(command);
    setResult(null);
    
    try {
      const response = await fetch('/api/commands/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectId: device.objectId,
          command,
          userName,
        }),
      });
      
      const data = await response.json();
      setResult(data);
      
      // Auto-expand history and refresh after sending
      if (!showHistory) {
        setShowHistory(true);
      }
      // Refresh immediately and then again after 2 seconds
      fetchHistory(true);
      setTimeout(() => fetchHistory(false), 2000);
    } catch (error: any) {
      setResult({ success: false, message: error.message });
    } finally {
      setSendingCommand(null);
    }
  };
  
  if (!isOpen) return null;
  
  // Use portal to render modal at body level (avoids parent container clipping)
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-dialog flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg overflow-hidden liquid-glass rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 lg-header">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-xl">
                <Radio className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Command Center</h2>
                <p className="text-sm text-slate-400">{vehicleName || `Vehicle #${vehicleId}`}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="lg-icon-btn p-2 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
              </div>
            )}
            
            {/* Device Info */}
            {device && (
              <>
                <div className="grid grid-cols-2 gap-3 p-4 lg-card rounded-xl">
                  <div>
                    <p className="text-xs text-slate-500">Device Type</p>
                    <p className="text-sm text-white font-medium">{device.moduleType}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Command Type</p>
                    <div className="flex items-center gap-1.5">
                      {device.commandType === 'gprs' ? (
                        <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                      )}
                      <p className="text-sm text-white font-medium uppercase">{device.commandType}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">IMEI</p>
                    <p className="text-sm text-slate-300 font-mono">{device.imei || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">SIM Number</p>
                    <p className="text-sm text-slate-300 font-mono">{device.simNumber || 'N/A'}</p>
                  </div>
                </div>
                
                {/* Not Supported Warning */}
                {!device.supported && (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-yellow-400 font-medium">Device Not Supported</p>
                      <p className="text-xs text-yellow-400/70 mt-1">
                        Commands are not available for "{device.moduleType}" devices.
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Commands */}
                {device.supported && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Available Commands</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['kill', 'resume', 'location', 'reset'] as const).map((cmd) => {
                        const info = COMMAND_INFO[cmd];
                        const isAvailable = device.availableCommands.includes(cmd);
                        const Icon = info.icon;
                        const isConfirming = confirmCommand === cmd;
                        
                        return (
                          <button
                            key={cmd}
                            onClick={() => sendCommand(cmd)}
                            disabled={!isAvailable || sendingCommand !== null}
                            className={`relative p-4 rounded-xl border transition-all text-left ${
                              !isAvailable
                                ? 'bg-white/5 border-white/5 opacity-40 cursor-not-allowed'
                                : isConfirming
                                ? `bg-${info.color}-500/20 border-${info.color}-500/50 ring-2 ring-${info.color}-500/30`
                                : `bg-white/5 border-white/10 hover:bg-${info.color}-500/10 hover:border-${info.color}-500/30`
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <Icon className={`w-5 h-5 ${
                                isAvailable ? `text-${info.color}-400` : 'text-slate-600'
                              }`} />
                              {sendingCommand === cmd && (
                                <Loader2 className="w-4 h-4 text-white animate-spin" />
                              )}
                            </div>
                            <p className={`mt-2 text-sm font-medium ${
                              isAvailable ? 'text-white' : 'text-slate-600'
                            }`}>
                              {isConfirming ? 'Click to Confirm' : info.label}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                              {isConfirming ? `Confirm ${info.label.toLowerCase()}?` : info.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {/* Result */}
                {result && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-xl flex items-start gap-3 ${
                      result.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30'
                        : 'bg-red-500/10 border border-red-500/30'
                    }`}
                  >
                    {result.success ? (
                      <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${
                        result.success ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {result.message}
                      </p>
                      {result.commandSent && (
                        <p className="text-xs text-slate-400 mt-1 font-mono">
                          Command: {result.commandSent}
                        </p>
                      )}
                      {result.alreadyQueued && (
                        <p className="text-xs text-yellow-400 mt-1">
                          This command is already waiting in queue
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
                
                {/* History Toggle */}
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="w-full flex items-center justify-between p-3 lg-card rounded-xl hover:border-white/12 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-300">Command History</span>
                    {showHistory && (
                      <span className="text-[10px] text-slate-500">(auto-refresh: 5s)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {showHistory && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchHistory(true);
                        }}
                        className="p-1 hover:bg-white/10 rounded transition-colors"
                        title="Refresh history"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${historyLoading ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                    {showHistory ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </button>
                
                {/* History Content */}
                <AnimatePresence>
                  {showHistory && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      {/* Loading state */}
                      {historyLoading && !history && (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                          <span className="ml-2 text-sm text-slate-400">Loading history...</span>
                        </div>
                      )}
                      
                      {history && <div className="space-y-3 pt-2">
                        {/* GPRS Section */}
                        {(history.gprs?.queue?.length > 0 || history.gprs?.sent?.length > 0 || history.gprs?.replies?.length > 0) && (
                          <div className="border border-blue-500/20 rounded-lg p-2 bg-blue-500/5">
                            <p className="text-xs text-blue-400 font-medium mb-2 flex items-center gap-1">
                              <Wifi className="w-3 h-3" />
                              GPRS Commands
                            </p>
                            
                            {/* Pending Queue */}
                            {history.gprs?.queue?.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] text-slate-500 mb-1">Pending</p>
                                <div className="space-y-1">
                                  {history.gprs.queue.slice(0, 5).map((item: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between p-1.5 bg-yellow-500/10 rounded text-xs">
                                      <span className="text-yellow-400 truncate max-w-[200px]">
                                        {commandLabel(item.Command || '')}
                                      </span>
                                      <span className="text-slate-500 flex-shrink-0 ml-2 text-[10px]">
                                        {item.EntryTime ? format(new Date(item.EntryTime), 'HH:mm:ss') : '-'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Sent Commands */}
                            {history.gprs?.sent?.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] text-slate-500 mb-1">Sent</p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {history.gprs.sent.slice(0, 10).map((item: any, idx: number) => (
                                    <div key={idx} className="p-1.5 bg-white/5 rounded text-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="text-blue-400 font-medium text-[10px]">
                                          {(item.CrmUser || 'System').trim()}
                                        </span>
                                        <span className="text-slate-500 text-[10px]">
                                          {item.SentTime ? format(new Date(item.SentTime), 'MMM dd HH:mm') : '-'}
                                        </span>
                                      </div>
                                      <p className="text-slate-300 truncate text-[10px]" title={(item.Command || '').trim()}>
                                        {commandLabel(item.Command || '')}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* GPRS Replies */}
                            {history.gprs?.replies?.length > 0 && (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Device Replies</p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {history.gprs.replies.slice(0, 10).map((item: any, idx: number) => (
                                    <div key={idx} className="p-1.5 bg-emerald-500/10 rounded text-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="text-emerald-400 font-medium flex items-center gap-1 text-[10px]">
                                          <CheckCircle className="w-2.5 h-2.5" />
                                          Reply
                                        </span>
                                        <span className="text-slate-500 text-[10px]">
                                          {item.RecvTime ? format(new Date(item.RecvTime), 'MMM dd HH:mm') : '-'}
                                        </span>
                                      </div>
                                      <p className="text-emerald-300 font-mono truncate text-[10px]" title={(item.Reply || '').trim()}>
                                        {(item.Reply || '').trim()}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* SMS Section */}
                        {(history.sms?.sent?.length > 0 || history.sms?.replies?.length > 0) && (
                          <div className="border border-purple-500/20 rounded-lg p-2 bg-purple-500/5">
                            <p className="text-xs text-purple-400 font-medium mb-2 flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              SMS Commands
                            </p>
                            
                            {/* SMS Sent */}
                            {history.sms?.sent?.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] text-slate-500 mb-1">Sent</p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {history.sms.sent.slice(0, 10).map((item: any, idx: number) => (
                                    <div key={idx} className="p-1.5 bg-white/5 rounded text-xs">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          {item.Reply ? (
                                            <CheckCircle className="w-2.5 h-2.5 text-emerald-400" />
                                          ) : (
                                            <Clock className="w-2.5 h-2.5 text-yellow-400" />
                                          )}
                                          <span className="text-purple-400 font-medium text-[10px]">
                                            {(item.SentBy || 'System').trim()}
                                          </span>
                                        </div>
                                        <span className="text-slate-500 text-[10px]">
                                          {item.SentTime ? format(new Date(item.SentTime), 'MMM dd HH:mm') : '-'}
                                        </span>
                                      </div>
                                      <p className="text-slate-300 truncate text-[10px]" title={(item.Command || '').trim()}>
                                        {commandLabel(item.Command || '')}
                                      </p>
                                      {item.Reply && (
                                        <p className="text-emerald-400 font-mono truncate text-[10px] mt-0.5">
                                          → {(item.Reply || '').trim()}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* SMS Replies from control_room_sms_received */}
                            {history.sms?.replies?.length > 0 && (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Device Acknowledgements</p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {history.sms.replies.slice(0, 10).map((item: any, idx: number) => (
                                    <div key={idx} className="p-1.5 bg-emerald-500/10 rounded text-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="text-emerald-400 font-medium flex items-center gap-1 text-[10px]">
                                          <CheckCircle className="w-2.5 h-2.5" />
                                          Reply
                                        </span>
                                        <span className="text-slate-500 text-[10px]">
                                          {item.ReceivedTime ? format(new Date(item.ReceivedTime), 'MMM dd HH:mm') : '-'}
                                        </span>
                                      </div>
                                      <p className="text-emerald-300 font-mono truncate text-[10px]" title={(item.Message || '').trim()}>
                                        {(item.Message || '').trim()}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* No History */}
                        {!history.gprs?.queue?.length && !history.gprs?.sent?.length && !history.gprs?.replies?.length && 
                         !history.sms?.sent?.length && !history.sms?.replies?.length && (
                          <p className="text-center text-slate-500 text-sm py-4">
                            No command history found
                          </p>
                        )}
                      </div>}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            
            {/* Error without device */}
            {!loading && !device && result && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{result.message}</p>
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className="px-6 py-3 border-t border-white/8 lg-footer" style={{ height: 'auto' }}>
            <p className="text-xs text-slate-500 text-center">
              Commands are queued and processed by the tracking server
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
