import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRingGroups, getExtensions, createRingGroup, updateRingGroup, deleteRingGroup,
  extractError,
} from '../api';
import type { RingGroup, Extension } from '../types';
import {
  Users2, Plus, Trash2, Edit2, Loader2, AlertCircle, CheckCircle,
  XCircle, X, Search, UserPlus, Phone, Clock, Shuffle, ArrowRight,
  Zap, Hash,
} from 'lucide-react';

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

const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all';
const selectCls = inputCls + ' appearance-none';
const primaryBtn = 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all';

const STRATEGIES = [
  { value: 'simultaneous', label: 'Simultaneous', desc: 'Ring all at once', icon: Zap },
  { value: 'sequential', label: 'Sequential', desc: 'Ring one at a time', icon: ArrowRight },
  { value: 'random', label: 'Random', desc: 'Random member order', icon: Shuffle },
] as const;

const NO_ANSWER_TYPES = ['Hangup', 'Voicemail', 'Extension', 'Queue'] as const;

interface RgForm {
  name: string;
  extension: string;
  cidPrefix: string;
  strategy: string;
  timeout: number;
  members: string[];
  noAnswerDestType: string;
  noAnswerDest: string;
}

const defaultForm = (): RgForm => ({
  name: '',
  extension: '',
  cidPrefix: '',
  strategy: 'simultaneous',
  timeout: 30,
  members: [],
  noAnswerDestType: 'Hangup',
  noAnswerDest: '',
});

function formFromGroup(g: RingGroup): RgForm {
  return {
    name: g.name,
    extension: g.extension || '',
    cidPrefix: g.cidPrefix || '',
    strategy: g.strategy || 'simultaneous',
    timeout: g.timeout ?? 30,
    members: (g.members || []).map((m) => m.extension),
    noAnswerDestType: g.noAnswerDestType || 'Hangup',
    noAnswerDest: g.noAnswerDest || '',
  };
}

function strategyLabel(s?: string): string {
  return STRATEGIES.find((st) => st.value === s)?.label || s || 'Simultaneous';
}

