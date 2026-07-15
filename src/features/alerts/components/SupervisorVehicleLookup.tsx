/**
 * Supervisor Vehicle Lookup — Apple Liquid Glass Edition
 *
 * Allows supervisors to search any vehicle in the fleet and view a
 * comprehensive dossier: CRM profile, real-time GPS status, recent
 * TAVL alerts, and full distribution-engine alert history with
 * resolution timelines.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Search,
  Car,
  User,
  Phone,
  MapPin,
  Shield,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowUpCircle,
  XCircle,
  Gauge,
  Navigation,
  Wifi,
  WifiOff,
  Battery,
  Zap,
  Signal,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  FileText,
  History,
  Activity,
  Calendar,
  Timer,
  Eye,
  X,
  Satellite,
  Thermometer,
  Fuel,
  BarChart3,
  Route,
  Trash2,
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Power,
  Sparkles,
  Flag,
  CircleDot,
  ScrollText,
} from 'lucide-react';
import { api } from '@services/api';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { analyzeTrackEvents, formatDurationShort } from '@utils/trackEvents';
import type { JourneySummary } from '@utils/trackEvents';
import { batchReverseGeocode, getCachedAddress } from '@utils/geocoder';

// ─── Types ────────────────────────────────────────────────────────
interface VehicleSearchResult {
  ObjectId: string;
  PlateNumber: string;
  Description: string;
  Enabled: boolean;
  IMEI?: string;
  MatchSource?: string;
  EngineNo?: string;
  PhoneNo?: string;
}

interface VehicleGPS {
  latitude: number;
  longitude: number;
  speed: number;
  angle: number;
  altitude: number;
  satellites: number;
  gpstime: string;
  servertime: string;
  ignition: boolean;
  enginecut: boolean;
  battery: number;
  backupbattery: number;
  powervolt: number;
  gsmsignal: number;
  fuellevel: number;
  minutes_since_update: number;
}

interface CRMData {
  Vehicle_Id?: string;
  CustomerName?: string;
  CellNo?: string;
  TelephoneNo?: string;
  Address1?: string;
  Address2?: string;
  NIC?: string;
  Vehicle_Make?: string;
  Vehicle_Model?: string;
  Vehicle_Year?: string;
  Vehicle_Color?: string;
  Vehicle_EngineNo?: string;
  Vehicle_ChasisNo?: string;
  Vehicle_RegistrationNo?: string;
  Vehicle_Transmission?: string;
  OBJECTID?: string;
  FLEET_TYPE?: string;
  AGRN?: string;
  EmergencyContactPerson?: string;
  EmergencyContactNumber?: string;
  SpecialInstructions?: string;
  Vehicle_SIM?: string;
  Vehicle_IMEINo?: string;
  Vehicle_DateOfInstallation?: string;
  Vehicle_Technician?: string;
  ProductSegment?: string;
  BRANCH_NAME?: string;
  Vehicle_IsLeased?: string;
  Vehicle_Lessee?: string;
  Vehicle_IsInsured?: string;
  InsuredBy?: string;
}

interface AlertHistoryItem {
  id: string;
  alert_id: string;
  alert_type: string;
  vehicle_reg: string;
  customer_name: string;
  alert_message: string;
  alert_data: any;
  assigned_to: string;
  agent_name: string;
  assigned_at: string;
  acknowledged_at: string;
  resolved_at: string;
  resolution: string;
  resolution_notes: string;
  escalated_to: string;
  escalated_at: string;
  escalation_reason: string;
  priority: number;
  status: string;
  created_at: string;
}

interface TimelineEvent {
  id: number;
  alert_id: string;
  action: string;
  performed_by: string;
  details: any;
  handling_time_seconds: number | null;
  performed_at: string;
  alert_type: string | null;
  current_status: string | null;
}

interface AlertSummary {
  total_alerts: string;
  resolved: string;
  escalated: string;
  active: string;
  pending: string;
  dismissed: string;
  avg_resolve_seconds: string | null;
  first_alert: string | null;
  last_alert: string | null;
}

// ─── Constants ────────────────────────────────────────────────────
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 };
const FADE_UP = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING } };

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode; label: string }> = {
  resolved: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Resolved' },
  escalated: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: <ArrowUpCircle className="w-3.5 h-3.5" />, label: 'Escalated' },
  acknowledged: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: <Eye className="w-3.5 h-3.5" />, label: 'Acknowledged' },
  assigned: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: <User className="w-3.5 h-3.5" />, label: 'Assigned' },
  pending: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', icon: <Clock className="w-3.5 h-3.5" />, label: 'Pending' },
  dismissed: { color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20', icon: <XCircle className="w-3.5 h-3.5" />, label: 'Dismissed' },
};

const PRIORITY_CONFIG: Record<number, { color: string; label: string }> = {
  1: { color: 'text-red-400', label: 'Critical' },
  2: { color: 'text-orange-400', label: 'High' },
  3: { color: 'text-amber-400', label: 'Medium' },
  4: { color: 'text-blue-400', label: 'Low' },
  5: { color: 'text-zinc-400', label: 'Info' },
};

// ─── Helpers ──────────────────────────────────────────────────────
function toDMS(deg: number, isLat: boolean): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return `${d}°${m}'${s}"${dir}`;
}

function formatSeconds(sec: number | string | null): string {
  if (sec === null || sec === undefined) return '—';
  const n = typeof sec === 'string' ? parseFloat(sec) : sec;
  if (isNaN(n) || n <= 0) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

function alertTypeIcon(type: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('panic') || t.includes('sos')) return '🆘';
  if (t.includes('speed')) return '⚡';
  if (t.includes('battery') || t.includes('power')) return '🔋';
  if (t.includes('geofence') || t.includes('roaming')) return '📍';
  if (t.includes('movement') || t.includes('stolen')) return '🚨';
  if (t.includes('ignition')) return '🔑';
  if (t.includes('idle')) return '⏸️';
  if (t.includes('harsh')) return '⚠️';
  return '🔔';
}

// ─── Main Component ───────────────────────────────────────────────
export default function SupervisorVehicleLookup() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<VehicleSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState<VehicleSearchResult | null>(null);
  const [gpsData, setGpsData] = useState<VehicleGPS | null>(null);
  const [crmData, setCrmData] = useState<CRMData | null>(null);
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([]);
  const [alertTimeline, setAlertTimeline] = useState<TimelineEvent[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const [loadingGps, setLoadingGps] = useState(false);
  const [loadingCrm, setLoadingCrm] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);

  const [historyDays, setHistoryDays] = useState(90);
  const [activeSection, setActiveSection] = useState<'profile' | 'alerts' | 'timeline'>('profile');
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [alertPin, setAlertPin] = useState<{ lat: number; lng: number; label: string } | null>(null);

  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Search ──────────────────────────────────────────────────────
  const handleSearch = useCallback(async (term: string) => {
    if (term.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    try {
      const result = await api.vehicle.search(term, { includeDeactivated: true });
      if (result?.success) {
        const data = (result as any).data;
        setSearchResults(Array.isArray(data) ? (data as VehicleSearchResult[]) : []);
        setShowDropdown(true);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  const onSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 300);
  }, [handleSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Select Vehicle ──────────────────────────────────────────────
  const selectVehicle = useCallback(async (vehicle: VehicleSearchResult) => {
    setSelectedVehicle(vehicle);
    setShowDropdown(false);
    setSearchTerm(vehicle.PlateNumber);
    setActiveSection('profile');
    setExpandedAlert(null);

    const objectId = parseInt(vehicle.ObjectId);
    const plateNumber = vehicle.PlateNumber;

    setLoadingGps(true);
    setLoadingCrm(true);
    setLoadingHistory(true);
    setLoadingAddress(true);
    setGpsData(null);
    setCrmData(null);
    setAlertHistory([]);
    setAlertTimeline([]);
    setAlertSummary(null);
    setAddress(null);

    const [detailsRes, realtimeGpsRes, crmRes, histRes] = await Promise.allSettled([
      api.vehicle.getDetails(objectId),
      api.vehicle.getRealtimeGps(objectId),
      api.crm.getVehicleDetails(vehicle.ObjectId),
      api.distribution.getVehicleHistory(plateNumber, historyDays),
    ]);

    // Build GPS data from available sources.
    // Prefer the realtime GPS endpoint (richer: ignition, battery, etc.)
    // Fall back to vehicle details (basic lat/lon/speed).
    let gps: VehicleGPS | null = null;

    if (realtimeGpsRes.status === 'fulfilled' && realtimeGpsRes.value?.success && realtimeGpsRes.value.data) {
      const r: any = realtimeGpsRes.value.data as any;
      if (r.latitude && r.longitude) {
        gps = {
          latitude: parseFloat(r.latitude),
          longitude: parseFloat(r.longitude),
          speed: parseFloat(r.speed) || 0,
          angle: parseFloat(r.angle) || 0,
          altitude: parseFloat(r.altitude) || 0,
          satellites: parseInt(r.satellites) || 0,
          gpstime: r.gpstime || r.gpsTime || '',
          servertime: r.servertime || r.serverTime || '',
          ignition: !!r.ignition,
          enginecut: !!r.enginecut || !!r.engineCut,
          battery: parseFloat(r.battery) || 0,
          backupbattery: parseFloat(r.backupbattery) || 0,
          powervolt: parseFloat(r.powervolt) || 0,
          gsmsignal: parseFloat(r.gsmsignal) || 0,
          fuellevel: parseFloat(r.fuellevel) || 0,
          minutes_since_update: parseFloat(r.minutes_ago ?? r.minutes_since_update ?? r.minutesAgo ?? 999),
        };
      }
    }

    // Fallback: use vehicle details response (flat shape)
    if (!gps && detailsRes.status === 'fulfilled' && detailsRes.value?.success && detailsRes.value.data) {
      const d: any = detailsRes.value.data as any;
      if (d.latitude && d.longitude) {
        gps = {
          latitude: parseFloat(d.latitude),
          longitude: parseFloat(d.longitude),
          speed: parseFloat(d.speed) || 0,
          angle: parseFloat(d.angle) || 0,
          altitude: parseFloat(d.altitude) || 0,
          satellites: parseInt(d.satellites) || 0,
          gpstime: d.gpsTime || d.gpstime || '',
          servertime: d.serverTime || d.servertime || '',
          ignition: !!d.ignition,
          enginecut: !!d.enginecut || !!d.engineCut,
          battery: parseFloat(d.battery) || 0,
          backupbattery: parseFloat(d.backupbattery) || 0,
          powervolt: parseFloat(d.powervolt) || 0,
          gsmsignal: parseFloat(d.gsmsignal) || 0,
          fuellevel: parseFloat(d.fuellevel) || 0,
          minutes_since_update: parseFloat(d.minutesSinceUpdate ?? d.minutes_since_update ?? 999),
        };
      }
    }

    setGpsData(gps);

    if (gps?.latitude && gps?.longitude) {
      try {
        const resp = await fetch(`/api/geocode/reverse?lat=${gps.latitude}&lon=${gps.longitude}`);
        const geo = await resp.json();
        if (geo?.display_name) setAddress(geo.display_name);
      } catch { /* ignore */ }
    }
    setLoadingGps(false);
    setLoadingAddress(false);

    if (crmRes.status === 'fulfilled' && crmRes.value?.success) {
      setCrmData(crmRes.value.data || null);
    }
    setLoadingCrm(false);

    if (histRes.status === 'fulfilled' && histRes.value?.success) {
      const hd: any = histRes.value.data as any;
      setAlertHistory((hd?.alerts || []) as AlertHistoryItem[]);
      setAlertTimeline((hd?.timeline || []) as TimelineEvent[]);
      setAlertSummary((hd?.summary || null) as AlertSummary | null);
    }
    setLoadingHistory(false);
  }, [historyDays]);

  // ── Refresh History ─────────────────────────────────────────────
  const refreshHistory = useCallback(async () => {
    if (!selectedVehicle) return;
    setLoadingHistory(true);
    try {
      const result = await api.distribution.getVehicleHistory(selectedVehicle.PlateNumber, historyDays);
      if (result?.success) {
        const d: any = (result as any).data;
        setAlertHistory((d?.alerts || []) as AlertHistoryItem[]);
        setAlertTimeline((d?.timeline || []) as TimelineEvent[]);
        setAlertSummary((d?.summary || null) as AlertSummary | null);
      }
    } catch (err) {
      console.error('History refresh failed:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [selectedVehicle, historyDays]);

  // ── Derived stats ───────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!alertSummary) return null;
    return {
      total: parseInt(alertSummary.total_alerts) || 0,
      resolved: parseInt(alertSummary.resolved) || 0,
      escalated: parseInt(alertSummary.escalated) || 0,
      active: parseInt(alertSummary.active) || 0,
      pending: parseInt(alertSummary.pending) || 0,
      dismissed: parseInt(alertSummary.dismissed) || 0,
      avgResolve: alertSummary.avg_resolve_seconds ? parseFloat(alertSummary.avg_resolve_seconds) : null,
      first: alertSummary.first_alert,
      last: alertSummary.last_alert,
    };
  }, [alertSummary]);

  const resolutionRate = useMemo(() => {
    if (!stats || stats.total === 0) return 0;
    return Math.round((stats.resolved / stats.total) * 100);
  }, [stats]);

  // ── Clear ───────────────────────────────────────────────────────
  const clearSelection = () => {
    setSelectedVehicle(null);
    setSearchTerm('');
    setGpsData(null);
    setCrmData(null);
    setAlertHistory([]);
    setAlertTimeline([]);
    setAlertSummary(null);
    setAddress(null);
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* ── Search Bar ─────────────────────────────────────── */}
      <div ref={searchRef} className="relative flex-shrink-0">
        <div className="lg-card px-4 py-3 flex items-center gap-3">
          <Search className="w-5 h-5 text-violet-400/60 flex-shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            placeholder="Search vehicle by plate, IMEI, customer name, engine no, or phone..."
            className="flex-1 bg-transparent text-white/90 placeholder-white/25 text-sm outline-none focus:placeholder-white/40"
          />
          {searching && <Loader2 className="w-4 h-4 text-violet-400/40 animate-spin flex-shrink-0" />}
          {selectedVehicle && (
            <button onClick={clearSelection} className="p-1 rounded-lg hover:bg-white/5 text-white/30 hover:text-white/60 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search Dropdown */}
        <AnimatePresence>
          {showDropdown && searchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 top-full mt-2 inset-x-0 lg-card max-h-72 overflow-y-auto"
            >
              {searchResults.map((v) => (
                <button
                  key={v.ObjectId}
                  onClick={() => selectVehicle(v)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.03] last:border-0"
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${v.Enabled ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-white/90">{v.PlateNumber}</span>
                      {v.MatchSource && v.MatchSource !== 'tavl' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300/70">
                          {v.MatchSource}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/35 truncate">{v.Description || 'No description'}</p>
                  </div>
                  {v.IMEI && <span className="text-[10px] text-white/20 font-mono">{v.IMEI}</span>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Empty State ────────────────────────────────────── */}
      {!selectedVehicle && (
        <motion.div {...FADE_UP} className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Car className="w-10 h-10 text-white/10" />
            </div>
            <h3 className="text-lg font-semibold text-white/30 mb-1">Vehicle Lookup</h3>
            <p className="text-sm text-white/15 max-w-sm">
              Search for any vehicle to view its complete profile, real-time status, and full alert history.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Vehicle Dossier — 2-Column Layout ─────────────── */}
      <AnimatePresence mode="wait">
        {selectedVehicle && (
          <motion.div
            key={selectedVehicle.ObjectId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING}
            className="flex-1 flex gap-4 overflow-hidden min-h-0"
          >
            {/* ── LEFT COLUMN: Map + Track ─────────────────── */}
            <div className="w-[55%] flex-shrink-0 flex flex-col gap-4 overflow-y-auto min-h-0 pr-1">
              <GPSSection gps={gpsData} loading={loadingGps} address={address} loadingAddress={loadingAddress} objectId={selectedVehicle.ObjectId} alertPin={alertPin} onClearAlertPin={() => setAlertPin(null)} />
            </div>

            {/* ── RIGHT COLUMN: Header + Tabbed Content ────── */}
            <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0 min-w-0">
              {/* Header Card */}
              <VehicleHeader
                vehicle={selectedVehicle}
                gps={gpsData}
                loadingGps={loadingGps}
                address={address}
                loadingAddress={loadingAddress}
              />

              {/* Section Nav */}
              <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                {([
                  { key: 'profile', label: 'Profile', icon: <User className="w-3.5 h-3.5" /> },
                  { key: 'alerts', label: `Alerts${stats ? ` (${stats.total})` : ''}`, icon: <AlertTriangle className="w-3.5 h-3.5" /> },
                  { key: 'timeline', label: 'Timeline', icon: <History className="w-3.5 h-3.5" /> },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveSection(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeSection === tab.key
                        ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                        : 'text-white/30 hover:text-white/50 hover:bg-white/[0.03] border border-transparent'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}

                <div className="flex-1" />

                {/* History Period Selector */}
                {(activeSection === 'alerts' || activeSection === 'timeline') && (
                  <div className="flex items-center gap-1.5">
                    {[30, 90, 180, 365].map((d) => (
                      <button
                        key={d}
                        onClick={() => { setHistoryDays(d); }}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                          historyDays === d
                            ? 'bg-white/10 text-white/70'
                            : 'text-white/20 hover:text-white/40'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                    <button
                      onClick={refreshHistory}
                      disabled={loadingHistory}
                      className="p-1 rounded text-white/20 hover:text-white/50 disabled:opacity-30"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                )}
              </div>

              {/* Section Content */}
              <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                <AnimatePresence mode="wait">
                  {activeSection === 'profile' && (
                    <motion.div key="profile" {...FADE_UP}>
                      <ProfileSection crm={crmData} loading={loadingCrm} vehicle={selectedVehicle} />
                    </motion.div>
                  )}
                  {activeSection === 'alerts' && (
                    <motion.div key="alerts" {...FADE_UP}>
                      <AlertsSection
                        alerts={alertHistory}
                        summary={stats}
                        resolutionRate={resolutionRate}
                        loading={loadingHistory}
                        expandedAlert={expandedAlert}
                        onToggleExpand={(id) => setExpandedAlert(expandedAlert === id ? null : id)}
                        onShowOnMap={(lat, lng, label) => {
                          setAlertPin({ lat, lng, label });
                          setActiveSection('profile');
                        }}
                      />
                    </motion.div>
                  )}
                  {activeSection === 'timeline' && (
                    <motion.div key="timeline" {...FADE_UP}>
                      <TimelineSection events={alertTimeline} loading={loadingHistory} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

// ── Vehicle Header ────────────────────────────────────────────────
function VehicleHeader({ vehicle, gps, loadingGps, address, loadingAddress }: {
  vehicle: VehicleSearchResult;
  gps: VehicleGPS | null;
  loadingGps: boolean;
  address: string | null;
  loadingAddress: boolean;
}) {
  const isOnline = gps && gps.minutes_since_update < 10;
  const isMoving = gps && gps.speed > 2;
  const ignitionOn = gps?.ignition;

  return (
    <div className="lg-card px-5 py-4 flex-shrink-0">
      <div className="flex items-start gap-4">
        {/* Vehicle Icon */}
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 border ${
          isOnline
            ? ignitionOn
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-blue-500/10 border-blue-500/20'
            : 'bg-zinc-500/10 border-zinc-500/20'
        }`}>
          <Car className={`w-7 h-7 ${
            isOnline
              ? ignitionOn ? 'text-emerald-400' : 'text-blue-400'
              : 'text-zinc-500'
          }`} />
        </div>

        {/* Vehicle Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold font-mono text-white/95 tracking-wide">{vehicle.PlateNumber}</h2>
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
              vehicle.Enabled
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              {vehicle.Enabled ? 'Active' : 'Deactivated'}
            </span>
            {isOnline !== null && isOnline !== undefined && (
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                isOnline
                  ? isMoving
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : ignitionOn
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                  : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
              }`}>
                {isOnline
                  ? isMoving ? 'Moving' : ignitionOn ? 'Idle' : 'Parked'
                  : 'Offline'}
              </span>
            )}
          </div>
          <p className="text-sm text-white/40 mb-2">{vehicle.Description || 'No description'}</p>

          {/* Quick GPS Row */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/30">
            {loadingGps && <Loader2 className="w-3 h-3 animate-spin" />}
            {gps && (
              <>
                <span className="flex items-center gap-1">
                  <Navigation className="w-3 h-3" />
                  {toDMS(gps.latitude, true)}, {toDMS(gps.longitude, false)}
                </span>
                <span className="text-white/10">|</span>
                <span className="flex items-center gap-1">
                  <Gauge className="w-3 h-3" />
                  {Math.round(gps.speed)} km/h
                </span>
                <span className="text-white/10">|</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {gps.minutes_since_update < 1
                    ? 'Just now'
                    : gps.gpstime
                      ? formatDistanceToNowStrict(new Date(gps.gpstime), { addSuffix: true })
                      : `~${Math.round(gps.minutes_since_update)}m ago`}
                </span>
              </>
            )}
            {address && !loadingAddress && (
              <>
                <span className="text-white/10">|</span>
                <span className="flex items-center gap-1 text-white/25 max-w-md truncate">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {address}
                </span>
              </>
            )}
            {loadingAddress && <Loader2 className="w-3 h-3 animate-spin text-white/15" />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Profile Section ───────────────────────────────────────────────
function ProfileSection({ crm, loading, vehicle }: { crm: CRMData | null; loading: boolean; vehicle: VehicleSearchResult }) {
  if (loading) return <LoadingSkeleton label="Loading CRM profile..." />;

  if (!crm) {
    return (
      <div className="lg-card p-6 text-center">
        <FileText className="w-8 h-8 text-white/10 mx-auto mb-2" />
        <p className="text-sm text-white/30">No CRM data available for this vehicle.</p>
        <p className="text-xs text-white/15 mt-1">Object ID: {vehicle.ObjectId}</p>
      </div>
    );
  }

  const groups = [
    {
      title: 'Customer',
      icon: <User className="w-4 h-4 text-violet-400/60" />,
      fields: [
        { label: 'Name', value: crm.CustomerName },
        { label: 'Phone', value: crm.CellNo },
        { label: 'Telephone', value: crm.TelephoneNo },
        { label: 'NIC', value: crm.NIC },
        { label: 'Address', value: crm.Address1 },
        { label: 'Office Address', value: crm.Address2 },
      ],
    },
    {
      title: 'Vehicle',
      icon: <Car className="w-4 h-4 text-blue-400/60" />,
      fields: [
        { label: 'Registration', value: crm.Vehicle_RegistrationNo },
        { label: 'Make', value: crm.Vehicle_Make },
        { label: 'Model', value: crm.Vehicle_Model },
        { label: 'Year', value: crm.Vehicle_Year },
        { label: 'Color', value: crm.Vehicle_Color },
        { label: 'Engine No', value: crm.Vehicle_EngineNo },
        { label: 'Chassis No', value: crm.Vehicle_ChasisNo },
        { label: 'Transmission', value: crm.Vehicle_Transmission },
      ],
    },
    {
      title: 'Fleet & Installation',
      icon: <Shield className="w-4 h-4 text-amber-400/60" />,
      fields: [
        { label: 'Fleet Type', value: crm.FLEET_TYPE },
        { label: 'Branch', value: crm.BRANCH_NAME },
        { label: 'Product Segment', value: crm.ProductSegment },
        { label: 'AGRN', value: crm.AGRN },
        { label: 'SIM', value: crm.Vehicle_SIM },
        { label: 'IMEI', value: crm.Vehicle_IMEINo || vehicle.IMEI },
        { label: 'Installed On', value: crm.Vehicle_DateOfInstallation },
        { label: 'Technician', value: crm.Vehicle_Technician },
      ],
    },
    {
      title: 'Emergency & Security',
      icon: <AlertTriangle className="w-4 h-4 text-red-400/60" />,
      fields: [
        { label: 'Emergency Contact', value: crm.EmergencyContactPerson },
        { label: 'Emergency Phone', value: crm.EmergencyContactNumber },
        { label: 'Special Instructions', value: crm.SpecialInstructions },
        { label: 'Leased', value: crm.Vehicle_IsLeased },
        { label: 'Lessee', value: crm.Vehicle_Lessee },
        { label: 'Insured', value: crm.Vehicle_IsInsured },
        { label: 'Insured By', value: crm.InsuredBy },
      ],
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3">
      {groups.map((group) => {
        const filledFields = group.fields.filter(f => f.value && String(f.value).trim());
        if (filledFields.length === 0) return null;

        return (
          <div key={group.title} className="lg-card p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/[0.04]">
              {group.icon}
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">{group.title}</h4>
            </div>
            <div className="space-y-2">
              {filledFields.map((field) => (
                <div key={field.label} className="flex items-start gap-2">
                  <span className="text-[11px] text-white/25 w-28 flex-shrink-0">{field.label}</span>
                  <span className="text-[11px] text-white/70 flex-1 break-words">{String(field.value)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Track History helpers ──────────────────────────────────────────
const TRACK_PRESETS = [
  { label: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '2h', ms: 2 * 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '12h', ms: 12 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
];
const MAX_TRACK_POINTS = 5000;
const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16];
type TrackMode = 'raw' | 'osrm';

interface TrackData {
  points: any[];
  totalDistance: number;
  totalDuration: number;
  stops: any[];
  maxSpeed: number;
  startTime: Date;
  endTime: Date;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectStops(points: any[]) {
  const stops: any[] = [];
  const MIN_STOP = 2 * 60 * 1000;
  let start: any = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed === 0) {
      if (!start) start = p;
    } else {
      if (start) {
        const dur = p.gpsTime.getTime() - start.gpsTime.getTime();
        if (dur >= MIN_STOP) {
          stops.push({ latitude: start.latitude, longitude: start.longitude, startTime: start.gpsTime, endTime: p.gpsTime, duration: dur });
        }
        start = null;
      }
    }
  }
  return stops;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function speedColor(speed: number): string {
  if (speed > 120) return '#ef4444';
  if (speed > 100) return '#f97316';
  if (speed > 80) return '#eab308';
  if (speed > 40) return '#22c55e';
  if (speed > 5) return '#3b82f6';
  return '#8b5cf6';
}

const getGsmColor = (signal: number, maxSignal: number): { color: string; label: string } => {
  const pct = maxSignal <= 5 ? (signal / 5) * 100 : (signal / 31) * 100;
  if (pct <= 20) return { color: '#EF4444', label: 'Poor' };
  if (pct <= 40) return { color: '#F97316', label: 'Weak' };
  if (pct <= 60) return { color: '#F59E0B', label: 'Fair' };
  if (pct <= 80) return { color: '#84CC16', label: 'Good' };
  return { color: '#10B981', label: 'Excellent' };
};

const getGsmHaloRadius = (signal: number, maxSignal: number): number => {
  const pct = maxSignal <= 5 ? (signal / 5) * 100 : (signal / 31) * 100;
  return 50 + (pct / 100) * 1450;
};

const getLatencyColor = (latency: number): { color: string; label: string } => {
  if (latency <= 3) return { color: '#10B981', label: 'Excellent' };
  if (latency <= 10) return { color: '#84CC16', label: 'Good' };
  if (latency <= 30) return { color: '#F59E0B', label: 'Fair' };
  if (latency <= 60) return { color: '#F97316', label: 'Delayed' };
  if (latency <= 120) return { color: '#EF4444', label: 'Slow' };
  return { color: '#DC2626', label: 'Very Slow' };
};

const TT_STYLE = 'background:rgba(15,23,42,0.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 12px;color:white;font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);max-width:260px;';

function MiniChart({ data, currentIndex, color, label, unit, min, max, icon }: {
  data: number[]; currentIndex: number; color: string; label: string; unit: string; min?: number; max?: number; icon: React.ReactNode;
}) {
  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    const step = Math.max(1, Math.floor(data.length / 100));
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  const dataMin = min ?? Math.min(...chartData.filter(v => v > 0));
  const dataMax = max ?? Math.max(...chartData);
  const range = dataMax - dataMin || 1;
  const currentValue = data[currentIndex] ?? 0;
  const W = 200, H = 36;
  const points = chartData.map((v, i) => `${(i / (chartData.length - 1)) * W},${H - ((v - dataMin) / range) * H}`).join(' ');
  const cX = (currentIndex / (data.length - 1)) * W;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={color}>{icon}</span>
        <span className="text-[9px] text-slate-500 uppercase">{label}</span>
        <span className={`text-[11px] font-bold ml-auto ${color}`}>{currentValue.toFixed(1)} {unit}</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
        {chartData.length > 1 && <polyline points={points} fill="none" stroke={color.includes('emerald') ? '#10b981' : color.includes('amber') ? '#f59e0b' : color.includes('blue') ? '#3b82f6' : color.includes('rose') ? '#f43f5e' : color.includes('cyan') ? '#06b6d4' : '#8b5cf6'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
        <line x1={cX} y1="0" x2={cX} y2={H} stroke="white" strokeWidth="1" opacity="0.4" />
        <circle cx={cX} cy={H - ((currentValue - dataMin) / range) * H} r="2.5" fill="white" />
      </svg>
    </div>
  );
}

// ── GPS Section (Map + Track History + Playback + Insights) ───────
function GPSSection({ gps, loading, address, loadingAddress, objectId, alertPin, onClearAlertPin }: {
  gps: VehicleGPS | null; loading: boolean; address: string | null; loadingAddress: boolean; objectId: string;
  alertPin?: { lat: number; lng: number; label: string } | null;
  onClearAlertPin?: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const alertPinMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Track state
  const [trackData, setTrackData] = useState<TrackData | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState('1h');
  const [trackStart, setTrackStart] = useState(() => new Date(Date.now() - 60 * 60 * 1000));
  const [trackEnd, setTrackEnd] = useState(() => new Date());
  const trackLayersRef = useRef<L.LayerGroup | null>(null);
  const [sampledWarning, setSampledWarning] = useState<string | null>(null);

  // OSRM
  const [trackMode, setTrackMode] = useState<TrackMode>('raw');
  const [osrmRoute, setOsrmRoute] = useState<[number, number][] | null>(null);
  const [osrmLoading, setOsrmLoading] = useState(false);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentPointIndex, setCurrentPointIndex] = useState(0);
  const playbackMarkerRef = useRef<L.Marker | null>(null);

  // Display toggles
  const [showGsmMarkers, setShowGsmMarkers] = useState(false);
  const [showLatencyMarkers, setShowLatencyMarkers] = useState(false);
  const [showIgnitionEvents, setShowIgnitionEvents] = useState(false);
  const [showSpeedEvents, setShowSpeedEvents] = useState(false);
  const [showIdleEvents, setShowIdleEvents] = useState(false);
  const [speedThreshold, setSpeedThreshold] = useState(80);
  const [showGraphs, setShowGraphs] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showTripTimeline, setShowTripTimeline] = useState(false);

  // Journey analysis
  const journeySummary = useMemo<JourneySummary | null>(() => {
    if (!trackData?.points?.length) return null;
    return analyzeTrackEvents(trackData.points, speedThreshold);
  }, [trackData, speedThreshold]);

  // Telemetry arrays for charts
  const telemetryData = useMemo(() => {
    if (!trackData?.points) return null;
    const pts = trackData.points;
    const latencyArr = pts.map((p: any) => p.latency || 0);
    const avgLat = latencyArr.reduce((a: number, b: number) => a + b, 0) / latencyArr.length;
    return {
      speed: pts.map((p: any) => p.speed || 0),
      battery: pts.map((p: any) => p.battery || 0),
      powerVolt: pts.map((p: any) => p.powerVolt || 0),
      gsmSignal: pts.map((p: any) => p.gsmSignal || 0),
      latency: latencyArr,
      avgLatency: Math.round(avgLat),
      maxLatency: Math.max(...latencyArr),
    };
  }, [trackData]);

  // Trip timeline entries
  const tripTimeline = useMemo(() => {
    if (!trackData?.points?.length || !journeySummary) return [];
    const pts = trackData.points;
    const entries: any[] = [];
    const start = pts[0]; const end = pts[pts.length - 1];
    entries.push({ id: 'start', type: 'start', time: new Date(start.gpsTime), lat: start.latitude, lng: start.longitude, label: 'Journey Start', detail: `Ignition ${start.ignition ? 'ON' : 'OFF'} · ${start.speed || 0} km/h`, color: 'text-emerald-400', dotColor: 'bg-emerald-500' });
    entries.push({ id: 'end', type: 'end', time: new Date(end.gpsTime), lat: end.latitude, lng: end.longitude, label: 'Journey End', detail: `${trackData.totalDistance.toFixed(1)} km traveled`, color: 'text-red-400', dotColor: 'bg-red-500' });
    trackData.stops.forEach((s: any, i: number) => entries.push({ id: `stop-${i}`, type: 'stop', time: new Date(s.startTime), endTime: new Date(s.endTime), lat: s.latitude, lng: s.longitude, label: `Stop #${i + 1}`, detail: formatDurationShort(s.duration), sub: `${format(new Date(s.startTime), 'HH:mm')} → ${format(new Date(s.endTime), 'HH:mm')}`, color: 'text-amber-400', dotColor: 'bg-amber-500' }));
    journeySummary.ignitionEvents.forEach((e, i) => {
      const isOn = e.type === 'on';
      entries.push({ id: `ign-${i}`, type: isOn ? 'ignition-on' : 'ignition-off', time: e.timestamp, lat: e.latitude, lng: e.longitude, label: isOn ? 'Ignition ON' : 'Ignition OFF', detail: `${isOn ? 'Was OFF' : 'Was ON'} for ${formatDurationShort(e.prevStateDuration)}`, color: isOn ? 'text-emerald-400' : 'text-red-400', dotColor: isOn ? 'bg-emerald-500' : 'bg-red-500' });
    });
    journeySummary.speedViolations.forEach((v, i) => entries.push({ id: `spd-${i}`, type: 'speed-violation', time: v.startTime, endTime: v.endTime, lat: v.latitude, lng: v.longitude, label: 'Speed Violation', detail: `Peak ${Math.round(v.peakSpeed)} km/h`, sub: `${formatDurationShort(v.duration)} above ${speedThreshold} km/h`, color: 'text-red-400', dotColor: 'bg-red-500' }));
    journeySummary.idleEvents.forEach((d, i) => entries.push({ id: `idle-${i}`, type: 'idle', time: d.startTime, endTime: d.endTime, lat: d.latitude, lng: d.longitude, label: 'Vehicle Idle', detail: formatDurationShort(d.duration), sub: 'Engine ON, stationary', color: 'text-indigo-400', dotColor: 'bg-indigo-500' }));
    entries.sort((a: any, b: any) => a.time.getTime() - b.time.getTime());
    return entries;
  }, [trackData, journeySummary, speedThreshold]);

  // Geocoded addresses for trip timeline
  const [timelineAddresses, setTimelineAddresses] = useState<Map<string, string>>(new Map());
  const [geocodingTimeline, setGeocodingTimeline] = useState(false);

  useEffect(() => {
    if (!showTripTimeline || tripTimeline.length === 0) return;
    setGeocodingTimeline(true);
    batchReverseGeocode(tripTimeline.map((e: any) => ({ lat: e.lat, lng: e.lng }))).then(() => {
      const m = new Map<string, string>();
      for (const e of tripTimeline) { const a = getCachedAddress(e.lat, e.lng); if (a) m.set(e.id, a); }
      setTimelineAddresses(m);
      setGeocodingTimeline(false);
    });
  }, [showTripTimeline, tripTimeline]);

  // ── Map initialization ──
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;
      const map = L.map(mapContainerRef.current, {
        zoomControl: false, attributionControl: false, scrollWheelZoom: true,
        doubleClickZoom: true, dragging: true, boxZoom: false, keyboard: false, touchZoom: true,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: 'topright' }).addTo(map);
      map.setView([30.3753, 69.3451], 6);
      mapInstanceRef.current = map;
      trackLayersRef.current = L.layerGroup().addTo(map);
      setTimeout(() => { map.invalidateSize(); setMapReady(true); }, 200);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // ── Update vehicle marker ──
  useEffect(() => {
    if (!mapInstanceRef.current || !gps) return;
    const lat = gps.latitude, lng = gps.longitude;
    if (!lat || !lng) return;
    const isOn = gps.minutes_since_update < 10;
    const isMov = gps.speed > 2;
    const mc = isOn ? isMov ? '#34d399' : gps.ignition ? '#fbbf24' : '#60a5fa' : '#71717a';
    const gc = isOn ? isMov ? 'rgba(52,211,153,0.45)' : gps.ignition ? 'rgba(251,191,36,0.4)' : 'rgba(96,165,250,0.35)' : 'rgba(113,113,122,0.25)';
    const icon = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:44px;height:44px;"><div style="position:absolute;inset:0;border-radius:50%;background:${gc};filter:blur(6px);animation:${isOn ? 'pulse 2s ease-in-out infinite' : 'none'};"></div><div style="position:absolute;inset:6px;background:linear-gradient(135deg,${mc},${mc}dd);border:2.5px solid rgba(255,255,255,0.85);border-radius:50%;box-shadow:0 2px 10px ${gc};display:flex;align-items:center;justify-content:center;transform:rotate(${Math.round(gps.angle)}deg);"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg></div></div>`,
      iconSize: [44, 44], iconAnchor: [22, 22],
    });
    if (markerRef.current) { markerRef.current.setLatLng([lat, lng]); markerRef.current.setIcon(icon); }
    else { markerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(mapInstanceRef.current); }
    if (accuracyCircleRef.current) accuracyCircleRef.current.setLatLng([lat, lng]);
    else { accuracyCircleRef.current = L.circle([lat, lng], { radius: 40, color: 'rgba(139,92,246,0.35)', fillColor: 'rgba(139,92,246,0.08)', fillOpacity: 1, weight: 1 }).addTo(mapInstanceRef.current); }
    if (!trackData) mapInstanceRef.current.setView([lat, lng], 15, { animate: true });
  }, [gps?.latitude, gps?.longitude, gps?.speed, gps?.angle, gps?.ignition, gps?.minutes_since_update, mapReady, trackData]);

  // ── Alert pin — fly to alert location and show a red marker ──
  useEffect(() => {
    if (!mapInstanceRef.current || !alertPin) return;
    const { lat, lng, label } = alertPin;
    // Remove existing alert pin marker
    if (alertPinMarkerRef.current) { alertPinMarkerRef.current.remove(); alertPinMarkerRef.current = null; }
    const icon = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:36px;height:36px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(239,68,68,0.4);filter:blur(5px);animation:pulse 1.5s ease-in-out infinite;"></div>
        <div style="position:absolute;inset:5px;background:#ef4444;border:2.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(239,68,68,0.6);">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        </div>
      </div>`,
      iconSize: [36, 36], iconAnchor: [18, 18],
    });
    alertPinMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 2000 })
      .addTo(mapInstanceRef.current)
      .bindPopup(`<b>Alert Location</b><br/>${label}<br/><small>${lat.toFixed(5)}, ${lng.toFixed(5)}</small>`, { maxWidth: 200 })
      .openPopup();
    mapInstanceRef.current.setView([lat, lng], 16, { animate: true });
  }, [alertPin]);

  // ── Resize map on track load ──
  useEffect(() => { if (mapInstanceRef.current) setTimeout(() => mapInstanceRef.current?.invalidateSize(), 50); }, [trackData]);

  // ── Render track on map (rich markers + event layers) ──
  useEffect(() => {
    if (!trackLayersRef.current || !mapInstanceRef.current) return;
    trackLayersRef.current.clearLayers();
    if (playbackMarkerRef.current) { playbackMarkerRef.current.remove(); playbackMarkerRef.current = null; }
    if (!trackData || trackData.points.length === 0) return;

    const map = mapInstanceRef.current;
    const lg = trackLayersRef.current;
    const points = trackData.points;
    const useOsrm = trackMode === 'osrm' && osrmRoute && osrmRoute.length > 0;

    // Geocode tasks
    const geoTasks: { marker: L.Marker; lat: number; lng: number; build: (a: string) => string }[] = [];
    const addrHtml = (a: string) => a ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;line-height:1.3;">📍 ${a}</div>` : '';

    // Speed-colored segments (or OSRM route)
    if (useOsrm) {
      L.polyline(osrmRoute!, { color: '#10b981', weight: 4, opacity: 0.85 }).addTo(lg);
    } else {
      for (let i = 1; i < points.length; i++) {
        L.polyline(
          [[points[i - 1].latitude, points[i - 1].longitude], [points[i].latitude, points[i].longitude]],
          { color: speedColor(points[i].speed), weight: 3.5, opacity: 0.85 }
        ).addTo(lg);
      }
    }

    // Start marker
    const sp = points[0]; const ep = points[points.length - 1];
    const startM = L.marker([sp.latitude, sp.longitude], {
      icon: L.divIcon({ className: '', html: `<div style="width:28px;height:28px;background:#10B981;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(16,185,129,0.4);font-size:11px;font-weight:bold;color:white;">S</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
    }).addTo(lg);
    const buildStart = (a: string) => `<div style="${TT_STYLE}"><div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="color:#10B981">●</span> Journey Start</div>${addrHtml(a)}<div style="font-size:11px;color:rgba(255,255,255,0.6);">⏱ ${new Date(sp.gpsTime).toLocaleTimeString()}</div></div>`;
    startM.bindTooltip(buildStart(''), { direction: 'top', offset: [0, -16], className: 'event-tooltip' });
    geoTasks.push({ marker: startM, lat: sp.latitude, lng: sp.longitude, build: buildStart });

    // End marker
    const endM = L.marker([ep.latitude, ep.longitude], {
      icon: L.divIcon({ className: '', html: `<div style="width:28px;height:28px;background:#EF4444;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(239,68,68,0.4);font-size:11px;font-weight:bold;color:white;">E</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
    }).addTo(lg);
    const buildEnd = (a: string) => `<div style="${TT_STYLE}"><div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="color:#EF4444">●</span> Journey End</div>${addrHtml(a)}<div style="font-size:11px;color:rgba(255,255,255,0.6);">⏱ ${new Date(ep.gpsTime).toLocaleTimeString()}</div></div>`;
    endM.bindTooltip(buildEnd(''), { direction: 'top', offset: [0, -16], className: 'event-tooltip' });
    geoTasks.push({ marker: endM, lat: ep.latitude, lng: ep.longitude, build: buildEnd });

    // Stop markers
    trackData.stops.forEach((stop: any, idx: number) => {
      const durStr = formatDurationShort(stop.duration);
      const sStart = stop.startTime ? new Date(stop.startTime).toLocaleTimeString() : '';
      const sEnd = stop.endTime ? new Date(stop.endTime).toLocaleTimeString() : '';
      const sm = L.marker([stop.latitude, stop.longitude], {
        icon: L.divIcon({ className: '', html: `<div style="padding:4px 8px;background:#F59E0B;border:2px solid white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:10px;font-weight:600;color:white;white-space:nowrap;">${durStr}</div>`, iconSize: [40, 24], iconAnchor: [20, 12] }),
      }).addTo(lg);
      const buildStop = (a: string) => `<div style="${TT_STYLE}"><div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="color:#F59E0B">■</span> Stop #${idx + 1}</div>${addrHtml(a)}<div style="font-size:18px;font-weight:800;color:#F59E0B;margin-bottom:4px;">${durStr}</div>${sStart && sEnd ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);">⏱ ${sStart} → ${sEnd}</div>` : ''}</div>`;
      sm.bindTooltip(buildStop(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
      geoTasks.push({ marker: sm, lat: stop.latitude, lng: stop.longitude, build: buildStop });
    });

    // GSM coverage halos
    if (showGsmMarkers && points.length > 0) {
      const gsmVals = points.map((p: any) => p.gsmSignal || 0).filter((v: number) => v > 0);
      const maxGsm = gsmVals.length > 0 ? Math.max(...gsmVals) : 31;
      const interval = Math.max(1, Math.floor(points.length / 20));
      for (let i = 0; i < points.length; i += interval) {
        const p = points[i]; const sig = p.gsmSignal || 0;
        const { color, label } = getGsmColor(sig, maxGsm);
        const radius = getGsmHaloRadius(sig, maxGsm);
        const isSimple = maxGsm <= 5;
        L.circle([p.latitude, p.longitude], { radius, color, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: 0.12 })
          .bindTooltip(`<div style="text-align:center;"><strong>GSM: ${sig}${isSimple ? '/5' : ' CSQ'}</strong><br/><span style="color:${color}">● ${label}</span><br/><small>~${Math.round(radius)}m</small></div>`, { direction: 'top' })
          .addTo(lg);
        L.circleMarker([p.latitude, p.longitude], { radius: 4, color, weight: 2, opacity: 1, fillColor: color, fillOpacity: 0.8 }).addTo(lg);
      }
    }

    // Latency markers
    if (showLatencyMarkers && points.length > 0) {
      const latVals = points.map((p: any) => p.latency || 0);
      const avgLat = latVals.reduce((a: number, b: number) => a + b, 0) / latVals.length;
      const maxLat = Math.max(...latVals);
      const interval = Math.max(1, Math.floor(points.length / 25));
      for (let i = 0; i < points.length; i += interval) {
        const p = points[i]; const lat = p.latency || 0;
        const { color, label } = getLatencyColor(lat);
        const gpsStr = p.gpsTime ? new Date(p.gpsTime).toLocaleTimeString() : '--';
        L.marker([p.latitude, p.longitude], {
          icon: L.divIcon({ className: '', html: `<div style="width:24px;height:24px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-size:9px;font-weight:bold;color:white;">${lat}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          zIndexOffset: -50,
        }).bindTooltip(`<div style="text-align:center;"><strong>Latency</strong><br/><span style="color:${color};font-size:16px;font-weight:bold;">${lat}s</span> <span style="color:${color}">${label}</span><br/><small>GPS: ${gpsStr}</small><br/><small>Avg: ${avgLat.toFixed(0)}s | Max: ${maxLat}s</small></div>`, { direction: 'top', offset: [0, -12] }).addTo(lg);
      }
    }

    // Journey event markers (ignition, speed, idle)
    const needsEvents = showIgnitionEvents || showSpeedEvents || showIdleEvents;
    if (needsEvents && journeySummary) {
      if (showIgnitionEvents) {
        journeySummary.ignitionEvents.forEach((evt) => {
          const isOn = evt.type === 'on';
          const bg = isOn ? '#10B981' : '#EF4444';
          const glow = isOn ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)';
          const timeStr = new Date(evt.timestamp).toLocaleTimeString();
          const durLabel = formatDurationShort(evt.prevStateDuration);
          const m = L.marker([evt.latitude, evt.longitude], {
            icon: L.divIcon({ className: '', html: `<div style="width:24px;height:24px;background:${bg};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${glow};"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
            zIndexOffset: 100,
          }).addTo(lg);
          const buildI = (a: string) => `<div style="${TT_STYLE}"><div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="color:${bg}">●</span> Ignition ${isOn ? 'ON' : 'OFF'}</div>${addrHtml(a)}<div style="font-size:11px;color:rgba(255,255,255,0.6);">⏱ ${timeStr}<br/>${isOn ? 'Was OFF' : 'Was ON'} for ${durLabel}</div></div>`;
          m.bindTooltip(buildI(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
          geoTasks.push({ marker: m, lat: evt.latitude, lng: evt.longitude, build: buildI });
        });
      }

      if (showSpeedEvents) {
        journeySummary.speedViolations.forEach((viol) => {
          const peak = Math.round(viol.peakSpeed);
          const vDur = formatDurationShort(viol.duration);
          const vStart = new Date(viol.startTime).toLocaleTimeString();
          const vEnd = new Date(viol.endTime).toLocaleTimeString();
          const m = L.marker([viol.latitude, viol.longitude], {
            icon: L.divIcon({ className: '', html: `<div style="padding:3px 8px;background:rgba(239,68,68,0.95);border:2px solid white;border-radius:14px;box-shadow:0 0 14px rgba(239,68,68,0.5);font-size:10px;font-weight:700;color:white;white-space:nowrap;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>${peak}</div>`, iconSize: [52, 24], iconAnchor: [26, 12] }),
            zIndexOffset: 150,
          }).addTo(lg);
          // Violation polyline highlight
          L.polyline(points.slice(viol.startIndex, viol.endIndex + 1).map((p: any) => [p.latitude, p.longitude] as [number, number]), { color: '#EF4444', weight: 7, opacity: 0.5, dashArray: '8, 4' }).addTo(lg);
          const buildS = (a: string) => `<div style="${TT_STYLE}min-width:170px;"><div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="color:#EF4444">⚠</span> Speed Violation</div>${addrHtml(a)}<div style="font-size:20px;font-weight:800;color:#EF4444;margin-bottom:6px;">${peak} km/h</div><div style="font-size:11px;color:rgba(255,255,255,0.6);">Threshold: ${speedThreshold} km/h<br/>Duration: ${vDur}<br/>⏱ ${vStart} → ${vEnd}</div></div>`;
          m.bindTooltip(buildS(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
          geoTasks.push({ marker: m, lat: viol.latitude, lng: viol.longitude, build: buildS });
        });
      }

      if (showIdleEvents) {
        journeySummary.idleEvents.forEach((idle) => {
          const iDur = formatDurationShort(idle.duration);
          const iStart = new Date(idle.startTime).toLocaleTimeString();
          const iEnd = new Date(idle.endTime).toLocaleTimeString();
          L.circle([idle.latitude, idle.longitude], { radius: 60, color: '#6366F1', weight: 1.5, opacity: 0.6, fillColor: '#6366F1', fillOpacity: 0.08 }).addTo(lg);
          const m = L.marker([idle.latitude, idle.longitude], {
            icon: L.divIcon({ className: '', html: `<div style="padding:3px 8px;background:rgba(99,102,241,0.9);border:2px solid white;border-radius:14px;box-shadow:0 2px 10px rgba(99,102,241,0.4);font-size:10px;font-weight:600;color:white;white-space:nowrap;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>${iDur}</div>`, iconSize: [52, 24], iconAnchor: [26, 12] }),
            zIndexOffset: 50,
          }).addTo(lg);
          const buildD = (a: string) => `<div style="${TT_STYLE}min-width:160px;"><div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="color:#818CF8">⏸</span> Vehicle Idle</div>${addrHtml(a)}<div style="font-size:18px;font-weight:800;color:#818CF8;margin-bottom:6px;">${iDur}</div><div style="font-size:11px;color:rgba(255,255,255,0.6);">Engine ON, not moving<br/>⏱ ${iStart} → ${iEnd}</div></div>`;
          m.bindTooltip(buildD(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
          geoTasks.push({ marker: m, lat: idle.latitude, lng: idle.longitude, build: buildD });
        });
      }
    }

    // Batch geocode all marker tooltips
    if (geoTasks.length > 0) {
      batchReverseGeocode(geoTasks.map(t => ({ lat: t.lat, lng: t.lng }))).then(() => {
        for (const t of geoTasks) { const a = getCachedAddress(t.lat, t.lng); if (a) t.marker.setTooltipContent(t.build(a)); }
      });
    }

    // Fit bounds
    const boundsPoints = useOsrm ? osrmRoute! : points.map((p: any) => [p.latitude, p.longitude] as [number, number]);
    const bounds = L.latLngBounds(boundsPoints);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [trackData, showGsmMarkers, showLatencyMarkers, showIgnitionEvents, showSpeedEvents, showIdleEvents, speedThreshold, trackMode, osrmRoute, journeySummary]);

  // ── Playback effect ──
  useEffect(() => {
    if (!isPlaying || !trackData || trackData.points.length === 0) return;
    const iv = setInterval(() => {
      setCurrentPointIndex(prev => {
        if (prev >= trackData.points.length - 1) { setIsPlaying(false); return prev; }
        return prev + 1;
      });
    }, 100 / playbackSpeed);
    return () => clearInterval(iv);
  }, [isPlaying, playbackSpeed, trackData]);

  // ── Playback marker position ──
  useEffect(() => {
    if (!mapInstanceRef.current || !trackData || trackData.points.length === 0) return;
    const pt = trackData.points[Math.min(currentPointIndex, trackData.points.length - 1)];
    if (!pt) return;
    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.setLatLng([pt.latitude, pt.longitude]);
      const el = playbackMarkerRef.current.getElement();
      if (el) { const w = el.querySelector('.pb-wrapper') as HTMLElement; if (w) w.style.transform = `rotate(${pt.angle}deg)`; }
    } else {
      playbackMarkerRef.current = L.marker([pt.latitude, pt.longitude], {
        icon: L.divIcon({
          className: '', iconSize: [36, 36], iconAnchor: [18, 18],
          html: `<div class="pb-wrapper" style="width:36px;height:36px;transform:rotate(${pt.angle}deg);"><div style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(255,255,255,0.9);background:rgba(139,92,246,0.9);display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(139,92,246,0.6);"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg></div></div>`,
        }),
        zIndexOffset: 2000,
      }).addTo(mapInstanceRef.current);
    }
  }, [currentPointIndex, trackData]);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      try { if (mapInstanceRef.current) mapInstanceRef.current.remove(); } catch { /* */ }
      mapInstanceRef.current = null; markerRef.current = null; accuracyCircleRef.current = null; trackLayersRef.current = null; playbackMarkerRef.current = null;
    };
  }, []);

  // ── Fetch OSRM route ──
  const fetchOsrmRoute = useCallback(async (pts: any[]) => {
    if (pts.length < 2) return null;
    setOsrmLoading(true);
    try {
      const coords = pts.map((p: any) => ({ lat: p.latitude, lon: p.longitude }));
      const resp = await fetch('/api/track/osrm-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: coords }) });
      if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
      const data = await resp.json();
      if (!data.success || !data.route) return null;
      return data.route as [number, number][];
    } catch { return null; }
    finally { setOsrmLoading(false); }
  }, []);

  // ── Load Track ──
  const handleLoadTrack = useCallback(async () => {
    if (!objectId) return;
    setTrackLoading(true); setTrackError(null); setSampledWarning(null);
    try {
      const result = await api.track.getHistory(parseInt(objectId), trackStart.toISOString(), trackEnd.toISOString(), MAX_TRACK_POINTS) as any;
      if (!result.success) throw new Error(result.error || 'Failed to fetch track');
      const rawPoints: any[] = result.data || [];
      if (rawPoints.length === 0) { setTrackError('No track data for this period.'); return; }
      if (result.sampled) setSampledWarning(`Sampled from ${result.totalPoints} points. Narrow the date range for full data.`);

      const points = rawPoints.map((p: any) => ({
        latitude: parseFloat(p.latitude) || 0, longitude: parseFloat(p.longitude) || 0,
        angle: parseInt(p.angle) || 0, speed: parseInt(p.speed) || 0,
        altitude: parseFloat(p.altitude) || 0, satellites: parseInt(p.satellites) || 0,
        gpsTime: new Date(p.gpsTime), serverTime: p.serverTime ? new Date(p.serverTime) : undefined,
        ignition: p.ignition ?? true, gpsValid: p.valid === true || p.valid === 1,
        engineCut: p.engineCut ?? false, battery: parseFloat(p.battery) || 0,
        backupBattery: parseFloat(p.backupBattery) || 0, powerVolt: parseFloat(p.powerVolt) || 0,
        gsmSignal: parseInt(p.gsmSignal) || 0, fuelLevel: p.fuelLevel ? parseFloat(p.fuelLevel) : null,
        latency: parseInt(p.latency) || 0,
      })).filter((p: any) => p.latitude !== 0 && p.longitude !== 0 && Math.abs(p.latitude) > 0.1 && Math.abs(p.longitude) > 0.1);

      if (points.length === 0) { setTrackError('No valid GPS points in this period.'); return; }
      let totalDistance = 0, maxSpeed = 0;
      for (let i = 0; i < points.length; i++) {
        if (points[i].speed > maxSpeed) maxSpeed = points[i].speed;
        if (i > 0) totalDistance += calculateDistance(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
      }
      const totalDuration = points[points.length - 1].gpsTime.getTime() - points[0].gpsTime.getTime();
      const stops = detectStops(points);
      setTrackData({ points, totalDistance, totalDuration, stops, maxSpeed, startTime: trackStart, endTime: trackEnd });
      setCurrentPointIndex(0); setIsPlaying(false);

      if (trackMode === 'osrm') {
        const route = await fetchOsrmRoute(points);
        setOsrmRoute(route);
      } else { setOsrmRoute(null); }
    } catch (err: any) { setTrackError(err.message || 'Failed to load track'); }
    finally { setTrackLoading(false); }
  }, [objectId, trackStart, trackEnd, trackMode, fetchOsrmRoute]);

  const clearTrack = useCallback(() => {
    setTrackData(null); setTrackError(null); setOsrmRoute(null); setSampledWarning(null);
    setIsPlaying(false); setCurrentPointIndex(0); setShowTripTimeline(false);
    if (playbackMarkerRef.current) { playbackMarkerRef.current.remove(); playbackMarkerRef.current = null; }
    if (trackLayersRef.current) trackLayersRef.current.clearLayers();
    if (mapInstanceRef.current && gps?.latitude && gps?.longitude) mapInstanceRef.current.setView([gps.latitude, gps.longitude], 15, { animate: true });
  }, [gps]);

  const applyPreset = useCallback((preset: typeof TRACK_PRESETS[0]) => {
    setActivePreset(preset.label); setTrackStart(new Date(Date.now() - preset.ms)); setTrackEnd(new Date());
  }, []);

  // Derived
  const isOnline = gps ? gps.minutes_since_update < 10 : false;
  const isMoving = gps ? gps.speed > 2 : false;
  const hasTrack = !!(trackData?.points?.length);
  const safeIdx = hasTrack ? Math.min(currentPointIndex, trackData!.points.length - 1) : 0;
  const currentPt = hasTrack ? trackData!.points[safeIdx] : null;
  const progress = hasTrack ? ((safeIdx + 1) / trackData!.points.length) * 100 : 0;

  const metrics: { label: string; value: string; icon: React.ReactNode; color: string }[] = gps ? [
    { label: 'Speed', value: `${Math.round(gps.speed)} km/h`, icon: <Gauge className="w-4 h-4" />, color: gps.speed > 120 ? 'text-red-400' : gps.speed > 80 ? 'text-amber-400' : 'text-emerald-400' },
    { label: 'Heading', value: `${Math.round(gps.angle)}°`, icon: <Navigation className="w-4 h-4" />, color: 'text-blue-400' },
    { label: 'Altitude', value: `${Math.round(gps.altitude)} m`, icon: <ArrowUpCircle className="w-4 h-4" />, color: 'text-cyan-400' },
    { label: 'Satellites', value: `${gps.satellites}`, icon: <Satellite className="w-4 h-4" />, color: gps.satellites >= 6 ? 'text-emerald-400' : gps.satellites >= 3 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Battery', value: `${gps.battery}%`, icon: <Battery className="w-4 h-4" />, color: gps.battery > 50 ? 'text-emerald-400' : gps.battery > 20 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Power', value: `${gps.powervolt?.toFixed(1) || 0}V`, icon: <Zap className="w-4 h-4" />, color: gps.powervolt > 12 ? 'text-emerald-400' : 'text-amber-400' },
    { label: 'GSM Signal', value: `${gps.gsmsignal}%`, icon: <Signal className="w-4 h-4" />, color: gps.gsmsignal > 50 ? 'text-emerald-400' : gps.gsmsignal > 25 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Fuel Level', value: gps.fuellevel ? `${gps.fuellevel}%` : '—', icon: <Fuel className="w-4 h-4" />, color: 'text-cyan-400' },
  ] : [];

  return (
    <div className="space-y-3">
      {/* ── Map ───────────────────────────────────────────── */}
      <div className="lg-card overflow-hidden relative" style={{ height: hasTrack ? 420 : 340 }}>
        <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ background: '#0a0a14' }} />
        {loading && (
          <div className="absolute inset-0 z-map-overlay flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin text-violet-400/50" /><span className="text-xs text-white/30">Loading GPS...</span></div>
          </div>
        )}
        {!loading && !gps && (
          <div className="absolute inset-0 z-map-overlay flex items-center justify-center">
            <div className="text-center"><Satellite className="w-6 h-6 text-white/10 mx-auto mb-1" /><p className="text-xs text-white/20">No GPS data</p></div>
          </div>
        )}
        {gps && (
          <>
            <div className="absolute top-3 left-3 right-14 z-map-overlay pointer-events-none">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl pointer-events-auto backdrop-blur-xl bg-black/40 border border-white/[0.08] shadow-lg ${isOnline ? isMoving ? 'border-l-2 border-l-emerald-400' : gps.ignition ? 'border-l-2 border-l-amber-400' : 'border-l-2 border-l-blue-400' : 'border-l-2 border-l-zinc-500'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                <span className="text-xs font-medium text-white/80">{isOnline ? isMoving ? 'Moving' : gps.ignition ? 'Idle' : 'Parked' : 'Offline'}</span>
                <span className="text-white/10">|</span>
                <span className="text-[10px] text-white/40 font-mono">{gps.gpstime ? format(new Date(gps.gpstime), 'dd MMM HH:mm:ss') : '—'}</span>
                {gps.enginecut && (<><span className="text-white/10">|</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/20">Engine Cut</span></>)}
              </div>
            </div>
            <div className="absolute bottom-3 left-3 z-map-overlay pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl backdrop-blur-xl bg-black/40 border border-white/[0.08]">
                  <Gauge className={`w-3.5 h-3.5 ${gps.speed > 120 ? 'text-red-400' : gps.speed > 80 ? 'text-amber-400' : 'text-emerald-400'}`} />
                  <span className="text-xs font-bold text-white/90">{Math.round(gps.speed)}</span>
                  <span className="text-[9px] text-white/30">km/h</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl backdrop-blur-xl bg-black/40 border border-white/[0.08]">
                  <Navigation className="w-3.5 h-3.5 text-blue-400" style={{ transform: `rotate(${gps.angle}deg)` }} />
                  <span className="text-xs font-bold text-white/90">{Math.round(gps.angle)}°</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl backdrop-blur-xl bg-black/40 border border-white/[0.08]">
                  <Satellite className={`w-3.5 h-3.5 ${gps.satellites >= 6 ? 'text-emerald-400' : 'text-amber-400'}`} />
                  <span className="text-xs font-bold text-white/90">{gps.satellites}</span>
                </div>
              </div>
            </div>
            <div className="absolute bottom-3 right-3 z-map-overlay pointer-events-none">
              <div className="px-2.5 py-1.5 rounded-xl backdrop-blur-xl bg-black/40 border border-white/[0.08] pointer-events-auto">
                <span className="text-[10px] font-mono text-white/50">{toDMS(gps.latitude, true)} &nbsp; {toDMS(gps.longitude, false)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Playback Controls Bar (when track loaded) ──── */}
      <AnimatePresence>
        {hasTrack && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="lg-card overflow-hidden">
            {/* Row 1: Playback + Timeline */}
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex items-center gap-1 flex-shrink-0">
                {trackMode === 'osrm' && osrmRoute ? <Navigation className="w-3.5 h-3.5 text-emerald-400" /> : <MapPin className="w-3.5 h-3.5 text-purple-400" />}
                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${trackMode === 'osrm' && osrmRoute ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'}`}>
                  {trackMode === 'osrm' && osrmRoute ? 'OSRM' : 'RAW'}
                </span>
              </div>
              <div className="w-px h-5 bg-white/10" />
              <div className="flex items-center gap-0.5">
                <button onClick={() => { setIsPlaying(false); setCurrentPointIndex(0); }} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Stop"><Square className="w-3 h-3" /></button>
                <button onClick={() => setCurrentPointIndex(Math.max(0, safeIdx - 10))} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Back"><SkipBack className="w-3 h-3" /></button>
                <button onClick={() => setIsPlaying(!isPlaying)} className="p-1.5 rounded-lg bg-purple-500 hover:bg-purple-600 text-white transition-colors" title={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => setCurrentPointIndex(Math.min(trackData!.points.length - 1, safeIdx + 10))} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Forward"><SkipForward className="w-3 h-3" /></button>
              </div>
              {/* Progress Bar */}
              <div className="flex-1 min-w-[100px]">
                <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden cursor-pointer group" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const pct = (e.clientX - r.left) / r.width; setCurrentPointIndex(Math.max(0, Math.min(trackData!.points.length - 1, Math.floor(pct * trackData!.points.length)))); }}>
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-purple-400 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between mt-0.5 text-[8px] text-slate-500">
                  <span>{currentPt?.gpsTime ? format(new Date(currentPt.gpsTime), 'HH:mm:ss') : '--'}</span>
                  <span>{safeIdx + 1}/{trackData!.points.length}</span>
                </div>
              </div>
              {/* Speed + Stats */}
              <div className="flex items-center gap-2 text-[10px] flex-shrink-0">
                <span className={currentPt && currentPt.speed > 0 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>{currentPt?.speed || 0} km/h</span>
                <span className="text-purple-300 font-medium">{trackData!.totalDistance.toFixed(1)} km</span>
                {currentPt?.latency !== undefined && (
                  <span className={`font-medium ${(currentPt?.latency || 0) <= 5 ? 'text-emerald-400' : (currentPt?.latency || 0) <= 30 ? 'text-amber-400' : 'text-red-400'}`}>{currentPt?.latency || 0}s</span>
                )}
              </div>
              <div className="w-px h-5 bg-white/10" />
              {/* Speed Controls */}
              <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5 flex-shrink-0">
                {PLAYBACK_SPEEDS.map(s => (
                  <button key={s} onClick={() => setPlaybackSpeed(s)} className={`px-1 py-0.5 rounded text-[9px] font-bold transition-colors ${playbackSpeed === s ? 'bg-purple-500 text-white' : 'text-slate-400 hover:text-white'}`}>{s}x</button>
                ))}
              </div>
              <div className="w-px h-5 bg-white/10" />
              {/* Toggle Buttons */}
              <button onClick={() => setShowGsmMarkers(!showGsmMarkers)} className={`p-1 rounded transition-colors ${showGsmMarkers ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="GSM coverage"><Signal className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowLatencyMarkers(!showLatencyMarkers)} className={`p-1 rounded transition-colors ${showLatencyMarkers ? 'bg-rose-500/20 text-rose-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="Latency"><Timer className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowIgnitionEvents(!showIgnitionEvents)} className={`p-1 rounded transition-colors ${showIgnitionEvents ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="Ignition"><Power className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowSpeedEvents(!showSpeedEvents)} className={`p-1 rounded transition-colors ${showSpeedEvents ? 'bg-red-500/20 text-red-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title={`Speed >${speedThreshold}`}><AlertTriangle className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowIdleEvents(!showIdleEvents)} className={`p-1 rounded transition-colors ${showIdleEvents ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="Idle zones"><Fuel className="w-3.5 h-3.5" /></button>
              <div className="w-px h-5 bg-white/10" />
              <button onClick={() => setShowGraphs(!showGraphs)} className={`p-1 rounded transition-colors ${showGraphs ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="Graphs"><BarChart3 className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowInsights(!showInsights)} className={`p-1 rounded transition-colors ${showInsights ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="Insights"><Sparkles className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowTripTimeline(!showTripTimeline)} className={`p-1 rounded transition-colors ${showTripTimeline ? 'bg-purple-500/20 text-purple-400' : 'text-slate-500 hover:text-white hover:bg-white/10'}`} title="Trip timeline"><ScrollText className="w-3.5 h-3.5" /></button>
              <div className="w-px h-5 bg-white/10" />
              <button onClick={clearTrack} className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-white/10 transition-colors" title="Clear"><X className="w-3.5 h-3.5" /></button>
            </div>

            {/* Expandable: Telemetry Graphs */}
            <AnimatePresence>
              {showGraphs && telemetryData && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/[0.06]">
                  <div className="px-3 py-2 grid grid-cols-5 gap-3">
                    <MiniChart data={telemetryData.speed} currentIndex={safeIdx} color="text-emerald-400" label="Speed" unit="km/h" min={0} icon={<Gauge className="w-3 h-3" />} />
                    <MiniChart data={telemetryData.battery} currentIndex={safeIdx} color="text-amber-400" label="Battery" unit="V" min={10} max={15} icon={<Battery className="w-3 h-3" />} />
                    <MiniChart data={telemetryData.powerVolt} currentIndex={safeIdx} color="text-blue-400" label="Power" unit="V" min={10} max={15} icon={<Zap className="w-3 h-3" />} />
                    <MiniChart data={telemetryData.gsmSignal} currentIndex={safeIdx} color="text-cyan-400" label="GSM" unit="" min={0} max={5} icon={<Signal className="w-3 h-3" />} />
                    <MiniChart data={telemetryData.latency} currentIndex={safeIdx} color="text-rose-400" label="Latency" unit="s" min={0} icon={<Timer className="w-3 h-3" />} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Expandable: Journey Insights */}
            <AnimatePresence>
              {showInsights && journeySummary && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/[0.06]">
                  <div className="px-3 py-2 grid grid-cols-8 gap-1.5">
                    {[
                      { icon: <Car className="w-3 h-3" />, val: `${journeySummary.stats.movingPercentage}%`, lbl: 'Moving', sub: formatDurationShort(journeySummary.stats.movingTime), clr: 'text-emerald-400' },
                      { icon: <Square className="w-2.5 h-2.5" />, val: formatDurationShort(journeySummary.stats.stoppedTime), lbl: 'Stopped', clr: 'text-slate-400' },
                      { icon: <Gauge className="w-3 h-3" />, val: `${journeySummary.stats.avgMovingSpeed}`, lbl: 'Avg km/h', clr: 'text-blue-400' },
                      { icon: <Gauge className="w-3 h-3" />, val: `${journeySummary.stats.maxSpeed}`, lbl: 'Max km/h', clr: journeySummary.stats.maxSpeed > speedThreshold ? 'text-red-400' : 'text-amber-400' },
                      { icon: <Power className="w-3 h-3" />, val: `${journeySummary.ignitionEvents.length}`, lbl: 'Ignitions', clr: 'text-emerald-400', toggle: journeySummary.ignitionEvents.length > 0 ? () => setShowIgnitionEvents(!showIgnitionEvents) : undefined, active: showIgnitionEvents },
                      { icon: <AlertTriangle className="w-3 h-3" />, val: `${journeySummary.speedViolations.length}`, lbl: `>${speedThreshold}`, clr: 'text-red-400', toggle: journeySummary.speedViolations.length > 0 ? () => setShowSpeedEvents(!showSpeedEvents) : undefined, active: showSpeedEvents },
                      { icon: <Fuel className="w-3 h-3" />, val: journeySummary.idleEvents.length > 0 ? formatDurationShort(journeySummary.stats.idleTime) : '0', lbl: `${journeySummary.idleEvents.length} Idle`, clr: 'text-indigo-400', toggle: journeySummary.idleEvents.length > 0 ? () => setShowIdleEvents(!showIdleEvents) : undefined, active: showIdleEvents },
                      { icon: <MapPin className="w-3 h-3" />, val: `${trackData!.stops.length}`, lbl: 'Stops', clr: 'text-amber-400' },
                    ].map((c, i) => (
                      <button key={i} onClick={c.toggle} disabled={!c.toggle} className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition-colors ${c.toggle ? 'cursor-pointer hover:bg-white/5' : ''} ${c.active ? 'bg-white/5 ring-1 ring-white/10' : ''}`}>
                        <span className={c.clr}>{c.icon}</span>
                        <span className={`text-[11px] font-bold leading-none ${c.clr}`}>{c.val}</span>
                        <span className="text-[8px] text-slate-500 leading-none">{c.lbl}</span>
                        {c.sub && <span className="text-[7px] text-slate-600 leading-none">{c.sub}</span>}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Address ────────────────────────────────────────── */}
      {(address || loadingAddress) && (
        <div className="lg-card px-4 py-2.5 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-violet-400/50 flex-shrink-0" />
          {loadingAddress ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/20" /> : <span className="text-xs text-white/40 truncate">{address}</span>}
        </div>
      )}

      {/* ── Track History Panel ─────────────────────────────── */}
      <div className="lg-card px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-purple-400/60" />
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider flex-1">Track History</h4>
        </div>

        {/* Track Mode Toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setTrackMode('raw')} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${trackMode === 'raw' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] border border-white/[0.06]'}`}>
            <MapPin className="w-3.5 h-3.5" /><div><div className="font-medium">Raw GPS</div><div className="text-[9px] opacity-60">Direct points</div></div>
          </button>
          <button onClick={() => setTrackMode('osrm')} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${trackMode === 'osrm' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] border border-white/[0.06]'}`}>
            <Navigation className="w-3.5 h-3.5" /><div><div className="font-medium">Road Snap</div><div className="text-[9px] opacity-60">OSRM matched</div></div>
          </button>
        </div>

        {/* Presets */}
        <div className="flex items-center gap-1.5">
          {TRACK_PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${activePreset === p.label ? 'bg-purple-500/20 text-purple-400 border border-purple-500/25' : 'text-white/25 hover:text-white/45 hover:bg-white/[0.03] border border-transparent'}`}>{p.label}</button>
          ))}
        </div>

        {/* Custom date range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-white/20 mb-1 block">From</label>
            <input type="datetime-local" value={format(trackStart, "yyyy-MM-dd'T'HH:mm")} onChange={(e) => { setTrackStart(new Date(e.target.value)); setActivePreset(''); }} className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/70 text-[11px] outline-none focus:border-purple-500/30" />
          </div>
          <div>
            <label className="text-[10px] text-white/20 mb-1 block">To</label>
            <input type="datetime-local" value={format(trackEnd, "yyyy-MM-dd'T'HH:mm")} onChange={(e) => { setTrackEnd(new Date(e.target.value)); setActivePreset(''); }} className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/70 text-[11px] outline-none focus:border-purple-500/30" />
          </div>
        </div>

        {/* Speed Threshold */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/20">Speed threshold:</span>
          <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5">
            {[60, 80, 100, 120].map(t => (
              <button key={t} onClick={() => setSpeedThreshold(t)} className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${speedThreshold === t ? 'bg-red-500/30 text-red-400' : 'text-slate-500 hover:text-white'}`}>{t}</button>
            ))}
          </div>
          <span className="text-[10px] text-white/15">km/h</span>
        </div>

        {/* Errors */}
        {trackError && (
          <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {trackError}
          </div>
        )}
        {sampledWarning && (
          <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {sampledWarning}
          </div>
        )}

        {/* Load Button */}
        <button onClick={handleLoadTrack} disabled={trackLoading || osrmLoading} className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border disabled:opacity-40 ${trackMode === 'osrm' ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border-emerald-500/20' : 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border-purple-500/20'}`}>
          {trackLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading track...</> : osrmLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Matching roads...</> : <><Route className="w-4 h-4" /> Load {trackMode === 'osrm' ? 'Road-Snapped' : 'Raw'} Track</>}
        </button>
      </div>

      {/* ── Track Summary + Speed Legend ────────────────────── */}
      <AnimatePresence>
        {hasTrack && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="lg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-emerald-400/60" />
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Track Summary</h4>
              <span className="text-[10px] text-white/20 ml-auto">{format(trackData!.points[0].gpsTime, 'dd MMM HH:mm')} → {format(trackData!.points[trackData!.points.length - 1].gpsTime, 'dd MMM HH:mm')}</span>
            </div>
            <div className="grid grid-cols-5 gap-3">
              <div className="text-center"><p className="text-sm font-bold text-white/80">{trackData!.totalDistance.toFixed(1)} km</p><p className="text-[10px] text-white/20">Distance</p></div>
              <div className="text-center"><p className="text-sm font-bold text-white/80">{formatDuration(trackData!.totalDuration)}</p><p className="text-[10px] text-white/20">Duration</p></div>
              <div className="text-center"><p className={`text-sm font-bold ${trackData!.maxSpeed > speedThreshold ? 'text-red-400' : 'text-white/80'}`}>{trackData!.maxSpeed} km/h</p><p className="text-[10px] text-white/20">Max Speed</p></div>
              <div className="text-center"><p className="text-sm font-bold text-violet-400">{trackData!.stops.length}</p><p className="text-[10px] text-white/20">Stops</p></div>
              <div className="text-center"><p className="text-sm font-bold text-white/80">{trackData!.points.length}</p><p className="text-[10px] text-white/20">Points</p></div>
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/[0.04]">
              <span className="text-[9px] text-white/15">Speed:</span>
              {[{ c: '#8b5cf6', l: '0-5' }, { c: '#3b82f6', l: '5-40' }, { c: '#22c55e', l: '40-80' }, { c: '#eab308', l: '80-100' }, { c: '#f97316', l: '100-120' }, { c: '#ef4444', l: '120+' }].map(s => (
                <div key={s.l} className="flex items-center gap-1"><div className="w-3 h-1 rounded-full" style={{ background: s.c }} /><span className="text-[9px] text-white/20">{s.l}</span></div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trip Details Timeline ──────────────────────────── */}
      <AnimatePresence>
        {showTripTimeline && hasTrack && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="lg-card overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-purple-500/15 flex items-center justify-center"><Route className="w-3 h-3 text-purple-400" /></div>
                <div><h4 className="text-xs font-semibold text-white leading-none">Trip Details</h4><span className="text-[9px] text-slate-500">{tripTimeline.length} events</span></div>
              </div>
              <div className="flex items-center gap-1.5">
                {geocodingTimeline && <span className="flex items-center gap-1 text-[9px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" />Geocoding...</span>}
                <button onClick={() => setShowTripTimeline(false)} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto px-4 py-3">
              <div className="relative">
                <div className="absolute left-[10px] top-[14px] bottom-[14px] w-px" style={{ background: 'linear-gradient(180deg, rgba(16,185,129,0.5) 0%, rgba(148,163,184,0.15) 20%, rgba(148,163,184,0.15) 80%, rgba(239,68,68,0.5) 100%)' }} />
                {tripTimeline.map((entry: any, idx: number) => {
                  const addr = timelineAddresses.get(entry.id);
                  return (
                    <div key={entry.id} className="relative flex gap-3" style={{ paddingBottom: idx < tripTimeline.length - 1 ? 4 : 0 }}>
                      <div className="relative z-10 flex-shrink-0 mt-1">
                        <div className={`w-[20px] h-[20px] rounded-full flex items-center justify-center border-2 border-[#0a0a14] ${entry.dotColor}`}>
                          {entry.type === 'start' || entry.type === 'end' ? <Flag className="w-[8px] h-[8px] text-white" /> : entry.type === 'stop' ? <CircleDot className="w-[8px] h-[8px] text-white" /> : entry.type.includes('ignition') ? <Power className="w-[8px] h-[8px] text-white" /> : entry.type === 'speed-violation' ? <AlertTriangle className="w-[8px] h-[8px] text-white" /> : <Fuel className="w-[8px] h-[8px] text-white" />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 mb-1 hover:bg-white/[0.02] border border-transparent hover:border-white/5 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[11px] font-semibold ${entry.color} leading-none`}>{entry.label}</span>
                          <span className="text-[9px] text-slate-500 tabular-nums">{format(entry.time, 'HH:mm:ss')}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{entry.detail}{entry.endTime && <span className="text-slate-600"> · until {format(entry.endTime, 'HH:mm:ss')}</span>}</div>
                        {addr && <div className="flex items-start gap-1 mt-1"><MapPin className="w-2.5 h-2.5 text-slate-500 flex-shrink-0 mt-[1px]" /><span className="text-[10px] text-slate-300 leading-snug">{addr}</span></div>}
                        {entry.sub && <div className="text-[9px] text-slate-500 mt-0.5">{entry.sub}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Metrics Grid ───────────────────────────────────── */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="lg-card px-3 py-2.5 text-center">
              <div className={`flex items-center justify-center mb-1 ${m.color}`}>{m.icon}</div>
              <p className={`text-sm font-semibold ${m.color}`}>{m.value}</p>
              <p className="text-[10px] text-white/20">{m.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Alerts Section ────────────────────────────────────────────────
function AlertsSection({ alerts, summary, resolutionRate, loading, expandedAlert, onToggleExpand, onShowOnMap }: {
  alerts: AlertHistoryItem[];
  summary: ReturnType<typeof Object> | null;
  resolutionRate: number;
  loading: boolean;
  expandedAlert: string | null;
  onToggleExpand: (id: string) => void;
  onShowOnMap?: (lat: number, lng: number, label: string) => void;
}) {
  const s = summary as any;

  if (loading) return <LoadingSkeleton label="Loading alert history..." />;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      {s && s.total > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard label="Total" value={s.total} color="text-white/80" />
          <SummaryCard label="Resolved" value={s.resolved} color="text-emerald-400" />
          <SummaryCard label="Escalated" value={s.escalated} color="text-red-400" />
          <SummaryCard label="Active" value={s.active} color="text-blue-400" />
          <SummaryCard label="Pending" value={s.pending} color="text-amber-400" />
          <ResolutionGauge rate={resolutionRate} avgResolve={s.avgResolve} />
        </div>
      )}

      {/* Alert List */}
      {alerts.length === 0 ? (
        <div className="lg-card p-8 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-500/20 mx-auto mb-2" />
          <p className="text-sm text-white/30">No alerts found in the selected period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id || alert.alert_id}
              alert={alert}
              expanded={expandedAlert === (alert.id || alert.alert_id)}
              onToggle={() => onToggleExpand(alert.id || alert.alert_id)}
              onShowOnMap={onShowOnMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="lg-card px-3 py-2.5 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-white/20">{label}</p>
    </div>
  );
}

function ResolutionGauge({ rate, avgResolve }: { rate: number; avgResolve: number | null }) {
  return (
    <div className="lg-card px-3 py-2.5 text-center">
      <p className={`text-lg font-bold ${rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
        {rate}%
      </p>
      <p className="text-[10px] text-white/20">Resolution</p>
      {avgResolve !== null && (
        <p className="text-[9px] text-white/15 mt-0.5">avg {formatSeconds(avgResolve)}</p>
      )}
    </div>
  );
}

// Raw datetime formatter — no timezone conversion
const fmtRaw = (raw?: string | null): string => {
  if (!raw) return '—';
  return String(raw).replace('T', ' ').substring(0, 16);
};

function AlertCard({ alert, expanded, onToggle, onShowOnMap }: {
  alert: AlertHistoryItem;
  expanded: boolean;
  onToggle: () => void;
  onShowOnMap?: (lat: number, lng: number, label: string) => void;
}) {
  const statusCfg = STATUS_CONFIG[alert.status] || STATUS_CONFIG.pending;
  const priorityCfg = PRIORITY_CONFIG[alert.priority] || PRIORITY_CONFIG[5];

  // Parse alert_data to get GPS coordinates at alert time
  const alertCoords = useMemo(() => {
    try {
      const d = typeof alert.alert_data === 'string' ? JSON.parse(alert.alert_data) : alert.alert_data;
      if (!d) return null;
      const lat = Number(d.latitude ?? d.Latitude ?? d.y ?? d.Y ?? 0);
      const lng = Number(d.longitude ?? d.Longitude ?? d.x ?? d.X ?? 0);
      return (lat && lng) ? { lat, lng } : null;
    } catch { return null; }
  }, [alert.alert_data]);

  return (
    <div className="lg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-base flex-shrink-0">{alertTypeIcon(alert.alert_type)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-xs font-medium text-white/70 truncate">{alert.alert_type || 'Unknown'}</span>
            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusCfg.bg} ${statusCfg.color} border ${statusCfg.border}`}>
              {statusCfg.icon}
              {statusCfg.label}
            </span>
            <span className={`text-[10px] ${priorityCfg.color}`}>{priorityCfg.label}</span>
          </div>
          {/* Key info row: agent, alert time, close time */}
          <div className="flex items-center gap-3 flex-wrap mt-0.5">
            {(alert.agent_name || alert.assigned_to) && (
              <span className="flex items-center gap-1 text-[10px] text-white/35">
                <User className="w-2.5 h-2.5" />
                {alert.agent_name || alert.assigned_to}
              </span>
            )}
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <Clock className="w-2.5 h-2.5" />
              <span className="text-white/20">Alert:</span>&nbsp;{fmtRaw(alert.created_at)}
            </span>
            {alert.resolved_at && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400/60">
                <CheckCircle className="w-2.5 h-2.5" />
                <span className="text-white/20">Closed:</span>&nbsp;{fmtRaw(alert.resolved_at)}
              </span>
            )}
          </div>
          {alert.alert_message && (
            <p className="text-[11px] text-white/25 truncate mt-0.5">{alert.alert_message}</p>
          )}
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 border-t border-white/[0.04] space-y-2">
              <div className="grid grid-cols-3 gap-3 pt-2 text-[11px]">
                <DetailField label="Agent" value={alert.agent_name || alert.assigned_to} />
                <DetailField label="Alert Time" value={fmtRaw(alert.created_at)} />
                <DetailField label="Assigned At" value={fmtRaw(alert.assigned_at)} />
                <DetailField label="Acknowledged At" value={fmtRaw(alert.acknowledged_at)} />
                <DetailField label="Closed At" value={fmtRaw(alert.resolved_at)} />
                <DetailField label="Resolution" value={alert.resolution} />
                <DetailField label="Notes" value={alert.resolution_notes} />
              </div>
              {/* Show on Map button */}
              {alertCoords && onShowOnMap && (
                <button
                  onClick={() => onShowOnMap(alertCoords.lat, alertCoords.lng, `${alert.alert_type} — ${fmtRaw(alert.created_at)}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
                >
                  <MapPin className="w-3 h-3" />
                  Show Alert Location on Map
                </button>
              )}
              {alert.escalated_to && (
                <div className="flex items-center gap-2 text-[11px] text-red-400/70 bg-red-500/5 px-3 py-2 rounded-lg border border-red-500/10">
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                  <span>Escalated to <strong>{alert.escalated_to}</strong></span>
                  {alert.escalation_reason && <span className="text-white/25">— {alert.escalation_reason}</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-white/20">{label}</span>
      <p className="text-white/50 mt-0.5">{value || '—'}</p>
    </div>
  );
}

// ── Timeline Section ──────────────────────────────────────────────
function TimelineSection({ events, loading }: { events: TimelineEvent[]; loading: boolean }) {
  if (loading) return <LoadingSkeleton label="Loading timeline..." />;

  if (events.length === 0) {
    return (
      <div className="lg-card p-8 text-center">
        <History className="w-8 h-8 text-white/10 mx-auto mb-2" />
        <p className="text-sm text-white/30">No timeline events found.</p>
      </div>
    );
  }

  const ACTION_COLORS: Record<string, string> = {
    assigned: 'bg-amber-500',
    acknowledged: 'bg-blue-500',
    resolved: 'bg-emerald-500',
    escalated: 'bg-red-500',
    dismissed: 'bg-zinc-500',
    created: 'bg-violet-500',
    reassigned: 'bg-cyan-500',
  };

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/[0.06]" />

      <div className="space-y-1">
        {events.map((event, i) => {
          const dotColor = ACTION_COLORS[event.action] || 'bg-white/20';

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
              className="relative pl-9 py-2"
            >
              {/* Dot */}
              <div className={`absolute left-[11px] top-3 w-[9px] h-[9px] rounded-full ${dotColor} ring-2 ring-[#0a0a14]`} />

              <div className="lg-card px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-medium text-white/60 capitalize">{event.action}</span>
                  {event.alert_type && (
                    <span className="text-[10px] text-white/20">
                      {alertTypeIcon(event.alert_type)} {event.alert_type}
                    </span>
                  )}
                  <div className="flex-1" />
                  <span className="text-[10px] text-white/15 font-mono">
                    {format(new Date(event.performed_at), 'dd MMM HH:mm:ss')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-white/25">
                  <span>by <span className="text-white/40">{event.performed_by || 'system'}</span></span>
                  {event.handling_time_seconds && (
                    <span className="flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {formatSeconds(event.handling_time_seconds)}
                    </span>
                  )}
                  {event.details && typeof event.details === 'object' && event.details.reason && (
                    <span className="text-white/20 truncate max-w-xs">{event.details.reason}</span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────────
function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="lg-card p-8 flex items-center justify-center gap-3">
      <Loader2 className="w-5 h-5 animate-spin text-violet-400/30" />
      <span className="text-sm text-white/25">{label}</span>
    </div>
  );
}
