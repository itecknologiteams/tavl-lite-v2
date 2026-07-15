import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTimeConditions, createTimeCondition, updateTimeCondition, deleteTimeCondition,
  getExtensions, getQueues, getIvr, extractError,
} from '../api';
import type { TimeCondition, TimeRange } from '../types';
import {
  Clock, Plus, Trash2, Edit2, Loader2, AlertCircle, CheckCircle, XCircle, X,
  Info, ToggleLeft, ToggleRight, CalendarDays, Timer, Calendar, ChevronDown,
} from 'lucide-react';

// ─── Toast ────────────────────────────────────────────────────────────────────

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

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-3 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {t.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          <span className="text-sm font-medium">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DEST_TYPES = ['Extension', 'Queue', 'IVR', 'Voicemail'] as const;

const emptyRange = (): TimeRange => ({ type: 'weekday', days: [] });

interface FormState {
  name: string;
  extension: string;
  description: string;
  enabled: boolean;
  conditions: TimeRange[];
  matchType: string;
  matchTarget: string;
  mismatchType: string;
  mismatchTarget: string;
}

const defaultForm = (): FormState => ({
  name: '',
  extension: '',
  description: '',
  enabled: true,
  conditions: [],
  matchType: 'Extension',
  matchTarget: '',
  mismatchType: 'Extension',
  mismatchTarget: '',
});

function parseDestination(dest?: string): { type: string; target: string } {
  if (!dest) return { type: 'Extension', target: '' };
  for (const t of DEST_TYPES) {
    if (dest.toLowerCase().startsWith(t.toLowerCase() + ':')) {
      return { type: t, target: dest.slice(t.length + 1) };
    }
  }
  return { type: 'Extension', target: dest };
}

function formatDestination(type: string, target: string): string {
  if (!target) return '';
  return `${type}:${target}`;
}

function rangePreview(r: TimeRange): string {
  if (r.type === 'weekday') return (r.days || []).join(', ') || 'No days';
  if (r.type === 'time') return `${r.startTime || '??'}–${r.endTime || '??'}`;
  return `${r.startDate || '??'} to ${r.endDate || '??'}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TimeConditionsPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [editingName, setEditingName] = useState<string | null>(null);

  const { data: conditions = [], isLoading, isError } = useQuery<TimeCondition[]>({
    queryKey: ['time-conditions-v2'],
    queryFn: getTimeConditions,
    staleTime: 30_000,
  });

  const { data: extensions = [] } = useQuery({ queryKey: ['extensions-v2'], queryFn: getExtensions, staleTime: 60_000 });
  const { data: queues = [] } = useQuery({ queryKey: ['queues-v2'], queryFn: getQueues, staleTime: 60_000 });
  const { data: ivrData } = useQuery({ queryKey: ['ivr-v2'], queryFn: getIvr, staleTime: 60_000 });
  const ivrs = ivrData?.ivrs || [];

  const createMut = useMutation({
    mutationFn: (data: Partial<TimeCondition>) => createTimeCondition(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['time-conditions-v2'] }); toast('success', 'Schedule created'); closeModal(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<TimeCondition> }) => updateTimeCondition(name, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['time-conditions-v2'] }); toast('success', 'Schedule updated'); closeModal(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteTimeCondition,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['time-conditions-v2'] }); toast('success', 'Schedule deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => updateTimeCondition(name, { enabled }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['time-conditions-v2'] }); toast('success', 'Status updated'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const closeModal = useCallback(() => { setModal(null); setEditingName(null); setForm(defaultForm()); }, []);

  const openAdd = () => { setForm(defaultForm()); setModal('add'); };

  const openEdit = (c: TimeCondition) => {
    const match = parseDestination(c.destinationMatch);
    const mismatch = parseDestination(c.destinationMismatch);
    setForm({
      name: c.name,
      extension: c.extension || '',
      description: c.description || '',
      enabled: c.enabled !== false,
      conditions: c.conditions?.length ? c.conditions.map((r) => ({ ...r })) : [],
      matchType: match.type,
      matchTarget: match.target,
      mismatchType: mismatch.type,
      mismatchTarget: mismatch.target,
    });
    setEditingName(c.name);
    setModal('edit');
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast('error', 'Name is required'); return; }
    const payload: Partial<TimeCondition> = {
      name: form.name.trim(),
      extension: form.extension.trim() || undefined,
      description: form.description.trim() || undefined,
      enabled: form.enabled,
      conditions: form.conditions,
      destinationMatch: formatDestination(form.matchType, form.matchTarget) || undefined,
      destinationMismatch: formatDestination(form.mismatchType, form.mismatchTarget) || undefined,
    };
    if (modal === 'edit' && editingName) {
      updateMut.mutate({ name: editingName, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const saving = createMut.isPending || updateMut.isPending;

  const updateRange = (idx: number, patch: Partial<TimeRange>) => {
    setForm((f) => {
      const c = [...f.conditions];
      c[idx] = { ...c[idx], ...patch };
      return { ...f, conditions: c };
    });
  };

  const removeRange = (idx: number) => {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, i) => i !== idx) }));
  };

  const addRange = () => {
    setForm((f) => ({ ...f, conditions: [...f.conditions, emptyRange()] }));
  };

  const targetOptions = (type: string): { label: string; value: string }[] => {
    if (type === 'Extension') return extensions.map((e) => ({ label: `${e.extension} – ${e.callerIdName || e.extension}`, value: e.extension }));
    if (type === 'Queue') return queues.map((q) => ({ label: q.name, value: q.extension || q.name }));
    if (type === 'IVR') return ivrs.map((i) => ({ label: i.name, value: i.name }));
    return extensions.map((e) => ({ label: `${e.extension} VM`, value: e.extension }));
  };

  const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all';
  const btnPrimary = 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Time Conditions</h1>
          <p className="text-slate-400 mt-1 font-medium">Route calls differently based on time of day, day of week, or date ranges</p>
        </div>
        <button onClick={openAdd} className={`flex items-center gap-2 ${btnPrimary}`}>
          <Plus className="w-4 h-4" /> Add Schedule
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-slate-300">
          <span className="font-semibold text-white">How it works:</span> Time conditions check the current time against your configured schedules. When a match is found, calls route to the "Match" destination (e.g. your queue during business hours). Otherwise, calls go to the "No Match" destination (e.g. voicemail after hours).
        </div>
      </div>

      {/* Loading / Error / Empty */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading schedules…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load time conditions</p>
        </div>
      )}
      {!isLoading && !isError && conditions.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Clock className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No Schedules Yet</h3>
          <p className="text-slate-400 text-sm mb-4">Create a schedule to route calls based on business hours</p>
          <button onClick={openAdd} className={`inline-flex items-center gap-2 ${btnPrimary}`}>
            <Plus className="w-4 h-4" /> Add First Schedule
          </button>
        </div>
      )}

      {/* Schedule cards */}
      {!isLoading && !isError && conditions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {conditions.map((c) => (
            <div key={c.id || c.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6 group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                    <Clock className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{c.name}</h3>
                    {c.extension && <p className="text-xs text-slate-500 font-mono">ext {c.extension}</p>}
                  </div>
                </div>
                <button
                  title={c.enabled !== false ? 'Click to disable' : 'Click to enable'}
                  onClick={() => toggleMut.mutate({ name: c.name, enabled: c.enabled === false })}
                  className="flex-shrink-0"
                >
                  {c.enabled !== false
                    ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                    : <ToggleLeft className="w-8 h-8 text-slate-500" />
                  }
                </button>
              </div>

              {c.description && <p className="text-sm text-slate-400 mb-3">{c.description}</p>}

              {(c.conditions?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {c.conditions!.map((r, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-300">
                      {r.type === 'weekday' && <CalendarDays className="w-3 h-3 inline mr-1" />}
                      {r.type === 'time' && <Timer className="w-3 h-3 inline mr-1" />}
                      {r.type === 'date' && <Calendar className="w-3 h-3 inline mr-1" />}
                      {rangePreview(r)}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-700/30">
                  <span className="text-emerald-400 font-semibold">Match →</span>{' '}
                  <span className="text-slate-300">{c.destinationMatch || 'Not set'}</span>
                </div>
                <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-700/30">
                  <span className="text-amber-400 font-semibold">No Match →</span>{' '}
                  <span className="text-slate-300">{c.destinationMismatch || 'Not set'}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1 pt-3 border-t border-slate-700/40">
                <button onClick={() => openEdit(c)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 text-xs transition-colors">
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={() => { if (window.confirm(`Delete schedule "${c.name}"?`)) deleteMut.mutate(c.name); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-xs transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Add / Edit Modal ────────────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-700/50">
              <h2 className="text-lg font-bold text-white">{modal === 'edit' ? 'Edit Schedule' : 'New Schedule'}</h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Name *</label>
                <input title="A unique name for this schedule" className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Business Hours" />
              </div>
              {/* Extension */}
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Extension</label>
                <input title="Optional dial extension to reach this time condition" className={inputCls} value={form.extension} onChange={(e) => setForm((f) => ({ ...f, extension: e.target.value }))} placeholder="e.g. 8001" />
              </div>
              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Description</label>
                <textarea title="Describe when this schedule is active" className={`${inputCls} min-h-[72px] resize-y`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description…" />
              </div>

              {/* Schedule Builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-300">Time Ranges</label>
                  <button onClick={addRange} className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Add Range
                  </button>
                </div>
                {form.conditions.length === 0 && (
                  <p className="text-xs text-slate-500 italic">No ranges added. Click "Add Range" to define when this schedule is active.</p>
                )}
                <div className="space-y-3">
                  {form.conditions.map((r, i) => (
                    <div key={i} className="bg-slate-900/50 border border-slate-700/40 rounded-xl p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <select
                          title="Select range type"
                          className="bg-slate-800 border border-slate-700 rounded-lg py-1.5 px-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                          value={r.type}
                          onChange={(e) => updateRange(i, { type: e.target.value as TimeRange['type'], days: [], startTime: '', endTime: '', startDate: '', endDate: '' })}
                        >
                          <option value="weekday">Weekdays</option>
                          <option value="time">Time</option>
                          <option value="date">Date</option>
                        </select>
                        <button onClick={() => removeRange(i)} className="p-1 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors" title="Remove this range">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {r.type === 'weekday' && (
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS.map((d) => {
                            const active = (r.days || []).includes(d);
                            return (
                              <button
                                key={d}
                                type="button"
                                title={`Toggle ${d}`}
                                onClick={() => {
                                  const days = active ? (r.days || []).filter((x) => x !== d) : [...(r.days || []), d];
                                  updateRange(i, { days });
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                                  active ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                                }`}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {r.type === 'time' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Start</label>
                            <input title="Start time (HH:MM)" type="time" className={inputCls} value={r.startTime || ''} onChange={(e) => updateRange(i, { startTime: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">End</label>
                            <input title="End time (HH:MM)" type="time" className={inputCls} value={r.endTime || ''} onChange={(e) => updateRange(i, { endTime: e.target.value })} />
                          </div>
                        </div>
                      )}

                      {r.type === 'date' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Start Date</label>
                            <input title="Start date" type="date" className={inputCls} value={r.startDate || ''} onChange={(e) => updateRange(i, { startDate: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">End Date</label>
                            <input title="End date" type="date" className={inputCls} value={r.endDate || ''} onChange={(e) => updateRange(i, { endDate: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Destinations */}
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-emerald-400 mb-1.5">When Match (Business Hours)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select title="Match destination type" className={inputCls} value={form.matchType} onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value, matchTarget: '' }))}>
                      {DEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select title="Match destination target" className={inputCls} value={form.matchTarget} onChange={(e) => setForm((f) => ({ ...f, matchTarget: e.target.value }))}>
                      <option value="">— Select —</option>
                      {targetOptions(form.matchType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-amber-400 mb-1.5">When No Match (After Hours)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select title="No-match destination type" className={inputCls} value={form.mismatchType} onChange={(e) => setForm((f) => ({ ...f, mismatchType: e.target.value, mismatchTarget: '' }))}>
                      {DEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select title="No-match destination target" className={inputCls} value={form.mismatchTarget} onChange={(e) => setForm((f) => ({ ...f, mismatchTarget: e.target.value }))}>
                      <option value="">— Select —</option>
                      {targetOptions(form.mismatchType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Enabled */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">Enabled</span>
                <button title="Toggle enabled" onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))} className="flex-shrink-0">
                  {form.enabled ? <ToggleRight className="w-8 h-8 text-emerald-400" /> : <ToggleLeft className="w-8 h-8 text-slate-500" />}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t border-slate-700/50">
              <button onClick={closeModal} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className={`${btnPrimary} disabled:opacity-50 flex items-center gap-2`}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {modal === 'edit' ? 'Save Changes' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
