import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { adminApi } from '../stores/adminAuthStore';
import { useConfigStore } from '../stores/configStore';
import {
  Plus, Search, Edit2, Trash2, CheckCircle, Upload,
  X, Save, Eye, EyeOff, RefreshCw, Phone, Shield,
  ChevronDown, AlertCircle, Users, Wifi, WifiOff,
  Key, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Info, ArrowLeft, ArrowRight, ChevronUp, Shuffle,
  Voicemail, PhoneForwarded, BellOff, Clock, Mail, Settings2,
} from 'lucide-react';

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block">
      <Info className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 cursor-help" />
      <span className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded shadow-lg whitespace-nowrap max-w-xs">{text}</span>
    </span>
  );
}

interface Extension {
  extension: string;
  callerid: string;
  context: string;
  template: string;
  auth: { username: string; password?: string };
  status?: 'registered' | 'unavailable' | 'unknown';
  deviceIp?: string;
  contact?: string;
}

const AVAILABLE_CODECS = [
  { id: 'ulaw', label: 'G.711 u-law', desc: 'North America standard' },
  { id: 'alaw', label: 'G.711 a-law', desc: 'International standard' },
  { id: 'g729', label: 'G.729', desc: 'Low bandwidth' },
  { id: 'opus', label: 'Opus', desc: 'Modern, high quality' },
  { id: 'g722', label: 'G.722', desc: 'HD voice' },
  { id: 'gsm', label: 'GSM', desc: 'Mobile compatible' },
];

const CONTEXTS = [
  { value: 'internal', label: 'Standard', desc: 'Internal calls + outbound via default trunk — use for all agents and office staff' },
  { value: 'robocall-service', label: 'Robocall Service', desc: 'Outbound via dedicated robocall trunk — only for auto-dialer extensions' },
];

const TRANSPORTS = [
  { value: 'transport-udp', label: 'UDP (Standard)' },
  { value: 'transport-tcp', label: 'TCP' },
  { value: 'transport-tls', label: 'TLS (Encrypted)' },
  { value: 'transport-wss', label: 'WSS (WebSocket Secure)' },
];

interface FormData {
  extension: string;
  displayName: string;
  password: string;
  email: string;
  context: string;
  transport: string;
  codecs: string[];
  maxContacts: string;
  qualifyFrequency: string;
  directMedia: boolean;
  rtpSymmetric: boolean;
  rewriteContact: boolean;
  iceSupport: boolean;
  forceRport: boolean;
  dtmfMode: string;
  callTimeout: number;
  voicemailEnabled: boolean;
  callForwarding: string;
  dndEnabled: boolean;
}

const defaultFormData: FormData = {
  extension: '',
  displayName: '',
  password: '',
  email: '',
  context: 'internal',
  transport: 'transport-udp',
  codecs: ['ulaw', 'alaw', 'opus', 'g729'],
  maxContacts: '5',
  qualifyFrequency: '30',
  directMedia: false,
  rtpSymmetric: true,
  rewriteContact: true,
  iceSupport: true,
  forceRport: true,
  dtmfMode: 'rfc4733',
  callTimeout: 30,
  voicemailEnabled: true,
  callForwarding: '',
  dndEnabled: false,
};

function generatePassword(length = 16): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(b => chars[b % chars.length])
    .join('');
}

function extractIp(contact?: string): string {
  if (!contact) return '—';
  const match = contact.match(/@([\d.]+)/);
  return match ? match[1] : '—';
}

const WIZARD_STEPS = [
  { num: 1, label: 'Basics', icon: Phone },
  { num: 2, label: 'Call Handling', icon: PhoneForwarded },
  { num: 3, label: 'Advanced', icon: Settings2 },
] as const;

