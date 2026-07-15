import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Search, Download,
  Calendar, Filter, X, ChevronLeft, ChevronRight, BarChart3, RefreshCw,
  CheckCircle, AlertCircle, XCircle, ChevronsLeft, ChevronsRight,
  ChevronDown, ChevronUp, PanelRightOpen, PanelRightClose,
  Play, Pause, Volume2, FileAudio,
} from 'lucide-react';

interface CdrRecord {
  calldate: string;
  src: string;
  dst: string;
  duration: number;
  billsec: number;
  disposition: string;
  dcontext: string;
  channel: string;
  clid: string;
  uniqueid: string;
}

interface Summary {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  busyCalls: number;
  failedCalls: number;
  totalDuration: number;
  avgDuration: number;
  answerRate: number;
}

interface TopCaller {
  number: string;
  count: number;
}

type SortField = 'calldate' | 'src' | 'dst' | 'duration' | 'billsec' | 'disposition' | 'dcontext' | 'channel';
type SortDir = 'asc' | 'desc';

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(isoString: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

const DISPOSITIONS = [
  { value: '', label: 'All Dispositions' },
  { value: 'ANSWERED', label: 'Answered' },
  { value: 'NO ANSWER', label: 'No Answer' },
  { value: 'BUSY', label: 'Busy' },
  { value: 'FAILED', label: 'Failed' },
];

export function CdrPage() {
  const today = toDateString(new Date());

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [srcFilter, setSrcFilter] = useState('');
  const [dstFilter, setDstFilter] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('');
  const [minDuration, setMinDuration] = useState('');

  const [records, setRecords] = useState<CdrRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [topCallers, setTopCallers] = useState<TopCaller[]>([]);

  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [sortField, setSortField] = useState<SortField>('calldate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [showTopCallers, setShowTopCallers] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Recording playback state
  const [recordingsExist, setRecordingsExist] = useState<Set<string>>(new Set());
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Check which recordings exist for the current records
  const checkRecordings = useCallback(async (records: CdrRecord[]) => {
    const exists = new Set<string>();
    await Promise.all(
      records.map(async (r) => {
        if (!r.uniqueid || r.billsec < 1) return;
        try {
          const res = await adminApi(`/cdr/recording/${r.uniqueid}`, { method: 'HEAD' });
          if (res.status === 200) exists.add(r.uniqueid);
        } catch { /* recording doesn't exist */ }
      })
    );
    setRecordingsExist(exists);
  }, []);

  const fetchRecords = useCallback(async (page = currentPage) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate, endDate,
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      if (srcFilter) params.set('src', srcFilter);
      if (dstFilter) params.set('dst', dstFilter);
      if (dispositionFilter) params.set('disposition', dispositionFilter);
      if (minDuration) params.set('minDuration', minDuration);

      const res = await adminApi(`/cdr?${params.toString()}`);
      const data = await res.json();
      setRecords(data.records || []);
      setTotalRecords(data.total || 0);
      // Check for recordings after fetching
      if (data.records?.length) {
        checkRecordings(data.records);
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to fetch call records' });
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, srcFilter, dstFilter, dispositionFilter, minDuration, pageSize, currentPage, checkRecordings]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const [sumRes, topRes] = await Promise.all([
        adminApi(`/cdr/summary?${params.toString()}`),
        adminApi(`/cdr/top-callers?${params.toString()}`),
      ]);
      const sumData = await sumRes.json();
      const topData = await topRes.json();
      setSummary(sumData.summary || null);
      setTopCallers(topData.topCallers || []);
    } catch {
      setSummary(null);
      setTopCallers([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchRecords(1);
    fetchSummary();
    setCurrentPage(1);
  }, [startDate, endDate]);

  const handleSearch = () => {
    setCurrentPage(1);
    fetchRecords(1);
    fetchSummary();
  };

  const handleClearFilters = () => {
    setSrcFilter('');
    setDstFilter('');
    setDispositionFilter('');
    setMinDuration('');
    setStartDate(today);
    setEndDate(today);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchRecords(page);
  };

  // Recording handlers — must use authenticated fetch (direct URLs won't have JWT)
  const playRecording = async (uniqueid: string) => {
    if (currentlyPlaying === uniqueid) {
      audioRef.current?.pause();
      setCurrentlyPlaying(null);
      return;
    }

    audioRef.current?.pause();
    setCurrentlyPlaying(uniqueid);

    try {
      const res = await adminApi(`/cdr/recording/${uniqueid}`);
      if (!res.ok) throw new Error('Failed to fetch recording');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setCurrentlyPlaying(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setToast({ type: 'error', message: 'Recording playback failed' });
        setCurrentlyPlaying(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch {
      setToast({ type: 'error', message: 'Failed to play recording' });
      setCurrentlyPlaying(null);
    }
  };

  const downloadRecording = async (uniqueid: string, calldate: string) => {
    try {
      const res = await adminApi(`/cdr/recording/${uniqueid}/download?calldate=${encodeURIComponent(calldate)}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeDate = calldate.split('T')[0] || calldate.split(' ')[0];
      link.download = `call_${safeDate}_${uniqueid}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setToast({ type: 'error', message: 'Failed to download recording' });
    }
  };

  const setQuickRange = (label: string) => {
    const now = new Date();
    let s: Date, e: Date;
    switch (label) {
      case 'Today':
        s = e = now;
        break;
      case 'Yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        s = e = y;
        break;
      }
      case 'Last 7 Days': {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        s = d; e = now;
        break;
      }
      case 'Last 30 Days': {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        s = d; e = now;
        break;
      }
      case 'This Month':
        s = new Date(now.getFullYear(), now.getMonth(), 1);
        e = now;
        break;
      default:
        return;
    }
    setStartDate(toDateString(s));
    setEndDate(toDateString(e));
  };

  const sortedRecords = useMemo(() => {
    const sorted = [...records].sort((a, b) => {
      let av: string | number = (a as any)[sortField];
      let bv: string | number = (b as any)[sortField];
      if (sortField === 'duration' || sortField === 'billsec') {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
        return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
      }
      av = String(av || '').toLowerCase();
      bv = String(bv || '').toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [records, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'calldate' ? 'desc' : 'asc');
    }
  };

  const exportCsv = () => {
    if (sortedRecords.length === 0) return;
    const headers = ['Date/Time', 'Source', 'Destination', 'Duration (s)', 'Billable (s)', 'Disposition', 'Context', 'Channel'];
    const rows = sortedRecords.map(r => [
      r.calldate, r.src, r.dst, r.duration, r.billsec, r.disposition, r.dcontext, r.channel,
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cdr_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast({ type: 'success', message: `Exported ${sortedRecords.length} records to CSV` });
  };

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + sortedRecords.length, totalRecords);

  const dispositionBadge = (d: string) => {
    const upper = d?.toUpperCase() || '';
    if (upper === 'ANSWERED') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (upper === 'NO ANSWER') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (upper === 'BUSY') return 'bg-red-500/10 text-red-400 border-red-500/20';
    if (upper === 'FAILED') return 'bg-red-500/10 text-red-400 border-red-500/20';
    return 'bg-slate-600/20 text-slate-400 border-slate-600/20';
  };

  const dispositionIcon = (d: string) => {
    const upper = d?.toUpperCase() || '';
    if (upper === 'ANSWERED') return <CheckCircle className="w-3 h-3" />;
    if (upper === 'NO ANSWER') return <PhoneMissed className="w-3 h-3" />;
    if (upper === 'BUSY') return <AlertCircle className="w-3 h-3" />;
    if (upper === 'FAILED') return <XCircle className="w-3 h-3" />;
    return null;
  };

  const maxCallerCount = topCallers.length > 0 ? topCallers[0].count : 1;

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      onClick={() => handleSort(field)}
      className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none transition-colors"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field && (
          sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-emerald-400" /> : <ChevronDown className="w-3 h-3 text-emerald-400" />
        )}
      </span>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Call Detail Records</h1>
          <p className="text-slate-400 text-sm mt-1">View and analyze call history and performance metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTopCallers(v => !v)}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg flex items-center gap-2 transition-all"
          >
            {showTopCallers ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            Top Callers
          </button>
          <button
            onClick={exportCsv}
            disabled={sortedRecords.length === 0}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Date & Filter Bar */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex items-center gap-2">
            <input
              type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-slate-900/50 border border-slate-700/50 rounded-lg py-1.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 [color-scheme:dark]"
            />
            <span className="text-slate-500 text-sm">to</span>
            <input
              type="date" value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-slate-900/50 border border-slate-700/50 rounded-lg py-1.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 [color-scheme:dark]"
            />
          </div>
          <div className="h-6 w-px bg-slate-700/50 mx-1 hidden sm:block" />
          <div className="flex flex-wrap gap-1.5">
            {['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'This Month'].map(label => (
              <button
                key={label}
                onClick={() => setQuickRange(label)}
                className="px-2.5 py-1 text-xs rounded-md bg-slate-700/60 hover:bg-slate-600/80 text-slate-300 hover:text-white transition-all"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text" placeholder="Source number"
            value={srcFilter} onChange={e => setSrcFilter(e.target.value)}
            className="bg-slate-900/50 border border-slate-700/50 rounded-lg py-1.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 w-36"
          />
          <input
            type="text" placeholder="Destination number"
            value={dstFilter} onChange={e => setDstFilter(e.target.value)}
            className="bg-slate-900/50 border border-slate-700/50 rounded-lg py-1.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 w-40"
          />
          <select
            value={dispositionFilter} onChange={e => setDispositionFilter(e.target.value)}
            className="bg-slate-900/50 border border-slate-700/50 rounded-lg py-1.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50"
          >
            {DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleSearch}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-1.5 transition-all font-medium"
            >
              <Search className="w-3.5 h-3.5" /> Search
            </button>
            <button
              onClick={handleClearFilters}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg flex items-center gap-1.5 transition-all"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Calls"
          value={summary?.totalCalls ?? '—'}
          icon={<PhoneOutgoing className="w-5 h-5 text-blue-400" />}
          iconBg="bg-blue-500/10"
          loading={summaryLoading}
        />
        <StatCard
          label="Answered"
          value={summary?.answeredCalls ?? '—'}
          sub={summary ? `${summary.answerRate.toFixed(1)}% answer rate` : undefined}
          icon={<CheckCircle className="w-5 h-5 text-emerald-400" />}
          iconBg="bg-emerald-500/10"
          valueColor="text-emerald-400"
          loading={summaryLoading}
        />
        <StatCard
          label="Missed / No Answer"
          value={summary ? summary.missedCalls + summary.busyCalls : '—'}
          sub={summary ? `${summary.busyCalls} busy · ${summary.failedCalls} failed` : undefined}
          icon={<PhoneMissed className="w-5 h-5 text-amber-400" />}
          iconBg="bg-amber-500/10"
          valueColor="text-amber-400"
          loading={summaryLoading}
        />
        <StatCard
          label="Avg Duration"
          value={summary ? formatDuration(Math.round(summary.avgDuration)) : '—'}
          sub={summary ? `Total: ${formatDuration(summary.totalDuration)}` : undefined}
          icon={<Clock className="w-5 h-5 text-violet-400" />}
          iconBg="bg-violet-500/10"
          valueColor="text-violet-400"
          loading={summaryLoading}
        />
      </div>

      {/* Main Content: Table + Top Callers */}
      <div className="flex gap-4">
        {/* CDR Table */}
        <div className="flex-1 min-w-0 bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-520px)]">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-700/50 bg-slate-800">
                  <SortHeader field="calldate" label="Date/Time" />
                  <SortHeader field="src" label="Source (From)" />
                  <SortHeader field="dst" label="Destination (To)" />
                  <SortHeader field="duration" label="Duration" />
                  <SortHeader field="billsec" label="Billable" />
                  <SortHeader field="disposition" label="Disposition" />
                  <SortHeader field="dcontext" label="Context" />
                  <SortHeader field="channel" label="Channel" />
                  <th className="py-2 px-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Recording</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-500">
                      <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-sm">Loading call records...</p>
                    </td>
                  </tr>
                ) : sortedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-500">
                      <PhoneIncoming className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No call records found</p>
                      <p className="text-xs mt-1 text-slate-600">Try adjusting the date range or filters</p>
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((r, idx) => {
                    const hasRecording = recordingsExist.has(r.uniqueid);
                    const isPlaying = currentlyPlaying === r.uniqueid;
                    return (
                      <tr key={r.uniqueid || idx} className="hover:bg-slate-700/20 transition-colors">
                        <td className="py-2.5 px-4 text-slate-300 text-xs whitespace-nowrap">{formatDateTime(r.calldate)}</td>
                        <td className="py-2.5 px-4 text-white text-sm font-mono">{r.src || '—'}</td>
                        <td className="py-2.5 px-4 text-white text-sm font-mono">{r.dst || '—'}</td>
                        <td className="py-2.5 px-4 text-slate-300 text-sm">{formatDuration(r.duration)}</td>
                        <td className="py-2.5 px-4 text-slate-300 text-sm">{formatDuration(r.billsec)}</td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${dispositionBadge(r.disposition)}`}>
                            {dispositionIcon(r.disposition)}
                            {r.disposition}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="text-slate-400 text-xs bg-slate-700/40 px-2 py-0.5 rounded">{r.dcontext || '—'}</span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 text-xs font-mono max-w-[160px] truncate" title={r.channel}>
                          {r.channel || '—'}
                        </td>
                        <td className="py-2.5 px-4">
                          {hasRecording ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => playRecording(r.uniqueid)}
                                className={`p-1.5 rounded-lg transition-all ${
                                  isPlaying
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-700/50 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10'
                                }`}
                                title={isPlaying ? 'Stop playing' : 'Play recording'}
                              >
                                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => downloadRecording(r.uniqueid, r.calldate.split('T')[0])}
                                className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                                title="Download recording"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs" title="No recording available">
                              <FileAudio className="w-4 h-4 inline opacity-30" />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && totalRecords > 0 && (
            <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  Page <span className="text-white font-medium">{safePage}</span> of <span className="text-white font-medium">{totalPages}</span>
                  {' '}<span className="text-slate-500">({startIdx + 1}–{endIdx} of {totalRecords})</span>
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); handlePageChange(1); }}
                  className="bg-slate-700/60 border border-slate-600/50 rounded text-xs text-slate-300 py-1 px-2 focus:outline-none"
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={200}>200 / page</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handlePageChange(1)} disabled={safePage <= 1}
                  className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="First page">
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button onClick={() => handlePageChange(safePage - 1)} disabled={safePage <= 1}
                  className="px-2 py-1.5 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1">
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                  .reduce((acc: (number | 'dot')[], p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('dot');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === 'dot' ? (
                      <span key={`dot-${i}`} className="px-1.5 text-slate-600 text-xs">...</span>
                    ) : (
                      <button key={item} onClick={() => handlePageChange(item as number)}
                        className={`min-w-[32px] h-8 rounded text-xs font-medium transition-all ${
                          safePage === item
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                        }`}>
                        {item}
                      </button>
                    )
                  )}
                <button onClick={() => handlePageChange(safePage + 1)} disabled={safePage >= totalPages}
                  className="px-2 py-1.5 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1">
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handlePageChange(totalPages)} disabled={safePage >= totalPages}
                  className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="Last page">
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Top Callers Sidebar */}
        {showTopCallers && (
          <div className="w-72 shrink-0 bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-700/50 bg-slate-800/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-white">Top Callers</span>
              </div>
              <button
                onClick={() => setShowTopCallers(false)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700/50 transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {summaryLoading ? (
                <div className="py-8 text-center">
                  <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Loading...</p>
                </div>
              ) : topCallers.length === 0 ? (
                <div className="py-8 text-center text-slate-500">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No data available</p>
                </div>
              ) : (
                topCallers.slice(0, 20).map((caller, idx) => (
                  <div key={caller.number} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-slate-600 w-4 text-right shrink-0">{idx + 1}</span>
                        <span className="text-xs text-white font-mono truncate">{caller.number}</span>
                      </div>
                      <span className="text-xs text-slate-400 tabular-nums shrink-0 ml-2">{caller.count}</span>
                    </div>
                    <div className="ml-6 h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500/60 rounded-full transition-all duration-300"
                        style={{ width: `${(caller.count / maxCallerCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-3 animate-slide-in-right ${
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, sub, icon, iconBg, valueColor, loading }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  iconBg: string;
  valueColor?: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-slate-400 text-xs uppercase tracking-wider">{label}</p>
          {loading ? (
            <div className="h-8 flex items-center mt-1">
              <div className="w-5 h-5 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <p className={`text-2xl font-bold mt-1 ${valueColor || 'text-white'}`}>{value}</p>
              {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
            </>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
