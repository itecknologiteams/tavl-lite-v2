/**
 * Supervisor Alert Distribution Dashboard
 * Full control panel: agent management, escalated/pending queues, resolve/dismiss,
 * manual assignment with force-assign, capacity tuning, and resolved history.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  AlertTriangle,
  Coffee,
  CheckCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  UserCheck,
  Shield,
  Battery,
  MapPin,
  Moon,
  Bell,
  ChevronDown,
  ChevronUp,
  Play,
  Loader2,
  TrendingUp,
  Zap,
  History,
  FileText,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Settings2,
  ShieldCheck,
  Minus,
  Plus,
  Phone,
  Mail,
  MapPinned,
  Route,
  Car,
  Search,
  X,
  Landmark,
  Building2,
} from 'lucide-react';
import { useAlertDistributionStore, AgentSession, AlertAssignment } from '@store/alertDistributionStore';
import { formatDistanceToNow, format } from 'date-fns';

// ─── Customer contact helper ──────────────────────────────────
function safeParseAlertData(raw: any): any {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
  }
  return raw;
}

const getCustomerContact = (alert: AlertAssignment) => {
  const d = safeParseAlertData((alert as any).alert_data);
  return {
    phone: d.customerPhone || null,
    address: d.customerAddress || null,
    email: d.customerEmail || null,
  };
};

function safeDate(raw?: any): Date | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function safeDistanceToNow(raw?: any): string {
  const d = safeDate(raw);
  if (!d) return '—';
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return '—';
  }
}

function resolveAgentName(agents: AgentSession[], userId: string | null | undefined): string {
  if (!userId) return '—';
  return agents.find(a => a.user_id === userId)?.username || userId;
}

function safeFmt(raw: any, fmt: string): string {
  const d = safeDate(raw);
  if (!d) return '—';
  try {
    return format(d, fmt);
  } catch {
    return '—';
  }
}

const CustomerContactLine: React.FC<{ alert: AlertAssignment; compact?: boolean }> = ({ alert, compact }) => {
  const c = getCustomerContact(alert);
  if (!c.phone && !c.email && !c.address) return null;
  if (compact) {
    return (
      <span className="text-[10px] text-slate-500">
        {c.phone && <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{c.phone}</span>}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
      {c.phone && <span className="inline-flex items-center gap-1 text-slate-400"><Phone className="w-3 h-3 text-slate-500" />{c.phone}</span>}
      {c.email && <span className="inline-flex items-center gap-1 text-slate-400"><Mail className="w-3 h-3 text-slate-500" />{c.email}</span>}
      {c.address && <span className="inline-flex items-center gap-1 text-slate-400"><MapPinned className="w-3 h-3 text-slate-500" />{c.address}</span>}
    </div>
  );
};

// ─── Alert type icons ─────────────────────────────────────────
const ALERT_TYPE_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  'panic':      { icon: Shield,  color: 'text-red-400',    label: 'PANIC' },
  'sos':        { icon: Shield,  color: 'text-red-400',    label: 'SOS' },
  'battery':    { icon: Battery, color: 'text-amber-400',  label: 'Battery' },
  'geofence':   { icon: MapPin,  color: 'text-purple-400', label: 'Geofence' },
  'late_night': { icon: Moon,    color: 'text-blue-400',   label: 'Late Night' },
};

const getAlertConfig = (alertType: string) => {
  const type = alertType?.toLowerCase().replace(/\s+/g, '_') || 'default';
  return ALERT_TYPE_CONFIG[type] || { icon: Bell, color: 'text-slate-400', label: alertType || 'Alert' };
};

const RESOLUTION_OPTIONS = [
  { value: 'customer_contacted', label: 'Customer Contacted' },
  { value: 'false_alarm', label: 'False Alarm' },
  { value: 'field_team_dispatched', label: 'Field Team Dispatched' },
  { value: 'monitoring_completed', label: 'Monitoring Completed' },
  { value: 'vehicle_recovered', label: 'Vehicle Recovered' },
  { value: 'no_action_required', label: 'No Action Required' },
  { value: 'other', label: 'Other' },
] as const;

const RESOLUTION_LABELS: Record<string, string> = Object.fromEntries(
  RESOLUTION_OPTIONS.map(o => [o.value, o.label]),
);
RESOLUTION_LABELS['auto_resolved'] = 'Auto Resolved';
RESOLUTION_LABELS['dismissed'] = 'Dismissed';

// ─── Status badge ──────────────────────────────────────────────
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { color: string; label: string }> = {
    online:          { color: 'bg-emerald-500', label: 'Online' },
    break_requested: { color: 'bg-amber-500',   label: 'Break Req' },
    on_break:        { color: 'bg-blue-500',     label: 'On Break' },
    offline:         { color: 'bg-slate-500',     label: 'Offline' },
  };
  const { color, label } = config[status] || config.offline;
  return <span className={`px-2 py-0.5 text-[10px] font-medium ${color} text-white rounded-full`}>{label}</span>;
};

// ─── Inline resolve panel (shared by escalated + pending) ──────
const ResolvePanel: React.FC<{
  onResolve: (type: string, notes?: string) => void;
  onCancel: () => void;
  loading: boolean;
}> = ({ onResolve, onCancel, loading }) => {
  const [resType, setResType] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-2">
      <select
        value={resType}
        onChange={(e) => setResType(e.target.value)}
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white appearance-none cursor-pointer"
      >
        <option value="" disabled className="bg-slate-800">Select resolution type…</option>
        {RESOLUTION_OPTIONS.map(o => (
          <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
        ))}
      </select>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={resType === 'other' ? 'Notes (required)…' : 'Notes (optional)…'}
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 resize-none"
        rows={2}
      />
      <div className="flex gap-2">
        <button
          onClick={() => onResolve(resType, notes || undefined)}
          disabled={loading || !resType || (resType === 'other' && !notes.trim())}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600
                   text-white rounded font-medium text-sm transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Resolve
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Agent assignment dropdown (with force toggle) ─────────────
const AssignDropdown: React.FC<{
  agents: AgentSession[];
  onAssign: (agentId: string, force: boolean) => void;
  loading: boolean;
}> = ({ agents, onAssign, loading }) => {
  const [force, setForce] = useState(false);
  const available = agents.filter(
    a => a.status === 'online' && (force || a.current_alert_count < (a.max_alerts || 10)),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Assign to agent</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="w-3 h-3 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/30"
          />
          <span className="text-[10px] text-amber-400">Force (bypass capacity)</span>
        </label>
      </div>
      {available.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {available.map((agent) => (
            <button
              key={agent.user_id}
              onClick={() => onAssign(agent.user_id, force)}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/10 hover:bg-white/20
                       text-white rounded text-xs transition-colors disabled:opacity-50"
            >
              <UserCheck className="w-3 h-3" />
              {agent.username}
              <span className={`${agent.current_alert_count >= (agent.max_alerts || 10) ? 'text-red-400' : 'text-slate-400'}`}>
                ({agent.current_alert_count}/{agent.max_alerts || 10})
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">{force ? 'No online agents' : 'No agents with capacity — enable force'}</p>
      )}
    </div>
  );
};

// ─── Agent row with capacity editor ────────────────────────────
const AgentRow: React.FC<{
  agent: AgentSession & { performance?: any };
  onApproveBreak: () => void;
  onEndBreak: () => void;
  onUpdateMax: (val: number) => void;
  loading?: boolean;
}> = ({ agent, onApproveBreak, onEndBreak, onUpdateMax, loading }) => {
  const [editingMax, setEditingMax] = useState(false);
  const [tempMax, setTempMax] = useState(agent.max_alerts || 10);
  const capacity = agent.max_alerts || 10;
  const pct = Math.round((agent.current_alert_count / capacity) * 100);
  const barColor = pct < 50 ? 'bg-emerald-500' : pct < 80 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          agent.status === 'online' ? 'bg-emerald-500' :
          agent.status === 'break_requested' ? 'bg-amber-500 animate-pulse' :
          agent.status === 'on_break' ? 'bg-blue-500' : 'bg-slate-500'
        }`} />
        <span className="text-sm font-medium text-white truncate">{agent.username}</span>
        <StatusBadge status={agent.status} />
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{agent.current_alert_count}/{capacity}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {/* Capacity editor */}
        {editingMax ? (
          <div className="flex items-center gap-1">
            <button onClick={() => setTempMax(Math.max(1, tempMax - 1))} className="p-0.5 text-slate-400 hover:text-white"><Minus className="w-3 h-3" /></button>
            <span className="text-xs text-white font-mono w-6 text-center">{tempMax}</span>
            <button onClick={() => setTempMax(Math.min(50, tempMax + 1))} className="p-0.5 text-slate-400 hover:text-white"><Plus className="w-3 h-3" /></button>
            <button
              onClick={() => { onUpdateMax(tempMax); setEditingMax(false); }}
              className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30"
            >
              Save
            </button>
            <button onClick={() => { setEditingMax(false); setTempMax(capacity); }} className="px-1.5 py-0.5 text-[10px] bg-white/10 text-slate-400 rounded hover:bg-white/20">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setTempMax(capacity); setEditingMax(true); }}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            title={`Max alerts: ${capacity} — click to edit`}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        )}

        {agent.status === 'break_requested' && (
          <button onClick={onApproveBreak} disabled={loading}
            className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded text-xs font-medium transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coffee className="w-3 h-3" />}
            Approve Break
          </button>
        )}
        {agent.status === 'on_break' && (
          <button onClick={onEndBreak} disabled={loading}
            className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-xs font-medium transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            End Break
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Escalated alert card ──────────────────────────────────────
const EscalatedAlertCard: React.FC<{
  alert: AlertAssignment;
  agents: AgentSession[];
  onAssign: (agentId: string, force: boolean) => void;
  onResolve: (type: string, notes?: string) => void;
  loading?: boolean;
}> = ({ alert, agents, onAssign, onResolve, loading }) => {
  const [panel, setPanel] = useState<'none' | 'assign' | 'resolve'>('none');
  const config = getAlertConfig(alert.alert_type);
  const Icon = config.icon;

  return (
    <div className="bg-white/5 border border-amber-500/30 rounded-lg overflow-hidden">
      <div className="px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <Icon className={`w-3.5 h-3.5 ${config.color}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
              <span className="text-sm text-white font-medium truncate">{alert.vehicle_reg}</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {alert.customer_name || 'Unknown Customer'}
              {getCustomerContact(alert).phone && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-slate-500"><Phone className="w-2.5 h-2.5" />{getCustomerContact(alert).phone}</span>
              )}
              {alert.assigned_to && <span className="ml-1.5 text-slate-500">• {resolveAgentName(agents, alert.assigned_to)}</span>}
              <span className="ml-1.5 text-slate-600">• {safeDistanceToNow(alert.escalated_at)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setPanel(panel === 'resolve' ? 'none' : 'resolve')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              panel === 'resolve' ? 'bg-emerald-500/30 text-emerald-300' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Resolve
          </button>
          <button
            onClick={() => setPanel(panel === 'assign' ? 'none' : 'assign')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              panel === 'assign' ? 'bg-primary-500/30 text-primary-300' : 'bg-primary-500/20 hover:bg-primary-500/30 text-primary-400'
            }`}
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Assign
          </button>
        </div>
      </div>

      <AnimatePresence>
        {panel !== 'none' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10 px-4 py-3"
          >
            {panel === 'resolve' && (
              <ResolvePanel onResolve={onResolve} onCancel={() => setPanel('none')} loading={!!loading} />
            )}
            {panel === 'assign' && (
              <AssignDropdown agents={agents} onAssign={(agentId, force) => { onAssign(agentId, force); setPanel('none'); }} loading={!!loading} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Pending alert row ─────────────────────────────────────────
const PendingAlertRow: React.FC<{
  alert: AlertAssignment;
  agents: AgentSession[];
  onAssign: (agentId: string, force: boolean) => void;
  onResolve: (type: string, notes?: string) => void;
  selected: boolean;
  onToggleSelect: () => void;
  loading?: boolean;
}> = ({ alert, agents, onAssign, onResolve, selected, onToggleSelect, loading }) => {
  const [panel, setPanel] = useState<'none' | 'assign' | 'resolve'>('none');
  const config = getAlertConfig(alert.alert_type);
  const Icon = config.icon;

  return (
    <div className="bg-white/5 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between py-2.5 px-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500/30 cursor-pointer flex-shrink-0"
          />
          <Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-white truncate">{alert.vehicle_reg}</span>
              <span className={`text-xs ${config.color}`}>{config.label}</span>
            </div>
            <span className="text-[10px] text-slate-500">
              {alert.customer_name || 'Unknown'}{getCustomerContact(alert).phone && <span className="ml-1"><Phone className="w-2.5 h-2.5 inline" /> {getCustomerContact(alert).phone}</span>} • {safeDistanceToNow(alert.created_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setPanel(panel === 'resolve' ? 'none' : 'resolve')}
            className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-medium transition-colors"
          >
            <ShieldCheck className="w-3 h-3" />
            Resolve
          </button>
          <button
            onClick={() => setPanel(panel === 'assign' ? 'none' : 'assign')}
            className="flex items-center gap-1 px-2 py-1 bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 rounded text-[10px] font-medium transition-colors"
          >
            <ArrowRight className="w-3 h-3" />
            Assign
          </button>
        </div>
      </div>

      <AnimatePresence>
        {panel !== 'none' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 px-3 py-2.5"
          >
            {panel === 'resolve' && (
              <ResolvePanel onResolve={onResolve} onCancel={() => setPanel('none')} loading={!!loading} />
            )}
            {panel === 'assign' && (
              <AssignDropdown agents={agents} onAssign={(agentId, force) => { onAssign(agentId, force); setPanel('none'); }} loading={!!loading} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Resolved alert row ────────────────────────────────────────
const ResolvedAlertRow: React.FC<{ alert: AlertAssignment; agents: AgentSession[] }> = ({ alert, agents }) => {
  const [expanded, setExpanded] = useState(false);
  const config = getAlertConfig(alert.alert_type);
  const Icon = config.icon;
  const resLabel = RESOLUTION_LABELS[alert.resolution || ''] || alert.resolution || '—';

  const resColor: Record<string, string> = {
    customer_contacted:    'text-emerald-400 bg-emerald-500/10',
    false_alarm:           'text-slate-400 bg-slate-500/10',
    field_team_dispatched: 'text-blue-400 bg-blue-500/10',
    monitoring_completed:  'text-emerald-400 bg-emerald-500/10',
    vehicle_recovered:     'text-emerald-400 bg-emerald-500/10',
    no_action_required:    'text-slate-400 bg-slate-500/10',
    auto_resolved:         'text-amber-400 bg-amber-500/10',
    dismissed:             'text-slate-500 bg-slate-500/10',
    other:                 'text-violet-400 bg-violet-500/10',
  };
  const badge = resColor[alert.resolution || ''] || 'text-slate-400 bg-slate-500/10';

  return (
    <div className="bg-white/5 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between py-2.5 px-3 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />
          <span className="text-sm text-white truncate">{alert.vehicle_reg}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>{resLabel}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[10px] text-slate-500">{alert.resolved_by || resolveAgentName(agents, alert.assigned_to)}</span>
          <span className="text-[10px] text-slate-500">{safeFmt(alert.resolved_at, 'MMM d, HH:mm')}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/5 px-4 py-3 space-y-2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div><span className="text-slate-500">Customer:</span> <span className="text-slate-300">{alert.customer_name || '—'}</span></div>
              <div><span className="text-slate-500">Alert Type:</span> <span className={config.color}>{config.label}</span></div>
              <div><span className="text-slate-500">Assigned:</span> <span className="text-slate-300">{safeFmt(alert.assigned_at, 'MMM d, HH:mm')}</span></div>
              <div><span className="text-slate-500">Acknowledged:</span> <span className="text-slate-300">{safeFmt(alert.acknowledged_at, 'MMM d, HH:mm')}</span></div>
              <div><span className="text-slate-500">Resolved:</span> <span className="text-slate-300">{safeFmt(alert.resolved_at, 'MMM d, HH:mm')}</span></div>
              <div>
                <span className="text-slate-500">Handling:</span>{' '}
                <span className="text-slate-300">
                  {alert.assigned_at && alert.resolved_at
                  ? `${Math.round((new Date(alert.resolved_at).getTime() - new Date(alert.assigned_at).getTime()) / 60000)}min`
                    : '—'}
                </span>
              </div>
            </div>
            <CustomerContactLine alert={alert} />
            {alert.resolution_notes && (
              <div className="flex items-start gap-2 pt-1">
                <FileText className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-slate-300 italic">{alert.resolution_notes}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Routing Rules Summary (points to Rules tab) ──────────────
const RoutingRulesSummary: React.FC<{
  rules: { id: number; rule_type: string; rule_name: string; config: any; is_active: boolean }[];
  agents: AgentSession[];
  onManageRules?: () => void;
}> = ({ rules, agents, onManageRules }) => {
  const activeRules = rules.filter(r => r.is_active);

  return (
    <div className="p-3 space-y-2">
      {activeRules.length > 0 ? (
        <div className="space-y-1.5">
          {activeRules.slice(0, 5).map(rule => {
            const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
            const isAlertType = rule.rule_type === 'alert_type_routing';
            const typeConfig = isAlertType ? getAlertConfig(cfg.alertType) : null;
            const TypeIcon = typeConfig?.icon
              || (rule.rule_type === 'bank_routing' ? Landmark : rule.rule_type === 'corporate_routing' ? Building2 : Car);
            const label = isAlertType
              ? (typeConfig?.label || cfg.alertType)
              : rule.rule_type === 'bank_routing'
                ? (cfg.bankName || `Bank #${cfg.bankId}`)
                : rule.rule_type === 'corporate_routing'
                  ? (cfg.corpName || `Corp #${cfg.corpId}`)
                  : rule.rule_name;
            const color = isAlertType ? (typeConfig?.color || 'text-slate-400')
              : rule.rule_type === 'bank_routing' ? 'text-cyan-400' : 'text-violet-400';

            return (
              <div key={rule.id} className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <TypeIcon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                  <span className={`text-xs font-medium ${color}`}>{label}</span>
                  <ArrowRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
                  <div className="flex items-center gap-1 min-w-0">
                    {(cfg.agents || []).slice(0, 3).map((agentId: string) => (
                      <span key={agentId} className="px-1.5 py-0.5 text-[10px] bg-primary-500/20 text-primary-300 rounded font-medium truncate">
                        {resolveAgentName(agents, agentId)}
                      </span>
                    ))}
                    {(cfg.agents || []).length > 3 && (
                      <span className="text-[10px] text-slate-500">+{(cfg.agents || []).length - 3}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {activeRules.length > 5 && (
            <p className="text-[10px] text-slate-500 text-center">+{activeRules.length - 5} more rules</p>
          )}
        </div>
      ) : (
        <div className="text-center py-3 text-slate-500 text-xs">
          No active routing rules. Alerts use the smart scoring algorithm.
        </div>
      )}

      {onManageRules && (
        <button
          onClick={onManageRules}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-500/10 hover:bg-violet-500/20
                   text-violet-400 text-xs font-medium rounded-lg transition-colors border border-violet-500/20 hover:border-violet-500/30"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Manage Rules
        </button>
      )}
    </div>
  );
};

// ─── Collapsible section ───────────────────────────────────────
const Section: React.FC<{
  title: string; icon: React.ReactNode; count?: number; badge?: 'amber' | 'blue' | 'emerald' | 'red';
  refreshAction?: () => void; headerExtra?: React.ReactNode; loading?: boolean;
  children: React.ReactNode; defaultExpanded?: boolean;
}> = ({ title, icon, count, badge, refreshAction, headerExtra, loading, children, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const badgeColor = { amber: 'bg-amber-500', blue: 'bg-blue-500', emerald: 'bg-emerald-500', red: 'bg-red-500' }[badge || 'blue'];

  return (
    <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          {icon}
          <span className="font-semibold text-white">{title}</span>
          {count !== undefined && count > 0 && (
            <span className={`px-2 py-0.5 text-xs font-bold ${badgeColor} text-white rounded-full`}>{count}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          {refreshAction && (
            <button onClick={(e) => { e.stopPropagation(); refreshAction(); }} className="p-1.5 text-slate-400 hover:text-white transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/10">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════
const SupervisorAlertDashboard: React.FC<{ onSwitchTab?: (tab: string) => void }> = ({ onSwitchTab }) => {
  const {
    allAgents, escalatedAlerts, pendingAlerts, resolvedAlerts, resolvedTotal, rules, stats, loading,
    fetchAgents, fetchEscalated, fetchPending, fetchResolved, fetchRules, fetchStats,
    assignAlert, supervisorResolve, dismissAlerts, updateMaxAlerts,
    approveBreak, endBreak, distributePending,
  } = useAlertDistributionStore();

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [resolvedPage, setResolvedPage] = useState(0);
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [selectedEscalated, setSelectedEscalated] = useState<Set<string>>(new Set());

  // Per-section searches (instead of one global search)
  const [agentSearch, setAgentSearch] = useState('');
  const [escalatedSearch, setEscalatedSearch] = useState('');
  const [pendingSearch, setPendingSearch] = useState('');
  const [resolvedSearch, setResolvedSearch] = useState('');
  const [debouncedResolvedSearch, setDebouncedResolvedSearch] = useState('');
  const PAGE_SIZE = 25;

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Debounce resolved search only (server-side filtering)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedResolvedSearch(resolvedSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [resolvedSearch]);

  // Reset paging when resolved search changes (keeps pagination correct)
  useEffect(() => {
    setResolvedPage(0);
  }, [debouncedResolvedSearch]);

  // Clear selections when local filters change (prevents confusing bulk actions)
  useEffect(() => {
    setSelectedEscalated(new Set());
  }, [escalatedSearch]);
  useEffect(() => {
    setSelectedPending(new Set());
  }, [pendingSearch]);

  useEffect(() => {
    fetchResolved(PAGE_SIZE, resolvedPage * PAGE_SIZE, debouncedResolvedSearch || undefined);
  }, [resolvedPage, debouncedResolvedSearch, fetchResolved]);

  const wrap = useCallback(async (key: string, fn: () => Promise<any>) => {
    setLoadingAction(key);
    await fn();
    setLoadingAction(null);
  }, []);

  const handleAssignAlert = useCallback((alertId: string, agentId: string, force: boolean) => {
    wrap(`assign-${alertId}`, () => assignAlert(alertId, agentId, 'Manual assignment by supervisor', force));
  }, [assignAlert, wrap]);

  const handleSupervisorResolve = useCallback((alertId: string, type: string, notes?: string) => {
    wrap(`resolve-${alertId}`, () => supervisorResolve(alertId, type, notes));
  }, [supervisorResolve, wrap]);

  const handleDistribute = useCallback(async () => {
    setDistributing(true);
    await distributePending();
    setDistributing(false);
  }, [distributePending]);

  const togglePendingSelect = useCallback((id: string) => {
    setSelectedPending(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleEscalatedSelect = useCallback((id: string) => {
    setSelectedEscalated(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const onlineCount = allAgents.filter(a => a.status === 'online').length;
  const breakRequestedCount = allAgents.filter(a => a.status === 'break_requested').length;
  const onBreakCount = allAgents.filter(a => a.status === 'on_break').length;
  const totalPages = Math.ceil(resolvedTotal / PAGE_SIZE);

  const agentTerm = agentSearch.trim().toLowerCase();
  const escalatedTerm = escalatedSearch.trim().toLowerCase();
  const pendingTerm = pendingSearch.trim().toLowerCase();

  const agentMatches = useCallback((a: AgentSession, term: string) => {
    if (!term) return true;
    const hay = [a.username, a.user_id, a.role, a.status].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  }, []);

  const matchesAlert = useCallback((a: AlertAssignment, term: string) => {
    if (!term) return true;
    const data = (() => {
      const raw = (a as any).alert_data;
      if (!raw) return null;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    })();
    const hay = [
      a.alert_id,
      (a as any).vehicle_reg,
      (a as any).customer_name,
      (a as any).alert_type,
      (a as any).alert_message,
      data?.customerPhone,
      data?.customerEmail,
      data?.customerAddress,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  }, []);

  const filteredAgents = agentTerm ? allAgents.filter(a => agentMatches(a, agentTerm)) : allAgents;
  const filteredEscalated = escalatedTerm ? escalatedAlerts.filter(a => matchesAlert(a, escalatedTerm)) : escalatedAlerts;
  const filteredPending = pendingTerm ? pendingAlerts.filter(a => matchesAlert(a, pendingTerm)) : pendingAlerts;

  const handleDismissEscalated = useCallback(async () => {
    const ids = selectedEscalated.size > 0
      ? Array.from(selectedEscalated)
      : filteredEscalated.map(a => a.alert_id);
    if (ids.length === 0) return;
    setLoadingAction('dismiss-esc');
    await dismissAlerts(ids, 'Dismissed stale escalated alerts');
    setSelectedEscalated(new Set());
    setLoadingAction(null);
  }, [selectedEscalated, filteredEscalated, dismissAlerts]);

  const handleDismissPending = useCallback(async () => {
    const ids = selectedPending.size > 0
      ? Array.from(selectedPending)
      : filteredPending.map(a => a.alert_id);
    if (ids.length === 0) return;
    setLoadingAction('dismiss-pend');
    await dismissAlerts(ids, 'Dismissed stale pending alerts');
    setSelectedPending(new Set());
    setLoadingAction(null);
  }, [selectedPending, filteredPending, dismissAlerts]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 2-Column Layout ─────────────────────────────── */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── LEFT COLUMN: Agents + Resolved History ────── */}
        <div className="w-[30%] flex-shrink-0 flex flex-col gap-3 min-h-0">
          {/* Agent Status */}
          <Section
            title="Agent Status" icon={<Users className="w-5 h-5 text-primary-400" />}
            refreshAction={fetchAgents} loading={loading}
            headerExtra={
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-slate-400 mr-1 whitespace-nowrap">
                  {onlineCount} online
                  {breakRequestedCount > 0 && <span className="text-amber-400 ml-1">• {breakRequestedCount} req</span>}
                  {onBreakCount > 0 && <span className="text-blue-400 ml-1">• {onBreakCount} break</span>}
                </span>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                  <input
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    placeholder="Search agents…"
                    className="w-32 lg:w-40 xl:w-48 pl-7 pr-6 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-white/80 placeholder:text-slate-500 outline-none focus:border-primary-500/40"
                  />
                  {agentSearch.trim() && (
                    <button
                      onClick={() => setAgentSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            }
          >
            <div className="p-3 space-y-1.5 overflow-y-auto" style={{ maxHeight: 'calc(42vh - 60px)' }}>
              {filteredAgents.length > 0 ? filteredAgents.map((agent) => (
                <AgentRow
                  key={agent.user_id} agent={agent}
                  onApproveBreak={() => wrap(`break-${agent.user_id}`, () => approveBreak(agent.user_id))}
                  onEndBreak={() => wrap(`break-${agent.user_id}`, () => endBreak(agent.user_id))}
                  onUpdateMax={(val) => updateMaxAlerts(agent.user_id, val)}
                  loading={loadingAction === `break-${agent.user_id}`}
                />
              )) : <EmptyState icon={<Users className="w-10 h-10" />} message={agentTerm ? 'No matching agents' : 'No agents registered'} />}
            </div>
          </Section>

          {/* Routing Rules */}
          <Section
            title="Routing Rules" icon={<Route className="w-5 h-5 text-cyan-400" />}
            refreshAction={fetchRules} loading={loading}
            defaultExpanded={false}
            headerExtra={rules.filter(r => r.is_active).length > 0 ? <span className="text-xs text-slate-400 mr-2">{rules.filter(r => r.is_active).length} active</span> : undefined}
          >
            <RoutingRulesSummary
              rules={rules}
              agents={allAgents}
              onManageRules={onSwitchTab ? () => onSwitchTab('rules') : undefined}
            />
          </Section>

          {/* Resolved History */}
          <Section
            title="Resolved History" icon={<History className="w-5 h-5 text-emerald-400" />}
            refreshAction={() => fetchResolved(PAGE_SIZE, resolvedPage * PAGE_SIZE, debouncedResolvedSearch || undefined)} loading={loading}
            headerExtra={
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                  <input
                    value={resolvedSearch}
                    onChange={(e) => setResolvedSearch(e.target.value)}
                    placeholder="Search resolved…"
                    className="w-32 lg:w-40 xl:w-48 pl-7 pr-6 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-white/80 placeholder:text-slate-500 outline-none focus:border-emerald-500/40"
                  />
                  {resolvedSearch.trim() && (
                    <button
                      onClick={() => setResolvedSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-xs text-slate-400 mr-1 whitespace-nowrap">
                  {resolvedTotal} {debouncedResolvedSearch ? 'matches' : 'total'}
                </span>
              </div>
            }
          >
            <div className="p-3 space-y-1.5 flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 460px)' }}>
              {resolvedAlerts.length > 0 ? (
                <>
                  {resolvedAlerts.map((alert) => <ResolvedAlertRow key={alert.alert_id} alert={alert} agents={allAgents} />)}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <button onClick={() => setResolvedPage(p => Math.max(0, p - 1))} disabled={resolvedPage === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 text-slate-300 rounded text-[10px] transition-colors disabled:opacity-30">
                        <ChevronLeft className="w-3 h-3" /> Prev
                      </button>
                      <span className="text-[10px] text-slate-500">{resolvedPage + 1}/{totalPages}</span>
                      <button onClick={() => setResolvedPage(p => Math.min(totalPages - 1, p + 1))} disabled={resolvedPage >= totalPages - 1}
                        className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 text-slate-300 rounded text-[10px] transition-colors disabled:opacity-30">
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </>
              ) : <EmptyState icon={<History className="w-10 h-10" />} message="No resolved alerts yet" />}
            </div>
          </Section>
        </div>

        {/* ── RIGHT COLUMN: Escalated + Pending ─────────── */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 min-w-0">
          {/* Escalated Alerts */}
          <Section
            title="Escalated Alerts" icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
            count={filteredEscalated.length} badge="amber" refreshAction={fetchEscalated} loading={loading}
            headerExtra={
              <div className="flex items-center gap-2 mr-1" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                  <input
                    value={escalatedSearch}
                    onChange={(e) => setEscalatedSearch(e.target.value)}
                    placeholder="Search…"
                    className="w-32 lg:w-40 xl:w-48 pl-7 pr-6 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-white/80 placeholder:text-slate-500 outline-none focus:border-amber-500/40"
                  />
                  {escalatedSearch.trim() && (
                    <button
                      onClick={() => setEscalatedSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {filteredEscalated.length > 0 && (
                  <>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filteredEscalated.length > 0 && filteredEscalated.every(a => selectedEscalated.has(a.alert_id))}
                        onChange={() => {
                          const allSelected = filteredEscalated.length > 0 && filteredEscalated.every(a => selectedEscalated.has(a.alert_id));
                          setSelectedEscalated(prev => {
                            const next = new Set(prev);
                            if (allSelected) filteredEscalated.forEach(a => next.delete(a.alert_id));
                            else filteredEscalated.forEach(a => next.add(a.alert_id));
                            return next;
                          });
                        }}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/30 cursor-pointer"
                      />
                      <span className="text-[10px] text-slate-400">All</span>
                    </label>
                    <button
                      onClick={() => handleDismissEscalated()}
                      disabled={loadingAction === 'dismiss-esc'}
                      className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {loadingAction === 'dismiss-esc' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      {selectedEscalated.size > 0 ? `Dismiss (${selectedEscalated.size})` : 'Dismiss All'}
                    </button>
                  </>
                )}
              </div>
            }
          >
            <div className="p-3 space-y-2 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(50vh - 50px)' }}>
              {filteredEscalated.length > 0 ? filteredEscalated.map((alert) => (
                <div key={alert.alert_id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedEscalated.has(alert.alert_id)}
                    onChange={() => toggleEscalatedSelect(alert.alert_id)}
                    className="w-3.5 h-3.5 mt-4 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/30 cursor-pointer flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <EscalatedAlertCard
                      alert={alert} agents={allAgents}
                      onAssign={(agentId, force) => handleAssignAlert(alert.alert_id, agentId, force)}
                      onResolve={(type, notes) => handleSupervisorResolve(alert.alert_id, type, notes)}
                      loading={loadingAction === `assign-${alert.alert_id}` || loadingAction === `resolve-${alert.alert_id}`}
                    />
                  </div>
                </div>
              )) : <EmptyState icon={<CheckCircle className="w-10 h-10 text-emerald-500" />} message={escalatedTerm ? 'No matches in escalated alerts' : 'No escalated alerts'} />}
            </div>
          </Section>

          {/* Pending Queue */}
          <Section
            title="Pending Queue" icon={<Clock className="w-5 h-5 text-blue-400" />}
            count={filteredPending.length} badge="blue" refreshAction={fetchPending} loading={loading}
            headerExtra={
              <div className="flex items-center gap-2 mr-1" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                  <input
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    placeholder="Search…"
                    className="w-32 lg:w-40 xl:w-48 pl-7 pr-6 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-white/80 placeholder:text-slate-500 outline-none focus:border-blue-500/40"
                  />
                  {pendingSearch.trim() && (
                    <button
                      onClick={() => setPendingSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {filteredPending.length > 0 && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filteredPending.length > 0 && filteredPending.every(a => selectedPending.has(a.alert_id))}
                      onChange={() => {
                        const allSelected = filteredPending.length > 0 && filteredPending.every(a => selectedPending.has(a.alert_id));
                        setSelectedPending(prev => {
                          const next = new Set(prev);
                          if (allSelected) filteredPending.forEach(a => next.delete(a.alert_id));
                          else filteredPending.forEach(a => next.add(a.alert_id));
                          return next;
                        });
                      }}
                      className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/30 cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-400">All</span>
                  </label>
                )}
                {filteredPending.length > 0 && (
                  <button
                    onClick={() => handleDismissPending()}
                    disabled={loadingAction === 'dismiss-pend'}
                    className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {loadingAction === 'dismiss-pend' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    {selectedPending.size > 0 ? `Dismiss (${selectedPending.size})` : 'Dismiss All'}
                  </button>
                )}
                <button
                  onClick={() => handleDistribute()}
                  disabled={distributing || pendingAlerts.length === 0}
                  title="Distributes the pending queue"
                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {distributing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Distribute Now
                </button>
              </div>
            }
          >
            <div className="p-3 space-y-1.5 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(50vh - 50px)' }}>
              {filteredPending.length > 0 ? filteredPending.map((alert) => (
                <PendingAlertRow
                  key={alert.alert_id} alert={alert} agents={allAgents}
                  onAssign={(agentId, force) => handleAssignAlert(alert.alert_id, agentId, force)}
                  onResolve={(type, notes) => handleSupervisorResolve(alert.alert_id, type, notes)}
                  selected={selectedPending.has(alert.alert_id)}
                  onToggleSelect={() => togglePendingSelect(alert.alert_id)}
                  loading={loadingAction === `assign-${alert.alert_id}` || loadingAction === `resolve-${alert.alert_id}`}
                />
              )) : <EmptyState icon={<CheckCircle className="w-10 h-10 text-emerald-500" />} message={pendingTerm ? 'No matches in pending queue' : 'No pending alerts'} />}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

// ─── Helpers ───────────────────────────────────────────────────
function StatCard({ icon, label, value, color, highlight }: {
  icon: React.ReactNode; label: string; value: number;
  color: 'emerald' | 'amber' | 'blue' | 'purple'; highlight?: boolean;
}) {
  const cls: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    amber:   'bg-amber-500/10 border-amber-500/30 text-amber-400',
    blue:    'bg-blue-500/10 border-blue-500/30 text-blue-400',
    purple:  'bg-purple-500/10 border-purple-500/30 text-purple-400',
  };
  return (
    <div className={`rounded-lg border p-4 ${cls[color]} ${highlight ? 'ring-1 ring-red-500/50' : ''}`}>
      <div className="flex items-center gap-2">{icon}<span className="text-sm font-medium">{label}</span></div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="text-center py-6 text-slate-400">
      <div className="mx-auto mb-2 opacity-30 w-fit">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

export default SupervisorAlertDashboard;
