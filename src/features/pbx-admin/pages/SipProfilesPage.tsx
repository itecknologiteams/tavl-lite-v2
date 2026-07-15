import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Radio, RefreshCw, CheckCircle, XCircle, Activity,
  Edit2, Save, X, Plus, Trash2, AlertTriangle
} from 'lucide-react';

interface SipProfile {
  name: string;
  type: 'internal' | 'external';
  status: 'running' | 'stopped';
  registrations: number;
  calls: number;
  enabled: boolean;
  settings: Record<string, string>;
}

export function SipProfilesPage() {
  const [profiles, setProfiles] = useState<SipProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<SipProfile>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/sip-profiles');
      const data = await res.json();
      if (data.success) setProfiles(data.profiles);
    } catch (err) {
      console.error('Failed to fetch SIP profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (name: string) => {
    try {
      const res = await adminApi(`/sip-profiles/${name}`, {
        method: 'PUT',
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Profile updated' });
        await reloadFs();
        setEditing(null);
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to update' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save' });
    }
  };

  const toggleProfile = async (profile: SipProfile) => {
    try {
      const res = await adminApi(`/sip-profiles/${profile.name}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: `Profile ${profile.enabled ? 'stopped' : 'started'}` });
        await reloadFs();
        fetchData();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to toggle profile' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading SIP profiles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Radio className="w-6 h-6 text-emerald-400" />
            SIP Profiles (Advanced)
          </h1>
          <p className="text-slate-400 text-sm mt-1">Network configuration for SIP connections</p>
        </div>
        <button onClick={fetchData}
          className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-400">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <div>
          <span className="font-medium">Advanced Settings</span> — Changes here affect all phone connections. Only modify if you understand SIP protocol configuration.
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`p-3 rounded-xl flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
          'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}

      {/* Profiles List */}
      <div className="space-y-4">
        {profiles.map((profile) => (
          <div key={profile.name} className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  profile.status === 'running' ? 'bg-emerald-500/20' : 'bg-slate-700'
                }`}>
                  <Radio className={`w-5 h-5 ${profile.status === 'running' ? 'text-emerald-400' : 'text-slate-500'}`} />
                </div>
                <div>
                  <h3 className="text-white font-medium">{profile.name}</h3>
                  <p className="text-xs text-slate-400 capitalize">{profile.type} Profile</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-white font-medium">{profile.registrations}</p>
                    <p className="text-xs text-slate-500">Registrations</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">{profile.calls}</p>
                    <p className="text-xs text-slate-500">Active Calls</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleProfile(profile)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      profile.enabled
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    }`}
                  >
                    {profile.enabled ? 'Stop' : 'Start'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(profile.name);
                      setFormData(profile);
                    }}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Edit Form */}
            {editing === profile.name && (
              <div className="px-4 py-4 border-t border-slate-700/50 bg-slate-800/30">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {Object.entries(profile.settings).map(([key, value]) => (
                    <div key={key}>
                      <label className="block text-xs text-slate-400 mb-1 capitalize">{key}</label>
                      <input
                        type="text"
                        value={formData.settings?.[key] || value}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          settings: { ...prev.settings, [key]: e.target.value }
                        }))}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditing(null)}
                    className="px-4 py-2 text-slate-400 hover:text-white text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSave(profile.name)}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {profiles.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <Radio className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No SIP profiles found</p>
          </div>
        )}
      </div>
    </div>
  );
}
