import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCdr, getCdrSummary, getCdrTopCallers, api, extractError } from '../api';
import type { CdrFilters } from '../api';
import type { CdrRecord, CdrSummary } from '../types';
import { useAdminAuthStore } from '@features/pbx-admin';
import {
  BarChart2, Loader2, AlertCircle, Phone, Clock, CheckCircle, XCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Play, Pause, Download, Filter,
  Calendar, PhoneIncoming, PhoneOutgoing, Users, X, ChevronLeft, ChevronRight,
  SkipBack, SkipForward, Volume2, VolumeX,
} from 'lucide-react';

function formatDuration(seconds?: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDurationLong(seconds?: number): string {
  if (!seconds || seconds < 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function dispositionColor(d?: string): string {
  const disp = (d || '').toUpperCase();
  if (disp === 'ANSWERED') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (disp === 'NO ANSWER' || disp === 'NOANSWER') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  if (disp === 'BUSY') return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Audio Player Component ───────────────────────────────────────────────────

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface AudioPlayerProps {
  src: string | null;
  label: string;
  onClose: () => void;
  onDownload?: () => void;
}

function AudioPlayerBar({ src, label, onClose, onDownload }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!src) return;
    const audio = new Audio(src);
    audioRef.current = audio;
    setLoading(true);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      setLoading(false);
    });
    audio.addEventListener('canplay', () => setLoading(false));
    audio.addEventListener('ended', () => setPlaying(false));
    audio.addEventListener('error', () => setLoading(false));

    audio.play().then(() => setPlaying(true)).catch(() => {});

    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.src = '';
    };
  }, [src]);

  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio && playing && !seeking) {
        setCurrentTime(audio.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, seeking]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const handleSeekStart = () => {
    setSeeking(true);
    setSeekValue(currentTime);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeekValue(Number(e.target.value));
  };

  const handleSeekEnd = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = seekValue;
      setCurrentTime(seekValue);
    }
    setSeeking(false);
  };

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
    setCurrentTime(audio.currentTime);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !muted;
    setMuted(next);
    audio.muted = next;
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
    if (v > 0 && muted) { setMuted(false); if (audioRef.current) audioRef.current.muted = false; }
  };

  const progress = duration > 0 ? ((seeking ? seekValue : currentTime) / duration) * 100 : 0;

  if (!src) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-2xl border-t border-slate-700/60 shadow-2xl">
      {/* Progress track (thin bar at very top of player) */}
      <div className="h-1 bg-slate-800 w-full">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-[width] duration-100" style={{ width: `${progress}%` }} />
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
        {/* Left: Track info */}
        <div className="flex items-center gap-3 min-w-0 w-48 flex-shrink-0">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
            <Phone className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{label}</p>
            <p className="text-xs text-slate-500">{loading ? 'Loading…' : 'Call Recording'}</p>
          </div>
        </div>

        {/* Center: Controls + Seek */}
        <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          {/* Playback controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => skip(-10)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Back 10s"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={togglePlay}
              disabled={loading}
              className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 text-slate-900 animate-spin" />
              ) : playing ? (
                <Pause className="w-4 h-4 text-slate-900" />
              ) : (
                <Play className="w-4 h-4 text-slate-900 ml-0.5" />
              )}
            </button>
            <button
              onClick={() => skip(10)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Forward 10s"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Seek bar */}
          <div className="flex items-center gap-2.5 w-full max-w-2xl">
            <span className="text-[11px] text-slate-500 font-mono w-10 text-right tabular-nums">
              {fmtTime(seeking ? seekValue : currentTime)}
            </span>
            <div className="flex-1 relative group">
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={seeking ? seekValue : currentTime}
                onMouseDown={handleSeekStart}
                onTouchStart={handleSeekStart}
                onChange={handleSeekChange}
                onMouseUp={handleSeekEnd}
                onTouchEnd={handleSeekEnd}
                className="w-full h-1.5 rounded-full appearance-none bg-slate-700 cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-indigo-500
                  [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125
                  [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-indigo-500"
                style={{
                  background: `linear-gradient(to right, rgb(99 102 241) ${progress}%, rgb(51 65 85) ${progress}%)`,
                }}
              />
            </div>
            <span className="text-[11px] text-slate-500 font-mono w-10 tabular-nums">
              {fmtTime(duration)}
            </span>
          </div>
        </div>

        {/* Right: Volume + Actions */}
        <div className="flex items-center gap-3 w-48 justify-end flex-shrink-0">
          <button onClick={toggleMute} className="text-slate-400 hover:text-white transition-colors">
            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolume}
            className="w-20 h-1 rounded-full appearance-none bg-slate-700 cursor-pointer hidden sm:block
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
              [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-white"
          />
          {onDownload && (
            <button onClick={onDownload} className="text-slate-400 hover:text-indigo-400 transition-colors" title="Download">
              <Download className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-red-400 transition-colors" title="Close player">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CDR Page ─────────────────────────────────────────────────────────────────

type SortKey = 'callDate' | 'src' | 'dst' | 'duration' | 'disposition' | 'direction';
type SortDir = 'asc' | 'desc';

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

export function CdrPageV2() {
  const { toasts, toast } = usePageToast();
  const token = useAdminAuthStore((s) => s.token);

  const today = toDateInputValue(new Date());
  const defaultStart = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return toDateInputValue(d); })();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const [srcFilter, setSrcFilter] = useState('');
  const [dstFilter, setDstFilter] = useState('');
  const [disposition, setDisposition] = useState('');
  const [minDuration, setMinDuration] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [sortKey, setSortKey] = useState<SortKey>('callDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showTopCallers, setShowTopCallers] = useState(false);
  const [playingUuid, setPlayingUuid] = useState<string | null>(null);
  const [playerSrc, setPlayerSrc] = useState<string | null>(null);
  const [playerLabel, setPlayerLabel] = useState('');
  const [playerLoading, setPlayerLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const audioBlobUrlRef = useRef<string | null>(null);

  const setPreset = (preset: 'today' | 'yesterday' | '7days' | '30days') => {
    const now = new Date();
    let start: Date;
    let end: Date = new Date(now);
    switch (preset) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        break;
      case 'yesterday': {
        start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
        break;
      }
      case '7days':
        start = new Date(now);
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start = new Date(now);
        start.setDate(start.getDate() - 30);
        break;
    }
    setStartDate(toDateInputValue(start));
    setEndDate(toDateInputValue(end));
    setPage(0);
  };

  const filters: CdrFilters = {
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(srcFilter && { src: srcFilter }),
    ...(dstFilter && { dst: dstFilter }),
    ...(disposition && { disposition }),
    ...(minDuration > 0 && { minDuration }),
    limit: pageSize,
    offset: page * pageSize,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cdr-v2', filters],
    queryFn: () => getCdr(filters),
    staleTime: 60_000,
  });

  const dateParams = {
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(!startDate && !endDate && { days: 7 }),
  };

  const summaryQ = useQuery({
    queryKey: ['cdr-summary-v2', dateParams],
    queryFn: () => getCdrSummary(dateParams),
    staleTime: 60_000,
  });

  const topCallersQ = useQuery({
    queryKey: ['cdr-top-callers-v2', dateParams],
    queryFn: () => getCdrTopCallers({ ...dateParams, limit: 20 }),
    staleTime: 60_000,
    enabled: showTopCallers,
  });

  const records = data?.records || [];
  const total = data?.total || 0;
  const summary = summaryQ.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const sorted = useMemo(() => {
    const copy = [...records];
    copy.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case 'callDate': aVal = a.callDate || ''; bVal = b.callDate || ''; break;
        case 'src': aVal = a.src || ''; bVal = b.src || ''; break;
        case 'dst': aVal = a.dst || ''; bVal = b.dst || ''; break;
        case 'duration': aVal = a.billsec || 0; bVal = b.billsec || 0; break;
        case 'disposition': aVal = a.disposition || ''; bVal = b.disposition || ''; break;
        case 'direction': aVal = a.direction || ''; bVal = b.direction || ''; break;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [records, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-slate-600" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-indigo-400" />
      : <ArrowDown className="w-3 h-3 text-indigo-400" />;
  };

  const playRecording = useCallback(async (rec: CdrRecord) => {
    if (playingUuid === rec.uuid) {
      closePlayer();
      return;
    }
    try {
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current);
        audioBlobUrlRef.current = null;
      }
      setPlayingUuid(rec.uuid);
      setPlayerSrc(null);
      setPlayerLabel(`${rec.src || 'Unknown'} → ${rec.dst || 'Unknown'}`);
      setPlayerLoading(true);

      const res = await fetch(`/api/pbx-admin/cdr/recording/${rec.uuid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Recording not available');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioBlobUrlRef.current = url;
      setPlayerSrc(url);
      setPlayerLoading(false);
    } catch (err) {
      setPlayingUuid(null);
      setPlayerSrc(null);
      setPlayerLoading(false);
      toast('error', extractError(err));
    }
  }, [playingUuid, token, toast]);

  const closePlayer = useCallback(() => {
    setPlayingUuid(null);
    setPlayerSrc(null);
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
  }, []);

  const downloadRecording = useCallback(async () => {
    if (!playingUuid) return;
    try {
      const res = await fetch(`/api/pbx-admin/cdr/recording/${playingUuid}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('content-disposition');
      const match = cd?.match(/filename="?(.+?)"?$/);
      a.download = match?.[1] || `recording-${playingUuid}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('error', extractError(err));
    }
  }, [playingUuid, token, toast]);

  const exportCsv = useCallback(async () => {
    try {
      const exportFilters: CdrFilters = {
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(srcFilter && { src: srcFilter }),
        ...(dstFilter && { dst: dstFilter }),
        ...(disposition && { disposition }),
        ...(minDuration > 0 && { minDuration }),
        limit: 9999,
        offset: 0,
      };
      const result = await getCdr(exportFilters);
      const header = 'Date,Direction,Source,Destination,Duration (s),Status,Has Recording\n';
      const rows = result.records.map((r) =>
        [
          r.callDate || '',
          r.direction || '',
          r.src || '',
          r.dst || '',
          r.billsec || 0,
          r.disposition || '',
          r.hasRecording ? 'Yes' : 'No',
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      const blob = new Blob([header + rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cdr-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('success', `Exported ${result.records.length} records`);
    } catch (err) {
      toast('error', extractError(err));
    }
  }, [startDate, endDate, srcFilter, dstFilter, disposition, minDuration, toast]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Call History</h1>
          <p className="text-slate-400 mt-1 font-medium">CDR — call detail records and statistics</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTopCallers((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all border ${
              showTopCallers
                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" /> Top Callers
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 bg-slate-800/50 border border-slate-700/50 text-slate-400 hover:text-white px-3 py-2 rounded-lg text-sm font-semibold transition-all"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all border ${
              showFilters
                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-white'
            }`}
          >
            <Filter className="w-4 h-4" /> Filters
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Calls', value: summary.totalCalls, icon: Phone, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
            { label: 'Answered', value: summary.answeredCalls, icon: CheckCircle, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
            { label: 'Missed', value: summary.missedCalls, icon: XCircle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
            { label: 'Avg Duration', value: formatDurationLong(summary.avgDuration), icon: Clock, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
            { label: 'Answer Rate', value: `${Math.round(summary.answerRate ?? 0)}%`, icon: BarChart2, color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className={`bg-slate-800/50 backdrop-blur-xl rounded-2xl border p-4 ${color.split(' ').slice(1).join(' ')}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color.split(' ')[0]}`} />
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{label}</p>
              </div>
              <p className={`text-2xl font-bold ${color.split(' ')[0]}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-bold text-white">Quick Presets</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ['Today', 'today'],
              ['Yesterday', 'yesterday'],
              ['Last 7 Days', '7days'],
              ['Last 30 Days', '30days'],
            ] as const).map(([label, preset]) => (
              <button
                key={preset}
                onClick={() => setPreset(preset)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-700/50 text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-400 border border-slate-600/40 hover:border-indigo-500/30 transition-all"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                max={today}
                onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">End Date</label>
              <input
                type="date"
                value={endDate}
                max={today}
                onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Source</label>
              <input
                type="text"
                value={srcFilter}
                onChange={(e) => { setSrcFilter(e.target.value); setPage(0); }}
                placeholder="Any source…"
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Destination</label>
              <input
                type="text"
                value={dstFilter}
                onChange={(e) => { setDstFilter(e.target.value); setPage(0); }}
                placeholder="Any destination…"
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Disposition</label>
              <select
                value={disposition}
                onChange={(e) => { setDisposition(e.target.value); setPage(0); }}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              >
                <option value="">All</option>
                <option value="ANSWERED">Answered</option>
                <option value="NO ANSWER">No Answer</option>
                <option value="BUSY">Busy</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Min Duration: {minDuration}s
              </label>
              <input
                type="range"
                min={0}
                max={600}
                step={5}
                value={minDuration}
                onChange={(e) => { setMinDuration(Number(e.target.value)); setPage(0); }}
                className="w-full accent-indigo-500 mt-2"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Main CDR Table */}
        <div className={`bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden flex-1 min-w-0`}>
          {isLoading && (
            <div className="flex flex-col items-center justify-center p-20">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Loading call records…</p>
            </div>
          )}
          {isError && (
            <div className="flex flex-col items-center justify-center p-16">
              <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
              <p className="text-white font-semibold">Failed to load CDR</p>
            </div>
          )}
          {!isLoading && !isError && records.length === 0 && (
            <div className="flex flex-col items-center justify-center p-16">
              <BarChart2 className="w-12 h-12 text-slate-500 mb-4" />
              <h3 className="text-lg font-semibold text-white mb-1">No Call Records</h3>
              <p className="text-slate-400 text-sm">No CDR data found for the selected filters</p>
            </div>
          )}
          {!isLoading && !isError && records.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-900/40 border-b border-slate-700/50">
                      {([
                        ['Date', 'callDate', true],
                        ['Direction', 'direction', false],
                        ['Source', 'src', true],
                        ['Destination', 'dst', true],
                        ['Duration', 'duration', true],
                        ['Status', 'disposition', true],
                        ['Recording', null, false],
                      ] as const).map(([label, key, sortable]) => (
                        <th
                          key={label}
                          onClick={sortable && key ? () => toggleSort(key as SortKey) : undefined}
                          className={`px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest ${
                            sortable ? 'cursor-pointer hover:text-white select-none' : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            {label}
                            {sortable && key && <SortIcon col={key as SortKey} />}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {sorted.map((rec) => (
                      <tr key={rec.uuid} className="hover:bg-slate-700/10 transition-colors">
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                          {rec.callDate ? new Date(rec.callDate).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {rec.direction?.toLowerCase() === 'inbound' || rec.direction?.toLowerCase() === 'in' ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                              <PhoneIncoming className="w-3 h-3" /> In
                            </span>
                          ) : rec.direction?.toLowerCase() === 'outbound' || rec.direction?.toLowerCase() === 'out' ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold">
                              <PhoneOutgoing className="w-3 h-3" /> Out
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm text-white font-mono">{rec.src || '—'}</p>
                            {rec.callerIdName && <p className="text-xs text-slate-500">{rec.callerIdName}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm text-white font-mono">{rec.dst || '—'}</p>
                            {rec.destCallerIdName && <p className="text-xs text-slate-500">{rec.destCallerIdName}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDuration(rec.billsec)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${dispositionColor(rec.disposition)}`}>
                            {rec.disposition || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {rec.hasRecording ? (
                            <button
                              onClick={() => playRecording(rec)}
                              className={`p-1.5 rounded-lg transition-all ${
                                playingUuid === rec.uuid
                                  ? 'text-indigo-400 bg-indigo-500/10'
                                  : 'text-slate-400 hover:text-indigo-400'
                              }`}
                              title={playingUuid === rec.uuid ? 'Stop' : 'Play recording'}
                            >
                              {playerLoading && playingUuid === rec.uuid
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : playingUuid === rec.uuid
                                ? <Pause className="w-4 h-4" />
                                : <Play className="w-4 h-4" />}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/40">
                <p className="text-xs text-slate-500">
                  Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Previous
                  </button>
                  <span className="text-xs text-slate-400">Page {page + 1} of {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Top Callers Side Panel */}
        {showTopCallers && (
          <div className="w-80 flex-shrink-0 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 self-start">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Top Callers</h3>
              <button onClick={() => setShowTopCallers(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            {topCallersQ.isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
              </div>
            )}
            {topCallersQ.isError && (
              <p className="text-sm text-red-400">Failed to load top callers</p>
            )}
            {topCallersQ.data && topCallersQ.data.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No data</p>
            )}
            {topCallersQ.data && topCallersQ.data.length > 0 && (
              <div className="space-y-2">
                {topCallersQ.data.map((caller: any, i: number) => (
                  <div key={caller.number || i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-700/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-slate-500 w-5 text-right flex-shrink-0">{i + 1}</span>
                      <span className="text-sm text-white font-mono truncate">{caller.number || caller.src || '—'}</span>
                    </div>
                    <span className="text-xs font-bold text-indigo-400 flex-shrink-0 ml-2">{caller.count ?? caller.calls ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom spacer when player is open */}
      {playingUuid && <div className="h-24" />}

      {/* Audio Player Bar */}
      {playingUuid && (
        <AudioPlayerBar
          src={playerSrc}
          label={playerLabel}
          onClose={closePlayer}
          onDownload={downloadRecording}
        />
      )}

      {/* Toasts */}
      <div className={`fixed ${playingUuid ? 'bottom-24' : 'bottom-6'} right-6 z-50 space-y-3 pointer-events-none transition-all`}>
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
