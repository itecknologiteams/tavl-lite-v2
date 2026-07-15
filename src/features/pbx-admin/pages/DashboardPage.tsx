import React, { useEffect, useState } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import { useNavigate } from 'react-router-dom';
import {
  Users, Network, PhoneCall, AlertCircle,
  RefreshCw, ArrowRight, Wifi, Headphones, Zap,
} from 'lucide-react';

interface SystemStatus {
  version: string;
  uptime: string;
  lastReload?: string;
  activeCalls: number;
  peakSessions?: number;
  maxSessions?: number;
  registeredEndpoints: number;
  host: string;
}

export function DashboardPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [extensions, setExtensions] = useState<any[]>([]);
  const [trunks, setTrunks] = useState<any[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const safeFetch = async (endpoint: string): Promise<any> => {
    try {
      const res = await adminApi(endpoint);
      const text = await res.text();
      if (!text) return { success: false, error: 'Empty response' };
      return JSON.parse(text);
    } catch (err: any) {
      console.warn(`Dashboard: ${endpoint} failed:`, err.message);
      return { success: false, error: err.message };
    }
  };

  const fetchData = async () => {
    try {
      setError(null);

      const [statusData, extData, trunkData, queueData] = await Promise.all([
        safeFetch('/system/status'),
        safeFetch('/extensions'),
        safeFetch('/trunks'),
        safeFetch('/queues'),
      ]);

      if (statusData.success && statusData.status) setStatus(statusData.status);
      if (extData.success) setExtensions(extData.extensions || []);
      if (trunkData.success) setTrunks(trunkData.trunks || []);
      if (queueData.success) setQueues(queueData.queues || []);

      // Only show error if system status specifically failed
      if (!statusData.success) {
        setError(statusData.error || 'Unable to reach FreeSWITCH');
      }

      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to connect to FreeSWITCH');
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const registeredCount = extensions.filter(e => e.status === 'registered').length;
  const offlineCount = extensions.length - registeredCount;
  const availableTrunks = trunks.filter(t => t.qualifyStatus === 'available').length;
  const totalQueueCalls = queues.reduce((sum, q) => sum + (q.calls || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Connecting to FreeSWITCH...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time overview of your FreeSWITCH PBX system</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Updated {lastRefresh.toLocaleTimeString()}</span>
          <button onClick={fetchData}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* System Health Banner */}
      <div className={`p-4 rounded-xl border flex items-center gap-4 ${
        status ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'
      }`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          status ? 'bg-emerald-500/15' : 'bg-red-500/15'
        }`}>
          <Zap className={`w-5 h-5 ${status ? 'text-emerald-400' : 'text-red-400'}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <span className={`text-sm font-medium ${status ? 'text-emerald-300' : 'text-red-300'}`}>
              {status ? 'System Online' : 'System Unreachable'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {status
              ? `FreeSWITCH running on ${status.host} — Uptime: ${status.uptime}`
              : 'Unable to connect to FreeSWITCH server'}
          </p>
        </div>
        {status && (
          <span className="text-xs text-slate-500 bg-slate-700/40 px-2.5 py-1 rounded-lg">
            {status.version?.split(' ').slice(0, 2).join(' ') || 'Unknown version'}
          </span>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Calls" value={status?.activeCalls || 0}
          icon={PhoneCall} color="amber" />
        <MetricCard
          label="Extensions Online" value={registeredCount} total={extensions.length}
          icon={Wifi} color="emerald"
          onClick={() => navigate('/pbx-admin/extensions')} />
        <MetricCard
          label="Trunks Available" value={availableTrunks} total={trunks.length}
          icon={Network} color="blue"
          onClick={() => navigate('/pbx-admin/trunks')} />
        <MetricCard
          label="Queued Calls" value={totalQueueCalls}
          icon={Headphones} color="violet"
          onClick={() => navigate('/pbx-admin/queues')} />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trunk Status */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/30">
            <div className="flex items-center gap-3">
              <Network className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-white">Trunk Status</span>
            </div>
            <button onClick={() => navigate('/pbx-admin/trunks')}
              className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition-colors">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="p-4 space-y-2">
            {trunks.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No trunks configured</p>
            ) : (
              trunks.map(trunk => {
                const isUp = trunk.qualifyStatus === 'available';
                const isUnknown = trunk.qualifyStatus === 'unknown';
                const isDisabled = trunk.fsState === 'DISABLED' || trunk.enabled === false;
                const dotColor = isUp ? 'bg-emerald-400'
                  : isDisabled ? 'bg-slate-500'
                  : isUnknown ? 'bg-amber-400 animate-pulse'
                  : 'bg-red-400';
                const badgeClass = isUp
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : isDisabled ? 'bg-slate-500/10 text-slate-400'
                  : isUnknown ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-red-500/10 text-red-400';
                const label = trunk.fsState || (isUp ? 'REGED' : isUnknown ? 'TRYING' : 'DOWN');
                return (
                  <div key={trunk.name} className="flex items-center justify-between p-3 bg-slate-700/20 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                      <div>
                        <p className="text-sm text-white font-medium">{trunk.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{trunk.host}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>
                      {label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Queue Summary */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/30">
            <div className="flex items-center gap-3">
              <Headphones className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold text-white">Queue Summary</span>
            </div>
            <button onClick={() => navigate('/pbx-admin/queues')}
              className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition-colors">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="p-4 space-y-2">
            {queues.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No queues configured</p>
            ) : (
              queues.map(queue => (
                <div key={queue.name} className="flex items-center justify-between p-3 bg-slate-700/20 rounded-lg">
                  <div>
                    <p className="text-sm text-white font-medium">{queue.name}</p>
                    <p className="text-xs text-slate-500">
                      {queue.params?.strategy || 'ringall'} — <span className={queue.availableMembers ? 'text-emerald-400' : 'text-slate-500'}>{queue.availableMembers ?? 0}</span> / {queue.memberCount || queue.members?.length || 0} agents online
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="text-center">
                      <p className="text-white font-medium">{queue.calls || 0}</p>
                      <p className="text-slate-500">Waiting</p>
                    </div>
                    <div className="text-center">
                      <p className="text-emerald-400 font-medium">{queue.completed || 0}</p>
                      <p className="text-slate-500">Done</p>
                    </div>
                    <div className="text-center">
                      <p className="text-red-400 font-medium">{queue.abandoned || 0}</p>
                      <p className="text-slate-500">Drop</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Extension Status Overview */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/30">
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-white">Extension Status</span>
            <span className="text-xs text-slate-500 bg-slate-700/40 px-2 py-0.5 rounded">{extensions.length} total</span>
          </div>
          <button onClick={() => navigate('/pbx-admin/extensions')}
            className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition-colors">
            View All <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="px-5 py-3 border-b border-slate-700/30">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-emerald-500" />
              <span className="text-slate-400">Online ({registeredCount})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-slate-600" />
              <span className="text-slate-400">Offline ({offlineCount})</span>
            </div>
          </div>
          {extensions.length > 0 && (
            <div className="mt-2 h-2 bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${(registeredCount / extensions.length) * 100}%` }} />
            </div>
          )}
        </div>

        {/* Recent Extensions */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/30">
                <th className="text-left py-2.5 px-5 text-slate-500 text-xs font-medium">Extension</th>
                <th className="text-left py-2.5 px-5 text-slate-500 text-xs font-medium">Name</th>
                <th className="text-left py-2.5 px-5 text-slate-500 text-xs font-medium">Status</th>
                <th className="text-left py-2.5 px-5 text-slate-500 text-xs font-medium">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/20">
              {extensions.slice(0, 8).map(ext => (
                <tr key={ext.extension} className="hover:bg-slate-700/10">
                  <td className="py-2.5 px-5 text-sm text-white font-medium">{ext.extension}</td>
                  <td className="py-2.5 px-5 text-sm text-slate-300">
                    {ext.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || '-'}
                  </td>
                  <td className="py-2.5 px-5">
                    <span className={`inline-flex items-center gap-1 text-xs ${
                      ext.status === 'registered' ? 'text-emerald-400' : 'text-slate-500'
                    }`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        ext.status === 'registered' ? 'bg-emerald-400' : 'bg-slate-500'
                      }`} />
                      {ext.status === 'registered' ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="py-2.5 px-5 text-xs text-slate-500">{ext.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {extensions.length > 8 && (
          <div className="px-5 py-3 border-t border-slate-700/30 text-center">
            <button onClick={() => navigate('/pbx-admin/extensions')}
              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
              View all {extensions.length} extensions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, total, icon: Icon, color, onClick }: {
  label: string; value: number; total?: number; icon: any; color: string; onClick?: () => void;
}) {
  const colors: Record<string, { bg: string; text: string; iconBg: string }> = {
    amber: { bg: 'bg-amber-500/5', text: 'text-amber-400', iconBg: 'bg-amber-500/10' },
    emerald: { bg: 'bg-emerald-500/5', text: 'text-emerald-400', iconBg: 'bg-emerald-500/10' },
    blue: { bg: 'bg-blue-500/5', text: 'text-blue-400', iconBg: 'bg-blue-500/10' },
    violet: { bg: 'bg-violet-500/5', text: 'text-violet-400', iconBg: 'bg-violet-500/10' },
  };
  const c = colors[color] || colors.blue;

  const content = (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${c.iconBg} flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${c.text}`} />
        </div>
        {onClick && <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-white">{value}</span>
        {total !== undefined && <span className="text-sm text-slate-500">/ {total}</span>}
      </div>
      <p className="text-xs text-slate-400 mt-1">{label}</p>
    </>
  );

  const className = `${c.bg} border border-slate-700/50 rounded-xl p-5 text-left ${onClick ? 'hover:border-slate-600/50 cursor-pointer' : ''} transition-all group`;

  return onClick ? (
    <button onClick={onClick} className={className}>{content}</button>
  ) : (
    <div className={className}>{content}</div>
  );
}
