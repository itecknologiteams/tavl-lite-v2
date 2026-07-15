import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBlacklist, addBlacklist, removeBlacklist, bulkBlacklist, extractError } from '../api';
import type { BlacklistEntry } from '../types';
import {
  ShieldOff, Plus, Trash2, Loader2, AlertCircle, CheckCircle, XCircle,
  Search, Upload, X,
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

const QUICK_REASONS = ['Spam', 'Harassment', 'Robocall', 'Fraud', 'Other'] as const;

export function BlacklistPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();
  const [search, setSearch] = useState('');
  const [addNumber, setAddNumber] = useState('');
  const [addReason, setAddReason] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const { data: entries = [], isLoading, isError } = useQuery<BlacklistEntry[]>({
    queryKey: ['blacklist-v2'],
    queryFn: getBlacklist,
    staleTime: 30_000,
  });

  const addMut = useMutation({
    mutationFn: addBlacklist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist-v2'] });
      setAddNumber('');
      setAddReason('');
      setShowAdd(false);
      toast('success', 'Number added to blacklist');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const removeMut = useMutation({
    mutationFn: removeBlacklist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist-v2'] });
      toast('success', 'Number removed from blacklist');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const bulkMut = useMutation({
    mutationFn: bulkBlacklist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist-v2'] });
      setBulkText('');
      setShowBulk(false);
      toast('success', 'Bulk import completed');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const parseBulkNumbers = (text: string) => {
    return text
      .split(/[\n,;]+/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const parts = trimmed.split(/\s*[|\t]\s*/);
        const number = (parts[0] || '').trim();
        const reason = (parts[1] || '').trim();
        if (!number) return null;
        return { number, ...(reason && { reason }) };
      })
      .filter(Boolean) as { number: string; reason?: string }[];
  };

  const bulkNumbers = parseBulkNumbers(bulkText);

  const filtered = entries.filter((e) =>
    !search || e.number.includes(search) || (e.reason || '').toLowerCase().includes(search.toLowerCase()),
  );

  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Blacklist</h1>
          <p className="text-slate-400 mt-1 font-medium">Block calls from specific numbers</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulk(true)}
            className="flex items-center gap-2 bg-slate-800/50 border border-slate-700/50 text-slate-400 hover:text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
          >
            <Upload className="w-4 h-4" /> Bulk Import
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
          >
            <Plus className="w-4 h-4" /> Add Number
          </button>
        </div>
      </div>

      {/* Add Single Number */}
      {showAdd && (
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-red-500/20 p-6 space-y-4 animate-fade-in">
          <h3 className="text-sm font-bold text-white">Block a Number</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Phone Number</label>
              <input
                type="text"
                value={addNumber}
                onChange={(e) => setAddNumber(e.target.value)}
                placeholder="+12125551234"
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Reason</label>
              <input
                type="text"
                value={addReason}
                onChange={(e) => setAddReason(e.target.value)}
                placeholder="Spam caller"
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Quick Reason</label>
            <div className="flex flex-wrap gap-2">
              {QUICK_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => setAddReason(reason)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                    addReason === reason
                      ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                      : 'bg-slate-700/50 border-slate-600/40 text-slate-400 hover:text-white hover:border-slate-500'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              onClick={() => addMut.mutate({ number: addNumber, reason: addReason || undefined })}
              disabled={!addNumber.trim() || addMut.isPending}
              className="flex items-center gap-2 bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
            >
              {addMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
              Block Number
            </button>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulk && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowBulk(false)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-bold text-white">Bulk Import Numbers</h2>
              <button onClick={() => setShowBulk(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-1 font-semibold">Format: one number per line, optionally separated by | with a reason</p>
                <pre className="text-xs text-slate-500 font-mono">
{`+12125551234
+19175559876 | Spam
+14155550000 | Robocall`}
                </pre>
              </div>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder="Paste numbers here…"
                rows={10}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono resize-y"
              />
              {bulkNumbers.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">Will block</span>
                  <span className="font-bold text-indigo-400">{bulkNumbers.length}</span>
                  <span className="text-slate-400">{bulkNumbers.length === 1 ? 'number' : 'numbers'}</span>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowBulk(false)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => bulkMut.mutate(bulkNumbers)}
                  disabled={bulkNumbers.length === 0 || bulkMut.isPending}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-60"
                >
                  {bulkMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Import {bulkNumbers.length > 0 ? bulkNumbers.length : ''} Numbers
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Confirm Modal */}
      {removeConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setRemoveConfirm(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Remove from Blacklist</h3>
                  <p className="text-sm text-slate-400">Unblock <span className="font-mono text-white">{removeConfirm}</span>?</p>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setRemoveConfirm(null)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => { removeMut.mutate(removeConfirm); setRemoveConfirm(null); }}
                  className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search numbers or reasons…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
        />
      </div>

      {/* Blacklist Table */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
        {isLoading && (
          <div className="flex flex-col items-center justify-center p-20">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
            <p className="text-slate-400 text-sm">Loading blacklist…</p>
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center p-16">
            <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
            <p className="text-white font-semibold">Failed to load blacklist</p>
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center p-16">
            <ShieldOff className="w-12 h-12 text-slate-500 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-1">
              {search ? 'No matching entries' : 'Blacklist is Empty'}
            </h3>
            <p className="text-slate-400 text-sm">
              {search ? 'Try a different search term' : 'Add numbers to block unwanted callers'}
            </p>
          </div>
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <>
            <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-700/40">
              <p className="text-xs text-slate-500 font-semibold">{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}{search && ' matching'}</p>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900/40 border-b border-slate-700/50">
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">Number</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden md:table-cell">Reason</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest hidden md:table-cell">Added</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filtered.map((entry) => (
                  <tr key={entry.id || entry.number} className="hover:bg-slate-700/10 transition-colors group">
                    <td className="px-4 py-3 text-white font-mono font-semibold text-sm">{entry.number}</td>
                    <td className="px-4 py-3 text-slate-400 text-sm hidden md:table-cell">
                      {entry.reason ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-700/50 border border-slate-600/40">{entry.reason}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setRemoveConfirm(entry.number)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          title="Remove from blacklist"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

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
