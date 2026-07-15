import React, { useEffect, useState } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import {
  Activity, Users, Phone, Clock, RefreshCw,
  Headphones, UserCheck, Coffee, WifiOff, PhoneCall
} from 'lucide-react';

interface AgentStatus {
  extension: string;
  name: string;
  status: 'Available' | 'On Break' | 'On Call' | 'Offline';
  state: string;
  ccStatus: string;
  callsTaken: number;
  talkTime: number;
  lastCall?: string;
  interface: string;
}

interface CallStatus {
  position: number;
  callerId: string;
  callerIdName: string;
  waitTime: string;
  channel: string;
}

interface QueueStatus {
  name: string;
  waiting: number;
  agents: AgentStatus[];
  calls: CallStatus[];
}

const STATUS_CONFIG = {
  Available: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400', icon: UserCheck },
  'On Call':  { dot: 'bg-blue-400',   badge: 'bg-blue-500/15 text-blue-400',   icon: PhoneCall },
  'On Break': { dot: 'bg-amber-400',  badge: 'bg-amber-500/15 text-amber-400', icon: Coffee },
  Offline:    { dot: 'bg-slate-500',  badge: 'bg-slate-700 text-slate-400',    icon: WifiOff },
} as const;

function secondsToHms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function QueueMonitorPage() {
  const [queues, setQueues] = useState<QueueStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [settingStatus, setSettingStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const res = await adminApi('/queue-monitor');
      const data = await res.json();
      if (data.success) {
        setQueues(data.queues);
        setSelectedQueue(prev => prev ?? (data.queues[0]?.name ?? null));
      }
    } catch (err) {
      console.error('Failed to fetch queue status:', err);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  };

  const setAgentStatus = async (extension: string, status: 'Available' | 'On Break') => {
    setSettingStatus(extension);
    try {
      await adminApi(`/queue-monitor/agent/${extension}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await fetchData();
    } catch {}
    setSettingStatus(null);
  };

  const activeQueue = queues.find(q => q.name === selectedQueue);
  const totalWaiting = queues.reduce((sum, q) => sum + (q.waiting || 0), 0);
  const totalAgents = queues.reduce((sum, q) => sum + (q.agents?.length || 0), 0);
  const availableAgents = queues.reduce((sum, q) => sum + (q.agents?.filter(a => a.status === 'Available').length || 0), 0);
  const onCallAgents = queues.reduce((sum, q) => sum + (q.agents?.filter(a => a.status === 'On Call').length || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading queue status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="w-6 h-6 text-emerald-400" />
            Live Queue Monitor
          </h1>
          <p className="text-slate-400 text-sm mt-1">Real-time call center status · auto-refreshes every 5s</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Updated {lastRefresh.toLocaleTimeString()}</span>
          <button onClick={fetchData}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Calls Waiting', value: totalWaiting, color: 'amber', Icon: Phone },
          { label: 'Available',     value: availableAgents, color: 'emerald', Icon: UserCheck },
          { label: 'On Call',       value: onCallAgents,    color: 'blue',    Icon: PhoneCall },
          { label: 'Active Queues', value: queues.length,   color: 'purple',  Icon: Headphones },
        ].map(({ label, value, color, Icon }) => (
          <div key={label} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-${color}-500/20 flex items-center justify-center`}>
                <Icon className={`w-5 h-5 text-${color}-400`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-xs text-slate-400">{label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Queue Tabs */}
      {queues.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {queues.map(queue => (
            <button key={queue.name} onClick={() => setSelectedQueue(queue.name)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                selectedQueue === queue.name
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
              }`}>
              {queue.name}
              {queue.waiting > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs">
                  {queue.waiting}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {activeQueue ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Waiting Calls */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <div className="px-4 py-3 border-b border-slate-700/50">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Phone className="w-4 h-4 text-amber-400" />
                Waiting Calls
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                  {activeQueue.waiting}
                </span>
              </h3>
            </div>
            <div className="divide-y divide-slate-700/30">
              {activeQueue.calls.length === 0 ? (
                <div className="px-4 py-10 text-center text-slate-500">
                  <Phone className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No calls waiting</p>
                </div>
              ) : (
                activeQueue.calls.map((call) => (
                  <div key={call.position} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium flex items-center justify-center">
                        {call.position}
                      </span>
                      <div>
                        <p className="text-white text-sm font-medium">{call.callerId}</p>
                        {call.callerIdName && <p className="text-xs text-slate-500">{call.callerIdName}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-amber-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-sm font-mono">{call.waitTime}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Agent Status */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <div className="px-4 py-3 border-b border-slate-700/50">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                Agents
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                  {activeQueue.agents.length}
                </span>
              </h3>
            </div>
            <div className="divide-y divide-slate-700/30 max-h-96 overflow-y-auto">
              {activeQueue.agents.length === 0 ? (
                <div className="px-4 py-10 text-center text-slate-500">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No agents assigned</p>
                </div>
              ) : (
                activeQueue.agents.map((agent) => {
                  const cfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.Offline;
                  return (
                    <div key={agent.extension} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ${agent.status === 'Available' ? 'animate-pulse' : ''}`} />
                          <div>
                            <p className="text-white text-sm font-medium">Ext {agent.extension}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.badge}`}>
                                {agent.status}
                              </span>
                              {agent.callsTaken > 0 && (
                                <span className="text-xs text-slate-500">{agent.callsTaken} calls</span>
                              )}
                              {agent.talkTime > 0 && (
                                <span className="text-xs text-slate-500">{secondsToHms(agent.talkTime)} talk</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {agent.lastCall && (
                            <span className="text-xs text-slate-500">Last: {agent.lastCall}</span>
                          )}
                          {/* Status toggle buttons (only when agent is registered) */}
                          {agent.status !== 'Offline' && agent.status !== 'On Call' && (
                            <div className="flex gap-1">
                              {agent.status === 'On Break' ? (
                                <button
                                  disabled={settingStatus === agent.extension}
                                  onClick={() => setAgentStatus(agent.extension, 'Available')}
                                  className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 transition-all">
                                  {settingStatus === agent.extension ? '...' : 'Set Available'}
                                </button>
                              ) : (
                                <button
                                  disabled={settingStatus === agent.extension}
                                  onClick={() => setAgentStatus(agent.extension, 'On Break')}
                                  className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 transition-all">
                                  {settingStatus === agent.extension ? '...' : 'Set Break'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No queues configured</p>
        </div>
      )}
    </div>
  );
}
