import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMoh, createMoh, updateMoh, deleteMoh, uploadMohFile, deleteMohFile,
  getRecordings, uploadRecording, deleteRecording, extractError,
} from '../api';
import { useAdminAuthStore } from '@features/pbx-admin';
import type { MohClass, MohFile, Recording } from '../types';
import {
  Music, Plus, Trash2, Edit2, Loader2, AlertCircle, CheckCircle, XCircle, X,
  Upload, ChevronDown, ChevronRight, Shuffle, Play, Pause, Square, Mic, FileAudio,
  ToggleLeft, ToggleRight,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface MohForm {
  name: string;
  shuffle: boolean;
  rate: number;
  channels: number;
}

const defaultMohForm = (): MohForm => ({ name: '', shuffle: false, rate: 8000, channels: 1 });
const RATES = [8000, 16000, 32000, 48000];
const CHANNELS = [1, 2];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MohPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [tab, setTab] = useState<'moh' | 'recordings'>('moh');
  const [classModal, setClassModal] = useState<'add' | 'edit' | null>(null);
  const [mohForm, setMohForm] = useState<MohForm>(defaultMohForm());
  const [editingClass, setEditingClass] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const token = useAdminAuthStore((s) => s.token);
  const [recName, setRecName] = useState('');
  const recFileRef = useRef<HTMLInputElement>(null);
  const [playingRec, setPlayingRec] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mohPlaying, setMohPlaying] = useState<string | null>(null);
  const mohAudioRef = useRef<HTMLAudioElement | null>(null);
  const mohBlobRef = useRef<string | null>(null);

  const { data: classes = [], isLoading: mohLoading, isError: mohError } = useQuery<MohClass[]>({
    queryKey: ['moh-v2'],
    queryFn: getMoh,
    staleTime: 30_000,
  });

  const { data: recordings = [], isLoading: recLoading, isError: recError } = useQuery<Recording[]>({
    queryKey: ['recordings-v2'],
    queryFn: getRecordings,
    staleTime: 30_000,
  });

  const totalFiles = classes.reduce((s, c) => s + (c.files?.length ?? 0), 0);

  // ─── MOH mutations ─────────────────────────────────────────────────────────

  const createMohMut = useMutation({
    mutationFn: (data: Partial<MohClass>) => createMoh(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['moh-v2'] }); toast('success', 'MOH class created'); closeClassModal(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMohMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<MohClass> }) => updateMoh(name, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['moh-v2'] }); toast('success', 'MOH class updated'); closeClassModal(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMohMut = useMutation({
    mutationFn: deleteMoh,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['moh-v2'] }); toast('success', 'MOH class deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const uploadFileMut = useMutation({
    mutationFn: ({ className, file }: { className: string; file: File }) => uploadMohFile(className, file),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['moh-v2'] }); toast('success', 'File uploaded'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteFileMut = useMutation({
    mutationFn: ({ className, filename }: { className: string; filename: string }) => deleteMohFile(className, filename),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['moh-v2'] }); toast('success', 'File deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  // ─── Recording mutations ───────────────────────────────────────────────────

  const uploadRecMut = useMutation({
    mutationFn: ({ file, name }: { file: File; name: string }) => uploadRecording(file, name),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recordings-v2'] }); toast('success', 'Recording uploaded'); setRecName(''); if (recFileRef.current) recFileRef.current.value = ''; },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteRecMut = useMutation({
    mutationFn: deleteRecording,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recordings-v2'] }); toast('success', 'Recording deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const closeClassModal = useCallback(() => { setClassModal(null); setEditingClass(null); setMohForm(defaultMohForm()); }, []);

  const openAddClass = () => { setMohForm(defaultMohForm()); setClassModal('add'); };

  const openEditClass = (cls: MohClass) => {
    setMohForm({ name: cls.name, shuffle: cls.shuffle ?? false, rate: cls.rate ?? 8000, channels: cls.channels ?? 1 });
    setEditingClass(cls.name);
    setClassModal('edit');
  };

  const handleSaveClass = () => {
    if (!mohForm.name.trim()) { toast('error', 'Name is required'); return; }
    const payload: Partial<MohClass> = { name: mohForm.name.trim(), shuffle: mohForm.shuffle, rate: mohForm.rate, channels: mohForm.channels };
    if (classModal === 'edit' && editingClass) {
      updateMohMut.mutate({ name: editingClass, data: payload });
    } else {
      createMohMut.mutate(payload);
    }
  };

  const toggleExpand = (name: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };

  const handleFileUpload = (className: string, file: File) => {
    uploadFileMut.mutate({ className, file });
  };

  const handleUploadRec = () => {
    const file = recFileRef.current?.files?.[0];
    if (!file) { toast('error', 'Select a file to upload'); return; }
    if (!recName.trim()) { toast('error', 'Enter a name for the recording'); return; }
    uploadRecMut.mutate({ file, name: recName.trim() });
  };

  const togglePlayRec = useCallback(async (rec: Recording) => {
    if (playingRec === rec.name) {
      audioRef.current?.pause();
      setPlayingRec(null);
      return;
    }
    try {
      const res = await fetch(`/api/pbx-admin/recordings/${encodeURIComponent(rec.filename)}/play`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { toast('error', 'Cannot play recording'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setPlayingRec(null);
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = audio;
      audio.play();
      setPlayingRec(rec.name);
    } catch { toast('error', 'Playback failed'); }
  }, [playingRec, token, toast]);

  const stopMohAudio = useCallback(() => {
    if (mohAudioRef.current) { mohAudioRef.current.pause(); mohAudioRef.current = null; }
    if (mohBlobRef.current) { URL.revokeObjectURL(mohBlobRef.current); mohBlobRef.current = null; }
    setMohPlaying(null);
  }, []);

  const toggleMohFilePlay = useCallback(async (className: string, filename: string) => {
    const key = `${className}/${filename}`;
    if (mohPlaying === key) { stopMohAudio(); return; }
    stopMohAudio();
    try {
      const res = await fetch(`/api/pbx-admin/moh/${encodeURIComponent(className)}/files/${encodeURIComponent(filename)}/play`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { toast('error', 'Cannot play this file'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      mohBlobRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => stopMohAudio();
      mohAudioRef.current = audio;
      audio.play();
      setMohPlaying(key);
    } catch { toast('error', 'Playback failed'); }
  }, [mohPlaying, stopMohAudio, token, toast]);

  const savingClass = createMohMut.isPending || updateMohMut.isPending;
  const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all';
  const btnPrimary = 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header + stats */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Music on Hold</h1>
          <p className="text-slate-400 mt-1 font-medium">Manage hold music classes, audio files, and system recordings</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 mr-4">
            <div className="text-center">
              <p className="text-lg font-bold text-white">{classes.length}</p>
              <p className="text-xs text-slate-500">Classes</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-white">{totalFiles}</p>
              <p className="text-xs text-slate-500">Total Files</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/50 backdrop-blur-xl rounded-xl border border-slate-700/50 p-1 w-fit">
        {[{ key: 'moh' as const, label: 'MOH Classes', icon: Music }, { key: 'recordings' as const, label: 'System Recordings', icon: Mic }].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === key ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════ MOH Classes Tab ═══════════════════════════ */}
      {tab === 'moh' && (
        <>
          <div className="flex justify-end">
            <button onClick={openAddClass} className={`flex items-center gap-2 ${btnPrimary}`}>
              <Plus className="w-4 h-4" /> New Class
            </button>
          </div>

          {mohLoading && (
            <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Loading MOH classes…</p>
            </div>
          )}
          {mohError && (
            <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
              <p className="text-white font-semibold">Failed to load MOH classes</p>
            </div>
          )}
          {!mohLoading && !mohError && classes.length === 0 && (
            <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <Music className="w-12 h-12 text-slate-500 mb-4" />
              <h3 className="text-lg font-semibold text-white mb-1">No MOH Classes</h3>
              <p className="text-slate-400 text-sm mb-4">Add music on hold classes and upload audio files</p>
              <button onClick={openAddClass} className={`inline-flex items-center gap-2 ${btnPrimary}`}>
                <Plus className="w-4 h-4" /> Create First Class
              </button>
            </div>
          )}

          {!mohLoading && !mohError && classes.length > 0 && (
            <div className="space-y-3">
              {classes.map((cls) => {
                const isOpen = expanded.has(cls.name);
                return (
                  <div key={cls.id || cls.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
                    {/* Accordion header */}
                    <div className="flex items-center justify-between p-5 cursor-pointer" onClick={() => toggleExpand(cls.name)}>
                      <div className="flex items-center gap-3">
                        {isOpen ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                        <div className="p-2 rounded-xl bg-pink-500/10 border border-pink-500/20">
                          <Music className="w-4 h-4 text-pink-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">{cls.name}</h3>
                          <p className="text-xs text-slate-500">{cls.files?.length ?? 0} file{(cls.files?.length ?? 0) !== 1 ? 's' : ''} · Rate: {cls.rate ?? 8000}Hz · {cls.channels ?? 1}ch</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {cls.shuffle && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20 font-semibold flex items-center gap-1">
                            <Shuffle className="w-3 h-3" /> Shuffle
                          </span>
                        )}
                        <button onClick={() => openEditClass(cls)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors" title="Edit class settings">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => { if (window.confirm(`Delete MOH class "${cls.name}"?`)) deleteMohMut.mutate(cls.name); }} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete class">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded: file list + upload */}
                    {isOpen && (
                      <div className="px-5 pb-5 border-t border-slate-700/40">
                        <div className="mt-4 space-y-2">
                          {(cls.files || []).length === 0 ? (
                            <p className="text-sm text-slate-500 italic py-3">No audio files. Upload one below.</p>
                          ) : (
                            (cls.files || []).map((f: MohFile) => {
                              const fileKey = `${cls.name}/${f.name}`;
                              const isFilePlaying = mohPlaying === fileKey;
                              return (
                              <div key={f.name} className="flex items-center justify-between bg-slate-900/50 border border-slate-700/40 rounded-xl px-3 py-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileAudio className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <span className="text-sm text-white truncate">{f.name}</span>
                                  {f.size != null && <span className="text-xs text-slate-600 flex-shrink-0">{(f.size / 1024).toFixed(0)}KB</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => toggleMohFilePlay(cls.name, f.name)}
                                    className={`p-1.5 rounded-lg transition-colors ${isFilePlaying ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-700/40'}`}
                                    title={isFilePlaying ? 'Stop' : 'Preview'}
                                  >
                                    {isFilePlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => { if (window.confirm(`Delete "${f.name}"?`)) deleteFileMut.mutate({ className: cls.name, filename: f.name }); }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Delete file"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              );
                            }))
                          }
                        </div>
                        <div className="mt-3">
                          <input
                            type="file"
                            accept="audio/*"
                            ref={(el) => { uploadRefs.current[cls.name] = el; }}
                            className="hidden"
                            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(cls.name, file); e.target.value = ''; }}
                          />
                          <button
                            onClick={() => uploadRefs.current[cls.name]?.click()}
                            disabled={uploadFileMut.isPending}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 border border-indigo-500/30 transition-all disabled:opacity-50"
                          >
                            {uploadFileMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Upload Audio File
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════ System Recordings Tab ════════════════════ */}
      {tab === 'recordings' && (
        <>
          {/* Upload area */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Upload New Recording</h3>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs text-slate-500 mb-1">Name</label>
                <input title="Name for this recording" className={inputCls} value={recName} onChange={(e) => setRecName(e.target.value)} placeholder="e.g. Greeting" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs text-slate-500 mb-1">File</label>
                <input title="Select an audio file" type="file" accept="audio/*" ref={recFileRef} className={`${inputCls} file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30`} />
              </div>
              <button onClick={handleUploadRec} disabled={uploadRecMut.isPending} className={`${btnPrimary} disabled:opacity-50 flex items-center gap-2 flex-shrink-0`}>
                {uploadRecMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Upload
              </button>
            </div>
          </div>

          {recLoading && (
            <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Loading recordings…</p>
            </div>
          )}
          {recError && (
            <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
              <p className="text-white font-semibold">Failed to load recordings</p>
            </div>
          )}
          {!recLoading && !recError && recordings.length === 0 && (
            <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
              <Mic className="w-12 h-12 text-slate-500 mb-4" />
              <h3 className="text-lg font-semibold text-white mb-1">No System Recordings</h3>
              <p className="text-slate-400 text-sm">Upload recordings above to use as greetings or prompts</p>
            </div>
          )}

          {!recLoading && !recError && recordings.length > 0 && (
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
              <div className="divide-y divide-slate-700/30">
                {recordings.map((rec) => (
                  <div key={rec.id || rec.name} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-700/10 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileAudio className="w-5 h-5 text-slate-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{rec.name}</p>
                        <p className="text-xs text-slate-500 truncate">{rec.filename}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => togglePlayRec(rec)} className={`p-1.5 rounded-lg transition-colors ${playingRec === rec.name ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-700/40'}`} title={playingRec === rec.name ? 'Pause' : 'Play'}>
                        {playingRec === rec.name ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={() => { if (window.confirm(`Delete recording "${rec.name}"?`)) deleteRecMut.mutate(rec.name); }} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete recording">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── MOH Class Add/Edit Modal ─────────────────────────────────────── */}
      {classModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeClassModal}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-700/50">
              <h2 className="text-lg font-bold text-white">{classModal === 'edit' ? 'Edit MOH Class' : 'New MOH Class'}</h2>
              <button onClick={closeClassModal} className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Name *</label>
                <input title="MOH class name" className={inputCls} value={mohForm.name} onChange={(e) => setMohForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. default" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1.5">Sample Rate</label>
                  <select title="Audio sample rate" className={inputCls} value={mohForm.rate} onChange={(e) => setMohForm((f) => ({ ...f, rate: Number(e.target.value) }))}>
                    {RATES.map((r) => <option key={r} value={r}>{r} Hz</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1.5">Channels</label>
                  <select title="Number of audio channels" className={inputCls} value={mohForm.channels} onChange={(e) => setMohForm((f) => ({ ...f, channels: Number(e.target.value) }))}>
                    {CHANNELS.map((c) => <option key={c} value={c}>{c === 1 ? 'Mono' : 'Stereo'}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">Shuffle Playback</span>
                <button title="Toggle shuffle" onClick={() => setMohForm((f) => ({ ...f, shuffle: !f.shuffle }))}>
                  {mohForm.shuffle ? <ToggleRight className="w-8 h-8 text-emerald-400" /> : <ToggleLeft className="w-8 h-8 text-slate-500" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t border-slate-700/50">
              <button onClick={closeClassModal} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">Cancel</button>
              <button onClick={handleSaveClass} disabled={savingClass} className={`${btnPrimary} disabled:opacity-50 flex items-center gap-2`}>
                {savingClass && <Loader2 className="w-4 h-4 animate-spin" />}
                {classModal === 'edit' ? 'Save Changes' : 'Create Class'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
