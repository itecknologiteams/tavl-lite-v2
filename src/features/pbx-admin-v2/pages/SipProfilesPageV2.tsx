import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSipProfiles, toggleSipProfile, updateSipProfile, extractError } from '../api';
import type { SipProfile } from '../types';
import {
  Sliders, Loader2, AlertCircle, CheckCircle, XCircle, ToggleLeft, ToggleRight,
  Phone, ChevronDown, ChevronUp, Plus, Trash2, Save, X, AlertTriangle, Settings,
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

interface SettingsRow {
  key: string;
  value: string;
}

export function SipProfilesPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [editSettings, setEditSettings] = useState<Record<string, SettingsRow[]>>({});
  const [editingProfile, setEditingProfile] = useState<string | null>(null);

  const { data: profiles = [], isLoading, isError } = useQuery<SipProfile[]>({
    queryKey: ['sip-profiles-v2'],
    queryFn: getSipProfiles,
    staleTime: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      toggleSipProfile(name, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sip-profiles-v2'] });
      toast('success', 'SIP profile updated');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, settings }: { name: string; settings: Record<string, string> }) =>
      updateSipProfile(name, { settings }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['sip-profiles-v2'] });
      setEditingProfile(null);
      toast('success', `Settings saved for ${vars.name}`);
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const startEditing = (profile: SipProfile) => {
    const rows: SettingsRow[] = profile.settings
      ? Object.entries(profile.settings).map(([key, value]) => ({ key, value }))
      : [];
    setEditSettings((prev) => ({ ...prev, [profile.name]: rows }));
    setEditingProfile(profile.name);
    setExpandedProfile(profile.name);
  };

  const cancelEditing = (name: string) => {
    setEditingProfile(null);
    setEditSettings((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const addRow = (name: string) => {
    setEditSettings((prev) => ({
      ...prev,
      [name]: [...(prev[name] || []), { key: '', value: '' }],
    }));
  };

  const removeRow = (name: string, idx: number) => {
    setEditSettings((prev) => ({
      ...prev,
      [name]: (prev[name] || []).filter((_, i) => i !== idx),
    }));
  };

  const updateRow = (name: string, idx: number, field: 'key' | 'value', val: string) => {
    setEditSettings((prev) => ({
      ...prev,
      [name]: (prev[name] || []).map((row, i) => i === idx ? { ...row, [field]: val } : row),
    }));
  };

  const saveSettings = (name: string) => {
    const rows = editSettings[name] || [];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim()) settings[row.key.trim()] = row.value;
    }
    updateMut.mutate({ name, settings });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">SIP Profiles</h1>
        <p className="text-slate-400 mt-1 font-medium">FreeSWITCH SIP profile configuration and status</p>
      </div>

      {/* Warning Banner */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-400">Advanced Configuration</p>
          <p className="text-xs text-amber-400/70 mt-0.5">
            Modifying SIP profile settings can affect call routing and connectivity. Changes require a profile restart to take effect.
            Only modify settings if you understand their impact on your telephony system.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading SIP profiles…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load SIP profiles</p>
        </div>
      )}
      {!isLoading && !isError && profiles.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Sliders className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No SIP Profiles Found</h3>
          <p className="text-slate-400 text-sm">SIP profiles are configured in FreeSWITCH</p>
        </div>
      )}
      {!isLoading && !isError && profiles.length > 0 && (
        <div className="space-y-4">
          {profiles.map((profile) => {
            const isExpanded = expandedProfile === profile.name;
            const isEditing = editingProfile === profile.name;
            const rows = editSettings[profile.name] || [];

            return (
              <div key={profile.name} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
                {/* Profile Header */}
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-slate-700/40 border border-slate-600/40">
                      <Sliders className="w-5 h-5 text-slate-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">{profile.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {profile.state || 'unknown'}
                        {profile.enabled !== false
                          ? <span className="ml-2 text-emerald-400">● enabled</span>
                          : <span className="ml-2 text-slate-500">● disabled</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-4 text-center">
                      <div className="bg-slate-900/40 rounded-xl px-4 py-2 border border-slate-700/30">
                        <Phone className="w-3.5 h-3.5 text-slate-500 mx-auto mb-0.5" />
                        <p className="text-sm font-bold text-white">{profile.registrations ?? 0}</p>
                        <p className="text-[10px] text-slate-500">Registrations</p>
                      </div>
                      <div className="bg-slate-900/40 rounded-xl px-4 py-2 border border-slate-700/30">
                        <CheckCircle className="w-3.5 h-3.5 text-slate-500 mx-auto mb-0.5" />
                        <p className="text-sm font-bold text-white">{profile.calls ?? 0}</p>
                        <p className="text-[10px] text-slate-500">Active Calls</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleMut.mutate({ name: profile.name, enabled: !(profile.enabled !== false) })}
                      disabled={toggleMut.isPending}
                      className={`p-1.5 rounded-lg transition-all ${
                        profile.enabled !== false ? 'text-indigo-400 hover:text-indigo-300' : 'text-slate-600 hover:text-slate-400'
                      }`}
                      title={profile.enabled !== false ? 'Disable profile' : 'Enable profile'}
                    >
                      {profile.enabled !== false ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                    </button>
                    <button
                      onClick={() => {
                        if (isExpanded && !isEditing) {
                          setExpandedProfile(null);
                        } else if (!isEditing) {
                          startEditing(profile);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-700/50 text-slate-400 hover:text-white border border-slate-600/40 hover:border-slate-500 transition-all"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Edit Settings
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Settings Editor */}
                {isExpanded && (
                  <div className="border-t border-slate-700/40 p-5 space-y-4 animate-fade-in">
                    {!isEditing && profile.settings && Object.keys(profile.settings).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Current Settings</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {Object.entries(profile.settings).map(([k, v]) => (
                            <div key={k} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-700/30">
                              <span className="text-xs text-slate-500 font-mono flex-shrink-0">{k}</span>
                              <span className="text-xs text-slate-600 flex-shrink-0">=</span>
                              <span className="text-xs text-white font-mono truncate">{v}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => startEditing(profile)}
                          className="mt-2 flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
                        >
                          <Settings className="w-4 h-4" /> Edit Settings
                        </button>
                      </div>
                    )}
                    {!isEditing && (!profile.settings || Object.keys(profile.settings).length === 0) && (
                      <div className="text-center py-4">
                        <p className="text-sm text-slate-500 mb-3">No custom settings configured</p>
                        <button
                          onClick={() => startEditing(profile)}
                          className="flex items-center gap-2 mx-auto bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
                        >
                          <Plus className="w-4 h-4" /> Add Settings
                        </button>
                      </div>
                    )}

                    {isEditing && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Settings Editor</p>
                          <button
                            onClick={() => addRow(profile.name)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-700/50 text-slate-400 hover:text-white border border-slate-600/40 transition-all"
                          >
                            <Plus className="w-3 h-3" /> Add Row
                          </button>
                        </div>

                        {rows.length === 0 && (
                          <p className="text-sm text-slate-500 text-center py-4">
                            No settings. Click "Add Row" to add key-value pairs.
                          </p>
                        )}

                        <div className="space-y-2">
                          {rows.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={row.key}
                                onChange={(e) => updateRow(profile.name, idx, 'key', e.target.value)}
                                placeholder="key"
                                className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl py-2 px-3 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                              />
                              <span className="text-slate-600">=</span>
                              <input
                                type="text"
                                value={row.value}
                                onChange={(e) => updateRow(profile.name, idx, 'value', e.target.value)}
                                placeholder="value"
                                className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl py-2 px-3 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                              />
                              <button
                                onClick={() => removeRow(profile.name, idx)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                                title="Remove row"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                          <button
                            onClick={() => cancelEditing(profile.name)}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                          >
                            <X className="w-4 h-4" /> Cancel
                          </button>
                          <button
                            onClick={() => saveSettings(profile.name)}
                            disabled={updateMut.isPending}
                            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
                          >
                            {updateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 space-y-3 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {t.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span className="text-sm font-medium">{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
