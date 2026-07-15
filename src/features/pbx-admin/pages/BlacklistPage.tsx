import React, { useEffect, useState, useMemo } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Shield, ShieldOff, Plus, Trash2, Search, Upload, X,
  RefreshCw, Phone, AlertCircle, CheckCircle, Ban,
} from 'lucide-react';

interface BlacklistEntry {
  number: string;
  reason: string;
}

const QUICK_REASONS = ['Spam', 'Harassment', 'Wrong Number', 'Telemarketer', 'Custom'] as const;

export function BlacklistPage() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [addNumber, setAddNumber] = useState('');
  const [addReason, setAddReason] = useState('');
  const [selectedQuickReason, setSelectedQuickReason] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => { fetchBlacklist(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchBlacklist = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/blacklist');
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setToast({ type: 'error', message: 'Failed to load blacklist' });
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = useMemo(() => {
    if (!searchTerm) return entries;
    const term = searchTerm.toLowerCase();
    return entries.filter(
      (e) => e.number.toLowerCase().includes(term) || e.reason?.toLowerCase().includes(term),
    );
  }, [entries, searchTerm]);

  const isValidNumber = (num: string) => /^[0-9+*#]+$/.test(num.trim());

  const handleAdd = async () => {
    const number = addNumber.trim();
    if (!number || !isValidNumber(number)) return;
    setAddSaving(true);
    try {
      const res = await adminApi('/blacklist', {
        method: 'POST',
        body: JSON.stringify({ number, reason: addReason.trim() || 'Blocked' }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddModal(false);
        resetAddForm();
        fetchBlacklist();
        setToast({ type: 'success', message: `${number} added to blacklist` });
        await reloadFs();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to add number' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to add number' });
    } finally {
      setAddSaving(false);
    }
  };

  const handleRemove = async (number: string) => {
    setShowConfirmDelete(null);
    try {
      const res = await adminApi(`/blacklist/${encodeURIComponent(number)}`, { method: 'DELETE' });
      if (res.ok) {
        fetchBlacklist();
        setToast({ type: 'success', message: `${number} removed from blacklist` });
        await reloadFs();
      } else {
        const data = await res.json();
        setToast({ type: 'error', message: data.error || 'Failed to remove number' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to remove number' });
    }
  };

  const bulkParsed = useMemo(() => {
    if (!bulkText.trim()) return [];
    return bulkText
      .trim()
      .split('\n')
      .map((line) => {
        const [number, ...rest] = line.split(',');
        return { number: number?.trim(), reason: rest.join(',').trim() || 'Blocked' };
      })
      .filter((e) => e.number && isValidNumber(e.number));
  }, [bulkText]);

  const handleBulkImport = async () => {
    if (bulkParsed.length === 0) return;
    setBulkSaving(true);
    try {
      const res = await adminApi('/blacklist/bulk', {
        method: 'POST',
        body: JSON.stringify({ numbers: bulkParsed }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowBulkModal(false);
        setBulkText('');
        fetchBlacklist();
        setToast({ type: 'success', message: `Imported ${bulkParsed.length} numbers to blacklist` });
        await reloadFs();
      } else {
        setToast({ type: 'error', message: data.error || 'Bulk import failed' });
      }
    } catch {
      setToast({ type: 'error', message: 'Bulk import failed' });
    } finally {
      setBulkSaving(false);
    }
  };

  const resetAddForm = () => {
    setAddNumber('');
    setAddReason('');
    setSelectedQuickReason(null);
  };

  const selectQuickReason = (reason: string) => {
    if (reason === 'Custom') {
      setSelectedQuickReason('Custom');
      setAddReason('');
    } else {
      setSelectedQuickReason(reason);
      setAddReason(reason);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            Call Blacklist
          </h1>
          <p className="text-slate-400 text-sm mt-1">Block unwanted callers from reaching the PBX</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkModal(true)}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg flex items-center gap-2 transition-all">
            <Upload className="w-4 h-4" /> Bulk Import
          </button>
          <button onClick={() => { resetAddForm(); setShowAddModal(true); }}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium">
            <Plus className="w-4 h-4" /> Add Number
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-1 gap-4">
        <div className="bg-slate-800/60 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Total Blocked Numbers</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{entries.length}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Ban className="w-5 h-5 text-red-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder="Search by number or reason..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg py-2 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/50" />
        </div>
        <button onClick={fetchBlacklist}
          className="p-2 bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-400 hover:text-white transition-all" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Blacklist Table */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-700/50 bg-slate-800">
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Phone Number</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Reason</th>
                <th className="text-right py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {loading ? (
                <tr><td colSpan={3} className="py-16 text-center text-slate-500">
                  <div className="w-7 h-7 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm">Loading blacklist...</p>
                </td></tr>
              ) : filteredEntries.length === 0 ? (
                <tr><td colSpan={3} className="py-16 text-center text-slate-500">
                  <ShieldOff className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No numbers blocked</p>
                  <p className="text-xs text-slate-600 mt-1">
                    {searchTerm ? 'No results match your search' : 'Add numbers to protect your PBX from unwanted calls'}
                  </p>
                </td></tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.number} className="hover:bg-slate-700/20 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                          <Phone className="w-4 h-4 text-red-400" />
                        </div>
                        <span className="text-white font-medium text-sm font-mono">{entry.number}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-400 text-sm">{entry.reason || '—'}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end">
                        {showConfirmDelete === entry.number ? (
                          <div className="flex items-center gap-2 animate-fade-in">
                            <span className="text-xs text-slate-400">Remove?</span>
                            <button onClick={() => handleRemove(entry.number)}
                              className="px-2.5 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-md transition-all">
                              Yes
                            </button>
                            <button onClick={() => setShowConfirmDelete(null)}
                              className="px-2.5 py-1 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md transition-all">
                              No
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setShowConfirmDelete(entry.number)}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                            title="Remove from blacklist">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Number Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl animate-slide-in-right">
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-400" /> Add to Blacklist
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Block a phone number from reaching the PBX</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Phone Number <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" value={addNumber}
                    onChange={(e) => setAddNumber(e.target.value)}
                    placeholder="e.g., 03001234567"
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-2.5 pl-9 pr-4 text-white text-sm focus:outline-none focus:border-red-500/50" />
                </div>
                {addNumber && !isValidNumber(addNumber) && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Only digits, +, *, and # are allowed
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Quick Reason</label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_REASONS.map((reason) => (
                    <button key={reason} onClick={() => selectQuickReason(reason)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        selectedQuickReason === reason
                          ? 'bg-red-500/15 border-red-500/40 text-red-400'
                          : 'bg-slate-700/40 border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                      }`}>
                      {reason}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Reason</label>
                <input type="text" value={addReason}
                  onChange={(e) => { setAddReason(e.target.value); setSelectedQuickReason(e.target.value ? null : selectedQuickReason); }}
                  placeholder="e.g., Spam caller"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-2.5 px-4 text-white text-sm focus:outline-none focus:border-red-500/50" />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-all">Cancel</button>
                <button onClick={handleAdd}
                  disabled={addSaving || !addNumber.trim() || !isValidNumber(addNumber)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium">
                  {addSaving ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Adding...</>
                  ) : (
                    <><Ban className="w-4 h-4" /> Block Number</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl animate-slide-in-right">
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-red-400" /> Bulk Import
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Add multiple numbers to the blacklist at once</p>
              </div>
              <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                <p className="font-medium mb-1">Enter one number per line. Optionally add a reason after a comma.</p>
                <p className="text-red-400/70">Numbers must contain only digits, +, *, or #</p>
              </div>

              <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                placeholder={`03001234567,Spam caller\n03009876543,Telemarketer`}
                rows={8}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-3 px-4 text-white text-sm font-mono focus:outline-none focus:border-red-500/50 resize-none" />

              {bulkText.trim() && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                  bulkParsed.length > 0
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                }`}>
                  {bulkParsed.length > 0 ? (
                    <><CheckCircle className="w-3.5 h-3.5" /> {bulkParsed.length} valid number{bulkParsed.length !== 1 ? 's' : ''} will be imported</>
                  ) : (
                    <><AlertCircle className="w-3.5 h-3.5" /> No valid numbers detected</>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-all">Cancel</button>
                <button onClick={handleBulkImport}
                  disabled={bulkSaving || bulkParsed.length === 0}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium">
                  {bulkSaving ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing...</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Import {bulkParsed.length} Number{bulkParsed.length !== 1 ? 's' : ''}</>
                  )}
                </button>
              </div>
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
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
