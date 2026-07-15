import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBackups, createBackup, restoreBackup, deleteBackup, extractError } from '../api';
import type { Backup } from '../types';
import {
  Archive, Plus, Trash2, RotateCcw, Loader2, AlertCircle, CheckCircle, XCircle,
  HardDrive, ChevronDown, ChevronUp, AlertTriangle, FileText, Info, X,
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

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();
  const [expandedBackup, setExpandedBackup] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);

  const { data: backups = [], isLoading, isError } = useQuery<Backup[]>({
    queryKey: ['backups-v2'],
    queryFn: getBackups,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: createBackup,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['backups-v2'] });
      toast('success', `Backup created: ${data.filename || data.backupId || 'done'}`);
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const restoreMut = useMutation({
    mutationFn: restoreBackup,
    onSuccess: () => {
      toast('success', 'Backup restored successfully — FreeSWITCH may restart');
      setRestoreTarget(null);
      setRestoreConfirmText('');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups-v2'] });
      toast('success', 'Backup deleted');
      setDeleteTarget(null);
    },
    onError: (err) => toast('error', extractError(err)),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Backups</h1>
          <p className="text-slate-400 mt-1 font-medium">FreeSWITCH configuration backups and restore points</p>
        </div>
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
        >
          {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create Backup
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-400">What's included in backups</p>
          <p className="text-xs text-blue-400/70 mt-0.5">
            Backups include FreeSWITCH configuration files (dialplan, directory, SIP profiles), 
            custom scripts, IVR recordings, and voicemail greetings. Database records and CDR logs 
            are managed separately.
          </p>
        </div>
      </div>

      {/* Restore Confirm Modal */}
      {restoreTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setRestoreTarget(null); setRestoreConfirmText(''); }}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Restore Backup</h2>
                  <p className="text-sm text-slate-400 mt-0.5">This is a destructive operation</p>
                </div>
              </div>

              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
                <p className="text-sm text-red-400 font-semibold">Warning: Restoring will overwrite your current configuration</p>
                <ul className="text-xs text-red-400/80 space-y-1 list-disc list-inside">
                  <li>All current FreeSWITCH configuration will be replaced</li>
                  <li>Active calls may be dropped during the restore process</li>
                  <li>FreeSWITCH will restart automatically after restore</li>
                  <li>This action cannot be undone — create a backup first</li>
                </ul>
              </div>

              <div className="bg-slate-900/50 rounded-xl p-3 flex items-center gap-3 border border-slate-700/30">
                <HardDrive className="w-5 h-5 text-slate-500 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white font-mono font-semibold">{restoreTarget.filename}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(restoreTarget.size)} — {restoreTarget.created ? new Date(restoreTarget.created).toLocaleString() : 'Unknown date'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Type <span className="text-red-400 font-mono">RESTORE</span> to confirm
                </label>
                <input
                  type="text"
                  value={restoreConfirmText}
                  onChange={(e) => setRestoreConfirmText(e.target.value)}
                  placeholder="RESTORE"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all font-mono"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setRestoreTarget(null); setRestoreConfirmText(''); }}
                  className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => restoreMut.mutate(restoreTarget.id)}
                  disabled={restoreConfirmText !== 'RESTORE' || restoreMut.isPending}
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                >
                  {restoreMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Restore Backup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Delete Backup</h3>
                  <p className="text-sm text-slate-400">
                    Delete <span className="font-mono text-white">{deleteTarget.filename}</span>?
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500">This backup file will be permanently removed.</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => deleteMut.mutate(deleteTarget.id)}
                  disabled={deleteMut.isPending}
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                >
                  {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading backups…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load backups</p>
        </div>
      )}
      {!isLoading && !isError && backups.length === 0 && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Archive className="w-12 h-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No Backups</h3>
          <p className="text-slate-400 text-sm mb-4">Create a backup to save your current configuration</p>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-60"
          >
            {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create First Backup
          </button>
        </div>
      )}
      {!isLoading && !isError && backups.length > 0 && (
        <div className="space-y-3">
          {backups.map((backup) => {
            const isExpanded = expandedBackup === backup.id;

            return (
              <div key={backup.id} className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-xl bg-slate-700/40 border border-slate-600/40 flex-shrink-0">
                      <HardDrive className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-white font-mono font-semibold truncate">{backup.filename}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-slate-500">{formatBytes(backup.size)}</span>
                        <span className="text-xs text-slate-600">
                          {backup.created ? new Date(backup.created).toLocaleString() : '—'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                          backup.status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : backup.status === 'failed'
                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                            : 'bg-slate-700/50 text-slate-400 border-slate-600/40'
                        }`}>
                          {backup.status || 'ready'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {backup.files && backup.files.length > 0 && (
                      <button
                        onClick={() => setExpandedBackup(isExpanded ? null : backup.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-700/50 text-slate-400 hover:text-white border border-slate-600/40 transition-all"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {backup.files.length} files
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                    <button
                      onClick={() => { setRestoreTarget(backup); setRestoreConfirmText(''); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all"
                      title="Restore this backup"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restore
                    </button>
                    <button
                      onClick={() => setDeleteTarget(backup)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Delete backup"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expandable File List */}
                {isExpanded && backup.files && backup.files.length > 0 && (
                  <div className="border-t border-slate-700/40 px-4 py-3 bg-slate-900/30">
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Included Files</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {backup.files.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/20">
                          <FileText className="w-3 h-3 text-slate-600 flex-shrink-0" />
                          <span className="text-xs text-slate-400 font-mono truncate">{file}</span>
                        </div>
                      ))}
                    </div>
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
