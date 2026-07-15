import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Clock, Calendar, Plus, Trash2, Edit2, Save, X, CheckCircle, XCircle,
  Sun, Moon, Briefcase, Info,
} from 'lucide-react';

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block">
      <Info className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 cursor-help" />
      <span className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded shadow-lg whitespace-nowrap max-w-xs">{text}</span>
    </span>
  );
}

interface TimeCondition {
  name: string;
  extension: string;
  description?: string;
  conditions: TimeRange[];
  destinationMatch: string;
  destinationMismatch: string;
  enabled: boolean;
}

interface TimeRange {
  id: string;
  type: 'time' | 'date' | 'weekday';
  start: string;
  end: string;
  days?: number[]; // 0-6 for Sunday-Saturday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function TimeConditionsPage() {
  const [conditions, setConditions] = useState<TimeCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<TimeCondition>>({
    name: '',
    extension: '',
    description: '',
    conditions: [],
    destinationMatch: '',
    destinationMismatch: '',
    enabled: true,
  });
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
      const res = await adminApi('/time-conditions');
      const data = await res.json();
      if (data.success) setConditions(data.conditions);
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const url = editing ? `/time-conditions/${editing}` : '/time-conditions';
      const method = editing ? 'PUT' : 'POST';
      const res = await adminApi(url, { method, body: JSON.stringify(formData) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: editing ? 'Schedule updated' : 'Schedule created' });
        await reloadFs();
        setShowAdd(false);
        setEditing(null);
        setFormData({ name: '', extension: '', description: '', conditions: [], destinationMatch: '', destinationMismatch: '', enabled: true });
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to save' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save schedule' });
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete schedule "${name}"?`)) return;
    try {
      const res = await adminApi(`/time-conditions/${name}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Schedule deleted' });
        await reloadFs();
        fetchData();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete' });
    }
  };

  const addCondition = () => {
    const newCondition: TimeRange = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'weekday',
      start: '09:00',
      end: '17:00',
      days: [1, 2, 3, 4, 5], // Mon-Fri default
    };
    setFormData(prev => ({
      ...prev,
      conditions: [...(prev.conditions || []), newCondition]
    }));
  };

  const removeCondition = (id: string) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions?.filter(c => c.id !== id) || []
    }));
  };

  const updateCondition = (id: string, updates: Partial<TimeRange>) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions?.map(c => c.id === id ? { ...c, ...updates } : c) || []
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading schedules...</p>
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
            <Clock className="w-6 h-6 text-emerald-400" />
            Business Hours
          </h1>
          <p className="text-slate-400 text-sm mt-1">Set when your phone system follows different schedules</p>
        </div>
        <button onClick={() => { setShowAdd(true); setEditing(null); }}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Schedule
        </button>
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

      {/* Add/Edit Form */}
      {(showAdd || editing) && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-400" />
            {editing ? 'Edit Schedule' : 'New Schedule'}
          </h3>

          <div className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg mb-4">
            <span className="text-sm text-slate-300 inline-flex items-center">
              Enabled
              <Tooltip text="When active, calls follow this schedule" />
            </span>
            <button
              type="button"
              aria-pressed={formData.enabled !== false}
              onClick={() => setFormData({ ...formData, enabled: formData.enabled === false })}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${formData.enabled !== false ? 'bg-emerald-500' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${formData.enabled !== false ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="e.g., Business Hours"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Extension</label>
              <input
                type="text"
                value={formData.extension}
                onChange={(e) => setFormData({ ...formData, extension: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="e.g., *8001"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="Brief description of this schedule"
              />
            </div>
          </div>

          {/* Conditions */}
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300 inline-flex items-center">
                Time ranges
                <Tooltip text="The hours during which this schedule applies" />
              </span>
              <button onClick={addCondition}
                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Time Range
              </button>
            </div>

            {formData.conditions?.map((cond) => (
              <div key={cond.id} className="bg-slate-900/50 rounded-lg p-3 flex items-center gap-3">
                <select
                  value={cond.type}
                  onChange={(e) => updateCondition(cond.id, { type: e.target.value as any })}
                  className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                >
                  <option value="weekday">Weekdays</option>
                  <option value="time">Time Range</option>
                  <option value="date">Date Range</option>
                </select>

                {cond.type === 'weekday' && (
                  <div className="flex gap-1">
                    {WEEKDAYS.map((day, idx) => (
                      <button
                        key={day}
                        onClick={() => {
                          const currentDays = cond.days || [];
                          const newDays = currentDays.includes(idx)
                            ? currentDays.filter(d => d !== idx)
                            : [...currentDays, idx];
                          updateCondition(cond.id, { days: newDays });
                        }}
                        className={`w-8 h-8 rounded text-xs font-medium transition-all ${
                          cond.days?.includes(idx)
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                )}

                {cond.type !== 'date' && (
                  <>
                    <input
                      type="time"
                      value={cond.start}
                      onChange={(e) => updateCondition(cond.id, { start: e.target.value })}
                      className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                    />
                    <span className="text-slate-400">to</span>
                    <input
                      type="time"
                      value={cond.end}
                      onChange={(e) => updateCondition(cond.id, { end: e.target.value })}
                      className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                    />
                  </>
                )}

                <button onClick={() => removeCondition(cond.id)}
                  className="ml-auto p-1 text-slate-400 hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {formData.conditions?.length === 0 && (
              <p className="text-sm text-slate-500 italic">No time ranges added yet</p>
            )}
          </div>

          {/* Destinations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-emerald-400 mb-1 flex items-center gap-1">
                <Sun className="w-3 h-3" /> Destination When Match
              </label>
              <input
                type="text"
                value={formData.destinationMatch}
                onChange={(e) => setFormData({ ...formData, destinationMatch: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-emerald-500/30 rounded-lg text-white text-sm"
                placeholder="e.g., queue sales-queue"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Moon className="w-3 h-3" /> Destination When No Match
              </label>
              <input
                type="text"
                value={formData.destinationMismatch}
                onChange={(e) => setFormData({ ...formData, destinationMismatch: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="e.g., voicemail 100"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowAdd(false); setEditing(null); }}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm">
              Cancel
            </button>
            <button onClick={handleSave}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2">
              <Save className="w-4 h-4" />
              {editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Conditions List */}
      <div className="space-y-4">
        {conditions.map((cond) => (
          <div key={cond.name} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  cond.enabled ? 'bg-emerald-500/20' : 'bg-slate-700'
                }`}>
                  {cond.enabled ? <Sun className="w-5 h-5 text-emerald-400" /> : <Moon className="w-5 h-5 text-slate-500" />}
                </div>
                <div>
                  <h3 className="text-white font-medium flex items-center gap-2">
                    {cond.name}
                    <span className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-400">{cond.extension}</span>
                  </h3>
                  <p className="text-xs text-slate-400">{cond.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setEditing(cond.name); setFormData(cond); setShowAdd(false); }}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(cond.name)}
                  className="p-2 text-slate-400 hover:text-red-400 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {cond.conditions.map((c, idx) => (
                <span key={idx} className="px-2 py-1 bg-slate-700/50 rounded text-xs text-slate-300">
                  {c.type === 'weekday' && c.days?.map(d => WEEKDAYS[d]).join(', ')}
                  {c.type !== 'date' && ` ${c.start}-${c.end}`}
                </span>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="text-emerald-400">Match: {cond.destinationMatch}</div>
              <div className="text-slate-400">No Match: {cond.destinationMismatch}</div>
            </div>
          </div>
        ))}

        {conditions.length === 0 && !showAdd && (
          <div className="text-center py-12 text-slate-500">
            <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="mb-2">No schedules configured</p>
            <button onClick={() => setShowAdd(true)} className="text-emerald-400 hover:underline text-sm">
              Create your first schedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
