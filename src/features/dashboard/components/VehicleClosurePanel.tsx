import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@services/api';

type RangeKey = '24h' | '7d' | '30d';
type EventScope = 'tdd' | 'all';

function rangeToFrom(range: RangeKey, endAt: Date): Date {
  const ms =
    range === '24h' ? 24 * 60 * 60 * 1000 :
    range === '7d' ? 7 * 24 * 60 * 60 * 1000 :
    30 * 24 * 60 * 60 * 1000;
  return new Date(endAt.getTime() - ms);
}

// MSSQL datetime columns are timezone-less but Node serializes them with a
// trailing 'Z' (UTC). Rendering with the browser's local timezone (PKT, +5)
// then shifts the value forward by 5 hours. Read the UTC parts directly so
// we display the wall-clock time exactly as stored.
function fmt(value: any, withSeconds = false): string {
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

  // Boss-friendly mapping
  if (lower === 'no call') return 'No answer';
  if (lower === 'failed') return 'No answer';

  return s;
}

export default function VehicleClosurePanel({
  objectId,
  vehicleName,
}: {
  objectId: string;
  vehicleName: string;
}) {
  const [range, setRange] = useState<RangeKey>('7d');
  const [eventScope, setEventScope] = useState<EventScope>('tdd');
  const [endAt, setEndAt] = useState<Date>(() => new Date());
  const from = useMemo(() => rangeToFrom(range, endAt), [range, endAt]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);

  const fetchClosure = useCallback(async () => {
    const oid = Number(objectId);
    if (Number.isNaN(oid)) return;

    setLoading(true);
    setError(null);
    try {
      const res = await api.closure.get(oid, from.toISOString(), endAt.toISOString(), { limit: 300, scope: eventScope }) as any;
      if (!res?.success) throw new Error(res?.error || 'Failed to fetch closure data');
      setEvents(res.data?.events || []);
      setWarnings(res.data?.warnings || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch closure data');
      setEvents([]);
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [objectId, from, endAt, eventScope]);

  useEffect(() => {
    fetchClosure();
  }, [fetchClosure]);

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* Controls */}
      <div className="px-3 py-2 border-b border-white/6 flex items-center gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-[10px] text-slate-500 uppercase">Closure</div>
          <div className="text-[11px] text-white/80 truncate" title={vehicleName}>
            {vehicleName} · <span className="text-white/60 font-mono">ObjectId {objectId}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <select
            value={eventScope}
            onChange={(e) => setEventScope(e.target.value as EventScope)}
            className="text-[11px] bg-white/5 border border-white/10 rounded px-2 py-1 text-white/80 focus:outline-none focus:border-primary-500/60"
            title="EventLog filter"
            style={{ colorScheme: 'dark' }}
          >
            <option value="tdd">TDD events only</option>
            <option value="all">All EventLog</option>
          </select>
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value as RangeKey);
              setEndAt(new Date());
            }}
            className="text-[11px] bg-white/5 border border-white/10 rounded px-2 py-1 text-white/80 focus:outline-none focus:border-primary-500/60"
            title="Quick range"
            style={{ colorScheme: 'dark' }}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>

          <button
            type="button"
            onClick={() => {
              setEndAt(new Date());
              fetchClosure();
            }}
            disabled={loading}
            className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto min-w-0 p-3 space-y-3">
        {error && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-xs min-w-0">
              <div className="font-medium">Failed to load closure data</div>
              <div className="text-red-200/80 break-words">{error}</div>
            </div>
          </div>
        )}

        {/* EventLog Closure */}
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-emerald-300" />
            <div className="text-xs text-white/90 font-medium">Event Log (Closure)</div>
            <div className="ml-auto text-[10px] text-slate-500">{events.length} rows</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-[11px]">
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
                        No EventLog rows in this range.
                      </td>
                    </tr>
                  ) : (
                    events.map((e: any, idx: number) => (
                      <tr key={`${e.alertId || 'na'}-${idx}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                        <td className="px-2 py-2 font-mono text-white/80">{e.alertId || '-'}</td>
                        <td className="px-2 py-2 text-white/80">{vehicleName}</td>
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
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">
                          {fmt(e.autoCallPlaced || e.callPlaced, true)}
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">
                          {fmt(e.autoCallTime || e.callTime, true)}
                        </td>
                        <td className="px-2 py-2 text-white/70">{e.autoCallDuration ?? '-'}</td>
                        <td className="px-2 py-2 text-white/70">
                          {displayCallStatus(e.autoCallStatus || e.callStatus)}
                        </td>
                        <td className="px-2 py-2 text-white/70">{e.autoUserInput || '-'}</td>
                      </tr>
                    ))
                  )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Warning Console */}
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-indigo-300" />
            <div className="text-xs text-white/90 font-medium">Warning Console</div>
            <div className="ml-auto text-[10px] text-slate-500">{warnings.length} rows</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1120px] w-full text-[11px]">
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
                        No Warning Console rows in this range.
                      </td>
                    </tr>
                  ) : (
                    warnings.map((w: any, idx: number) => (
                      <tr key={`${w.warningId || 'na'}-${idx}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                        <td className="px-2 py-2 font-mono text-white/80">{w.warningId ?? '-'}</td>
                        <td className="px-2 py-2 text-white/80">{vehicleName}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.createdTime, true)}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.emittedTime, true)}</td>
                        <td className="px-2 py-2 text-white/70">{w.zoneName || '-'}</td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.gpsTime, true)}</td>
                        <td className="px-2 py-2 text-white/70 max-w-[520px]">
                          <div className="truncate" title={w.messageText || ''}>{w.messageText || '-'}</div>
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums text-white/70">{fmt(w.callTime, true)}</td>
                        <td className="px-2 py-2 text-white/70">{w.callDuration ?? '-'}</td>
                        <td className="px-2 py-2 text-white/70">{displayCallStatus(w.callStatus)}</td>
                        <td className="px-2 py-2 text-white/70">{w.userInput ?? '-'}</td>
                      </tr>
                    ))
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

