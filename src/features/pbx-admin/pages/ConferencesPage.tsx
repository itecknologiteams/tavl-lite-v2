import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Video, Users, Phone, Mic, MicOff, UserMinus,
  Plus, Trash2, RefreshCw, CheckCircle, XCircle
} from 'lucide-react';

interface Conference {
  name: string;
  extension: string;
  pin?: string;
  adminPin?: string;
  memberCount: number;
  members: ConferenceMember[];
  maxMembers: number;
  record: boolean;
  waitMod: boolean;
}

interface ConferenceMember {
  id: string;
  callerId: string;
  channel: string;
  muted: boolean;
  deaf: boolean;
  isAdmin: boolean;
  joinTime: string;
}

export function ConferencesPage() {
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    extension: '',
    pin: '',
    adminPin: '',
    maxMembers: '32',
    record: false,
    waitMod: false,
  });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchData = async () => {
    try {
      const res = await adminApi('/conferences');
      const data = await res.json();
      if (data.success) setConferences(data.conferences);
    } catch (err) {
      console.error('Failed to fetch conferences:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const res = await adminApi('/conferences', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Conference room created' });
        await reloadFs();
        setShowAdd(false);
        setFormData({ name: '', extension: '', pin: '', adminPin: '', maxMembers: '32', record: false, waitMod: false });
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to create' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to create conference' });
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete conference room "${name}"?`)) return;
    try {
      const res = await adminApi(`/conferences/${name}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Conference deleted' });
        await reloadFs();
        fetchData();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete' });
    }
  };

  const kickMember = async (confName: string, memberId: string) => {
    try {
      const res = await adminApi(`/conferences/${confName}/members/${memberId}/kick`, { method: 'POST' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Member removed' });
        fetchData();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to remove member' });
    }
  };

  const toggleMute = async (confName: string, memberId: string, muted: boolean) => {
    try {
      const res = await adminApi(`/conferences/${confName}/members/${memberId}/${muted ? 'unmute' : 'mute'}`, { method: 'POST' });
      if (res.ok) {
        fetchData();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to toggle mute' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading conference rooms...</p>
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
            <Video className="w-6 h-6 text-emerald-400" />
            Conference Rooms
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage audio conference bridges</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Room
          </button>
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

      {/* Add Conference Modal */}
      {showAdd && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
          <h3 className="text-white font-medium mb-4">Create Conference Room</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Room Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="e.g., sales-team"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Extension</label>
              <input
                type="text"
                value={formData.extension}
                onChange={(e) => setFormData({ ...formData, extension: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="e.g., 8000"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">User PIN</label>
              <input
                type="text"
                value={formData.pin}
                onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Admin PIN</label>
              <input
                type="text"
                value={formData.adminPin}
                onChange={(e) => setFormData({ ...formData, adminPin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Members</label>
              <input
                type="number"
                value={formData.maxMembers}
                onChange={(e) => setFormData({ ...formData, maxMembers: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formData.record}
                onChange={(e) => setFormData({ ...formData, record: e.target.checked })}
                className="rounded bg-slate-700 border-slate-600"
              />
              Record Conference
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formData.waitMod}
                onChange={(e) => setFormData({ ...formData, waitMod: e.target.checked })}
                className="rounded bg-slate-700 border-slate-600"
              />
              Wait for Moderator
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">
              Cancel
            </button>
            <button onClick={handleCreate}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm">
              Create Room
            </button>
          </div>
        </div>
      )}

      {/* Conferences List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {conferences.map((conf) => (
          <div key={conf.name} className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="px-4 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Video className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-white font-medium">{conf.name}</h3>
                  <p className="text-xs text-slate-400">Ext: {conf.extension}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{conf.memberCount}</p>
                  <p className="text-xs text-slate-500">/ {conf.maxMembers}</p>
                </div>
                <button onClick={() => handleDelete(conf.name)}
                  className="p-2 text-slate-400 hover:text-red-400 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Members */}
            <div className="divide-y divide-slate-700/30 max-h-64 overflow-y-auto">
              {conf.members.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-500">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No active participants</p>
                </div>
              ) : (
                conf.members.map((member) => (
                  <div key={member.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        member.isAdmin ? 'bg-amber-500/20' : 'bg-slate-700'
                      }`}>
                        <Phone className={`w-4 h-4 ${member.isAdmin ? 'text-amber-400' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-white text-sm">{member.callerId}</p>
                        <p className="text-xs text-slate-500">Joined: {member.joinTime}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleMute(conf.name, member.id, member.muted)}
                        className={`p-1.5 rounded ${member.muted ? 'bg-red-500/20 text-red-400' : 'text-slate-400 hover:text-white'}`}
                        title={member.muted ? 'Unmute' : 'Mute'}
                      >
                        {member.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => kickMember(conf.name, member.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400"
                        title="Remove"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {conferences.length === 0 && !showAdd && (
        <div className="text-center py-12 text-slate-500">
          <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="mb-2">No conference rooms configured</p>
          <button onClick={() => setShowAdd(true)} className="text-emerald-400 hover:underline text-sm">
            Create your first conference room
          </button>
        </div>
      )}
    </div>
  );
}
