import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, History, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@services/api';

type Tab = 'history' | 'wc';

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 1, 0, 0);
  return d;
}

// MSSQL datetime columns are timezone-less but Node serializes them with a
// trailing 'Z' (UTC). Rendering with the browser's local timezone (PKT, +5)
// then shifts the value forward by 5 hours. Read the UTC parts directly so
// we display the wall-clock time exactly as stored.
function fmt(value: any, withSeconds = true): string {
  if (!value) return '-';
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const [, yy, mo, dd, hh, mm, ss] = m;
      const wall = new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm), Number(ss || '0'));
      return format(wall, withSeconds ? 'dd MMM yyyy HH:mm:ss' : 'dd MMM yyyy HH:mm');
    }
  }
  const src = new Date(value);
  if (Number.isNaN(src.getTime())) return String(value);
  const wall = new Date(
    src.getUTCFullYear(),
    src.getUTCMonth(),
    src.getUTCDate(),
    src.getUTCHours(),
    src.getUTCMinutes(),
    src.getUTCSeconds()
  );
  return format(wall, withSeconds ? 'dd MMM yyyy HH:mm:ss' : 'dd MMM yyyy HH:mm');
}

function displayCallStatus(raw: any): string {
  if (raw === null || raw === undefined || raw === '') return '-';
  const s = String(raw).trim();
  if (!s) return '-';
  const lower = s.toLowerCase();
  if (lower === 'no call') return 'No answer';
  if (lower === 'failed') return 'No answer';
  return s;
}

