import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConferences, createConference, deleteConference,
  kickConferenceMember, muteConferenceMember, unmuteConferenceMember,
  extractError,
} from '../api';
import type { Conference, ConferenceMember } from '../types';
import {
  Video, Plus, Trash2, Loader2, AlertCircle, CheckCircle, XCircle,
  Users, Lock, ChevronDown, ChevronUp, MicOff, Mic, UserX, X,
  ToggleLeft, ToggleRight, Radio, Hash,
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
const primaryBtn = 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all';
const dangerBtn = 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-sm';

interface CreateForm {
  name: string;
  extension: string;
  pin: string;
  adminPin: string;
  maxMembers: number;
  record: boolean;
  waitMod: boolean;
}

const defaultCreate = (): CreateForm => ({
  name: '',
  extension: '',
  pin: '',
  adminPin: '',
  maxMembers: 10,
  record: false,
  waitMod: false,
});

export function ConferencesPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(defaultCreate());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: conferences = [], isLoading, isError } = useQuery<Conference[]>({
    queryKey: ['conferences-v2'],
    queryFn: getConferences,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<Conference>) => createConference(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conferences-v2'] });
      toast('success', 'Conference room created');
      setShowCreate(false);
      setCreateForm(defaultCreate());
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteConference,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['conferences-v2'] }); toast('success', 'Conference room deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const kickMut = useMutation({
    mutationFn: ({ name, memberId }: { name: string; memberId: string }) => kickConferenceMember(name, memberId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['conferences-v2'] }); toast('success', 'Member kicked'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const muteMut = useMutation({
    mutationFn: ({ name, memberId }: { name: string; memberId: string }) => muteConferenceMember(name, memberId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['conferences-v2'] }); toast('success', 'Member muted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const unmuteMut = useMutation({
    mutationFn: ({ name, memberId }: { name: string; memberId: string }) => unmuteConferenceMember(name, memberId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['conferences-v2'] }); toast('success', 'Member unmuted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  function handleCreate() {
    if (!createForm.name.trim()) { toast('error', 'Room name is required'); return; }
    createMut.mutate({
      name: createForm.name,
      extension: createForm.extension || undefined,
      pin: createForm.pin || undefined,
      adminPin: createForm.adminPin || undefined,
      maxMembers: createForm.maxMembers,
      record: createForm.record,
      waitMod: createForm.waitMod,
    });
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const activeRooms = conferences.filter((c) => c.members && c.members.length > 0).length;
  const totalParticipants = conferences.reduce((sum, c) => sum + (c.members?.length || 0), 0);
  const availableRooms = conferences.length - activeRooms;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Conferences</h1>
          <p className="text-slate-400 mt-1 font-medium">Multi-party conference bridges</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-semibold">Live – Auto-refresh 10s</span>
          </div>
          <button
            onClick={() => { setShowCreate(!showCreate); if (!showCreate) setCreateForm(defaultCreate()); }}
            className={'flex items-center gap-2 ' + primaryBtn}
          >
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Cancel' : 'Create Room'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20"><Radio className="w-4 h-4 text-emerald-400" /></div>
            <span className="text-sm text-slate-400 font-medium">Active Rooms</span>
          </div>
          <p className="text-2xl font-bold text-white">{activeRooms}</p>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20"><Users className="w-4 h-4 text-blue-400" /></div>
            <span className="text-sm text-slate-400 font-medium">Total Participants</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalParticipants}</p>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-slate-500/10 border border-slate-600/20"><Video className="w-4 h-4 text-slate-400" /></div>
            <span className="text-sm text-slate-400 font-medium">Available Rooms</span>
          </div>
          <p className="text-2xl font-bold text-white">{availableRooms}</p>
        </div>
      </div>

      {/* Inline Create Form */}
      {showCreate && (
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-indigo-500/30 p-6 space-y-4">
          <h3 className="text-white font-bold text-lg">New Conference Room</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">Room Name *</label>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                className={inputCls}
                placeholder="e.g. Team Standup"
                title="A descriptive name for this conference room"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">Extension</label>
              <input
                value={createForm.extension}
                onChange={(e) => setCreateForm((p) => ({ ...p, extension: e.target.value }))}
                className={inputCls}
                placeholder="e.g. 8001"
                title="Dial-in extension number for the conference room"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">User PIN (optional)</label>
              <input
                value={createForm.pin}
                onChange={(e) => setCreateForm((p) => ({ ...p, pin: e.target.value }))}
                className={inputCls}
                placeholder="e.g. 1234"
                title="PIN required for participants to join the conference"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">Admin PIN (optional)</label>
              <input
                value={createForm.adminPin}
                onChange={(e) => setCreateForm((p) => ({ ...p, adminPin: e.target.value }))}
                className={inputCls}
                placeholder="e.g. 9999"
                title="PIN for moderator access with elevated controls"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">Max Members</label>
              <input
                type="number"
                min={2}
                max={100}
                value={createForm.maxMembers}
                onChange={(e) => setCreateForm((p) => ({ ...p, maxMembers: Number(e.target.value) || 10 }))}
                className={inputCls}
                title="Maximum number of participants allowed in this room"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCreateForm((p) => ({ ...p, record: !p.record }))}
                className="text-indigo-400"
                title="Toggle recording of the conference"
              >
                {createForm.record ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7 text-slate-600" />}
              </button>
              <span className="text-sm text-slate-300">Record</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCreateForm((p) => ({ ...p, waitMod: !p.waitMod }))}
                className="text-indigo-400"
                title="Toggle whether participants must wait for a moderator before hearing audio"
              >
                {createForm.waitMod ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7 text-slate-600" />}
              </button>
              <span className="text-sm text-slate-300">Wait for Moderator</span>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button onClick={handleCreate} disabled={createMut.isPending} className={primaryBtn + ' flex items-center gap-2'}>
              {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Room
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading / Error / Empty */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading conferences…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load conferences</p>
        </div>
      )}
      {!isLoading && !isError && conferences.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Video className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No Conference Rooms</h3>
          <p className="text-slate-400 text-sm mb-4">Create a conference bridge for multi-party calls</p>
          <button onClick={() => { setShowCreate(true); setCreateForm(defaultCreate()); }} className={primaryBtn + ' inline-flex items-center gap-2'}>
            <Plus className="w-4 h-4" /> Create First Room
          </button>
        </div>
      )}

      {/* Conference Cards */}
      {!isLoading && !isError && conferences.length > 0 && (
        <div className="space-y-4">
          {conferences.map((conf) => {
            const isExpanded = expanded.has(conf.name);
            const memberCount = conf.members?.length || 0;
            const hasMembers = memberCount > 0;

            return (
              <div key={conf.id || conf.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
                <div className="p-5 flex items-center gap-4">
                  <div className={`p-2.5 rounded-xl border ${hasMembers ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-blue-500/10 border-blue-500/20'}`}>
                    <Video className={`w-5 h-5 ${hasMembers ? 'text-emerald-400' : 'text-blue-400'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white truncate">{conf.name}</h3>
                      {hasMembers && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex-shrink-0">
                          {memberCount} active
                        </span>
                      )}
                      {conf.record && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-semibold flex-shrink-0">
                          REC
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                      {conf.extension && <span className="font-mono">Ext: {conf.extension}</span>}
                      <span>Max {conf.maxMembers ?? '∞'}</span>
                      {conf.pin && <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> PIN</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasMembers && (
                      <button
                        onClick={() => toggleExpand(conf.name)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                        title={isExpanded ? 'Collapse member list' : 'Expand member list'}
                      >
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </button>
                    )}
                    <button
                      onClick={() => { if (window.confirm(`Delete conference room "${conf.name}"?`)) deleteMut.mutate(conf.name); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete conference room"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Members */}
                {isExpanded && hasMembers && (
                  <div className="border-t border-slate-700/40">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-900/40">
                          <th className="px-5 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-widest">Name / Number</th>
                          <th className="px-5 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-widest">Status</th>
                          <th className="px-5 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {conf.members!.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-700/10 transition-colors">
                            <td className="px-5 py-3">
                              <span className="text-white text-sm font-medium">{m.name || m.number || m.id}</span>
                              {m.number && m.name && <span className="text-slate-500 text-xs ml-2">{m.number}</span>}
                            </td>
                            <td className="px-5 py-3">
                              {m.muted ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">Muted</span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">Speaking</span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-2">
                                {m.muted ? (
                                  <button
                                    onClick={() => unmuteMut.mutate({ name: conf.name, memberId: m.id })}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium transition-colors"
                                    title="Unmute this participant"
                                  >
                                    <Mic className="w-3.5 h-3.5" /> Unmute
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => muteMut.mutate({ name: conf.name, memberId: m.id })}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-medium transition-colors"
                                    title="Mute this participant"
                                  >
                                    <MicOff className="w-3.5 h-3.5" /> Mute
                                  </button>
                                )}
                                <button
                                  onClick={() => { if (window.confirm(`Kick "${m.name || m.number || m.id}" from the conference?`)) kickMut.mutate({ name: conf.name, memberId: m.id }); }}
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors"
                                  title="Remove participant from conference"
                                >
                                  <UserX className="w-3.5 h-3.5" /> Kick
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
