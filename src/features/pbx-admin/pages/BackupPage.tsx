import React, { useEffect, useState } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import {
  Plus, Trash2, RefreshCw, Database, Download, Upload,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle,
  FileText, X, Shield, Clock, HardDrive,
} from 'lucide-react';

interface BackupFile {
  name: string;
  size: number;
}

interface Backup {
  id: string;
  timestamp: string;
  files: BackupFile[];
  totalSize: number;
  path: string;
}

export function BackupPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => { fetchBackups(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const resp = await adminApi('/backups');
      const data = await resp.json();
      if (data.success) setBackups(data.backups);
    } catch (err) {
      console.error('Failed to fetch backups:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const resp = await adminApi('/backups', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: data.message || 'Backup created successfully' });
        fetchBackups();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to create backup' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to create backup' });
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    setConfirmRestore(null);
    setRestoringId(id);
    try {
      const resp = await adminApi(`/backups/${id}/restore`, { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: `Restored ${data.restored?.length || 0} config files. FreeSWITCH reloaded.` });
      } else {
        setToast({ type: 'error', message: data.error || 'Restore failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to restore backup' });
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete backup "${id}"? This cannot be undone.`)) return;
    try {
      const resp = await adminApi(`/backups/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Backup deleted' });
        fetchBackups();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete backup' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatTimestamp = (ts: string) => {
    try {
      const match = ts.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        const d = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
        return d.toLocaleString();
      }
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading backups...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Backup & Restore</h1>
          <p className="text-sm text-slate-400 mt-1">Back up and restore FreeSWITCH configuration files</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchBackups} className="px-3 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50"
          >
            {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {creating ? 'Creating...' : 'Create Backup'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Database className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{backups.length}</p>
              <p className="text-xs text-slate-400">Total Backups</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {formatSize(backups.reduce((s, b) => s + b.totalSize, 0))}
              </p>
              <p className="text-xs text-slate-400">Total Size</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {backups.length > 0 ? formatTimestamp(backups[0].timestamp).split(',')[0] : '—'}
              </p>
              <p className="text-xs text-slate-400">Latest Backup</p>
            </div>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-medium text-blue-400">Backup includes</h4>
          <p className="text-xs text-slate-400 mt-1">XML dialplans, SIP profiles, call center configs — stored in <code className="text-blue-400/80">/var/backups/freeswitch/</code></p>
        </div>
      </div>

      {/* Backups Table */}
      {backups.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-12 text-center">
          <Database className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No Backups Yet</h3>
          <p className="text-sm text-slate-400 mb-6">Create your first backup to save a snapshot of your FreeSWITCH configuration.</p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4 inline mr-2" /> Create Backup
          </button>
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-800/60">
                <th className="w-10"></th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Backup ID</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Timestamp</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Files</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Size</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {backups.map(backup => {
                const isExpanded = expanded.has(backup.id);
                const isRestoring = restoringId === backup.id;
                return (
                  <React.Fragment key={backup.id}>
                    <tr className="hover:bg-slate-700/20 transition-colors">
                      <td className="pl-3">
                        <button onClick={() => toggleExpand(backup.id)} className="p-1 rounded hover:bg-slate-700/50">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Database className="w-4 h-4 text-blue-400" />
                          <span className="text-sm text-white font-medium font-mono">{backup.id.replace('backup-', '').substring(0, 20)}...</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {formatTimestamp(backup.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-300">{backup.files.length} files</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {formatSize(backup.totalSize)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setConfirmRestore(backup.id)}
                            disabled={isRestoring}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all disabled:opacity-50 flex items-center gap-1"
                          >
                            {isRestoring ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            Restore
                          </button>
                          <button
                            onClick={() => handleDelete(backup.id)}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
                            title="Delete backup"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 bg-slate-800/30">
                          <div className="pl-8 space-y-2">
                            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2">Included Files</p>
                            <div className="grid grid-cols-2 gap-2">
                              {backup.files.map(file => (
                                <div key={file.name} className="flex items-center gap-2 bg-slate-700/30 rounded-lg px-3 py-2">
                                  <FileText className="w-4 h-4 text-slate-400" />
                                  <span className="text-sm text-white">{file.name}</span>
                                  <span className="text-xs text-slate-500 ml-auto">{formatSize(file.size)}</span>
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Path: {backup.path}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {confirmRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmRestore(null)} />
          <div className="relative bg-slate-900 border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Restore Backup?</h2>
                <p className="text-sm text-slate-400 mt-1">
                  This will <span className="text-red-400 font-medium">overwrite</span> the current FreeSWITCH configuration files with the backup copies and reload FreeSWITCH.
                </p>
              </div>
            </div>

            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
              <p className="text-xs text-red-400 font-medium mb-2">The following files will be overwritten:</p>
              <ul className="text-xs text-slate-400 space-y-1">
                <li className="flex items-center gap-2"><FileText className="w-3 h-3" /> pjsip.conf (Extensions, Trunks)</li>
                <li className="flex items-center gap-2"><FileText className="w-3 h-3" /> extensions.conf (Dialplan, IVR)</li>
                <li className="flex items-center gap-2"><FileText className="w-3 h-3" /> queues.conf (Queue configuration)</li>
                <li className="flex items-center gap-2"><FileText className="w-3 h-3" /> musiconhold.conf (Music on Hold)</li>
              </ul>
            </div>

            <p className="text-xs text-amber-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />
              It is recommended to create a backup of the current config before restoring.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setConfirmRestore(null)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all">
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestore)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 text-white text-sm font-medium flex items-center gap-2 hover:from-red-400 hover:to-orange-500 transition-all"
              >
                <Upload className="w-4 h-4" /> Restore & Reload
              </button>
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
        }`} style={{ animation: 'slideInRight 0.3s ease-out' }}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <style>{`
        @keyframes slideInRight { from{transform:translateX(100%)} to{transform:translateX(0)} }
      `}</style>
    </div>
  );
}
