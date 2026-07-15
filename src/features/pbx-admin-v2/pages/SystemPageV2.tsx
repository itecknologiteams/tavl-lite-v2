import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getSystemStatus, getSystemModules, getSystemLogs, reloadSystem, restartSystem, extractError } from '../api';
import type { SystemStatus } from '../types';
import {
  Settings, Loader2, AlertCircle, CheckCircle, XCircle, RefreshCw, Power,
  Server, Activity, FileText, Package, Search, Download, Users,
  AlertTriangle, X,
} from 'lucide-react';

interface ToastItem { id: string; type: 'success' | 'error'; msg: string }
function usePageToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = (type: 'success' | 'error', msg: string) => {
    const id = Date.now().toString();
    setToasts((p) => [...p, { id, type, msg }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), type === 'success' ? 3000 : 5000);
  };
  return { toasts, toast };
}

function colorLogLine(line: string): React.ReactNode {
  if (/\bERROR\b/i.test(line)) return <span className="text-red-400">{line}</span>;
  if (/\bWARN(ING)?\b/i.test(line)) return <span className="text-amber-400">{line}</span>;
  if (/\bINFO\b/i.test(line)) return <span className="text-blue-400">{line}</span>;
  if (/\bDEBUG\b/i.test(line)) return <span className="text-slate-500">{line}</span>;
  return <span>{line}</span>;
}

