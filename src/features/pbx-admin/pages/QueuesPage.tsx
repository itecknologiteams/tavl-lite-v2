import React, { useEffect, useState, useMemo } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import { useConfigStore } from '../stores/configStore';
import {
  Plus, Edit2, Trash2, Save, X, RefreshCw, Users, Phone,
  CheckCircle, AlertCircle, Info, Search,
  ArrowRight, ArrowLeft, RotateCcw, Radio, Clock, Shuffle,
  ArrowDownAZ, Dices, Music, Timer, MessageSquare, PhoneOff,
} from 'lucide-react';

interface Queue {
  name: string;
  params: Record<string, string>;
  members: string[];
  calls?: number;
  memberCount?: number;
  availableMembers?: number;
  holdtime?: string;
  completed?: string;
  abandoned?: string;
}

interface QueueFormData {
  name: string;
  strategy: string;
  musicclass: string;
  timeout: string;
  retry: string;
  wrapuptime: string;
  maxlen: string;
  joinempty: string;
  leavewhenempty: string;
  members: string[];
  announce_frequency: string;
  announce_holdtime: string;
  announce_position: string;
  announce_position_limit: string;
  announce_round_seconds: string;
  periodic_announce: string;
  periodic_announce_frequency: string;
  announce_to_first_user: string;
  relative_periodic_announce: string;
  min_announce_frequency: string;
}

const defaultForm: QueueFormData = {
  name: '',
  strategy: 'ring-all',
  musicclass: 'default',
  timeout: '15',
  retry: '5',
  wrapuptime: '0',
  maxlen: '0',
  joinempty: 'yes',
  leavewhenempty: 'no',
  members: [],
  announce_frequency: '30',
  announce_holdtime: 'once',
  announce_position: 'yes',
  announce_position_limit: '5',
  announce_round_seconds: '10',
  periodic_announce: '',
  periodic_announce_frequency: '45',
  announce_to_first_user: 'yes',
  relative_periodic_announce: 'yes',
  min_announce_frequency: '15',
};

const STRATEGIES = [
  {
    value: 'round-robin',
    label: 'Round Robin',
    desc: 'Each agent takes turns answering calls',
    icon: RotateCcw,
  },
  {
    value: 'ring-all',
    label: 'Ring All',
    desc: 'All agents ring at the same time',
    icon: Radio,
  },
  {
    value: 'longest-idle-agent',
    label: 'Longest Idle',
    desc: 'Ring the agent who has been free the longest',
    icon: Clock,
  },
  {
    value: 'top-down',
    label: 'Top Down',
    desc: 'Always try first agent, then second, etc.',
    icon: ArrowDownAZ,
  },
  {
    value: 'random',
    label: 'Random',
    desc: 'Pick a random available agent',
    icon: Dices,
  },
] as const;

function strategyLabel(value: string): string {
  return STRATEGIES.find(s => s.value === value)?.label ?? value;
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block">
      <Info className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 cursor-help" />
      <span className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded shadow-lg whitespace-nowrap max-w-xs">
        {text}
      </span>
    </span>
  );
}

