import React, { useEffect, useState, useRef } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Plus, Edit2, Trash2, Save, X, RefreshCw, Music,
  Upload, FolderOpen, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle, FileAudio, Volume2,
  Play, Square, Loader2,
} from 'lucide-react';

interface MohFile {
  name: string;
  size: number;
  modified: string;
}

interface MohClass {
  name: string;
  mode: string;
  directory: string;
  sort: string;
  fileCount: number;
  files: MohFile[];
}

interface Recording {
  name: string;
  path: string;
  size: number;
}

const defaultForm = { name: '', mode: 'files', directory: '', sort: '' };

export function MohPage() {
  const [classes, setClasses] = useState<MohClass[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const recordingUploadRef = useRef<HTMLInputElement | null>(null);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      URL.revokeObjectURL(audioRef.current.dataset.blobUrl || '');
    }
    setPlayingId(null);
  };

  const playAudio = async (id: string, url: string) => {
    stopPlayback();
    if (playingId === id) return;
    setLoadingAudio(id);
    try {
      const resp = await adminApi(url);
      if (!resp.ok) throw new Error('Failed to fetch audio');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.dataset.blobUrl = blobUrl;
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(blobUrl); };
      audio.onerror = () => { setPlayingId(null); URL.revokeObjectURL(blobUrl); setToast({ type: 'error', message: 'Playback failed' }); };
      audioRef.current = audio;
      await audio.play();
      setPlayingId(id);
    } catch {
      setToast({ type: 'error', message: 'Failed to load audio' });
    } finally {
      setLoadingAudio(null);
    }
  };

  useEffect(() => { fetchClasses(); fetchRecordings(); }, []);
  useEffect(() => () => stopPlayback(), []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchClasses = async () => {
    setLoading(true);
    try {
      const resp = await adminApi('/moh');
      const data = await resp.json();
      if (data.success) setClasses(data.classes);
    } catch (err) {
      console.error('Failed to fetch MOH classes:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecordings = async () => {
    try {
      const resp = await adminApi('/recordings');
      const data = await resp.json();
      if (data.success) setRecordings(data.recordings || []);
    } catch { /* ignore */ }
  };

  const handleUploadRecording = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingRecording(true);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const resp = await adminApi('/recordings/upload', { method: 'POST', body: fd });
        const data = await resp.json();
        if (data.success) uploaded++;
        else setToast({ type: 'error', message: `${file.name}: ${data.error}` });
      } catch (err: any) {
        setToast({ type: 'error', message: `${file.name}: ${err.message}` });
      }
    }
    if (uploaded > 0) {
      setToast({ type: 'success', message: `${uploaded} recording(s) uploaded` });
      await reloadFs();
      fetchRecordings();
    }
    setUploadingRecording(false);
    if (recordingUploadRef.current) recordingUploadRef.current.value = '';
  };

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const openForm = (mode: 'add' | 'edit', cls?: MohClass) => {
    setFormMode(mode);
    if (mode === 'edit' && cls) {
      setForm({ name: cls.name, mode: cls.mode, directory: cls.directory, sort: cls.sort });
    } else {
      setForm({ ...defaultForm });
    }
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const url = formMode === 'add' ? '/moh' : `/moh/${form.name}`;
      const method = formMode === 'add' ? 'POST' : 'PUT';
      const resp = await adminApi(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      if (data.success) {
        setShowForm(false);
        setToast({ type: 'success', message: formMode === 'add' ? `MOH class "${form.name}" created` : `MOH class "${form.name}" updated` });
        await reloadFs();
        fetchClasses();
      } else {
        setToast({ type: 'error', message: data.error || 'Save failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete MOH class "${name}"? This will not delete audio files on disk.`)) return;
    try {
      const resp = await adminApi(`/moh/${name}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: `MOH class "${name}" deleted` });
        await reloadFs();
        fetchClasses();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message });
    }
  };

  const handleUploadFile = async (className: string, files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setUploading(className);

    let successCount = 0;
    for (const file of fileArray) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const resp = await adminApi(`/moh/${className}/upload`, { method: 'POST', body: fd });
        const data = await resp.json();
        if (data.success) successCount++;
        else setToast({ type: 'error', message: `${file.name}: ${data.error}` });
      } catch (err: any) {
        setToast({ type: 'error', message: `${file.name}: ${err.message}` });
      }
    }

    if (successCount > 0) {
      setToast({ type: 'success', message: `${successCount} file(s) uploaded to "${className}"` });
      await reloadFs();
      fetchClasses();
    }
    setUploading(null);
  };

  const handleDeleteFile = async (className: string, filename: string) => {
    if (!confirm(`Delete "${filename}" from MOH class "${className}"?`)) return;
    try {
      const resp = await adminApi(`/moh/${className}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: `"${filename}" deleted` });
        await reloadFs();
        fetchClasses();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete file' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message });
    }
  };

  const handleDeleteRecording = async (name: string) => {
    if (!confirm(`Delete recording "${name}"? This file may be in use by inbound routes.`)) return;
    try {
      const resp = await adminApi(`/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: `Recording "${name}" deleted` });
        await reloadFs();
        fetchRecordings();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete recording' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading Music on Hold configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Music & Audio</h1>
          <p className="text-sm text-slate-400 mt-1">Manage hold music classes and audio recordings used across the PBX</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { fetchClasses(); fetchRecordings(); }} className="px-3 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => openForm('add')} className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2">
            <Plus className="w-4 h-4" /> New MOH Class
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Music className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{classes.length}</p>
              <p className="text-xs text-slate-400">MOH Classes</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <FileAudio className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{classes.reduce((s, c) => s + c.fileCount, 0)}</p>
              <p className="text-xs text-slate-400">MOH Audio Files</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Volume2 className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{recordings.length}</p>
              <p className="text-xs text-slate-400">Recordings</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{classes.filter(c => c.mode === 'files').length}</p>
              <p className="text-xs text-slate-400">File-Based</p>
            </div>
          </div>
        </div>
      </div>

      {/* ========== MOH CLASSES ========== */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Music className="w-5 h-5 text-purple-400" /> Hold Music Classes
        </h2>

        {classes.length === 0 ? (
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-12 text-center">
            <Music className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No MOH Classes</h3>
            <p className="text-sm text-slate-400 mb-6">Create your first Music on Hold class to configure hold music for callers.</p>
            <button onClick={() => openForm('add')} className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium">
              <Plus className="w-4 h-4 inline mr-2" /> Create MOH Class
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {classes.map(cls => {
              const isExpanded = expanded.has(cls.name);
              return (
                <div key={cls.name} className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden hover:border-slate-600/50 transition-all">
                  <div className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <button onClick={() => toggleExpand(cls.name)} className="p-1 rounded hover:bg-slate-700/50 transition-all">
                        {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                      </button>
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <Music className="w-5 h-5 text-purple-400" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-white">{cls.name}</h3>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                          <span className="px-2 py-0.5 rounded-full bg-slate-700/50 border border-slate-600/30">{cls.mode}</span>
                          <span className="flex items-center gap-1"><FileAudio className="w-3 h-3" /> {cls.fileCount} files</span>
                          <span className="flex items-center gap-1 truncate"><FolderOpen className="w-3 h-3" /> {cls.directory}</span>
                          {cls.sort && <span>Sort: {cls.sort}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openForm('edit', cls)} className="p-2 rounded-lg hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition-all" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(cls.name)} className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-700/50 p-5 space-y-4">
                      <input
                        ref={el => { fileInputRefs.current[cls.name] = el; }}
                        type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.gsm" multiple className="hidden"
                        onChange={e => e.target.files && handleUploadFile(cls.name, e.target.files)}
                      />
                      <div
                        onClick={() => uploading !== cls.name && fileInputRefs.current[cls.name]?.click()}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.setAttribute('data-dragover', 'true'); }}
                        onDragLeave={e => { e.currentTarget.removeAttribute('data-dragover'); }}
                        onDrop={e => {
                          e.preventDefault();
                          e.currentTarget.removeAttribute('data-dragover');
                          if (e.dataTransfer.files?.length) handleUploadFile(cls.name, e.dataTransfer.files);
                        }}
                        className={`group border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer
                          ${uploading === cls.name
                            ? 'border-blue-500/50 bg-blue-500/5'
                            : 'border-slate-600/50 hover:border-emerald-500/50 hover:bg-emerald-500/5 data-[dragover]:border-emerald-500/50 data-[dragover]:bg-emerald-500/5'
                          }`}
                      >
                        {uploading === cls.name ? (
                          <div className="flex items-center justify-center gap-3">
                            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
                            <span className="text-sm text-white">Uploading & converting...</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-3">
                            <Upload className="w-5 h-5 text-emerald-400" />
                            <span className="text-sm text-slate-300">
                              Drop audio files here or <span className="text-emerald-400 underline underline-offset-2">browse</span>
                            </span>
                            <span className="text-xs text-slate-500">Auto-converts to 8kHz WAV</span>
                          </div>
                        )}
                      </div>

                      {cls.files.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-4 italic">No audio files in this class</p>
                      ) : (
                        <div className="bg-slate-800/60 rounded-xl border border-slate-700/30 overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-slate-700/30 bg-slate-800/80">
                                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">File</th>
                                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Size</th>
                                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Modified</th>
                                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/20">
                              {cls.files.map(file => {
                                const fileId = `moh-${cls.name}-${file.name}`;
                                const isPlaying = playingId === fileId;
                                const isLoading = loadingAudio === fileId;
                                return (
                                <tr key={file.name} className="hover:bg-slate-700/20 transition-colors">
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <FileAudio className="w-4 h-4 text-purple-400" />
                                      <span className="text-sm text-white">{file.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-slate-300">
                                    {file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-slate-400">
                                    {file.modified ? new Date(file.modified).toLocaleDateString() : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        onClick={() => isPlaying ? stopPlayback() : playAudio(fileId, `/moh/${cls.name}/files/${encodeURIComponent(file.name)}/stream`)}
                                        disabled={isLoading}
                                        className={`p-1.5 rounded-lg transition-all ${
                                          isPlaying ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                          : 'hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400'
                                        }`}
                                        title={isPlaying ? 'Stop' : 'Play'}
                                      >
                                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" />
                                          : isPlaying ? <Square className="w-4 h-4" />
                                          : <Play className="w-4 h-4" />}
                                      </button>
                                      <button
                                        onClick={() => handleDeleteFile(cls.name, file.name)}
                                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
                                        title="Delete file"
                                      >
                                        <Trash2 className="w-4 h-4" />
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========== AUDIO RECORDINGS ========== */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-amber-400" /> Audio Recordings
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400">{recordings.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            <input ref={recordingUploadRef} type="file" accept="audio/*,.wav,.mp3,.ogg" multiple className="hidden"
              onChange={e => handleUploadRecording(e.target.files)} />
            <button onClick={() => recordingUploadRef.current?.click()} disabled={uploadingRecording}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-sm font-medium transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 disabled:opacity-50">
              {uploadingRecording ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Recording
            </button>
          </div>
        </div>

        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-300">
            These recordings are used as greetings and announcements in <strong>Call Routing → Inbound Routes</strong>.
            Upload audio files here, then select them on the Routing page.
          </p>
        </div>

        {recordings.length === 0 ? (
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-8 text-center">
            <Volume2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No recordings uploaded yet</p>
            <p className="text-xs text-slate-500 mt-1">Upload audio files to use as greetings and announcements in your inbound routes</p>
          </div>
        ) : (
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/30 bg-slate-800/80">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Recording</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Path</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Size</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/20">
                {recordings.map(r => {
                  const recId = `rec-${r.name}`;
                  const isPlaying = playingId === recId;
                  const isLoading = loadingAudio === recId;
                  return (
                  <tr key={r.name} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <FileAudio className="w-4 h-4 text-amber-400" />
                        <span className="text-sm text-white font-medium">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{r.path}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-300">
                      {r.size > 1048576 ? `${(r.size / 1048576).toFixed(1)} MB` : r.size > 0 ? `${(r.size / 1024).toFixed(1)} KB` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => isPlaying ? stopPlayback() : playAudio(recId, `/recordings/${encodeURIComponent(r.name)}/stream`)}
                          disabled={isLoading}
                          className={`p-1.5 rounded-lg transition-all ${
                            isPlaying ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                            : 'hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400'
                          }`}
                          title={isPlaying ? 'Stop' : 'Play'}
                        >
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" />
                            : isPlaying ? <Square className="w-4 h-4" />
                            : <Play className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDeleteRecording(r.name)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
                          title="Delete recording"
                        >
                          <Trash2 className="w-4 h-4" />
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
      </div>

      {/* Add/Edit MOH Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {formMode === 'add' ? 'Create MOH Class' : `Edit: ${form.name}`}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Class Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }))}
                  disabled={formMode === 'edit'}
                  placeholder="e.g. default, jazz, classical"
                  className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Mode</label>
                  <select
                    value={form.mode}
                    onChange={e => setForm(p => ({ ...p, mode: e.target.value }))}
                    className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="files">files</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Sort</label>
                  <select
                    value={form.sort}
                    onChange={e => setForm(p => ({ ...p, sort: e.target.value }))}
                    className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="">Default</option>
                    <option value="alpha">Alphabetical</option>
                    <option value="random">Random</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Directory</label>
                <input
                  type="text"
                  value={form.directory}
                  onChange={e => setForm(p => ({ ...p, directory: e.target.value }))}
                  placeholder={`/var/lib/freeswitch/recordings/${form.name || 'classname'}`}
                  className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50"
                />
                <p className="text-xs text-slate-500">Leave empty for default path</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {formMode === 'add' ? 'Create' : 'Save'}
              </button>
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
        }`} style={{ animation: 'slideInRight 0.3s ease-out' }}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <style>{`
        @keyframes slideInRight { from{transform:translateX(100%)} to{transform:translateX(0)} }
      `}</style>
    </div>
  );
}
