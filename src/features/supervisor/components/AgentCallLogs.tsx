import { useState, useEffect, useCallback } from 'react';
import { PhoneOff, PhoneIncoming, PhoneMissed, Phone, RefreshCw, Search, X, Keyboard, BarChart3, TrendingDown } from 'lucide-react';

interface CallLogEntry {
  id: number;
  agent_extension: string;
  crm_username: string | null;
  caller_id: string;
  caller_id_name: string;
  outcome: string;
  hangup_cause: string;
  duration_seconds: number;
  ring_started_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

interface KeyLogEntry {
  id: number;
  agent_extension: string;
  crm_username: string | null;
  key_pressed: string;
  created_at: string;
}

interface ReportEntry {
  id: number;
  agent_extension: string;
  crm_username: string | null;
  caller_id: string;
  caller_id_name: string;
  outcome: string;
  hangup_cause: string;
  ring_duration_sec: number;
  ring_started_at: string;
  vehicle_reg: string | null;
}

interface ReportSummary {
  missed: number;
  rejected: number;
  perUser: Array<{ username: string; missed: number; rejected: number }>;
}

const OUTCOME_COLORS: Record<string, string> = {
  answered: 'text-emerald-400 bg-emerald-500/10',
  rejected: 'text-amber-400 bg-amber-500/10',
  missed: 'text-red-400 bg-red-500/10',
  no_answer: 'text-slate-400 bg-slate-500/10',
};

const OUTCOME_ICONS: Record<string, any> = {
  answered: PhoneIncoming,
  rejected: PhoneOff,
  missed: PhoneMissed,
  no_answer: Phone,
};

const EXTENSIONS = [
  '449','450','451','452','453','454','455','456','457','458',
  '459','460','461','462','463','464','465','466','467','468','999',
];

export default function AgentCallLogs() {
  const [logs, setLogs] = useState<CallLogEntry[]>([]);
  const [keyLogs, setKeyLogs] = useState<KeyLogEntry[]>([]);
  const [reportRows, setReportRows] = useState<ReportEntry[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterExt, setFilterExt] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [reportOutcome, setReportOutcome] = useState('');
  const [reportUser, setReportUser] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [view, setView] = useState<'calls' | 'keys' | 'report'>('calls');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterExt) params.set('extension', filterExt);
      if (filterOutcome) params.set('outcome', filterOutcome);
      params.set('limit', '200');
      const url = `/api/calls/agent-call-logs?${params}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) setLogs(json.data || []);
    } catch {} finally { setLoading(false); }
  }, [filterExt, filterOutcome]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const fetchKeyLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/calls/agent-key-logs?limit=200');
      const json = await res.json();
      if (json.success) setKeyLogs(json.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { if (view === 'keys') fetchKeyLogs(); }, [view, fetchKeyLogs]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (reportOutcome) params.set('outcome', reportOutcome);
      if (reportUser) params.set('crmUsername', reportUser);
      if (reportSearch) params.set('search', reportSearch);
      const res = await fetch(`/api/calls/agent-call-report?${params}`);
      const json = await res.json();
      if (json.success) {
        setReportRows(json.rows || []);
        setReportSummary(json.summary || null);
      }
    } catch {} finally { setLoading(false); }
  }, [reportOutcome, reportUser, reportSearch]);

  useEffect(() => { if (view === 'report') fetchReport(); }, [view, fetchReport]);

  const handleRefresh = () => {
    if (view === 'keys') fetchKeyLogs();
    else if (view === 'report') fetchReport();
    else fetchLogs();
  };

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    // PG stores PKT time but node-pg returns it as UTC string — correct the timezone
    const pkt = ts.replace('Z', '+05:00').replace(/\.\d{3}/, '');
    const d = new Date(pkt);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (ts: string) => {
    if (!ts) return '';
    const pkt = ts.replace('Z', '+05:00').replace(/\.\d{3}/, '');
    const d = new Date(pkt);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Agent Call Logs</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {view === 'calls' ? 'Per-agent call outcomes — answered, missed, rejected'
               : view === 'keys' ? 'F5 / Ctrl+Shift+R key press tracker'
               : 'Missed & Rejected Report by CRM user, phone, vehicle'}
            </p>
          </div>
          <div className="flex bg-slate-800/50 rounded-xl p-0.5">
            <button onClick={() => { setView('calls'); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'calls' ? 'bg-violet-500/30 text-violet-300' : 'text-slate-500 hover:text-slate-300'}`}>Call Logs</button>
            <button onClick={() => { setView('keys'); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${view === 'keys' ? 'bg-amber-500/30 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}><Keyboard className="w-3 h-3" /> F5 Logs</button>
            <button onClick={() => { setView('report'); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${view === 'report' ? 'bg-red-500/30 text-red-300' : 'text-slate-500 hover:text-slate-300'}`}><BarChart3 className="w-3 h-3" /> Report</button>
          </div>
        </div>
        <button onClick={handleRefresh} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-xl text-sm text-slate-300 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters — only for call logs */}
      {view === 'calls' && (
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <select value={filterExt} onChange={(e) => setFilterExt(e.target.value)} className="pl-9 pr-8 py-2 bg-slate-800/80 border border-white/10 rounded-xl text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-violet-500/50">
            <option value="">All Extensions</option>
            {EXTENSIONS.map((ext) => (
              <option key={ext} value={ext}>Ext {ext}</option>
            ))}
          </select>
          {filterExt && (
            <button onClick={() => setFilterExt('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-1.5">
          {['', 'answered', 'rejected', 'missed'].map((o) => (
            <button key={o} onClick={() => setFilterOutcome(o)} className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              filterOutcome === o
                ? o === 'answered' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : o === 'rejected' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : o === 'missed' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 border border-transparent'
            }`}>
              {o === '' ? 'All' : o.charAt(0).toUpperCase() + o.slice(1)}
            </button>
          ))}
        </div>
      </div>
      )}
      {/* Call Logs Table */}
      {view === 'calls' && (
      <div className="flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-slate-900/50">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No call logs found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-white/5">
                <th className="text-left py-3 px-4 font-medium">Time</th>
                <th className="text-left py-3 px-4 font-medium">Extension</th>
                <th className="text-left py-3 px-4 font-medium">CRM User</th>
                <th className="text-left py-3 px-4 font-medium">Caller</th>
                <th className="text-left py-3 px-4 font-medium">Outcome</th>
                <th className="text-left py-3 px-4 font-medium">Cause</th>
                <th className="text-right py-3 px-4 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const Icon = OUTCOME_ICONS[log.outcome] || Phone;
                return (
                  <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      <span className="text-xs text-slate-500">{formatDate(log.ring_started_at)} </span>
                      {formatTime(log.ring_started_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-sm text-white">Ext {log.agent_extension}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-violet-300/80">{log.crm_username || '-'}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-[160px] truncate" title={log.caller_id}>
                      {log.caller_id_name && <span className="text-white/70">{log.caller_id_name} </span>}
                      {log.caller_id || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${OUTCOME_COLORS[log.outcome] || 'text-slate-400 bg-slate-500/10'}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {log.outcome === 'no_answer' ? 'No Answer' : log.outcome.charAt(0).toUpperCase() + log.outcome.slice(1)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px] font-mono">
                      {log.hangup_cause || '-'}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400 whitespace-nowrap">
                      {log.outcome === 'answered' && log.duration_seconds > 0
                        ? `${Math.floor(log.duration_seconds / 60)}m ${log.duration_seconds % 60}s`
                        : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* F5 Key Logs Table */}
      {view === 'keys' && (
      <div className="flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-slate-900/50">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading...</div>
        ) : keyLogs.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No F5 / refresh events logged</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-white/5">
                <th className="text-left py-3 px-4 font-medium">Time</th>
                <th className="text-left py-3 px-4 font-medium">Extension</th>
                <th className="text-left py-3 px-4 font-medium">CRM User</th>
                <th className="text-left py-3 px-4 font-medium">Key</th>
              </tr>
            </thead>
            <tbody>
              {keyLogs.map((log) => (
                <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                    <span className="text-xs text-slate-500">{formatDate(log.created_at)} </span>
                    {formatTime(log.created_at)}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono text-sm text-white">Ext {log.agent_extension}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-violet-300/80">{log.crm_username || '-'}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-xs font-mono font-semibold">
                      <Keyboard className="w-3 h-3" />
                      {log.key_pressed}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* Report View */}
      {view === 'report' && (
      <>
        {/* Summary Bar */}
        {reportSummary && (
          <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <div>
                <div className="text-xl font-bold text-red-300">{reportSummary.missed + reportSummary.rejected}</div>
                <div className="text-[10px] text-red-400/60">Total Missed + Rejected</div>
              </div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-2">
              <PhoneMissed className="w-4 h-4 text-amber-400" />
              <div>
                <div className="text-xl font-bold text-amber-300">{reportSummary.missed}</div>
                <div className="text-[10px] text-amber-400/60">Missed</div>
              </div>
            </div>
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 flex items-center gap-2">
              <PhoneOff className="w-4 h-4 text-orange-400" />
              <div>
                <div className="text-xl font-bold text-orange-300">{reportSummary.rejected}</div>
                <div className="text-[10px] text-orange-400/60">Rejected</div>
              </div>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-3 overflow-y-auto max-h-20">
              {reportSummary.perUser.slice(0, 5).map(u => (
                <div key={u.username} className="flex justify-between text-[10px]">
                  <span className="text-white/70 truncate">{u.username}</span>
                  <span className="font-mono text-red-300 ml-2">{u.missed}M {u.rejected}R</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-3 flex-wrap flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={reportSearch} onChange={e => setReportSearch(e.target.value)} placeholder="Search phone / vehicle / user..." className="pl-9 pr-3 py-2 w-52 bg-slate-800/80 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/50" />
          </div>
          <input type="text" value={reportUser} onChange={e => setReportUser(e.target.value)} placeholder="CRM User..." className="px-3 py-2 w-36 bg-slate-800/80 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/50" />
          <div className="flex gap-1.5">
            {['', 'missed', 'rejected'].map(o => (
              <button key={o} onClick={() => setReportOutcome(o)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                reportOutcome === o
                  ? o === 'missed' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : o === 'rejected' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-slate-700/50 text-white'
                  : 'bg-slate-800/50 text-slate-500 hover:text-slate-300'
              }`}>
                {o === '' ? 'All' : o.charAt(0).toUpperCase() + o.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-slate-900/50">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading...</div>
          ) : reportRows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No missed/rejected calls found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-white/5">
                  <th className="text-left py-3 px-4 font-medium">Time</th>
                  <th className="text-left py-3 px-4 font-medium">CRM User</th>
                  <th className="text-left py-3 px-4 font-medium">Ext</th>
                  <th className="text-left py-3 px-4 font-medium">Caller</th>
                  <th className="text-left py-3 px-4 font-medium">Vehicle</th>
                  <th className="text-left py-3 px-4 font-medium">Outcome</th>
                  <th className="text-left py-3 px-4 font-medium">Ring Time</th>
                  <th className="text-left py-3 px-4 font-medium">Cause</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map(row => (
                  <tr key={row.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      <span className="text-xs text-slate-500">{formatDate(row.ring_started_at)} </span>
                      {formatTime(row.ring_started_at)}
                    </td>
                    <td className="py-3 px-4"><span className="text-sm text-violet-300/80">{row.crm_username || '-'}</span></td>
                    <td className="py-3 px-4"><span className="font-mono text-sm text-white">Ext {row.agent_extension}</span></td>
                    <td className="py-3 px-4 text-slate-300 max-w-[140px] truncate" title={row.caller_id}>{row.caller_id || '-'}</td>
                    <td className="py-3 px-4"><span className="font-mono text-xs text-emerald-400">{row.vehicle_reg || '-'}</span></td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${row.outcome === 'missed' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                        {row.outcome === 'missed' ? <PhoneMissed className="w-3 h-3" /> : <PhoneOff className="w-3 h-3" />}
                        {row.outcome === 'missed' ? 'Missed' : 'Rejected'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs tabular-nums">{row.ring_duration_sec > 0 ? `${row.ring_duration_sec}s` : '-'}</td>
                    <td className="py-3 px-4 text-slate-400 text-[11px] font-mono">{row.hangup_cause || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>
      )}
    </div>
  );
}
