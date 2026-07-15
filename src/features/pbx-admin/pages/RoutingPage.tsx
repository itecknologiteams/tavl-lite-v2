import React, { useEffect, useState, useCallback } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  PhoneIncoming, PhoneOutgoing, Plus, Save, X, AlertCircle,
  RefreshCw, ArrowRight, CheckCircle, Trash2, Power, PowerOff,
  HelpCircle, Info,
} from 'lucide-react';

interface InboundRoute {
  id: string;
  name: string;
  did: string;
  destination: 'queue' | 'extension' | 'ivr';
  destinationTarget: string;
  enabled: boolean;
  description: string;
}

interface OutboundRoute {
  id: string;
  name: string;
  pattern: string;
  trunkName: string;
  callerIdName: string;
  callerIdNumber: string;
  enabled: boolean;
}

interface TrunkInfo { name: string; host: string; }

const DIAL_PATTERN_PRESETS = [
  { pattern: '^0(\\d{9,})$', label: 'All Outbound (0-prefix)', desc: 'Pakistani numbers starting with 0' },
  { pattern: '^(03\\d{9})$', label: 'Mobile Only (03xx)', desc: 'Only mobile numbers' },
  { pattern: '^0([2-9]\\d{7,})$', label: 'Landline Only', desc: 'Only landline numbers' },
  { pattern: '^00(\\d+)$', label: 'International (00xx)', desc: 'International dialing' },
];

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block">
      <Info className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 cursor-help" />
      <span className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded shadow-lg whitespace-nowrap max-w-xs">
        {text}
      </span>
    </span>
  );
}

