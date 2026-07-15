import React, { useEffect, useState } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import { useConfigStore } from '../stores/configStore';
import {
  Plus, Edit2, Trash2, CheckCircle, Network, Save, X,
  RefreshCw, Server, Info, Globe, ChevronRight,
  ChevronLeft, AlertCircle, Lock,
} from 'lucide-react';

interface Trunk {
  name: string;
  host: string;
  proxy: string;
  fromDomain: string;
  context: string;
  allow: string;
  transport: string;
  qualifyFrequency: string;
  qualifyStatus?: string;
  fsState?: string;
  rtt?: string;
  id?: string;
  port?: number;
  username?: string;
  register?: boolean;
  enabled?: boolean;
  profile?: string;
  callsIn?: number;
  callsOut?: number;
  fromUser?: string;
  callerIdInFrom?: boolean;
  description?: string;
}

type ConnectionType = 'ip' | 'registration';

interface WizardFormData {
  connectionType: ConnectionType;
  providerName: string;
  providerHost: string;
  port: string;
  profile: string;
  username: string;
  password: string;
  callerIdName: string;
  callerIdNumber: string;
  useForAllOutbound: boolean;
}

const defaultWizardForm: WizardFormData = {
  connectionType: 'ip',
  providerName: '',
  providerHost: '',
  port: '5060',
  profile: 'external',
  username: '',
  password: '',
  callerIdName: '',
  callerIdNumber: '',
  useForAllOutbound: false,
};

const SIP_PROFILES = [
  { value: 'external', label: 'External (Default)' },
  { value: 'wan', label: 'WAN (Provider-facing)' },
  { value: 'internal', label: 'Internal (LAN)' },
];

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block">
      <Info className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 cursor-help" />
      <span className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded shadow-lg whitespace-nowrap max-w-xs">{text}</span>
    </span>
  );
}

