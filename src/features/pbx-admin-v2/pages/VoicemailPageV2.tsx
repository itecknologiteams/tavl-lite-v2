import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getVoicemail, createVoicemail, updateVoicemail, deleteVoicemail,
  getVoicemailMessages, deleteVoicemailMessage, uploadVoicemailGreeting,
  extractError,
} from '../api';
import { useAdminAuthStore } from '@features/pbx-admin';
import type { VoicemailBox, VoicemailMessage } from '../types';
import {
  Voicemail, Plus, Trash2, Edit2, Loader2, AlertCircle, CheckCircle,
  XCircle, X, Mail, MessageSquare, Play, Pause, Download, Search,
  ToggleLeft, ToggleRight, Clock, Phone,
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

interface VmForm {
  extension: string;
  password: string;
  email: string;
  description: string;
  enabled: boolean;
  attachFile: boolean;
  deleteAfterEmail: boolean;
}

const defaultVmForm = (): VmForm => ({
  extension: '',
  password: '1234',
  email: '',
  description: '',
  enabled: true,
  attachFile: true,
  deleteAfterEmail: false,
});

function formFromBox(box: VoicemailBox): VmForm {
  return {
    extension: box.extension,
    password: box.password || '1234',
    email: box.email || '',
    description: box.description || '',
    enabled: box.enabled !== false,
    attachFile: box.attachFile !== false,
    deleteAfterEmail: box.deleteAfterEmail ?? false,
  };
}

function formatDuration(sec?: number): string {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(d?: string): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return d; }
}

