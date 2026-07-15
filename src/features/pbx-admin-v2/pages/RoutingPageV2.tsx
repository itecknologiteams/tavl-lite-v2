import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRoutingConfig, saveRoutingConfig, reloadSystem, getQueues, getExtensions, getIvr,
  extractError,
} from '../api';
import type { InboundRoute, OutboundRoute, RoutingConfig } from '../types';
import {
  ArrowUpDown, Plus, Trash2, Loader2, Save, AlertCircle,
  CheckCircle, XCircle, Info, ToggleLeft, ToggleRight, ChevronDown, X,
  Edit2, Check,
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

const DEST_TYPE_LABELS: Record<string, string> = {
  queue: 'Queue',
  extension: 'Extension',
  ivr: 'IVR Menu',
  ringgroup: 'Ring Group',
};

function DestBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    queue: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    extension: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    ivr: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    ringgroup: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
        colors[type] || 'bg-slate-700/50 text-slate-400 border-slate-600/40'
      }`}
    >
      {DEST_TYPE_LABELS[type] || type}
    </span>
  );
}

const OUTBOUND_PRESETS = [
  { label: 'Local (7-digit)', pattern: '^(\\d{7})$', name: 'Local 7-digit' },
  { label: 'National (10-digit)', pattern: '^(\\d{10})$', name: 'National 10-digit' },
  { label: 'International (+1…)', pattern: '^\\+?1?(\\d{10})$', name: 'International +1' },
  { label: 'Emergency (911)', pattern: '^(911)$', name: 'Emergency 911' },
];

const newInboundRoute = (): Omit<InboundRoute, 'id'> => ({
  name: '',
  did: '',
  destination: '',
  destinationType: 'queue',
  enabled: true,
});

const newOutboundRoute = (): Omit<OutboundRoute, 'id'> => ({
  name: '',
  pattern: '',
  callerIdName: '',
  callerIdNumber: '',
  enabled: true,
});

// ─── Main Component ───────────────────────────────────────────────────────────

export function RoutingPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();

  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('inbound');
  const [localConfig, setLocalConfig] = useState<RoutingConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Inline add-form state
  const [showAddInbound, setShowAddInbound] = useState(false);
  const [showAddOutbound, setShowAddOutbound] = useState(false);
  const [addInboundForm, setAddInboundForm] = useState<Omit<InboundRoute, 'id'>>(newInboundRoute());
  const [addOutboundForm, setAddOutboundForm] = useState<Omit<OutboundRoute, 'id'>>(newOutboundRoute());
  const [inboundErrors, setInboundErrors] = useState<Record<string, string>>({});

  // ─── Queries ───────────────────────────────────────────────────────────────

  const configQ = useQuery({
    queryKey: ['routing-v2'],
    queryFn: getRoutingConfig,
    staleTime: 60_000,
  });

  const queuesQ = useQuery({ queryKey: ['queues-v2'], queryFn: getQueues, staleTime: 60_000 });
  const extensionsQ = useQuery({ queryKey: ['extensions-v2'], queryFn: getExtensions, staleTime: 60_000 });
  const ivrQ = useQuery({ queryKey: ['ivr-v2'], queryFn: getIvr, staleTime: 60_000 });

  // Sync loaded config into local state (once)
  useEffect(() => {
    if (configQ.data && !localConfig) {
      setLocalConfig({
        inboundRoutes: [...(configQ.data.config?.inboundRoutes || [])],
        outboundRoutes: [...(configQ.data.config?.outboundRoutes || [])],
      });
    }
  }, [configQ.data]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async (cfg: Partial<RoutingConfig>) => {
      await saveRoutingConfig(cfg);
      await reloadSystem();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routing-v2'] });
      setHasChanges(false);
      toast('success', 'Routing configuration saved and applied');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  // ─── Local state helpers ──────────────────────────────────────────────────

  const updateLocal = (cfg: Partial<RoutingConfig>) => {
    setLocalConfig((prev) => prev ? { ...prev, ...cfg } : null);
    setHasChanges(true);
  };

  const toggleInboundEnabled = (idx: number) => {
    if (!localConfig) return;
    const routes = localConfig.inboundRoutes.map((r, i) =>
      i === idx ? { ...r, enabled: !r.enabled } : r,
    );
    updateLocal({ inboundRoutes: routes });
  };

  const deleteInbound = (idx: number) => {
    if (!localConfig) return;
    const routes = localConfig.inboundRoutes.filter((_, i) => i !== idx);
    updateLocal({ inboundRoutes: routes });
  };

  const toggleOutboundEnabled = (idx: number) => {
    if (!localConfig) return;
    const routes = localConfig.outboundRoutes.map((r, i) =>
      i === idx ? { ...r, enabled: !r.enabled } : r,
    );
    updateLocal({ outboundRoutes: routes });
  };

  const deleteOutbound = (idx: number) => {
    if (!localConfig) return;
    const routes = localConfig.outboundRoutes.filter((_, i) => i !== idx);
    updateLocal({ outboundRoutes: routes });
  };

  const validateInbound = (): boolean => {
    const errs: Record<string, string> = {};
    if (!addInboundForm.name.trim()) errs.name = 'Route name is required';
    if (!addInboundForm.destination.trim()) errs.destination = 'Destination is required';
    setInboundErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitAddInbound = () => {
    if (!validateInbound() || !localConfig) return;
    const newRoute: InboundRoute = { ...addInboundForm, id: Date.now().toString() };
    updateLocal({ inboundRoutes: [...localConfig.inboundRoutes, newRoute] });
    setAddInboundForm(newInboundRoute());
    setShowAddInbound(false);
  };

  const addOutboundPreset = (preset: typeof OUTBOUND_PRESETS[0]) => {
    if (!localConfig) return;
    const newRoute: OutboundRoute = {
      id: Date.now().toString(),
      name: preset.name,
      pattern: preset.pattern,
      enabled: true,
    };
    updateLocal({ outboundRoutes: [...localConfig.outboundRoutes, newRoute] });
  };

  const submitAddOutbound = () => {
    if (!addOutboundForm.name.trim() || !addOutboundForm.pattern.trim() || !localConfig) return;
    const newRoute: OutboundRoute = { ...addOutboundForm, id: Date.now().toString() };
    updateLocal({ outboundRoutes: [...localConfig.outboundRoutes, newRoute] });
    setAddOutboundForm(newOutboundRoute());
    setShowAddOutbound(false);
  };

  // Editing state for existing inbound routes
  const [editingInboundIdx, setEditingInboundIdx] = useState<number | null>(null);

  // ─── Destination options for any destination type ──────────────────────────

  const destOptionsFor = (destType: string): string[] => {
    switch (destType) {
      case 'queue':
        return (queuesQ.data || []).map((q) => q.name);
      case 'extension':
        return (extensionsQ.data || []).map((e) => e.extension);
      case 'ivr':
        return (ivrQ.data?.ivrs || []).map((i) => i.name);
      case 'ringgroup':
        return [];
      default:
        return [];
    }
  };

  const destOptions = (): string[] => destOptionsFor(addInboundForm.destinationType);

  const updateInboundRoute = (idx: number, patch: Partial<InboundRoute>) => {
    if (!localConfig) return;
    const routes = localConfig.inboundRoutes.map((r, i) =>
      i === idx ? { ...r, ...patch } : r,
    );
    updateLocal({ inboundRoutes: routes });
  };

  // Editing state for existing outbound routes
  const [editingOutboundIdx, setEditingOutboundIdx] = useState<number | null>(null);

  const updateOutboundRoute = (idx: number, patch: Partial<OutboundRoute>) => {
    if (!localConfig) return;
    const routes = localConfig.outboundRoutes.map((r, i) =>
      i === idx ? { ...r, ...patch } : r,
    );
    updateLocal({ outboundRoutes: routes });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const isLoading = configQ.isLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Routing</h1>
          <p className="text-slate-400 mt-1 font-medium">
            Configure inbound and outbound call routing rules
          </p>
        </div>

        <button
          onClick={() => localConfig && saveMut.mutate(localConfig)}
          disabled={!hasChanges || saveMut.isPending}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            hasChanges
              ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white'
              : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
          }`}
          title="Save and immediately apply configuration to FreeSWITCH"
        >
          {saveMut.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {hasChanges ? 'Save & Apply' : 'No Changes'}
          {hasChanges && (
            <span className="w-2 h-2 rounded-full bg-amber-400 ml-0.5" />
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/40 border border-slate-700/40 rounded-xl w-fit">
        {(['inbound', 'outbound'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
              activeTab === tab
                ? 'lg-tab-active text-indigo-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab} Routes
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 font-medium text-sm">Loading routing configuration…</p>
        </div>
      )}

      {configQ.isError && (
        <div className="flex flex-col items-center justify-center p-16 lg-card rounded-2xl">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold mb-1">Failed to load routing config</p>
          <p className="text-slate-400 text-sm">Check server connection and try again</p>
        </div>
      )}

      {/* ─── Inbound Routes ─────────────────────────────────────────────────── */}
      {!isLoading && !configQ.isError && localConfig && activeTab === 'inbound' && (
        <div className="space-y-4">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
            <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-400">
              Inbound routes map incoming calls (DIDs) to destinations like queues, extensions, or IVR
              menus. A DID pattern can be a full number or a regex.
            </p>
          </div>

          {/* Route list */}
          <div className="space-y-3">
            {localConfig.inboundRoutes.length === 0 && !showAddInbound && (
              <div className="lg-card rounded-2xl p-14 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-800/50 mb-4">
                  <ArrowUpDown className="w-7 h-7 text-slate-500" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">No Inbound Routes</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Add a route to direct incoming calls to a destination
                </p>
                <button
                  onClick={() => setShowAddInbound(true)}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-all inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add First Route
                </button>
              </div>
            )}

            {localConfig.inboundRoutes.map((route, idx) => (
              <div
                key={route.id || idx}
                className={`lg-card rounded-xl p-4 transition-all ${
                  !route.enabled ? 'opacity-50' : ''
                }`}
              >
                {editingInboundIdx === idx ? (
                  /* ── Inline Edit Mode ── */
                  <div className="space-y-3 animate-fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label text="Route Name" required tip="Descriptive name for this route." />
                        <input
                          type="text"
                          value={route.name}
                          onChange={(e) => updateInboundRoute(idx, { name: e.target.value })}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                        />
                      </div>
                      <div>
                        <Label text="DID Pattern" tip="Incoming phone number or regex." />
                        <input
                          type="text"
                          value={route.did || ''}
                          onChange={(e) => updateInboundRoute(idx, { did: e.target.value })}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
                        />
                      </div>
                      <div>
                        <Label text="Destination Type" tip="Queue, Extension, IVR, or Ring Group." />
                        <div className="relative">
                          <select
                            value={route.destinationType}
                            onChange={(e) => updateInboundRoute(idx, {
                              destinationType: e.target.value as InboundRoute['destinationType'],
                              destination: '',
                            })}
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                          >
                            <option value="queue">Queue</option>
                            <option value="extension">Extension</option>
                            <option value="ivr">IVR Menu</option>
                            <option value="ringgroup">Ring Group</option>
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                        </div>
                      </div>
                      <div>
                        <Label text="Destination" required tip="Select the target." />
                        {destOptionsFor(route.destinationType).length > 0 ? (
                          <div className="relative">
                            <select
                              value={route.destination}
                              onChange={(e) => updateInboundRoute(idx, { destination: e.target.value })}
                              className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                            >
                              <option value="">— Select —</option>
                              {destOptionsFor(route.destinationType).map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={route.destination}
                            onChange={(e) => updateInboundRoute(idx, { destination: e.target.value })}
                            placeholder="Enter destination"
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => setEditingInboundIdx(null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" /> Done
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Display Mode ── */
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white truncate">{route.name}</p>
                        <DestBadge type={route.destinationType} />
                        {!route.enabled && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-500 border border-slate-600/40">
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                        {route.did && (
                          <span className="font-mono bg-slate-800/60 px-2 py-0.5 rounded text-slate-400">
                            {route.did}
                          </span>
                        )}
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-400">{route.destination}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setEditingInboundIdx(idx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 transition-all"
                        title="Edit route"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleInboundEnabled(idx)}
                        className={`p-1.5 rounded-lg transition-all ${
                          route.enabled
                            ? 'text-indigo-400 hover:text-indigo-300'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                        title={route.enabled ? 'Disable route' : 'Enable route'}
                      >
                        {route.enabled ? (
                          <ToggleRight className="w-5 h-5" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete inbound route "${route.name}"?`)) {
                            deleteInbound(idx);
                          }
                        }}
                        className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-red-400"
                        title="Delete route"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Inline Add Form */}
          {showAddInbound ? (
            <div className="lg-card rounded-2xl p-5 border border-indigo-500/20 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-white">Add Inbound Route</h3>
                <button
                  onClick={() => { setShowAddInbound(false); setInboundErrors({}); }}
                  className="p-1 rounded lg-icon-btn text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label
                    text="Route Name"
                    required
                    tip="Descriptive name for this route, e.g. 'Main Office Line'."
                  />
                  <input
                    type="text"
                    value={addInboundForm.name}
                    onChange={(e) => setAddInboundForm({ ...addInboundForm, name: e.target.value })}
                    placeholder="Main Office Line"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                  />
                  {inboundErrors.name && (
                    <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {inboundErrors.name}
                    </p>
                  )}
                </div>

                <div>
                  <Label
                    text="DID Pattern"
                    tip="The incoming phone number pattern. Can be exact (+12125551234) or a regex."
                  />
                  <input
                    type="text"
                    value={addInboundForm.did}
                    onChange={(e) => setAddInboundForm({ ...addInboundForm, did: e.target.value })}
                    placeholder="+12125551234"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                  />
                </div>

                <div>
                  <Label
                    text="Destination Type"
                    tip="The type of destination — queue for call center, extension for direct, IVR for menu."
                  />
                  <div className="relative">
                    <select
                      value={addInboundForm.destinationType}
                      onChange={(e) =>
                        setAddInboundForm({
                          ...addInboundForm,
                          destinationType: e.target.value as InboundRoute['destinationType'],
                          destination: '',
                        })
                      }
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all appearance-none"
                    >
                      <option value="queue">Queue</option>
                      <option value="extension">Extension</option>
                      <option value="ivr">IVR Menu</option>
                      <option value="ringgroup">Ring Group</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <Label
                    text="Destination"
                    required
                    tip="The specific destination target based on the selected type."
                  />
                  {destOptions().length > 0 ? (
                    <div className="relative">
                      <select
                        value={addInboundForm.destination}
                        onChange={(e) =>
                          setAddInboundForm({ ...addInboundForm, destination: e.target.value })
                        }
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all appearance-none"
                      >
                        <option value="">— Select —</option>
                        {destOptions().map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={addInboundForm.destination}
                      onChange={(e) =>
                        setAddInboundForm({ ...addInboundForm, destination: e.target.value })
                      }
                      placeholder="Enter destination name"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    />
                  )}
                  {inboundErrors.destination && (
                    <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {inboundErrors.destination}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-700/40">
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      addInboundForm.enabled ? 'bg-indigo-500' : 'bg-slate-700'
                    }`}
                    onClick={() =>
                      setAddInboundForm({ ...addInboundForm, enabled: !addInboundForm.enabled })
                    }
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        addInboundForm.enabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                  <span className="text-sm text-slate-300 font-medium select-none">Route Enabled</span>
                </label>
                <button
                  onClick={submitAddInbound}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
                >
                  <Plus className="w-4 h-4" /> Add Route
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddInbound(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-indigo-500/50 text-sm font-semibold transition-all w-full justify-center"
            >
              <Plus className="w-4 h-4" /> Add Inbound Route
            </button>
          )}
        </div>
      )}

      {/* ─── Outbound Routes ─────────────────────────────────────────────────── */}
      {!isLoading && !configQ.isError && localConfig && activeTab === 'outbound' && (
        <div className="space-y-4">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
            <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-400">
              Outbound routes define which calls go through which trunks based on dial patterns.
              Patterns are matched against the dialed number in order.
            </p>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider w-full">
              Quick pattern presets:
            </p>
            {OUTBOUND_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => addOutboundPreset(preset)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white hover:border-indigo-500/40 transition-all font-semibold"
                title={`Pattern: ${preset.pattern}`}
              >
                + {preset.label}
              </button>
            ))}
          </div>

          {/* Route list */}
          <div className="space-y-2">
            {localConfig.outboundRoutes.length === 0 && !showAddOutbound && (
              <div className="lg-card rounded-2xl p-14 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-800/50 mb-4">
                  <ArrowUpDown className="w-7 h-7 text-slate-500" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">No Outbound Routes</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Add a route to control which calls go through which trunks
                </p>
              </div>
            )}

            {localConfig.outboundRoutes.map((route, idx) => (
              <div
                key={route.id || idx}
                className={`lg-card rounded-xl p-4 transition-all ${
                  !route.enabled ? 'opacity-50' : ''
                }`}
              >
                {editingOutboundIdx === idx ? (
                  /* ── Inline Edit Mode ── */
                  <div className="space-y-3 animate-fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label text="Route Name" required tip="Descriptive name for this outbound route." />
                        <input
                          type="text"
                          value={route.name}
                          onChange={(e) => updateOutboundRoute(idx, { name: e.target.value })}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                        />
                      </div>
                      <div>
                        <Label text="Dial Pattern" required tip="Regex or exact number pattern." />
                        <input
                          type="text"
                          value={route.pattern}
                          onChange={(e) => updateOutboundRoute(idx, { pattern: e.target.value })}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
                        />
                      </div>
                      <div>
                        <Label text="Caller ID Name" tip="Override caller ID name." />
                        <input
                          type="text"
                          value={route.callerIdName || ''}
                          onChange={(e) => updateOutboundRoute(idx, { callerIdName: e.target.value })}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                        />
                      </div>
                      <div>
                        <Label text="Caller ID Number" tip="Override caller ID number." />
                        <input
                          type="text"
                          value={route.callerIdNumber || ''}
                          onChange={(e) => updateOutboundRoute(idx, { callerIdNumber: e.target.value })}
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => setEditingOutboundIdx(null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" /> Done
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Display Mode ── */
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white">{route.name}</p>
                        {!route.enabled && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-500 border border-slate-600/40">
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="font-mono bg-slate-800/60 px-2 py-0.5 rounded text-amber-400 border border-amber-500/20">
                          {route.pattern}
                        </span>
                        {route.callerIdName && (
                          <span className="text-slate-500">{route.callerIdName}</span>
                        )}
                        {route.callerIdNumber && (
                          <span className="font-mono text-slate-500">{route.callerIdNumber}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setEditingOutboundIdx(idx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 transition-all"
                        title="Edit route"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleOutboundEnabled(idx)}
                        className={`p-1.5 rounded-lg transition-all ${
                          route.enabled
                            ? 'text-indigo-400 hover:text-indigo-300'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                        title={route.enabled ? 'Disable route' : 'Enable route'}
                      >
                        {route.enabled ? (
                          <ToggleRight className="w-5 h-5" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete outbound route "${route.name}"?`)) {
                            deleteOutbound(idx);
                          }
                        }}
                        className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-red-400"
                        title="Delete route"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Inline Add Form */}
          {showAddOutbound ? (
            <div className="lg-card rounded-2xl p-5 border border-indigo-500/20 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-white">Add Outbound Route</h3>
                <button
                  onClick={() => setShowAddOutbound(false)}
                  className="p-1 rounded lg-icon-btn text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label
                    text="Route Name"
                    required
                    tip="Descriptive name for this outbound route."
                  />
                  <input
                    type="text"
                    value={addOutboundForm.name}
                    onChange={(e) => setAddOutboundForm({ ...addOutboundForm, name: e.target.value })}
                    placeholder="e.g. Local Calls"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                  />
                </div>

                <div>
                  <Label
                    text="Dial Pattern"
                    required
                    tip="Regular expression or exact number pattern matched against the dialed number."
                  />
                  <input
                    type="text"
                    value={addOutboundForm.pattern}
                    onChange={(e) =>
                      setAddOutboundForm({ ...addOutboundForm, pattern: e.target.value })
                    }
                    placeholder="^(\d{10})$"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                  />
                </div>

                <div>
                  <Label
                    text="Caller ID Name"
                    tip="Override caller ID name for calls matching this pattern."
                  />
                  <input
                    type="text"
                    value={addOutboundForm.callerIdName}
                    onChange={(e) =>
                      setAddOutboundForm({ ...addOutboundForm, callerIdName: e.target.value })
                    }
                    placeholder="Acme Corp"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                  />
                </div>

                <div>
                  <Label
                    text="Caller ID Number"
                    tip="Override caller ID number for calls matching this pattern."
                  />
                  <input
                    type="text"
                    value={addOutboundForm.callerIdNumber}
                    onChange={(e) =>
                      setAddOutboundForm({ ...addOutboundForm, callerIdNumber: e.target.value })
                    }
                    placeholder="+12125550100"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-700/40">
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      addOutboundForm.enabled ? 'bg-indigo-500' : 'bg-slate-700'
                    }`}
                    onClick={() =>
                      setAddOutboundForm({ ...addOutboundForm, enabled: !addOutboundForm.enabled })
                    }
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        addOutboundForm.enabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                  <span className="text-sm text-slate-300 font-medium select-none">Route Enabled</span>
                </label>
                <button
                  onClick={submitAddOutbound}
                  disabled={!addOutboundForm.name.trim() || !addOutboundForm.pattern.trim()}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" /> Add Route
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddOutbound(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-indigo-500/50 text-sm font-semibold transition-all w-full justify-center"
            >
              <Plus className="w-4 h-4" /> Add Outbound Route
            </button>
          )}
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
