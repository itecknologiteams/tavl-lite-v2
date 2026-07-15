import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  FileText, Plus, Trash2, Edit2, Save, X, Upload, Download, Send,
  Inbox, SendHorizonal, CheckCircle, XCircle, Phone, Mail, FileUp
} from 'lucide-react';

interface FaxConfig {
  uuid: string;
  extension: string;
  name: string;
  email: string;
  callerIdNumber: string;
  callerIdName: string;
  description: string;
  enabled: boolean;
  inboxCount: number;
  outboxCount: number;
}

interface FaxFile {
  filename: string;
  size: number;
  timestamp: string;
  type: 'received' | 'sent';
}

export function FaxPage() {
  const [faxConfigs, setFaxConfigs] = useState<FaxConfig[]>([]);
  const [files, setFiles] = useState<FaxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [viewingFiles, setViewingFiles] = useState<{ ext: string; type: 'inbox' | 'outbox' } | null>(null);
  const [showSendFax, setShowSendFax] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [formData, setFormData] = useState({
    extension: '',
    name: '',
    email: '',
    callerIdNumber: '',
    callerIdName: '',
    description: '',
    enabled: true,
  });

  const [sendForm, setSendForm] = useState({
    destination: '',
    header: '',
    file: null as File | null,
  });

  useEffect(() => {
    fetchFaxConfigs();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchFaxConfigs = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/fax');
      const data = await res.json();
      if (data.success) setFaxConfigs(data.fax || []);
    } catch (err) {
      console.error('Failed to fetch fax configs:', err);
      setToast({ type: 'error', message: 'Failed to load fax configurations' });
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async (extension: string, type: 'inbox' | 'outbox') => {
    try {
      const res = await adminApi(`/fax/${extension}/${type}`);
      const data = await res.json();
      if (data.success) setFiles(data.files || []);
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  };

  const handleSave = async () => {
    try {
      const url = editing ? `/fax/${editing}` : '/fax';
      const method = editing ? 'PUT' : 'POST';
      const res = await adminApi(url, { method, body: JSON.stringify(formData) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: editing ? 'Fax configuration updated' : 'Fax configuration created' });
        await reloadFs();
        setShowAdd(false);
        setEditing(null);
        setFormData({ extension: '', name: '', email: '', callerIdNumber: '', callerIdName: '', description: '', enabled: true });
        fetchFaxConfigs();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to save' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save fax configuration' });
    }
  };

  const handleDelete = async (extension: string) => {
    if (!confirm(`Delete fax configuration for extension ${extension}?`)) return;
    try {
      const res = await adminApi(`/fax/${extension}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Fax configuration deleted' });
        await reloadFs();
        fetchFaxConfigs();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete' });
    }
  };

  const handleSendFax = async () => {
    if (!sendForm.file || !sendForm.destination) {
      setToast({ type: 'error', message: 'Destination and file are required' });
      return;
    }

    const formData = new FormData();
    formData.append('file', sendForm.file);
    formData.append('destination', sendForm.destination);
    formData.append('header', sendForm.header || '');

    try {
      const res = await adminApi(`/fax/${showSendFax}/send`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Fax queued for sending' });
        await reloadFs();
        setShowSendFax(null);
        setSendForm({ destination: '', header: '', file: null });
        fetchFaxConfigs();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to send fax' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to send fax' });
    }
  };

  const downloadFile = (ext: string, filename: string, type: string) => {
    window.open(`/api/pbx-admin/fax/${ext}/files/${filename}?type=${type}`, '_blank');
  };

  const deleteFile = async (ext: string, filename: string, type: string) => {
    if (!confirm('Delete this fax file?')) return;
    try {
      const res = await adminApi(`/fax/${ext}/files/${filename}?type=${type}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'File deleted' });
        if (viewingFiles) fetchFiles(ext, viewingFiles.type);
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete file' });
    }
  };

  const viewFiles = (ext: string, type: 'inbox' | 'outbox') => {
    setViewingFiles({ ext, type });
    fetchFiles(ext, type);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading fax configurations...</p>
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
            <FileText className="w-6 h-6 text-emerald-400" />
            Fax Management
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage fax configurations, send/receive faxes</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); setFormData({ extension: '', name: '', email: '', callerIdNumber: '', callerIdName: '', description: '', enabled: true }); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Fax Extension
        </button>
      </div>

      {/* Files Modal */}
      {viewingFiles && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                {viewingFiles.type === 'inbox' ? <Inbox className="w-5 h-5 text-emerald-400" /> : <SendHorizonal className="w-5 h-5 text-blue-400" />}
                {viewingFiles.type === 'inbox' ? 'Received Faxes' : 'Sent Faxes'} - {viewingFiles.ext}
              </h2>
              <button onClick={() => { setViewingFiles(null); setFiles([]); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {files.length === 0 ? (
                <p className="text-slate-500 text-center py-8">No fax files</p>
              ) : (
                <div className="space-y-3">
                  {files.map((file) => (
                    <div key={file.filename} className="bg-slate-700/50 rounded-lg p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-slate-500" />
                        <div>
                          <p className="text-white font-medium">{file.filename}</p>
                          <p className="text-slate-400 text-sm">{file.timestamp} • {(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => downloadFile(viewingFiles.ext, file.filename, viewingFiles.type)} className="p-2 text-slate-400 hover:text-emerald-400">
                          <Download className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteFile(viewingFiles.ext, file.filename, viewingFiles.type)} className="p-2 text-slate-400 hover:text-red-400">
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

      {/* Send Fax Modal */}
      {showSendFax && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Send className="w-5 h-5 text-emerald-400" />
              Send Fax from {showSendFax}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Destination Number</label>
                <input
                  type="text"
                  value={sendForm.destination}
                  onChange={(e) => setSendForm({ ...sendForm, destination: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="+1234567890"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Fax Header (Optional)</label>
                <input
                  type="text"
                  value={sendForm.header}
                  onChange={(e) => setSendForm({ ...sendForm, header: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="Your Company Name"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Document (PDF or TIFF)</label>
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept=".pdf,.tif,.tiff,.png,.jpg,.jpeg"
                    onChange={(e) => setSendForm({ ...sendForm, file: e.target.files?.[0] || null })}
                    className="hidden"
                    id="fax-file"
                  />
                  <label htmlFor="fax-file" className="cursor-pointer">
                    <FileUp className="w-8 h-8 mx-auto text-slate-500 mb-2" />
                    <p className="text-slate-400 text-sm">
                      {sendForm.file ? sendForm.file.name : 'Click to upload document'}
                    </p>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowSendFax(null); setSendForm({ destination: '', header: '', file: null }); }}
                className="px-4 py-2 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSendFax}
                disabled={!sendForm.file || !sendForm.destination}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg"
              >
                <Send className="w-4 h-4" />
                Send Fax
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAdd || editing) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editing ? 'Edit Fax Configuration' : 'Create Fax Configuration'}
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
                <label className="block text-sm text-slate-400 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="Sales Fax"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="fax@example.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Caller ID Number</label>
                  <input
                    type="text"
                    value={formData.callerIdNumber}
                    onChange={(e) => setFormData({ ...formData, callerIdNumber: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                    placeholder="100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Caller ID Name</label>
                  <input
                    type="text"
                    value={formData.callerIdName}
                    onChange={(e) => setFormData({ ...formData, callerIdName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                    placeholder="Company Name"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                  placeholder="Fax for sales department"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500/20"
                />
                Enabled
              </label>
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

      {/* Fax Configs Grid */}
      {faxConfigs.length === 0 ? (
        <div className="text-center py-12 bg-slate-800/50 border border-slate-700/50 rounded-xl">
          <FileText className="w-12 h-12 mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400">No fax configurations</p>
          <p className="text-slate-500 text-sm mt-1">Create a fax extension to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {faxConfigs.map((config) => (
            <div key={config.extension} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.enabled ? 'bg-emerald-500/20' : 'bg-slate-700'}`}>
                    <Phone className={`w-5 h-5 ${config.enabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{config.extension}</h3>
                    <p className="text-slate-400 text-xs">{config.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditing(config.extension); setFormData(config); }}
                    className="p-2 text-slate-400 hover:text-white"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(config.extension)}
                    className="p-2 text-slate-400 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {config.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-300 truncate">{config.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${config.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                    {config.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>

              {/* File Counts & Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => viewFiles(config.extension, 'inbox')}
                    className="text-sm text-slate-400 hover:text-emerald-400 flex items-center gap-1"
                  >
                    <Inbox className="w-4 h-4" />
                    {config.inboxCount > 0 ? `${config.inboxCount} received` : 'Inbox'}
                  </button>
                  <button
                    onClick={() => viewFiles(config.extension, 'outbox')}
                    className="text-sm text-slate-400 hover:text-blue-400 flex items-center gap-1"
                  >
                    <SendHorizonal className="w-4 h-4" />
                    {config.outboxCount > 0 ? `${config.outboxCount} sent` : 'Sent'}
                  </button>
                </div>
                <button
                  onClick={() => setShowSendFax(config.extension)}
                  className="flex items-center gap-1 px-3 py-1 bg-emerald-500/20 text-emerald-400 text-sm rounded-lg hover:bg-emerald-500/30"
                >
                  <Send className="w-3 h-3" />
                  Send
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