// Sub-component: Messages Modal
function MessagesModal({ box, onClose, toast }: { box: VoicemailBox; onClose: () => void; toast: (t: 'success' | 'error', m: string) => void }) {
  const queryClient = useQueryClient();
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: messages = [], isLoading } = useQuery<VoicemailMessage[]>({
    queryKey: ['voicemail-messages', box.extension],
    queryFn: () => getVoicemailMessages(box.extension),
  });

  const deleteMsgMut = useMutation({
    mutationFn: deleteVoicemailMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voicemail-messages', box.extension] });
      queryClient.invalidateQueries({ queryKey: ['voicemail-v2'] });
      toast('success', 'Message deleted');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const playMessage = useCallback(async (uuid: string) => {
    if (playingUrl === uuid) {
      audioRef.current?.pause();
      setPlayingUrl(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }

    try {
      const token = useAdminAuthStore.getState().token;
      const resp = await fetch(`/api/pbx-admin/voicemail/messages/${uuid}/play`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Failed to fetch audio');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setPlayingUrl(null); URL.revokeObjectURL(url); };
      audio.play();
      audioRef.current = audio;
      setPlayingUrl(uuid);
    } catch (err) {
      toast('error', 'Failed to play message');
    }
  }, [playingUrl, toast]);

  const downloadMessage = useCallback(async (uuid: string) => {
    try {
      const token = useAdminAuthStore.getState().token;
      const resp = await fetch(`/api/pbx-admin/voicemail/messages/${uuid}/play`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Failed to fetch audio');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voicemail-${uuid}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('error', 'Failed to download message');
    }
  }, [toast]);

  useEffect(() => {
    return () => { if (audioRef.current) audioRef.current.pause(); };
  }, []);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl border-b border-slate-700/50 p-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-lg font-bold text-white">Messages</h2>
              <p className="text-xs text-slate-400">Extension {box.extension}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors" title="Close messages">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4">
            {isLoading && (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
              </div>
            )}
            {!isLoading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center p-8">
                <MessageSquare className="w-10 h-10 text-slate-500 mb-3" />
                <p className="text-white font-semibold mb-1">No Messages</p>
                <p className="text-slate-400 text-sm">This mailbox is empty</p>
              </div>
            )}
            {!isLoading && messages.length > 0 && (
              <div className="space-y-2">
                {messages.map((msg) => (
                  <div key={msg.uuid} className="p-3 bg-slate-900/40 rounded-xl border border-slate-700/40 flex items-center gap-3">
                    <button
                      onClick={() => playMessage(msg.uuid)}
                      className={`p-2 rounded-lg border transition-colors flex-shrink-0 ${
                        playingUrl === msg.uuid
                          ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                      }`}
                      title={playingUrl === msg.uuid ? 'Pause playback' : 'Play message'}
                    >
                      {playingUrl === msg.uuid ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Clock className="w-3 h-3" />
                        <span>{formatDate(msg.date)}</span>
                        {msg.duration != null && <span>· {formatDuration(msg.duration)}</span>}
                      </div>
                      {msg.from && (
                        <div className="flex items-center gap-1.5 text-sm text-white mt-0.5">
                          <Phone className="w-3 h-3 text-slate-500" />
                          <span>{msg.from}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => downloadMessage(msg.uuid)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                        title="Download message"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Delete this voicemail message?')) deleteMsgMut.mutate(msg.uuid); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete message"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function VoicemailPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [editing, setEditing] = useState<VoicemailBox | 'new' | null>(null);
  const [form, setForm] = useState<VmForm>(defaultVmForm());
  const [messagesBox, setMessagesBox] = useState<VoicemailBox | null>(null);
  const [search, setSearch] = useState('');

  const { data: mailboxes = [], isLoading, isError } = useQuery<VoicemailBox[]>({
    queryKey: ['voicemail-v2'],
    queryFn: getVoicemail,
    staleTime: 30_000,
  });

  const filtered = React.useMemo(() => {
    if (!search.trim()) return mailboxes;
    const q = search.toLowerCase();
    return mailboxes.filter((m) =>
      m.extension.includes(q) || m.email?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)
    );
  }, [mailboxes, search]);

  const createMut = useMutation({
    mutationFn: (data: Partial<VoicemailBox>) => createVoicemail(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['voicemail-v2'] }); toast('success', 'Voicemail box created'); closeModal(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ ext, data }: { ext: string; data: Partial<VoicemailBox> }) => updateVoicemail(ext, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['voicemail-v2'] }); toast('success', 'Voicemail box updated'); closeModal(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteVoicemail,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['voicemail-v2'] }); toast('success', 'Voicemail box deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  function openAdd() {
    setForm(defaultVmForm());
    setEditing('new');
  }
  function openEdit(box: VoicemailBox) {
    setForm(formFromBox(box));
    setEditing(box);
  }
  function closeModal() { setEditing(null); }

  function handleSave() {
    if (!form.extension.trim()) { toast('error', 'Extension is required'); return; }
    const payload: Partial<VoicemailBox> = {
      extension: form.extension,
      password: form.password || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      enabled: form.enabled,
      attachFile: form.attachFile,
      deleteAfterEmail: form.deleteAfterEmail,
    };
    if (editing === 'new') {
      createMut.mutate(payload);
    } else if (editing) {
      updateMut.mutate({ ext: editing.extension, data: payload });
    }
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Voicemail</h1>
          <p className="text-slate-400 mt-1 font-medium">Manage voicemail boxes and message delivery settings</p>
        </div>
        <button onClick={openAdd} className={'flex items-center gap-2 ' + primaryBtn}>
          <Plus className="w-4 h-4" /> Add Voicemail Box
        </button>
      </div>

      {/* Search */}
      {!isLoading && !isError && mailboxes.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by extension, email, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls + ' pl-10'}
            title="Filter voicemail boxes by extension, email, or description"
          />
        </div>
      )}

      {/* Loading / Error / Empty */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading voicemail boxes…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load voicemail</p>
        </div>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Voicemail className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">{search ? 'No Matching Boxes' : 'No Voicemail Boxes'}</h3>
          <p className="text-slate-400 text-sm mb-4">{search ? 'Try a different search term' : 'Create voicemail boxes for your extensions'}</p>
          {!search && (
            <button onClick={openAdd} className={primaryBtn + ' inline-flex items-center gap-2'}>
              <Plus className="w-4 h-4" /> Add First Voicemail Box
            </button>
          )}
        </div>
      )}

      {/* Card Grid */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((mb) => (
            <div key={mb.id || mb.extension} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex flex-col gap-3 group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                    <Voicemail className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-mono">{mb.extension}</h3>
                    {mb.description && <p className="text-xs text-slate-500">{mb.description}</p>}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                  mb.enabled !== false
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-slate-700/50 text-slate-400 border-slate-600/40'
                }`}>
                  {mb.enabled !== false ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-500">
                {mb.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />
                    <span className="truncate">{mb.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{mb.messageCount ?? 0} messages</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-slate-700/40">
                <button
                  onClick={() => setMessagesBox(mb)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 text-xs font-medium transition-colors"
                  title="View voicemail messages"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Messages
                </button>
                <button
                  onClick={() => openEdit(mb)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                  title="Edit voicemail box settings"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { if (window.confirm(`Delete voicemail box for extension ${mb.extension}?`)) deleteMut.mutate(mb.extension); }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete voicemail box"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {editing !== null && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeModal}>
            <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl border-b border-slate-700/50 p-4 flex items-center justify-between z-10">
                <h2 className="text-lg font-bold text-white">{editing === 'new' ? 'New Voicemail Box' : `Edit: ${(editing as VoicemailBox).extension}`}</h2>
                <button onClick={closeModal} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors" title="Close form">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">Extension *</label>
                  <input
                    value={form.extension}
                    onChange={(e) => setForm((p) => ({ ...p, extension: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. 1001"
                    disabled={editing !== 'new'}
                    title="The extension number this voicemail box is associated with"
                  />
                  {editing !== 'new' && <p className="text-xs text-slate-600 mt-1">Extension cannot be changed after creation</p>}
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">PIN</label>
                  <input
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. 1234"
                    title="Numeric PIN required to access voicemail messages"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    className={inputCls}
                    placeholder="user@example.com"
                    title="Email address where voicemail notifications are sent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">Description</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. Sales team voicemail"
                    title="Human-readable description of this voicemail box"
                  />
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-700/40">
                    <div>
                      <p className="text-sm text-white font-semibold">Enabled</p>
                      <p className="text-xs text-slate-500">Activate this voicemail box</p>
                    </div>
                    <button onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))} className="text-indigo-400" title="Toggle whether this voicemail box is active">
                      {form.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-700/40">
                    <div>
                      <p className="text-sm text-white font-semibold">Attach File</p>
                      <p className="text-xs text-slate-500">Attach audio file to email notifications</p>
                    </div>
                    <button onClick={() => setForm((p) => ({ ...p, attachFile: !p.attachFile }))} className="text-indigo-400" title="Toggle attaching audio files to voicemail email notifications">
                      {form.attachFile ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-700/40">
                    <div>
                      <p className="text-sm text-white font-semibold">Delete After Email</p>
                      <p className="text-xs text-slate-500">Remove message from server after emailing</p>
                    </div>
                    <button onClick={() => setForm((p) => ({ ...p, deleteAfterEmail: !p.deleteAfterEmail }))} className="text-indigo-400" title="Toggle deleting voicemail messages from the server after sending them via email">
                      {form.deleteAfterEmail ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 bg-slate-800/95 backdrop-blur-xl border-t border-slate-700/50 p-4 flex items-center gap-3">
                <button onClick={handleSave} disabled={saving} className={primaryBtn + ' flex items-center gap-2 flex-1 justify-center'}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing === 'new' ? 'Create Box' : 'Save Changes'}
                </button>
                <button onClick={closeModal} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Messages Modal */}
      {messagesBox && (
        <MessagesModal box={messagesBox} onClose={() => setMessagesBox(null)} toast={toast} />
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