export function SystemPageV2() {
  const { toasts, toast } = usePageToast();
  const [logLines, setLogLines] = useState(200);
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [moduleSearch, setModuleSearch] = useState('');
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [restartConfirmText, setRestartConfirmText] = useState('');
  const logContainerRef = useRef<HTMLPreElement>(null);

  const statusQ = useQuery<SystemStatus>({
    queryKey: ['system-status-v2'],
    queryFn: getSystemStatus,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const modulesQ = useQuery({
    queryKey: ['system-modules-v2'],
    queryFn: getSystemModules,
    staleTime: 30_000,
  });

  const logsQ = useQuery({
    queryKey: ['system-logs-v2', logLines],
    queryFn: () => getSystemLogs(logLines),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  const reloadMut = useMutation({
    mutationFn: reloadSystem,
    onSuccess: (data) => toast('success', data.message || 'FreeSWITCH configuration reloaded'),
    onError: (err) => toast('error', extractError(err)),
  });

  const restartMut = useMutation({
    mutationFn: restartSystem,
    onSuccess: (data) => {
      toast('success', data.message || 'FreeSWITCH restart initiated');
      setShowRestartModal(false);
      setRestartConfirmText('');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const status = statusQ.data;
  const modules = modulesQ.data || [];
  const logs = logsQ.data || [];

  const filteredModules = modules.filter((m) =>
    !moduleSearch || m.name.toLowerCase().includes(moduleSearch.toLowerCase()),
  );

  const filteredLogs = useMemo(() => {
    if (!logSearch) return logs;
    return logs.filter((line) => line.toLowerCase().includes(logSearch.toLowerCase()));
  }, [logs, logSearch]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const downloadLogs = useCallback(() => {
    const content = logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freeswitch-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast('success', 'Logs downloaded');
  }, [logs, toast]);

  const enabledModules = modules.filter((m) => m.enabled).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">System</h1>
        <p className="text-slate-400 mt-1 font-medium">FreeSWITCH engine status, modules, and controls</p>
      </div>

      {/* Status Grid (2x3) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {([
          { label: 'Host', value: status?.host, icon: Server, color: 'text-blue-400' },
          { label: 'Version', value: status?.version, icon: Package, color: 'text-indigo-400' },
          { label: 'Uptime', value: status?.uptime, icon: Activity, color: 'text-emerald-400' },
          { label: 'Active Calls', value: status?.activeCalls, icon: Activity, color: 'text-cyan-400' },
          { label: 'Peak Sessions', value: status?.peakSessions, icon: Activity, color: 'text-amber-400' },
          { label: 'Registered Endpoints', value: status?.registeredEndpoints, icon: Users, color: 'text-violet-400' },
        ] as const).map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${color}`} />
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{label}</p>
            </div>
            <p className="text-lg text-white font-bold truncate" title={String(value ?? '—')}>
              {statusQ.isLoading ? <span className="text-slate-600">…</span> : (value ?? '—')}
            </p>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Engine Controls</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => reloadMut.mutate()}
            disabled={reloadMut.isPending}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-all disabled:opacity-60"
            title="Reload FreeSWITCH XML configuration without dropping calls"
          >
            {reloadMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reload Configuration
          </button>
          <button
            onClick={() => { setShowRestartModal(true); setRestartConfirmText(''); }}
            disabled={restartMut.isPending}
            className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
            title="Restart the FreeSWITCH process — all calls will be dropped"
          >
            {restartMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            Graceful Restart
          </button>
        </div>
      </div>

      {/* Restart Confirm Modal */}
      {showRestartModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowRestartModal(false); setRestartConfirmText(''); }}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Restart FreeSWITCH</h2>
                  <p className="text-sm text-slate-400 mt-0.5">This will affect all active services</p>
                </div>
              </div>

              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
                <p className="text-sm text-red-400 font-semibold">Warning: All active calls will be terminated</p>
                <ul className="text-xs text-red-400/80 space-y-1 list-disc list-inside">
                  <li>All active calls will be immediately disconnected</li>
                  <li>All registered endpoints will need to re-register</li>
                  <li>The system will be unavailable for 10-30 seconds</li>
                  <li>Queued calls will be lost</li>
                </ul>
              </div>

              {status?.activeCalls !== undefined && status.activeCalls > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-sm text-amber-400">
                    There {status.activeCalls === 1 ? 'is' : 'are'} currently <strong>{status.activeCalls}</strong> active call{status.activeCalls !== 1 ? 's' : ''}.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Type <span className="text-red-400 font-mono">RESTART</span> to confirm
                </label>
                <input
                  type="text"
                  value={restartConfirmText}
                  onChange={(e) => setRestartConfirmText(e.target.value)}
                  placeholder="RESTART"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all font-mono"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowRestartModal(false); setRestartConfirmText(''); }}
                  className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => restartMut.mutate()}
                  disabled={restartConfirmText !== 'RESTART' || restartMut.isPending}
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                >
                  {restartMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                  Restart FreeSWITCH
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout: Modules + Log Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Modules */}
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex flex-col max-h-[600px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Modules ({enabledModules}/{modules.length})
            </h2>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search modules…"
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2 pl-8 pr-3 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
            />
          </div>
          {modulesQ.isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
            </div>
          )}
          {modulesQ.isError && (
            <p className="text-sm text-red-400 text-center py-4">Failed to load modules</p>
          )}
          {!modulesQ.isLoading && !modulesQ.isError && (
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {filteredModules.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">{moduleSearch ? 'No matching modules' : 'No modules found'}</p>
              )}
              {filteredModules.map((mod) => (
                <div
                  key={mod.name}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${
                    mod.enabled
                      ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800/40 border-slate-700/40 text-slate-500'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${mod.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className="truncate font-mono">{mod.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Live Log Viewer */}
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 flex flex-col max-h-[600px]">
          <div className="p-4 border-b border-slate-700/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Live Logs</h2>
                {logsQ.isFetching && <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadLogs}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-700/50 text-slate-400 hover:text-white border border-slate-600/40 transition-all"
                  title="Download logs"
                >
                  <Download className="w-3 h-3" /> Download
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={logLines}
                onChange={(e) => setLogLines(Number(e.target.value))}
                className="bg-slate-900/50 border border-slate-700 rounded-lg py-1.5 px-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
              >
                <option value={200}>200 lines</option>
                <option value={500}>500 lines</option>
                <option value={1000}>1000 lines</option>
              </select>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter logs…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-1.5 pl-7 pr-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
              </div>
              <button
                onClick={() => setAutoScroll((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  autoScroll
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                    : 'bg-slate-700/50 border-slate-600/40 text-slate-400 hover:text-white'
                }`}
              >
                Auto-scroll {autoScroll ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <pre
            ref={logContainerRef}
            className="flex-1 overflow-auto text-[11px] text-slate-400 font-mono p-4 leading-relaxed"
          >
            {logsQ.isLoading ? (
              <span className="text-slate-600">Loading logs…</span>
            ) : logsQ.isError ? (
              <span className="text-red-400">Failed to load logs</span>
            ) : filteredLogs.length === 0 ? (
              <span className="text-slate-600">{logSearch ? 'No matching log lines' : 'No log output available'}</span>
            ) : (
              filteredLogs.map((line, i) => (
                <div key={i}>{colorLogLine(line)}</div>
              ))
            )}
          </pre>
        </div>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 space-y-3 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {t.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span className="text-sm font-medium">{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
