/**
 * Live Distribution Monitor — Apple Liquid Glass Edition
 *
 * Real-time visualization proving the distribution engine is alive and
 * that supervisor rule changes are taking effect.
 *
 * Layout: Engine Heartbeat → Agent Load Gauges | Analytics | Activity Feed
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Users,
  Zap,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowUpCircle,
  RefreshCw,
  Coffee,
  TrendingUp,
  BarChart3,
  Radio,
  Shield,
  Bell,
  Timer,
  Gauge,
  HeartPulse,
  Cpu,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAlertDistributionStore, AgentSession, DistributionRule } from '@store/alertDistributionStore';
import { api } from '@services/api';
import { formatDistanceToNowStrict } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────
interface ActivityEvent {
  id: number;
  alert_id: string;
  action: string;
  performed_by: string;
  details: any;
  handling_time_seconds: number | null;
  performed_at: string;
  alert_type: string | null;
  vehicle_reg: string | null;
  customer_name: string | null;
  assigned_to: string | null;
  priority: number | null;
  current_status: string | null;
}

interface AnalyticsData {
  hourlyDistribution: { hour: number; count: string }[];
  typeBreakdown: { alert_type: string; status: string; count: string }[];
  responseTimes: { alert_type: string; avg_ack_seconds: string; avg_resolve_seconds: string; total: string }[];
  days: number;
}

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 };
const FADE_UP = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING } };

// ─── SVG Gradient Defs (reused across gauges) ─────────────────────
function GaugeDefs() {
  return (
    <defs>
      <linearGradient id="gauge-emerald" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#34d399" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
      <linearGradient id="gauge-blue" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="100%" stopColor="#3b82f6" />
      </linearGradient>
      <linearGradient id="gauge-amber" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
      <linearGradient id="gauge-red" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f87171" />
        <stop offset="100%" stopColor="#ef4444" />
      </linearGradient>
      <linearGradient id="gauge-slate" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#475569" />
        <stop offset="100%" stopColor="#334155" />
      </linearGradient>
      <filter id="gauge-glow">
        <feGaussianBlur stdDeviation="2.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

// ─── Agent Load Gauge — Glowing Arc ───────────────────────────────
function AgentGauge({ agent }: { agent: AgentSession }) {
  const current = agent.current_alert_count;
  const max = agent.max_alerts || 5;
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isOnline = agent.status === 'online';
  const isOnBreak = agent.status === 'on_break' || agent.status === 'break_requested';

  const color = !isOnline ? 'slate' : pct >= 90 ? 'red' : pct >= 70 ? 'amber' : pct >= 40 ? 'blue' : 'emerald';

  const glowColors: Record<string, string> = {
    emerald: 'rgba(52,211,153,0.25)', blue: 'rgba(96,165,250,0.25)',
    amber: 'rgba(251,191,36,0.25)',   red: 'rgba(248,113,113,0.3)',
    slate: 'rgba(71,85,105,0.1)',
  };
  const textColors: Record<string, string> = {
    emerald: 'text-emerald-400', blue: 'text-blue-400',
    amber: 'text-amber-400',     red: 'text-red-400',
    slate: 'text-slate-500',
  };

  const R = 28;
  const C = 2 * Math.PI * R;
  const dash = C - (pct / 100) * C;

  return (
    <motion.div
      layout
      {...FADE_UP}
      whileHover={{ scale: 1.04, transition: { duration: 0.2 } }}
      className="lg-card relative flex flex-col items-center p-3 rounded-2xl overflow-hidden cursor-default"
      style={{ boxShadow: `0 0 20px ${glowColors[color]}, var(--lg-shadow)` }}
    >
      {isOnBreak && (
        <div className="absolute top-2 right-2 z-10">
          <Coffee className="w-3 h-3 text-amber-400 animate-pulse" />
        </div>
      )}

      <div className="relative w-16 h-16">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <GaugeDefs />
          <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4.5" />
          <circle
            cx="32" cy="32" r={R}
            fill="none"
            stroke={`url(#gauge-${color})`}
            strokeWidth="4.5"
            strokeLinecap="round"
            filter={pct > 0 ? 'url(#gauge-glow)' : undefined}
            style={{
              strokeDasharray: C,
              strokeDashoffset: dash,
              transition: 'stroke-dashoffset 1s cubic-bezier(0.25,1,0.5,1)',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-sm font-bold tabular-nums ${textColors[color]}`}>{current}</span>
          <span className="text-[8px] text-white/25 font-medium">/{max}</span>
        </div>
      </div>

      <div className="mt-1.5 text-center min-w-0 w-full relative z-10">
        <div className="text-[11px] font-semibold text-white/85 truncate">{agent.username}</div>
        <div className={`text-[9px] font-medium ${isOnline ? 'text-emerald-400' : isOnBreak ? 'text-amber-400' : 'text-slate-500'}`}>
          {isOnline ? 'Online' : isOnBreak ? 'Break' : 'Offline'}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Agent Compact Row (9-20 agents) ──────────────────────────────
function AgentCompactRow({ agent }: { agent: AgentSession }) {
  const current = agent.current_alert_count;
  const max = agent.max_alerts || 5;
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isOnline = agent.status === 'online';
  const isOnBreak = agent.status === 'on_break' || agent.status === 'break_requested';

  const color = !isOnline ? 'slate' : pct >= 90 ? 'red' : pct >= 70 ? 'amber' : pct >= 40 ? 'blue' : 'emerald';
  const barGradients: Record<string, string> = {
    emerald: 'linear-gradient(to right, #10b981, #34d399)',
    blue:    'linear-gradient(to right, #3b82f6, #60a5fa)',
    amber:   'linear-gradient(to right, #f59e0b, #fbbf24)',
    red:     'linear-gradient(to right, #ef4444, #f87171)',
    slate:   'linear-gradient(to right, #334155, #475569)',
  };
  const textColors: Record<string, string> = {
    emerald: 'text-emerald-400', blue: 'text-blue-400',
    amber: 'text-amber-400', red: 'text-red-400', slate: 'text-slate-500',
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors group"
    >
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        isOnline ? 'bg-emerald-400 shadow-sm shadow-emerald-400/30' : isOnBreak ? 'bg-amber-400' : 'bg-slate-600'
      }`} />
      <span className="text-[11px] text-white/70 truncate w-20 flex-shrink-0 font-medium">{agent.username}</span>
      {isOnBreak && <Coffee className="w-3 h-3 text-amber-400/60 flex-shrink-0" />}
      <div className="flex-1 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1] }}
          style={{ background: barGradients[color] }}
        />
      </div>
      <span className={`text-[10px] font-bold tabular-nums w-8 text-right flex-shrink-0 ${textColors[color]}`}>
        {current}/{max}
      </span>
    </motion.div>
  );
}

// ─── Agent Heatmap Strip (20+ agents) ─────────────────────────────
function AgentHeatmapSummary({ agents, label }: { agents: AgentSession[]; label: string }) {
  const sorted = useMemo(() =>
    [...agents].sort((a, b) => {
      const pctA = (a.max_alerts || 5) > 0 ? a.current_alert_count / (a.max_alerts || 5) : 0;
      const pctB = (b.max_alerts || 5) > 0 ? b.current_alert_count / (b.max_alerts || 5) : 0;
      return pctB - pctA;
    }),
  [agents]);

  const atCapacity = sorted.filter(a => a.current_alert_count >= (a.max_alerts || 5)).length;
  const available = sorted.filter(a => a.current_alert_count === 0).length;

  const [expanded, setExpanded] = useState(false);
  const displayList = expanded ? sorted : sorted.slice(0, 12);

  if (agents.length === 0) return null;

  return (
    <div>
      {/* Heatmap strip */}
      <div className="lg-card rounded-2xl p-3 overflow-hidden relative">
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] uppercase tracking-widest text-white/15 font-bold">{label}</span>
            <span className="text-[10px] text-white/30 tabular-nums">{agents.length}</span>
          </div>

          {/* Heatmap grid */}
          <div className="flex flex-wrap gap-[3px] mb-2">
            {sorted.map((a) => {
              const pct = (a.max_alerts || 5) > 0 ? Math.min(a.current_alert_count / (a.max_alerts || 5), 1) : 0;
              const hue = pct >= 0.9 ? '#ef4444' : pct >= 0.7 ? '#f59e0b' : pct >= 0.4 ? '#3b82f6' : pct > 0 ? '#10b981' : 'rgba(255,255,255,0.04)';
              return (
                <div
                  key={a.user_id}
                  className="w-3 h-3 rounded-[3px] transition-all hover:scale-150 cursor-default"
                  style={{
                    background: hue,
                    opacity: pct > 0 ? 0.4 + pct * 0.6 : 0.3,
                    boxShadow: pct >= 0.9 ? `0 0 6px ${hue}40` : 'none',
                  }}
                  title={`${a.username}: ${a.current_alert_count}/${a.max_alerts || 5} (${Math.round(pct * 100)}%)`}
                />
              );
            })}
          </div>

          {/* Summary chips */}
          <div className="flex items-center gap-3 text-[9px]">
            {atCapacity > 0 && (
              <span className="text-red-400 font-semibold">{atCapacity} at capacity</span>
            )}
            {available > 0 && (
              <span className="text-emerald-400/60">{available} available</span>
            )}
            <span className="text-white/15">{agents.length - atCapacity - available} active</span>
          </div>
        </div>
      </div>

      {/* Expandable compact list */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full mt-1 flex items-center justify-center gap-1 py-1 text-[9px] text-white/20 hover:text-white/40 transition-colors"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Collapse' : `Show all ${agents.length}`}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
            className="overflow-hidden"
          >
            <div className="lg-card rounded-2xl overflow-hidden relative mt-1">
              <div className="relative z-10 max-h-[240px] overflow-y-auto custom-scrollbar py-1">
                {sorted.map((a) => <AgentCompactRow key={a.user_id} agent={a} />)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Adaptive Agent Section ───────────────────────────────────────
const GAUGE_THRESHOLD = 8;
const COMPACT_THRESHOLD = 20;

function AdaptiveAgentSection({ agents, label }: { agents: AgentSession[]; label: string }) {
  if (agents.length === 0) return null;

  const totalCount = agents.length;

  if (totalCount <= GAUGE_THRESHOLD) {
    return (
      <div>
        <div className="text-[9px] uppercase tracking-widest text-white/15 font-bold mb-2 px-1">{label}</div>
        <div className="grid grid-cols-2 gap-2">
          {agents.map((a) => <AgentGauge key={a.user_id} agent={a} />)}
        </div>
      </div>
    );
  }

  if (totalCount <= COMPACT_THRESHOLD) {
    return (
      <div>
        <div className="text-[9px] uppercase tracking-widest text-white/15 font-bold mb-2 px-1">
          {label} <span className="text-white/10 ml-1">({totalCount})</span>
        </div>
        <div className="lg-card rounded-2xl overflow-hidden relative">
          <div className="relative z-10 max-h-[300px] overflow-y-auto custom-scrollbar py-1">
            {agents.map((a) => <AgentCompactRow key={a.user_id} agent={a} />)}
          </div>
        </div>
      </div>
    );
  }

  return <AgentHeatmapSummary agents={agents} label={label} />;
}

// ─── Engine Heartbeat ─────────────────────────────────────────────
function EngineHeartbeat({ lastRefresh, systemPct, autoRefresh }: { lastRefresh: Date | null; systemPct: number; autoRefresh: boolean }) {
  const [beat, setBeat] = useState(false);

  useEffect(() => {
    if (!lastRefresh) return;
    setBeat(true);
    const t = setTimeout(() => setBeat(false), 600);
    return () => clearTimeout(t);
  }, [lastRefresh]);

  const statusColor = systemPct < 50 ? 'emerald' : systemPct < 80 ? 'amber' : 'red';
  const colors: Record<string, { dot: string; glow: string; text: string; ring: string }> = {
    emerald: { dot: 'bg-emerald-400', glow: 'shadow-emerald-400/40', text: 'text-emerald-400', ring: 'ring-emerald-400/20' },
    amber:   { dot: 'bg-amber-400',   glow: 'shadow-amber-400/40',   text: 'text-amber-400',   ring: 'ring-amber-400/20' },
    red:     { dot: 'bg-red-400',      glow: 'shadow-red-400/40',     text: 'text-red-400',     ring: 'ring-red-400/20' },
  };
  const c = colors[statusColor];

  return (
    <div className="lg-card rounded-2xl p-4 overflow-hidden relative">
      <div className="flex items-center gap-4 relative z-10">
        {/* Animated heart */}
        <div className="relative">
          <motion.div
            animate={beat ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] } : {}}
            transition={{ duration: 0.6 }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.dot}/15 shadow-lg ${c.glow}`}
          >
            <HeartPulse className={`w-5 h-5 ${c.text}`} />
          </motion.div>
          <motion.div
            animate={beat ? { scale: [1, 2.2], opacity: [0.4, 0] } : {}}
            transition={{ duration: 0.8 }}
            className={`absolute inset-0 rounded-xl ${c.dot}/20`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white/90">Distribution Engine</span>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.dot}/10 ${c.text} ring-1 ${c.ring}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${autoRefresh ? 'animate-pulse' : ''}`} />
              {autoRefresh ? 'LIVE' : 'PAUSED'}
            </div>
          </div>
          <div className="text-[10px] text-white/30 mt-0.5">
            System load {systemPct}% — {lastRefresh ? `refreshed ${formatDistanceToNowStrict(lastRefresh, { addSuffix: true })}` : 'loading...'}
          </div>
        </div>

        {/* System load arc */}
        <div className="relative w-12 h-12 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
            <motion.circle
              cx="24" cy="24" r="18"
              fill="none"
              stroke={statusColor === 'emerald' ? '#34d399' : statusColor === 'amber' ? '#fbbf24' : '#f87171'}
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ strokeDasharray: `0 ${2 * Math.PI * 18}` }}
              animate={{ strokeDasharray: `${(systemPct / 100) * 2 * Math.PI * 18} ${2 * Math.PI * 18}` }}
              transition={{ duration: 1, ease: [0.25, 1, 0.5, 1] }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xs font-bold ${c.text}`}>{systemPct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hourly Bar Chart — Gradient Bars + Tooltip ───────────────────
function HourlyChart({ data }: { data: { hour: number; count: string }[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const hourMap = useMemo(() => {
    const m = new Map<number, number>();
    data.forEach((d) => m.set(Number(d.hour), Number(d.count)));
    return m;
  }, [data]);

  const maxCount = useMemo(() => Math.max(...Array.from(hourMap.values()), 1), [hourMap]);
  const now = new Date().getHours();

  return (
    <div className="relative">
      <div className="flex items-end gap-[3px] h-24 w-full">
        {Array.from({ length: 24 }, (_, h) => {
          const count = hourMap.get(h) || 0;
          const height = (count / maxCount) * 100;
          const isCurrent = h === now;
          const isHov = hovered === h;

          return (
            <div
              key={h}
              className="flex-1 relative group cursor-pointer"
              onMouseEnter={() => setHovered(h)}
              onMouseLeave={() => setHovered(null)}
            >
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(height, 3)}%` }}
                transition={{ duration: 0.6, delay: h * 0.02, ease: [0.25, 1, 0.5, 1] }}
                className="w-full rounded-t-sm relative overflow-hidden"
                style={{
                  background: isCurrent
                    ? 'linear-gradient(to top, #7c3aed, #a78bfa)'
                    : count > 0
                      ? `linear-gradient(to top, rgba(59,130,246,${isHov ? 0.8 : 0.5}), rgba(96,165,250,${isHov ? 0.9 : 0.6}))`
                      : 'rgba(255,255,255,0.03)',
                  boxShadow: isCurrent ? '0 0 12px rgba(139,92,246,0.4)' : isHov && count > 0 ? '0 0 8px rgba(59,130,246,0.3)' : 'none',
                }}
              />
              {/* Tooltip */}
              <AnimatePresence>
                {isHov && count > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap"
                  >
                    <div className="lg-chip px-2 py-1 rounded-lg text-[10px] font-medium text-white/90">
                      <span className="text-white/50">{h.toString().padStart(2, '0')}:00</span>
                      <span className="mx-1 text-white/15">|</span>
                      <span className="text-blue-400 font-bold">{count}</span> alerts
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[9px] text-white/20 font-medium">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}

// ─── Type Breakdown — Glass Bars ──────────────────────────────────
function TypeBreakdown({ data }: { data: { alert_type: string; status: string; count: string }[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { total: number; resolved: number; escalated: number; pending: number }>();
    data.forEach((d) => {
      const existing = map.get(d.alert_type) || { total: 0, resolved: 0, escalated: 0, pending: 0 };
      const c = Number(d.count);
      existing.total += c;
      if (d.status === 'resolved') existing.resolved += c;
      else if (d.status === 'escalated') existing.escalated += c;
      else existing.pending += c;
      map.set(d.alert_type, existing);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  }, [data]);

  const total = grouped.reduce((sum, [, v]) => sum + v.total, 0);
  const gradients = [
    'from-violet-500/70 to-violet-400/40', 'from-blue-500/70 to-blue-400/40',
    'from-emerald-500/70 to-emerald-400/40', 'from-amber-500/70 to-amber-400/40',
    'from-red-500/70 to-red-400/40', 'from-cyan-500/70 to-cyan-400/40',
  ];

  if (grouped.length === 0) return <div className="text-center text-white/20 text-xs py-6">No alert data</div>;

  return (
    <div className="space-y-3">
      {grouped.map(([type, counts], i) => {
        const pct = total > 0 ? (counts.total / total) * 100 : 0;
        return (
          <motion.div
            key={type}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/70 truncate font-medium">{type}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-white/50 font-bold tabular-nums">{counts.total}</span>
                <span className="text-[9px] text-white/20">({pct.toFixed(0)}%)</span>
              </div>
            </div>
            <div className="h-2 bg-white/[0.03] rounded-full overflow-hidden relative">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, delay: i * 0.05, ease: [0.25, 1, 0.5, 1] }}
                className={`h-full rounded-full bg-gradient-to-r ${gradients[i % gradients.length]}`}
              />
              {/* Resolution overlay */}
              {counts.resolved > 0 && counts.total > 0 && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(counts.resolved / total) * 100}%` }}
                  transition={{ duration: 0.8, delay: i * 0.05 + 0.2, ease: [0.25, 1, 0.5, 1] }}
                  className="absolute inset-y-0 left-0 bg-emerald-400/30 rounded-full"
                />
              )}
            </div>
          </motion.div>
        );
      })}

      <div className="flex items-center gap-4 pt-2 text-[9px] text-white/25 font-medium">
        <span className="flex items-center gap-1.5"><span className="w-2 h-1 rounded-full bg-gradient-to-r from-violet-500/70 to-violet-400/40 inline-block" /> Type Volume</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-1 rounded-full bg-emerald-400/50 inline-block" /> Resolved</span>
      </div>
    </div>
  );
}

// ─── Response Time Cards — Glass Chips ────────────────────────────
function ResponseTimes({ data }: { data: { alert_type: string; avg_ack_seconds: string; avg_resolve_seconds: string; total: string }[] }) {
  if (data.length === 0) return <div className="text-center text-white/20 text-xs py-4">No resolution data yet</div>;

  const fmt = (s: number) => {
    if (!s || s <= 0) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {data.slice(0, 6).map((d, i) => (
        <motion.div
          key={d.alert_type}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className="lg-metric-dense p-3 rounded-xl"
        >
          <div className="text-[10px] text-white/30 truncate mb-2 font-medium">{d.alert_type}</div>
          <div className="flex items-baseline gap-3">
            <div>
              <div className="text-sm font-bold text-blue-400 tabular-nums">{fmt(Number(d.avg_ack_seconds))}</div>
              <div className="text-[8px] text-white/20 uppercase tracking-wider mt-0.5">Ack</div>
            </div>
            <div className="h-5 w-px bg-white/[0.04]" />
            <div>
              <div className="text-sm font-bold text-emerald-400 tabular-nums">{fmt(Number(d.avg_resolve_seconds))}</div>
              <div className="text-[8px] text-white/20 uppercase tracking-wider mt-0.5">Resolve</div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Activity Feed Item — Timeline Style ──────────────────────────
const actionConfig: Record<string, { color: string; bg: string; label: string }> = {
  assigned:     { color: 'text-blue-400',    bg: 'bg-blue-400/10',    label: 'Assigned' },
  acknowledged: { color: 'text-violet-400',  bg: 'bg-violet-400/10',  label: 'Ack\'d' },
  resolved:     { color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Resolved' },
  escalated:    { color: 'text-red-400',     bg: 'bg-red-400/10',     label: 'Escalated' },
  reassigned:   { color: 'text-amber-400',   bg: 'bg-amber-400/10',   label: 'Reassigned' },
  dismissed:    { color: 'text-slate-400',   bg: 'bg-slate-400/10',   label: 'Dismissed' },
  timeout:      { color: 'text-orange-400',  bg: 'bg-orange-400/10',  label: 'Timeout' },
  created:      { color: 'text-cyan-400',    bg: 'bg-cyan-400/10',    label: 'Created' },
};

const actionIcons: Record<string, typeof Activity> = {
  assigned: Zap, acknowledged: CheckCircle, resolved: CheckCircle,
  escalated: ArrowUpCircle, reassigned: RefreshCw, dismissed: AlertTriangle,
  timeout: Timer, created: Bell,
};

function ActivityFeedItem({ event, index }: { event: ActivityEvent; index: number }) {
  const cfg = actionConfig[event.action] || { color: 'text-slate-400', bg: 'bg-slate-400/10', label: event.action };
  const Icon = actionIcons[event.action] || Activity;
  const timeAgo = formatDistanceToNowStrict(new Date(event.performed_at), { addSuffix: true });

  return (
    <motion.div
      initial={{ opacity: 0, x: -16, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ delay: index * 0.02, duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
      className="flex items-start gap-3 py-2.5 px-3 hover:bg-white/[0.02] transition-colors rounded-lg group"
    >
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center pt-0.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cfg.bg} transition-transform group-hover:scale-110`}>
          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-bold ${cfg.color}`}>{cfg.label}</span>
          {event.vehicle_reg && (
            <span className="text-[11px] text-white/60 font-mono bg-white/[0.03] px-1.5 py-0.5 rounded">{event.vehicle_reg}</span>
          )}
          {event.alert_type && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.04] text-white/30 font-medium">{event.alert_type}</span>
          )}
        </div>
        <div className="text-[10px] text-white/20 mt-0.5 flex items-center gap-1.5">
          <span>{event.performed_by}</span>
          {event.handling_time_seconds != null && event.handling_time_seconds > 0 && (
            <>
              <span className="text-white/[0.06]">·</span>
              <span className="text-emerald-400/50">{Math.floor(event.handling_time_seconds / 60)}m {event.handling_time_seconds % 60}s</span>
            </>
          )}
        </div>
      </div>

      <span className="text-[9px] text-white/15 flex-shrink-0 whitespace-nowrap font-medium pt-0.5">{timeAgo}</span>
    </motion.div>
  );
}

// ─── Rules Health — Compact Glass Strip ───────────────────────────
function RulesHealth({ rules }: { rules: DistributionRule[] }) {
  const active = rules.filter((r) => r.is_active).length;
  return (
    <div className="lg-card rounded-2xl p-3 overflow-hidden relative">
      <div className="flex items-center gap-3 relative z-10">
        <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center">
          <Shield className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-white/80">Routing Rules</div>
          <div className="text-[9px] text-white/25">{active} active / {rules.length} total</div>
        </div>
        <div className="flex items-center gap-1">
          {rules.slice(0, 8).map((r) => (
            <motion.div
              key={r.id}
              animate={{ scale: r.is_active ? 1 : 0.7, opacity: r.is_active ? 1 : 0.4 }}
              className={`w-2 h-2 rounded-full ${r.is_active ? 'bg-emerald-400 shadow-sm shadow-emerald-400/30' : 'bg-slate-600'}`}
              title={`${r.rule_name}: ${r.is_active ? 'Active' : 'Inactive'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Quick Stat — Glass Metric ────────────────────────────────────
function QuickStat({ icon: Icon, label, value, color }: {
  icon: typeof Activity; label: string; value: number;
  color: 'amber' | 'blue' | 'emerald' | 'red';
}) {
  const colorMap = {
    amber:   { text: 'text-amber-400',   bg: 'bg-amber-400/8',   glow: '0 0 16px rgba(251,191,36,0.1)' },
    blue:    { text: 'text-blue-400',     bg: 'bg-blue-400/8',    glow: '0 0 16px rgba(96,165,250,0.1)' },
    emerald: { text: 'text-emerald-400',  bg: 'bg-emerald-400/8', glow: '0 0 16px rgba(52,211,153,0.1)' },
    red:     { text: 'text-red-400',      bg: 'bg-red-400/8',     glow: '0 0 16px rgba(248,113,113,0.1)' },
  };
  const c = colorMap[color];

  return (
    <motion.div
      {...FADE_UP}
      className="lg-metric rounded-2xl p-3 overflow-hidden relative"
      style={{ boxShadow: `${c.glow}, var(--lg-shadow)` }}
    >
      <div className="relative z-10">
        <div className={`w-7 h-7 rounded-lg ${c.bg} flex items-center justify-center mb-2`}>
          <Icon className={`w-3.5 h-3.5 ${c.text}`} />
        </div>
        <div className={`text-xl font-bold tabular-nums ${c.text}`}>{value}</div>
        <div className="text-[9px] text-white/25 font-medium uppercase tracking-wider mt-0.5">{label}</div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
const LiveDistributionMonitor: React.FC = () => {
  const allAgents = useAlertDistributionStore((s) => s.allAgents);
  const stats = useAlertDistributionStore((s) => s.stats);
  const rules = useAlertDistributionStore((s) => s.rules);
  const fetchRules = useAlertDistributionStore((s) => s.fetchRules);

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, activityRes] = await Promise.all([
        api.distribution.getAnalytics(analyticsDays),
        api.distribution.getRecentActivity(60),
      ]);
      if (analyticsRes.success && analyticsRes.data) setAnalytics(analyticsRes.data as AnalyticsData);
      if (activityRes.success && activityRes.data) setActivity(activityRes.data as ActivityEvent[]);
      setLastRefresh(new Date());
    } catch { /* silently handle */ }
    setLoading(false);
  }, [analyticsDays]);

  useEffect(() => {
    fetchRules();
    fetchData();
  }, [fetchData, fetchRules]);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(fetchData, 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchData]);

  const onlineAgents = useMemo(() => allAgents.filter((a) => a.status === 'online'), [allAgents]);
  const breakAgents = useMemo(() => allAgents.filter((a) => a.status === 'on_break' || a.status === 'break_requested'), [allAgents]);
  const offlineAgents = useMemo(() => allAgents.filter((a) => a.status === 'offline'), [allAgents]);

  const totalCapacity = useMemo(() => onlineAgents.reduce((s, a) => s + (a.max_alerts || 5), 0), [onlineAgents]);
  const totalLoad = useMemo(() => onlineAgents.reduce((s, a) => s + a.current_alert_count, 0), [onlineAgents]);
  const systemPct = totalCapacity > 0 ? Math.round((totalLoad / totalCapacity) * 100) : 0;

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* ── Top: Engine Heartbeat + Controls ── */}
      <div className="flex-shrink-0 flex items-stretch gap-3">
        <div className="flex-1">
          <EngineHeartbeat lastRefresh={lastRefresh} systemPct={systemPct} autoRefresh={autoRefresh} />
        </div>
        <div className="flex flex-col gap-2 justify-center">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`lg-icon-btn px-3 py-2 rounded-xl text-[10px] font-semibold flex items-center gap-2 ${
              autoRefresh ? 'text-emerald-400' : 'text-white/30'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="lg-icon-btn p-2 rounded-xl text-white/30 hover:text-white/70 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Main 3-Column Layout ── */}
      <div className="flex-1 grid grid-cols-12 gap-3 min-h-0 overflow-hidden">

        {/* LEFT — Agent Load Gauges */}
        <div className="col-span-3 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
          {/* System capacity */}
          <div className="lg-card rounded-2xl p-4 overflow-hidden relative">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <Gauge className="w-4 h-4 text-violet-400" />
                <span className="text-[11px] font-bold text-white/80 uppercase tracking-wider">Agent Capacity</span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-2.5 bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${systemPct}%` }}
                    transition={{ duration: 1, ease: [0.25, 1, 0.5, 1] }}
                    style={{
                      background: systemPct < 50
                        ? 'linear-gradient(to right, #10b981, #34d399)'
                        : systemPct < 80
                          ? 'linear-gradient(to right, #f59e0b, #fbbf24)'
                          : 'linear-gradient(to right, #ef4444, #f87171)',
                      boxShadow: systemPct < 50
                        ? '0 0 10px rgba(52,211,153,0.3)'
                        : systemPct < 80
                          ? '0 0 10px rgba(251,191,36,0.3)'
                          : '0 0 10px rgba(248,113,113,0.3)',
                    }}
                  />
                </div>
                <span className="text-xs font-bold text-white/60 tabular-nums">{totalLoad}/{totalCapacity}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { n: onlineAgents.length, l: 'Online', c: 'text-emerald-400' },
                  { n: breakAgents.length,  l: 'Break',  c: 'text-amber-400' },
                  { n: offlineAgents.length, l: 'Offline', c: 'text-slate-500' },
                ].map(({ n, l, c }) => (
                  <div key={l}>
                    <div className={`text-base font-bold tabular-nums ${c}`}>{n}</div>
                    <div className="text-[8px] text-white/20 uppercase tracking-wider">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <AdaptiveAgentSection agents={onlineAgents} label="Online" />
          <AdaptiveAgentSection agents={breakAgents} label="On Break" />
          <AdaptiveAgentSection agents={offlineAgents} label="Offline" />

          {rules.length > 0 && <RulesHealth rules={rules} />}
        </div>

        {/* CENTER — Analytics */}
        <div className="col-span-5 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-2">
            <QuickStat icon={Bell} label="Pending" value={stats?.pending_alerts ?? 0} color="amber" />
            <QuickStat icon={Zap} label="Assigned" value={stats?.assigned_alerts ?? 0} color="blue" />
            <QuickStat icon={CheckCircle} label="Resolved" value={stats?.resolved_today ?? 0} color="emerald" />
            <QuickStat icon={ArrowUpCircle} label="Escalated" value={stats?.escalated_alerts ?? 0} color="red" />
          </div>

          {/* Hourly volume */}
          <div className="lg-card rounded-2xl p-4 overflow-hidden relative">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  <span className="text-[11px] font-bold text-white/80">Alert Volume</span>
                </div>
                <select
                  value={analyticsDays}
                  onChange={(e) => setAnalyticsDays(parseInt(e.target.value))}
                  className="px-2 py-1 text-[10px] bg-white/[0.04] border border-white/[0.06] rounded-lg text-white/50 cursor-pointer hover:border-white/10 transition-colors"
                >
                  <option value={1}>Today</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
              {analytics ? (
                <HourlyChart data={analytics.hourlyDistribution} />
              ) : (
                <div className="h-24 flex items-center justify-center"><div className="shimmer w-full h-16 rounded-lg" /></div>
              )}
            </div>
          </div>

          {/* Type breakdown */}
          <div className="lg-card rounded-2xl p-4 overflow-hidden relative">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-violet-400" />
                <span className="text-[11px] font-bold text-white/80">Type Distribution</span>
              </div>
              {analytics ? (
                <TypeBreakdown data={analytics.typeBreakdown} />
              ) : (
                <div className="h-20 flex items-center justify-center"><div className="shimmer w-full h-12 rounded-lg" /></div>
              )}
            </div>
          </div>

          {/* Response times */}
          <div className="lg-card rounded-2xl p-4 overflow-hidden relative">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-[11px] font-bold text-white/80">Avg Response Times</span>
              </div>
              {analytics ? (
                <ResponseTimes data={analytics.responseTimes} />
              ) : (
                <div className="h-16 flex items-center justify-center"><div className="shimmer w-full h-10 rounded-lg" /></div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Live Activity Feed */}
        <div className="col-span-4 flex flex-col lg-card rounded-2xl overflow-hidden relative">
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/[0.04] relative z-10">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px] font-bold text-white/80">Activity Feed</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/40" />
            </div>
            <span className="text-[9px] text-white/15 font-medium tabular-nums">{activity.length} events</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
            {activity.length > 0 ? (
              <div className="p-1">
                {activity.map((evt, i) => (
                  <ActivityFeedItem key={evt.id} event={evt} index={i} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-white/15">
                <Cpu className="w-10 h-10 mb-3 opacity-20" />
                <span className="text-sm font-medium">No recent activity</span>
                <span className="text-[10px] text-white/10 mt-1">Distribution events appear here in real-time</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveDistributionMonitor;
