import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Plus, Edit2, Trash2, Save, X, RefreshCw, Phone, PhoneCall,
  Clock, Music, Upload, Play, Pause, Volume2, FileAudio,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle, Hash,
  Calendar, Sun, Moon, ArrowRight, Repeat, PhoneOff, Users,
  Headphones, ExternalLink, BookOpen, ToggleLeft, ToggleRight,
  Mic, Search, Grid3X3, List, Copy, Eye, Trash, Download, Info,
} from 'lucide-react';

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block">
      <Info className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400 cursor-help" />
      <span className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-700 text-slate-200 rounded shadow-lg whitespace-nowrap max-w-xs">{text}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface IvrEntry {
  digit: string;
  destination: { type: string; target: string };
  label: string;
}

interface IvrTimeCondition {
  enabled: boolean;
  timezone: string;
  businessHours: { day: string; start: string; end: string; enabled: boolean }[];
  holidays: { date: string; name: string }[];
  afterHoursGreeting: string;
  afterHoursDestination: { type: string; target: string };
}

interface IvrMenu {
  name: string;
  description: string;
  greeting: string;
  timeout: number;
  maxRetries: number;
  directDial: boolean;
  entries: IvrEntry[];
  invalidDestination: { type: string; target: string };
  timeoutDestination: { type: string; target: string };
  timeCondition?: IvrTimeCondition;
  rawContent?: string;
}

interface Recording {
  name: string;
  path: string;
  fullPath?: string;
  size?: number;
  format?: string;
  modified?: string;
  duration?: string;
  sampleRate?: string;
  channels?: string;
  freeswitchReady?: boolean;
}

