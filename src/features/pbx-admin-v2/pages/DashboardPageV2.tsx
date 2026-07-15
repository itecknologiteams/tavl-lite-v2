import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  getSystemStatus, getExtensions, getTrunks, getQueues,
} from '../api';
import {
  PhoneCall, Users, Network, Headphones, Server, RefreshCw,
  ArrowRight, Loader2, AlertCircle,
} from 'lucide-react';
import type { Trunk, Queue, Extension, SystemStatus } from '../types';

const STALE = 30_000;

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-slate-700/50 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
        online ? 'bg-emerald-400' : 'bg-red-400'
      }`}
    />
  );
}

function TrunkStatusBadge({ state }: { state?: string }) {
  const s = (state || '').toUpperCase();
  if (s.includes('REGED') || s.includes('REGISTERED')) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Registered
      </span>
    );
  }
  if (s.includes('FAILED') || s.includes('ERROR')) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      {state || 'Unknown'}
    </span>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  colorClass: string;
  onClick?: () => void;
}

function MetricCard({ title, value, subtitle, icon: Icon, colorClass, onClick }: MetricCardProps) {
  return (
    <button
      onClick={onClick}
      className={`lg-card p-6 rounded-2xl text-left w-full transition-all hover:scale-[1.02] ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`p-2.5 rounded-xl border ${colorClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        {onClick && <ArrowRight className="w-4 h-4 text-slate-600 mt-0.5" />}
      </div>
      <p className="text-3xl font-bold text-white tracking-tight mb-1">{value}</p>
      <p className="text-sm font-semibold text-slate-300">{title}</p>
      <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
    </button>
  );
}

export function DashboardPageV2() {
  const navigate = useNavigate();

  const statusQ = useQuery<SystemStatus>({
    queryKey: ['system-status-v2'],
    queryFn: getSystemStatus,
    staleTime: STALE,
    refetchInterval: STALE,
  });

  const extensionsQ = useQuery<Extension[]>({
    queryKey: ['extensions-v2'],
    queryFn: getExtensions,
    staleTime: STALE,
    refetchInterval: STALE,
  });

  const trunksQ = useQuery<Trunk[]>({
    queryKey: ['trunks-v2'],
    queryFn: getTrunks,
    staleTime: STALE,
    refetchInterval: STALE,
  });

  const queuesQ = useQuery<Queue[]>({
    queryKey: ['queues-v2'],
    queryFn: getQueues,
    staleTime: STALE,
    refetchInterval: STALE,
  });

  const extensions = extensionsQ.data || [];
  const trunks = trunksQ.data || [];
  const queues = queuesQ.data || [];
  const status = statusQ.data;

  const systemOnline = !statusQ.isError;
  const onlineExtensions = extensions.filter((e) => e.registered).length;
  const registeredTrunks = trunks.filter(
    (t) =>
      (t.state || '').toUpperCase().includes('REGED') ||
      (t.state || '').toUpperCase().includes('REGISTERED'),
  ).length;

  const lastRefresh = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">FreeSWITCH Dashboard</h1>
          <p className="text-slate-400 mt-1 font-medium">Real-time system overview and statistics</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/50">
            <RefreshCw className="w-3 h-3 text-slate-500" />
            <span className="text-xs text-slate-500">Refreshed {lastRefresh}</span>
          </div>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              systemOnline
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                systemOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
              }`}
            />
            <span
              className={`text-xs font-semibold ${
                systemOnline ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {systemOnline ? 'System Online' : 'System Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <MetricCard
          icon={PhoneCall}
          title="Active Calls"
          value={status?.activeCalls ?? '—'}
          subtitle="Concurrent call sessions"
          colorClass="text-blue-400 bg-blue-500/10 border-blue-500/20"
          onClick={() => navigate('/pbx-admin-v2/cdr')}
        />
        <MetricCard
          icon={Users}
          title="Extensions Online"
          value={extensionsQ.isLoading ? '…' : `${onlineExtensions} / ${extensions.length}`}
          subtitle="Registered SIP endpoints"
          colorClass="text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
          onClick={() => navigate('/pbx-admin-v2/extensions')}
        />
        <MetricCard
          icon={Network}
          title="Trunks Available"
          value={trunksQ.isLoading ? '…' : `${registeredTrunks} / ${trunks.length}`}
          subtitle="Registered SIP gateways"
          colorClass="text-teal-400 bg-teal-500/10 border-teal-500/20"
          onClick={() => navigate('/pbx-admin-v2/trunks')}
        />
        <MetricCard
          icon={Headphones}
          title="Call Queues"
          value={queuesQ.isLoading ? '…' : queues.length}
          subtitle="Active agent groups"
          colorClass="text-violet-400 bg-violet-500/10 border-violet-500/20"
          onClick={() => navigate('/pbx-admin-v2/queues')}
        />
      </div>

      {/* Two-column panels */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Trunk Status */}
        <div className="lg-card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/40">
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">Trunk Status</h2>
            <button
              onClick={() => navigate('/pbx-admin-v2/trunks')}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/30">
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Profile</th>
                <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">In/Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/20">
              {trunksQ.isLoading &&
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
              {trunksQ.isError && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-red-400">Failed to load trunks</p>
                  </td>
                </tr>
              )}
              {!trunksQ.isLoading &&
                !trunksQ.isError &&
                trunks.slice(0, 8).map((trunk) => (
                  <tr key={trunk.name} className="hover:bg-slate-700/10 transition-colors">
                    <td className="px-4 py-3 text-sm text-white font-medium truncate max-w-[120px]">
                      {trunk.name}
                    </td>
                    <td className="px-4 py-3">
                      <TrunkStatusBadge state={trunk.state} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 hidden sm:table-cell">
                      {trunk.profile || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400 hidden md:table-cell">
                      {trunk.callsIn ?? 0} / {trunk.callsOut ?? 0}
                    </td>
                  </tr>
                ))}
              {!trunksQ.isLoading && !trunksQ.isError && trunks.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                    No trunks configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Queue Overview */}
        <div className="lg-card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/40">
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">Queue Overview</h2>
            <button
              onClick={() => navigate('/pbx-admin-v2/queues')}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/30">
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Strategy</th>
                <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Waiting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/20">
              {queuesQ.isLoading &&
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={3} />)}
              {queuesQ.isError && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-red-400">Failed to load queues</p>
                  </td>
                </tr>
              )}
              {!queuesQ.isLoading &&
                !queuesQ.isError &&
                queues.slice(0, 8).map((queue) => (
                  <tr key={queue.name} className="hover:bg-slate-700/10 transition-colors">
                    <td className="px-4 py-3 text-sm text-white font-medium">{queue.name}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 font-semibold">
                        {queue.strategy}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-slate-300">
                      {queue.waiting ?? 0}
                    </td>
                  </tr>
                ))}
              {!queuesQ.isLoading && !queuesQ.isError && queues.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">
                    No queues configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Extensions */}
      <div className="lg-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/40">
          <h2 className="text-sm font-bold text-white tracking-wide uppercase">Recent Extensions</h2>
          <button
            onClick={() => navigate('/pbx-admin-v2/extensions')}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/30">
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-8" />
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Extension</th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Caller ID Name</th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Registration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/20">
              {extensionsQ.isLoading &&
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
              {extensionsQ.isError && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-red-400">Failed to load extensions</p>
                  </td>
                </tr>
              )}
              {!extensionsQ.isLoading &&
                !extensionsQ.isError &&
                extensions.slice(0, 10).map((ext) => (
                  <tr key={ext.id} className="hover:bg-slate-700/10 transition-colors">
                    <td className="px-4 py-3">
                      <StatusDot online={ext.registered} />
                    </td>
                    <td className="px-4 py-3 text-sm text-white font-mono font-semibold">
                      {ext.extension}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300 hidden sm:table-cell">
                      {ext.callerIdName || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                          ext.registered
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-slate-700/50 text-slate-400 border-slate-600/40'
                        }`}
                      >
                        {ext.registered ? 'Registered' : 'Offline'}
                      </span>
                    </td>
                  </tr>
                ))}
              {!extensionsQ.isLoading && !extensionsQ.isError && extensions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                    No extensions configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* System Info */}
      <div className="lg-card rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-xl bg-slate-700/40 border border-slate-600/40">
            <Server className="w-5 h-5 text-slate-400" />
          </div>
          <h2 className="text-sm font-bold text-white tracking-wide uppercase">System Information</h2>
        </div>

        {statusQ.isLoading && (
          <div className="flex items-center gap-3 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading system status…</span>
          </div>
        )}
        {statusQ.isError && (
          <div className="flex items-center gap-3 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Unable to retrieve system status</span>
          </div>
        )}
        {status && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Host', value: status.host || '—' },
              { label: 'Version', value: status.version || '—' },
              { label: 'Uptime', value: status.uptime || '—' },
              { label: 'Peak Sessions', value: status.peakSessions ?? '—' },
              { label: 'Max Sessions', value: status.maxSessions ?? '—' },
              { label: 'Last Reload', value: status.lastReload || '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-900/40 rounded-xl p-3 border border-slate-700/30">
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">
                  {label}
                </p>
                <p className="text-sm text-white font-semibold truncate" title={String(value)}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