export function QueuesPage() {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [extensions, setExtensions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mohClasses, setMohClasses] = useState<string[]>(['default']);
  const [recordings, setRecordings] = useState<{ name: string; path: string }[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'add' | 'edit'>('add');
  const [wizardStep, setWizardStep] = useState(0);
  const [formData, setFormData] = useState<QueueFormData>({ ...defaultForm });
  const [saving, setSaving] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');

  const { addChange } = useConfigStore();

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [qRes, eRes, mRes, rRes] = await Promise.all([
        adminApi('/queues'), adminApi('/extensions'), adminApi('/moh'), adminApi('/recordings'),
      ]);
      const [qData, eData, mData, rData] = await Promise.all([qRes.json(), eRes.json(), mRes.json(), rRes.json()]);
      if (qData.success) setQueues(qData.queues);
      if (eData.success) setExtensions(eData.extensions);
      if (mData.success && mData.classes) setMohClasses(mData.classes.map((c: any) => c.name));
      if (rData.success && rData.recordings) setRecordings(rData.recordings);
    } catch (err) {
      console.error('Failed to fetch queue data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openWizard = (mode: 'add' | 'edit', queue?: Queue) => {
    setWizardMode(mode);
    setWizardStep(0);
    setAgentSearch('');
    if (mode === 'edit' && queue) {
      const p = queue.params;
      setFormData({
        name: queue.name,
        strategy: p.strategy || 'ring-all',
        musicclass: p.musicclass || 'default',
        timeout: p.timeout || '15',
        retry: p.retry || '5',
        wrapuptime: p.wrapuptime || '0',
        maxlen: p.maxlen || '0',
        joinempty: p.joinempty || 'yes',
        leavewhenempty: p.leavewhenempty || 'no',
        members: queue.members || [],
        announce_frequency: p['announce-frequency'] || '30',
        announce_holdtime: p['announce-holdtime'] || 'once',
        announce_position: p['announce-position'] || 'yes',
        announce_position_limit: p['announce-position-limit'] || '5',
        announce_round_seconds: p['announce-round-seconds'] || '10',
        periodic_announce: p['periodic-announce'] || '',
        periodic_announce_frequency: p['periodic-announce-frequency'] || '45',
        announce_to_first_user: p['announce-to-first-user'] || 'yes',
        relative_periodic_announce: p['relative-periodic-announce'] || 'yes',
        min_announce_frequency: p['min-announce-frequency'] || '15',
      });
    } else {
      setFormData({ ...defaultForm });
    }
    setWizardOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...formData };
      if (wizardMode === 'add') {
        const res = await adminApi('/queues', { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
          addChange({ type: 'queue', name: formData.name, action: 'create', data: payload });
          setWizardOpen(false);
          setToast({ type: 'success', message: `Call group "${formData.name}" created` });
          fetchData();
        } else {
          setToast({ type: 'error', message: data.error || 'Failed to create call group' });
        }
      } else {
        const res = await adminApi(`/queues/${formData.name}`, { method: 'PUT', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
          addChange({ type: 'queue', name: formData.name, action: 'update', data: payload });
          setWizardOpen(false);
          setToast({ type: 'success', message: `Call group "${formData.name}" updated` });
          fetchData();
        } else {
          setToast({ type: 'error', message: data.error || 'Failed to update call group' });
        }
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save call group' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (queue: Queue) => {
    if (!confirm(`Delete call group "${queue.name}"?\n\nThis action cannot be undone.`)) return;
    try {
      const res = await adminApi(`/queues/${queue.name}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        addChange({ type: 'queue', name: queue.name, action: 'delete', data: queue });
        setToast({ type: 'success', message: `Call group "${queue.name}" deleted` });
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete call group' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete call group' });
    }
  };

  const toggleMember = (extNumber: string) => {
    const iface = `PJSIP/${extNumber}`;
    setFormData(prev => ({
      ...prev,
      members: prev.members.includes(iface)
        ? prev.members.filter(m => m !== iface)
        : [...prev.members, iface],
    }));
  };

  const removeMember = (iface: string) => {
    setFormData(prev => ({ ...prev, members: prev.members.filter(m => m !== iface) }));
  };

  const filteredExtensions = useMemo(() => {
    if (!agentSearch.trim()) return extensions;
    const q = agentSearch.toLowerCase();
    return extensions.filter(e => {
      const name = (e.callerid || '').replace(/^"?([^"]*)"?\s*<.*>$/, '$1').toLowerCase();
      return e.extension.includes(q) || name.includes(q);
    });
  }, [extensions, agentSearch]);

  const maxWaitMinutes = parseInt(formData.timeout) ? Math.round(parseInt(formData.timeout) / 60) || 1 : 5;
  const maxWaitSlider = Math.min(Math.max(parseInt(formData.maxlen) || 0, 0), 30);

  const stepValid = (step: number): boolean => {
    if (step === 0) return formData.name.trim().length > 0 && formData.strategy.length > 0;
    if (step === 1) return true;
    return true;
  };

  const STEPS = ['Basics', 'Add Team Members', 'Caller Experience'] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Call Groups</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage how incoming calls are distributed to your team
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => openWizard('add')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium"
          >
            <Plus className="w-4 h-4" /> New Call Group
          </button>
        </div>
      </div>

      {/* Queue List Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      ) : queues.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-800/40 border border-slate-700/50 rounded-xl">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-slate-400">No call groups yet</p>
          <p className="text-xs text-slate-600 mt-1">Create one to start routing calls to your team</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Group Name
                </th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Strategy
                </th>
                <th className="text-center px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Team Members
                </th>
                <th className="text-center px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-right px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {queues.map(queue => {
                const memberCount = queue.memberCount ?? queue.members.length;
                const available = queue.availableMembers ?? 0;
                const hasAvailable = available > 0;
                return (
                  <tr
                    key={queue.name}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-5 py-4">
                      <span className="text-white font-medium">{queue.name}</span>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {strategyLabel(queue.params.strategy)}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="text-white font-medium">{memberCount}</span>
                      <span className="text-slate-500 ml-1">member{memberCount !== 1 ? 's' : ''}</span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        hasAvailable
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-slate-700/50 text-slate-400 border border-slate-600/30'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${hasAvailable ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        {hasAvailable ? `${available} online` : 'No one online'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openWizard('edit', queue)}
                          className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-all"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(queue)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Wizard Modal */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setWizardOpen(false)} />
          <div
            className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
            style={{ animation: 'wizardFadeIn 0.2s ease-out' }}
          >
            {/* Wizard Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {wizardMode === 'add' ? 'Create Call Group' : `Edit: ${formData.name}`}
                </h2>
                <p className="text-slate-500 text-xs mt-0.5">
                  Step {wizardStep + 1} of {STEPS.length} — {STEPS[wizardStep]}
                </p>
              </div>
              <button
                onClick={() => setWizardOpen(false)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="flex items-center gap-1 px-6 pb-4">
              {STEPS.map((label, i) => (
                <React.Fragment key={i}>
                  <button
                    onClick={() => { if (i < wizardStep || stepValid(wizardStep)) setWizardStep(i); }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      i === wizardStep
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : i < wizardStep
                        ? 'bg-slate-800 text-emerald-400/70 border border-slate-700/50'
                        : 'bg-slate-800/50 text-slate-500 border border-slate-700/30'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      i < wizardStep
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : i === wizardStep
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-700/50 text-slate-500'
                    }`}>
                      {i < wizardStep ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                    </span>
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-px ${i < wizardStep ? 'bg-emerald-500/30' : 'bg-slate-700/50'}`} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Step Content */}
            <div className="flex-1 overflow-y-auto px-6 pb-2 min-h-0">
              {/* Step 1: Basics */}
              {wizardStep === 0 && (
                <div className="space-y-6">
                  <div>
                    <label className="flex items-center text-sm font-medium text-slate-300 mb-2">
                      Group Name
                      <Tooltip text="A unique name for this call group (e.g. sales, support)" />
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., sales-team"
                      disabled={wizardMode === 'edit'}
                      className={`w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all ${
                        wizardMode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    />
                  </div>

                  <div>
                    <label className="flex items-center text-sm font-medium text-slate-300 mb-3">
                      Ring Strategy
                      <Tooltip text="How incoming calls are distributed among team members" />
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {STRATEGIES.map(strat => {
                        const active = formData.strategy === strat.value;
                        const Icon = strat.icon;
                        return (
                          <button
                            key={strat.value}
                            type="button"
                            onClick={() => setFormData({ ...formData, strategy: strat.value })}
                            className={`flex items-center gap-4 p-3.5 rounded-xl border text-left transition-all ${
                              active
                                ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/20'
                                : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600/60 hover:bg-slate-800/60'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                              active
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-slate-700/40 text-slate-500'
                            }`}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className={`text-sm font-medium ${active ? 'text-emerald-300' : 'text-slate-200'}`}>
                                {strat.label}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">{strat.desc}</p>
                            </div>
                            {active && (
                              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 ml-auto" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Add Team Members */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  {/* Selected Members Pills */}
                  {formData.members.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-2">
                        Selected ({formData.members.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {formData.members.map(iface => {
                          const extNum = iface.replace('PJSIP/', '').replace('SIP/', '');
                          const ext = extensions.find(e => e.extension === extNum);
                          const name = ext?.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || extNum;
                          return (
                            <span
                              key={iface}
                              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-emerald-500/10 border border-emerald-500/25 rounded-full text-xs text-emerald-300"
                            >
                              <Phone className="w-3 h-3" />
                              <span className="font-medium">{extNum}</span>
                              <span className="text-emerald-400/60">{name !== extNum ? name : ''}</span>
                              <button
                                onClick={() => removeMember(iface)}
                                className="ml-0.5 p-0.5 rounded-full hover:bg-emerald-500/20 text-emerald-400/50 hover:text-emerald-300 transition-all"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={agentSearch}
                      onChange={e => setAgentSearch(e.target.value)}
                      placeholder="Search by extension or name..."
                      className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pl-9 pr-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>

                  {/* Extension List */}
                  <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1 -mr-1">
                    {filteredExtensions.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <Search className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No extensions found</p>
                      </div>
                    ) : (
                      filteredExtensions.map(ext => {
                        const iface = `PJSIP/${ext.extension}`;
                        const selected = formData.members.includes(iface);
                        const name = ext.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || '';
                        const online = ext.status === 'online' || ext.status === 'OK' || ext.state === 'Idle';
                        return (
                          <button
                            key={ext.extension}
                            type="button"
                            onClick={() => toggleMember(ext.extension)}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg border text-left transition-all ${
                              selected
                                ? 'bg-emerald-500/8 border-emerald-500/30'
                                : 'bg-slate-800/30 border-slate-700/30 hover:bg-slate-800/50 hover:border-slate-600/40'
                            }`}
                          >
                            {/* Checkbox */}
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                              selected
                                ? 'bg-emerald-500 border-emerald-500'
                                : 'border-slate-600 bg-transparent'
                            }`}>
                              {selected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-white font-medium">{ext.extension}</span>
                                {name && <span className="text-sm text-slate-400 truncate">{name}</span>}
                              </div>
                            </div>

                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              online
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-slate-700/50 text-slate-500'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                              {online ? 'Online' : 'Offline'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Caller Experience */}
              {wizardStep === 2 && (
                <div className="space-y-6">
                  {/* Hold Music */}
                  <div>
                    <label className="flex items-center text-sm font-medium text-slate-300 mb-2">
                      <Music className="w-4 h-4 mr-2 text-slate-500" />
                      Hold Music
                      <Tooltip text="The music callers hear while waiting in the queue" />
                    </label>
                    <select
                      value={formData.musicclass}
                      onChange={e => setFormData({ ...formData, musicclass: e.target.value })}
                      className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all appearance-none"
                    >
                      {mohClasses.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      {!mohClasses.includes(formData.musicclass) && formData.musicclass && (
                        <option value={formData.musicclass}>{formData.musicclass} (not found)</option>
                      )}
                    </select>
                  </div>

                  {/* Max Wait Time Slider */}
                  <div>
                    <label className="flex items-center text-sm font-medium text-slate-300 mb-2">
                      <Timer className="w-4 h-4 mr-2 text-slate-500" />
                      Max Wait Time
                      <Tooltip text="Maximum time (in minutes) a caller will wait before the overflow action triggers" />
                    </label>
                    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-slate-500">1 min</span>
                        <span className="text-lg font-bold text-emerald-400">
                          {formData.maxlen === '0' ? '∞' : `${formData.maxlen} min`}
                        </span>
                        <span className="text-xs text-slate-500">30 min</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={30}
                        value={parseInt(formData.maxlen) || 0}
                        onChange={e => setFormData({ ...formData, maxlen: e.target.value })}
                        className="w-full h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-emerald-500 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-lg"
                      />
                      <p className="text-xs text-slate-600 mt-2">
                        {formData.maxlen === '0'
                          ? 'No limit — callers wait indefinitely'
                          : `Callers wait up to ${formData.maxlen} minute${formData.maxlen === '1' ? '' : 's'}`}
                      </p>
                    </div>
                  </div>

                  {/* Announce position toggle */}
                  <div>
                    <label className="flex items-center text-sm font-medium text-slate-300 mb-2">
                      <MessageSquare className="w-4 h-4 mr-2 text-slate-500" />
                      Announce position in queue
                      <Tooltip text="Tell callers their place in line while they wait" />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData(prev => ({
                          ...prev,
                          announce_position: prev.announce_position === 'yes' ? 'no' : 'yes',
                        }))
                      }
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        formData.announce_position === 'yes'
                          ? 'bg-emerald-500'
                          : 'bg-slate-700'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        formData.announce_position === 'yes' ? 'translate-x-6' : 'translate-x-0'
                      }`} />
                    </button>
                    <p className="text-xs text-slate-600 mt-1.5">
                      {formData.announce_position === 'yes'
                        ? 'Callers will hear "You are number X in line"'
                        : 'Callers will not hear their position'}
                    </p>
                  </div>

                  {/* No agents available action */}
                  <div>
                    <label className="flex items-center text-sm font-medium text-slate-300 mb-2">
                      <PhoneOff className="w-4 h-4 mr-2 text-slate-500" />
                      When no team members are available
                      <Tooltip text="What happens when a caller is in the queue but no team members are logged in" />
                    </label>
                    <select
                      value={formData.leavewhenempty === 'no' ? 'keep-waiting' : formData.leavewhenempty === 'yes' ? 'goodbye' : 'voicemail'}
                      onChange={e => {
                        const val = e.target.value;
                        setFormData(prev => ({
                          ...prev,
                          leavewhenempty: val === 'keep-waiting' ? 'no' : val === 'goodbye' ? 'yes' : 'strict',
                          joinempty: val === 'keep-waiting' ? 'yes' : 'no',
                        }));
                      }}
                      className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all appearance-none"
                    >
                      <option value="goodbye">Play goodbye message and hang up</option>
                      <option value="voicemail">Transfer to voicemail</option>
                      <option value="keep-waiting">Keep waiting</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Wizard Footer */}
            <div className="px-6 py-4 border-t border-slate-700/40 bg-slate-900/80 flex items-center justify-between rounded-b-2xl">
              <button
                onClick={() => {
                  if (wizardStep === 0) setWizardOpen(false);
                  else setWizardStep(s => s - 1);
                }}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white flex items-center gap-1.5 transition-all rounded-lg hover:bg-slate-800"
              >
                {wizardStep === 0 ? (
                  'Cancel'
                ) : (
                  <><ArrowLeft className="w-4 h-4" /> Back</>
                )}
              </button>

              {wizardStep < STEPS.length - 1 ? (
                <button
                  onClick={() => setWizardStep(s => s + 1)}
                  disabled={!stepValid(wizardStep)}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.name.trim()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="w-4 h-4" /> {wizardMode === 'add' ? 'Create Call Group' : 'Save Changes'}</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-3 ${
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`} style={{ animation: 'wizardFadeIn 0.2s ease-out' }}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <style>{`
        @keyframes wizardFadeIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
        select option { background: #1e293b; color: white; }
      `}</style>
    </div>
  );
}

export default QueuesPage;
