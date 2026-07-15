import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFax, createFax, updateFax, deleteFax, getFaxFiles, deleteFaxFile, sendFax, extractError,
} from '../api';
import type { FaxConfig } from '../types';
import {
  FileText, Plus, Trash2, Edit2, Loader2, AlertCircle, CheckCircle, XCircle, X,
  Mail, Inbox, Send, Download, FolderOpen, ToggleLeft, ToggleRight,
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

// ─── Form Defaults ────────────────────────────────────────────────────────────

interface FaxForm {
  extension: string;
  name: string;
  email: string;
  callerIdNumber: string;
  callerIdName: string;
  description: string;
  enabled: boolean;
}

const defaultForm = (): FaxForm => ({
  extension: '', name: '', email: '', callerIdNumber: '', callerIdName: '', description: '', enabled: true,
});

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FaxPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [editModal, setEditModal] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<FaxForm>(defaultForm());
  const [editingExt, setEditingExt] = useState<string | null>(null);

  const [filesModal, setFilesModal] = useState<{ ext: string; type: 'inbox' | 'outbox' } | null>(null);
  const [sendModal, setSendModal] = useState<string | null>(null);
  const [sendDest, setSendDest] = useState('');
  const [sendHeader, setSendHeader] = useState('');
  const sendFileRef = useRef<HTMLInputElement>(null);

  const { data: faxItems = [], isLoading, isError } = useQuery<FaxConfig[]>({
    queryKey: ['fax-v2'],
    queryFn: getFax,
    staleTime: 30_000,
  });

  const { data: files = [], isLoading: filesLoading } = useQuery<any[]>({
    queryKey: ['fax-files-v2', filesModal?.ext, filesModal?.type],
    queryFn: () => getFaxFiles(filesModal!.ext, filesModal!.type),
    enabled: !!filesModal,
    staleTime: 10_000,
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<FaxConfig>) => createFax(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fax-v2'] }); toast('success', 'Fax extension created'); closeEdit(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ ext, data }: { ext: string; data: Partial<FaxConfig> }) => updateFax(ext, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fax-v2'] }); toast('success', 'Fax extension updated'); closeEdit(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteFax,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fax-v2'] }); toast('success', 'Fax extension deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteFileMut = useMutation({
    mutationFn: ({ ext, filename, type }: { ext: string; filename: string; type: 'inbox' | 'outbox' }) => deleteFaxFile(ext, filename, type),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fax-files-v2'] }); toast('success', 'File deleted'); },
    onError: (err) => toast('error', extractError(err)),
  });

  const sendMut = useMutation({
    mutationFn: ({ ext, destination, header, file }: { ext: string; destination: string; header: string; file: File }) => sendFax(ext, destination, header, file),
    onSuccess: () => { toast('success', 'Fax sent successfully'); closeSend(); },
    onError: (err) => toast('error', extractError(err)),
  });

  const closeEdit = useCallback(() => { setEditModal(null); setEditingExt(null); setForm(defaultForm()); }, []);
  const closeSend = useCallback(() => { setSendModal(null); setSendDest(''); setSendHeader(''); if (sendFileRef.current) sendFileRef.current.value = ''; }, []);

  const openAdd = () => { setForm(defaultForm()); setEditModal('add'); };

  const openEditFax = (fax: FaxConfig) => {
    setForm({
      extension: fax.extension,
      name: fax.name || '',
      email: fax.email || '',
      callerIdNumber: fax.callerIdNumber || '',
      callerIdName: fax.callerIdName || '',
      description: fax.description || '',
      enabled: fax.enabled !== false,
    });
    setEditingExt(fax.extension);
    setEditModal('edit');
  };

  const handleSave = () => {
    if (!form.extension.trim()) { toast('error', 'Extension is required'); return; }
    const payload: Partial<FaxConfig> = {
      extension: form.extension.trim(),
      name: form.name.trim() || undefined,
      email: form.email.trim() || undefined,
      callerIdNumber: form.callerIdNumber.trim() || undefined,
      callerIdName: form.callerIdName.trim() || undefined,
      description: form.description.trim() || undefined,
      enabled: form.enabled,
    };
    if (editModal === 'edit' && editingExt) {
      updateMut.mutate({ ext: editingExt, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const handleSendFax = () => {
    if (!sendModal) return;
    if (!sendDest.trim()) { toast('error', 'Destination number is required'); return; }
    const file = sendFileRef.current?.files?.[0];
    if (!file) { toast('error', 'Please select a file to send'); return; }
    sendMut.mutate({ ext: sendModal, destination: sendDest.trim(), header: sendHeader.trim(), file });
  };

  const saving = createMut.isPending || updateMut.isPending;
  const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all';
  const btnPrimary = 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Fax</h1>
          <p className="text-slate-400 mt-1 font-medium">Manage fax-over-IP extensions and send/receive faxes</p>
        </div>
        <button onClick={openAdd} className={`flex items-center gap-2 ${btnPrimary}`}>
          <Plus className="w-4 h-4" /> Add Fax Extension
        </button>
      </div>

      {/* Loading / Error / Empty */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading fax configurations…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load fax configurations</p>
        </div>
      )}
      {!isLoading && !isError && faxItems.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <FileText className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No Fax Extensions</h3>
          <p className="text-slate-400 text-sm mb-4">Configure fax extensions to send and receive faxes</p>
          <button onClick={openAdd} className={`inline-flex items-center gap-2 ${btnPrimary}`}>
            <Plus className="w-4 h-4" /> Add First Fax Extension
          </button>
        </div>
      )}

      {/* Fax extension cards */}
      {!isLoading && !isError && faxItems.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {faxItems.map((fax) => (
            <div key={fax.id || fax.extension} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6 group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <FileText className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-mono">{fax.extension}</h3>
                    {fax.name && <p className="text-xs text-slate-400">{fax.name}</p>}
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${fax.enabled !== false ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-700/50 text-slate-400 border-slate-600/40'}`}>
                  {fax.enabled !== false ? 'Active' : 'Disabled'}
                </span>
              </div>

              {fax.email && (
                <div className="flex items-center gap-1.5 text-sm text-slate-400 mb-3">
                  <Mail className="w-3.5 h-3.5" /> {fax.email}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-900/40 rounded-lg p-2.5 text-center border border-slate-700/30">
                  <p className="text-lg font-bold text-white">{fax.inboxCount ?? 0}</p>
                  <p className="text-xs text-slate-500">Inbox</p>
                </div>
                <div className="bg-slate-900/40 rounded-lg p-2.5 text-center border border-slate-700/30">
                  <p className="text-lg font-bold text-white">{fax.outboxCount ?? 0}</p>
                  <p className="text-xs text-slate-500">Outbox</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-700/40">
                <button onClick={() => setFilesModal({ ext: fax.extension, type: 'inbox' })} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors" title="View inbox">
                  <Inbox className="w-3.5 h-3.5" /> Inbox
                </button>
                <button onClick={() => setFilesModal({ ext: fax.extension, type: 'outbox' })} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors" title="View outbox">
                  <FolderOpen className="w-3.5 h-3.5" /> Outbox
                </button>
                <button onClick={() => setSendModal(fax.extension)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors" title="Send a fax">
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
                <div className="flex-1" />
                <button onClick={() => openEditFax(fax)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors" title="Edit fax extension">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { if (window.confirm(`Delete fax extension ${fax.extension}?`)) deleteMut.mutate(fax.extension); }} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete fax extension">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Add / Edit Modal ────────────────────────────────────────────── */}
      {editModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeEdit}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-700/50">
              <h2 className="text-lg font-bold text-white">{editModal === 'edit' ? 'Edit Fax Extension' : 'New Fax Extension'}</h2>
              <button onClick={closeEdit} className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Extension *</label>
                <input title="Fax extension number" className={inputCls} value={form.extension} disabled={editModal === 'edit'} onChange={(e) => setForm((f) => ({ ...f, extension: e.target.value }))} placeholder="e.g. 9000" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Name</label>
                <input title="Display name for this fax" className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Office Fax" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Email</label>
                <input title="Email to forward received faxes to" type="email" className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="fax@company.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1.5">Caller ID Number</label>
                  <input title="Outgoing caller ID number" className={inputCls} value={form.callerIdNumber} onChange={(e) => setForm((f) => ({ ...f, callerIdNumber: e.target.value }))} placeholder="e.g. 15551234567" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1.5">Caller ID Name</label>
                  <input title="Outgoing caller ID name" className={inputCls} value={form.callerIdName} onChange={(e) => setForm((f) => ({ ...f, callerIdName: e.target.value }))} placeholder="e.g. Office Fax" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Description</label>
                <textarea title="Description of this fax extension" className={`${inputCls} min-h-[72px] resize-y`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description…" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">Enabled</span>
                <button title="Toggle enabled" onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}>
                  {form.enabled ? <ToggleRight className="w-8 h-8 text-emerald-400" /> : <ToggleLeft className="w-8 h-8 text-slate-500" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t border-slate-700/50">
              <button onClick={closeEdit} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className={`${btnPrimary} disabled:opacity-50 flex items-center gap-2`}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editModal === 'edit' ? 'Save Changes' : 'Create Fax Extension'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Inbox / Outbox Modal ─────────────────────────────────────────── */}
      {filesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setFilesModal(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-700/50">
              <h2 className="text-lg font-bold text-white capitalize">{filesModal.type} — ext {filesModal.ext}</h2>
              <button onClick={() => setFilesModal(null)} className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6">
              {filesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-10">
                  <FolderOpen className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">No files in {filesModal.type}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {files.map((f: any) => {
                    const filename = typeof f === 'string' ? f : f.filename || f.name || 'unknown';
                    return (
                      <div key={filename} className="flex items-center justify-between bg-slate-900/50 border border-slate-700/40 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          <span className="text-sm text-white truncate">{filename}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => window.open(`/api/pbx-admin/fax/${filesModal.ext}/files/${filename}?type=${filesModal.type}`, '_blank')}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                            title="Download file"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { if (window.confirm(`Delete ${filename}?`)) deleteFileMut.mutate({ ext: filesModal.ext, filename, type: filesModal.type }); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Send Fax Modal ───────────────────────────────────────────────── */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeSend}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-700/50">
              <h2 className="text-lg font-bold text-white">Send Fax — ext {sendModal}</h2>
              <button onClick={closeSend} className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Destination Number *</label>
                <input title="Fax number to dial" className={inputCls} value={sendDest} onChange={(e) => setSendDest(e.target.value)} placeholder="e.g. 15559876543" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">Cover Page Header</label>
                <input title="Optional header text on the fax cover page" className={inputCls} value={sendHeader} onChange={(e) => setSendHeader(e.target.value)} placeholder="Optional header…" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">File *</label>
                <input title="Select a TIFF or PDF file to send" type="file" accept=".tiff,.tif,.pdf" ref={sendFileRef} className={`${inputCls} file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30`} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t border-slate-700/50">
              <button onClick={closeSend} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">Cancel</button>
              <button onClick={handleSendFax} disabled={sendMut.isPending} className={`${btnPrimary} disabled:opacity-50 flex items-center gap-2`}>
                {sendMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                <Send className="w-4 h-4" /> Send Fax
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
