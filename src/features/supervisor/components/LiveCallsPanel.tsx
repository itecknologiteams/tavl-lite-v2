import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, Clock, TrendingUp, PhoneMissed, CheckCircle2, Timer,
  ArrowUpRight, ArrowDownLeft, Trophy, RefreshCw,
  WifiOff, PhoneIncoming, PhoneOutgoing, Bot, Activity, Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActiveCall {
  uniqueId: string;
  agentExt: string;
  callerId?: string;
  callerIdName?: string;
  destination?: string;
  duration: number;
  state: string;
  customerName?: string;
  vehicleReg?: string | null;
  vehicleInfo?: string | null;
}

interface AutocallCall {
  uniqueId: string;
  phase: 'calling' | 'connected';
  callerId: string;
  destination?: string;
  agentExt: string | null;
  duration: number;
  state: string;
  customerName?: string;
  vehicleReg?: string | null;
  vehicleInfo?: string | null;
}

interface QueueCaller {
  position: number;
  callerId: string;
  callerIdName?: string;
  wait: number;
  channel: string;
  customerName?: string;
  vehicleReg?: string | null;
  vehicleInfo?: string | null;
}

interface QueueAgent {
  ext?: string;
  name: string;
  interface: string;
  statusLabel: string;
  callsTaken: number;
  paused: boolean;
  lastStatusChange?: number;
}

interface LeaderboardEntry {
  ext: string;
  name: string;
  callsTaken: number;
  callsAnswered: number;
  totalTalkSec: number;
  statusLabel: string;
  paused: boolean;
}

interface Summary {
  totalActive: number;
  totalInbound: number;
  totalOutbound: number;
  totalAutocall: number;
  callsWaiting: number;
  agentsAvailable: number;
  agentsOnCall: number;
  serviceLevel: number;
  slOffered: number;
  asaSec: number;
  occupancy: number;
  todayTotal: number;
  todayAnswered: number;
  todayInbound: number;
  todayOutbound: number;
  answerRate: number;
  avgTalkSec: number;
  abandoned: number;
}

interface AbandonedCallback {
  number: string;
  lastAt: string;       // "HH:MM" of the most recent abandon (PKT)
  attempts: number;     // how many times this number abandoned today
  maxWaitSec: number;   // longest they waited before hanging up
  customerName?: string;
  vehicleReg?: string | null;
  vehicleInfo?: string | null;
}