export function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'registered' | 'unavailable'>('all');
  const [showWizard, setShowWizard] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editorMode, setEditorMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [wizardStep, setWizardStep] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { addChange } = useConfigStore();

  useEffect(() => { fetchExtensions(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchExtensions = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/extensions');
      const data = await res.json();
      if (data.success) setExtensions(data.extensions);
    } catch (err) {
      console.error('Failed to fetch extensions:', err);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const total = extensions.length;
    const registered = extensions.filter(e => e.status === 'registered').length;
    const unavailable = total - registered;
    return { total, registered, unavailable };
  }, [extensions]);

  const filteredExtensions = useMemo(() => {
    return extensions.filter((ext) => {
      const matchesSearch =
        ext.extension.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ext.callerid?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || ext.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [extensions, searchTerm, filterStatus]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredExtensions.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, filteredExtensions.length);
  const paginatedExtensions = filteredExtensions.slice(startIdx, endIdx);

  const openWizard = async (mode: 'add' | 'edit', ext?: Extension) => {
    setEditorMode(mode);
    setWizardStep(1);
    setAdvancedOpen(false);
    setShowPassword(false);
    if (mode === 'edit' && ext) {
      const rawCtx = ext.context || 'internal';
      const mappedCtx = rawCtx === 'robocall-service' ? 'robocall-service' : 'internal';
      setFormData({
        extension: ext.extension,
        displayName: ext.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || '',
        password: '',
        email: '',
        context: mappedCtx,
        transport: 'transport-udp',
        codecs: ['ulaw', 'alaw', 'opus', 'g729'],
        maxContacts: '5',
        qualifyFrequency: '30',
        directMedia: false,
        rtpSymmetric: true,
        rewriteContact: true,
        iceSupport: true,
        forceRport: true,
        dtmfMode: 'rfc4733',
        callTimeout: 30,
        voicemailEnabled: true,
        callForwarding: '',
        dndEnabled: false,
      });
      setShowWizard(true);
      try {
        const res = await adminApi(`/extensions/${ext.extension}`);
        const data = await res.json();
        if (data.success && data.extension) {
          const ep = data.extension.endpoint || {};
          const aor = data.extension.aor || {};
          setFormData(prev => ({
            ...prev,
            context: ep.context || prev.context,
            transport: ep.transport || prev.transport,
            codecs: ep.allow ? ep.allow.replace('(', '').replace(')', '').split(',').map((c: string) => c.trim()).filter(Boolean) : prev.codecs,
            maxContacts: aor.max_contacts || prev.maxContacts,
            qualifyFrequency: aor.qualify_frequency || prev.qualifyFrequency,
            directMedia: ep.direct_media === 'yes',
            rtpSymmetric: ep.rtp_symmetric !== 'no',
            rewriteContact: ep.rewrite_contact !== 'no',
            iceSupport: ep.ice_support !== 'no',
            forceRport: ep.force_rport !== 'no',
            dtmfMode: ep.dtmf_mode || prev.dtmfMode,
            email: ep.email || prev.email,
            callTimeout: ep.call_timeout ? Number(ep.call_timeout) : prev.callTimeout,
            voicemailEnabled: ep.voicemail_enabled !== 'no' && ep.voicemail_enabled !== false,
            callForwarding: ep.call_forwarding || prev.callForwarding,
            dndEnabled: ep.dnd === 'yes' || ep.dnd === true,
          }));
        }
      } catch { /* use defaults */ }
    } else {
      setFormData({ ...defaultFormData });
      setShowWizard(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editorMode === 'add') {
        const res = await adminApi('/extensions', {
          method: 'POST',
          body: JSON.stringify({
            extension: formData.extension,
            name: formData.displayName,
            password: formData.password,
            context: formData.context,
            template: 'dual-endpoint',
            codecs: formData.codecs.join(','),
            transport: formData.transport,
            maxContacts: formData.maxContacts,
            qualifyFrequency: formData.qualifyFrequency,
            dtmfMode: formData.dtmfMode,
            directMedia: formData.directMedia,
            rtpSymmetric: formData.rtpSymmetric,
            rewriteContact: formData.rewriteContact,
            iceSupport: formData.iceSupport,
            forceRport: formData.forceRport,
            email: formData.email || undefined,
            callTimeout: formData.callTimeout,
            voicemailEnabled: formData.voicemailEnabled,
            callForwarding: formData.callForwarding || undefined,
            dndEnabled: formData.dndEnabled,
          }),
        });
        const data = await res.json();
        if (data.success) {
          addChange({ type: 'extension', name: formData.extension, action: 'create', data: formData });
          setShowWizard(false);
          fetchExtensions();
          setToast({ type: 'success', message: 'Phone line created successfully' });
        } else {
          setToast({ type: 'error', message: data.error });
        }
      } else {
        const res = await adminApi(`/extensions/${formData.extension}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formData.displayName,
            context: formData.context,
            password: formData.password || undefined,
            codecs: formData.codecs.join(','),
            transport: formData.transport,
            maxContacts: formData.maxContacts,
            qualifyFrequency: formData.qualifyFrequency,
            dtmfMode: formData.dtmfMode,
            directMedia: formData.directMedia,
            rtpSymmetric: formData.rtpSymmetric,
            rewriteContact: formData.rewriteContact,
            iceSupport: formData.iceSupport,
            forceRport: formData.forceRport,
            email: formData.email || undefined,
            callTimeout: formData.callTimeout,
            voicemailEnabled: formData.voicemailEnabled,
            callForwarding: formData.callForwarding || undefined,
            dndEnabled: formData.dndEnabled,
          }),
        });
        const data = await res.json();
        if (data.success) {
          addChange({ type: 'extension', name: formData.extension, action: 'update', data: formData });
          setShowWizard(false);
          fetchExtensions();
          setToast({ type: 'success', message: 'Phone line updated successfully' });
        } else {
          setToast({ type: 'error', message: data.error });
        }
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to save phone line' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ext: Extension) => {
    if (!confirm(`Delete phone line ${ext.extension} (${ext.callerid || 'unnamed'})?\n\nThis will remove the endpoint, auth, and AOR sections from pjsip.conf.`)) return;
    try {
      const res = await adminApi(`/extensions/${ext.extension}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        addChange({ type: 'extension', name: ext.extension, action: 'delete', data: ext });
        fetchExtensions();
        setToast({ type: 'success', message: 'Phone line deleted successfully' });
      } else {
        setToast({ type: 'error', message: data.error });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to delete phone line' });
    }
  };

  const handleImport = async () => {
    try {
      const lines = csvContent.trim().split('\n');
      const exts: { extension: string; name: string; password: string }[] = [];
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 3) {
          exts.push({ name: parts[0].trim(), extension: parts[1].trim(), password: parts[2].trim() });
        }
      }
      const res = await adminApi('/extensions/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ extensions: exts }),
      });
      const data = await res.json();
      if (data.success) {
        addChange({ type: 'extension', name: 'bulk-import', action: 'create', data: { count: data.added } });
        setShowImportModal(false);
        setCsvContent('');
        fetchExtensions();
        setToast({ type: 'success', message: `Imported ${data.added} phone lines, skipped ${data.skipped}` });
      } else {
        setToast({ type: 'error', message: data.error });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to import phone lines' });
    }
  };

  const toggleCodec = (codec: string) => {
    setFormData(prev => ({
      ...prev,
      codecs: prev.codecs.includes(codec)
        ? prev.codecs.filter(c => c !== codec)
        : [...prev.codecs, codec],
    }));
  };

  const canProceedStep1 = editorMode === 'edit'
    ? true
    : formData.extension.trim() !== '' && formData.password.trim() !== '';

  const canSave = editorMode === 'edit'
    ? true
    : formData.extension.trim() !== '' && formData.password.trim() !== '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Phone Lines</h1>
          <p className="text-slate-400 text-sm mt-1">Manage extensions, registration, and device settings</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImportModal(true)}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg flex items-center gap-2 transition-all">
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button onClick={() => openWizard('add')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium">
            <Plus className="w-4 h-4" /> New Phone Line
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Total Lines</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Online</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.registered}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Offline</p>
              <p className="text-2xl font-bold text-slate-400 mt-1">{stats.unavailable}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-slate-500/10 flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-slate-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder="Search by number or name..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg py-2 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50" />
        </div>
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg py-2 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 [&>option]:bg-slate-800">
            <option value="all">All Status</option>
            <option value="registered">Online</option>
            <option value="unavailable">Offline</option>
          </select>
          <button onClick={fetchExtensions}
            className="p-2 bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-400 hover:text-white transition-all" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Extensions Table */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-700/50 bg-slate-800">
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Number</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Device IP</th>
                <th className="text-right py-3 px-4 text-slate-400 text-xs font-medium uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {loading ? (
                <tr><td colSpan={5} className="py-16 text-center text-slate-500">
                  <div className="w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm">Loading phone lines...</p>
                </td></tr>
              ) : filteredExtensions.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center text-slate-500">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No phone lines found</p>
                </td></tr>
              ) : (
                paginatedExtensions.map((ext) => (
                  <tr key={ext.extension} className="hover:bg-slate-700/20 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                          ext.status === 'registered' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700/50 text-slate-400'
                        }`}>
                          <Phone className="w-4 h-4" />
                        </div>
                        <span className="text-white font-medium text-sm font-mono">{ext.extension}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300 text-sm">
                      {ext.callerid?.replace(/^"?([^"]*)"?\s*<.*>$/, '$1') || <span className="text-slate-500 italic">Not set</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        ext.status === 'registered'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-slate-600/20 text-slate-400 border border-slate-600/20'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${ext.status === 'registered' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                        {ext.status === 'registered' ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-400 text-sm font-mono">
                        {extractIp(ext.contact) !== '—'
                          ? extractIp(ext.contact)
                          : ext.deviceIp || '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openWizard('edit', ext)}
                          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all" title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(ext)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && filteredExtensions.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                Page <span className="text-white font-medium">{safePage}</span> of <span className="text-white font-medium">{totalPages}</span>
                {' '}<span className="text-slate-500">({startIdx + 1}–{endIdx} of {filteredExtensions.length}{filteredExtensions.length !== extensions.length ? `, filtered from ${extensions.length}` : ''})</span>
              </span>
              <select value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="bg-slate-700/60 border border-slate-600/50 rounded text-xs text-slate-300 py-1 px-2 focus:outline-none [&>option]:bg-slate-800">
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentPage(1)} disabled={safePage <= 1}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="First page">
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                className="px-2 py-1.5 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1">
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce((acc: (number | 'dot')[], p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('dot');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === 'dot' ? (
                    <span key={`dot-${i}`} className="px-1.5 text-slate-600 text-xs">...</span>
                  ) : (
                    <button key={item} onClick={() => setCurrentPage(item as number)}
                      className={`min-w-[32px] h-8 rounded text-xs font-medium transition-all ${
                        safePage === item
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                      }`}>
                      {item}
                    </button>
                  )
                )}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                className="px-2 py-1.5 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={safePage >= totalPages}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="Last page">
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ──────────── Wizard Modal ──────────── */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowWizard(false)} />
          <div className="relative w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-wizard-in">

            {/* Wizard Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-700/50">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-white">
                  {editorMode === 'add' ? 'New Phone Line' : `Edit Line ${formData.extension}`}
                </h2>
                <button onClick={() => setShowWizard(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Step Indicator */}
              <div className="flex items-center justify-between">
                {WIZARD_STEPS.map((step, idx) => (
                  <React.Fragment key={step.num}>
                    <button
                      onClick={() => {
                        if (step.num < wizardStep || (step.num === 2 && canProceedStep1) || (step.num === 3 && canProceedStep1)) {
                          setWizardStep(step.num);
                        }
                      }}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all ${
                        wizardStep === step.num
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : wizardStep > step.num
                            ? 'text-emerald-400/60 hover:text-emerald-400 cursor-pointer'
                            : 'text-slate-500 cursor-default'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                        wizardStep === step.num
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                          : wizardStep > step.num
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400/60'
                            : 'border-slate-600 text-slate-500'
                      }`}>
                        {wizardStep > step.num ? <CheckCircle className="w-4 h-4" /> : step.num}
                      </div>
                      <span className="text-sm font-medium hidden sm:inline">{step.label}</span>
                    </button>
                    {idx < WIZARD_STEPS.length - 1 && (
                      <div className={`flex-1 h-px mx-2 transition-colors ${
                        wizardStep > step.num ? 'bg-emerald-500/40' : 'bg-slate-700'
                      }`} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Wizard Content */}
            <div className="flex-1 overflow-y-auto p-6">

              {/* ── Step 1: Basics ── */}
              {wizardStep === 1 && (
                <div className="space-y-5">
                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Phone Line Number {editorMode === 'add' && <span className="text-red-400 ml-0.5">*</span>}
                      <Tooltip text="A unique 3-5 digit number people dial to reach this line" />
                    </label>
                    <input type="text" value={formData.extension}
                      onChange={(e) => setFormData({ ...formData, extension: e.target.value })}
                      placeholder="e.g. 200" disabled={editorMode === 'edit'}
                      className={`w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 ${editorMode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`} />
                  </div>

                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Display Name
                      <Tooltip text="Name shown on caller ID when this line makes a call" />
                    </label>
                    <input type="text" value={formData.displayName}
                      onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                      placeholder="e.g. John Smith"
                      className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" />
                  </div>

                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Password {editorMode === 'add' && <span className="text-red-400 ml-0.5">*</span>}
                      <Tooltip text={editorMode === 'edit' ? 'Leave blank to keep the current password' : 'Password used by the phone or softphone to register'} />
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          placeholder={editorMode === 'edit' ? 'Leave blank to keep current' : 'Enter a secure password'}
                          className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 pr-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 font-mono" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button type="button"
                        onClick={() => { setFormData({ ...formData, password: generatePassword() }); setShowPassword(true); }}
                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap border border-slate-600/50"
                        title="Generate a random password">
                        <Shuffle className="w-3.5 h-3.5" /> Generate
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      Email
                      <Tooltip text="Optional email for voicemail notifications and account recovery" />
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input type="email" value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="user@company.com"
                        className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: Call Handling ── */}
              {wizardStep === 2 && (
                <div className="space-y-6">
                  {/* Ring Duration Slider */}
                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-3">
                      <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                      Ring Duration
                      <Tooltip text="How long the phone rings before going to voicemail or hanging up" />
                    </label>
                    <div className="bg-slate-900/40 border border-slate-700/50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-slate-500">10s</span>
                        <span className="text-lg font-bold text-emerald-400 tabular-nums">{formData.callTimeout}s</span>
                        <span className="text-xs text-slate-500">60s</span>
                      </div>
                      <input type="range" min={10} max={60} step={5} value={formData.callTimeout}
                        onChange={(e) => setFormData({ ...formData, callTimeout: Number(e.target.value) })}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-700 accent-emerald-500
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:shadow-lg
                          [&::-webkit-slider-thumb]:shadow-emerald-500/30 [&::-webkit-slider-thumb]:cursor-pointer
                          [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
                          [&::-moz-range-thumb]:bg-emerald-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer" />
                      <div className="flex justify-between mt-1">
                        {[10, 20, 30, 40, 50, 60].map(v => (
                          <span key={v} className={`text-[10px] ${formData.callTimeout === v ? 'text-emerald-400 font-medium' : 'text-slate-600'}`}>{v}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Voicemail Toggle */}
                  <div className="flex items-center justify-between p-4 bg-slate-900/40 border border-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${formData.voicemailEnabled ? 'bg-emerald-500/10' : 'bg-slate-700/40'}`}>
                        <Voicemail className={`w-4.5 h-4.5 ${formData.voicemailEnabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white flex items-center">
                          Enable Voicemail
                          <Tooltip text="When enabled, unanswered calls are sent to a voicemail box after the ring duration expires" />
                        </p>
                        <p className="text-xs text-slate-500">Callers can leave a message when you don't answer</p>
                      </div>
                    </div>
                    <ToggleSwitch value={formData.voicemailEnabled} onChange={(v) => setFormData({ ...formData, voicemailEnabled: v })} />
                  </div>

                  {/* Call Forwarding */}
                  <div>
                    <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                      <PhoneForwarded className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                      Forward Calls To
                      <Tooltip text="When set, incoming calls will be forwarded to this number instead of ringing the phone" />
                    </label>
                    <input type="text" value={formData.callForwarding}
                      onChange={(e) => setFormData({ ...formData, callForwarding: e.target.value })}
                      placeholder="Optional — e.g. 5551234567 or ext 300"
                      className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" />
                  </div>

                  {/* Do Not Disturb Toggle */}
                  <div className="flex items-center justify-between p-4 bg-slate-900/40 border border-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${formData.dndEnabled ? 'bg-red-500/10' : 'bg-slate-700/40'}`}>
                        <BellOff className={`w-4.5 h-4.5 ${formData.dndEnabled ? 'text-red-400' : 'text-slate-500'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white flex items-center">
                          Do Not Disturb
                          <Tooltip text="Immediately rejects all incoming calls — callers hear a busy signal" />
                        </p>
                        <p className="text-xs text-slate-500">Reject all incoming calls automatically</p>
                      </div>
                    </div>
                    <ToggleSwitch value={formData.dndEnabled} onChange={(v) => setFormData({ ...formData, dndEnabled: v })} />
                  </div>
                </div>
              )}

              {/* ── Step 3: Advanced Settings ── */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-slate-400 text-sm mb-2">
                    <Shield className="w-4 h-4" />
                    <span>Most users can leave these at their defaults.</span>
                  </div>

                  <button
                    onClick={() => setAdvancedOpen(!advancedOpen)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/40 border border-slate-700/50 rounded-lg hover:border-slate-600 transition-all text-sm font-medium text-white"
                  >
                    <span className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-emerald-400" />
                      {advancedOpen ? 'Hide Technical Settings' : 'Show Technical Settings'}
                    </span>
                    {advancedOpen
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>

                  {advancedOpen && (
                    <div className="space-y-6 pt-2 animate-wizard-in">
                      {/* Extension Type / Context */}
                      <div>
                        <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                          Line Type
                          <Tooltip text="Standard for everyone. Robocall Service only for the auto-dialer extension." />
                        </label>
                        <select value={formData.context} onChange={(e) => setFormData({ ...formData, context: e.target.value })}
                          className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 [&>option]:bg-slate-800">
                          {CONTEXTS.map(ctx => (
                            <option key={ctx.value} value={ctx.value}>{ctx.label}</option>
                          ))}
                        </select>
                        <p className="text-xs text-slate-500 mt-1">
                          {CONTEXTS.find(c => c.value === formData.context)?.desc}
                        </p>
                      </div>

                      {/* Transport */}
                      <div>
                        <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                          SIP Transport
                          <Tooltip text="Protocol for SIP signaling. UDP is the most common choice." />
                        </label>
                        <select value={formData.transport} onChange={(e) => setFormData({ ...formData, transport: e.target.value })}
                          className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 [&>option]:bg-slate-800">
                          {TRANSPORTS.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Codecs */}
                      <div>
                        <label className="flex items-center text-xs font-medium text-slate-300 mb-2">
                          Audio Codecs
                          <Tooltip text="Audio encoding formats this phone supports. Select at least one." />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {AVAILABLE_CODECS.map(codec => {
                            const selected = formData.codecs.includes(codec.id);
                            return (
                              <button key={codec.id} type="button" onClick={() => toggleCodec(codec.id)}
                                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all text-xs ${
                                  selected
                                    ? 'bg-emerald-500/5 border-emerald-500/30 text-white'
                                    : 'bg-slate-900/30 border-slate-700/30 text-slate-400 hover:border-slate-600'
                                }`}>
                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                                  selected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-600'
                                }`}>
                                  {selected && <CheckCircle className="w-3 h-3 text-white" />}
                                </div>
                                <div className="min-w-0">
                                  <span className="font-medium block truncate">{codec.label}</span>
                                  <span className="text-[10px] text-slate-500 block">{codec.desc}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {formData.codecs.length === 0 && (
                          <div className="flex items-center gap-2 mt-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            At least one codec must be selected
                          </div>
                        )}
                      </div>

                      {/* Registration Settings */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                            Max Devices
                            <Tooltip text="How many phones/apps can register to this line simultaneously" />
                          </label>
                          <input type="number" value={formData.maxContacts} min={1} max={20}
                            onChange={(e) => setFormData({ ...formData, maxContacts: e.target.value })}
                            className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" />
                        </div>
                        <div>
                          <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                            Health Check Interval
                            <Tooltip text="How often (in seconds) the server checks if this device is still connected" />
                          </label>
                          <div className="relative">
                            <input type="number" value={formData.qualifyFrequency} min={0} max={300}
                              onChange={(e) => setFormData({ ...formData, qualifyFrequency: e.target.value })}
                              className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 pr-10 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">sec</span>
                          </div>
                        </div>
                      </div>

                      {/* DTMF Mode */}
                      <div>
                        <label className="flex items-center text-xs font-medium text-slate-300 mb-1.5">
                          Tone Dialing Method
                          <Tooltip text="How touch-tone key presses are transmitted during a call" />
                        </label>
                        <select value={formData.dtmfMode} onChange={(e) => setFormData({ ...formData, dtmfMode: e.target.value })}
                          className="w-full bg-slate-900/40 border border-slate-700/50 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 [&>option]:bg-slate-800">
                          <option value="rfc4733">RFC 4733 (Recommended)</option>
                          <option value="inband">In-band Audio</option>
                          <option value="info">SIP INFO</option>
                          <option value="auto">Auto Detect</option>
                        </select>
                      </div>

                      {/* NAT & Media Toggles */}
                      <div>
                        <label className="text-xs font-medium text-slate-300 mb-2 block">Network & Media</label>
                        <div className="space-y-2">
                          <AdvancedToggle label="Force RPort" tooltip="Force the use of rport in SIP signaling for NAT traversal"
                            value={formData.forceRport} onChange={(v) => setFormData({ ...formData, forceRport: v })} />
                          <AdvancedToggle label="Rewrite Contact" tooltip="Rewrite SIP Contact header with the actual source address to fix NAT issues"
                            value={formData.rewriteContact} onChange={(v) => setFormData({ ...formData, rewriteContact: v })} />
                          <AdvancedToggle label="Symmetric RTP" tooltip="Send audio back to the same address it was received from"
                            value={formData.rtpSymmetric} onChange={(v) => setFormData({ ...formData, rtpSymmetric: v })} />
                          <AdvancedToggle label="Direct Media" tooltip="Allow audio to flow directly between phones without going through the server"
                            value={formData.directMedia} onChange={(v) => setFormData({ ...formData, directMedia: v })} />
                          <AdvancedToggle label="ICE Support" tooltip="Interactive Connectivity Establishment — required for WebRTC-based softphones"
                            value={formData.iceSupport} onChange={(v) => setFormData({ ...formData, iceSupport: v })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Wizard Footer */}
            <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/80 flex items-center justify-between">
              <div>
                {wizardStep === 1 ? (
                  <button onClick={() => setShowWizard(false)}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
                    Cancel
                  </button>
                ) : (
                  <button onClick={() => setWizardStep(s => s - 1)}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1.5">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Save available on all steps for quick save */}
                <button onClick={handleSave}
                  disabled={saving || !canSave}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                  {saving ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="w-4 h-4" /> {editorMode === 'add' ? 'Create' : 'Save'}</>
                  )}
                </button>
                {wizardStep < 3 && (
                  <button
                    onClick={() => setWizardStep(s => s + 1)}
                    disabled={wizardStep === 1 && !canProceedStep1}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    Next <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────── Import Modal ──────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl animate-wizard-in">
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <div>
                <h3 className="text-base font-semibold text-white">Bulk Import Phone Lines</h3>
                <p className="text-xs text-slate-400 mt-0.5">Import multiple lines from CSV data</p>
              </div>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 text-xs">
                <p className="font-medium mb-1">CSV Format: Name, Extension, Password</p>
                <p className="text-blue-400/70">Each line creates one phone line with the dual-endpoint template</p>
              </div>
              <textarea value={csvContent} onChange={(e) => setCsvContent(e.target.value)}
                placeholder={`John Doe,300,secret123\nJane Smith,301,secret456`}
                rows={10}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-3 px-4 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50 resize-none" />
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-all">Cancel</button>
                <button onClick={handleImport} disabled={!csvContent.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg flex items-center gap-2 disabled:opacity-40">
                  <Upload className="w-4 h-4" /> Import Lines
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-3 animate-wizard-in ${
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
        @keyframes wizard-in {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-wizard-in {
          animation: wizard-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} role="switch" aria-checked={value}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${value ? 'bg-emerald-500' : 'bg-slate-600'}`}>
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function AdvancedToggle({ label, tooltip, value, onChange }: { label: string; tooltip: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-slate-900/30 border border-slate-700/30 rounded-lg">
      <span className="text-sm text-white flex items-center">
        {label}
        <Tooltip text={tooltip} />
      </span>
      <ToggleSwitch value={value} onChange={onChange} />
    </div>
  );
}

export default ExtensionsPage;