export default function GlobalClosurePanel({
  isOpen,
  tab,
  onClose,
  onChangeTab,
}: {
  isOpen: boolean;
  tab: Tab;
  onClose: () => void;
  onChangeTab: (t: Tab) => void;
}) {
  const [vehicle, setVehicle] = useState('');
  const [from, setFrom] = useState(() => toLocalInputValue(startOfToday()));
  const [to, setTo] = useState(() => toLocalInputValue(endOfToday()));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);

  // Vehicle suggestions (same behavior as main vehicle search)
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const blurTimer = useRef<any>(null);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      if (tab === 'history') {
        const res = await api.closure.searchEvents({
          vehicle: vehicle.trim() || undefined,
          from: fromIso,
          to: toIso,
          limit: 500,
          offset: 0,
        }) as any;
        if (!res?.success) throw new Error(res?.error || 'Failed to fetch history');
        setEvents(res.data || []);
      } else {
        const res = await api.closure.searchWarnings({
          vehicle: vehicle.trim() || undefined,
          from: fromIso,
          to: toIso,
          limit: 500,
          offset: 0,
        }) as any;
        if (!res?.success) throw new Error(res?.error || 'Failed to fetch warning console');
        setWarnings(res.data || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch');
      setEvents([]);
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [from, tab, to, vehicle]);

  // Suggestions: debounce vehicle search
  useEffect(() => {
    const term = vehicle.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    let cancelled = false;
    setSuggestLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.vehicle.search(term) as any;
        if (cancelled) return;
        if (res?.success) setSuggestions(res.data || []);
        else setSuggestions([]);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSuggestLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vehicle]);

  if (!isOpen) return null;

  return (
    <div className="absolute left-16 top-4 z-sidebar w-[720px] max-w-[calc(100vw-90px)] h-[calc(100vh-32px)] bg-slate-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col">
      <div className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
        {tab === 'history' ? (
          <History className="w-4 h-4 text-emerald-300" />
        ) : (
          <ShieldAlert className="w-4 h-4 text-indigo-300" />
        )}
        <div className="text-xs font-semibold text-white">
          {tab === 'history' ? 'History (Event Log Closure)' : 'WC (Warning Console)'}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10">
            <button
              type="button"
              onClick={() => onChangeTab('history')}
              className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                tab === 'history' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              History
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('wc')}
              className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                tab === 'wc' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              WC
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-slate-300" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-white/10 grid grid-cols-1 lg:grid-cols-5 gap-2">
        <div className="lg:col-span-2 relative">
          <input
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setSuggestOpen(true);
            }}
            onBlur={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              blurTimer.current = setTimeout(() => setSuggestOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                doFetch();
                setSuggestOpen(false);
              }
            }}
            placeholder="Vehicle reg (e.g. BNA-269) or ObjectId…"
            className="w-full px-2 py-1.5 text-[11px] rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-primary-500/60"
          />

          {suggestOpen && (suggestLoading || suggestions.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/95 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-dropdown">
              {suggestLoading ? (
                <div className="px-3 py-2 text-[11px] text-slate-400 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
                </div>
              ) : (
                <div className="max-h-64 overflow-auto">
                  {suggestions.slice(0, 12).map((s: any) => (
                    <button
                      key={`${s.ObjectId}-${s.PlateNumber}`}
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-white/5 transition-colors flex items-center gap-2"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setVehicle(s.PlateNumber || s.ObjectId || '');
                        setSuggestOpen(false);
                      }}
                    >
                      <span className="text-[11px] font-semibold text-white/90">{s.PlateNumber || '—'}</span>
                      <span className="text-[10px] text-slate-500 font-mono">#{s.ObjectId}</span>
                      {s.Description && (
                        <span className="ml-auto text-[10px] text-slate-400 truncate max-w-[260px]">{s.Description}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="px-2 py-1.5 text-[11px] rounded-lg bg-white/5 border border-white/10 text-slate-200 focus:outline-none focus:border-primary-500/60"
          title="Start time"
        />
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="px-2 py-1.5 text-[11px] rounded-lg bg-white/5 border border-white/10 text-slate-200 focus:outline-none focus:border-primary-500/60"
          title="End time"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={doFetch}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary-500/15 text-primary-300 border border-primary-500/25 hover:bg-primary-500/25 disabled:opacity-50"
          >
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading</span> : 'Search'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {error && (
          <div className="mb-3 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs">
            {error}
          </div>
        )}

        {tab === 'history' ? (
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-300" />
              <div className="text-xs text-white/90 font-medium">Event Log (Closure)</div>
              <div className="ml-auto text-[10px] text-slate-500">{events.length} rows</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1200px] w-full text-[11px]">
                <thead className="bg-black/20 text-slate-400">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Alert ID</th>
                    <th className="px-2 py-2 text-left font-medium">Car</th>
                    <th className="px-2 py-2 text-left font-medium">Datetime</th>
                    <th className="px-2 py-2 text-left font-medium">Type</th>
                    <th className="px-2 py-2 text-left font-medium">Closure Status</th>
                    <th className="px-2 py-2 text-left font-medium">Closure DT</th>
                    <th className="px-2 py-2 text-left font-medium">Closed By</th>
                    <th className="px-2 py-2 text-left font-medium">Grid Time</th>
                    <th className="px-2 py-2 text-left font-medium">Call Placed</th>
                    <th className="px-2 py-2 text-left font-medium">Call Time</th>
                    <th className="px-2 py-2 text-left font-medium">Duration</th>
                    <th className="px-2 py-2 text-left font-medium">Call Status</th>
                    <th className="px-2 py-2 text-left font-medium">User Input</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && events.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-slate-400 text-center">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                        </span>
                      </td>
                    </tr>
                  ) : events.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-slate-500 text-center">
                        No records in selected range.
                      </td>
                    </tr>
                  ) : (
                    events.map((e: any, idx: number) => (
                      <tr key={`${e.alertId || 'na'}-${idx}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                        <td className="px-2 py-2 font-mono text-white/80">{e.alertId || '-'}</td>
                        <td className="px-2 py-2 text-white/80">{e.vehicleReg || '-'}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/80">{fmt(e.eventTime, true)}</td>
                        <td className="px-2 py-2 text-white/80">{e.eventType || '-'}</td>
                        <td className="px-2 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] ${
                              e.closureStatus === 'Handled'
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                            }`}
                          >
                            {e.closureStatus || '-'}
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(e.closureDateTime, true)}</td>
                        <td className="px-2 py-2 text-white/70">{e.closedBy || '-'}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(e.gridTime, true)}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(e.autoCallPlaced || e.callPlaced, true)}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(e.autoCallTime || e.callTime, true)}</td>
                        <td className="px-2 py-2 text-white/70">{e.autoCallDuration ?? '-'}</td>
                        <td className="px-2 py-2 text-white/70">{displayCallStatus(e.autoCallStatus || e.callStatus)}</td>
                        <td className="px-2 py-2 text-white/70">{e.autoUserInput || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-indigo-300" />
              <div className="text-xs text-white/90 font-medium">Warning Console</div>
              <div className="ml-auto text-[10px] text-slate-500">{warnings.length} rows</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full text-[11px]">
                <thead className="bg-black/20 text-slate-400">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Warning ID</th>
                    <th className="px-2 py-2 text-left font-medium">Car</th>
                    <th className="px-2 py-2 text-left font-medium">Created</th>
                    <th className="px-2 py-2 text-left font-medium">Emitted</th>
                    <th className="px-2 py-2 text-left font-medium">Zone</th>
                    <th className="px-2 py-2 text-left font-medium">GPS Time</th>
                    <th className="px-2 py-2 text-left font-medium">Message</th>
                    <th className="px-2 py-2 text-left font-medium">Call Time</th>
                    <th className="px-2 py-2 text-left font-medium">Duration</th>
                    <th className="px-2 py-2 text-left font-medium">Call Status</th>
                    <th className="px-2 py-2 text-left font-medium">User Input</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && warnings.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-6 text-slate-400 text-center">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                        </span>
                      </td>
                    </tr>
                  ) : warnings.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-6 text-slate-500 text-center">
                        No records in selected range.
                      </td>
                    </tr>
                  ) : (
                    warnings.map((w: any, idx: number) => (
                      <tr key={`${w.warningId || 'na'}-${idx}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                        <td className="px-2 py-2 font-mono text-white/80">{w.warningId ?? '-'}</td>
                        <td className="px-2 py-2 text-white/80">{w.vehicleReg || '-'}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.createdTime, true)}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.emittedTime, true)}</td>
                        <td className="px-2 py-2 text-white/70">{w.zoneName || '-'}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.gpsTime, true)}</td>
                        <td className="px-2 py-2 text-white/70 max-w-[560px]">
                          <div className="truncate" title={w.messageText || ''}>{w.messageText || '-'}</div>
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.callTime, true)}</td>
                        <td className="px-2 py-2 text-white/70">{w.callDuration ?? '-'}</td>
                        <td className="px-2 py-2 text-white/70">{displayCallStatus(w.callStatus)}</td>
                        <td className="px-2 py-2 text-white/70">{w.userInput || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

