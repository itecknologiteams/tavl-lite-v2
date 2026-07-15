import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getQueues, getExtensions, getMoh, getRecordings,
  createQueue, updateQueue, deleteQueue, extractError,
} from '../api';
import type { Queue, QueueMember, Recording, Toast } from '../types';
import { AudioPicker } from '../components/AudioPicker';
import { useAdminAuthStore } from '@features/pbx-admin';
import {
  Plus, Edit2, Trash2, Users, PhoneCall, PhoneIncoming,
  Loader2, X, ChevronRight, ChevronLeft, CheckCircle2,
  AlertCircle, Info, Volume2, Clock, ToggleLeft, ToggleRight,
  ListOrdered,
} from 'lucide-react';

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-2xl backdrop-blur-xl animate-fade-in
            ${t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-300' :
              t.type === 'error' ? 'bg-red-950/90 border-red-500/30 text-red-300' :
              'bg-slate-800/90 border-slate-600/30 text-slate-200'}`}
        >
          {t.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {t.message}
          <button onClick={() => onRemove(t.id)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = (type: Toast['type'], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  };
  const remove = (id: string) => setToasts(p => p.filter(t => t.id !== id));
  return { toasts, add, remove };
}

// ─── Strategy config ──────────────────────────────────────────────────────────

const STRATEGIES = [
  { value: 'longest-idle-agent', label: 'Longest Idle Agent', desc: 'Routes to the agent who has been idle longest (recommended)', color: 'indigo' },
  { value: 'round-robin', label: 'Round Robin', desc: 'Distributes calls evenly across all agents', color: 'purple' },
  { value: 'top-down', label: 'Top Down', desc: 'Always tries agents in the same fixed order', color: 'sky' },
  { value: 'agent-with-least-talk-time', label: 'Least Talk Time', desc: 'Routes to agent with least total call time', color: 'teal' },
  { value: 'agent-with-fewest-calls', label: 'Fewest Calls', desc: 'Routes to agent who has taken fewest calls', color: 'amber' },
  { value: 'sequentially-by-agent-order', label: 'Sequential', desc: 'Routes to agents in sequence by defined order', color: 'rose' },
];

const strategyColor = (s: string) => {
  const found = STRATEGIES.find(x => x.value === s);
  const c = found?.color || 'slate';
  const map: Record<string, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    teal: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  };
  return map[c];
};

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step, total, labels }: { step: number; total: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
              ${i + 1 < step ? 'bg-indigo-500 border-indigo-500 text-white' :
                i + 1 === step ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' :
                'bg-slate-800 border-slate-600 text-slate-500'}`}
            >
              {i + 1 < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`mt-1.5 text-xs font-medium whitespace-nowrap ${i + 1 === step ? 'text-indigo-400' : 'text-slate-500'}`}>
              {label}
            </span>
          </div>
          {i < total - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-5 rounded ${i + 1 < step ? 'bg-indigo-500' : 'bg-slate-700'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(): Partial<Queue> {
  return {
    name: '',
    extension: '',
    strategy: 'longest-idle-agent',
    mohSound: 'default',
    announceSound: '',
    announceFrequency: 30,
    maxWaitTime: 300,
    announcePosition: true,
    leaveWhenEmpty: 'hangup',
    members: [],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function QueuesPageV2() {
  const qc = useQueryClient();
  const { toasts, add: toast, remove: removeToast } = useToasts();

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Queue | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Partial<Queue>>(blankForm());

  const token = useAdminAuthStore((s) => s.token);
  const { data: queues = [], isLoading } = useQuery({ queryKey: ['queues-v2'], queryFn: getQueues });
  const { data: extensions = [] } = useQuery({ queryKey: ['extensions-v2'], queryFn: getExtensions });
  const { data: mohClasses = [] } = useQuery({ queryKey: ['moh-v2'], queryFn: getMoh });
  const { data: recordings = [] } = useQuery<Recording[]>({ queryKey: ['recordings-v2'], queryFn: getRecordings });
  const refreshRecordings = () => qc.invalidateQueries({ queryKey: ['recordings-v2'] });

  const createMut = useMutation({
    mutationFn: createQueue,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queues-v2'] }); closeModal(); toast('success', 'Queue created successfully'); },
    onError: (e) => toast('error', extractError(e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<Queue> }) => updateQueue(name, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queues-v2'] }); closeModal(); toast('success', 'Queue updated successfully'); },
    onError: (e) => toast('error', extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteQueue,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queues-v2'] }); toast('success', 'Queue deleted'); },
    onError: (e) => toast('error', extractError(e)),
  });

  function openNew() {
    setEditTarget(null);
    setForm(blankForm());
    setStep(1);
    setShowModal(true);
  }

  function openEdit(q: Queue) {
    setEditTarget(q);
    setForm({ ...q });
    setStep(1);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditTarget(null);
    setForm(blankForm());
    setStep(1);
  }

  function handleDelete(q: Queue) {
    if (!window.confirm(`Delete queue "${q.name}"? This cannot be undone.`)) return;
    deleteMut.mutate(q.name);
  }

  function handleSave() {
    if (editTarget) {
      updateMut.mutate({ name: editTarget.name, data: form });
    } else {
      createMut.mutate(form);
    }
  }

  const totalAgents = queues.reduce((acc, q) => acc + (q.agents ?? q.members?.length ?? 0), 0);
  const totalWaiting = queues.reduce((acc, q) => acc + (q.waiting ?? 0), 0);
  const isPending = createMut.isPending || updateMut.isPending;

  const addMember = (ext: string) => {
    if (!form.members?.find(m => m.extension === ext)) {
      setForm(f => ({ ...f, members: [...(f.members || []), { extension: ext }] }));
    }
  };

  const removeMember = (ext: string) => {
    setForm(f => ({ ...f, members: (f.members || []).filter(m => m.extension !== ext) }));
  };

  const availableToAdd = extensions.filter(e => !form.members?.find(m => m.extension === e.extension));

  return (
    <div className="space-y-8 animate-fade-in relative z-10">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Call Queues</h1>
          <p className="text-slate-400 mt-1 font-medium">Manage inbound call queues and agent assignments</p>
        </div>
        <button onClick={openNew} className="glass-button flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-semibold tracking-wide">
          <Plus className="w-4 h-4" /> Add Queue
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Queues', value: queues.length, icon: ListOrdered, color: 'indigo' },
          { label: 'Total Agents', value: totalAgents, icon: Users, color: 'purple' },
          { label: 'Waiting Calls', value: totalWaiting, icon: PhoneIncoming, color: totalWaiting > 0 ? 'amber' : 'teal' },
        ].map(s => (
          <div key={s.label} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex items-center gap-4">
            <div className={`p-3 rounded-xl bg-${s.color}-500/10 border border-${s.color}-500/20`}>
              <s.icon className={`w-5 h-5 text-${s.color}-400`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Queue cards grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-4" />
          <p className="text-slate-400">Loading queues...</p>
        </div>
      ) : queues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800/60 flex items-center justify-center mb-4">
            <PhoneCall className="w-8 h-8 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">No Call Queues</h3>
          <p className="text-slate-400 mb-4">Create your first queue to start routing inbound calls to agents.</p>
          <button onClick={openNew} className="glass-button flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-semibold">
            <Plus className="w-4 h-4" /> Add Queue
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {queues.map(q => (
            <div key={q.id ?? q.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6 group hover:border-slate-600/70 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-bold text-base truncate">{q.name}</h3>
                  {q.extension && <p className="text-slate-400 text-xs mt-0.5">Ext {q.extension}</p>}
                </div>
                <span className={`ml-2 shrink-0 text-xs font-semibold px-2 py-1 rounded-full border ${strategyColor(q.strategy)}`}>
                  {STRATEGIES.find(s => s.value === q.strategy)?.label ?? q.strategy}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-4 text-sm">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-medium text-slate-300">{q.agents ?? q.members?.length ?? 0}</span>
                  <span>agents</span>
                </div>
                <div className={`flex items-center gap-1.5 ${(q.waiting ?? 0) > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                  <PhoneIncoming className="w-3.5 h-3.5" />
                  <span className="font-medium">{q.waiting ?? 0}</span>
                  <span>waiting</span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEdit(q)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-all"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={() => handleDelete(q)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-400 bg-slate-700/50 hover:bg-red-500/10 rounded-lg transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3-step wizard modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative z-10 w-full max-w-2xl bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl animate-fade-in">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700/50">
              <h2 className="text-lg font-bold text-white">
                {editTarget ? `Edit Queue: ${editTarget.name}` : 'New Call Queue'}
              </h2>
              <button onClick={closeModal} className="lg-icon-btn p-2 text-slate-400 hover:text-white rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <StepIndicator step={step} total={3} labels={['Basics', 'Members', 'Caller Experience']} />

              {/* Step 1: Basics */}
              {step === 1 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                        Queue Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. sales or support"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                        value={form.name ?? ''}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        disabled={!!editTarget}
                      />
                      <p className="text-xs text-slate-500 mt-1">Unique name for this call queue, e.g. 'sales' or 'support'</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Extension</label>
                      <input
                        type="text"
                        placeholder="e.g. 500"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                        value={form.extension ?? ''}
                        onChange={e => setForm(f => ({ ...f, extension: e.target.value }))}
                      />
                      <p className="text-xs text-slate-500 mt-1">The extension number callers dial to reach this queue</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                      Routing Strategy
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {STRATEGIES.map(s => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, strategy: s.value }))}
                          className={`text-left p-3 rounded-xl border transition-all ${form.strategy === s.value
                            ? 'bg-indigo-500/15 border-indigo-500/50 ring-1 ring-indigo-500/40'
                            : 'bg-slate-800/60 border-slate-700/50 hover:border-slate-600'}`}
                        >
                          <p className={`text-xs font-bold mb-0.5 ${form.strategy === s.value ? 'text-indigo-400' : 'text-slate-300'}`}>
                            {s.label}
                          </p>
                          <p className="text-xs text-slate-500 leading-tight">{s.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Members */}
              {step === 2 && (
                <div className="space-y-4 animate-fade-in">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Add Member</label>
                    <select
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      value=""
                      onChange={e => { if (e.target.value) addMember(e.target.value); }}
                    >
                      <option value="">Select extension to add...</option>
                      {availableToAdd.map(e => (
                        <option key={e.id} value={e.extension}>
                          {e.extension} — {e.callerIdName || e.extension} {e.status === 'online' ? '● online' : '○ offline'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(form.members?.length ?? 0) === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-800/30 rounded-xl border border-dashed border-slate-700">
                      <Users className="w-8 h-8 text-slate-600 mb-2" />
                      <p className="text-slate-400 text-sm font-medium">No members added</p>
                      <p className="text-slate-500 text-xs mt-1">Use the dropdown above to add agents to this queue</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto hide-scrollbar">
                      {form.members?.map(m => {
                        const ext = extensions.find(e => e.extension === m.extension);
                        return (
                          <div key={m.extension} className="flex items-center justify-between px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-700/40">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${ext?.status === 'online' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                              <span className="text-white text-sm font-semibold">{m.extension}</span>
                              {ext?.callerIdName && <span className="text-slate-400 text-xs">{ext.callerIdName}</span>}
                            </div>
                            <button
                              onClick={() => removeMember(m.extension)}
                              className="text-slate-500 hover:text-red-400 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                    <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                    <p className="text-xs text-indigo-300">Added members are automatically configured as call center agents</p>
                  </div>
                </div>
              )}

              {/* Step 3: Caller Experience */}
              {step === 3 && (
                <div className="space-y-5 animate-fade-in">
                  {/* Music on Hold */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5" /> Music on Hold
                    </label>
                    <select
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      value={form.mohSound ?? 'default'}
                      onChange={e => setForm(f => ({ ...f, mohSound: e.target.value }))}
                    >
                      <option value="default">Default</option>
                      <option value="local_stream://moh">Built-in MOH Stream</option>
                      <option value="silence_stream://2000">Silence</option>
                      {mohClasses.map(m => (
                        <option key={m.name} value={`local_stream://${m.name}`}>{m.name} (MOH Class)</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">Music or audio loop played while callers wait in the queue</p>
                  </div>

                  {/* Queue Greeting / Announce Sound */}
                  <AudioPicker
                    label="Queue Announcement"
                    tip="Audio played periodically to callers waiting in queue (e.g. 'Your call is important to us')"
                    value={form.announceSound ?? ''}
                    onChange={v => setForm(f => ({ ...f, announceSound: v }))}
                    recordings={recordings}
                    token={token || ''}
                    onUploadComplete={refreshRecordings}
                    placeholder="No announcement"
                  />

                  {/* Announce Frequency */}
                  {(form.announceSound ?? '') !== '' && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" /> Announcement Interval
                        </label>
                        <span className="text-indigo-400 font-bold text-sm">{form.announceFrequency ?? 30}s</span>
                      </div>
                      <input
                        type="range"
                        min={10} max={120} step={5}
                        value={form.announceFrequency ?? 30}
                        onChange={e => setForm(f => ({ ...f, announceFrequency: Number(e.target.value) }))}
                        className="w-full accent-indigo-500"
                      />
                      <div className="flex justify-between text-xs text-slate-600 mt-1">
                        <span>10s</span><span>30s</span><span>60s</span><span>120s</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">How often the announcement is played to waiting callers</p>
                    </div>
                  )}

                  {/* Max Wait Time */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Max Wait Time
                      </label>
                      <span className="text-indigo-400 font-bold text-sm">{form.maxWaitTime ?? 300}s</span>
                    </div>
                    <input
                      type="range"
                      min={30} max={600} step={30}
                      value={form.maxWaitTime ?? 300}
                      onChange={e => setForm(f => ({ ...f, maxWaitTime: Number(e.target.value) }))}
                      className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-slate-600 mt-1">
                      <span>30s</span><span>5 min</span><span>10 min</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Maximum time a caller will wait before being disconnected or transferred</p>
                  </div>

                  {/* Announce Position toggle */}
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-700/40">
                    <div>
                      <p className="text-sm font-semibold text-white">Announce Position</p>
                      <p className="text-xs text-slate-500 mt-0.5">Tell callers their position in the queue</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, announcePosition: !f.announcePosition }))}
                      className="text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      {form.announcePosition ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-slate-500" />}
                    </button>
                  </div>

                  {/* No-Agent Behavior */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">No-Agent Behavior</label>
                    <select
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      value={form.leaveWhenEmpty ?? 'hangup'}
                      onChange={e => setForm(f => ({ ...f, leaveWhenEmpty: e.target.value }))}
                    >
                      <option value="hangup">Hang up</option>
                      <option value="voicemail">Leave Message (Voicemail)</option>
                      <option value="transfer">Transfer to Extension</option>
                    </select>
                    <p className="text-xs text-slate-500 mt-1">What happens when no agents are available to take calls</p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/50">
              <button
                onClick={step === 1 ? closeModal : () => setStep(s => s - 1)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
              >
                {step > 1 && <ChevronLeft className="w-4 h-4" />}
                {step === 1 ? 'Cancel' : 'Back'}
              </button>
              <div className="flex items-center gap-2">
                {step < 3 ? (
                  <button
                    onClick={() => setStep(s => s + 1)}
                    disabled={step === 1 && !form.name?.trim()}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 disabled:opacity-40 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
                  >
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {editTarget ? 'Save Changes' : 'Create Queue'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