export function TrunksPage() {
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardMode, setWizardMode] = useState<'add' | 'edit'>('add');
  const [wizardStep, setWizardStep] = useState(1);
  const [formData, setFormData] = useState<WizardFormData>({ ...defaultWizardForm });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { addChange } = useConfigStore();

  useEffect(() => { fetchTrunks(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchTrunks = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/trunks');
      const data = await res.json();
      if (data.success) setTrunks(data.trunks);
    } catch (err) {
      console.error('Failed to fetch trunks:', err);
    } finally {
      setLoading(false);
    }
  };

  const openWizard = async (mode: 'add' | 'edit', trunk?: Trunk) => {
    setWizardMode(mode);
    setWizardStep(mode === 'edit' ? 2 : 1);

    if (mode === 'edit' && trunk) {
      const isRegistration = !!trunk.register;
      setFormData({
        connectionType: isRegistration ? 'registration' : 'ip',
        providerName: trunk.name,
        providerHost: trunk.host || trunk.proxy || '',
        port: String(trunk.port || 5060),
        profile: trunk.profile || 'external',
        username: trunk.username || '',
        password: '',
        callerIdName: trunk.description || '',
        callerIdNumber: trunk.fromUser || '',
        useForAllOutbound: !!trunk.callerIdInFrom,
      });
    } else {
      setFormData({ ...defaultWizardForm });
    }
    setShowWizard(true);
  };

  const buildPayload = () => {
    const isRegistration = formData.connectionType === 'registration';
    return {
      name: formData.providerName,
      proxy: formData.providerHost,
      port: parseInt(formData.port) || 5060,
      username: isRegistration ? formData.username : '',
      password: isRegistration && formData.password ? formData.password : undefined,
      register: isRegistration,
      callerIdInFrom: formData.useForAllOutbound,
      profile: formData.profile,
      enabled: true,
      description: formData.callerIdName || formData.providerName,
      context: 'public',
      fromUser: formData.callerIdNumber || '',
      fromDomain: formData.providerHost || '',
    };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();

      if (wizardMode === 'add') {
        const res = await adminApi('/trunks', { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
          addChange({ type: 'trunk', name: formData.providerName, action: 'create', data: payload });
          setShowWizard(false);
          setToast({ type: 'success', message: `Provider "${formData.providerName}" created and applied to FreeSWITCH` });
          await fetchTrunks();
        } else {
          setToast({ type: 'error', message: data.error });
        }
      } else {
        const res = await adminApi(`/trunks/${formData.providerName}`, { method: 'PUT', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
          addChange({ type: 'trunk', name: formData.providerName, action: 'update', data: payload });
          setShowWizard(false);
          setToast({ type: 'success', message: `Provider "${formData.providerName}" updated and applied to FreeSWITCH` });
          await fetchTrunks();
        } else {
          setToast({ type: 'error', message: data.error });
        }
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to save provider connection' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (trunk: Trunk) => {
    if (!confirm(`Delete provider "${trunk.name}"?\n\nThis will remove the connection permanently.`)) return;
    try {
      const res = await adminApi(`/trunks/${trunk.name}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        addChange({ type: 'trunk', name: trunk.name, action: 'delete', data: trunk });
        setToast({ type: 'success', message: `Provider "${trunk.name}" deleted` });
        fetchTrunks();
      } else {
        setToast({ type: 'error', message: data.error });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete provider' });
    }
  };

  const canAdvance = (step: number): boolean => {
    if (step === 1) return true;
    if (step === 2) {
      if (!formData.providerName.trim() || !formData.providerHost.trim()) return false;
      if (formData.connectionType === 'registration' && (!formData.username.trim() || !formData.password.trim())) return false;
      return true;
    }
    return true;
  };

  const statusLabel = (trunk: Trunk) => {
    if (trunk.qualifyStatus === 'available') return { text: 'Online', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    if (trunk.qualifyStatus === 'unknown') return { text: 'Pending', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    return { text: 'Offline', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
  };

  const statusDot = (trunk: Trunk) => {
    if (trunk.qualifyStatus === 'available') return 'bg-emerald-400 animate-pulse';
    if (trunk.qualifyStatus === 'unknown') return 'bg-amber-400';
    return 'bg-red-400';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Provider Connections</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your SIP provider trunks for inbound and outbound calls</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchTrunks}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => openWizard('add')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium">
            <Plus className="w-4 h-4" /> New Provider
          </button>
        </div>
      </div>

      {/* Provider List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      ) : trunks.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-800/40 border border-slate-700/50 rounded-xl">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No provider connections configured</p>
          <p className="text-xs text-slate-600 mt-1">Add a provider to start making and receiving calls</p>
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-800/60">
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Provider Name</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Host / IP</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Profile</th>
                <th className="text-center py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Calls In</th>
                <th className="text-center py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Calls Out</th>
                <th className="text-right py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {trunks.map(trunk => {
                const status = statusLabel(trunk);
                return (
                  <tr key={trunk.name} className="hover:bg-slate-700/20 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          trunk.qualifyStatus === 'available' ? 'bg-emerald-500/15' : 'bg-slate-700/50'
                        }`}>
                          <Server className={`w-4 h-4 ${trunk.qualifyStatus === 'available' ? 'text-emerald-400' : 'text-slate-500'}`} />
                        </div>
                        <div>
                          <span className="text-white font-medium text-sm block">{trunk.name}</span>
                          <span className="text-xs text-slate-500">{trunk.register ? 'Registered' : 'IP-Based'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300 text-sm font-mono">{trunk.host || trunk.proxy || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${status.cls}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusDot(trunk)}`} />
                        {status.text}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs bg-slate-700/40 text-slate-400 px-2 py-0.5 rounded">{trunk.profile || 'external'}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-sm text-slate-300 tabular-nums">{trunk.callsIn ?? 0}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-sm text-slate-300 tabular-nums">{trunk.callsOut ?? 0}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openWizard('edit', trunk)}
                          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all" title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(trunk)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
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

      {/* Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowWizard(false)} />
          <div className="relative w-full max-w-xl bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" style={{ animation: 'fadeScaleIn 0.2s ease-out' }}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {wizardMode === 'add' ? 'Add Provider Connection' : `Edit: ${formData.providerName}`}
                </h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Step {wizardStep} of 3 &mdash; {wizardStep === 1 ? 'Connection Type' : wizardStep === 2 ? 'Connection Details' : 'Caller ID'}
                </p>
              </div>
              <button onClick={() => setShowWizard(false)} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-1 px-6 pt-4">
              {[1, 2, 3].map(s => (
                <div key={s} className={`h-1 flex-1 rounded-full transition-all ${
                  s <= wizardStep ? 'bg-emerald-500' : 'bg-slate-700'
                }`} />
              ))}
            </div>

            {/* Step Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Step 1: Connection Type */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-300">How does your provider authenticate you?</p>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setFormData(prev => ({ ...prev, connectionType: 'ip' }))}
                      className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all text-center cursor-pointer ${
                        formData.connectionType === 'ip'
                          ? 'border-emerald-500 bg-emerald-500/5 shadow-lg shadow-emerald-500/10'
                          : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
                      }`}
                    >
                      {formData.connectionType === 'ip' && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle className="w-5 h-5 text-emerald-400" />
                        </div>
                      )}
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        formData.connectionType === 'ip' ? 'bg-emerald-500/15' : 'bg-slate-700/50'
                      }`}>
                        <Globe className={`w-6 h-6 ${formData.connectionType === 'ip' ? 'text-emerald-400' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className={`font-semibold text-sm ${formData.connectionType === 'ip' ? 'text-emerald-300' : 'text-white'}`}>IP-Based</p>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">Your provider whitelists your IP address &mdash; no login needed</p>
                      </div>
                    </button>
                    <button
                      onClick={() => setFormData(prev => ({ ...prev, connectionType: 'registration' }))}
                      className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all text-center cursor-pointer ${
                        formData.connectionType === 'registration'
                          ? 'border-emerald-500 bg-emerald-500/5 shadow-lg shadow-emerald-500/10'
                          : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
                      }`}
                    >
                      {formData.connectionType === 'registration' && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle className="w-5 h-5 text-emerald-400" />
                        </div>
                      )}
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        formData.connectionType === 'registration' ? 'bg-emerald-500/15' : 'bg-slate-700/50'
                      }`}>
                        <Lock className={`w-6 h-6 ${formData.connectionType === 'registration' ? 'text-emerald-400' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className={`font-semibold text-sm ${formData.connectionType === 'registration' ? 'text-emerald-300' : 'text-white'}`}>Registration</p>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">You register with a username and password</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Connection Details */}
              {wizardStep === 2 && (
                <div className="space-y-5">
                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Provider Name <span className="text-red-400 ml-0.5">*</span>
                      <Tooltip text="A friendly name for this provider (e.g. my-voip-provider)" />
                    </label>
                    <input
                      type="text"
                      value={formData.providerName}
                      onChange={e => setFormData(prev => ({ ...prev, providerName: e.target.value }))}
                      placeholder="e.g., my-voip-provider"
                      disabled={wizardMode === 'edit'}
                      className={`fi ${wizardMode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      {formData.connectionType === 'ip' ? 'Provider IP Address' : 'Provider Hostname'} <span className="text-red-400 ml-0.5">*</span>
                      <Tooltip text={formData.connectionType === 'ip' ? 'The IP address of your SIP provider' : 'The hostname or IP of your SIP registration server'} />
                    </label>
                    <input
                      type="text"
                      value={formData.providerHost}
                      onChange={e => setFormData(prev => ({ ...prev, providerHost: e.target.value }))}
                      placeholder={formData.connectionType === 'ip' ? 'e.g., 10.200.174.222' : 'e.g., sip.provider.com'}
                      className="fi"
                    />
                  </div>

                  {formData.connectionType === 'registration' && (
                    <>
                      <div>
                        <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                          Username <span className="text-red-400 ml-0.5">*</span>
                          <Tooltip text="The SIP username your provider gave you for registration" />
                        </label>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                          placeholder="SIP username"
                          className="fi"
                        />
                      </div>
                      <div>
                        <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                          Password <span className="text-red-400 ml-0.5">*</span>
                          <Tooltip text="The SIP password for authenticating with the provider" />
                        </label>
                        <input
                          type="password"
                          value={formData.password}
                          onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                          placeholder="SIP password"
                          className="fi"
                        />
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                        Port
                        <Tooltip text="SIP signaling port — usually 5060 for UDP/TCP or 5061 for TLS" />
                      </label>
                      <input
                        type="number"
                        value={formData.port}
                        onChange={e => setFormData(prev => ({ ...prev, port: e.target.value }))}
                        placeholder="5060"
                        className="fi"
                      />
                    </div>
                    <div>
                      <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                        SIP Profile
                        <Tooltip text="Which network interface this provider connects through" />
                      </label>
                      <select
                        value={formData.profile}
                        onChange={e => setFormData(prev => ({ ...prev, profile: e.target.value }))}
                        className="fi"
                      >
                        {SIP_PROFILES.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Caller ID */}
              {wizardStep === 3 && (
                <div className="space-y-5">
                  <p className="text-sm text-slate-300">Set the caller ID that recipients will see when you make outbound calls through this provider.</p>
                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Caller ID Name
                      <Tooltip text="The name shown to the person you're calling (your provider may override this)" />
                    </label>
                    <input
                      type="text"
                      value={formData.callerIdName}
                      onChange={e => setFormData(prev => ({ ...prev, callerIdName: e.target.value }))}
                      placeholder="e.g., My Company"
                      className="fi"
                    />
                  </div>
                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Caller ID Number
                      <Tooltip text="The phone number shown to the person you're calling" />
                    </label>
                    <input
                      type="text"
                      value={formData.callerIdNumber}
                      onChange={e => setFormData(prev => ({ ...prev, callerIdNumber: e.target.value }))}
                      placeholder="e.g., 02138658849"
                      className="fi"
                    />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-white">Use for all outbound calls</p>
                      <p className="text-xs text-slate-500 mt-0.5">Send this caller ID on every outgoing call from this provider</p>
                    </div>
                    <button
                      onClick={() => setFormData(prev => ({ ...prev, useForAllOutbound: !prev.useForAllOutbound }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${formData.useForAllOutbound ? 'bg-emerald-500' : 'bg-slate-600'}`}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.useForAllOutbound ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Summary */}
                  <div className="mt-2 p-4 bg-slate-900/40 border border-slate-700/40 rounded-xl">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Summary</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Provider</span>
                        <span className="text-white font-medium">{formData.providerName || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Host</span>
                        <span className="text-white font-mono text-xs">{formData.providerHost || '—'}:{formData.port}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Auth</span>
                        <span className="text-white">{formData.connectionType === 'registration' ? `Registration (${formData.username})` : 'IP-Based'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Profile</span>
                        <span className="text-white">{SIP_PROFILES.find(p => p.value === formData.profile)?.label || formData.profile}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer with navigation */}
            <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/80 rounded-b-2xl flex items-center justify-between">
              <div>
                {wizardStep > 1 && (
                  <button
                    onClick={() => setWizardStep(s => s - 1)}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-all flex items-center gap-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back
                  </button>
                )}
                {wizardStep === 1 && (
                  <button onClick={() => setShowWizard(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-all">
                    Cancel
                  </button>
                )}
              </div>
              <div>
                {wizardStep < 3 ? (
                  <button
                    onClick={() => setWizardStep(s => s + 1)}
                    disabled={!canAdvance(wizardStep)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-1.5 transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={saving || !formData.providerName || !formData.providerHost}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="w-4 h-4" /> {wizardMode === 'add' ? 'Create Provider' : 'Save Changes'}</>
                    )}
                  </button>
                )}
              </div>
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
        }`} style={{ animation: 'fadeScaleIn 0.2s ease-out' }}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <style>{`
        .fi { width:100%; background:rgba(15,23,42,0.4); border:1px solid rgba(71,85,105,0.5); border-radius:0.5rem; padding:0.5rem 0.75rem; color:white; font-size:0.875rem; }
        .fi:focus { outline:none; border-color:rgba(16,185,129,0.5); box-shadow:0 0 0 1px rgba(16,185,129,0.2); }
        .fi:disabled { opacity:0.5; cursor:not-allowed; }
        .fi option { background:#1e293b; color:white; }
        @keyframes fadeScaleIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}

export default TrunksPage;
