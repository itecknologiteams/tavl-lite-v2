import { useState, useEffect, useCallback } from 'react';
import { PhoneOff, PhoneIncoming, PhoneMissed, Phone, RefreshCw, Search, X } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [filterExt, setFilterExt] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');

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

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (ts: string) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Agent Call Logs</h2>
          <p className="text-xs text-slate-400 mt-0.5">Per-agent call outcomes — answered, missed, rejected</p>
        </div>
        <button onClick={fetchLogs} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-xl text-sm text-slate-300 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
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

      {/* Table */}
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
    </div>
  );
}
