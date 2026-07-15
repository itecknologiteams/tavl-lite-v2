/**
 * Alert Type Configuration Manager
 * Supervisor UI for managing which event names are monitored by the broadcaster.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Save,
  X,
  ToggleLeft,
  ToggleRight,
  Battery,
  MapPin,
  Shield,
  Moon,
  Bell,
  Loader2,
  RefreshCw,
  Search,
  Download,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { api } from '@services/api';
import { useAlertDistributionStore } from '@store/alertDistributionStore';
import { toast } from '@store/toastStore';

interface AlertTypeConfig {
  id: number;
  event_name: string;
  category: string;
  severity: string;
  match_mode: string;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DiscoveredEvent {
  Name: string;
  cnt: number;
}

const CATEGORIES = [
  { id: 'battery',  label: 'Battery',  icon: Battery, color: 'text-amber-400',  bg: 'bg-amber-500/20' },
  { id: 'geofence', label: 'Geofence', icon: MapPin,  color: 'text-purple-400', bg: 'bg-purple-500/20' },
  { id: 'critical', label: 'Critical', icon: Shield,  color: 'text-red-400',    bg: 'bg-red-500/20' },
  { id: 'late_night', label: 'Late Night', icon: Moon, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  { id: 'other',    label: 'Other',    icon: Bell,    color: 'text-slate-400',   bg: 'bg-slate-500/20' },
];

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

const getCategoryMeta = (cat: string) =>
  CATEGORIES.find((c) => c.id === cat) || CATEGORIES[CATEGORIES.length - 1];

function guessCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('battery') || lower.includes('power voltage')) return 'battery';
  if (lower.includes('ignition') || lower.includes('din') || lower.includes('movement')
    || lower.includes('seat belt')) return 'critical';
  return 'geofence';
}

function guessSeverity(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('battery') || lower.includes('ignition') || lower.includes('din')) return 'high';
  if (lower.includes('movement') || lower.includes('seat belt') || lower.includes('power')) return 'medium';
  return 'medium';
}

export default function AlertTypeConfigManager() {
  const [configs, setConfigs] = useState<AlertTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoveredEvents, setDiscoveredEvents] = useState<DiscoveredEvent[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [importingNames, setImportingNames] = useState<Set<string>>(new Set());
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('geofence');
  const [newSeverity, setNewSeverity] = useState('medium');
  const [newMatchMode, setNewMatchMode] = useState<'exact' | 'contains'>('exact');

  const session = useAlertDistributionStore((s) => s.session);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.distribution.getAlertTypes();
      if (res.success) {
        const data = Array.isArray(res.data) ? (res.data as AlertTypeConfig[]) : [];
        setConfigs(data);
      }
    } catch (e) {
      console.error('Failed to load alert type configs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  useEffect(() => {
    const handler = () => { fetchConfigs(); };
    window.addEventListener('alertConfigChanged', handler);
    return () => window.removeEventListener('alertConfigChanged', handler);
  }, [fetchConfigs]);

  const handleToggle = async (cfg: AlertTypeConfig) => {
    try {
      const res = await api.distribution.updateAlertType(cfg.id, { enabled: !cfg.enabled });
      if (res.success) {
        setConfigs((prev) => prev.map((c) => (c.id === cfg.id ? { ...c, enabled: !c.enabled } : c)));
        toast.success(`${cfg.event_name} ${cfg.enabled ? 'disabled' : 'enabled'}`);
      } else {
        toast.error('Failed to toggle alert type');
      }
    } catch (e) {
      toast.error('Failed to toggle alert type');
    }
  };

  const handleDelete = async (cfg: AlertTypeConfig) => {
    if (!confirm(`Delete alert type "${cfg.event_name}"? This cannot be undone.`)) return;
    try {
      const res = await api.distribution.deleteAlertType(cfg.id);
      if (res.success) {
        setConfigs((prev) => prev.filter((c) => c.id !== cfg.id));
        toast.success(`"${cfg.event_name}" deleted`);
      } else {
        toast.error('Failed to delete alert type');
      }
    } catch (e) {
      toast.error('Failed to delete alert type');
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await api.distribution.createAlertType({
        eventName: newName.trim(),
        category: newCategory,
        severity: newSeverity,
        matchMode: newMatchMode,
        userId: session?.user_id,
      });
      if (res.success && res.data) {
        setConfigs((prev) => [...prev, res.data as AlertTypeConfig]);
        setNewName('');
        setShowAdd(false);
        toast.success(`"${newName.trim()}" added`);
      } else {
        toast.error('Failed to create alert type');
      }
    } catch (e) {
      toast.error('Failed to create alert type');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscover = async () => {
    setDiscoverLoading(true);
    try {
      const res = await api.distribution.discoverEventNames(24);
      if (res.success && Array.isArray(res.data)) {
        setDiscoveredEvents(res.data as DiscoveredEvent[]);
        setShowDiscover(true);
      } else {
        toast.error('Failed to discover event names');
      }
    } catch {
      toast.error('Failed to connect to Tracking DB');
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleImportEvent = async (eventName: string) => {
    setImportingNames((prev) => new Set(prev).add(eventName));
    try {
      const cat = guessCategory(eventName);
      const sev = guessSeverity(eventName);
      const res = await api.distribution.createAlertType({
        eventName,
        category: cat,
        severity: sev,
        matchMode: 'exact',
        userId: session?.user_id,
      });
      if (res.success && res.data) {
        setConfigs((prev) => [...prev, res.data as AlertTypeConfig]);
        toast.success(`"${eventName}" imported`);
      }
    } catch {
      toast.error(`Failed to import "${eventName}"`);
    } finally {
      setImportingNames((prev) => { const n = new Set(prev); n.delete(eventName); return n; });
    }
  };

  const filtered = filterCat
    ? configs.filter((c) => c.category === filterCat)
    : configs;

  const grouped: Record<string, AlertTypeConfig[]> = {};
  for (const c of filtered) {
    (grouped[c.category] ||= []).push(c);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Alert Type Configuration</h2>
          <p className="text-sm text-slate-400 mt-1">
            Manage which event names the system monitors. Changes take effect immediately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchConfigs}
            disabled={loading}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleDiscover}
            disabled={discoverLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400
                     rounded-lg transition-colors border border-blue-500/30"
            title="Discover live event names from Tracking DB"
          >
            {discoverLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span className="text-sm font-medium">Discover Events</span>
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400
                     rounded-lg transition-colors border border-violet-500/30"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Add Alert Type</span>
          </button>
        </div>
      </div>

      {/* Enabled summary */}
      {configs.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/[0.03] border border-white/5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Total:</span>
            <span className="text-sm font-semibold text-white">{configs.length}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-slate-500">Enabled:</span>
            <span className="text-sm font-semibold text-emerald-400">{configs.filter(c => c.enabled).length}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span className="text-xs text-slate-500">Disabled:</span>
            <span className="text-sm font-semibold text-slate-400">{configs.filter(c => !c.enabled).length}</span>
          </div>
        </div>
      )}

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCat(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterCat === null
              ? 'bg-violet-500 text-white'
              : 'bg-white/5 text-slate-400 hover:bg-white/10'
          }`}
        >
          All ({configs.length})
        </button>
        {CATEGORIES.map((cat) => {
          const count = configs.filter((c) => c.category === cat.id).length;
          if (count === 0 && filterCat !== cat.id) return null;
          const CatIcon = cat.icon;
          return (
            <button
              key={cat.id}
              onClick={() => setFilterCat(filterCat === cat.id ? null : cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterCat === cat.id
                  ? `${cat.bg} ${cat.color} border border-current/30`
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              <CatIcon className="w-3.5 h-3.5" />
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="p-4 rounded-xl border border-violet-500/30 bg-violet-500/5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">New Alert Type</h3>
            <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Event Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. KHI L, Battery Status"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white
                         placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white
                         focus:outline-none focus:border-violet-500/50"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Severity</label>
              <select
                value={newSeverity}
                onChange={(e) => setNewSeverity(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white
                         focus:outline-none focus:border-violet-500/50"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Match Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setNewMatchMode('exact')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                    newMatchMode === 'exact'
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  Exact
                </button>
                <button
                  onClick={() => setNewMatchMode('contains')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                    newMatchMode === 'contains'
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  Contains
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white
                       rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Event Discovery Panel */}
      {showDiscover && discoveredEvents.length > 0 && (
        <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Live Events (last 24h)</h3>
              <span className="text-xs text-slate-500">{discoveredEvents.length} distinct event types</span>
            </div>
            <button onClick={() => setShowDiscover(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Click <strong className="text-blue-400">Import</strong> to add unconfigured events. Already configured events show a checkmark.
          </p>
          <div className="grid gap-1.5 max-h-72 overflow-y-auto pr-1">
            {discoveredEvents.map((evt) => {
              const alreadyConfigured = configs.some(
                (c) => c.event_name.toLowerCase() === evt.Name.toLowerCase()
              );
              return (
                <div
                  key={evt.Name}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                    alreadyConfigured ? 'bg-white/[0.02] border border-white/5' : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`font-medium ${alreadyConfigured ? 'text-slate-500' : 'text-white'}`}>
                      {evt.Name}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">{evt.cnt.toLocaleString()} events</span>
                  </div>
                  {alreadyConfigured ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <button
                      onClick={() => handleImportEvent(evt.Name)}
                      disabled={importingNames.has(evt.Name)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400
                               rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {importingNames.has(evt.Name) ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      Import
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && configs.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
        </div>
      )}

      {/* Grouped list */}
      {Object.entries(grouped).map(([category, items]) => {
        const meta = getCategoryMeta(category);
        const CatIcon = meta.icon;
        return (
          <div key={category} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-md ${meta.bg} flex items-center justify-center`}>
                <CatIcon className={`w-3.5 h-3.5 ${meta.color}`} />
              </div>
              <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
              <span className="text-xs text-slate-500">({items.length})</span>
            </div>

            <div className="grid gap-2">
              {items.map((cfg) => (
                <div
                  key={cfg.id}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                    cfg.enabled
                      ? 'bg-white/5 border-white/10'
                      : 'bg-white/[0.02] border-white/5 opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => handleToggle(cfg)}
                      className="flex-shrink-0"
                      title={cfg.enabled ? 'Disable' : 'Enable'}
                    >
                      {cfg.enabled ? (
                        <ToggleRight className="w-6 h-6 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-slate-500" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <span className="text-sm text-white font-medium">{cfg.event_name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          cfg.match_mode === 'contains'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-slate-500/20 text-slate-400'
                        }`}>
                          {cfg.match_mode}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          cfg.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                          cfg.severity === 'high' ? 'bg-amber-500/20 text-amber-400' :
                          cfg.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {cfg.severity}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(cfg)}
                    className="flex-shrink-0 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No alert types configured</p>
          <p className="text-xs mt-1">Add one to start monitoring events</p>
        </div>
      )}
    </div>
  );
}