const uid = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function RoutingPage() {
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('inbound');
  const [inboundRoutes, setInboundRoutes] = useState<InboundRoute[]>([]);
  const [outboundRoutes, setOutboundRoutes] = useState<OutboundRoute[]>([]);
  const [trunks, setTrunks] = useState<TrunkInfo[]>([]);
  const [queues, setQueues] = useState<string[]>([]);
  const [extensions, setExtensions] = useState<{ ext: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); } }, [toast]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [routeRes, extRes] = await Promise.all([
        adminApi('/routing/config'),
        adminApi('/extensions'),
      ]);
      const [routeData, extData] = await Promise.all([routeRes.json(), extRes.json()]);

      if (routeData.success) {
        setInboundRoutes(routeData.config?.inboundRoutes || []);
        setOutboundRoutes(routeData.config?.outboundRoutes || []);
        setTrunks(routeData.trunks || []);
        setQueues(routeData.queues || []);
      }
      if (extData.success) {
        setExtensions((extData.extensions || []).map((e: any) => ({ ext: e.extension, name: e.effective_caller_id_name || e.extension })));
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to load routing config' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveAll = async () => {
    setSaving(true);
    try {
      const res = await adminApi('/routing/config', {
        method: 'PUT',
        body: JSON.stringify({ inboundRoutes, outboundRoutes }),
      });
      const data = await res.json();
      if (data.success) {
        setDirty(false);
        setToast({ type: 'success', message: 'Routing saved and applied to phone system' });
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to apply routing' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const addInbound = () => {
    setInboundRoutes(prev => [...prev, {
      id: uid(), name: '', did: '',
      destination: 'queue', destinationTarget: queues[0] || '',
      enabled: true, description: '',
    }]);
    setDirty(true);
  };

  const updateInbound = (id: string, field: string, value: any) => {
    setInboundRoutes(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(true);
  };

  const removeInbound = (id: string) => {
    setInboundRoutes(prev => prev.filter(r => r.id !== id));
    setDirty(true);
  };

  const updateOutbound = (id: string, field: string, value: any) => {
    setOutboundRoutes(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
        <span className="ml-3 text-slate-400">Loading routing...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Call Routing</h1>
          <p className="text-sm text-slate-400 mt-1">Control how incoming and outgoing calls are handled</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-sm text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> Unsaved changes
            </span>
          )}
          <button onClick={saveAll} disabled={saving || !dirty}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Applying...' : 'Save & Apply'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg w-fit">
        {[
          { key: 'inbound' as const, label: 'Incoming Calls', icon: PhoneIncoming, count: inboundRoutes.length },
          { key: 'outbound' as const, label: 'Outgoing Calls', icon: PhoneOutgoing, count: outboundRoutes.length },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count > 0 && <span className="ml-1 px-1.5 py-0.5 bg-slate-900/50 rounded text-xs">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Inbound Routes */}
      {activeTab === 'inbound' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              When someone calls your phone number, where should the call go?
            </p>
            <button onClick={addInbound}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors">
              <Plus className="w-4 h-4" /> Add Route
            </button>
          </div>

          {inboundRoutes.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-slate-800/30 rounded-xl border border-dashed border-slate-700">
              <PhoneIncoming className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-lg font-medium">No incoming routes configured</p>
              <p className="text-sm mt-1">Click "Add Route" to set up where incoming calls go</p>
            </div>
          ) : (
            <div className="space-y-3">
              {inboundRoutes.map(route => (
                <div key={route.id} className={`bg-slate-800/60 rounded-xl border p-5 transition-colors ${route.enabled ? 'border-slate-700' : 'border-slate-800 opacity-60'}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${route.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                        <PhoneIncoming className="w-5 h-5" />
                      </div>
                      <div>
                        <input type="text" value={route.name} onChange={e => updateInbound(route.id, 'name', e.target.value)}
                          placeholder="Route name (e.g. Main Line)"
                          className="bg-transparent text-white font-medium text-lg border-none outline-none placeholder-slate-600 w-64" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateInbound(route.id, 'enabled', !route.enabled)}
                        className={`p-1.5 rounded-lg transition-colors ${route.enabled ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-slate-500 hover:bg-slate-700'}`}
                        title={route.enabled ? 'Active' : 'Disabled'}>
                        {route.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      </button>
                      <button onClick={() => removeInbound(route.id)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-slate-400">When someone calls</span>
                    <div className="relative">
                      <input type="text" value={route.did} onChange={e => updateInbound(route.id, 'did', e.target.value)}
                        placeholder="Phone number (e.g. 2138650302)"
                        className="px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm w-52 focus:border-emerald-500 focus:outline-none" />
                      <Tooltip text="Enter the DID number without leading 0 or country code. E.g. for 021-38650302 enter 2138650302" />
                    </div>

                    <ArrowRight className="w-4 h-4 text-emerald-500" />

                    <span className="text-slate-400">send to</span>
                    <select value={route.destination} onChange={e => updateInbound(route.id, 'destination', e.target.value)}
                      className="px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none">
                      <option value="queue">Call Group (Queue)</option>
                      <option value="extension">Phone Line (Extension)</option>
                      <option value="ivr">IVR Menu</option>
                    </select>

                    {route.destination === 'queue' && (
                      <select value={route.destinationTarget} onChange={e => updateInbound(route.id, 'destinationTarget', e.target.value)}
                        className="px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none">
                        {queues.map(q => <option key={q} value={q}>{q}</option>)}
                        {queues.length === 0 && <option value="">No queues available</option>}
                      </select>
                    )}

                    {route.destination === 'extension' && (
                      <select value={route.destinationTarget} onChange={e => updateInbound(route.id, 'destinationTarget', e.target.value)}
                        className="px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none">
                        {extensions.map(e => <option key={e.ext} value={e.ext}>{e.ext} - {e.name}</option>)}
                      </select>
                    )}

                    {route.destination === 'ivr' && (
                      <input type="text" value={route.destinationTarget} onChange={e => updateInbound(route.id, 'destinationTarget', e.target.value)}
                        placeholder="IVR menu name"
                        className="px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm w-40 focus:border-emerald-500 focus:outline-none" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Outbound Routes */}
      {activeTab === 'outbound' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            When your team dials an external number, which provider connection (trunk) should carry the call?
          </p>

          {outboundRoutes.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-slate-800/30 rounded-xl border border-dashed border-slate-700">
              <PhoneOutgoing className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-lg font-medium">No outbound routes found</p>
              <p className="text-sm mt-1">Outbound routes are managed in the FreeSWITCH dialplan</p>
            </div>
          ) : (
            <div className="space-y-3">
              {outboundRoutes.map(route => (
                <div key={route.id} className={`bg-slate-800/60 rounded-xl border p-5 transition-colors ${route.enabled ? 'border-slate-700' : 'border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${route.enabled ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-700 text-slate-500'}`}>
                        <PhoneOutgoing className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-white font-medium">{route.name || 'Outbound Route'}</h3>
                        <p className="text-xs text-slate-500">via {route.trunkName || 'unknown trunk'}</p>
                      </div>
                    </div>
                    <div className={`px-2 py-0.5 rounded text-xs font-medium ${route.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                      {route.enabled ? 'Active' : 'Disabled'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block flex items-center">
                        Dial Pattern
                        <Tooltip text="Regular expression that matches the numbers this route handles" />
                      </label>
                      <select
                        value={DIAL_PATTERN_PRESETS.find(p => p.pattern === route.pattern) ? route.pattern : '__custom'}
                        onChange={e => { if (e.target.value !== '__custom') updateOutbound(route.id, 'pattern', e.target.value); }}
                        className="w-full px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none">
                        {DIAL_PATTERN_PRESETS.map(p => <option key={p.pattern} value={p.pattern}>{p.label}</option>)}
                        <option value="__custom">Custom: {route.pattern}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block flex items-center">
                        Caller ID Name
                        <Tooltip text="Name shown to the person you are calling" />
                      </label>
                      <input type="text" value={route.callerIdName} onChange={e => updateOutbound(route.id, 'callerIdName', e.target.value)}
                        placeholder="e.g. iTecknologi"
                        className="w-full px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block flex items-center">
                        Caller ID Number
                        <Tooltip text="Phone number shown to the person you are calling" />
                      </label>
                      <input type="text" value={route.callerIdNumber} onChange={e => updateOutbound(route.id, 'callerIdNumber', e.target.value)}
                        placeholder="e.g. 02138650302"
                        className="w-full px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RoutingPage;
