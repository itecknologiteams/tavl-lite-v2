/**
 * CDR Dashboard — Call Detail Records viewer for Supervisors
 * Stats, filters, paginated table, recording playback, CSV export
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Clock,
  Download,
  Play,
  Pause,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Calendar,
  BarChart3,
  TrendingUp,
  Volume2,
  RefreshCw,
  PhoneOff,
} from 'lucide-react';

interface CDRRecord {
  id: number;
  calldate: string;
  clid: string;
  src: string;
  dst: string;
  dcontext: string;
  channel: string;
  dstchannel: string;
  lastapp: string;
  lastdata: string;
  duration: number;
  billsec: number;
  disposition: string;
  amaflags: number;
  accountcode: string;
  uniqueid: string;
  userfield: string;
  linkedid: string;
  cc_side?: string;
  answered_by?: string;   // agent extension that answered an inbound queue call
}

function resolveSourceDest(r: CDRRecord): { source: string; dest: string } {
  // Inbound: caller is the customer; destination is the agent who answered
  // (resolved server-side), falling back to the dialled DID if unanswered.
  if ((r.userfield || '').includes('inbound')) {
    return {
      source: r.src || '—',
      dest: r.answered_by ? `Ext ${r.answered_by}` : (r.dst || '—'),
    };
  }
  // Outbound / internal: source = originator, destination = dialled number.
  return { source: r.src || '—', dest: r.dst || '—' };
}

interface CDRStats {
  total_calls: string;
  answered: string;
  no_answer: string;
  busy: string;
  failed: string;
  other: string;
  inbound: string;
  outbound: string;
  internal: string;
  autocall: string;
  avg_duration: string;
  avg_billsec: string;
  max_duration: string;
  total_billsec: string;
  answer_rate: string;
}

interface HourlyData {
  hour: string;
  calls: string;
  answered: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const API_BASE = '/api/cdr';

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function DispositionBadge({ disposition }: { disposition: string }) {
  const config: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    'ANSWERED': { bg: 'bg-emerald-500/15 border-emerald-500/20', text: 'text-emerald-400', icon: <Phone className="w-3 h-3" /> },
    'NO ANSWER': { bg: 'bg-amber-500/15 border-amber-500/20', text: 'text-amber-400', icon: <PhoneMissed className="w-3 h-3" /> },
    'BUSY': { bg: 'bg-orange-500/15 border-orange-500/20', text: 'text-orange-400', icon: <PhoneOff className="w-3 h-3" /> },
    'FAILED': { bg: 'bg-red-500/15 border-red-500/20', text: 'text-red-400', icon: <PhoneOff className="w-3 h-3" /> },
  };
  const c = config[disposition] || { bg: 'bg-white/5 border-white/10', text: 'text-white/50', icon: <Phone className="w-3 h-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border ${c.bg} ${c.text}`}>
      {c.icon}
      {disposition}
    </span>
  );
}

function TypeBadge({ userfield }: { userfield: string }) {
  const config: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    'inbound': { bg: 'bg-blue-500/15 border-blue-500/20', text: 'text-blue-400', icon: <PhoneIncoming className="w-3 h-3" /> },
    'outbound': { bg: 'bg-violet-500/15 border-violet-500/20', text: 'text-violet-400', icon: <PhoneOutgoing className="w-3 h-3" /> },
    'internal': { bg: 'bg-cyan-500/15 border-cyan-500/20', text: 'text-cyan-400', icon: <Phone className="w-3 h-3" /> },
    'autocall': { bg: 'bg-amber-500/15 border-amber-500/20', text: 'text-amber-400', icon: <Phone className="w-3 h-3" /> },
  };
  const c = config[userfield] || { bg: 'bg-white/5 border-white/10', text: 'text-white/40', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border ${c.bg} ${c.text}`}>
      {c.icon}
      {userfield || 'unknown'}
    </span>
  );
}

function StatCard({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className={`lg-card rounded-2xl p-4 border ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/40 text-xs font-medium uppercase tracking-wider">{label}</span>
        <div className="p-1.5 rounded-lg bg-white/5">{icon}</div>
      </div>
      <div className="text-2xl font-bold text-white/90">{value}</div>
      {sub && <div className="text-[11px] text-white/30 mt-1">{sub}</div>}
    </div>
  );
}

export default function CDRDashboard() {
  const [records, setRecords] = useState<CDRRecord[]>([]);
  const [stats, setStats] = useState<CDRStats | null>(null);
  const [hourly, setHourly] = useState<HourlyData[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('calldate');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [showFilters, setShowFilters] = useState(false);

  // Recording currently loaded in the docked player bar.
  const [activeRec, setActiveRec] = useState<{ uniqueid: string; label: string } | null>(null);

  const fetchRecords = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pagination.limit),
        sortBy,
        sortOrder,
      });
      if (dateFrom) params.append('dateFrom', `${dateFrom}T00:00:00`);
      if (dateTo) params.append('dateTo', `${dateTo}T23:59:59`);
      if (searchTerm) params.append('search', searchTerm);
      if (dispositionFilter) params.append('disposition', dispositionFilter);
      if (typeFilter) params.append('userfield', typeFilter);

      const resp = await fetch(`${API_BASE}?${params}`);
      const json = await resp.json();
      if (json.success) {
        setRecords(json.data);
        setPagination(json.pagination);
      }
    } catch (err) {
      console.error('CDR fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, searchTerm, dispositionFilter, typeFilter, sortBy, sortOrder, pagination.limit]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', `${dateFrom}T00:00:00`);
      if (dateTo) params.append('dateTo', `${dateTo}T23:59:59`);

      const resp = await fetch(`${API_BASE}/stats?${params}`);
      const json = await resp.json();
      if (json.success) {
        setStats(json.stats);
        setHourly(json.hourly || []);
      }
    } catch (err) {
      console.error('CDR stats error:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchRecords(1);
    fetchStats();
  }, [dateFrom, dateTo, dispositionFilter, typeFilter, sortBy, sortOrder]);

  useEffect(() => {
    const timer = setTimeout(() => fetchRecords(1), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(col);
      setSortOrder('DESC');
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 text-white/20" />;
    return sortOrder === 'ASC' ? <ArrowUp className="w-3 h-3 text-violet-400" /> : <ArrowDown className="w-3 h-3 text-violet-400" />;
  };

  const [playError, setPlayError] = useState<string | null>(null);

  // Toggle the docked player bar for a row's recording.
  const openRecording = (r: CDRRecord) => {
    setPlayError(null);
    if (activeRec?.uniqueid === r.uniqueid) { setActiveRec(null); return; }
    const { source, dest } = resolveSourceDest(r);
    setActiveRec({ uniqueid: r.uniqueid, label: `${source} → ${dest} · ${formatDate(r.calldate)}` });
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('dateFrom', `${dateFrom}T00:00:00`);
    if (dateTo) params.append('dateTo', `${dateTo}T23:59:59`);
    if (dispositionFilter) params.append('disposition', dispositionFilter);
    if (typeFilter) params.append('userfield', typeFilter);
    window.open(`${API_BASE}/export?${params}`, '_blank');
  };

  const maxHourly = Math.max(...hourly.map(h => parseInt(h.calls) || 0), 1);

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Stats Cards */}
      <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard
          label="Total Calls"
          value={stats ? parseInt(stats.total_calls).toLocaleString() : '...'}
          sub={`${dateFrom} → ${dateTo}`}
          icon={<Phone className="w-4 h-4 text-violet-400" />}
          color="border-violet-500/15"
        />
        <StatCard
          label="Answered"
          value={stats ? parseInt(stats.answered).toLocaleString() : '...'}
          sub={stats ? `${stats.answer_rate || 0}% answer rate` : ''}
          icon={<Phone className="w-4 h-4 text-emerald-400" />}
          color="border-emerald-500/15"
        />
        <StatCard
          label="Missed"
          value={stats ? parseInt(stats.no_answer).toLocaleString() : '...'}
          sub={stats ? `${parseInt(stats.busy)} busy, ${parseInt(stats.failed)} failed` : ''}
          icon={<PhoneMissed className="w-4 h-4 text-amber-400" />}
          color="border-amber-500/15"
        />
        <StatCard
          label="Avg Duration"
          value={stats ? formatDuration(Math.round(parseFloat(stats.avg_billsec || '0'))) : '...'}
          sub={stats ? `Max: ${formatDuration(parseInt(stats.max_duration || '0'))}` : ''}
          icon={<Clock className="w-4 h-4 text-blue-400" />}
          color="border-blue-500/15"
        />
        <StatCard
          label="Inbound"
          value={stats ? parseInt(stats.inbound).toLocaleString() : '...'}
          sub={stats ? `${parseInt(stats.outbound)} outbound` : ''}
          icon={<PhoneIncoming className="w-4 h-4 text-cyan-400" />}
          color="border-cyan-500/15"
        />
        <StatCard
          label="Talk Time"
          value={stats ? formatDuration(parseInt(stats.total_billsec || '0')) : '...'}
          sub="Total billable"
          icon={<TrendingUp className="w-4 h-4 text-pink-400" />}
          color="border-pink-500/15"
        />
      </div>

      {/* Hourly Chart */}
      {hourly.length > 0 && (
        <div className="flex-shrink-0 lg-card rounded-2xl p-4 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/40 font-medium uppercase tracking-wider">Hourly Call Volume</span>
            <BarChart3 className="w-4 h-4 text-white/20" />
          </div>
          <div className="flex items-end gap-[2px] h-16">
            {Array.from({ length: 24 }, (_, hour) => {
              const data = hourly.find(h => parseInt(h.hour) === hour);
              const calls = data ? parseInt(data.calls) : 0;
              const answered = data ? parseInt(data.answered) : 0;
              const height = calls > 0 ? Math.max(4, (calls / maxHourly) * 100) : 2;
              const answerRate = calls > 0 ? answered / calls : 0;
              return (
                <div key={hour} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${height}%`,
                      background: calls === 0
                        ? 'rgba(255,255,255,0.03)'
                        : `linear-gradient(to top, rgba(139,92,246,${0.15 + answerRate * 0.45}), rgba(139,92,246,${0.05 + answerRate * 0.25}))`,
                      border: calls > 0 ? '1px solid rgba(139,92,246,0.2)' : 'none',
                    }}
                  />
                  {calls > 0 && (
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                      <div className="lg-card rounded-lg px-2 py-1 text-[10px] text-white/70 border border-white/10 whitespace-nowrap shadow-xl">
                        {hour}:00 — {calls} calls ({answered} answered)
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-white/20">00:00</span>
            <span className="text-[9px] text-white/20">06:00</span>
            <span className="text-[9px] text-white/20">12:00</span>
            <span className="text-[9px] text-white/20">18:00</span>
            <span className="text-[9px] text-white/20">23:00</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 lg-card rounded-xl px-3 py-2 border border-white/5 flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 text-white/30" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search caller, destination, channel..."
            className="bg-transparent text-sm text-white/80 placeholder:text-white/25 outline-none flex-1 focus:placeholder:text-white/40"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-white/30 hover:text-white/60">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-white/30" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 outline-none focus:border-violet-500/40 transition-colors"
          />
          <span className="text-white/20 text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 outline-none focus:border-violet-500/40 transition-colors"
          />
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
            showFilters || dispositionFilter || typeFilter
              ? 'bg-violet-500/15 text-violet-400 border-violet-500/20'
              : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {(dispositionFilter || typeFilter) && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          )}
        </button>

        <button
          onClick={() => { fetchRecords(pagination.page); fetchStats(); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 text-white/40 border border-white/10 hover:text-white/60 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-violet-500/15 text-violet-400 border border-violet-500/20 hover:bg-violet-500/25 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Filter Bar */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex-shrink-0 overflow-hidden"
          >
            <div className="flex items-center gap-3 pb-2">
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">Disposition</label>
                <select
                  value={dispositionFilter}
                  onChange={(e) => setDispositionFilter(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 outline-none focus:border-violet-500/40 transition-colors"
                >
                  <option value="">All</option>
                  <option value="ANSWERED">Answered</option>
                  <option value="NO ANSWER">No Answer</option>
                  <option value="BUSY">Busy</option>
                  <option value="FAILED">Failed</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">Call Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 outline-none focus:border-violet-500/40 transition-colors"
                >
                  <option value="">All</option>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                  <option value="internal">Internal</option>
                  <option value="autocall">Autocall</option>
                </select>
              </div>
              {(dispositionFilter || typeFilter) && (
                <button
                  onClick={() => { setDispositionFilter(''); setTypeFilter(''); }}
                  className="mt-4 text-xs text-red-400/60 hover:text-red-400 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recording Error */}
      {activeRec && (
        <div className="flex-shrink-0 mb-2 flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.07] px-3 py-2">
          <Volume2 className="w-4 h-4 text-violet-400 shrink-0" />
          <span className="text-xs text-white/70 font-medium shrink-0 max-w-[240px] truncate" title={activeRec.label}>
            {activeRec.label}
          </span>
          <audio
            key={activeRec.uniqueid}
            src={`${API_BASE}/recording/${activeRec.uniqueid}`}
            controls
            autoPlay
            onError={() => {
              setPlayError('No recording available for this call');
              setActiveRec(null);
              setTimeout(() => setPlayError(null), 4000);
            }}
            className="h-9 flex-1 min-w-0"
          />
          <a
            href={`${API_BASE}/recording/${activeRec.uniqueid}?download=1`}
            download
            className="p-1.5 rounded-lg bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            title="Download recording"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={() => setActiveRec(null)}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/80 transition-colors shrink-0"
            title="Close player"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {playError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            {playError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto lg-card rounded-2xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-white/[0.03] backdrop-blur-sm border-b border-white/5">
              {[
                { key: 'calldate', label: 'Date / Time', w: 'w-40' },
                { key: 'src', label: 'Source', w: 'w-28' },
                { key: 'dst', label: 'Destination', w: 'w-28' },
                { key: 'disposition', label: 'Status', w: 'w-28' },
                { key: '', label: 'Type', w: 'w-24' },
                { key: 'duration', label: 'Duration', w: 'w-20' },
                { key: 'billsec', label: 'Bill Sec', w: 'w-20' },
                { key: '', label: 'Channel', w: '' },
                { key: '', label: '', w: 'w-20' },
              ].map((col, i) => (
                <th
                  key={i}
                  className={`text-left px-3 py-2.5 text-[11px] text-white/35 font-medium uppercase tracking-wider ${col.w}`}
                >
                  {col.key ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="flex items-center gap-1 hover:text-white/60 transition-colors"
                    >
                      {col.label}
                      <SortIcon col={col.key} />
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12 text-white/30">Loading call records...</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-white/25">No call records found for the selected period</td></tr>
            ) : (
              records.map((r) => {
                const { source, dest } = resolveSourceDest(r);
                return (
                <tr
                  key={r.id}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-3 py-2 text-xs text-white/60 font-mono">{formatDate(r.calldate)}</td>
                  <td className="px-3 py-2 text-xs text-white/70 font-medium">{source}</td>
                  <td className="px-3 py-2 text-xs text-white/70 font-medium">{dest}</td>
                  <td className="px-3 py-2"><DispositionBadge disposition={r.disposition} /></td>
                  <td className="px-3 py-2"><TypeBadge userfield={r.userfield} /></td>
                  <td className="px-3 py-2 text-xs text-white/50 font-mono">{formatDuration(r.duration)}</td>
                  <td className="px-3 py-2 text-xs text-white/50 font-mono">{formatDuration(r.billsec)}</td>
                  <td className="px-3 py-2 text-[11px] text-white/30 truncate max-w-[200px]" title={r.channel}>
                    {r.channel?.replace('PJSIP/', '').split('-')[0] || '—'}
                    {r.dstchannel ? ` → ${r.dstchannel.replace('PJSIP/', '').split('-')[0]}` : ''}
                  </td>
                  <td className="px-3 py-2">
                    {r.disposition === 'ANSWERED' && r.billsec > 0 && (
                      <button
                        onClick={() => openRecording(r)}
                        className={`p-1.5 rounded-lg transition-all ${
                          activeRec?.uniqueid === r.uniqueid
                            ? 'bg-violet-500/20 text-violet-400'
                            : 'bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10'
                        }`}
                        title={activeRec?.uniqueid === r.uniqueid ? 'Close player' : 'Play recording'}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
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
      {pagination.totalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-between py-1">
          <span className="text-xs text-white/30">
            Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()} records
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchRecords(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed border border-white/5"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              let pageNum: number;
              if (pagination.totalPages <= 5) {
                pageNum = i + 1;
              } else if (pagination.page <= 3) {
                pageNum = i + 1;
              } else if (pagination.page >= pagination.totalPages - 2) {
                pageNum = pagination.totalPages - 4 + i;
              } else {
                pageNum = pagination.page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => fetchRecords(pageNum)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                    pageNum === pagination.page
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'bg-white/5 text-white/40 hover:text-white/70 border border-white/5'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => fetchRecords(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed border border-white/5"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
