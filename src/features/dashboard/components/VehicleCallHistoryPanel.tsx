import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Megaphone,
  Phone,
  AlertCircle,
  RotateCw,
  MapPin,
  AlertTriangle,
  MessageSquare,
  Clock,
} from 'lucide-react';
import { api } from '@services/api';

type CallRecord = {
  id: string;
  calldate: string;
  duration: number;
  callStatus: string;
  userInput: string;
  phoneNumber: string;
  regNum: string;
  alertType: number;
  alertTypeName: string;
  logTime: string;
  soundFile: string;
};

interface VehicleCallHistoryPanelProps {
  crmData: Record<string, any> | null;
  vehicleName: string;
}

type Preset = '7d' | '30d' | '90d' | 'all';

const PRESETS: { key: Preset; label: string; days: number | null }[] = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
];

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  Received: { bg: 'bg-green-500/20', text: 'text-green-400' },
  Answered: { bg: 'bg-green-500/20', text: 'text-green-400' },
  'No Answer': { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  Failed: { bg: 'bg-red-500/20', text: 'text-red-400' },
  Busy: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  Cancelled: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
};

function parseCallType(soundFile: string, alertType: number): { label: string; Icon: any; color: string } {
  const sf = (soundFile || '').toLowerCase();
  if (sf.includes('batterytemper') || sf.includes('battery')) {
    return { label: 'Battery Tamper', Icon: AlertTriangle, color: 'text-orange-400' };
  }
  if (sf.includes('latenight')) {
    return { label: 'Late Night', Icon: Clock, color: 'text-indigo-400' };
  }
  if (sf.includes('fence') || sf.includes('geofence')) {
    return { label: 'Fence', Icon: MapPin, color: 'text-cyan-400' };
  }
  if (alertType === 2) return { label: 'Warning', Icon: MapPin, color: 'text-cyan-400' };
  return { label: 'Event', Icon: AlertTriangle, color: 'text-orange-400' };
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi',
  day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: true,
});

function formatCallDate(value: string): string {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return dateFmt.format(d);
  } catch { return value; }
}

function formatDuration(sec?: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function toSqlStamp(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function rangeFor(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = toSqlStamp(now);
  const days = PRESETS.find((p) => p.key === preset)?.days ?? null;
  if (days === null) return { from: '2000-01-01 00:00:00', to };
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: toSqlStamp(start), to };
}

function formatCallStatus(raw: string): string {
  if (!raw) return '—';
  if (raw.toLowerCase() === 'no call') return 'No Answer';
  if (raw.toLowerCase() === 'failed') return 'No Answer';
  return raw;
}

export default function VehicleCallHistoryPanel({ crmData, vehicleName }: VehicleCallHistoryPanelProps) {
  const [preset, setPreset] = useState<Preset>('30d');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const introDoneRef = useRef(false);

  useEffect(() => {
    if (!vehicleName) {
      setCalls([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const fetchAll = async () => {
      setLoading(true);
      setError(null);
      const { from, to } = rangeFor(preset);

      try {
        const autoRes = await api.robocall.getHistory(vehicleName, from, to) as any;

        if (cancelled) return;

        const list: CallRecord[] = [];
        if (autoRes.success && Array.isArray(autoRes.data)) {
          for (const r of autoRes.data) {
            list.push({
              id: `auto-${r.CLId}`,
              calldate: r.LogTime,
              duration: r.Duration || 0,
              callStatus: formatCallStatus(r.CallStatus),
              userInput: r.UserInput || '',
              phoneNumber: r.PhoneNumber || '—',
              regNum: r.RegNum || vehicleName,
              alertType: r.AlertType,
              alertTypeName: r.AlertTypeName || 'Unknown',
              logTime: r.LogTime,
              soundFile: r.SoundFile || '',
            });
          }
        }

        list.sort((a, b) => {
          const da = new Date(a.calldate).getTime();
          const db = new Date(b.calldate).getTime();
          return db - da;
        });
        setCalls(list);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load call history');
      }
      setLoading(false);
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [vehicleName, preset, reloadKey]);

  useEffect(() => {
    if (calls.length > 0) introDoneRef.current = true;
  }, [calls]);

  const retry = () => setReloadKey((k) => k + 1);

  if (!vehicleName) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500 p-4">
        <Phone className="w-10 h-10 mb-2 opacity-30" />
        <p className="text-xs text-center">No vehicle selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-white/6 lg-tab-bar flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                preset === p.key
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!loading && !error && (
          <span className="text-[10px] text-slate-500 truncate">
            {calls.length} call{calls.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="lg-card-static rounded-lg px-3 py-2">
              <div className="flex items-center gap-2.5 animate-pulse">
                <div className="w-4 h-4 rounded-full bg-white/10 shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="h-2.5 w-2/3 rounded bg-white/10" />
                  <div className="h-2 w-2/5 rounded bg-white/10" />
                </div>
                <div className="h-4 w-12 rounded bg-white/10 shrink-0" />
              </div>
            </div>
          ))
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <AlertCircle className="w-7 h-7 mb-2 text-red-400/70" />
            <p className="text-xs text-center mb-3 max-w-[240px]">{error}</p>
            <button onClick={retry} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300">
              <RotateCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500">
            <Megaphone className="w-7 h-7 mb-2 opacity-50" />
            <p className="text-xs text-center">No autocalls found for this vehicle in the selected period</p>
          </div>
        ) : (
          calls.map((c, index) => {
            const badge = parseCallType(c.soundFile, c.alertType);
            const statusStyle = STATUS_STYLES[c.callStatus] || STATUS_STYLES['No Answer'];
            const timeStr = formatCallDate(c.calldate);
            const durStr = c.duration ? formatDuration(c.duration) : null;
            return (
              <motion.div
                key={c.id || index}
                initial={introDoneRef.current ? false : { opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], delay: introDoneRef.current ? 0 : Math.min(index, 8) * 0.04 }}
                className="lg-card-static rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2.5">
                  <Megaphone className="w-4 h-4 text-purple-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] min-w-0 flex-wrap">
                      <span className="text-white font-medium shrink-0">{timeStr}</span>
                      {durStr && <span className="text-slate-400 shrink-0">{durStr}</span>}
                      <span className={`inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded ${badge.color} bg-white/5 shrink-0`}>
                        <badge.Icon className="w-2.5 h-2.5" />
                        {badge.label}
                      </span>
                      {c.userInput && (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-300 shrink-0">
                          <MessageSquare className="w-2.5 h-2.5" />
                          {c.userInput}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-0.5 min-w-0">
                      <span className="truncate">{c.phoneNumber}</span>
                    </div>
                  </div>
                  <span className={`justify-self-end px-1.5 py-0.5 rounded text-[9px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                    {c.callStatus}
                  </span>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
