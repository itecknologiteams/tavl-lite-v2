import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTrunks, createTrunk, updateTrunk, deleteTrunk, extractError,
} from '../api';
import type { Trunk } from '../types';
import {
  Plus, Edit2, Trash2, Network, Loader2, X, ChevronRight, ChevronLeft,
  CheckCircle, XCircle, Server, Lock, AlertCircle, Phone,
} from 'lucide-react';

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrunkStatusBadge({ state }: { state?: string }) {
  const s = (state || '').toUpperCase();
  if (s.includes('REGED') || s.includes('REGISTERED')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Registered
      </span>
    );
  }
  if (s.includes('NOREG') || s === '') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        No Reg
      </span>
    );
  }
  if (s.includes('FAILED') || s.includes('ERROR') || s.includes('TIMEOUT')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-400 border border-slate-600/40">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      {state || '—'}
    </span>
  );
}

interface LabelProps { text: string; tip: string; required?: boolean; }

function Label({ text, tip, required }: LabelProps) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
      {text}
      {required && <span className="text-red-400">*</span>}
      <span
        className="w-4 h-4 rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold flex items-center justify-center cursor-help"
        title={tip}
      >
        ?
      </span>
    </label>
  );
}

const STEP_LABELS = ['Connection Type', 'SIP Details', 'Caller ID'];

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

// ─── Default form ─────────────────────────────────────────────────────────────

const defaultForm = (): Partial<Trunk> => ({
  name: '',
  proxy: '',
  port: 5060,
  register: false,
  username: '',
  password: '',
  profile: 'external',
  callerIdName: '',
  callerIdNumber: '',
  enabled: true,
});

// ─── Main Component ───────────────────────────────────────────────────────────

