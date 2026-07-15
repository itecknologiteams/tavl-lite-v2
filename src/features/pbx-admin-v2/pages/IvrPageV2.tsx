import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIvr, createIvr, updateIvr, deleteIvr, toggleIvr,
  getRecordings, uploadRecording, deleteRecording,
  extractError,
} from '../api';
import { useAdminAuthStore } from '@features/pbx-admin';
import type { IvrMenu, IvrOption, Recording } from '../types';
import { AudioPicker } from '../components/AudioPicker';
import {
  PhoneForwarded, Plus, Trash2, Edit2, Loader2, AlertCircle, CheckCircle,
  XCircle, X, Search, Music, Upload, Play, Pause, Settings2, Keyboard,
  Clock, Code2, ToggleLeft, ToggleRight, Hash,
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

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'] as const;
const DEST_TYPES = ['None', 'Extension', 'Queue', 'IVR', 'Voicemail', 'Hangup'] as const;

interface IvrFormData {
  name: string;
  description: string;
  greetingShort: string;
  timeout: number;
  maxFailures: number;
  maxTimeouts: number;
  directDial: boolean;
  timeoutDestType: string;
  timeoutDest: string;
  invalidDestType: string;
  invalidDest: string;
  options: { digit: string; description: string; action: string; param: string }[];
}

const defaultForm = (): IvrFormData => ({
  name: '',
  description: '',
  greetingShort: '',
  timeout: 5,
  maxFailures: 3,
  maxTimeouts: 3,
  directDial: false,
  timeoutDestType: 'Hangup',
  timeoutDest: '',
  invalidDestType: 'Hangup',
  invalidDest: '',
  options: DIGIT_KEYS.map((d) => ({ digit: d, description: '', action: 'None', param: '' })),
});

function formFromIvr(ivr: IvrMenu): IvrFormData {
  const optMap = new Map((ivr.options || []).map((o) => [o.digit, o]));
  return {
    name: ivr.name,
    description: ivr.description || '',
    greetingShort: ivr.greetingShort || '',
    timeout: ivr.timeout ?? 5,
    maxFailures: ivr.maxFailures ?? 3,
    maxTimeouts: ivr.maxTimeouts ?? 3,
    directDial: ivr.directDial ?? false,
    timeoutDestType: ivr.timeoutDestType || 'Hangup',
    timeoutDest: ivr.timeoutDest || '',
    invalidDestType: ivr.invalidDestType || 'Hangup',
    invalidDest: ivr.invalidDest || '',
    options: DIGIT_KEYS.map((d) => {
      const o = optMap.get(d);
      return { digit: d, description: o?.description || '', action: o?.action || 'None', param: o?.param || '' };
    }),
  };
}

function formToPayload(f: IvrFormData): Partial<IvrMenu> {
  return {
    name: f.name,
    description: f.description || undefined,
    greetingShort: f.greetingShort || undefined,
    timeout: f.timeout,
    maxFailures: f.maxFailures,
    maxTimeouts: f.maxTimeouts,
    directDial: f.directDial,
    timeoutDestType: f.timeoutDestType !== 'Hangup' ? f.timeoutDestType : undefined,
    timeoutDest: f.timeoutDest || undefined,
    invalidDestType: f.invalidDestType !== 'Hangup' ? f.invalidDestType : undefined,
    invalidDest: f.invalidDest || undefined,
    options: f.options
      .filter((o) => o.action !== 'None')
      .map((o) => ({ digit: o.digit, description: o.description, action: o.action, param: o.param })),
  };
}

const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all';
const selectCls = inputCls + ' appearance-none';
const primaryBtn = 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all';
const dangerBtn = 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-sm';

export function IvrPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [activeTab, setActiveTab] = useState<'menus' | 'audio'>('menus');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<IvrMenu | 'new' | null>(null);
  const [form, setForm] = useState<IvrFormData>(defaultForm());
  const [editorTab, setEditorTab] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ivr-v2'],
    queryFn: getIvr,
    staleTime: 30_000,
  });
  const ivrs: IvrMenu[] = data?.ivrs || [];
  const destinations = data?.destinations || { queues: [], extensions: [], ivrs: [] };

  const token = useAdminAuthStore((s) => s.token);
  const { data: recordings = [], isLoading: recsLoading } = useQuery<Recording[]>({
    queryKey: ['recordings-v2'],
    queryFn: getRecordings,
    staleTime: 30_000,
  });
  const refreshRecordings = () => queryClient.invalidateQueries({ queryKey: ['recordings-v2'] });

  const filtered = useMemo(() => {
    if (!search.trim()) return ivrs;
    const q = search.toLowerCase();
    return ivrs.filter((i) => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q));
  }, [ivrs, search]);

  const createMut = useMutation({
    mutationFn: (d: Partial<IvrMenu>) => createIvr(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ivr-v2'] }); toast('success', 'IVR menu created'); closeEditor(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, data: d }: { name: string; data: Partial<IvrMenu> }) => updateIvr(name, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ivr-v2'] }); toast('success', 'IVR menu updated'); closeEditor(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteIvr,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ivr-v2'] }); toast('success', 'IVR menu deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => toggleIvr(name, enabled),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ivr-v2'] }); toast('success', 'IVR status updated'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const uploadMut = useMutation({
    mutationFn: ({ file, name }: { file: File; name: string }) => uploadRecording(file, name),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recordings-v2'] }); toast('success', 'Recording uploaded'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteRecMut = useMutation({
    mutationFn: deleteRecording,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recordings-v2'] }); toast('success', 'Recording deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  function openAdd() {
    setForm(defaultForm());
    setEditing('new');
    setEditorTab(0);
  }
  function openEdit(ivr: IvrMenu) {
    setForm(formFromIvr(ivr));
    setEditing(ivr);
    setEditorTab(0);
  }
  function closeEditor() { setEditing(null); }

  function handleSave() {
    if (!form.name.trim()) { toast('error', 'Name is required'); return; }
    const payload = formToPayload(form);
    if (editing === 'new') {
      createMut.mutate(payload);
    } else if (editing) {
      updateMut.mutate({ name: editing.name, data: payload });
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '');
    uploadMut.mutate({ file, name });
    e.target.value = '';
  }

  function togglePlay(rec: Recording) {
    if (playingId === rec.name) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(rec.url || `/api/pbx-admin/recordings/${encodeURIComponent(rec.filename)}`);
    a.onended = () => setPlayingId(null);
    a.play();
    audioRef.current = a;
    setPlayingId(rec.name);
  }

  function setOpt(idx: number, key: keyof IvrFormData['options'][0], val: string) {
    setForm((p) => {
      const opts = [...p.options];
      opts[idx] = { ...opts[idx], [key]: val };
      return { ...p, options: opts };
    });
  }

  const saving = createMut.isPending || updateMut.isPending;
  const totalMenus = ivrs.length;
  const totalRecordings = recordings.length;

  const editorTabs = ['General', 'Key Mapping', 'Timeout & Invalid', 'Advanced'] as const;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">IVR / Auto-Attendant</h1>
          <p className="text-slate-400 mt-1 font-medium">Interactive voice response menus and audio management</p>
        </div>
        <button onClick={openAdd} className={'flex items-center gap-2 ' + primaryBtn}>
          <Plus className="w-4 h-4" /> Add IVR Menu
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20"><PhoneForwarded className="w-4 h-4 text-violet-400" /></div>
            <span className="text-sm text-slate-400 font-medium">Phone Menus</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalMenus}</p>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20"><Music className="w-4 h-4 text-cyan-400" /></div>
            <span className="text-sm text-slate-400 font-medium">Recordings</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalRecordings}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-800/50 backdrop-blur-xl rounded-xl border border-slate-700/50 p-1 w-fit">
        {(['menus', 'audio'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === t ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t === 'menus' ? 'Phone Menus' : 'Audio Manager'}
          </button>
        ))}
      </div>

      {/* Phone Menus Tab */}
      {activeTab === 'menus' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search menus…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputCls + ' pl-10'}
                title="Filter IVR menus by name or description"
              />
            </div>
          </div>

          {isLoading && (
            <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Loading IVR menus…</p>
            </div>
          )}
          {isError && (
            <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
              <p className="text-white font-semibold">Failed to load IVR menus</p>
            </div>
          )}
          {!isLoading && !isError && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <PhoneForwarded className="w-12 h-12 text-slate-500 mb-4" />
              <h3 className="text-lg font-semibold text-white mb-1">{search ? 'No Matching Menus' : 'No IVR Menus'}</h3>
              <p className="text-slate-400 text-sm mb-4">{search ? 'Try a different search term' : 'Create an IVR menu to greet callers with options'}</p>
              {!search && (
                <button onClick={openAdd} className={primaryBtn + ' inline-flex items-center gap-2'}>
                  <Plus className="w-4 h-4" /> Add First IVR Menu
                </button>
              )}
            </div>
          )}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((ivr) => (
                <div key={ivr.id || ivr.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 flex flex-col gap-3 group">
                  <div className="flex items-start justify-between">
                    <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
                      <PhoneForwarded className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(ivr)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors" title="Edit IVR menu">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (window.confirm(`Delete IVR menu "${ivr.name}"?`)) deleteMut.mutate(ivr.name); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete IVR menu"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{ivr.name}</h3>
                    {ivr.description && <p className="text-xs text-slate-500 mt-0.5">{ivr.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{ivr.options?.length ?? 0} key mappings</span>
                    {ivr.timeout && <span>· {ivr.timeout}s timeout</span>}
                    {ivr.directDial && <span>· Direct dial</span>}
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-slate-700/40">
                    <button onClick={() => openEdit(ivr)} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                      Configure →
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMut.mutate({ name: ivr.name, enabled: !ivr.enabled });
                      }}
                      disabled={toggleMut.isPending}
                      className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-semibold border cursor-pointer transition-all ${
                        ivr.enabled
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                          : 'bg-slate-700/50 text-slate-400 border-slate-600/40 hover:bg-slate-700/70'
                      }`}
                      title={ivr.enabled ? 'Click to disable' : 'Click to enable'}
                    >
                      {ivr.enabled
                        ? <><ToggleRight className="w-3.5 h-3.5" /> Enabled</>
                        : <><ToggleLeft className="w-3.5 h-3.5" /> Disabled</>
                      }
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Audio Manager Tab */}
      {activeTab === 'audio' && (
        <div className="space-y-4">
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Upload className="w-4 h-4 text-indigo-400" /> Upload Recording
            </h3>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="block text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30 file:cursor-pointer file:transition-all"
                title="Select an audio file to upload as an IVR greeting or recording"
              />
              {uploadMut.isPending && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />}
            </div>
          </div>

          {recsLoading && (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            </div>
          )}

          {!recsLoading && recordings.length === 0 && (
            <div className="flex flex-col items-center justify-center p-12 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <Music className="w-10 h-10 text-slate-500 mb-3" />
              <p className="text-white font-semibold mb-1">No Recordings</p>
              <p className="text-slate-400 text-sm">Upload audio files to use as IVR greetings</p>
            </div>
          )}

          {!recsLoading && recordings.length > 0 && (
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 divide-y divide-slate-700/40">
              {recordings.map((rec) => (
                <div key={rec.name} className="flex items-center gap-4 p-4 hover:bg-slate-700/10 transition-colors group">
                  <button
                    onClick={() => togglePlay(rec)}
                    className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                    title={playingId === rec.name ? 'Pause playback' : 'Play recording'}
                  >
                    {playingId === rec.name ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{rec.name}</p>
                    <p className="text-slate-500 text-xs truncate">{rec.filename}</p>
                  </div>
                  <button
                    onClick={() => { if (window.confirm(`Delete recording "${rec.name}"?`)) deleteRecMut.mutate(rec.name); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete recording"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Slide-over Editor */}
      {editing !== null && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={closeEditor} />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-slate-800 border-l border-slate-700/50 z-50 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl border-b border-slate-700/50 p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-white">{editing === 'new' ? 'New IVR Menu' : `Edit: ${(editing as IvrMenu).name}`}</h2>
              <button onClick={closeEditor} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors" title="Close editor">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Editor Tabs */}
            <div className="flex items-center gap-1 px-4 pt-4 pb-2 overflow-x-auto">
              {editorTabs.map((t, i) => (
                <button
                  key={t}
                  onClick={() => setEditorTab(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    editorTab === i ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {i === 0 && <Settings2 className="w-3 h-3 inline mr-1" />}
                  {i === 1 && <Keyboard className="w-3 h-3 inline mr-1" />}
                  {i === 2 && <Clock className="w-3 h-3 inline mr-1" />}
                  {i === 3 && <Code2 className="w-3 h-3 inline mr-1" />}
                  {t}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-4">
              {/* Tab 0: General */}
              {editorTab === 0 && (
                <>
                  <div>
                    <label className="block text-xs text-slate-400 font-semibold mb-1.5">Menu Name *</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. Main Menu"
                      title="Unique name identifying this IVR menu"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 font-semibold mb-1.5">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      className={inputCls + ' h-20 resize-none'}
                      placeholder="Optional description of this menu"
                      title="Human-readable description of the IVR menu purpose"
                    />
                  </div>
                  <AudioPicker
                    label="Greeting Recording"
                    tip="Audio played when a caller enters this IVR menu"
                    value={form.greetingShort}
                    onChange={(v) => setForm((p) => ({ ...p, greetingShort: v }))}
                    recordings={recordings}
                    token={token || ''}
                    onUploadComplete={refreshRecordings}
                    placeholder="— No greeting —"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1.5">Timeout (sec)</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={form.timeout}
                        onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) || 5 }))}
                        className={inputCls}
                        title="Seconds to wait for caller input before triggering timeout action"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 font-semibold mb-1.5">Max Retries</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={form.maxFailures}
                        onChange={(e) => setForm((p) => ({ ...p, maxFailures: Number(e.target.value) || 3 }))}
                        className={inputCls}
                        title="Maximum number of invalid key presses before the menu exits"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-700/40">
                    <div>
                      <p className="text-sm text-white font-semibold">Direct Dial</p>
                      <p className="text-xs text-slate-500">Allow callers to dial extensions directly</p>
                    </div>
                    <button
                      onClick={() => setForm((p) => ({ ...p, directDial: !p.directDial }))}
                      className="text-indigo-400"
                      title="Toggle whether callers can dial extension numbers directly during the IVR menu"
                    >
                      {form.directDial ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                    </button>
                  </div>
                </>
              )}

              {/* Tab 1: Key Mapping */}
              {editorTab === 1 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 mb-3">Configure what happens when a caller presses each key.</p>
                  {form.options.map((opt, i) => (
                    <div key={opt.digit} className="flex items-center gap-2 p-2.5 bg-slate-900/40 rounded-xl border border-slate-700/40">
                      <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm font-bold flex-shrink-0">
                        {opt.digit}
                      </div>
                      <input
                        value={opt.description}
                        onChange={(e) => setOpt(i, 'description', e.target.value)}
                        className="flex-1 min-w-0 bg-transparent border-0 text-white text-xs focus:outline-none placeholder:text-slate-600"
                        placeholder="Label"
                        title={`Label for key ${opt.digit} - describes what this option does`}
                      />
                      <select
                        value={opt.action}
                        onChange={(e) => { setOpt(i, 'action', e.target.value); setOpt(i, 'param', ''); }}
                        className="bg-slate-800 border border-slate-700 rounded-lg text-xs text-white py-1 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        title={`Destination type for key ${opt.digit}`}
                      >
                        {DEST_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {opt.action === 'Extension' && (
                        <select
                          value={opt.param}
                          onChange={(e) => setOpt(i, 'param', e.target.value)}
                          className="w-28 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white py-1 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                          title={`Extension for key ${opt.digit}`}
                        >
                          <option value="">Select…</option>
                          {destinations.extensions.map((ext: any) => (
                            <option key={ext.extension} value={ext.extension}>{ext.extension} — {ext.name}</option>
                          ))}
                        </select>
                      )}
                      {opt.action === 'Queue' && (
                        <select
                          value={opt.param}
                          onChange={(e) => setOpt(i, 'param', e.target.value)}
                          className="w-28 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white py-1 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                          title={`Queue for key ${opt.digit}`}
                        >
                          <option value="">Select…</option>
                          {destinations.queues.map((q: any) => (
                            <option key={q.name || q} value={q.name || q}>{q.label || q.name || q}</option>
                          ))}
                        </select>
                      )}
                      {opt.action === 'IVR' && (
                        <select
                          value={opt.param}
                          onChange={(e) => setOpt(i, 'param', e.target.value)}
                          className="w-28 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white py-1 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                          title={`IVR sub-menu for key ${opt.digit}`}
                        >
                          <option value="">Select…</option>
                          {destinations.ivrs.map((n: string) => (
                            <option key={n} value={n}>{n}{n === form.name ? ' (this)' : ''}</option>
                          ))}
                        </select>
                      )}
                      {opt.action === 'Voicemail' && (
                        <input
                          value={opt.param}
                          onChange={(e) => setOpt(i, 'param', e.target.value)}
                          className="w-20 bg-transparent border border-slate-700 rounded-lg text-xs text-white py-1 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                          placeholder="Ext #"
                          title={`Extension number whose voicemail to reach for key ${opt.digit}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 2: Timeout & Invalid */}
              {editorTab === 2 && (
                <div className="space-y-5">
                  {([
                    { key: 'timeout' as const, icon: <Clock className="w-4 h-4 text-amber-400" />, title: 'Timeout Action',
                      desc: 'What happens when the caller doesn\'t press any key within the timeout period. Recommended: route to Queue so callers still reach an agent.',
                      typeField: 'timeoutDestType' as const, destField: 'timeoutDest' as const },
                    { key: 'invalid' as const, icon: <AlertCircle className="w-4 h-4 text-red-400" />, title: 'Invalid Input Action',
                      desc: 'What happens when the caller presses an unmapped key.',
                      typeField: 'invalidDestType' as const, destField: 'invalidDest' as const },
                  ]).map((cfg) => {
                    const destType = (form as any)[cfg.typeField] || 'Hangup';
                    const destVal = (form as any)[cfg.destField] || '';
                    return (
                    <div key={cfg.key} className="p-4 bg-slate-900/40 rounded-xl border border-slate-700/40 space-y-3">
                      <h4 className="text-sm font-semibold text-white flex items-center gap-2">{cfg.icon} {cfg.title}</h4>
                      <p className="text-xs text-slate-500">{cfg.desc}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-slate-400 font-semibold mb-1">Destination Type</label>
                          <select
                            value={destType}
                            onChange={(e) => setForm((p) => ({ ...p, [cfg.typeField]: e.target.value, [cfg.destField]: '' }))}
                            className={selectCls}
                            title={`Where to send the call on ${cfg.key}`}
                          >
                            {DEST_TYPES.filter((d) => d !== 'None').map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        {destType === 'Extension' && (
                          <div>
                            <label className="block text-xs text-slate-400 font-semibold mb-1">Extension</label>
                            <select value={destVal} onChange={(e) => setForm((p) => ({ ...p, [cfg.destField]: e.target.value }))} className={selectCls} title="Select extension">
                              <option value="">Select…</option>
                              {destinations.extensions.map((ext: any) => (
                                <option key={ext.extension} value={ext.extension}>{ext.extension} — {ext.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {destType === 'Queue' && (
                          <div>
                            <label className="block text-xs text-slate-400 font-semibold mb-1">Queue</label>
                            <select value={destVal} onChange={(e) => setForm((p) => ({ ...p, [cfg.destField]: e.target.value }))} className={selectCls} title="Select queue">
                              <option value="">Select…</option>
                              {destinations.queues.map((q: any) => (
                                <option key={q.name || q} value={q.name || q}>{q.label || q.name || q}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {destType === 'IVR' && (
                          <div>
                            <label className="block text-xs text-slate-400 font-semibold mb-1">IVR Menu</label>
                            <select value={destVal} onChange={(e) => setForm((p) => ({ ...p, [cfg.destField]: e.target.value }))} className={selectCls} title="Select IVR menu">
                              <option value="">Select…</option>
                              {destinations.ivrs.map((n: string) => (
                                <option key={n} value={n}>{n}{n === form.name ? ' (this menu)' : ''}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {destType === 'Voicemail' && (
                          <div>
                            <label className="block text-xs text-slate-400 font-semibold mb-1">Extension #</label>
                            <input value={destVal} onChange={(e) => setForm((p) => ({ ...p, [cfg.destField]: e.target.value }))} className={inputCls} placeholder="e.g. 1001" title="Extension voicemail" />
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}

              {/* Tab 3: Advanced */}
              {editorTab === 3 && (
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">JSON Preview (read-only)</label>
                  <textarea
                    readOnly
                    value={JSON.stringify(formToPayload(form), null, 2)}
                    className={inputCls + ' h-80 font-mono text-xs resize-none text-slate-300'}
                    title="Read-only JSON representation of the current IVR configuration"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-slate-800/95 backdrop-blur-xl border-t border-slate-700/50 p-4 flex items-center gap-3">
              <button onClick={handleSave} disabled={saving} className={primaryBtn + ' flex items-center gap-2 flex-1 justify-center'}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing === 'new' ? 'Create Menu' : 'Save Changes'}
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