export function RingGroupsPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [editing, setEditing] = useState<RingGroup | 'new' | null>(null);
  const [form, setForm] = useState<RgForm>(defaultForm());
  const [search, setSearch] = useState('');
  const [memberDrop, setMemberDrop] = useState('');

  const { data: groups = [], isLoading, isError } = useQuery<RingGroup[]>({
    queryKey: ['ring-groups-v2'],
    queryFn: getRingGroups,
    staleTime: 30_000,
  });

  const { data: extensions = [] } = useQuery<Extension[]>({
    queryKey: ['extensions-v2'],
    queryFn: getExtensions,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.extension?.includes(q));
  }, [groups, search]);

  const availableExtensions = useMemo(() => {
    return extensions.filter((e) => !form.members.includes(e.extension));
  }, [extensions, form.members]);

  const createMut = useMutation({
    mutationFn: (data: Partial<RingGroup>) => createRingGroup(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ring-groups-v2'] }); toast('success', 'Ring group created'); closeEditor(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<RingGroup> }) => updateRingGroup(name, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ring-groups-v2'] }); toast('success', 'Ring group updated'); closeEditor(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRingGroup,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ring-groups-v2'] }); toast('success', 'Ring group deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  function openAdd() {
    setForm(defaultForm());
    setEditing('new');
    setMemberDrop('');
  }
  function openEdit(g: RingGroup) {
    setForm(formFromGroup(g));
    setEditing(g);
    setMemberDrop('');
  }
  function closeEditor() { setEditing(null); }

  function addMember() {
    if (!memberDrop) return;
    setForm((p) => ({ ...p, members: [...p.members, memberDrop] }));
    setMemberDrop('');
  }

  function removeMember(ext: string) {
    setForm((p) => ({ ...p, members: p.members.filter((m) => m !== ext) }));
  }

  function handleSave() {
    if (!form.name.trim()) { toast('error', 'Name is required'); return; }
    const payload: Partial<RingGroup> = {
      name: form.name,
      extension: form.extension || undefined,
      cidPrefix: form.cidPrefix || undefined,
      strategy: form.strategy,
      timeout: form.timeout,
      members: form.members.map((ext) => ({ extension: ext })),
      noAnswerDestType: form.noAnswerDestType !== 'Hangup' ? form.noAnswerDestType : undefined,
      noAnswerDest: form.noAnswerDest || undefined,
    };
    if (editing === 'new') {
      createMut.mutate(payload);
    } else if (editing) {
      updateMut.mutate({ name: (editing as RingGroup).name, data: payload });
    }
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Ring Groups</h1>
          <p className="text-slate-400 mt-1 font-medium">Ring multiple extensions simultaneously or sequentially</p>
        </div>
        <button onClick={openAdd} className={'flex items-center gap-2 ' + primaryBtn}>
          <Plus className="w-4 h-4" /> Add Ring Group
        </button>
      </div>

      {/* Search */}
      {!isLoading && !isError && groups.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name or extension…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls + ' pl-10'}
            title="Filter ring groups by name or extension number"
          />
        </div>
      )}

      {/* Loading / Error / Empty */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading ring groups…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load ring groups</p>
        </div>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Users2 className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">{search ? 'No Matching Groups' : 'No Ring Groups'}</h3>
          <p className="text-slate-400 text-sm mb-4">{search ? 'Try a different search term' : 'Create a ring group to ring multiple extensions at once'}</p>
          {!search && (
            <button onClick={openAdd} className={primaryBtn + ' inline-flex items-center gap-2'}>
              <Plus className="w-4 h-4" /> Add First Ring Group
            </button>
          )}
        </div>
      )}

      {/* Card Grid */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((g) => (
            <div key={g.id || g.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex flex-col gap-3 group">
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
                  <Users2 className="w-5 h-5 text-orange-400" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(g)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors" title="Edit ring group">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (window.confirm(`Delete ring group "${g.name}"?`)) deleteMut.mutate(g.name); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete ring group"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{g.name}</h3>
                {g.extension && <p className="text-xs text-slate-500 font-mono mt-0.5">Ext: {g.extension}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/40 font-medium">
                  {strategyLabel(g.strategy)}
                </span>
                <span className="text-slate-500 flex items-center gap-1">
                  <Users2 className="w-3 h-3" /> {g.members?.length ?? 0} members
                </span>
                {g.timeout && (
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {g.timeout}s
                  </span>
                )}
              </div>
              <div className="pt-3 border-t border-slate-700/40">
                <button onClick={() => openEdit(g)} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                  Configure →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slide-over Editor */}
      {editing !== null && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={closeEditor} />
          <div className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-slate-800 border-l border-slate-700/50 z-50 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl border-b border-slate-700/50 p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-white">{editing === 'new' ? 'New Ring Group' : `Edit: ${(editing as RingGroup).name}`}</h2>
              <button onClick={closeEditor} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors" title="Close editor">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Basic Info</h3>
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. Sales Team"
                    title="Descriptive name for this ring group"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">Extension</label>
                  <input
                    value={form.extension}
                    onChange={(e) => setForm((p) => ({ ...p, extension: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. 6001"
                    title="Dial-in extension number to reach this ring group"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">CID Prefix (optional)</label>
                  <input
                    value={form.cidPrefix}
                    onChange={(e) => setForm((p) => ({ ...p, cidPrefix: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. SALES:"
                    title="Prefix added to the Caller ID name so agents know which group the call came through"
                  />
                </div>
              </div>

              {/* Strategy */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Ring Strategy</h3>
                <div className="grid grid-cols-3 gap-2">
                  {STRATEGIES.map((s) => {
                    const Icon = s.icon;
                    const active = form.strategy === s.value;
                    return (
                      <button
                        key={s.value}
                        onClick={() => setForm((p) => ({ ...p, strategy: s.value }))}
                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center ${
                          active
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                            : 'bg-slate-900/40 border-slate-700/40 text-slate-400 hover:border-slate-600'
                        }`}
                        title={s.desc}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs font-semibold">{s.label}</span>
                        <span className="text-[10px] text-slate-500 leading-tight">{s.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Ring Time */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Ring Time</h3>
                <div className="p-4 bg-slate-900/40 rounded-xl border border-slate-700/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-400">Duration</span>
                    <span className="text-sm text-white font-bold">{form.timeout}s</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={120}
                    value={form.timeout}
                    onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) }))}
                    className="w-full accent-indigo-500"
                    title="Number of seconds each member's phone will ring before moving on or giving up"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600 mt-1">
                    <span>10s</span>
                    <span>120s</span>
                  </div>
                </div>
              </div>

              {/* Members */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Members</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={memberDrop}
                    onChange={(e) => setMemberDrop(e.target.value)}
                    className={selectCls + ' flex-1'}
                    title="Select an extension to add to this ring group"
                  >
                    <option value="">— Select extension —</option>
                    {availableExtensions.map((e) => (
                      <option key={e.extension} value={e.extension}>
                        {e.extension} {e.callerIdName ? `– ${e.callerIdName}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={addMember}
                    disabled={!memberDrop}
                    className={primaryBtn + ' flex items-center gap-1 flex-shrink-0'}
                    title="Add the selected extension to the ring group"
                  >
                    <UserPlus className="w-4 h-4" /> Add
                  </button>
                </div>
                {form.members.length === 0 && (
                  <p className="text-xs text-slate-600 text-center py-4">No members yet. Select extensions above to add.</p>
                )}
                {form.members.length > 0 && (
                  <div className="space-y-1.5">
                    {form.members.map((ext) => {
                      const info = extensions.find((e) => e.extension === ext);
                      return (
                        <div key={ext} className="flex items-center justify-between p-2.5 bg-slate-900/40 rounded-xl border border-slate-700/40">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                              <Phone className="w-4 h-4 text-indigo-400" />
                            </div>
                            <div>
                              <span className="text-sm text-white font-mono font-semibold">{ext}</span>
                              {info?.callerIdName && <span className="text-xs text-slate-500 ml-2">{info.callerIdName}</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => removeMember(ext)}
                            className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title={`Remove extension ${ext} from ring group`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* No Answer */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">No Answer Destination</h3>
                <div className="p-4 bg-slate-900/40 rounded-xl border border-slate-700/40 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 font-semibold mb-1.5">Destination Type</label>
                    <select
                      value={form.noAnswerDestType}
                      onChange={(e) => setForm((p) => ({ ...p, noAnswerDestType: e.target.value }))}
                      className={selectCls}
                      title="Where to route the call if no member answers within the ring time"
                    >
                      {NO_ANSWER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {form.noAnswerDestType !== 'Hangup' && (
                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1.5">Target</label>
                      <input
                        value={form.noAnswerDest}
                        onChange={(e) => setForm((p) => ({ ...p, noAnswerDest: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. 1001"
                        title="Extension, voicemail, or queue to forward unanswered calls to"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-slate-800/95 backdrop-blur-xl border-t border-slate-700/50 p-4 flex items-center gap-3">
              <button onClick={handleSave} disabled={saving} className={primaryBtn + ' flex items-center gap-2 flex-1 justify-center'}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing === 'new' ? 'Create Group' : 'Save Changes'}
              </button>
              <button onClick={closeEditor} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-[60] space-y-3 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${
            t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {t.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span className="text-sm font-medium">{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
