import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getExtensions, createExtension, updateExtension, deleteExtension, bulkImportExtensions,
  extractError,
} from '../api';
import type { Extension } from '../types';
import {
  Plus, Edit2, Trash2, Upload, Users, Loader2, X, ChevronRight, ChevronLeft,
  CheckCircle, XCircle, Search, RefreshCw, Eye, EyeOff, AlertCircle, Mic, MicOff,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generatePassword(len = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map((b) => chars[b % chars.length])
    .join('');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastItem { id: string; type: 'success' | 'error'; msg: string; }

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
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${
            t.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {t.type === 'success' ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="text-sm font-medium">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Wizard form default ──────────────────────────────────────────────────────

const defaultForm = (): Partial<Extension> & { confirmPassword?: string } => ({
  extension: '',
  password: '',
  confirmPassword: '',
  callerIdName: '',
  callerIdNumber: '',
  email: '',
  ringDuration: 30,
  voicemailEnabled: true,
  callForwardEnabled: false,
  callForwardDest: '',
  dnd: false,
  callRecording: 'all',
  context: 'default',
  transport: 'udp',
  codecs: ['PCMU', 'PCMA'],
  maxContacts: 1,
  dtmfMode: 'rfc2833',
});

// ─── Wizard Steps ─────────────────────────────────────────────────────────────

const STEP_LABELS = ['Basic Info', 'Features', 'Advanced'];

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {done ? <CheckCircle className="w-3.5 h-3.5" /> : idx}
              </div>
              <span
                className={`text-xs font-semibold hidden sm:block ${
                  active ? 'text-white' : done ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-px ${done ? 'bg-emerald-500/50' : 'bg-slate-700/50'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

interface LabelProps {
  text: string;
  tip: string;
  required?: boolean;
}

function Label({ text, tip, required }: LabelProps) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
      {text}
      {required && <span className="text-red-400">*</span>}
      <span className="w-4 h-4 rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold flex items-center justify-center cursor-help" title={tip}>
        ?
      </span>
    </label>
  );
}

interface ToggleProps {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

function Toggle({ id, checked, onChange, label }: ToggleProps) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 cursor-pointer">
      <div
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-indigo-500' : 'bg-slate-700'
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </div>
      <span className="text-sm text-slate-300 font-medium select-none">{label}</span>
    </label>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExtensionsPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  // List state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExt, setEditingExt] = useState<Extension | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [form, setForm] = useState<ReturnType<typeof defaultForm>>(defaultForm());
  const [showPassword, setShowPassword] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Bulk import state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState('');
  const [bulkPreview, setBulkPreview] = useState<Partial<Extension>[]>([]);

  // Queries
  const { data: extensions = [], isLoading, isError } = useQuery<Extension[]>({
    queryKey: ['extensions-v2'],
    queryFn: getExtensions,
    staleTime: 30_000,
  });

  // Filtered + paginated
  const filtered = useMemo(() => {
    return extensions.filter((e) => {
      const matchSearch =
        !search ||
        e.extension.includes(search) ||
        (e.callerIdName || '').toLowerCase().includes(search.toLowerCase());
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'online' && e.registered) ||
        (statusFilter === 'offline' && !e.registered);
      return matchSearch && matchStatus;
    });
  }, [extensions, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Mutations
  const createMut = useMutation({
    mutationFn: createExtension,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-v2'] });
      closeModal();
      toast('success', 'Extension created successfully');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ ext, data }: { ext: string; data: Partial<Extension> }) =>
      updateExtension(ext, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-v2'] });
      closeModal();
      toast('success', 'Extension updated successfully');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteExtension,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-v2'] });
      toast('success', 'Extension deleted');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const bulkMut = useMutation({
    mutationFn: bulkImportExtensions,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['extensions-v2'] });
      setBulkModalOpen(false);
      setBulkCsv('');
      setBulkPreview([]);
      toast('success', `Imported ${data.imported ?? bulkPreview.length} extensions`);
    },
    onError: (err) => toast('error', extractError(err)),
  });

  // Helpers
  const openAdd = () => {
    setEditingExt(null);
    setForm(defaultForm());
    setWizardStep(1);
    setValidationErrors({});
    setModalOpen(true);
  };

  const openEdit = (ext: Extension) => {
    setEditingExt(ext);
    setForm({
      extension: ext.extension,
      password: ext.password || '',
      confirmPassword: '',
      callerIdName: ext.callerIdName || '',
      callerIdNumber: ext.callerIdNumber || '',
      email: ext.email || '',
      ringDuration: ext.ringDuration ?? 30,
      voicemailEnabled: ext.voicemailEnabled ?? true,
      callForwardEnabled: ext.callForwardEnabled ?? false,
      callForwardDest: ext.callForwardDest || '',
      dnd: ext.dnd ?? false,
      callRecording: ext.callRecording || 'all',
      context: ext.context || 'default',
      transport: ext.transport || 'udp',
      codecs: ext.codecs || ['PCMU', 'PCMA'],
      maxContacts: ext.maxContacts ?? 1,
      dtmfMode: ext.dtmfMode || 'rfc2833',
    });
    setWizardStep(1);
    setValidationErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingExt(null);
    setWizardStep(1);
  };

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 1) {
      if (!form.extension || form.extension.length < 3)
        errs.extension = 'Extension must be at least 3 digits';
      if (!editingExt && !form.password)
        errs.password = 'Password is required';
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validateStep(wizardStep)) return;
    const { confirmPassword, ...payload } = form;
    if (editingExt) {
      updateMut.mutate({ ext: editingExt.extension, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const handleDelete = (ext: Extension) => {
    if (!window.confirm(`Delete extension ${ext.extension}? This cannot be undone.`)) return;
    deleteMut.mutate(ext.extension);
  };

  const parseCsv = (csv: string): Partial<Extension>[] => {
    const lines = csv.trim().split('\n').filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    return lines.slice(1).map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      const obj: any = {};
      header.forEach((h, i) => { obj[h] = parts[i] || ''; });
      return {
        extension: obj.extension || obj.ext || obj.number || '',
        callerIdName: obj.name || obj.calleridname || obj.caller_id_name || '',
        password: obj.password || obj.pass || '',
        email: obj.email || '',
        context: obj.context || 'default',
      };
    });
  };

  const handleCsvChange = (csv: string) => {
    setBulkCsv(csv);
    try {
      setBulkPreview(parseCsv(csv));
    } catch {
      setBulkPreview([]);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Extensions</h1>
          <p className="text-slate-400 mt-1 font-medium">
            Manage SIP endpoints, credentials, and features
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setBulkModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:text-white hover:bg-slate-700 text-sm font-semibold transition-all"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            Add Extension
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by extension or name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'online', 'offline'] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setStatusFilter(f); setPage(0); }}
              className={`px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                statusFilter === f
                  ? 'lg-tab-active text-indigo-300'
                  : 'lg-tab text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="lg-card rounded-2xl overflow-hidden">
        {isLoading && (
          <div className="flex flex-col items-center justify-center p-20">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
            <p className="text-slate-400 font-medium text-sm">Loading extensions…</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center p-20">
            <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
            <p className="text-white font-semibold mb-1">Failed to load extensions</p>
            <p className="text-slate-400 text-sm">Check server connection and try again</p>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900/40 border-b border-slate-700/50">
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest w-8" />
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">Extension</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden md:table-cell">Display Name</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden lg:table-cell">Context</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">Registration</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden lg:table-cell">Recording</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden xl:table-cell">Codecs</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {pageData.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-16 text-center">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800/50 mb-4">
                        <Users className="w-8 h-8 text-slate-500" />
                      </div>
                      <h3 className="text-lg font-semibold text-white mb-1">
                        {search || statusFilter !== 'all' ? 'No matching extensions' : 'No Extensions Configured'}
                      </h3>
                      <p className="text-slate-400 text-sm mb-4">
                        {search || statusFilter !== 'all'
                          ? 'Try adjusting your search or filter'
                          : 'Add your first extension to start routing calls'}
                      </p>
                      {!search && statusFilter === 'all' && (
                        <button
                          onClick={openAdd}
                          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-all inline-flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> Add First Extension
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  pageData.map((ext) => (
                    <tr key={ext.id} className="hover:bg-slate-700/10 transition-colors group">
                      <td className="px-4 py-3">
                        <span
                          className={`w-2 h-2 rounded-full inline-block ${
                            ext.registered ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                      </td>
                      <td className="px-4 py-3 text-white font-mono font-semibold text-sm">
                        {ext.extension}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-sm hidden md:table-cell">
                        {ext.callerIdName || '—'}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono">
                          {ext.context}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                            ext.registered
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-slate-700/40 text-slate-400 border-slate-600/30'
                          }`}
                        >
                          {ext.registered ? 'Registered' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {ext.callRecording && ext.callRecording !== 'disabled' ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-semibold capitalize">
                            <Mic className="w-3 h-3" />
                            {ext.callRecording}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-500 border border-slate-600/30">
                            <MicOff className="w-3 h-3" />
                            Off
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {(ext.codecs || []).map((c) => (
                            <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 font-mono">
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(ext)}
                            className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-white"
                            title="Edit extension"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(ext)}
                            className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-red-400"
                            title="Delete extension"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/40">
                <p className="text-xs text-slate-500">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
                  {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 lg-icon-btn"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-400 font-semibold">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 lg-icon-btn"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Wizard Modal ─────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-xl bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 flex-shrink-0">
              <h2 className="text-lg font-bold text-white">
                {editingExt ? `Edit Extension ${editingExt.extension}` : 'New Extension'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Indicator */}
            <div className="px-6 pt-4 flex-shrink-0">
              <StepIndicator step={wizardStep} />
            </div>

            {/* Step Content */}
            <div className="flex-1 overflow-y-auto px-6 pb-4">

              {/* Step 1: Basic Info */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <Label
                      text="Extension Number"
                      required
                      tip="The SIP extension number. Users will dial this to reach the phone."
                    />
                    <input
                      type="text"
                      disabled={!!editingExt}
                      value={form.extension}
                      onChange={(e) => setForm({ ...form, extension: e.target.value })}
                      placeholder="e.g. 1001"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all disabled:opacity-40 font-mono"
                    />
                    {validationErrors.extension && (
                      <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {validationErrors.extension}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label
                      text="Display Name"
                      tip="The caller ID name shown when this extension makes a call."
                    />
                    <input
                      type="text"
                      value={form.callerIdName}
                      onChange={(e) => setForm({ ...form, callerIdName: e.target.value })}
                      placeholder="e.g. John Smith"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    />
                  </div>

                  <div>
                    <Label
                      text="SIP Password"
                      required={!editingExt}
                      tip="SIP authentication password for the phone device. Use a strong random password."
                    />
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          placeholder={editingExt ? '(leave blank to keep current)' : 'Enter password'}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, password: generatePassword() })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:text-white text-xs font-semibold transition-all whitespace-nowrap"
                        title="Generate a random secure password"
                      >
                        <RefreshCw className="w-3 h-3" /> Generate
                      </button>
                    </div>
                    {validationErrors.password && (
                      <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {validationErrors.password}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label
                      text="Email Address"
                      tip="Email address for voicemail notifications. Optional."
                    />
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="user@example.com"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Features */}
              {wizardStep === 2 && (
                <div className="space-y-5">
                  <div>
                    <Label
                      text={`Ring Duration: ${form.ringDuration}s`}
                      tip="How long the phone rings before going to voicemail or the next destination."
                    />
                    <input
                      type="range"
                      min={10}
                      max={60}
                      step={5}
                      value={form.ringDuration}
                      onChange={(e) => setForm({ ...form, ringDuration: Number(e.target.value) })}
                      className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-slate-500 mt-1">
                      <span>10s</span>
                      <span>60s</span>
                    </div>
                  </div>

                  <div>
                    <Label
                      text="Call Recording"
                      tip="Record calls for this extension. 'All' records both inbound and outbound. Choose a direction or disable entirely."
                    />
                    <select
                      value={form.callRecording || 'all'}
                      onChange={(e) => setForm({ ...form, callRecording: e.target.value as Extension['callRecording'] })}
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    >
                      <option value="all">All Calls (Inbound + Outbound)</option>
                      <option value="inbound">Inbound Only</option>
                      <option value="outbound">Outbound Only</option>
                      <option value="local">Local Only</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-700/50 space-y-4">
                    <div title="Enable voicemail for missed calls on this extension.">
                      <Toggle
                        id="voicemail"
                        checked={form.voicemailEnabled ?? true}
                        onChange={(v) => setForm({ ...form, voicemailEnabled: v })}
                        label="Voicemail"
                      />
                      <p className="text-xs text-slate-500 mt-1 ml-[52px]">
                        Enable voicemail for missed calls
                      </p>
                    </div>

                    <div>
                      <div title="Forward all calls to another number or extension.">
                        <Toggle
                          id="callForward"
                          checked={form.callForwardEnabled ?? false}
                          onChange={(v) => setForm({ ...form, callForwardEnabled: v })}
                          label="Call Forwarding"
                        />
                      </div>
                      {form.callForwardEnabled && (
                        <div className="mt-2 ml-[52px]">
                          <input
                            type="text"
                            value={form.callForwardDest}
                            onChange={(e) => setForm({ ...form, callForwardDest: e.target.value })}
                            placeholder="Forward to number or extension"
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                          />
                        </div>
                      )}
                    </div>

                    <div title="Block all incoming calls to this extension (Do Not Disturb).">
                      <Toggle
                        id="dnd"
                        checked={form.dnd ?? false}
                        onChange={(v) => setForm({ ...form, dnd: v })}
                        label="Do Not Disturb (DND)"
                      />
                      <p className="text-xs text-slate-500 mt-1 ml-[52px]">
                        Block all incoming calls to this extension
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Advanced */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label
                        text="Context"
                        tip="The dialplan context — use 'public' for external calls, 'default' for internal."
                      />
                      <select
                        value={form.context}
                        onChange={(e) => setForm({ ...form, context: e.target.value })}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      >
                        <option value="default">default</option>
                        <option value="public">public</option>
                        <option value="internal">internal</option>
                      </select>
                    </div>

                    <div>
                      <Label
                        text="Transport"
                        tip="SIP transport protocol — UDP is standard, TLS is encrypted."
                      />
                      <select
                        value={form.transport}
                        onChange={(e) => setForm({ ...form, transport: e.target.value })}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      >
                        <option value="udp">UDP</option>
                        <option value="tcp">TCP</option>
                        <option value="tls">TLS</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <Label
                      text="Codecs"
                      tip="Audio codecs supported by this extension — PCMU/PCMA are standard for most phones."
                    />
                    <div className="flex flex-wrap gap-2 mt-1">
                      {['PCMU', 'PCMA', 'G722', 'G729', 'OPUS'].map((codec) => {
                        const selected = (form.codecs || []).includes(codec);
                        return (
                          <button
                            key={codec}
                            type="button"
                            onClick={() => {
                              const current = form.codecs || [];
                              setForm({
                                ...form,
                                codecs: selected
                                  ? current.filter((c) => c !== codec)
                                  : [...current, codec],
                              });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all border ${
                              selected
                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}
                          >
                            {codec}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label
                        text="Max Contacts"
                        tip="Maximum simultaneous device registrations for this extension."
                      />
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={form.maxContacts}
                        onChange={(e) => setForm({ ...form, maxContacts: Number(e.target.value) })}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      />
                    </div>

                    <div>
                      <Label
                        text="DTMF Mode"
                        tip="How tone keypresses are sent — RFC2833 is standard for most phones."
                      />
                      <select
                        value={form.dtmfMode}
                        onChange={(e) => setForm({ ...form, dtmfMode: e.target.value })}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      >
                        <option value="rfc2833">RFC2833 (standard)</option>
                        <option value="inband">Inband</option>
                        <option value="info">SIP INFO</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/50 flex-shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                {wizardStep > 1 && (
                  <button
                    onClick={() => setWizardStep((s) => s - 1)}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white text-sm font-semibold transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {editingExt ? 'Save Changes' : 'Create Extension'}
                </button>
                {wizardStep < 3 && (
                  <button
                    onClick={() => {
                      if (validateStep(wizardStep)) setWizardStep((s) => s + 1);
                    }}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white text-sm font-semibold transition-all"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Bulk Import Modal ────────────────────────────────────────────────── */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 flex-shrink-0">
              <h2 className="text-lg font-bold text-white">Bulk Import Extensions</h2>
              <button
                onClick={() => { setBulkModalOpen(false); setBulkCsv(''); setBulkPreview([]); }}
                className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-xs text-slate-400">
                <p className="font-semibold text-indigo-300 mb-1">CSV Format</p>
                <p className="font-mono">extension,name,password,email,context</p>
                <p className="font-mono text-slate-500 mt-0.5">1001,John Smith,p@ss123,john@acme.com,default</p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Paste CSV Data
                </label>
                <textarea
                  rows={6}
                  value={bulkCsv}
                  onChange={(e) => handleCsvChange(e.target.value)}
                  placeholder="extension,name,password,email,context&#10;1001,John Smith,pass123,john@example.com,default&#10;1002,Jane Doe,pass456,,default"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all resize-none"
                />
              </div>

              {bulkPreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Preview — {bulkPreview.length} extension{bulkPreview.length !== 1 ? 's' : ''}
                  </p>
                  <div className="rounded-xl overflow-hidden border border-slate-700/50">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-900/50">
                          <th className="px-3 py-2 text-xs font-bold text-slate-500">Extension</th>
                          <th className="px-3 py-2 text-xs font-bold text-slate-500">Name</th>
                          <th className="px-3 py-2 text-xs font-bold text-slate-500">Email</th>
                          <th className="px-3 py-2 text-xs font-bold text-slate-500">Context</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {bulkPreview.slice(0, 10).map((e, i) => (
                          <tr key={i} className="text-sm">
                            <td className="px-3 py-2 text-white font-mono">{e.extension}</td>
                            <td className="px-3 py-2 text-slate-300">{e.callerIdName || '—'}</td>
                            <td className="px-3 py-2 text-slate-400 text-xs">{e.email || '—'}</td>
                            <td className="px-3 py-2 text-slate-400 text-xs font-mono">{e.context || 'default'}</td>
                          </tr>
                        ))}
                        {bulkPreview.length > 10 && (
                          <tr>
                            <td colSpan={4} className="px-3 py-2 text-xs text-slate-500 text-center">
                              + {bulkPreview.length - 10} more…
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/50 flex-shrink-0">
              <button
                onClick={() => { setBulkModalOpen(false); setBulkCsv(''); setBulkPreview([]); }}
                className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => bulkMut.mutate(bulkPreview)}
                disabled={bulkPreview.length === 0 || bulkMut.isPending}
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
              >
                {bulkMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Import {bulkPreview.length} Extension{bulkPreview.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