interface CallStatsData {
  success: boolean;
  queue: {
    name: string;
    callersWaiting: number;
    longestWaitSec: number;
    callers: QueueCaller[];
    agents: QueueAgent[];
  };
  activeCalls: { inbound: ActiveCall[]; outbound: ActiveCall[]; autocall: AutocallCall[] };
  leaderboard: LeaderboardEntry[];
  abandonedCallbacks?: AbandonedCallback[];
  summary: Summary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtTalk(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function slColor(pct: number): string {
  if (pct >= 80) return '#34d399'; // emerald
  if (pct >= 60) return '#fbbf24'; // amber
  return '#f87171';                // red
}

function agentDotColor(label: string, paused: boolean): string {
  if (paused) return 'bg-violet-400';
  switch (label) {
    case 'not_inuse':   return 'bg-emerald-400';
    case 'inuse':       return 'bg-blue-400';
    case 'ringinuse':
    case 'ringing':     return 'bg-amber-400 animate-pulse';
    case 'onhold':      return 'bg-orange-400';
    case 'busy':        return 'bg-red-400';
    case 'unavailable': return 'bg-slate-500';
    default:            return 'bg-white/15';
  }
}

function agentTileBg(label: string, paused: boolean): string {
  if (paused) return 'border-violet-500/40 bg-violet-500/15';
  switch (label) {
    case 'not_inuse':   return 'border-emerald-500/40 bg-emerald-500/15';
    case 'inuse':       return 'border-blue-500/40 bg-blue-500/15';
    case 'ringinuse':
    case 'ringing':     return 'border-amber-400/60 bg-amber-500/20 ring-1 ring-amber-400/40';
    case 'onhold':      return 'border-orange-500/40 bg-orange-500/15';
    case 'busy':        return 'border-red-500/40 bg-red-500/15';
    case 'unavailable': return 'border-white/10 bg-white/[0.04] opacity-70';
    default:            return 'border-white/8 bg-white/5';
  }
}

function agentTextColor(label: string, paused: boolean): string {
  if (paused) return 'text-violet-300';
  switch (label) {
    case 'not_inuse':   return 'text-emerald-300';
    case 'inuse':       return 'text-blue-300';
    case 'ringinuse':
    case 'ringing':     return 'text-amber-300';
    case 'onhold':      return 'text-orange-300';
    case 'busy':        return 'text-red-300';
    case 'unavailable': return 'text-white/40';
    default:            return 'text-white/55';
  }
}

function agentStateText(label: string, paused: boolean): string {
  if (paused) return 'On Break';
  switch (label) {
    case 'not_inuse':   return 'Available';
    case 'inuse':       return 'On Call';
    case 'ringinuse':   return 'Ringing';
    case 'ringing':     return 'Ringing';
    case 'onhold':      return 'On Hold';
    case 'busy':        return 'Busy';
    case 'unavailable': return 'Offline';
    default:            return 'Unknown';
  }
}

// Resolve the best display label for a caller: CRM customer name → trunk
// caller-id name → raw number. Returns a vehicle/number subtext line too.
function callerDisplay(opts: {
  customerName?: string;
  callerIdName?: string;
  vehicleReg?: string | null;
  vehicleInfo?: string | null;
  number?: string;
}): { primary: string; secondary: string } {
  const { customerName, callerIdName, vehicleReg, vehicleInfo, number } = opts;
  const primary =
    customerName ||
    (callerIdName && callerIdName !== number ? callerIdName : '') ||
    number ||
    'Unknown';
  const veh = vehicleReg ? `${vehicleReg}${vehicleInfo ? ` · ${vehicleInfo}` : ''}` : '';
  const showNumber = !!number && primary !== number;
  const secondary = [veh, showNumber ? number : ''].filter(Boolean).join('   ·   ');
  return { primary, secondary };
}

const POLL_INTERVAL = 3000;
const SLA_WARN_SEC  = 60;   // amber after 60s wait
const SLA_ALERT_SEC = 120;  // red after 120s wait

// ── Component ─────────────────────────────────────────────────────────────────

export default function LiveCallsPanel() {
  const [data, setData]       = useState<CallStatsData | null>(null);
  const [error, setError]     = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick]       = useState(0);
  const fetchedAtRef          = useRef<number>(Date.now());

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch('/api/supervisor/call-stats');
      const json: CallStatsData = await res.json();
      if (json?.success) {
        setData(json);
        fetchedAtRef.current = Date.now();
        setError(false);
      }
    } catch { setError(true); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(poll);
  }, [fetchData]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const liveDur = (snap: number) => {
    const elapsed = Math.floor((Date.now() - fetchedAtRef.current) / 1000);
    return snap + elapsed;
  };

