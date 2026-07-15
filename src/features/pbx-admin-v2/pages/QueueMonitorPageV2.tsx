import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getQueueMonitor } from '../api';
import {
  Activity, Loader2, AlertCircle, PhoneCall, Users, Clock, RefreshCw,
  PhoneIncoming, User, Headphones,
} from 'lucide-react';

function formatWait(raw?: string | number): string {
  if (raw == null) return '0s';
  if (typeof raw === 'string') return raw || '0s';
  if (raw <= 0) return '0s';
  const m = Math.floor(raw / 60);
  const s = raw % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  available:      { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'Available' },
  'available (on demand)': { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'Available' },
  ready:          { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'Ready' },
  'on break':     { bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400',   label: 'On Break' },
  'in a queue call': { bg: 'bg-blue-500/10 border-blue-500/20',  text: 'text-blue-400',    label: 'On Call' },
  'on call':      { bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400',   label: 'On Call' },
  oncall:         { bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400',   label: 'On Call' },
  busy:           { bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400',   label: 'Busy' },
  idle:           { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'Idle' },
  waiting:        { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'Waiting' },
  receiving:      { bg: 'bg-blue-500/10 border-blue-500/20',     text: 'text-blue-400',    label: 'Receiving' },
  'logged out':   { bg: 'bg-slate-700/50 border-slate-600/30',   text: 'text-slate-400',   label: 'Logged Out' },
  offline:        { bg: 'bg-slate-700/50 border-slate-600/30',   text: 'text-slate-400',   label: 'Offline' },
  unknown:        { bg: 'bg-slate-700/50 border-slate-600/30',   text: 'text-slate-400',   label: 'Unknown' },
};

function statusChip(status?: string, _state?: string) {
  const display = status || 'Unknown';
  const key = display.toLowerCase();
  const s = STATUS_STYLES[key] || { bg: 'bg-slate-700/50 border-slate-600/30', text: 'text-slate-400', label: display };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// Backend shape: { name, waiting (number), agents (array), calls (array) }
interface QueueMonitorData {
  name: string;
  waiting: number;
  agents: AgentData[];
  calls: CallerData[];
}

interface AgentData {
  extension: string;
  name?: string;
  status?: string;
  state?: string;
  callsTaken?: number;
  interface?: string;
}

interface CallerData {
  position?: number;
  callerId?: string;
  callerIdName?: string;
  channel?: string;
  waitTime?: string | number;
}

export function QueueMonitorPageV2() {
  const { data: queues = [], isLoading, isError, refetch, dataUpdatedAt } = useQuery<QueueMonitorData[]>({
    queryKey: ['queue-monitor-v2'],
    queryFn: getQueueMonitor,
    refetchInterval: 5000,
    staleTime: 5000,
  });

  const [activeTab, setActiveTab] = useState<string | null>(null);

  const currentTab = activeTab && queues.some((q) => q.name === activeTab) ? activeTab : queues[0]?.name ?? null;
  const activeQueue = useMemo(() => queues.find((q) => q.name === currentTab), [queues, currentTab]);

  const totalWaiting = useMemo(() => queues.reduce((s, q) => s + (q.waiting ?? q.calls?.length ?? 0), 0), [queues]);
  const totalAgents = useMemo(() => queues.reduce((s, q) => s + (q.agents?.length ?? 0), 0), [queues]);
  const busiest = useMemo(() => {
    if (queues.length === 0) return null;
    return queues.reduce((best, q) => {
      const w = q.waiting ?? q.calls?.length ?? 0;
      const bw = best.waiting ?? best.calls?.length ?? 0;
      return w > bw ? q : best;
    }, queues[0]);
  }, [queues]);

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Queue Monitor</h1>
          <p className="text-slate-400 mt-1 font-medium">Live real-time view of call queue activity</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-400">Live</span>
          </div>
          <span className="text-xs text-slate-500">Updated {lastUpdated}</span>
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors" title="Refresh now">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading queue data…</p>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold mb-1">Failed to load queue monitor</p>
          <p className="text-slate-400 text-sm mb-4">Check server connection and try again</p>
          <button onClick={() => refetch()} className="text-sm text-indigo-400 hover:text-indigo-300 font-semibold">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && queues.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Activity className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No Active Queues</h3>
          <p className="text-slate-400 text-sm">No call queues are currently configured. Create queues from the Call Queues page first.</p>
        </div>
      )}

      {/* Content */}
      {!isLoading && !isError && queues.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <PhoneIncoming className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{totalWaiting}</p>
                <p className="text-xs text-slate-400 font-medium">Total Waiting</p>
              </div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <Headphones className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{totalAgents}</p>
                <p className="text-xs text-slate-400 font-medium">Total Agents</p>
              </div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <PhoneCall className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white truncate max-w-[140px]">{busiest?.name ?? '—'}</p>
                <p className="text-xs text-slate-400 font-medium">Busiest Queue ({busiest?.waiting ?? 0} waiting)</p>
              </div>
            </div>
          </div>

          {/* Queue tabs */}
          <div className="flex gap-1 bg-slate-800/50 backdrop-blur-xl rounded-xl border border-slate-700/50 p-1 overflow-x-auto hide-scrollbar">
            {queues.map((q) => {
              const waitCount = q.waiting ?? q.calls?.length ?? 0;
              return (
                <button
                  key={q.name}
                  onClick={() => setActiveTab(q.name)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                    currentTab === q.name
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
                  }`}
                >
                  {q.name}
                  {waitCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">
                      {waitCount}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">({q.agents?.length ?? 0} agents)</span>
                </button>
              );
            })}
          </div>

          {/* Per-queue content */}
          {activeQueue && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Waiting Calls */}
              <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <PhoneIncoming className="w-5 h-5 text-amber-400" />
                  <h3 className="text-base font-bold text-white">Waiting Calls</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold ml-auto">
                    {activeQueue.calls?.length ?? activeQueue.waiting ?? 0}
                  </span>
                </div>
                {(!activeQueue.calls || activeQueue.calls.length === 0) ? (
                  <div className="text-center py-10">
                    <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 font-medium">No calls waiting</p>
                    <p className="text-xs text-slate-600 mt-1">Callers will appear here in real time</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-700/40">
                          <th className="pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">#</th>
                          <th className="pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Caller ID</th>
                          <th className="pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Wait Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/20">
                        {activeQueue.calls.map((call, idx) => (
                          <tr key={call.channel || idx} className="hover:bg-slate-700/10 transition-colors">
                            <td className="py-2.5 text-xs text-slate-500 font-mono">{call.position ?? idx + 1}</td>
                            <td className="py-2.5 text-sm text-white font-mono">{call.callerId || '—'}</td>
                            <td className="py-2.5 text-sm text-amber-400 font-semibold">{formatWait(call.waitTime)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Agents */}
              <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Headphones className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-base font-bold text-white">Agents</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold ml-auto">
                    {activeQueue.agents?.length ?? 0}
                  </span>
                </div>
                {(!activeQueue.agents || activeQueue.agents.length === 0) ? (
                  <div className="text-center py-10">
                    <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 font-medium">No agents assigned</p>
                    <p className="text-xs text-slate-600 mt-1">Add agents from the Call Queues page</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-700/40">
                          <th className="pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Agent</th>
                          <th className="pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Status</th>
                          <th className="pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Calls</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/20">
                        {activeQueue.agents.map((agent) => (
                          <tr key={agent.extension || agent.name} className="hover:bg-slate-700/10 transition-colors">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm text-white font-medium truncate">{agent.name || `Agent ${agent.extension}`}</p>
                                  <p className="text-xs text-slate-500 font-mono">{agent.extension}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5">{statusChip(agent.status, agent.state)}</td>
                            <td className="py-2.5 text-sm text-slate-300 font-semibold text-right">{agent.callsTaken ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
