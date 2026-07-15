import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Voicemail, Plus, Trash2, Edit2, Save, X, Play, Pause, Download,
  Mail, Phone, CheckCircle, XCircle, Volume2, Upload, MessageSquare
} from 'lucide-react';

interface VoicemailBox {
  uuid: string;
  extension: string;
  password: string;
  email: string;
  enabled: boolean;
  description: string;
  messageCount: { new: number; saved: number };
  alternateGreeting: string | null;
  attachFile: boolean;
  deleteAfterEmail: boolean;
}

interface VoicemailMessage {
  uuid: string;
  callerId: string;
  callerNumber: string;
  timestamp: string;
  duration: number;
  status: string;
}

export function VoicemailPage() {
  const [mailboxes, setMailboxes] = useState<VoicemailBox[]>([]);
  const [messages, setMessages] = useState<VoicemailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [viewingMessages, setViewingMessages] = useState<string | null>(null);
  const [playingMessage, setPlayingMessage] = useState<string | null>(null);
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [formData, setFormData] = useState({
    extension: '',
    password: '',
    email: '',
    description: '',
    enabled: true,
    attachFile: false,
    deleteAfterEmail: false,
  });

  useEffect(() => {
    fetchMailboxes();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchMailboxes = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/voicemail');
      const data = await res.json();
      if (data.success) setMailboxes(data.mailboxes || []);
    } catch (err) {
      console.error('Failed to fetch mailboxes:', err);
      setToast({ type: 'error', message: 'Failed to load voicemail boxes' });
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (extension: string) => {
    try {
      const res = await adminApi(`/voicemail/${extension}/messages`);
      const data = await res.json();
      if (data.success) setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  const handleSave = async () => {
    try {
      const url = editing ? `/voicemail/${editing}` : '/voicemail';
      const method = editing ? 'PUT' : 'POST';
      const res = await adminApi(url, { method, body: JSON.stringify(formData) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: editing ? 'Voicemail updated' : 'Voicemail created' });
        await reloadFs();
        setShowAdd(false);
        setEditing(null);
        setFormData({ extension: '', password: '', email: '', description: '', enabled: true, attachFile: false, deleteAfterEmail: false });
        fetchMailboxes();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to save' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save voicemail' });
    }
  };

  const handleDelete = async (extension: string) => {
    if (!confirm(`Delete voicemail box for extension ${extension}?`)) return;
    try {
      const res = await adminApi(`/voicemail/${extension}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Voicemail box deleted' });
        await reloadFs();
        fetchMailboxes();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete' });
    }
  };

  const playMessage = (uuid: string) => {
    if (playingMessage === uuid) {
      audioPlayer?.pause();
      setPlayingMessage(null);
      setAudioPlayer(null);
    } else {
      const audio = new Audio(`/api/pbx-admin/voicemail/messages/${uuid}/play`);
      audio.play();
      setAudioPlayer(audio);
      setPlayingMessage(uuid);
      audio.onended = () => {
        setPlayingMessage(null);
        setAudioPlayer(null);
      };
    }
  };

  const downloadMessage = (uuid: string) => {
    window.open(`/api/pbx-admin/voicemail/messages/${uuid}/download`, '_blank');
  };

  const deleteMessage = async (uuid: string) => {
    if (!confirm('Delete this message?')) return;
    try {
      const res = await adminApi(`/voicemail/messages/${uuid}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Message deleted' });
        if (viewingMessages) fetchMessages(viewingMessages);
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete message' });
    }
  };

  const viewMessages = (extension: string) => {
    setViewingMessages(extension);
    fetchMessages(extension);
  };

  const handleGreetingUpload = async (extension: string, file: File, type: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const res = await adminApi(`/voicemail/${extension}/greeting`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        setToast({ type: 'success', message: 'Greeting uploaded successfully' });
        await reloadFs();
      } else {
        setToast({ type: 'error', message: 'Failed to upload greeting' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to upload greeting' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading voicemail boxes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Voicemail className="w-6 h-6 text-emerald-400" />
            Voicemail Management
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage voicemail boxes, greetings, and messages</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); setFormData({ extension: '', password: '', email: '', description: '', enabled: true, attachFile: false, deleteAfterEmail: false }); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Mailbox
        </button>
      </div>

      {/* Messages Modal */}
      {viewingMessages && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-400" />
                Voicemail Messages - {viewingMessages}
              </h2>
              <button onClick={() => { setViewingMessages(null); setMessages([]); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {messages.length === 0 ? (
                <p className="text-slate-500 text-center py-8">No messages in this mailbox</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div key={msg.uuid} className="bg-slate-700/50 rounded-lg p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button onClick={() => playMessage(msg.uuid)} className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center hover:bg-emerald-500/30">
                          {playingMessage === msg.uuid ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                        </button>
                        <div>
                          <p className="text-white font-medium">{msg.callerId || 'Unknown Caller'}</p>
                          <p className="text-slate-400 text-sm">{msg.callerNumber} • {new Date(msg.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${msg.status === 'new' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-300'}`}>
                          {msg.status}
                        </span>
                        <span className="text-slate-400 text-sm">{Math.floor(msg.duration / 60)}:{String(msg.duration % 60).padStart(2, '0')}</span>
                        <button onClick={() => downloadMessage(msg.uuid)} className="p-2 text-slate-400 hover:text-emerald-400">
                          <Download className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteMessage(msg.uuid)} className="p-2 text-slate-400 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAdd || editing) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editing ? 'Edit Voicemail Box' : 'Create Voicemail Box'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Extension</label>
                <input
                  type="text"
                  value={formData.extension}
                  onChange={(e) => setFormData({ ...formData, extension: e.target.value })}
                  disabled={!!editing}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                  placeholder="100"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Password (PIN)</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="1234"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="Sales Department"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500/20"
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={formData.attachFile}
                    onChange={(e) => setFormData({ ...formData, attachFile: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500/20"
                  />
                  Attach to Email
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowAdd(false); setEditing(null); }}
                className="px-4 py-2 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mailboxes Grid */}
      {mailboxes.length === 0 ? (
        <div className="text-center py-12 bg-slate-800/50 border border-slate-700/50 rounded-xl">
          <Voicemail className="w-12 h-12 mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400">No voicemail boxes configured</p>
          <p className="text-slate-500 text-sm mt-1">Create a mailbox to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mailboxes.map((box) => (
            <div key={box.extension} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${box.enabled ? 'bg-emerald-500/20' : 'bg-slate-700'}`}>
                    <Phone className={`w-5 h-5 ${box.enabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{box.extension}</h3>
                    <p className="text-slate-400 text-xs">{box.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => viewMessages(box.extension)}
                    className="p-2 text-slate-400 hover:text-emerald-400"
                    title="View Messages"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setEditing(box.extension); setFormData({ ...box, password: '' }); }}
                    className="p-2 text-slate-400 hover:text-white"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(box.extension)}
                    className="p-2 text-slate-400 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {box.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-300 truncate">{box.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Volume2 className="w-4 h-4 text-slate-500" />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${box.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                    {box.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>

              {/* Message Count & Greetings */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                <button
                  onClick={() => viewMessages(box.extension)}
                  className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center gap-2"
                >
                  <Voicemail className="w-4 h-4" />
                  {box.messageCount.new > 0 && (
                    <span className="bg-emerald-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {box.messageCount.new} new
                    </span>
                  )}
                  {box.messageCount.saved > 0 && (
                    <span className="text-slate-400">{box.messageCount.saved} saved</span>
                  )}
                  {box.messageCount.new === 0 && box.messageCount.saved === 0 && (
                    <span className="text-slate-500">No messages</span>
                  )}
                </button>
                <label className="p-2 text-slate-400 hover:text-emerald-400 cursor-pointer" title="Upload Greeting">
                  <Upload className="w-4 h-4" />
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleGreetingUpload(box.extension, file, 'standard');
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