export function TrunksPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTrunk, setEditingTrunk] = useState<Trunk | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [form, setForm] = useState<Partial<Trunk>>(defaultForm());
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const { data: trunks = [], isLoading, isError } = useQuery<Trunk[]>({
    queryKey: ['trunks-v2'],
    queryFn: getTrunks,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: createTrunk,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trunks-v2'] });
      closeModal();
      toast('success', 'Trunk created successfully');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<Trunk> }) =>
      updateTrunk(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trunks-v2'] });
      closeModal();
      toast('success', 'Trunk updated successfully');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteTrunk,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trunks-v2'] });
      toast('success', 'Trunk deleted');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const openAdd = () => {
    setEditingTrunk(null);
    setForm(defaultForm());
    setWizardStep(1);
    setValidationErrors({});
    setModalOpen(true);
  };

  const openEdit = (trunk: Trunk) => {
    setEditingTrunk(trunk);
    setForm({ ...trunk });
    setWizardStep(2);
    setValidationErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTrunk(null);
    setWizardStep(1);
  };

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 2) {
      if (!form.name?.trim()) errs.name = 'Provider name is required';
      if (!form.proxy?.trim()) errs.proxy = 'Host/proxy is required';
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validateStep(2)) {
      if (wizardStep < 2) setWizardStep(2);
      return;
    }
    if (editingTrunk) {
      updateMut.mutate({ name: editingTrunk.name, data: form });
    } else {
      createMut.mutate(form);
    }
  };

  const handleDelete = (trunk: Trunk) => {
    if (!window.confirm(`Delete trunk "${trunk.name}"? This cannot be undone.`)) return;
    deleteMut.mutate(trunk.name);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Trunks</h1>
          <p className="text-slate-400 mt-1 font-medium">
            Manage SIP gateways and carrier connections
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Trunk
        </button>
      </div>

      {/* Table */}
      <div className="lg-card rounded-2xl overflow-hidden">
        {isLoading && (
          <div className="flex flex-col items-center justify-center p-20">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
            <p className="text-slate-400 font-medium text-sm">Loading trunks…</p>
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center p-20">
            <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
            <p className="text-white font-semibold mb-1">Failed to load trunks</p>
            <p className="text-slate-400 text-sm">Check server connection and try again</p>
          </div>
        )}
        {!isLoading && !isError && (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-900/40 border-b border-slate-700/50">
                <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">Name</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden md:table-cell">Host / Proxy</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden lg:table-cell">Profile</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden xl:table-cell text-center">Calls In/Out</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {trunks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-16 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800/50 mb-4">
                      <Network className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-1">No Trunks Configured</h3>
                    <p className="text-slate-400 text-sm mb-4">
                      Add a SIP trunk to connect to your carrier
                    </p>
                    <button
                      onClick={openAdd}
                      className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-all inline-flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Add First Trunk
                    </button>
                  </td>
                </tr>
              ) : (
                trunks.map((trunk) => (
                  <tr key={trunk.name} className="hover:bg-slate-700/10 transition-colors group">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20">
                          <Network className="w-4 h-4 text-teal-400" />
                        </div>
                        <div>
                          <p className="text-sm text-white font-semibold">{trunk.name}</p>
                          {trunk.description && (
                            <p className="text-xs text-slate-500 mt-0.5">{trunk.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <p className="text-sm text-slate-300 font-mono">{trunk.proxy}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Port {trunk.port || 5060}</p>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono">
                        {trunk.profile || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <TrunkStatusBadge state={trunk.state} />
                    </td>
                    <td className="px-4 py-4 hidden xl:table-cell text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <span className="text-slate-300 font-semibold">{trunk.callsIn ?? 0}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-slate-300 font-semibold">{trunk.callsOut ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(trunk)}
                          className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-white"
                          title="Edit trunk"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(trunk)}
                          className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-red-400"
                          title="Delete trunk"
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
        )}
      </div>

      {/* ─── Wizard Modal ─────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 flex-shrink-0">
              <h2 className="text-lg font-bold text-white">
                {editingTrunk ? `Edit Trunk: ${editingTrunk.name}` : 'New Trunk'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step indicator */}
            <div className="px-6 pt-4 flex-shrink-0">
              <StepIndicator step={editingTrunk ? 2 : wizardStep} />
            </div>

            {/* Step content */}
            <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">

              {/* Step 1: Connection Type (only for new trunks) */}
              {wizardStep === 1 && !editingTrunk && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400 mb-4">
                    Choose how your SIP provider authenticates your connection.
                  </p>

                  <button
                    onClick={() => { setForm({ ...form, register: false }); }}
                    className={`w-full p-4 rounded-xl border text-left transition-all flex items-start gap-4 ${
                      !form.register
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : 'border-slate-700/50 bg-slate-900/30 hover:border-slate-600'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl flex-shrink-0 ${
                      !form.register
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <p className={`text-sm font-bold mb-0.5 ${!form.register ? 'text-white' : 'text-slate-300'}`}>
                        IP / Peer Authentication
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        No registration needed. Your IP address is trusted by the provider.
                        Ideal for collocated carriers or private SIP servers.
                      </p>
                    </div>
                    {!form.register && (
                      <CheckCircle className="w-5 h-5 text-indigo-400 ml-auto flex-shrink-0 mt-0.5" />
                    )}
                  </button>

                  <button
                    onClick={() => { setForm({ ...form, register: true }); }}
                    className={`w-full p-4 rounded-xl border text-left transition-all flex items-start gap-4 ${
                      form.register
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : 'border-slate-700/50 bg-slate-900/30 hover:border-slate-600'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl flex-shrink-0 ${
                      form.register
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <p className={`text-sm font-bold mb-0.5 ${form.register ? 'text-white' : 'text-slate-300'}`}>
                        Username / Password Registration
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Registers with SIP credentials. Used by most hosted VoIP providers
                        (Twilio, VoIP.ms, SIPtrunk.com, etc.)
                      </p>
                    </div>
                    {form.register && (
                      <CheckCircle className="w-5 h-5 text-indigo-400 ml-auto flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                </div>
              )}

              {/* Step 2: SIP Details */}
              {(wizardStep === 2 || editingTrunk) && (
                <div className="space-y-4">
                  <div>
                    <Label
                      text="Provider Name"
                      required
                      tip="Unique name to identify this trunk. Use lowercase letters, numbers, and hyphens."
                    />
                    <input
                      type="text"
                      disabled={!!editingTrunk}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. my-carrier"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all disabled:opacity-40 font-mono"
                    />
                    {validationErrors.name && (
                      <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {validationErrors.name}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Label
                        text="Host / Proxy"
                        required
                        tip="Your SIP provider's IP address or domain name."
                      />
                      <input
                        type="text"
                        value={form.proxy}
                        onChange={(e) => setForm({ ...form, proxy: e.target.value })}
                        placeholder="sip.provider.com"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                      />
                      {validationErrors.proxy && (
                        <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {validationErrors.proxy}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label
                        text="Port"
                        tip="SIP signaling port — usually 5060 for UDP/TCP, 5061 for TLS."
                      />
                      <input
                        type="number"
                        value={form.port}
                        onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <Label
                      text="SIP Profile"
                      tip="FreeSWITCH SIP profile to use — 'external' for carrier trunks, 'internal' for on-site."
                    />
                    <select
                      value={form.profile}
                      onChange={(e) => setForm({ ...form, profile: e.target.value })}
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    >
                      <option value="external">external</option>
                      <option value="internal">internal</option>
                      <option value="default">default</option>
                    </select>
                  </div>

                  {form.register && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label
                          text="SIP Username"
                          tip="SIP username or account number provided by your carrier."
                        />
                        <input
                          type="text"
                          value={form.username}
                          onChange={(e) => setForm({ ...form, username: e.target.value })}
                          placeholder="account@provider"
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                        />
                      </div>
                      <div>
                        <Label
                          text="SIP Password"
                          tip="SIP authentication password from your carrier."
                        />
                        <input
                          type="password"
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          placeholder="••••••••"
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Caller ID */}
              {wizardStep === 3 && !editingTrunk && (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-700/30 flex items-start gap-3">
                    <Phone className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-slate-400">
                      Caller ID settings define what the recipient sees when calls are placed through this trunk.
                      Leave blank to use the extension's caller ID.
                    </p>
                  </div>

                  <div>
                    <Label
                      text="Caller ID Name"
                      tip="Name shown on outbound calls through this trunk (e.g. your company name)."
                    />
                    <input
                      type="text"
                      value={form.callerIdName}
                      onChange={(e) => setForm({ ...form, callerIdName: e.target.value })}
                      placeholder="Acme Corp"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    />
                  </div>

                  <div>
                    <Label
                      text="Caller ID Number"
                      tip="Phone number shown on outbound calls. Must be a number allocated to this trunk."
                    />
                    <input
                      type="text"
                      value={form.callerIdNumber}
                      onChange={(e) => setForm({ ...form, callerIdNumber: e.target.value })}
                      placeholder="+12125550100"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                    />
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
                {wizardStep > 1 && !editingTrunk && (
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
                  {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  {editingTrunk ? 'Save Changes' : 'Create Trunk'}
                </button>
                {wizardStep < 3 && !editingTrunk && (
                  <button
                    onClick={() => {
                      if (wizardStep === 2 && !validateStep(2)) return;
                      setWizardStep((s) => s + 1);
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

      <ToastContainer toasts={toasts} />
    </div>
  );
}
