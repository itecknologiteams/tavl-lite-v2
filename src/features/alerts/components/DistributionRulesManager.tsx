/**
 * Distribution Rules Manager
 * Single canonical UI for managing alert routing rules.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Shield,
  Battery,
  MapPin,
  Moon,
  Bell,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  ArrowRight,
  Info,
  Landmark,
  Building2,
  ChevronDown,
} from 'lucide-react';
import { useAlertDistributionStore, DistributionRule, AgentSession, BankOption, CorporateOption } from '@store/alertDistributionStore';
import { api } from '@services/api';

interface AlertTypeOption {
  id: number;
  event_name: string;
  category: string;
  severity: string;
  match_mode: string;
  enabled: boolean;
}

const RULE_TYPES = [
  { id: 'alert_type_routing', label: 'Alert Type Routing', icon: Bell, description: 'Route specific alert types to designated agents' },
  { id: 'bank_routing', label: 'Bank Routing', icon: Landmark, description: 'Route alerts by leasing bank (DIB, HBL, etc.)' },
  { id: 'corporate_routing', label: 'Corporate Routing', icon: Building2, description: 'Route alerts by corporate/insurer (SECP, etc.)' },
];

const ALERT_TYPES = [
  { id: 'panic', label: 'Panic/SOS', icon: Shield, color: 'text-red-400', bg: 'bg-red-500/15' },
  { id: 'battery', label: 'Battery Disconnect', icon: Battery, color: 'text-amber-400', bg: 'bg-amber-500/15' },
  { id: 'geofence', label: 'Geofence Exit', icon: MapPin, color: 'text-purple-400', bg: 'bg-purple-500/15' },
  { id: 'late_night', label: 'Late Night Movement', icon: Moon, color: 'text-blue-400', bg: 'bg-blue-500/15' },
];

const PRIORITY_PRESETS = [
  { value: 1, label: 'Highest', color: 'text-red-400 bg-red-500/15 border-red-500/30' },
  { value: 5, label: 'High', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  { value: 10, label: 'Normal', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  { value: 20, label: 'Low', color: 'text-slate-400 bg-slate-500/15 border-slate-500/30' },
];

function resolveAgentName(userId: string, agents: AgentSession[]): string {
  return agents.find(a => a.user_id === userId)?.username || userId;
}

function getAlertTypeMeta(typeId: string) {
  return ALERT_TYPES.find(t => t.id === typeId) || { id: typeId, label: typeId, icon: Bell, color: 'text-slate-400', bg: 'bg-slate-500/15' };
}

// ─── Rule Form ──────────────────────────────────────────────
interface RuleFormProps {
  rule?: DistributionRule;
  agents: AgentSession[];
  banks: BankOption[];
  corporates: CorporateOption[];
  onSave: (rule: Partial<DistributionRule> & { config: any }) => void;
  onCancel: () => void;
  loading?: boolean;
}

const RuleForm: React.FC<RuleFormProps> = ({ rule, agents, banks, corporates, onSave, onCancel, loading }) => {
  const config = rule ? (typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config) : {};

  const [ruleType, setRuleType] = useState(rule?.rule_type || 'alert_type_routing');
  const [ruleName, setRuleName] = useState(rule?.rule_name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [priority, setPriority] = useState(rule?.priority || 10);
  const [selectedAlertType, setSelectedAlertType] = useState<string>(config.alertType || '');
  const [selectedBankId, setSelectedBankId] = useState<number | null>(config.bankId ?? null);
  const [selectedCorpId, setSelectedCorpId] = useState<number | null>(config.corpId ?? null);
  const [excludeAlertTypes, setExcludeAlertTypes] = useState<string[]>(
    Array.isArray(config.excludeAlertTypes) ? config.excludeAlertTypes : []
  );
  const [alertTypeOptions, setAlertTypeOptions] = useState<AlertTypeOption[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(config.agents || []);

  useEffect(() => {
    if (ruleType !== 'corporate_routing' && ruleType !== 'bank_routing') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.distribution.getAlertTypes() as any;
        if (!cancelled && res?.success && Array.isArray(res.data)) {
          setAlertTypeOptions(res.data.filter((c: AlertTypeOption) => c.enabled !== false));
        }
      } catch {
        if (!cancelled) setAlertTypeOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [ruleType]);

  const toggleExcludeAlertType = (eventName: string) => {
    setExcludeAlertTypes(prev =>
      prev.includes(eventName) ? prev.filter(n => n !== eventName) : [...prev, eventName]
    );
  };

  const [excludeOpen, setExcludeOpen] = useState(false);
  const excludeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!excludeOpen) return;
    const handler = (e: MouseEvent) => {
      if (excludeRef.current && !excludeRef.current.contains(e.target as Node)) {
        setExcludeOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [excludeOpen]);

  const isValid = () => {
    if (!ruleName.trim()) return false;
    if (selectedAgents.length === 0) return false;
    if (ruleType === 'alert_type_routing' && !selectedAlertType) return false;
    if (ruleType === 'bank_routing' && !selectedBankId) return false;
    if (ruleType === 'corporate_routing' && !selectedCorpId) return false;
    return true;
  };

  const handleSubmit = () => {
    if (!isValid()) return;
    const newConfig: any = { agents: selectedAgents };
    if (ruleType === 'alert_type_routing') newConfig.alertType = selectedAlertType;
    if (ruleType === 'bank_routing') {
      newConfig.bankId = selectedBankId;
      newConfig.bankName = banks.find(b => b.id === selectedBankId)?.name || '';
      if (excludeAlertTypes.length > 0) newConfig.excludeAlertTypes = excludeAlertTypes;
    }
    if (ruleType === 'corporate_routing') {
      newConfig.corpId = selectedCorpId;
      newConfig.corpName = corporates.find(c => c.id === selectedCorpId)?.name || '';
      if (excludeAlertTypes.length > 0) newConfig.excludeAlertTypes = excludeAlertTypes;
    }

    onSave({
      rule_type: ruleType,
      rule_name: ruleName.trim(),
      description: description.trim() || null,
      priority,
      config: newConfig,
    });
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    );
  };

  const allAgentsSorted = [...agents].sort((a, b) => {
    const order: Record<string, number> = { online: 0, break_requested: 1, on_break: 2, offline: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  return (
    <div className="bg-slate-800/90 border border-white/10 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">
          {rule ? 'Edit Rule' : 'Create New Rule'}
        </h4>
        <button onClick={onCancel} className="p-1 text-slate-400 hover:text-white rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Rule Type */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Rule Type</label>
        <div className="grid grid-cols-2 gap-2">
          {RULE_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                onClick={() => setRuleType(type.id)}
                className={`flex items-center gap-2.5 p-3 rounded-lg border transition-all ${
                  ruleType === type.id
                    ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <div className="text-left">
                  <div className="text-xs font-medium">{type.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{type.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>


      {/* Rule Name + Description */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Rule Name <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            placeholder="e.g. Panic to Senior Agents"
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description..."
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
      </div>

      {/* Alert Type Selection */}
      {ruleType === 'alert_type_routing' && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">Alert Type <span className="text-red-400">*</span></label>
          <div className="grid grid-cols-2 gap-2">
            {ALERT_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => setSelectedAlertType(type.id)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${
                    selectedAlertType === type.id
                      ? `${type.bg} ${type.color} border-current/30 font-medium`
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{type.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bank Selection */}
      {ruleType === 'bank_routing' && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Leasing Bank <span className="text-red-400">*</span>
          </label>
          {banks.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">Loading banks...</p>
          ) : (
            <select
              value={selectedBankId ?? ''}
              onChange={(e) => setSelectedBankId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
            >
              <option value="">Select a bank...</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <p className="text-[10px] text-slate-500 mt-1">
            Alerts for vehicles leased by this bank will be routed to selected agents
          </p>
        </div>
      )}

      {/* Corporate Selection */}
      {ruleType === 'corporate_routing' && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Corporate / Insurer <span className="text-red-400">*</span>
          </label>
          {corporates.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">Loading corporates...</p>
          ) : (
            <select
              value={selectedCorpId ?? ''}
              onChange={(e) => setSelectedCorpId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
            >
              <option value="">Select a corporate...</option>
              {corporates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <p className="text-[10px] text-slate-500 mt-1">
            Alerts for vehicles insured by this corporate will be routed to selected agents
          </p>
        </div>
      )}

      {/* Exclude Events (shared by bank_routing + corporate_routing) */}
      {(ruleType === 'bank_routing' || ruleType === 'corporate_routing') && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Exclude events</label>
          <div ref={excludeRef} className="relative">
            <button
              type="button"
              onClick={() => setExcludeOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-left focus:outline-none focus:border-violet-500/50"
            >
              <span className={excludeAlertTypes.length === 0 ? 'text-gray-500' : 'text-white'}>
                {excludeAlertTypes.length === 0
                  ? 'Select events to exclude…'
                  : `${excludeAlertTypes.length} event${excludeAlertTypes.length === 1 ? '' : 's'} selected`}
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${excludeOpen ? 'rotate-180' : ''}`} />
            </button>

            {excludeOpen && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-900 border border-white/10 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
                {alertTypeOptions.length === 0 ? (
                  <p className="text-[11px] text-gray-500 px-3 py-2">No alert types configured</p>
                ) : (
                  alertTypeOptions.map((opt) => {
                    const isSelected = excludeAlertTypes.includes(opt.event_name);
                    return (
                      <label
                        key={opt.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleExcludeAlertType(opt.event_name)}
                          className="accent-violet-500"
                        />
                        <span className="flex-1">{opt.event_name}</span>
                        <span className="text-[10px] text-gray-500">{opt.match_mode}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {excludeAlertTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {excludeAlertTypes.map(name => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-violet-500/20 text-violet-200 text-[11px] border border-violet-500/30"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => toggleExcludeAlertType(name)}
                    className="p-0.5 hover:bg-violet-500/30 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <p className="text-[10px] text-gray-500 mt-1">
            Selected alert types will NOT be sent to this rule's agents (they fall through to other agents).
          </p>
        </div>
      )}

      {/* Priority */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Priority</label>
        <div className="flex gap-2">
          {PRIORITY_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPriority(p.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                priority === p.value ? p.color : 'border-white/10 bg-white/5 text-slate-500 hover:bg-white/10'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          Higher priority rules are evaluated first when distributing alerts
        </p>
      </div>

      {/* Agent Selection */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Assign to Agents <span className="text-red-400">*</span></label>
        <div className="flex flex-wrap gap-2">
          {allAgentsSorted.map((agent) => (
            <button
              key={agent.user_id}
              onClick={() => toggleAgent(agent.user_id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                selectedAgents.includes(agent.user_id)
                  ? 'border-violet-500/50 bg-violet-500/20 text-violet-300'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
              } ${agent.status === 'offline' ? 'opacity-50' : ''}`}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                agent.status === 'online' ? 'bg-emerald-500' :
                agent.status === 'break_requested' ? 'bg-amber-500' :
                agent.status === 'on_break' ? 'bg-blue-500' : 'bg-slate-500'
              }`} />
              <span className="text-sm">{agent.username}</span>
              {agent.status === 'offline' && <span className="text-[9px] text-slate-500">(offline)</span>}
            </button>
          ))}
          {allAgentsSorted.length === 0 && (
            <p className="text-sm text-slate-500">No agents registered</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || !isValid()}
          className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-600
                   text-white rounded-lg text-sm font-medium transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {rule ? 'Update Rule' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
};

// ─── Rule Card ──────────────────────────────────────────────
interface RuleCardProps {
  rule: DistributionRule;
  agents: AgentSession[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (isActive: boolean) => void;
  loading?: boolean;
}

const RuleCard: React.FC<RuleCardProps> = ({ rule, agents, onEdit, onDelete, onToggle, loading }) => {
  const ruleTypeConfig = RULE_TYPES.find(t => t.id === rule.rule_type);
  const RuleIcon = ruleTypeConfig?.icon || Settings;

  const config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
  const assignedAgentNames = (config.agents || []).map((id: string) => resolveAgentName(id, agents));
  const excludedEvents: string[] = Array.isArray(config.excludeAlertTypes) ? config.excludeAlertTypes : [];

  let targetDescription = '';
  let TargetIcon = Bell;
  let targetColor = 'text-slate-400';
  if (rule.rule_type === 'alert_type_routing' && config.alertType) {
    const meta = getAlertTypeMeta(config.alertType);
    targetDescription = meta.label;
    TargetIcon = meta.icon;
    targetColor = meta.color;
  } else if (rule.rule_type === 'bank_routing') {
    targetDescription = config.bankName ? `Bank: ${config.bankName}` : `Bank #${config.bankId}`;
    TargetIcon = Landmark;
    targetColor = 'text-emerald-400';
  } else if (rule.rule_type === 'corporate_routing') {
    targetDescription = config.corpName ? `Corp: ${config.corpName}` : `Corp #${config.corpId}`;
    TargetIcon = Building2;
    targetColor = 'text-blue-400';
  }

  const priorityMeta = PRIORITY_PRESETS.find(p => p.value === rule.priority)
    || { label: `P${rule.priority}`, color: 'text-slate-400 bg-slate-500/15 border-slate-500/30' };

  const handleDelete = () => {
    if (!confirm(`Delete rule "${rule.rule_name}"? This cannot be undone.`)) return;
    onDelete();
  };

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      rule.is_active ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/5 opacity-60'
    }`}>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            rule.is_active ? 'bg-violet-500/20' : 'bg-slate-500/10'
          }`}>
            <RuleIcon className={`w-5 h-5 ${rule.is_active ? 'text-violet-400' : 'text-slate-500'}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">{rule.rule_name}</span>
              <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${priorityMeta.color}`}>
                {priorityMeta.label}
              </span>
              {!rule.is_active && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-500/20 text-slate-400 rounded">
                  Disabled
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
              <TargetIcon className={`w-3.5 h-3.5 ${targetColor}`} />
              <span className={targetColor}>{targetDescription || 'All alerts'}</span>
              <ArrowRight className="w-3 h-3 text-slate-600" />
              <span className="text-slate-300 truncate">{assignedAgentNames.join(', ') || 'No agents'}</span>
            </div>
            {rule.description && (
              <p className="text-[10px] text-slate-500 mt-0.5 truncate">{rule.description}</p>
            )}
            {(rule.rule_type === 'corporate_routing' || rule.rule_type === 'bank_routing') && excludedEvents.length > 0 && (
              <div className="flex items-start gap-1.5 mt-1 flex-wrap">
                <span className="text-[10px] text-gray-500 mt-0.5">Excludes:</span>
                {excludedEvents.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] border border-violet-500/30"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button
            onClick={() => onToggle(!rule.is_active)}
            disabled={loading}
            className="p-1.5 text-slate-400 hover:text-white transition-colors"
            title={rule.is_active ? 'Disable rule' : 'Enable rule'}
          >
            {rule.is_active ? (
              <ToggleRight className="w-5 h-5 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 text-slate-400 hover:text-white transition-colors"
            title="Edit rule"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
            title="Delete rule"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────
const DistributionRulesManager: React.FC = () => {
  const {
    rules,
    allAgents,
    banks,
    corporates,
    loading,
    fetchRules,
    fetchAgents,
    fetchBanks,
    fetchCorporates,
    createRule,
    updateRule,
    deleteRule,
  } = useAlertDistributionStore();

  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<DistributionRule | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  useEffect(() => {
    fetchRules();
    fetchAgents();
    fetchBanks();
    fetchCorporates();
  }, [fetchRules, fetchAgents, fetchBanks, fetchCorporates]);

  const handleCreateRule = useCallback(async (rule: Partial<DistributionRule> & { config: any }) => {
    setLoadingAction(true);
    await createRule(rule);
    setLoadingAction(false);
    setShowForm(false);
  }, [createRule]);

  const handleUpdateRule = useCallback(async (updates: Partial<DistributionRule> & { config: any }) => {
    if (!editingRule) return;
    setLoadingAction(true);
    await updateRule(editingRule.id, {
      config: updates.config,
      isActive: editingRule.is_active,
      ruleName: updates.rule_name,
      description: updates.description ?? undefined,
      priority: updates.priority,
      ruleType: updates.rule_type,
    });
    setLoadingAction(false);
    setEditingRule(null);
  }, [editingRule, updateRule]);

  const handleToggleRule = useCallback(async (ruleId: number, isActive: boolean) => {
    setLoadingAction(true);
    await updateRule(ruleId, { isActive });
    setLoadingAction(false);
  }, [updateRule]);

  const handleDeleteRule = useCallback(async (ruleId: number) => {
    setLoadingAction(true);
    await deleteRule(ruleId);
    setLoadingAction(false);
  }, [deleteRule]);

  const activeRules = rules.filter(r => r.is_active);
  const inactiveRules = rules.filter(r => !r.is_active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-white">Distribution Rules</h2>
          <p className="text-sm text-slate-400 mt-1">
            Configure how alerts are routed to agents. Rules are evaluated by priority — higher priority rules are checked first.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { fetchRules(); fetchAgents(); fetchBanks(); fetchCorporates(); }}
            disabled={loading}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!showForm && !editingRule && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400
                       rounded-lg transition-colors border border-violet-500/30 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">New Rule</span>
            </button>
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 p-3.5 bg-blue-500/8 border border-blue-500/20 rounded-xl">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-slate-300 leading-relaxed">
          <p className="font-medium text-blue-400 mb-1">How Distribution Rules Work</p>
          When an alert arrives, rules are checked in priority order. The first matching rule with an available
          agent gets the alert. If no rule matches or assigned agents are unavailable, the smart scoring
          algorithm (load 40%, performance 30%, escalation rate 20%, fairness 10%) distributes automatically.
        </div>
      </div>

      {/* Form */}
      <AnimatePresence>
        {(showForm || editingRule) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <RuleForm
              rule={editingRule || undefined}
              agents={allAgents}
              banks={banks}
              corporates={corporates}
              onSave={editingRule ? handleUpdateRule : handleCreateRule}
              onCancel={() => { setShowForm(false); setEditingRule(null); }}
              loading={loadingAction}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Rules */}
      {!showForm && !editingRule && (
        <div className="space-y-3">
          {activeRules.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Active Rules ({activeRules.length})
              </h3>
              {activeRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  agents={allAgents}
                  onEdit={() => setEditingRule(rule)}
                  onDelete={() => handleDeleteRule(rule.id)}
                  onToggle={(isActive) => handleToggleRule(rule.id, isActive)}
                  loading={loadingAction}
                />
              ))}
            </div>
          )}

          {inactiveRules.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Disabled Rules ({inactiveRules.length})
              </h3>
              {inactiveRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  agents={allAgents}
                  onEdit={() => setEditingRule(rule)}
                  onDelete={() => handleDeleteRule(rule.id)}
                  onToggle={(isActive) => handleToggleRule(rule.id, isActive)}
                  loading={loadingAction}
                />
              ))}
            </div>
          )}

          {rules.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No distribution rules configured</p>
              <p className="text-xs mt-1 text-slate-500">
                Alerts will be distributed using the smart scoring algorithm
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30
                         text-violet-400 rounded-lg transition-colors border border-violet-500/30 text-sm"
              >
                <Plus className="w-4 h-4" />
                Create Your First Rule
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DistributionRulesManager;