interface Destinations {
  queues: string[];
  extensions: { extension: string; name: string }[];
  ivrs: string[];
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const DAYS_OF_WEEK = [
  { day: 'monday', label: 'Monday', short: 'Mon' },
  { day: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { day: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { day: 'thursday', label: 'Thursday', short: 'Thu' },
  { day: 'friday', label: 'Friday', short: 'Fri' },
  { day: 'saturday', label: 'Saturday', short: 'Sat' },
  { day: 'sunday', label: 'Sunday', short: 'Sun' },
];

const DEST_TYPES = [
  { value: 'none', label: 'Not Configured', icon: X, color: 'slate' },
  { value: 'queue', label: 'Queue', icon: Headphones, color: 'blue' },
  { value: 'extension', label: 'Extension', icon: Phone, color: 'green' },
  { value: 'ivr', label: 'Phone Menu', icon: Grid3X3, color: 'purple' },
  { value: 'external', label: 'External Number', icon: ExternalLink, color: 'orange' },
  { value: 'playback', label: 'Announcement', icon: Volume2, color: 'teal' },
  { value: 'repeat', label: 'Repeat Menu', icon: Repeat, color: 'amber' },
  { value: 'directory', label: 'Directory', icon: BookOpen, color: 'cyan' },
  { value: 'hangup', label: 'Hang Up', icon: PhoneOff, color: 'red' },
];

const TIMEZONES = [
  { value: 'Asia/Karachi', label: 'Asia/Karachi (PKT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (AST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
];

const defaultTimeCondition: IvrTimeCondition = {
  enabled: false,
  timezone: 'Asia/Karachi',
  businessHours: DAYS_OF_WEEK.map(d => ({
    day: d.day,
    start: '09:00',
    end: '18:00',
    enabled: !['saturday', 'sunday'].includes(d.day),
  })),
  holidays: [],
  afterHoursGreeting: '',
  afterHoursDestination: { type: 'playback', target: 'vm-goodbye' },
};

const defaultIvr: IvrMenu = {
  name: '',
  description: '',
  greeting: '',
  timeout: 10,
  maxRetries: 3,
  directDial: false,
  entries: [],
  invalidDestination: { type: 'repeat', target: '' },
  timeoutDestination: { type: 'hangup', target: '' },
  timeCondition: { ...defaultTimeCondition },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export function IvrPage() {
  const [activeTab, setActiveTab] = useState<'menus' | 'recordings' | 'time'>('menus');
  const [ivrs, setIvrs] = useState<IvrMenu[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [destinations, setDestinations] = useState<Destinations>({ queues: [], extensions: [], ivrs: [] });
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<IvrMenu>({ ...defaultIvr });
  const [editorTab, setEditorTab] = useState<'general' | 'keymap' | 'timeout' | 'time' | 'advanced'>('general');
  const [saving, setSaving] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string; converted?: boolean; conversionNote?: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [recordingsSearchTerm, setRecordingsSearchTerm] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [ivrRes, recRes] = await Promise.all([
        adminApi('/ivr'),
        adminApi('/recordings'),
      ]);
      const [ivrData, recData] = await Promise.all([ivrRes.json(), recRes.json()]);
      if (ivrData.success) {
        setIvrs(ivrData.ivrs);
        setDestinations(ivrData.destinations);
      }
      if (recData.success) setRecordings(recData.recordings);
    } catch (err) {
      console.error('Failed to fetch phone menu data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openEditor = (mode: 'add' | 'edit', ivr?: IvrMenu) => {
    setEditorMode(mode);
    setEditorTab('general');
    if (mode === 'edit' && ivr) {
      setFormData({
        ...ivr,
        timeCondition: ivr.timeCondition || { ...defaultTimeCondition },
      });
    } else {
      setFormData({ ...defaultIvr, timeCondition: { ...defaultTimeCondition } });
    }
    setShowEditor(true);
  };

  const handleSave = async () => {
    const invalidKeys = formData.entries.filter(
      e => e.destination.type !== 'none' && e.destination.type !== 'hangup' && e.destination.type !== 'repeat' && e.destination.type !== 'directory' && !e.destination.target
    );
    if (invalidKeys.length > 0) {
      const digits = invalidKeys.map(e => e.digit).join(', ');
      setToast({ type: 'error', message: `Key(s) ${digits} have a destination type but no target specified` });
      return;
    }

    setSaving(true);
    try {
      const url = editorMode === 'add' ? '/ivr' : `/ivr/${formData.name}`;
      const method = editorMode === 'add' ? 'POST' : 'PUT';
      const resp = await adminApi(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await resp.json();
      if (data.success) {
        setShowEditor(false);
        setToast({ type: 'success', message: editorMode === 'add' ? `Phone menu "${formData.name}" created successfully` : `Phone menu "${formData.name}" updated successfully` });
        await reloadFs();
        fetchAll();
      } else {
        setToast({ type: 'error', message: data.error || 'Save failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save phone menu' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete phone menu "${name}"? This will remove the dialplan context.`)) return;
    try {
      const resp = await adminApi(`/ivr/${name}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: `Phone menu "${name}" deleted successfully` });
        await reloadFs();
        fetchAll();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete phone menu' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to delete phone menu' });
    }
  };

  const handleUploadAudio = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setUploadingAudio(true);
    setUploadResult(null);

    let successCount = 0;
    let lastNote = '';

    for (const file of fileArray) {
      try {
        const formDataUpload = new FormData();
        formDataUpload.append('file', file);
        const resp = await adminApi('/recordings/upload', { method: 'POST', body: formDataUpload });
        const data = await resp.json();
        if (data.success) {
          successCount++;
          lastNote = data.conversionNote || '';
        } else {
          setUploadResult({ success: false, message: `${file.name}: ${data.error}` });
        }
      } catch (err: any) {
        setUploadResult({ success: false, message: `${file.name}: ${err.message}` });
      }
    }

    if (successCount > 0) {
      setUploadResult({
        success: true,
        message: successCount === 1
          ? `"${fileArray[0].name}" uploaded and ready for FreeSWITCH`
          : `${successCount} files uploaded and ready for FreeSWITCH`,
        converted: true,
        conversionNote: lastNote,
      });
      fetchAll();
    }

    setUploadingAudio(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => setUploadResult(null), 8000);
  };

  const handleDeleteRecording = async (name: string) => {
    if (!confirm(`Delete recording "${name}"?`)) return;
    try {
      const resp = await adminApi(`/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setToast({ type: 'success', message: `Recording "${name}" deleted successfully` });
        await reloadFs();
        fetchAll();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to delete recording' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to delete recording' });
    }
  };

  const setEntry = useCallback((digit: string, field: string, value: any) => {
    setFormData(prev => {
      const entries = [...prev.entries];
      const idx = entries.findIndex(e => e.digit === digit);
      if (idx >= 0) {
        entries[idx] = { ...entries[idx], [field]: value };
      } else {
        const newEntry: IvrEntry = { digit, destination: { type: 'none', target: '' }, label: '' };
        (newEntry as any)[field] = value;
        entries.push(newEntry);
      }
      return { ...prev, entries };
    });
  }, []);

  const getEntry = useCallback((digit: string): IvrEntry => {
    return formData.entries.find(e => e.digit === digit) || { digit, destination: { type: 'none', target: '' }, label: '' };
  }, [formData.entries]);

  const filteredIvrs = useMemo(() => {
    if (!searchTerm) return ivrs;
    const q = searchTerm.toLowerCase();
    return ivrs.filter(i => i.name.toLowerCase().includes(q) || i.greeting.toLowerCase().includes(q));
  }, [ivrs, searchTerm]);

  const filteredRecordings = useMemo(() => {
    if (!recordingsSearchTerm) return recordings;
    const q = recordingsSearchTerm.toLowerCase();
    return recordings.filter(r => r.name.toLowerCase().includes(q));
  }, [recordings, recordingsSearchTerm]);

  /* ------------------------------------------------------------------ */
  /*  Destination Picker subcomponent                                    */
  /* ------------------------------------------------------------------ */
  const DestinationPicker = ({ value, onChange, label }: {
    value: { type: string; target: string };
    onChange: (v: { type: string; target: string }) => void;
    label?: string;
  }) => {
    const destType = DEST_TYPES.find(d => d.value === value.type) || DEST_TYPES[0];
    return (
      <div className="space-y-2">
        {label && <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</label>}
        <div className="flex gap-2">
          <select
            value={value.type}
            onChange={e => onChange({ type: e.target.value, target: '' })}
            className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
          >
            {DEST_TYPES.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>

          {value.type === 'queue' && (
            <select
              value={value.target}
              onChange={e => onChange({ ...value, target: e.target.value })}
              className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="">Select Queue...</option>
              {destinations.queues.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          )}

          {value.type === 'extension' && (
            <select
              value={value.target}
              onChange={e => onChange({ ...value, target: e.target.value })}
              className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="">Select Extension...</option>
              {destinations.extensions.map(ext => (
                <option key={ext.extension} value={ext.extension}>{ext.extension} — {ext.name}</option>
              ))}
            </select>
          )}

          {value.type === 'ivr' && (
            <select
              value={value.target}
              onChange={e => onChange({ ...value, target: e.target.value })}
              className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="">Select phone menu...</option>
              {destinations.ivrs.filter(i => i !== formData.name).map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          )}

          {value.type === 'external' && (
            <input
              type="text"
              placeholder="Enter number (e.g. 03001234567)"
              value={value.target}
              onChange={e => onChange({ ...value, target: e.target.value })}
              className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
            />
          )}

          {value.type === 'playback' && (
            <select
              value={value.target}
              onChange={e => onChange({ ...value, target: e.target.value })}
              className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="">Select Recording...</option>
              <optgroup label="Custom Recordings">
                {recordings.map(r => <option key={r.path} value={r.path}>{r.name}</option>)}
              </optgroup>
              <optgroup label="System Sounds">
                <option value="vm-goodbye">Goodbye</option>
                <option value="queue-thankyou">Thank You</option>
                <option value="beep">Beep</option>
                <option value="invalid">Invalid</option>
              </optgroup>
            </select>
          )}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading phone menus...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Phone Menus (IVR)</h1>
          <p className="text-sm text-slate-400 mt-1">Configure auto attendant phone menus, audio recordings, and time-based routing</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchAll} className="px-3 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {activeTab === 'menus' && (
            <button onClick={() => openEditor('add')} className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Phone Menu
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Grid3X3 className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{ivrs.length}</p>
              <p className="text-xs text-slate-400">Phone Menus</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <FileAudio className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{recordings.length}</p>
              <p className="text-xs text-slate-400">Audio Files</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{ivrs.filter(i => i.timeCondition?.enabled).length}</p>
              <p className="text-xs text-slate-400">Time Conditions</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Hash className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{ivrs.reduce((s, i) => s + i.entries.length, 0)}</p>
              <p className="text-xs text-slate-400">Key Mappings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-800/40 border border-slate-700/50 rounded-xl p-1">
        {[
          { id: 'menus' as const, label: 'Phone Menus', icon: Grid3X3 },
          { id: 'recordings' as const, label: 'Audio Manager', icon: FileAudio },
          { id: 'time' as const, label: 'Time Conditions', icon: Clock },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ============================================================ */}
      {/*  IVR MENUS TAB                                                */}
      {/* ============================================================ */}
      {activeTab === 'menus' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search phone menus..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-800/40 border border-slate-700/50 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
              />
            </div>
          </div>

          {filteredIvrs.length === 0 ? (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-12 text-center">
              <Grid3X3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No Phone Menus</h3>
              <p className="text-sm text-slate-400 mb-6">Create your first phone menu so callers hear a greeting and can press keys to reach the right place.</p>
              <button onClick={() => openEditor('add')} className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium">
                <Plus className="w-4 h-4 inline mr-2" /> Create Phone Menu
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredIvrs.map(ivr => (
                <IvrCard
                  key={ivr.name}
                  ivr={ivr}
                  onEdit={() => openEditor('edit', ivr)}
                  onDelete={() => handleDelete(ivr.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  RECORDINGS TAB                                               */}
      {/* ============================================================ */}
      {activeTab === 'recordings' && (
        <div className="space-y-4">
          {/* Upload Result Banner */}
          {uploadResult && (
            <div className={`flex items-start gap-3 p-4 rounded-xl border ${
              uploadResult.success
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-red-500/5 border-red-500/20'
            }`}>
              {uploadResult.success
                ? <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              }
              <div>
                <p className={`text-sm font-medium ${uploadResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {uploadResult.message}
                </p>
                {uploadResult.conversionNote && (
                  <p className="text-xs text-slate-400 mt-0.5">{uploadResult.conversionNote}</p>
                )}
              </div>
              <button onClick={() => setUploadResult(null)} className="ml-auto text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Big Upload Zone */}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.wma,.opus,.gsm,.aiff,.amr"
            multiple
            className="hidden"
            onChange={e => e.target.files && handleUploadAudio(e.target.files)}
          />
          <div
            onClick={() => !uploadingAudio && fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.setAttribute('data-dragover', 'true'); }}
            onDragLeave={e => { e.currentTarget.removeAttribute('data-dragover'); }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.removeAttribute('data-dragover');
              if (e.dataTransfer.files?.length) handleUploadAudio(e.dataTransfer.files);
            }}
            className={`group relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer
              ${uploadingAudio
                ? 'border-blue-500/50 bg-blue-500/5'
                : 'border-slate-600/50 hover:border-emerald-500/50 hover:bg-emerald-500/5 data-[dragover]:border-emerald-500/50 data-[dragover]:bg-emerald-500/5'
              }`}
          >
            {uploadingAudio ? (
              <div className="space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-500/20 flex items-center justify-center">
                  <RefreshCw className="w-7 h-7 text-blue-400 animate-spin" />
                </div>
                <div>
                  <p className="text-base font-medium text-white">Uploading & Converting...</p>
                  <p className="text-sm text-slate-400 mt-1">Automatically converting to FreeSWITCH-compatible format (8kHz Mono WAV)</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors flex items-center justify-center">
                  <Upload className="w-7 h-7 text-emerald-400" />
                </div>
                <div>
                  <p className="text-base font-medium text-white">
                    Drop audio files here or <span className="text-emerald-400 underline underline-offset-2">browse files</span>
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    Any audio format — WAV, MP3, OGG, FLAC, M4A, AAC, WMA, OPUS, AIFF, AMR, GSM
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Files are automatically converted to FreeSWITCH-compatible format (8kHz, 16-bit, Mono PCM WAV). Max 20MB per file.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-6 mt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Auto-convert</span>
                  <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Multi-file</span>
                  <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Any format</span>
                </div>
              </div>
            )}
          </div>

          {/* Search */}
          {recordings.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search recordings..."
                  value={recordingsSearchTerm}
                  onChange={e => setRecordingsSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-800/40 border border-slate-700/50 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
              <span className="text-xs text-slate-500">{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Recordings Table */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-800/60">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">File</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">FreeSWITCH Path</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Duration</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Audio Info</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Size</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filteredRecordings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <FileAudio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm text-slate-400">No recordings yet</p>
                      <p className="text-xs text-slate-500 mt-1">Upload any audio file above — it will be auto-converted</p>
                    </td>
                  </tr>
                ) : filteredRecordings.map(rec => (
                  <tr key={rec.name} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          rec.freeswitchReady ? 'bg-emerald-500/20' : 'bg-amber-500/20'
                        }`}>
                          <FileAudio className={`w-4 h-4 ${rec.freeswitchReady ? 'text-emerald-400' : 'text-amber-400'}`} />
                        </div>
                        <div>
                          <span className="text-sm text-white font-medium">{rec.name}</span>
                          <p className="text-[10px] text-slate-500">{rec.format}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-slate-700/50 px-2 py-1 rounded text-emerald-400 select-all">{rec.path}</code>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                      {rec.duration || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-400">
                        {rec.sampleRate ? `${rec.sampleRate} Hz` : '—'}
                        {rec.channels ? ` · ${rec.channels}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {rec.size ? (rec.size > 1048576 ? `${(rec.size / 1048576).toFixed(1)} MB` : `${(rec.size / 1024).toFixed(1)} KB`) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {rec.freeswitchReady ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle className="w-3 h-3" /> Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <AlertCircle className="w-3 h-3" /> Non-standard
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDeleteRecording(rec.name)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TIME CONDITIONS TAB                                          */}
      {/* ============================================================ */}
      {activeTab === 'time' && (
        <div className="space-y-4">
          {ivrs.length === 0 ? (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-12 text-center">
              <Clock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No Phone Menus to Configure</h3>
              <p className="text-sm text-slate-400">Create phone menus first, then configure time-based routing here.</p>
            </div>
          ) : (
            ivrs.map(ivr => (
              <TimeConditionCard
                key={ivr.name}
                ivr={ivr}
                onEdit={() => openEditor('edit', ivr)}
              />
            ))
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  SLIDE-OVER EDITOR                                           */}
      {/* ============================================================ */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowEditor(false)} />
          <div className="relative ml-auto w-full max-w-3xl bg-slate-900 border-l border-slate-700/50 shadow-2xl flex flex-col h-full overflow-hidden">
            {/* Editor Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-800/50 flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {editorMode === 'add' ? 'Create Phone Menu' : `Edit: ${formData.name}`}
                </h2>
                <p className="text-xs text-slate-400 mt-1">Configure the auto attendant phone menu</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.name || !formData.greeting}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {editorMode === 'add' ? 'Create' : 'Save Changes'}
                </button>
                <button onClick={() => setShowEditor(false)} className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Editor Tabs */}
            <div className="flex gap-1 px-6 pt-4 pb-2 flex-shrink-0">
              {[
                { id: 'general' as const, label: 'General' },
                { id: 'keymap' as const, label: 'Key Mapping' },
                { id: 'timeout' as const, label: 'Timeout & Invalid' },
                { id: 'time' as const, label: 'Time Conditions' },
                { id: 'advanced' as const, label: 'Advanced' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setEditorTab(tab.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    editorTab === tab.id
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Editor Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

              {/* GENERAL TAB */}
              {editorTab === 'general' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Phone Menu Name *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={e => setFormData(p => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }))}
                        disabled={editorMode === 'edit'}
                        placeholder="e.g. main-menu"
                        className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
                      />
                      <p className="text-xs text-slate-500">Alphanumeric, dashes, underscores only</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Description</label>
                      <input
                        type="text"
                        value={formData.description}
                        onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                        placeholder="Main company greeting menu"
                        className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <Music className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">Greeting Audio</h3>
                        <p className="text-xs text-slate-400">The audio that plays when a caller enters this phone menu</p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider inline-flex items-center">
                        Welcome Message *
                        <Tooltip text="The audio played when a caller enters this menu" />
                      </label>
                      <select
                        value={formData.greeting}
                        onChange={e => setFormData(p => ({ ...p, greeting: e.target.value }))}
                        className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
                      >
                        <option value="">Select greeting audio...</option>
                        <optgroup label="Custom Recordings">
                          {recordings.map(r => <option key={r.path} value={r.path}>{r.name} ({r.path})</option>)}
                        </optgroup>
                        <optgroup label="System Sounds">
                          <option value="queue-thankyou">Thank You</option>
                          <option value="vm-goodbye">Goodbye</option>
                          <option value="beep">Beep</option>
                        </optgroup>
                      </select>
                      <p className="text-xs text-slate-500">Upload custom greetings in the Audio Manager tab</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider inline-flex items-center">
                        Wait for input (seconds)
                        <Tooltip text="How long to wait for the caller to press a key" />
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={formData.timeout}
                        onChange={e => setFormData(p => ({ ...p, timeout: parseInt(e.target.value) || 10 }))}
                        className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
                      />
                      <p className="text-xs text-slate-500">How long to wait for caller input</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider inline-flex items-center">
                        Max Retries
                        <Tooltip text="How many times to repeat the menu if the caller presses wrong key" />
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={formData.maxRetries}
                        onChange={e => setFormData(p => ({ ...p, maxRetries: parseInt(e.target.value) || 3 }))}
                        className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
                      />
                      <p className="text-xs text-slate-500">Retries before applying invalid action</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-800/30 border border-slate-700/30 rounded-xl">
                    <div>
                      <h4 className="text-sm font-medium text-white">Enable Direct Dial</h4>
                      <p className="text-xs text-slate-400 mt-0.5">Allow callers to dial extensions directly from this phone menu</p>
                    </div>
                    <button
                      onClick={() => setFormData(p => ({ ...p, directDial: !p.directDial }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${formData.directDial ? 'bg-emerald-500' : 'bg-slate-600'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${formData.directDial ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* KEY MAPPING TAB */}
              {editorTab === 'keymap' && (
                <div className="space-y-5">
                  <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-white mb-1">Phone Keypad Mapping</h3>
                    <p className="text-xs text-slate-400 mb-5">Assign a destination for each key press. Callers pressing a key will be routed to the configured destination.</p>

                    {/* Visual Keypad */}
                    <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
                      {DIGITS.map(digit => {
                        const entry = getEntry(digit);
                        const destType = DEST_TYPES.find(d => d.value === entry.destination.type);
                        const isConfigured = entry.destination.type !== 'none' && entry.destination.type !== '';
                        const Icon = destType?.icon || X;

                        return (
                          <button
                            key={digit}
                            onClick={() => {
                              const el = document.getElementById(`keyconfig-${digit}`);
                              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              el?.classList.add('ring-2', 'ring-emerald-500/50');
                              setTimeout(() => el?.classList.remove('ring-2', 'ring-emerald-500/50'), 2000);
                            }}
                            className={`relative p-4 rounded-xl border transition-all ${
                              isConfigured
                                ? 'bg-slate-700/50 border-emerald-500/30 hover:border-emerald-500/50'
                                : 'bg-slate-800/50 border-slate-700/30 hover:border-slate-600/50'
                            }`}
                          >
                            <div className="text-2xl font-bold text-white mb-1">{digit}</div>
                            {isConfigured ? (
                              <div className="flex items-center justify-center gap-1">
                                <Icon className="w-3 h-3 text-emerald-400" />
                                <span className="text-[10px] text-emerald-400 truncate max-w-[60px]">
                                  {entry.label || entry.destination.target || destType?.label}
                                </span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-500">Not set</div>
                            )}
                            {isConfigured && (
                              <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Key Configuration Details */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-white">Key Configuration</h3>
                    {DIGITS.map(digit => {
                      const entry = getEntry(digit);
                      return (
                        <div
                          key={digit}
                          id={`keyconfig-${digit}`}
                          className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-4 transition-all"
                        >
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-xl bg-slate-700/50 flex items-center justify-center flex-shrink-0">
                              <span className="text-xl font-bold text-white">{digit}</span>
                            </div>
                            <div className="flex-1 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-slate-400">Label</label>
                                  <input
                                    type="text"
                                    value={entry.label}
                                    onChange={e => setEntry(digit, 'label', e.target.value)}
                                    placeholder={`e.g. Sales, Support...`}
                                    className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50"
                                  />
                                </div>
                                <div />
                              </div>
                              <DestinationPicker
                                value={entry.destination}
                                onChange={dest => setEntry(digit, 'destination', dest)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TIMEOUT & INVALID TAB */}
              {editorTab === 'timeout' && (
                <div className="space-y-6">
                  <div className="bg-slate-800/30 border border-amber-500/20 rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">Timeout Handling</h3>
                        <p className="text-xs text-slate-400">What happens when the caller doesn't press any key within the timeout period</p>
                      </div>
                    </div>
                    <DestinationPicker
                      value={formData.timeoutDestination}
                      onChange={dest => setFormData(p => ({ ...p, timeoutDestination: dest }))}
                      label="Timeout Destination"
                    />
                  </div>

                  <div className="bg-slate-800/30 border border-red-500/20 rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                        <AlertCircle className="w-4 h-4 text-red-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">Invalid Input Handling</h3>
                        <p className="text-xs text-slate-400">What happens when the caller presses an unassigned key</p>
                      </div>
                    </div>
                    <DestinationPicker
                      value={formData.invalidDestination}
                      onChange={dest => setFormData(p => ({ ...p, invalidDestination: dest }))}
                      label="Invalid Input Destination"
                    />
                    <p className="text-xs text-slate-500">
                      An "invalid" prompt plays automatically before routing. Use "Repeat Menu" to replay the greeting.
                    </p>
                  </div>
                </div>
              )}

              {/* TIME CONDITIONS TAB */}
              {editorTab === 'time' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 border border-slate-700/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">Enable Time-Based Routing</h3>
                        <p className="text-xs text-slate-400">Route calls differently based on business hours and holidays</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setFormData(p => ({
                        ...p,
                        timeCondition: { ...(p.timeCondition || defaultTimeCondition), enabled: !(p.timeCondition?.enabled) },
                      }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${formData.timeCondition?.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${formData.timeCondition?.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {formData.timeCondition?.enabled && (
                    <>
                      {/* Timezone */}
                      <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-3">
                        <div className="flex items-center gap-3">
                          <Clock className="w-5 h-5 text-blue-400" />
                          <h3 className="text-sm font-semibold text-white">Timezone</h3>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Time Zone</label>
                          <select
                            value={formData.timeCondition?.timezone || 'Asia/Karachi'}
                            onChange={e => setFormData(p => ({
                              ...p,
                              timeCondition: { ...p.timeCondition!, timezone: e.target.value },
                            }))}
                            className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
                          >
                            {TIMEZONES.map(tz => (
                              <option key={tz.value} value={tz.value}>{tz.label}</option>
                            ))}
                          </select>
                          <p className="text-xs text-slate-500">Business hours are evaluated in this timezone</p>
                        </div>
                      </div>

                      {/* Business Hours */}
                      <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-4">
                        <div className="flex items-center gap-3">
                          <Sun className="w-5 h-5 text-amber-400" />
                          <h3 className="text-sm font-semibold text-white">Business Hours</h3>
                        </div>
                        <p className="text-xs text-slate-400">During these hours, callers hear the main welcome message. Outside these hours, the after-hours routing applies.</p>

                        <div className="space-y-2">
                          {(formData.timeCondition?.businessHours || []).map((bh, idx) => {
                            const dayInfo = DAYS_OF_WEEK.find(d => d.day === bh.day);
                            return (
                              <div key={bh.day} className="flex items-center gap-3 py-2 border-b border-slate-700/20 last:border-0">
                                <button
                                  onClick={() => {
                                    const hours = [...(formData.timeCondition?.businessHours || [])];
                                    hours[idx] = { ...hours[idx], enabled: !hours[idx].enabled };
                                    setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, businessHours: hours } }));
                                  }}
                                  className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                                    bh.enabled ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600 bg-slate-700/50'
                                  }`}
                                >
                                  {bh.enabled && <CheckCircle className="w-3 h-3 text-white" />}
                                </button>
                                <span className={`w-24 text-sm ${bh.enabled ? 'text-white' : 'text-slate-500'}`}>
                                  {dayInfo?.label}
                                </span>
                                {bh.enabled ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="time"
                                      value={bh.start}
                                      onChange={e => {
                                        const hours = [...(formData.timeCondition?.businessHours || [])];
                                        hours[idx] = { ...hours[idx], start: e.target.value };
                                        setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, businessHours: hours } }));
                                      }}
                                      className="bg-slate-700/50 border border-slate-600/50 rounded-lg px-2 py-1 text-sm text-white"
                                    />
                                    <span className="text-slate-500">to</span>
                                    <input
                                      type="time"
                                      value={bh.end}
                                      onChange={e => {
                                        const hours = [...(formData.timeCondition?.businessHours || [])];
                                        hours[idx] = { ...hours[idx], end: e.target.value };
                                        setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, businessHours: hours } }));
                                      }}
                                      className="bg-slate-700/50 border border-slate-600/50 rounded-lg px-2 py-1 text-sm text-white"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500 italic">Closed</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Holiday Management */}
                      <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-red-400" />
                            <h3 className="text-sm font-semibold text-white">Holidays</h3>
                          </div>
                          <button
                            onClick={() => {
                              const holidays = [...(formData.timeCondition?.holidays || [])];
                              holidays.push({ date: '', name: '' });
                              setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, holidays } }));
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Holiday
                          </button>
                        </div>
                        <p className="text-xs text-slate-400">On these dates, after-hours routing will apply regardless of business hours.</p>

                        {(formData.timeCondition?.holidays || []).length === 0 ? (
                          <p className="text-xs text-slate-500 italic text-center py-4">No holidays configured</p>
                        ) : (
                          <div className="space-y-2">
                            {(formData.timeCondition?.holidays || []).map((hol, idx) => (
                              <div key={idx} className="flex items-center gap-3">
                                <input
                                  type="date"
                                  value={hol.date}
                                  onChange={e => {
                                    const holidays = [...(formData.timeCondition?.holidays || [])];
                                    holidays[idx] = { ...holidays[idx], date: e.target.value };
                                    setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, holidays } }));
                                  }}
                                  className="bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
                                />
                                <input
                                  type="text"
                                  placeholder="Holiday name"
                                  value={hol.name}
                                  onChange={e => {
                                    const holidays = [...(formData.timeCondition?.holidays || [])];
                                    holidays[idx] = { ...holidays[idx], name: e.target.value };
                                    setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, holidays } }));
                                  }}
                                  className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
                                />
                                <button
                                  onClick={() => {
                                    const holidays = [...(formData.timeCondition?.holidays || [])];
                                    holidays.splice(idx, 1);
                                    setFormData(p => ({ ...p, timeCondition: { ...p.timeCondition!, holidays } }));
                                  }}
                                  className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* After Hours */}
                      <div className="bg-slate-800/30 border border-indigo-500/20 rounded-xl p-5 space-y-4">
                        <div className="flex items-center gap-3">
                          <Moon className="w-5 h-5 text-indigo-400" />
                          <div>
                            <h3 className="text-sm font-semibold text-white">After Hours Routing</h3>
                            <p className="text-xs text-slate-400">Where to route calls outside business hours</p>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">After-Hours Greeting</label>
                          <select
                            value={formData.timeCondition?.afterHoursGreeting || ''}
                            onChange={e => setFormData(p => ({
                              ...p,
                              timeCondition: { ...p.timeCondition!, afterHoursGreeting: e.target.value },
                            }))}
                            className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500/50"
                          >
                            <option value="">None (no greeting)</option>
                            <optgroup label="Custom Recordings">
                              {recordings.map(r => <option key={r.path} value={r.path}>{r.name}</option>)}
                            </optgroup>
                            <optgroup label="System Sounds">
                              <option value="vm-goodbye">Goodbye</option>
                              <option value="queue-thankyou">Thank You</option>
                            </optgroup>
                          </select>
                        </div>
                        <DestinationPicker
                          value={formData.timeCondition?.afterHoursDestination || { type: 'hangup', target: '' }}
                          onChange={dest => setFormData(p => ({
                            ...p,
                            timeCondition: { ...p.timeCondition!, afterHoursDestination: dest },
                          }))}
                          label="After-Hours Destination"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ADVANCED TAB */}
              {editorTab === 'advanced' && (
                <div className="space-y-5">
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-amber-400">Advanced Dialplan View</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          This shows the raw FreeSWITCH dialplan that will be generated. Changes made here are read-only — use the other tabs to configure the phone menu.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
                    <div className="px-4 py-2 bg-slate-700/30 border-b border-slate-700/50 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">Generated Dialplan Preview</span>
                      <button
                        onClick={() => {
                          const preview = generateDialplanPreview(formData);
                          navigator.clipboard.writeText(preview);
                        }}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </button>
                    </div>
                    <pre className="p-4 text-xs text-emerald-400 font-mono whitespace-pre overflow-x-auto max-h-96">
                      {generateDialplanPreview(formData)}
                    </pre>
                  </div>

                  {formData.rawContent && (
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
                      <div className="px-4 py-2 bg-slate-700/30 border-b border-slate-700/50">
                        <span className="text-xs font-medium text-slate-400">Current Dialplan (on server)</span>
                      </div>
                      <pre className="p-4 text-xs text-slate-300 font-mono whitespace-pre overflow-x-auto max-h-96">
                        {formData.rawContent}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

/* ------------------------------------------------------------------ */
/*  Subcomponents                                                      */
/* ------------------------------------------------------------------ */

function IvrCard({ ivr, onEdit, onDelete }: { ivr: IvrMenu; onEdit: () => void; onDelete: () => void }) {
  const configuredKeys = ivr.entries.filter(e => e.destination.type !== 'none' && e.destination.type);
  const hasTimeCondition = ivr.timeCondition?.enabled;

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden hover:border-slate-600/50 transition-all group">
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-white">{ivr.name}</h3>
            {ivr.description && <p className="text-xs text-slate-400 mt-0.5">{ivr.description}</p>}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition-all">
              <Edit2 className="w-4 h-4" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Info Row */}
        <div className="flex items-center gap-4 mb-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-300">{ivr.greeting || 'No greeting'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{ivr.timeout}s wait for input</span>
          </div>
          {hasTimeCondition && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
              <Clock className="w-3 h-3 text-indigo-400" />
              <span className="text-indigo-400">Time Routed</span>
            </div>
          )}
          {ivr.directDial && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20">
              <Phone className="w-3 h-3 text-green-400" />
              <span className="text-green-400">Direct Dial</span>
            </div>
          )}
        </div>

        {/* Mini Keypad */}
        <div className="grid grid-cols-6 gap-1.5">
          {DIGITS.map(digit => {
            const entry = ivr.entries.find(e => e.digit === digit);
            const isConfigured = entry && entry.destination.type !== 'none' && entry.destination.type;
            const destType = isConfigured ? DEST_TYPES.find(d => d.value === entry?.destination.type) : null;
            const Icon = destType?.icon;

            return (
              <div
                key={digit}
                className={`text-center py-1.5 rounded-lg text-xs font-medium ${
                  isConfigured
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    : 'bg-slate-700/30 border border-slate-700/20 text-slate-500'
                }`}
                title={isConfigured ? `${digit}: ${entry?.label || entry?.destination.target || destType?.label}` : `${digit}: Not configured`}
              >
                {digit}
              </div>
            );
          })}
        </div>

        {/* Configured Keys Summary */}
        {configuredKeys.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/30">
            <div className="flex flex-wrap gap-2">
              {configuredKeys.slice(0, 4).map(entry => {
                const destType = DEST_TYPES.find(d => d.value === entry.destination.type);
                const Icon = destType?.icon || X;
                return (
                  <div key={entry.digit} className="flex items-center gap-1.5 text-xs bg-slate-700/30 rounded-lg px-2 py-1">
                    <span className="font-bold text-white">{entry.digit}</span>
                    <ArrowRight className="w-3 h-3 text-slate-500" />
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span className="text-slate-300 truncate max-w-[80px]">
                      {entry.label || entry.destination.target || destType?.label}
                    </span>
                  </div>
                );
              })}
              {configuredKeys.length > 4 && (
                <span className="text-xs text-slate-500 self-center">+{configuredKeys.length - 4} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimeConditionCard({ ivr, onEdit }: { ivr: IvrMenu; onEdit: () => void }) {
  const tc = ivr.timeCondition;
  const isEnabled = tc?.enabled;

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            isEnabled ? 'bg-emerald-500/20' : 'bg-slate-700/50'
          }`}>
            <Clock className={`w-5 h-5 ${isEnabled ? 'text-emerald-400' : 'text-slate-500'}`} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{ivr.name}</h3>
            <p className="text-xs text-slate-400">
              {isEnabled ? 'Time-based routing active' : 'No time conditions configured'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            isEnabled
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-slate-700/50 text-slate-500 border border-slate-700/30'
          }`}>
            {isEnabled ? 'Active' : 'Disabled'}
          </span>
          <button onClick={onEdit} className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
            Configure
          </button>
        </div>
      </div>

      {isEnabled && tc && (
        <div className="grid grid-cols-7 gap-1.5">
          {DAYS_OF_WEEK.map(dayInfo => {
            const bh = tc.businessHours?.find(b => b.day === dayInfo.day);
            return (
              <div
                key={dayInfo.day}
                className={`text-center p-2 rounded-lg ${
                  bh?.enabled
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : 'bg-red-500/5 border border-red-500/10'
                }`}
              >
                <div className={`text-xs font-medium ${bh?.enabled ? 'text-emerald-400' : 'text-red-400'}`}>
                  {dayInfo.short}
                </div>
                {bh?.enabled ? (
                  <div className="text-[10px] text-slate-400 mt-0.5">{bh.start}-{bh.end}</div>
                ) : (
                  <div className="text-[10px] text-red-400/50 mt-0.5">Closed</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function generateDialplanPreview(ivr: IvrMenu): string {
  const lines: string[] = [];

  if (ivr.timeCondition?.enabled) {
    lines.push(`[time-check-${ivr.name}]`);
    lines.push(`exten => s,1,NoOp(Time check for ${ivr.name})`);
    const enabledDays = (ivr.timeCondition.businessHours || []).filter(d => d.enabled);
    if (enabledDays.length > 0) {
      const first = enabledDays[0];
      const dayRange = enabledDays.map(d => d.day.substring(0, 3)).join('&');
      lines.push(` same => n,GotoIfTime(${first.start}-${first.end},${dayRange},*,*?${ivr.name},s,1)`);
    }
    lines.push(` same => n,Goto(after-hours-${ivr.name},s,1)`);
    lines.push('');
    lines.push(`[after-hours-${ivr.name}]`);
    lines.push(`exten => s,1,Answer()`);
    lines.push(` same => n,Wait(1)`);
    if (ivr.timeCondition.afterHoursGreeting) {
      lines.push(` same => n,Playback(${ivr.timeCondition.afterHoursGreeting})`);
    }
    lines.push(` same => n,Hangup()`);
    lines.push('');
  }

  lines.push(`[${ivr.name}]`);
  lines.push(`exten => s,1,Answer()`);
  lines.push(` same => n,Wait(1)`);
  lines.push(` same => n,Set(CDR(userfield)=ivr-${ivr.name})`);
  lines.push(` same => n,Set(TIMEOUT(digit)=3)`);
  lines.push(` same => n,Set(TIMEOUT(response)=${ivr.timeout})`);
  lines.push(` same => n(begin),Background(${ivr.greeting || '<select greeting>'})`);
  lines.push(` same => n,WaitExten(${ivr.timeout})`);

  for (const entry of ivr.entries) {
    if (!entry.destination || entry.destination.type === 'none') continue;
    lines.push('');
    lines.push(`exten => ${entry.digit},1,NoOp(Key ${entry.digit}${entry.label ? ': ' + entry.label : ''})`);

    switch (entry.destination.type) {
      case 'queue': lines.push(` same => n,Queue(${entry.destination.target || '???'},tTkK,,,120)`); break;
      case 'extension': lines.push(` same => n,Dial(PJSIP/${entry.destination.target || '???'},30,tTrR)`); break;
      case 'ivr': lines.push(` same => n,Goto(${entry.destination.target || '???'},s,1)`); break;
      case 'external': lines.push(` same => n,Dial(PJSIP/${entry.destination.target || '???'}@\${UAN_TRUNK},60,tTrR)`); break;
      case 'playback': lines.push(` same => n,Playback(${entry.destination.target || '???'})`); break;
      case 'repeat': lines.push(` same => n,Goto(${ivr.name},s,begin)`); break;
      case 'directory': lines.push(` same => n,Directory(default,internal,b)`); break;
      case 'hangup': lines.push(` same => n,Hangup()`); break;
    }
    if (entry.destination.type !== 'hangup') lines.push(` same => n,Hangup()`);
  }

  lines.push('');
  lines.push(`exten => i,1,Playback(invalid)`);
  if (ivr.invalidDestination.type === 'repeat') {
    lines.push(` same => n,Goto(${ivr.name},s,begin)`);
  } else {
    lines.push(` same => n,Hangup()`);
  }

  lines.push('');
  if (ivr.timeoutDestination.type === 'hangup') {
    lines.push(`exten => t,1,Hangup()`);
  } else if (ivr.timeoutDestination.type === 'repeat') {
    lines.push(`exten => t,1,Goto(${ivr.name},s,begin)`);
  } else {
    lines.push(`exten => t,1,NoOp(Timeout handler)`);
    lines.push(` same => n,Hangup()`);
  }

  return lines.join('\n');
}
