import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Plus, Edit2, Trash2, Save, X, RefreshCw, Users, Phone,
  Clock, CheckCircle, AlertCircle, UserPlus, UserMinus,
} from 'lucide-react';

interface RingGroup {
  name: string;
  contextName: string;
  description: string;
  strategy: string;
  members: string[];
  ringTime: number;
  destination: string;
}

interface RingGroupFormData {
  name: string;
  description: string;
  strategy: string;
  ringTime: number;
  members: string[];
  destination: string;
  destinationTarget: string;
}

const defaultForm: RingGroupFormData = {
  name: '',
  description: '',
  strategy: 'ringall',
  ringTime: 30,
  members: [],
  destination: 'hangup',
  destinationTarget: '',
};

const RING_STRATEGIES = [
  { value: 'ringall', label: 'Ring All', desc: 'Ring all members simultaneously until one answers' },
  { value: 'hunt', label: 'Hunt', desc: 'Ring members one at a time, in order' },
  { value: 'memoryhunt', label: 'Memory Hunt', desc: 'Ring first, then first+second, then first+second+third, etc.' },
];

const DESTINATION_TYPES = [
  { value: 'hangup', label: 'Hangup' },
  { value: 'extension', label: 'Extension' },
  { value: 'queue', label: 'Queue' },
  { value: 'voicemail', label: 'Voicemail' },
];

