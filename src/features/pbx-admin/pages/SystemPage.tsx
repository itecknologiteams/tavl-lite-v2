import React, { useEffect, useState, useRef, useMemo } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import {
  Server,
  RefreshCw,
  Power,
  Activity,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Terminal,
  Loader2,
  Search,
  Download,
  ArrowDown,
} from 'lucide-react';

interface SystemStatus {
  version: string;
  uptime: string;
  activeCalls: number;
  registeredEndpoints: number;
  host: string;
}

interface Module {
  name: string;
  description: string;
  useCount: string;
  status: string;
}

export function SystemPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [logLines, setLogLines] = useState(50);
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);
  const logLinesRef = useRef(logLines);
  logLinesRef.current = logLines;

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
    fetchLogs();
    const interval = setInterval(fetchData, 30000);
    const logsInterval = setInterval(fetchLogs, 5000);
    return () => {
      clearInterval(interval);
      clearInterval(logsInterval);
    };
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [logLines]);

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const fetchData = async () => {
    if (isInitialLoad.current) {
      setLoading(true);
    }
    try {
      const statusRes = await adminApi('/system/status');
      const statusData = await statusRes.json();
      if (statusData.success) {
        setStatus(statusData.status);
      }

      const modulesRes = await adminApi('/system/modules');
      const modulesData = await modulesRes.json();
      if (modulesData.success) {
        setModules(modulesData.modules);
      }
    } catch (err) {
      console.error('Failed to fetch system data:', err);
    } finally {
      setLoading(false);
      isInitialLoad.current = false;
    }
  };

  const fetchLogs = async () => {
    try {
      const logsRes = await adminApi(`/system/logs?lines=${logLinesRef.current}`);
      const logsData = await logsRes.json();
      if (logsData.success) {
        setLogs(logsData.logs);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      let endpoint = '/system/reload';
      let body: any = {};

      if (action === 'restart') {
        endpoint = '/system/restart';
      } else if (action.startsWith('reload-')) {
        body = { module: action.replace('reload-', '') };
      }

      const res = await adminApi(endpoint, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: data.message || 'Action completed' });
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Action failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Connection failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!logSearch.trim()) return logs;
    const term = logSearch.toLowerCase();
    return logs.filter(line => line.toLowerCase().includes(term));
  }, [logs, logSearch]);

  const handleDownloadLogs = () => {
    const text = filteredLogs.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freeswitch-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
  };

  const handleLogsScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const runningModules = modules.filter((m) => m.status === 'Running');
  const notRunningModules = modules.filter((m) => m.status !== 'Running');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">System Controls</h1>
        <p className="text-slate-400">Manage FreeSWITCH server and monitor status</p>
      </div>

      {/* Status Card */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">System Status</h2>
            <p className="text-slate-400 text-sm">FreeSWITCH server health</p>
          </div>
        </div>

        {loading && !status ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          </div>
        ) : status ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-slate-400 text-sm mb-1">FreeSWITCH Version</p>
              <p className="text-white font-medium text-sm truncate" title={status.version}>
                {status.version}
              </p>
            </div>
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-slate-400 text-sm mb-1">System Uptime</p>
              <p className="text-white font-medium text-sm">{status.uptime}</p>
            </div>
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-slate-400 text-sm mb-1">Active Calls</p>
              <p className="text-white font-medium">{status.activeCalls}</p>
            </div>
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-slate-400 text-sm mb-1">Registered Endpoints</p>
              <p className="text-white font-medium">{status.registeredEndpoints}</p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Control Actions */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
            <Power className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Control Actions</h2>
            <p className="text-slate-400 text-sm">Reload configs or restart FreeSWITCH</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleAction('reload')}
            disabled={actionLoading !== null}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {actionLoading === 'reload' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reload All Configs
          </button>
          <button
            onClick={() => handleAction('reload-res_pjsip.so')}
            disabled={actionLoading !== null}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {actionLoading === 'reload-res_pjsip.so' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reload PJSIP
          </button>
          <button
            onClick={() => setShowRestartConfirm(true)}
            disabled={actionLoading !== null}
            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {actionLoading === 'restart' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            Graceful Restart
          </button>
        </div>
      </div>

      {/* Two Column Layout: Modules & Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Modules */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Loaded Modules</h2>
              <p className="text-slate-400 text-sm">
                {runningModules.length} running, {notRunningModules.length} not running
              </p>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
              </div>
            ) : modules.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No modules found</p>
            ) : (
              modules.slice(0, 20).map((module) => (
                <div
                  key={module.name}
                  className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{module.name}</p>
                    <p className="text-slate-500 text-xs truncate">{module.description}</p>
                  </div>
                  <span
                    className={`flex-shrink-0 px-2 py-1 rounded-full text-xs ${
                      module.status === 'Running'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-slate-500/10 text-slate-400'
                    }`}
                  >
                    {module.status}
                  </span>
                </div>
              ))
            )}
            {modules.length > 20 && (
              <p className="text-slate-500 text-sm text-center">
                And {modules.length - 20} more modules...
              </p>
            )}
          </div>
        </div>

        {/* Logs */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">FreeSWITCH Logs</h2>
              <p className="text-slate-400 text-sm">
                {logSearch ? `${filteredLogs.length} matches` : `Last ${logLines} lines`} from /var/log/freeswitch/freeswitch.log
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter logs..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-700/40 border border-slate-600/50 rounded-lg text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <select
              value={logLines}
              onChange={(e) => setLogLines(Number(e.target.value))}
              className="px-2 py-1.5 bg-slate-700/40 border border-slate-600/50 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value={50}>50 lines</option>
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
            </select>
            <button
              onClick={handleDownloadLogs}
              title="Download logs"
              className="p-1.5 bg-slate-700/40 border border-slate-600/50 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative">
            <div
              ref={logsContainerRef}
              onScroll={handleLogsScroll}
              className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 h-80 overflow-y-auto font-mono text-xs"
            >
              {filteredLogs.length === 0 ? (
                <p className="text-slate-500 text-center py-4">
                  {logSearch ? 'No matching logs' : 'No logs available'}
                </p>
              ) : (
                filteredLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`py-0.5 ${
                      log.includes('ERROR') || log.includes('error')
                        ? 'text-red-400'
                        : log.includes('WARNING') || log.includes('warning')
                        ? 'text-amber-400'
                        : log.includes('NOTICE') || log.includes('notice')
                        ? 'text-blue-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
            {!autoScroll && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-3 right-3 p-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 hover:text-white shadow-lg transition-colors"
                title="Scroll to bottom"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Restart Confirmation Modal */}
      {showRestartConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold">Restart FreeSWITCH?</h3>
                <p className="text-slate-400 text-sm">This will gracefully restart the PBX. Active calls will be maintained until they end.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowRestartConfirm(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={() => { setShowRestartConfirm(false); handleAction('restart'); }} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg">Restart Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-sm ${
          toast.type === 'success'
            ? 'bg-emerald-900/90 border-emerald-500/30 text-emerald-300'
            : 'bg-red-900/90 border-red-500/30 text-red-300'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