  const nowSec = Math.floor(Date.now() / 1000);
  void tick; // forces re-render each second

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <RefreshCw className="w-6 h-6 text-violet-400 animate-spin" />
    </div>
  );
  if (error || !data) return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-white/40">
      <WifiOff className="w-8 h-8" />
      <span className="text-sm">Could not load call stats — PBX may be offline</span>
      <button onClick={fetchData} className="text-xs text-violet-400 hover:text-violet-300 underline">Retry</button>
    </div>
  );

  const { queue, activeCalls, leaderboard, summary, abandonedCallbacks = [] } = data;
  const sl     = summary.serviceLevel ?? 100;
  const slClr  = slColor(sl);

  // Map each on-call agent's extension → the call they're on, so the Agent Board
  // can show the other party (number + CRM name), direction, and live duration.
  const agentCall: Record<string, { dir: 'in' | 'out'; number?: string; name?: string; duration: number }> = {};
  for (const c of activeCalls.inbound)  if (c.agentExt) agentCall[c.agentExt] = { dir: 'in',  number: c.callerId,    name: c.customerName, duration: c.duration };
  for (const c of activeCalls.outbound) if (c.agentExt) agentCall[c.agentExt] = { dir: 'out', number: c.destination, name: c.customerName, duration: c.duration };
  for (const c of activeCalls.autocall) if (c.agentExt) agentCall[c.agentExt] = { dir: 'out', number: c.destination, name: c.customerName, duration: c.duration };

  return (
    <div className="h-full flex flex-col gap-2.5 overflow-hidden">

      {/* ── KPI Strip ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-11 gap-2">

        {/* Service Level — prominent */}
        <div className="lg:col-span-2 rounded-xl border px-3 py-2 flex items-center gap-3"
             style={{ borderColor: `${slClr}30`, backgroundColor: `${slClr}0D` }}>
          <div className="flex-shrink-0">
            <Activity className="w-4 h-4" style={{ color: slClr }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums" style={{ color: slClr }}>{sl}%</span>
              <span className="text-[10px] text-white/30">/ 80% target</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1 mt-1">
              <div className="h-1 rounded-full transition-all duration-1000"
                   style={{ width: `${Math.min(100, sl)}%`, backgroundColor: slClr }} />
            </div>
            <div className="text-[9px] text-white/30 mt-0.5">Service Level (20s)</div>
          </div>
        </div>

        <KpiCard icon={<Zap className="w-3.5 h-3.5 text-violet-400" />}
                 label="Occupancy" value={`${summary.occupancy ?? 0}%`} color="violet" />
        <KpiCard icon={<Timer className="w-3.5 h-3.5 text-white/40" />}
                 label="Avg Speed Ans" value={fmtTalk(summary.asaSec ?? 0)} color="default" />
        <KpiCard icon={<Clock className="w-3.5 h-3.5 text-amber-400" />}
                 label="Waiting" value={summary.callsWaiting}
                 alert={summary.callsWaiting > 5} color="amber" />
        <KpiCard icon={<Users className="w-3.5 h-3.5 text-emerald-400" />}
                 label="Available" value={summary.agentsAvailable} color="emerald" />
        <KpiCard icon={<PhoneIncoming className="w-3.5 h-3.5 text-emerald-400" />}
                 label="Inbound Live" value={summary.totalInbound} color="emerald" />
        <KpiCard icon={<Bot className="w-3.5 h-3.5 text-amber-400" />}
                 label="Autocall Live" value={summary.totalAutocall ?? 0} color="amber" />
        <KpiCard icon={<PhoneOutgoing className="w-3.5 h-3.5 text-blue-400" />}
                 label="UAN Live" value={summary.totalOutbound} color="blue" />
        <KpiCard icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                 label="Ans Today" value={summary.todayAnswered} color="emerald" />
        <KpiCard icon={<PhoneMissed className="w-3.5 h-3.5 text-red-400" />}
                 label="Abandoned" value={summary.abandoned} color="red" />
      </div>

      {/* ── Main section: Queue | Agent Grid | Leaderboard ─────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[22%_auto_22%] gap-2.5 overflow-hidden">

        {/* Col 1: Queue */}
        <div className="flex flex-col gap-2.5 min-h-0 overflow-hidden">

          {/* Callers Waiting */}
          <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden"
               style={{ maxHeight: '45%' }}>
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-white/80">Queue Waiting</span>
              </div>
              <div className="flex items-center gap-2">
                {queue.longestWaitSec > 0 && (
                  <span className={`text-[10px] ${queue.longestWaitSec > SLA_ALERT_SEC ? 'text-red-400' : queue.longestWaitSec > SLA_WARN_SEC ? 'text-amber-400' : 'text-white/30'}`}>
                    longest: {fmt(liveDur(queue.longestWaitSec))}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  queue.callersWaiting > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-white/30'
                }`}>{queue.callersWaiting}</span>
              </div>
            </div>
            {queue.callers.length === 0
              ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">Queue clear</div>
              : (
                <div className="overflow-y-auto flex-1 space-y-1 [scrollbar-width:thin]">
                  {queue.callers.map((c) => {
                    const w = liveDur(c.wait);
                    const urgency = w > SLA_ALERT_SEC ? 'bg-red-500/12 border-red-500/25'
                      : w > SLA_WARN_SEC ? 'bg-amber-500/10 border-amber-500/20'
                      : 'bg-amber-500/6 border-amber-500/12';
                    const timeClr = w > SLA_ALERT_SEC ? 'text-red-400 animate-pulse'
                      : w > SLA_WARN_SEC ? 'text-amber-300'
                      : 'text-amber-300/70';
                    return (
                      <div key={c.channel} className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-xl ${urgency}`}>
                        <span className="text-amber-400 font-bold text-xs w-4 text-center flex-shrink-0">#{c.position}</span>
                        {(() => {
                          const d = callerDisplay({ customerName: c.customerName, callerIdName: c.callerIdName, vehicleReg: c.vehicleReg, vehicleInfo: c.vehicleInfo, number: c.callerId });
                          return (
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white/75 font-medium truncate">{d.primary}</div>
                              {d.secondary && <div className="text-[10px] text-white/30 truncate">{d.secondary}</div>}
                            </div>
                          );
                        })()}
                        <span className={`text-xs font-mono tabular-nums flex-shrink-0 ${timeClr}`}>{fmt(w)}</span>
                      </div>
                    );
                  })}
                </div>
              )
            }
          </div>

          {/* Recently Abandoned — Call Back (callers who hung up while waiting) */}
          <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <PhoneMissed className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs font-semibold text-white/80">Abandoned — Call Back</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                abandonedCallbacks.length > 0 ? 'bg-red-500/20 text-red-300' : 'bg-white/5 text-white/30'
              }`}>{abandonedCallbacks.length}</span>
            </div>
            {abandonedCallbacks.length === 0
              ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">No abandoned calls today</div>
              : (
                <div className="overflow-y-auto flex-1 space-y-1 [scrollbar-width:thin]">
                  {abandonedCallbacks.map((a) => (
                    <div key={a.number} className="flex items-center gap-2 px-2.5 py-1.5 border border-red-500/15 bg-red-500/[0.06] rounded-xl">
                      <PhoneMissed className="w-3 h-3 text-red-400/70 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white/80 font-medium truncate">
                          {a.customerName || <span className="tabular-nums">{a.number}</span>}
                        </div>
                        {a.customerName && (
                          <div className="text-[10px] text-white/40 truncate tabular-nums">
                            {a.vehicleReg ? `${a.vehicleReg}${a.vehicleInfo ? ` · ${a.vehicleInfo}` : ''}   ·   ` : ''}{a.number}
                          </div>
                        )}
                        <div className="text-[10px] text-white/35">{a.lastAt} · waited {fmt(a.maxWaitSec)}</div>
                      </div>
                      {a.attempts > 1 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-300 flex-shrink-0">×{a.attempts}</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>

        {/* Col 2: Agent Grid */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold text-white/80">Agent Board</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Available</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse" /> Ringing</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> On Call</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" /> On Break</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-500 inline-block" /> Offline</span>
            </div>
          </div>

          {queue.agents.length === 0
            ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">No agents in queue</div>
            : (
              <div className="overflow-y-auto flex-1 [scrollbar-width:thin]">
                <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
                  {[...queue.agents]
                    .sort((a, b) => {
                      const o = ['ringing','ringinuse','inuse','not_inuse','onhold','busy','unavailable','unknown'];
                      const ai = a.paused ? 3.5 : o.indexOf(a.statusLabel);
                      const bi = b.paused ? 3.5 : o.indexOf(b.statusLabel);
                      return ai - bi;
                    })
                    .map((agent, i) => {
                      const extMatch = (agent.interface || '').match(/user\/(\d+)@/);
                      const ext = extMatch ? extMatch[1] : agent.name?.replace(/@.*$/, '') || '?';
                      const stateAge = agent.lastStatusChange
                        ? fmt(Math.max(0, nowSec - agent.lastStatusChange))
                        : null;
                      const call = agentCall[ext];
                      return (
                        <div key={i} className={`rounded-xl border p-2.5 flex flex-col gap-1 cursor-default ${agentTileBg(agent.statusLabel, agent.paused)}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white/85">
                              Ext {ext}
                              {agent.name && agent.name !== `Ext ${ext}` && (
                                <span className="text-[10px] text-white/45 font-normal ml-1.5">· {agent.name}</span>
                              )}
                            </span>
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${agentDotColor(agent.statusLabel, agent.paused)}`} />
                          </div>
                          <div className={`text-[11px] font-semibold ${agentTextColor(agent.statusLabel, agent.paused)}`}>
                            {agentStateText(agent.statusLabel, agent.paused)}
                          </div>
                          {call ? (
                            <>
                              <div className="flex items-center gap-1 text-[10px] min-w-0">
                                {call.dir === 'in'
                                  ? <ArrowDownLeft className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                  : <ArrowUpRight className="w-3 h-3 text-blue-400 flex-shrink-0" />}
                                <span className="text-white/70 truncate">{call.number || 'Unknown'}</span>
                              </div>
                              {call.name && <div className="text-[10px] text-white/45 truncate">{call.name}</div>}
                              <div className="text-[10px] text-white/55 tabular-nums font-mono">{fmt(liveDur(call.duration))}</div>
                            </>
                          ) : (
                            <>
                              {stateAge && (
                                <div className="text-[10px] text-white/30 tabular-nums font-mono">{stateAge}</div>
                              )}
                              {(agent.callsTaken ?? 0) > 0 && (
                                <div className="text-[10px] text-violet-300/60">{agent.callsTaken} calls today</div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )
          }
        </div>

        {/* Col 3: Leaderboard */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white/80">Today's Leaders</span>
          </div>

          {/* Mini totals */}
          <div className="grid grid-cols-3 gap-1.5 mb-3 flex-shrink-0">
            <div className="bg-white/4 rounded-xl p-2 text-center">
              <div className="text-base font-bold text-white/85">{summary.todayTotal}</div>
              <div className="text-[9px] text-white/30 uppercase tracking-wide">Total</div>
            </div>
            <div className="bg-white/4 rounded-xl p-2 text-center">
              <div className="text-base font-bold text-emerald-400">{summary.todayInbound}</div>
              <div className="text-[9px] text-white/30 uppercase tracking-wide">Inbound</div>
            </div>
            <div className="bg-white/4 rounded-xl p-2 text-center">
              <div className="text-base font-bold text-blue-400">{summary.todayOutbound}</div>
              <div className="text-[9px] text-white/30 uppercase tracking-wide">Outbound</div>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1.25rem_1fr_2.5rem_2.5rem_3rem] gap-1 px-1 mb-1 flex-shrink-0">
            <div />
            <div className="text-[9px] text-white/25 uppercase">Ext</div>
            <div className="text-[9px] text-white/25 uppercase text-right">Q</div>
            <div className="text-[9px] text-white/25 uppercase text-right">CDR</div>
            <div className="text-[9px] text-white/25 uppercase text-right">Talk</div>
          </div>

          {leaderboard.length === 0
            ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">No data yet</div>
            : (
              <div className="overflow-y-auto flex-1 space-y-0.5 [scrollbar-width:thin]">
                {leaderboard.map((a, idx) => (
                  <div key={a.ext} className={`grid grid-cols-[1.25rem_1fr_2.5rem_2.5rem_3rem] gap-1 items-center px-1 py-1.5 rounded-lg ${
                    idx === 0 ? 'bg-amber-500/12 border border-amber-500/20' :
                    idx === 1 ? 'bg-white/5' :
                    idx === 2 ? 'bg-white/4' : 'hover:bg-white/3'
                  }`}>
                    <div className={`text-xs font-bold text-center ${
                      idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-white/50' : idx === 2 ? 'text-amber-700' : 'text-white/20'
                    }`}>{idx + 1}</div>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${agentDotColor(a.statusLabel, a.paused)}`} />
                      <span className="text-xs text-white/70 truncate">{a.ext}</span>
                    </div>
                    <div className="text-xs text-violet-300 font-semibold tabular-nums text-right">{a.callsTaken}</div>
                    <div className="text-xs text-emerald-300/70 tabular-nums text-right">{a.callsAnswered}</div>
                    <div className="text-[10px] text-white/30 tabular-nums text-right">{fmtTalk(a.totalTalkSec)}</div>
                  </div>
                ))}
              </div>
            )
          }

          <div className="mt-2 pt-2 border-t border-white/5 flex gap-3 text-[9px] text-white/20 flex-shrink-0">
            <span><span className="text-violet-300">Q</span> queue calls</span>
            <span><span className="text-emerald-300/70">CDR</span> direct inbound</span>
          </div>
        </div>
      </div>

      {/* ── Active Calls Row ────────────────────────────────────────── */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-3 gap-2.5" style={{ minHeight: '160px', maxHeight: '220px' }}>

        {/* Inbound */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-white/80">Inbound Active</span>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              activeCalls.inbound.length > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-white/30'
            }`}>{activeCalls.inbound.length}</span>
          </div>
          {activeCalls.inbound.length === 0
            ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">No active inbound</div>
            : (
              <div className="overflow-y-auto flex-1 space-y-1 [scrollbar-width:thin]">
                {activeCalls.inbound.map((call) => (
                  <div key={call.uniqueId} className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-500/8 border border-emerald-500/15 rounded-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-1">
                      <span className="text-[10px] text-white/35">From</span>
                      <span className="text-xs text-white/75 font-medium truncate">
                        {callerDisplay({ customerName: call.customerName, callerIdName: call.callerIdName, vehicleReg: call.vehicleReg, vehicleInfo: call.vehicleInfo, number: call.callerId }).primary}
                      </span>
                      {call.vehicleReg && <span className="text-[10px] text-emerald-300/60 truncate flex-shrink-0">{call.vehicleReg}</span>}
                      <span className="text-[10px] text-white/30">→ Ext</span>
                      <span className="text-xs text-violet-300 font-semibold flex-shrink-0">{call.agentExt}</span>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-emerald-300 flex-shrink-0">
                      {fmt(liveDur(call.duration))}
                    </span>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* Autocall */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-white/80">Autocall Campaign</span>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              activeCalls.autocall.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-white/30'
            }`}>{activeCalls.autocall.length}</span>
          </div>
          {activeCalls.autocall.length === 0
            ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">No autocall activity</div>
            : (
              <div className="overflow-y-auto flex-1 space-y-1 [scrollbar-width:thin]">
                {activeCalls.autocall.map((call) => (
                  <div key={call.uniqueId} className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-500/8 border border-amber-500/15 rounded-xl">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      call.phase === 'connected' ? 'bg-amber-400' : 'bg-amber-400 animate-pulse'
                    }`} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
                      call.phase === 'connected' ? 'bg-amber-500/25 text-amber-300' : 'bg-white/8 text-white/40'
                    }`}>
                      {call.phase === 'connected' ? 'Live' : 'Dialling'}
                    </span>
                    <div className="flex-1 min-w-0 flex items-center gap-1">
                      <span className="text-xs text-white/75 font-medium truncate">
                        {callerDisplay({ customerName: call.customerName, vehicleReg: call.vehicleReg, vehicleInfo: call.vehicleInfo, number: call.destination || call.callerId }).primary}
                      </span>
                      {call.vehicleReg && <span className="text-[10px] text-amber-300/60 truncate flex-shrink-0">{call.vehicleReg}</span>}
                    </div>
                    {call.phase === 'connected' && call.agentExt && (
                      <span className="text-[10px] text-violet-300 flex-shrink-0">Ext {call.agentExt}</span>
                    )}
                    <span className="text-xs font-mono tabular-nums text-amber-300 flex-shrink-0">
                      {fmt(liveDur(call.duration))}
                    </span>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* UAN Outbound */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <ArrowUpRight className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-white/80">UAN Outbound</span>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              activeCalls.outbound.length > 0 ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-white/30'
            }`}>{activeCalls.outbound.length}</span>
          </div>
          {activeCalls.outbound.length === 0
            ? <div className="flex-1 flex items-center justify-center text-white/20 text-xs">No UAN outbound calls</div>
            : (
              <div className="overflow-y-auto flex-1 space-y-1 [scrollbar-width:thin]">
                {activeCalls.outbound.map((call) => (
                  <div key={call.uniqueId} className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-500/8 border border-blue-500/15 rounded-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-1">
                      <span className="text-xs text-violet-300 font-semibold flex-shrink-0">Ext {call.agentExt}</span>
                      <span className="text-[10px] text-white/30">→</span>
                      <span className="text-xs text-white/75 font-medium truncate">{call.destination}</span>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-blue-300 flex-shrink-0">
                      {fmt(liveDur(call.duration))}
                    </span>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color, alert }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'emerald' | 'blue' | 'amber' | 'violet' | 'red' | 'default';
  alert?: boolean;
}) {
  const borders: Record<string, string> = {
    emerald: 'border-emerald-500/15 bg-emerald-500/5',
    blue:    'border-blue-500/15 bg-blue-500/5',
    amber:   'border-amber-500/15 bg-amber-500/5',
    violet:  'border-violet-500/15 bg-violet-500/5',
    red:     'border-red-500/15 bg-red-500/5',
    default: 'border-white/8 bg-white/3',
  };
  const values: Record<string, string> = {
    emerald: 'text-emerald-300',
    blue:    'text-blue-300',
    amber:   'text-amber-300',
    violet:  'text-violet-300',
    red:     'text-red-300',
    default: 'text-white/55',
  };
  return (
    <div className={`rounded-xl border px-2.5 py-2 flex items-center gap-2 ${borders[color]} ${alert ? 'animate-pulse' : ''}`}>
      <div className="flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className={`text-sm font-bold tabular-nums ${values[color]}`}>{value}</div>
        <div className="text-[9px] text-white/28 truncate leading-tight">{label}</div>
      </div>
    </div>
  );
}