export function RingGroupsPage() {
  const [ringGroups, setRingGroups] = useState<RingGroup[]>([]);
  const [extensions, setExtensions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<RingGroupFormData>({ ...defaultForm });
  const [saving, setSaving] = useState(false);
  const [newMemberExt, setNewMemberExt] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rgRes, eRes] = await Promise.all([
        adminApi('/ringgroups'),
        adminApi('/extensions'),
      ]);
      const [rgData, eData] = await Promise.all([rgRes.json(), eRes.json()]);
      if (rgData.success) setRingGroups(rgData.ringGroups);
      if (eData.success) setExtensions(eData.extensions);
    } catch (err) {
      console.error('Failed to fetch ring group data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openEditor = (mode: 'add' | 'edit', group?: RingGroup) => {
    setEditorMode(mode);
    if (mode === 'edit' && group) {
      let destType = 'hangup';
      let destTarget = '';
      if (group.destination === 'voicemail') {
        destType = 'voicemail';
      } else if (group.destination === 'hangup') {
        destType = 'hangup';
      } else if (/^\d+$/.test(group.destination)) {
        destType = 'extension';
        destTarget = group.destination;
      } else if (group.destination) {
        destType = 'queue';
        destTarget = group.destination;
      }
      setFormData({
        name: group.name,
        description: group.description,
        strategy: group.strategy,
        ringTime: group.ringTime,
        members: [...group.members],
        destination: destType,
        destinationTarget: destTarget,
      });
    } else {
      setFormData({ ...defaultForm });
    }
    setShowEditor(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let dest = formData.destination;
      if (dest === 'extension' || dest === 'queue') {
        dest = formData.destinationTarget;
      }

      const payload = {
        name: formData.name,
        description: formData.description,
        strategy: formData.strategy,
        ringTime: formData.ringTime,
        members: formData.members,
        destination: dest,
      };

      if (editorMode === 'add') {
        const res = await adminApi('/ringgroups', { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
          setShowEditor(false);
          setToast({ type: 'success', message: `Ring group "${formData.name}" created successfully` });
          await reloadFs();
          fetchData();
        } else {
          setToast({ type: 'error', message: data.error || 'Failed to create ring group' });
        }
      } else {
        const res = await adminApi(`/ringgroups/${formData.name}`, { method: 'PUT', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
          setShowEditor(false);
          setToast({ type: 'success', message: `Ring group "${formData.name}" updated successfully` });
          await reloadFs();
          fetchData();
        } else {
          setToast({ type: 'error', message: data.error || 'Failed to update ring group' });
        }
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save ring group' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: RingGroup) => {
    if (!confirm(`Delete ring group "${group.name}"?\n\nThis will remove the ring group context from extensions.conf.`)) return;
    try {
      const res = await adminApi(`/ringgroups/${group.name}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: `Ring group "${group.name}" deleted successfully` });
        await reloadFs();
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete ring group' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete ring group' });
    }
  };

  const addMember = () => {
    if (!newMemberExt) return;
    if (!formData.members.includes(newMemberExt)) {
      setFormData(prev => ({ ...prev, members: [...prev.members, newMemberExt] }));
    }
    setNewMemberExt('');
  };

  const removeMember = (member: string) => {
    setFormData(prev => ({ ...prev, members: prev.members.filter(m => m !== member) }));
  };

  const getExtName = (ext: string) => {
    const found = extensions.find(e => e.extension === ext);
    if (!found) return ext;
    return found.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || ext;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Ring Groups</h1>
          <p className="text-slate-400 text-sm mt-1">Manage ring groups to distribute calls across multiple extensions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => openEditor('add')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium">
            <Plus className="w-4 h-4" /> Add Ring Group
          </button>
        </div>
      </div>

      {/* Ring Group Cards */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      ) : ringGroups.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-800/40 border border-slate-700/50 rounded-xl">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No ring groups configured</p>
          <p className="text-xs text-slate-600 mt-1">Create a ring group to ring multiple extensions simultaneously</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {ringGroups.map(group => (
            <div key={group.name}
              className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 hover:border-slate-600/50 transition-all">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-600/20 flex items-center justify-center border border-blue-500/20">
                    <Users className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-sm">{group.name}</h3>
                    <span className="text-xs text-slate-500">
                      {RING_STRATEGIES.find(s => s.value === group.strategy)?.label || group.strategy}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditor('edit', group)}
                    className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(group)}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-2 bg-slate-700/30 rounded-lg">
                  <p className="text-lg font-bold text-white">{group.members.length}</p>
                  <p className="text-xs text-slate-500">Members</p>
                </div>
                <div className="text-center p-2 bg-slate-700/30 rounded-lg">
                  <p className="text-lg font-bold text-white">{group.ringTime}s</p>
                  <p className="text-xs text-slate-500">Ring Time</p>
                </div>
                <div className="text-center p-2 bg-slate-700/30 rounded-lg">
                  <p className="text-lg font-bold text-blue-400 capitalize">{group.strategy}</p>
                  <p className="text-xs text-slate-500">Strategy</p>
                </div>
              </div>

              {/* Members preview */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Members</span>
                  <span className="text-slate-300">{group.members.map(m => `${m} (${getExtName(m)})`).join(', ')}</span>
                </div>
                {group.description && (
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Description</span>
                    <span className="text-slate-300">{group.description}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-slate-400">
                  <span>No Answer</span>
                  <span className="text-slate-300 capitalize">{group.destination || 'Hangup'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Slide-Over */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowEditor(false)} />
          <div className="relative w-full max-w-2xl bg-slate-800 border-l border-slate-700 shadow-2xl flex flex-col" style={{ animation: 'slideInRight 0.3s ease-out' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {editorMode === 'add' ? 'Add Ring Group' : `Edit Ring Group: ${formData.name}`}
                </h2>
                <p className="text-slate-400 text-xs mt-0.5">Configure ring group behavior and members</p>
              </div>
              <button onClick={() => setShowEditor(false)} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Identity */}
              <Sect title="Ring Group Identity">
                <Fld label="Group Name" required help="Unique identifier (alphanumeric, dash, underscore)">
                  <input type="text" value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., sales-team" disabled={editorMode === 'edit'}
                    className={`fi ${editorMode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`} />
                </Fld>
                <Fld label="Description" help="Optional description for this ring group">
                  <input type="text" value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g., Sales Team Ring Group" className="fi" />
                </Fld>
              </Sect>

              {/* Strategy */}
              <Sect title="Ring Strategy" desc="Determines how calls are distributed to members">
                <div className="space-y-2">
                  {RING_STRATEGIES.map(strat => (
                    <label key={strat.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        formData.strategy === strat.value
                          ? 'bg-emerald-500/5 border-emerald-500/30'
                          : 'bg-slate-800/40 border-slate-700/30 hover:border-slate-600'
                      }`}>
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        formData.strategy === strat.value ? 'border-emerald-500' : 'border-slate-600'
                      }`}>
                        {formData.strategy === strat.value && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                      </div>
                      <input type="radio" name="strategy" value={strat.value} className="hidden"
                        checked={formData.strategy === strat.value}
                        onChange={() => setFormData({ ...formData, strategy: strat.value })} />
                      <div>
                        <span className="text-sm font-medium text-white">{strat.label}</span>
                        <p className="text-xs text-slate-500">{strat.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </Sect>

              {/* Ring Time */}
              <Sect title="Ring Time">
                <Fld label="Ring Time (seconds)" help="How long to ring before giving up or trying next">
                  <div className="relative">
                    <input type="number" value={formData.ringTime} min={5} max={300}
                      onChange={(e) => setFormData({ ...formData, ringTime: parseInt(e.target.value) || 30 })}
                      className="fi pr-12" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">sec</span>
                  </div>
                </Fld>
              </Sect>

              {/* Members */}
              <Sect title="Members" desc="Extensions that will ring when this group is called">
                <div className="flex gap-2">
                  <select value={newMemberExt} onChange={(e) => setNewMemberExt(e.target.value)} className="fi flex-1">
                    <option value="">Select an extension...</option>
                    {extensions
                      .filter(e => !formData.members.includes(e.extension))
                      .map(e => (
                        <option key={e.extension} value={e.extension}>
                          {e.extension} - {e.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || 'Unnamed'}
                        </option>
                      ))}
                  </select>
                  <button onClick={addMember} disabled={!newMemberExt}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all disabled:opacity-40">
                    <UserPlus className="w-4 h-4" /> Add
                  </button>
                </div>

                {formData.members.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No members added</p>
                    <p className="text-xs text-slate-600 mt-1">Add extensions to this ring group</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formData.members.map((member, idx) => {
                      const ext = extensions.find(e => e.extension === member);
                      return (
                        <div key={member}
                          className="flex items-center justify-between p-3 bg-slate-800/40 border border-slate-700/30 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center text-xs font-mono text-blue-400">
                              {idx + 1}
                            </div>
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <Phone className="w-4 h-4 text-blue-400" />
                            </div>
                            <div>
                              <p className="text-sm text-white font-medium">
                                {ext?.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || member}
                              </p>
                              <p className="text-xs text-slate-500 font-mono">PJSIP/{member}</p>
                            </div>
                          </div>
                          <button onClick={() => removeMember(member)}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all" title="Remove">
                            <UserMinus className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Sect>

              {/* No Answer Destination */}
              <Sect title="No Answer Destination" desc="Where to route the call if no member answers">
                <Fld label="Destination Type">
                  <select value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value, destinationTarget: '' })}
                    className="fi">
                    {DESTINATION_TYPES.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </Fld>
                {(formData.destination === 'extension' || formData.destination === 'queue') && (
                  <Fld label={formData.destination === 'extension' ? 'Extension Number' : 'Queue Name'}
                    help={formData.destination === 'extension' ? 'Extension to route to if no answer' : 'Queue name to route to if no answer'}>
                    <input type="text" value={formData.destinationTarget}
                      onChange={(e) => setFormData({ ...formData, destinationTarget: e.target.value })}
                      placeholder={formData.destination === 'extension' ? 'e.g., 100' : 'e.g., support-queue'}
                      className="fi" />
                  </Fld>
                )}
              </Sect>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/80 flex items-center justify-between">
              <button onClick={() => setShowEditor(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-all">Cancel</button>
              <button onClick={handleSave} disabled={saving || !formData.name || formData.members.length === 0}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium disabled:opacity-40">
                {saving ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-4 h-4" /> {editorMode === 'add' ? 'Create Ring Group' : 'Save Changes'}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-3 animate-slide-in-right ${
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
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
        @keyframes slideInRight { from{transform:translateX(100%)} to{transform:translateX(0)} }
        .animate-slide-in-right { animation: slideInRight 0.3s ease-out; }
      `}</style>
    </div>
  );
}

function Sect({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
      {desc && <p className="text-xs text-slate-500 mb-4">{desc}</p>}
      {!desc && <div className="mb-4" />}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Fld({ label, required, help, children }: { label: string; required?: boolean; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {help && <p className="text-xs text-slate-600 mt-1">{help}</p>}
    </div>
  );
}
