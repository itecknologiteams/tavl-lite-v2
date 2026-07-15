import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Clock,
  Gauge,
  Satellite,
  Navigation,
  Car,
  Pin,
  PinOff,
  Route,
  Crosshair,
  Loader2,
  MapPinned,
  ChevronDown,
  ChevronUp,
  User,
  Phone,
  MapPin,
  Shield,
  Building,
  FileText,
  AlertTriangle,
  Radio,
  Bell,
  RefreshCw,
  CheckCircle,
  ExternalLink,
  Power,
  BatteryCharging,
  Signal,
  Fuel,
  ShieldAlert,
  Zap,
  Activity,
  Smartphone,
  Mail,
  MessageSquare,
  CheckCheck,
  XCircle,
  PhoneOff,
  PhoneCall,
} from 'lucide-react';
import { useVehicleStore } from '@store/vehicleStore';
import { useTrackStore } from '@store/trackStore';
import { useCallStore } from '@store/callStore';
import { useLayoutStore } from '@store/layoutStore';
import { api, isElectron } from '@services/api';
import { formatDistanceToNow, format } from 'date-fns';
import CommandCenter from './CommandCenter';
import VehicleLogsPanel from './VehicleLogsPanel';
import VehicleClosurePanel from './VehicleClosurePanel';
import VehicleCallHistoryPanel from './VehicleCallHistoryPanel';
import { useWeather } from '@hooks/useWeather';
import { useVehicleAlerts, ALERT_SEVERITY_CONFIG, getAlertIcon } from '@hooks/useVehicleAlerts';
import { useVehicleConsoleAlerts } from '@hooks/useVehicleConsoleAlerts';
import { reverseGeocodeFull } from '@utils/geocoder';

const pad2 = (n: number) => String(n).padStart(2, '0');
/**
 * IMPORTANT: Many DB datetime fields are "timezone-less" (SQL Server datetime).
 * When Node serializes them it often outputs ISO strings with `Z` (UTC), and then
 * the browser adds +5 hours (PKT). We want to display the exact wall-clock time
 * stored in DB, so we parse in a timezone-less way.
 */
const toWallClockDate = (raw: any): Date | null => {
  if (!raw) return null;

  // If we already have a Date, treat its UTC components as the desired wall time.
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return new Date(
      raw.getUTCFullYear(),
      raw.getUTCMonth(),
      raw.getUTCDate(),
      raw.getUTCHours(),
      raw.getUTCMinutes(),
      raw.getUTCSeconds(),
      raw.getUTCMilliseconds()
    );
  }

  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;

    // "YYYY-MM-DD HH:mm:ss" (or with "T") → treat as local wall time.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const [, yy, mo, dd, hh, mm, ss] = m;
      return new Date(
        Number(yy),
        Number(mo) - 1,
        Number(dd),
        Number(hh),
        Number(mm),
        Number(ss || '0')
      );
    }

    // ISO with explicit timezone (Z or offset): preserve wall time using UTC parts.
    const hasExplicitTz = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
    if (hasExplicitTz) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return new Date(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          d.getUTCHours(),
          d.getUTCMinutes(),
          d.getUTCSeconds(),
          d.getUTCMilliseconds()
        );
      }
    }

    // Fallback
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
};

const formatDateTime24 = (raw: any): string => {
  if (!raw) return 'N/A';
  if (typeof raw === 'string') {
    const s = raw.trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
  }
  try {
    const d = toWallClockDate(raw);
    if (!d) return 'N/A';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return 'N/A';
  }
};

const formatVoltageDetailed = (raw?: any): string | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (isNaN(n)) return String(raw);
  if (n > 100) return `${(n / 1000).toFixed(2)}V (${n})`;
  return `${n.toFixed(2)}V`;
};

const formatHumanDateTime = (raw?: any): string | null => {
  if (!raw) return null;
  try {
    const d = toWallClockDate(raw);
    if (!d) return String(raw);
    return format(d, 'dd MMM yyyy, hh:mm a');
  } catch {
    return String(raw);
  }
};

const STATUS_CONFIG: Record<string, { color: string; bgColor: string }> = {
  moving: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
  idle: { color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  parked: { color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  stopped: { color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  offline: { color: 'text-slate-400', bgColor: 'bg-slate-500/20' },
  'gps-invalid': { color: 'text-pink-400', bgColor: 'bg-pink-500/20' },
  alarm: { color: 'text-red-400', bgColor: 'bg-red-500/20' },
};

// CRM data type
interface CrmData {
  Vehicle_Id?: number | string;
  CustomerId?: number | string;
  CustomerName?: string;
  CellNo?: string;
  TelephoneNo?: string;
  AlternateContact?: string; // CONT3 in legacy panel
  Address1?: string;
  Address2?: string;
  Email?: string;
  NIC?: string;
  DateOfBirth?: string;
  Vehicle_Make?: string;
  Vehicle_Model?: string;
  Vehicle_CC?: string;
  Vehicle_Year?: string;
  Vehicle_Color?: string;
  Vehicle_RegistrationNo?: string;
  Vehicle_ChasisNo?: string;
  Vehicle_EngineNo?: string;
  Vehicle_Transmission?: string;
  Vehicle_Device?: string;
  Vehicle_DeviceSerial?: string;
  Vehicle_SIM?: string;
  Vehicle_IMEINo?: string;
  Vehicle_DateOfInstallation?: string;
  Vehicle_Installation_location?: string;
  Vehicle_Technician?: string;
  ProductSegment?: string;
  Vehicle_IsLeased?: string;
  Vehicle_Lessee?: string;
  LeasedBy?: string; // Bank/company name (B_NAME in legacy panel)
  Vehicle_IsInsured?: string;
  InsuredBy?: string;
  FLEET_TYPE?: string;
  BRANCH_NAME?: string;
  Vehicle_TrackingSpecialInstructions?: string;
  // Security/Verification fields
  VerificationPassword?: string;
  EmergencyPassword?: string;
  SecurityQuestion?: string;
  SecurityAnswer?: string;
  SecondaryUser?: string;
  SecondaryContact?: string;
  SecondaryContact2?: string;
  EmergencyContactPerson?: string;
  EmergencyContactNumber?: string;
  EmergencyContactNumber2?: string;
  MotherName?: string;
  SpecialInstructions?: string;
  Immobilizer?: string | number | boolean;
}

// App Info type (from MobileApp database)
interface AppInfo {
  appVersion: string;
  lastLogin: string;
  device: {
    brand: string;
    model: string;
    osVersion: string;
    platform: string;
  };
  pushEnabled: boolean;
  email: string;
  isActive: boolean;
  stats: {
    totalDevices: number;
    notificationsSent30d: number;
    notificationsReceived30d: number;
    notificationsUnread30d: number;
  };
}

// Notification type
interface AppNotification {
  id: number;
  title: string;
  message: string;
  sentDate: string;
  receivedDate: string | null;
  isRead: boolean;
  vehicleRegistration: string;
  type: string;
  typeId: number;
}

// Address caching is handled by the shared geocoder utility
// Cache for CRM data
type TimedCacheEntry<T> = { data: T; ts: number };
// Cache CRM lookups, but don't cache "null" forever (warm-up / transient DB issues can cause false negatives)
const CRM_NULL_TTL_MS = 30_000;      // retry nulls after 30s
const CRM_SUCCESS_TTL_MS = 10 * 60_000; // keep successful results for 10m
const crmCache = new Map<string, TimedCacheEntry<CrmData | null>>();
// Cache for app info
const appInfoCache = new Map<string, AppInfo | null>();
// Cache for POI results
const poiCache = new Map<string, { name: string; type: string; distance: number } | null>();

// Fetch nearby POI from Overpass API (outside component to avoid recreation)
const fetchNearbyPOI = async (lat: number, lng: number): Promise<{ name: string; type: string; distance: number } | null> => {
  const cacheKey = `poi-${lat.toFixed(4)},${lng.toFixed(4)}`;
  
  if (poiCache.has(cacheKey)) {
    return poiCache.get(cacheKey) || null;
  }

  try {
    // Overpass query for named POIs within 100m radius
    const query = `
      [out:json][timeout:10];
      (
        node["name"]["amenity"](around:100,${lat},${lng});
        node["name"]["shop"](around:100,${lat},${lng});
        node["name"]["building"](around:100,${lat},${lng});
        node["name"]["office"](around:100,${lat},${lng});
        node["name"]["tourism"](around:100,${lat},${lng});
        node["name"]["leisure"](around:100,${lat},${lng});
        way["name"]["amenity"](around:100,${lat},${lng});
        way["name"]["shop"](around:100,${lat},${lng});
        way["name"]["building"](around:100,${lat},${lng});
        way["name"]["office"](around:100,${lat},${lng});
        way["name"]["tourism"](around:100,${lat},${lng});
        way["name"]["leisure"](around:100,${lat},${lng});
      );
      out center;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      poiCache.set(cacheKey, null);
      return null;
    }

    const data = await response.json();
    
    if (!data.elements || data.elements.length === 0) {
      poiCache.set(cacheKey, null);
      return null;
    }

    // Calculate distance and find closest POI
    const toRad = (deg: number) => deg * Math.PI / 180;
    const calcDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371000; // Earth radius in meters
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    let closest: { name: string; type: string; distance: number } | null = null;
    
    for (const el of data.elements) {
      const name = el.tags?.name;
      if (!name) continue;
      
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (!elLat || !elLng) continue;
      
      const distance = calcDistance(lat, lng, elLat, elLng);
      
      // Determine POI type
      const type = el.tags?.amenity || el.tags?.shop || el.tags?.tourism || 
                   el.tags?.leisure || el.tags?.office || el.tags?.building || 'place';
      
      if (!closest || distance < closest.distance) {
        closest = { name, type, distance: Math.round(distance) };
      }
    }

    poiCache.set(cacheKey, closest);
    return closest;
  } catch (err) {
    console.error('Overpass POI error:', err);
    poiCache.set(cacheKey, null);
    return null;
  }
};

export default function VehicleDetailPanel() {
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const pinnedVehicles = useVehicleStore((state) => state.pinnedVehicles);
  const selectVehicle = useVehicleStore((state) => state.selectVehicle);
  const togglePinVehicle = useVehicleStore((state) => state.togglePinVehicle);
  const focusOnVehicle = useVehicleStore((state) => state.focusOnVehicle);
  const updateVehicle = useVehicleStore((state) => state.updateVehicle);

  const openTrackDialog = useTrackStore((state) => state.openDialog);
  
  // Call store - for AMI mode, just need extension configured
  const makeCall = useCallStore((state) => state.makeCall);
  const phoneExtension = useCallStore((state) => state.extension);
  const isInCall = useCallStore((state) => state.currentCall !== null);
  
  // Just need extension set to make calls (AMI will handle connection)
  const canMakeCall = !!phoneExtension;

  const setRightPanelWidth = useLayoutStore((s) => s.setRightPanelWidth);

  // Location/address state
  const [address, setAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  
  // CRM data state
  const [crmData, setCrmData] = useState<CrmData | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  
  // App Info state (from MobileApp database)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [appInfoLoading, setAppInfoLoading] = useState(false);
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Command Center state
  const [showCommandCenter, setShowCommandCenter] = useState(false);
  
  // Vehicle Logs state
  const [showVehicleLogs, setShowVehicleLogs] = useState(false);
  const [vehicleDbId, setVehicleDbId] = useState<number | null>(null); // Stable V_ID for logs
  const [vehicleHistoryTab, setVehicleHistoryTab] = useState<'technical' | 'closure' | 'calls'>('technical');

  const DETAIL_W = 420; // max-w-[420px] from Dashboard wrapper
  const HISTORY_W = 520; // animate={{ width: 520 }} on history slide-out
  useEffect(() => {
    const w = DETAIL_W + (showVehicleLogs ? HISTORY_W : 0);
    setRightPanelWidth(w);
    return () => setRightPanelWidth(0);
  }, [showVehicleLogs, setRightPanelWidth]);

  // Weather data for vehicle location
  const { weather, loading: weatherLoading } = useWeather(
    selectedVehicle?.gpsData?.latitude ?? null,
    selectedVehicle?.gpsData?.longitude ?? null
  );
  
  // Vehicle alerts (quick range selector)
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [alertsSource, setAlertsSource] = useState<'all' | 'eventlog' | 'console'>('all');
  const [alertsRange, setAlertsRange] = useState<'24h' | '7d' | '30d'>('7d');
  // Convert range to days — server uses GETDATE() so the window is always "now - N days"
  // This ensures auto-refresh always fetches the latest data.
  const alertsDays =
    alertsRange === '24h' ? 1 :
    alertsRange === '30d' ? 30 : 7;
  const formatDateTime = (raw?: string) => {
    if (!raw) return '';
    // Return the raw DB string as-is (already formatted as YYYY-MM-DD HH:mm:ss by SQL CONVERT)
    return String(raw).replace('T', ' ').substring(0, 19);
  };
  const { alerts: eventlogAlerts, loading: alertsLoading, total: alertsTotal, refresh: refreshAlerts } = useVehicleAlerts(
    selectedVehicle?.objectId ?? null,
    { days: alertsDays, limit: showAllAlerts ? 100 : 20 }
  );
  const {
    alerts: consoleAlerts,
    loading: consoleAlertsLoading,
    total: consoleAlertsTotal,
    refresh: refreshConsoleAlerts,
  } = useVehicleConsoleAlerts(
    { vehicleId: vehicleDbId, objectId: selectedVehicle?.objectId ?? null },
    { days: alertsDays, limit: showAllAlerts ? 100 : 20, enabled: !!selectedVehicle?.objectId }
  );

  const mergedAlerts = (() => {
    if (alertsSource === 'eventlog') return eventlogAlerts;
    if (alertsSource === 'console') return consoleAlerts;
    const all = [...(eventlogAlerts || []), ...(consoleAlerts || [])];
    return all.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  })();
  const mergedTotal =
    alertsSource === 'eventlog' ? alertsTotal :
    alertsSource === 'console' ? consoleAlertsTotal :
    (alertsTotal + consoleAlertsTotal);

  // ── Robocall status for vehicle alerts ─────────────────────────────────
  const [robocallMap, setRobocallMap] = useState<Record<string, {
    status: string;
    callPlacedAt?: string;
  }>>({});
  const robocallKeysRef = useRef('');

  const fetchRobocallStatuses = useCallback(async (alertList: typeof mergedAlerts) => {
    if (alertList.length === 0) { setRobocallMap({}); return; }

    const payload = alertList.map(a => {
      const isConsole = a.source === 'console';
      const warningId = isConsole ? (a.value?.WarningId?.toString() || a.id.replace('console:', '')) : undefined;
      return {
        id: a.id,
        warningId,
        alertType: isConsole ? 'geofence' : undefined,
        objectId: a.vehicleId || selectedVehicle?.objectId?.toString(),
        timestamp: a.occurredAt,
      };
    });

    try {
      const res = await api.robocall.lookupBatch(payload);
      if (res.success && res.data) {
        const mapped: Record<string, { status: string; callPlacedAt?: string }> = {};
        for (const [key, val] of Object.entries(res.data as Record<string, any>)) {
          mapped[key] = { status: val.status, callPlacedAt: val.callPlacedAt };
        }
        setRobocallMap(mapped);
      }
    } catch { /* robocall DB may be unavailable */ }
  }, [selectedVehicle?.objectId]);

  useEffect(() => {
    const keys = mergedAlerts.map(a => a.id).sort().join(',');
    if (keys === robocallKeysRef.current || mergedAlerts.length === 0) {
      if (mergedAlerts.length === 0) setRobocallMap({});
      return;
    }
    robocallKeysRef.current = keys;
    fetchRobocallStatuses(mergedAlerts);
  }, [mergedAlerts, fetchRobocallStatuses]);

  const getRobocallLabel = (status: string): { text: string; color: string; icon: typeof PhoneCall } => {
    switch (status) {
      case 'answered': return { text: 'Success', color: 'text-emerald-400', icon: PhoneCall };
      case 'no_answer': return { text: 'Not Answered', color: 'text-yellow-400', icon: PhoneOff };
      case 'dialing':
      case 'ringing': return { text: 'Calling...', color: 'text-blue-400', icon: PhoneCall };
      default: return { text: 'Failed', color: 'text-red-400', icon: PhoneOff };
    }
  };

  // ── Vehicle "Info" tabs (Vehicle / Customer / Security) ────────────────
  type InfoTabKey = 'vehicle' | 'customer' | 'security';
  const [infoTab, setInfoTab] = useState<InfoTabKey>('customer');

  const InfoTabButton: React.FC<{
    tab: InfoTabKey;
    label: string;
    icon: React.ReactNode;
  }> = ({ tab, label, icon }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setInfoTab(tab); }}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
        infoTab === tab
          ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
          : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
      }`}
      title={label}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );

  const KV: React.FC<{ label: string; value?: any; mono?: boolean; bold?: boolean }> = ({ label, value, mono, bold }) => {
    const v = value === null || value === undefined || String(value).trim() === '' || String(value) === '-' ? null : String(value);
    if (!v) return null;
    return (
      <div className="flex items-baseline justify-between gap-2 py-0.5">
        <span className="text-[10px] text-slate-500 uppercase whitespace-nowrap flex-shrink-0">
          {label}
        </span>
        <span className={`text-[11px] text-white/90 leading-snug text-right break-all ${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : ''}`} title={v}>
          {v}
        </span>
      </div>
    );
  };

  // State for nearby POI
  const [nearbyPOI, setNearbyPOI] = useState<{ name: string; type: string; distance: number } | null>(null);

  // Fetch address via local Nominatim when vehicle changes
  useEffect(() => {
    if (!selectedVehicle?.gpsData?.latitude || !selectedVehicle?.gpsData?.longitude) {
      setAddress(null);
      setNearbyPOI(null);
      return;
    }

    const lat = selectedVehicle.gpsData.latitude;
    const lng = selectedVehicle.gpsData.longitude;

    const fetchAddress = async () => {
      setAddressLoading(true);
      try {
        const [addr, poi] = await Promise.all([
          reverseGeocodeFull(lat, lng),
          fetchNearbyPOI(lat, lng),
        ]);
        setNearbyPOI(poi);
        setAddress(addr || 'Unknown location');
      } catch (err) {
        console.error('Geocoding error:', err);
        setAddress('Unable to fetch address');
      } finally {
        setAddressLoading(false);
      }
    };

    const timeout = setTimeout(fetchAddress, 300);
    return () => clearTimeout(timeout);
  }, [selectedVehicle?.gpsData?.latitude, selectedVehicle?.gpsData?.longitude]);

  // Fetch CRM data when vehicle changes
  useEffect(() => {
    if (!selectedVehicle?.objectId) {
      setCrmData(null);
      setVehicleDbId(null);
      setShowVehicleLogs(false);
      return;
    }

    const objectId = selectedVehicle.objectId;
    const cacheKey = objectId.toString();

    // Check cache first
    const cachedEntry = crmCache.get(cacheKey);
    if (cachedEntry) {
      const age = Date.now() - cachedEntry.ts;
      const ttl = cachedEntry.data ? CRM_SUCCESS_TTL_MS : CRM_NULL_TTL_MS;
      if (age < ttl) {
        const cachedData = cachedEntry.data || null;
        setCrmData(cachedData);
        // Also set vehicleDbId from cache
        if (cachedData?.Vehicle_Id) {
          setVehicleDbId(parseInt(String(cachedData.Vehicle_Id)));
        } else {
          setVehicleDbId(null);
        }
        return;
      }
      // Expired cache entry → refetch
      crmCache.delete(cacheKey);
    }

    const fetchCrmData = async () => {
      setCrmLoading(true);
      try {
        const electron = isElectron() ? (window as any).electron : null;
        const getDetails = async (identifier: any) =>
          isElectron()
            ? await electron?.crm?.getVehicleDetails(identifier)
            : await api.crm.getVehicleDetails(identifier);

        // Try multiple identifiers (some vehicles don't have CRM objectId mapping but exist by reg/plate)
        const candidates = Array.from(new Set([
          objectId,
          (selectedVehicle as any)?.registrationNumber,
          selectedVehicle?.name,
        ].filter(Boolean).map(String)));

        let result: any = null;
        for (const cand of candidates) {
          result = await getDetails(cand);
          if (result?.success && result.data) break;
        }

        if (result?.success && result.data) {
          crmCache.set(cacheKey, { data: result.data, ts: Date.now() });
          setCrmData(result.data);
          // Store Vehicle_Id for logs panel (stable reference)
          if (result.data.Vehicle_Id) {
            setVehicleDbId(parseInt(String(result.data.Vehicle_Id)));
          }
          console.log('✅ CRM data loaded for', selectedVehicle.name);
        } else {
          crmCache.set(cacheKey, { data: null, ts: Date.now() });
          setCrmData(null);
          setVehicleDbId(null);
        }
      } catch (error) {
        console.error('Failed to fetch CRM data:', error);
        crmCache.set(cacheKey, { data: null, ts: Date.now() });
        setVehicleDbId(null);
        setCrmData(null);
      } finally {
        setCrmLoading(false);
      }
    };

    // Small delay
    const timeout = setTimeout(fetchCrmData, 200);
    return () => clearTimeout(timeout);
  }, [selectedVehicle?.objectId, selectedVehicle?.name]);

  const locationFull = (() => {
    if (!address) return '';
    if (nearbyPOI?.name && typeof nearbyPOI.distance === 'number') {
      const km = nearbyPOI.distance / 1000;
      const kmStr = km < 1 ? km.toFixed(2) : km.toFixed(1);
      return `${kmStr}Km from ${nearbyPOI.name}, ${address}`;
    }
    return address;
  })();

  // Fetch App Info when CRM data is loaded (need contact number)
  useEffect(() => {
    if (!crmData?.CellNo) {
      setAppInfo(null);
      setAppNotifications([]);
      return;
    }

    // Normalize phone number (remove leading 0, +92, etc.)
    let contact = crmData.CellNo.trim().replace(/\s+/g, '');
    if (contact.startsWith('+92')) contact = '0' + contact.slice(3);
    if (contact.startsWith('92')) contact = '0' + contact.slice(2);
    if (!contact.startsWith('0')) contact = '0' + contact;

    // Check cache
    if (appInfoCache.has(contact)) {
      setAppInfo(appInfoCache.get(contact) || null);
      return;
    }

    const fetchAppInfo = async () => {
      setAppInfoLoading(true);
      try {
        // Fetch app info
        const infoResponse = await api.customerApp.getInfo(contact);
        if (infoResponse.success && infoResponse.data) {
          setAppInfo(infoResponse.data as AppInfo);
          appInfoCache.set(contact, infoResponse.data as AppInfo);
        } else {
          setAppInfo(null);
          appInfoCache.set(contact, null);
        }

        // Fetch notifications for this vehicle
        if (selectedVehicle?.name) {
          const notifResponse = await api.customerApp.getVehicleNotifications(selectedVehicle.name, { days: 7, limit: 20 });
          if (notifResponse.success && notifResponse.data) {
            setAppNotifications(notifResponse.data as AppNotification[]);
          }
        }
      } catch (error) {
        console.error('Error fetching app info:', error);
        setAppInfo(null);
        appInfoCache.set(contact, null);
      } finally {
        setAppInfoLoading(false);
      }
    };

    const timeout = setTimeout(fetchAppInfo, 300);
    return () => clearTimeout(timeout);
  }, [crmData?.CellNo, selectedVehicle?.name]);

  const isPinned = !!(selectedVehicle?.objectId && pinnedVehicles.has(selectedVehicle.objectId));

  // Auto-refresh GPS for selected (non-pinned) vehicles every 10s
  useEffect(() => {
    if (!selectedVehicle?.objectId || isPinned) return;
    const objectId = selectedVehicle.objectId;

    const refresh = async () => {
      try {
        const result = await api.vehicle.getDetails(parseInt(objectId));
        if (result?.success && result?.data) {
          const d = result.data as any;
          const lat = parseFloat(d.latitude) || 0;
          const lng = parseFloat(d.longitude) || 0;
          if (lat === 0 && lng === 0) return;
          updateVehicle(objectId, {
            status: d.status || undefined,
            gpsData: {
              latitude: lat,
              longitude: lng,
              speed: parseInt(d.speed) || 0,
              angle: parseInt(d.angle) || 0,
              altitude: parseInt(d.altitude) || 0,
              satellites: parseInt(d.satellites) || 0,
              gpsTime: d.gpsTime ? new Date(d.gpsTime) : new Date(),
              serverTime: d.serverTime ? new Date(d.serverTime) : new Date(),
              valid: d.gpsValid ?? true,
              Ignition: d.ignition ?? d.Ignition,
              EngineCut: d.engineCut ?? d.EngineCut,
              Battery: d.battery ?? d.Battery,
              BackupBattery: d.backupBattery ?? d.BackupBattery,
              PowerVolt: d.powerVolt ?? d.PowerVolt,
              GsmSignal: d.gsmSignal ?? d.GsmSignal,
              FuelLevel: d.fuelLevel ?? d.FuelLevel,
            },
          } as any);
        }
      } catch { /* non-fatal */ }
    };

    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [selectedVehicle?.objectId, isPinned, updateVehicle]);

  if (!selectedVehicle) return null;

  const gps = selectedVehicle.gpsData;
  const statusConfig = STATUS_CONFIG[selectedVehicle.status] || STATUS_CONFIG.offline;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="relative lg-panel-float rounded-2xl overflow-visible max-h-[calc(100vh-6.5rem)] flex flex-col"
    >
      {/* Main scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <div className="p-3 border-b border-white/5 sticky top-0 lg-header-dense z-10 rounded-t-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${statusConfig.bgColor}`}>
              <Car className={`w-4 h-4 ${statusConfig.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-white text-sm truncate">{selectedVehicle.name}</h2>
              <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden flex-nowrap">
                <span className={`text-[10px] font-medium uppercase flex-shrink-0 ${statusConfig.color}`}>
                  {selectedVehicle.status}
                </span>
                <>
                  <span className="text-slate-600 flex-shrink-0">•</span>
                  <span className="text-[10px] text-cyan-400 flex items-center gap-1 flex-shrink-0" title="Auto-refreshing every 10s">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    LIVE
                  </span>
                </>
                {selectedVehicle.registrationNumber && (
                  <>
                    <span className="text-slate-600 flex-shrink-0">•</span>
                    <span className="text-[10px] text-slate-500 truncate">{selectedVehicle.registrationNumber}</span>
                  </>
                )}
                {crmData?.Vehicle_Device && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono flex-shrink-0 ml-auto" title="Tracking Device Model">
                    {crmData.Vehicle_Device}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="lg-icon-btn p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={() => selectVehicle(null)}
              className="lg-icon-btn p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Current Location - Always visible */}
      {gps && (
        <div className="px-3 py-2 bg-gradient-to-r from-primary-500/10 to-transparent border-b border-white/5">
          <div className="flex items-start gap-2">
            <MapPinned className="w-3.5 h-3.5 text-primary-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-slate-500 uppercase font-medium mb-0.5">Current Location</div>
              
              {/* Nearby POI - shown prominently if found */}
              {nearbyPOI && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-cyan-400">{nearbyPOI.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                    ~{nearbyPOI.distance}m
                  </span>
                </div>
              )}
              
              {addressLoading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Fetching address...</span>
                </div>
              ) : (
                <p className={`text-xs leading-snug ${nearbyPOI ? 'text-slate-400' : 'text-white'}`}>
                  {address || 'Location unavailable'}
                </p>
              )}
              <a 
                href={`https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-slate-500 hover:text-cyan-400 mt-1 font-mono inline-flex items-center gap-1 transition-colors"
                title="Open in Google Maps"
              >
                {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Expandable Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Vehicle / Customer / Security tabs — top of panel for quick agent access */}
            <div className="border-b border-white/5">
              <div
                className="px-4 py-2 lg-section-dense flex items-center justify-between gap-2 flex-wrap"
                style={{ pointerEvents: 'auto' }}
              >
                <span className="text-xs font-medium text-slate-400 uppercase">Information</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <InfoTabButton tab="vehicle" label="Vehicle Info" icon={<Car className="w-3.5 h-3.5" />} />
                  <InfoTabButton tab="customer" label="Customer Info" icon={<User className="w-3.5 h-3.5" />} />
                  <InfoTabButton tab="security" label="Security Info" icon={<Shield className="w-3.5 h-3.5" />} />
                </div>
              </div>

              {crmLoading ? (
                <div className="p-4 flex items-center justify-center gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading customer data...</span>
                </div>
              ) : (
                <div className="p-3">
                  {infoTab === 'vehicle' && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                        <div className="text-[10px] text-slate-500 uppercase">Selected Vehicle</div>
                        <div className="text-sm text-white font-semibold truncate" title={selectedVehicle.name}>{selectedVehicle.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          ObjectId: <span className="text-white/80 font-mono">{selectedVehicle.objectId}</span>
                        </div>
                      </div>

                      {crmData ? (
                        <div className="space-y-3">
                          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                            <div className="text-[10px] text-slate-500 uppercase mb-1">Vehicle Details</div>
                            <KV label="Reg #" value={crmData.Vehicle_RegistrationNo || crmData.Vehicle_RegistrationNo} mono />
                            <KV label="Make" value={crmData.Vehicle_Make} />
                            <KV label="Model" value={crmData.Vehicle_Model} />
                            <KV label="CC" value={crmData.Vehicle_CC} />
                            <KV label="Year" value={crmData.Vehicle_Year} />
                            <KV label="Color" value={crmData.Vehicle_Color} />
                            <KV label="Transmission" value={crmData.Vehicle_Transmission} />
                            <KV label="Chassis" value={crmData.Vehicle_ChasisNo} mono />
                            <KV label="Engine" value={crmData.Vehicle_EngineNo} mono />
                          </div>

                          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                            <div className="text-[10px] text-slate-500 uppercase mb-1">Installation / Device</div>
                            <KV label="Installed" value={formatHumanDateTime(crmData.Vehicle_DateOfInstallation)} />
                            <KV label="Location" value={crmData.Vehicle_Installation_location} />
                            <KV label="Technician" value={crmData.Vehicle_Technician} />
                            <KV label="Device" value={crmData.Vehicle_Device} />
                            <KV label="Serial" value={crmData.Vehicle_DeviceSerial} mono />
                            <KV label="SIM" value={crmData.Vehicle_SIM} mono />
                            <KV label="IMEI" value={crmData.Vehicle_IMEINo} mono />
                            <KV label="Segment" value={crmData.ProductSegment} />
                            <KV label="Leased" value={crmData.Vehicle_IsLeased} />
                            <KV label="Lessee" value={crmData.Vehicle_Lessee} />
                            <KV label="Leased By" value={crmData.LeasedBy} />
                            <KV label="Insured" value={crmData.Vehicle_IsInsured} />
                            <KV label="Insured By" value={crmData.InsuredBy} />
                            <KV label="Fleet / Branch" value={[crmData.FLEET_TYPE, crmData.BRANCH_NAME].filter(Boolean).join(' - ')} />
                            <KV label="Immobilizer" value={crmData.Immobilizer} />
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                          <Car className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                          <div className="text-sm text-slate-400 font-medium">No Vehicle Info (CRM)</div>
                          <div className="text-xs text-slate-500 mt-1">CRM details were not found for this vehicle.</div>
                        </div>
                      )}
                    </div>
                  )}

                  {infoTab === 'customer' && (
                    <div className="space-y-3">
                      {crmData ? (
                        <>
                          {crmData.CustomerName && (
                            <div className="flex items-start gap-2">
                              <User className="w-4 h-4 text-primary-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] text-slate-500 uppercase">Customer</div>
                                <div className="text-sm text-white font-medium">{crmData.CustomerName}</div>
                              </div>
                            </div>
                          )}

                          {(crmData.CellNo || crmData.TelephoneNo) && (
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-[10px] text-slate-500 uppercase mb-1">Contact (Click to Call)</div>
                              <div className="flex flex-wrap gap-2">
                                {crmData.CellNo && (
                                  <button
                                    onClick={() => makeCall(crmData.CellNo!, crmData.CustomerName, selectedVehicle.name)}
                                    disabled={!canMakeCall || isInCall}
                                    className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canMakeCall ? 'Configure phone extension first' : isInCall ? 'Already in call' : `Call ${crmData.CellNo}`}
                                  >
                                    <Phone className="w-3 h-3" />
                                    {crmData.CellNo}
                                  </button>
                                )}
                                {crmData.TelephoneNo && crmData.TelephoneNo !== crmData.CellNo && (
                                  <button
                                    onClick={() => makeCall(crmData.TelephoneNo!, crmData.CustomerName, selectedVehicle.name)}
                                    disabled={!canMakeCall || isInCall}
                                    className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-blue-400 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canMakeCall ? 'Configure phone extension first' : isInCall ? 'Already in call' : `Call ${crmData.TelephoneNo}`}
                                  >
                                    <Phone className="w-3 h-3" />
                                    {crmData.TelephoneNo}
                                  </button>
                                )}
                                {crmData.AlternateContact &&
                                  crmData.AlternateContact !== crmData.CellNo &&
                                  crmData.AlternateContact !== crmData.TelephoneNo && (
                                  <button
                                    onClick={() => makeCall(crmData.AlternateContact!, crmData.CustomerName, selectedVehicle.name)}
                                    disabled={!canMakeCall || isInCall}
                                    className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-purple-300 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canMakeCall ? 'Configure phone extension first' : isInCall ? 'Already in call' : `Call ${crmData.AlternateContact}`}
                                  >
                                    <Phone className="w-3 h-3" />
                                    {crmData.AlternateContact}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-1 gap-2">
                            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-[10px] text-slate-500 uppercase mb-1">Identity</div>
                              <KV label="NIC/CNIC" value={crmData.NIC} mono />
                              <KV label="DOB" value={crmData.DateOfBirth} />
                            </div>
                            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-[10px] text-slate-500 uppercase mb-1">Address</div>
                              <KV label="Address 1" value={crmData.Address1} />
                              <KV label="Address 2" value={crmData.Address2} />
                              <KV label="Email" value={crmData.Email || (crmData as any)['email'] || undefined} />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                          <User className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                          <div className="text-sm text-slate-400 font-medium">No Customer Info (CRM)</div>
                          <div className="text-xs text-slate-500 mt-1">Customer details were not found for this vehicle.</div>
                        </div>
                      )}
                    </div>
                  )}

                  {infoTab === 'security' && (
                    <div className="space-y-3">
                      {crmData ? (
                        <>
                          {crmData.VerificationPassword && crmData.VerificationPassword !== '-' && (
                            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                              <Shield className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] text-amber-400 uppercase font-medium">Verification Password</div>
                                <div className="text-lg text-amber-300 font-bold font-mono tracking-wider">{crmData.VerificationPassword}</div>
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-1 gap-2">
                            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-[10px] text-slate-500 uppercase mb-1">Security</div>
                              <KV label="Emergency Pwd" value={crmData.EmergencyPassword} mono />
                              <KV label="Question" value={crmData.SecurityQuestion} />
                              <KV label="Answer" value={crmData.SecurityAnswer} />
                              <KV label="Secondary User" value={crmData.SecondaryUser} />
                              <KV label="Secondary Tel" value={crmData.SecondaryContact} mono />
                              <KV label="Secondary Tel 2" value={crmData.SecondaryContact2} mono />
                            </div>
                            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-[10px] text-slate-500 uppercase mb-1">Emergency Contact</div>
                              <KV label="Name" value={crmData.EmergencyContactPerson} />
                              <KV label="Number" value={crmData.EmergencyContactNumber} mono />
                              <KV label="Number 2" value={crmData.EmergencyContactNumber2} mono />
                              <KV label="Mother Name" value={crmData.MotherName} />
                            </div>
                          </div>

                          {crmData.SpecialInstructions && (
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-[10px] text-slate-500 uppercase mb-1">Special Instructions</div>
                              <div className="text-[11px] text-white/90 whitespace-pre-wrap">{crmData.SpecialInstructions}</div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                          <Shield className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                          <div className="text-sm text-slate-400 font-medium">No Security Info (CRM)</div>
                          <div className="text-xs text-slate-500 mt-1">Security fields were not found for this vehicle.</div>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* Quick Stats */}
            {gps && (
              <div className="grid grid-cols-3 gap-px bg-white/5">
                <div className="p-2 lg-metric-dense text-center rounded-none">
                  <Gauge className="w-3.5 h-3.5 mx-auto mb-0.5 text-slate-500" />
                  <div className="text-base font-bold text-white">{gps.speed?.toFixed(0) || 0}</div>
                  <div className="text-[10px] text-slate-500 uppercase">km/h</div>
                </div>
                <div className="p-2 lg-metric-dense text-center rounded-none">
                  <Navigation className="w-3.5 h-3.5 mx-auto mb-0.5 text-slate-500" />
                  <div className="text-base font-bold text-white">{gps.angle || 0}°</div>
                  <div className="text-[10px] text-slate-500 uppercase">Heading</div>
                </div>
                <div className="p-2 lg-metric-dense text-center rounded-none">
                  <Satellite className="w-3.5 h-3.5 mx-auto mb-0.5 text-slate-500" />
                  <div className="text-base font-bold text-white">{gps.satellites || 0}</div>
                  <div className="text-[10px] text-slate-500 uppercase">Sats</div>
                </div>
              </div>
            )}

            {/* Vehicle Telemetry - Enhanced Data */}
            {gps && (
              <div className="border-b border-white/5">
                <div className="px-3 py-1.5 bg-gradient-to-r from-cyan-500/10 to-transparent">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-medium text-slate-400 uppercase">Vehicle Telemetry</span>
                  </div>
                </div>
                
                <div className="p-2 grid grid-cols-2 gap-1.5">
                  {/* Ignition Status */}
                  <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                    <Power className={`w-4 h-4 ${gps.Ignition ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <div className="flex-1">
                      <div className="text-[10px] text-slate-500">Ignition</div>
                      <div className={`text-sm font-medium ${gps.Ignition ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {gps.Ignition ? 'ON' : 'OFF'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Engine Cut / Immobilizer Status */}
                  <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                    <ShieldAlert className={`w-4 h-4 ${
                      gps.EngineCut === true ? 'text-red-400' : gps.EngineCut === false ? 'text-emerald-400' : 'text-slate-500'
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">ENGINE CUT</span>
                        {/* CRM: whether immobilizer hardware is physically installed */}
                        {crmData && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                            crmData.Immobilizer === 1 || crmData.Immobilizer === '1' || crmData.Immobilizer === true || crmData.Immobilizer === 'true'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-slate-500/20 text-slate-500'
                          }`} title="Immobilizer hardware installed (from CRM)">
                            {crmData.Immobilizer === 1 || crmData.Immobilizer === '1' || crmData.Immobilizer === true || crmData.Immobilizer === 'true'
                              ? 'INSTALLED'
                              : 'NOT INSTALLED'}
                          </span>
                        )}
                      </div>
                      <div className={`text-sm font-bold ${
                        gps.EngineCut === true ? 'text-red-400' : gps.EngineCut === false ? 'text-emerald-400' : 'text-slate-400'
                      }`}>
                        {gps.EngineCut === true ? 'ACTIVE' : gps.EngineCut === false ? 'INACTIVE' : 'UNKNOWN'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Battery Voltage */}
                  {gps.Battery !== undefined && gps.Battery !== null && (
                    <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                      <BatteryCharging className={`w-4 h-4 ${
                        gps.Battery > 12 ? 'text-emerald-400' : 
                        gps.Battery > 11 ? 'text-amber-400' : 'text-red-400'
                      }`} />
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500">Battery</div>
                        <div className={`text-sm font-medium ${
                          gps.Battery > 12 ? 'text-emerald-400' : 
                          gps.Battery > 11 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {/* Handle both mV and V formats */}
                          {gps.Battery > 100 ? (gps.Battery / 1000).toFixed(2) : gps.Battery.toFixed(2)}V
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* GSM Signal */}
                  {gps.GsmSignal !== undefined && gps.GsmSignal !== null && (
                    <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                      <Signal className={`w-4 h-4 ${
                        gps.GsmSignal > 15 ? 'text-emerald-400' : 
                        gps.GsmSignal > 8 ? 'text-amber-400' : 'text-red-400'
                      }`} />
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500">GSM Signal</div>
                        <div className="flex items-center gap-1">
                          <div className={`text-sm font-medium ${
                            gps.GsmSignal > 15 ? 'text-emerald-400' : 
                            gps.GsmSignal > 8 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {gps.GsmSignal}
                          </div>
                          {/* Signal bars visualization */}
                          <div className="flex items-end gap-0.5 h-3">
                            {[1, 2, 3, 4, 5].map((bar) => {
                              const signal = gps.GsmSignal ?? 0;
                              return (
                                <div
                                  key={bar}
                                  className={`w-1 rounded-sm ${
                                    signal >= bar * 5 ? 
                                      (signal > 15 ? 'bg-emerald-400' : signal > 8 ? 'bg-amber-400' : 'bg-red-400') 
                                      : 'bg-slate-700'
                                  }`}
                                  style={{ height: `${bar * 20}%` }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Fuel Level */}
                  {gps.FuelLevel !== undefined && gps.FuelLevel !== null && gps.FuelLevel > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                      <Fuel className={`w-4 h-4 ${
                        gps.FuelLevel > 30 ? 'text-emerald-400' : 
                        gps.FuelLevel > 15 ? 'text-amber-400' : 'text-red-400'
                      }`} />
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500">Fuel Level</div>
                        <div className="flex items-center gap-2">
                          <div className={`text-sm font-medium ${
                            gps.FuelLevel > 30 ? 'text-emerald-400' : 
                            gps.FuelLevel > 15 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {gps.FuelLevel.toFixed(0)}%
                          </div>
                          {/* Fuel bar */}
                          <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                gps.FuelLevel > 30 ? 'bg-emerald-400' : 
                                gps.FuelLevel > 15 ? 'bg-amber-400' : 'bg-red-400'
                              }`}
                              style={{ width: `${Math.min(gps.FuelLevel, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Altitude */}
                  {gps.altitude !== undefined && gps.altitude > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                      <Navigation className="w-4 h-4 text-sky-400 rotate-90" />
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500">Altitude</div>
                        <div className="text-sm font-medium text-sky-400">
                          {gps.altitude}m
                        </div>
                      </div>
                    </div>
                  )}

                  {/* GPS Time (absolute) */}
                  {(gps.gpsTimeRaw || gps.gpsTime) && (
                    <div className="flex items-center gap-2 p-2 rounded-lg lg-chip-dense">
                      <Clock className="w-4 h-4 text-indigo-300" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-slate-500">GPS Time</div>
                        <div
                          className="text-[12px] font-bold text-indigo-200 font-mono truncate"
                          title={formatDateTime24(gps.gpsTimeRaw || gps.gpsTime)}
                        >
                          {formatDateTime24(gps.gpsTimeRaw || gps.gpsTime)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Harsh Driving Indicators */}
                {(gps.HarshBrake || gps.HarshAccel || gps.HarshCorner) && (
                  <div className="px-3 pb-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {gps.HarshBrake !== undefined && gps.HarshBrake > 0 && (
                        <span className="px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded-full flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Harsh Brake: {gps.HarshBrake}
                        </span>
                      )}
                      {gps.HarshAccel !== undefined && gps.HarshAccel > 0 && (
                        <span className="px-2 py-1 text-[10px] bg-orange-500/20 text-orange-400 rounded-full flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Harsh Accel: {gps.HarshAccel}
                        </span>
                      )}
                      {gps.HarshCorner !== undefined && gps.HarshCorner > 0 && (
                        <span className="px-2 py-1 text-[10px] bg-amber-500/20 text-amber-400 rounded-full flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Harsh Corner: {gps.HarshCorner}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Weather at Vehicle Location */}
            {gps && (
              <div className="p-3 border-b border-white/5 bg-gradient-to-r from-sky-500/5 to-transparent">
                <div className="flex items-center gap-3">
                  {weatherLoading ? (
                    <div className="flex items-center gap-2 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs">Loading weather...</span>
                    </div>
                  ) : weather ? (
                    <>
                      {/* Weather Icon & Temp */}
                      <div className="flex items-center gap-2">
                        <span className="text-2xl" title={weather.description}>{weather.icon}</span>
                        <div>
                          <div className="text-lg font-bold text-white">{weather.temperature}°C</div>
                          <div className="text-[10px] text-slate-500">Feels {weather.feelsLike}°C</div>
                        </div>
                      </div>
                      
                      {/* Divider */}
                      <div className="h-8 w-px bg-white/10" />
                      
                      {/* Weather Details */}
                      <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Humidity</span>
                          <span className="text-sky-400 font-medium">{weather.humidity}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Wind</span>
                          <span className="text-sky-400 font-medium">{weather.windSpeed} km/h</span>
                        </div>
                        <div className="col-span-2 text-slate-400 truncate" title={weather.description}>
                          {weather.description}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-slate-500">Weather unavailable</div>
                  )}
                </div>
              </div>
            )}

            {/* GPS Details */}
            {gps && (
              <div className="p-4 space-y-2 border-b border-white/5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Last Update
                  </span>
                  <span className="text-white text-xs">
                    {(() => {
                      const d = toWallClockDate(gps.gpsTimeRaw || gps.gpsTime);
                      return d ? formatDistanceToNow(d, { addSuffix: true }) : 'N/A';
                    })()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">GPS Status</span>
                  <span className={`text-xs font-medium ${gps.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gps.valid ? '● Valid' : '● Invalid'}
                  </span>
                </div>
              </div>
            )}

            {/* TDD-style raw snapshot (for understanding) */}
            {gps && selectedVehicle && (
              <div className="p-3 border-b border-white/5">
                <div className="text-xs font-medium text-slate-400 uppercase mb-1.5">Telemetry Snapshot</div>
                <div className="space-y-0.5">
                  <KV label="Name" value={selectedVehicle.registrationNumber || selectedVehicle.name} />
                  <KV label="Speed" value={`${(gps.speed ?? 0).toFixed(0)} Km/h`} />
                  <KV label="ACC" value={gps.Ignition === true ? 'ON' : gps.Ignition === false ? 'OFF' : 'Unknown'} />
                  <KV label="GPS Time" value={formatDateTime24(gps.gpsTimeRaw || gps.gpsTime)} mono bold />
                  <KV label="Coordinates" value={`${gps.latitude.toFixed(6)},${gps.longitude.toFixed(6)}`} mono />
                  <KV label="GPS" value={gps.valid ? 'Valid' : 'Invalid'} />
                  <KV label="Satellites" value={gps.satellites} />
                  <KV label="Location" value={locationFull || address || ''} />

                  <div className="mt-2 pt-2 border-t border-white/5" />
                  <KV label="Ignition Status" value={gps.Ignition === true ? 1 : gps.Ignition === false ? 0 : 'Unknown'} mono />
                  <KV label="DOUT 1" value={gps.EngineCut === true ? 1 : gps.EngineCut === false ? 0 : 'Unknown'} mono />
                  <KV label="Battery" value={formatVoltageDetailed(gps.Battery)} mono />
                  <KV label="BB Volt" value={formatVoltageDetailed(gps.BackupBattery)} mono />
                  <KV label="Power Voltages" value={gps.PowerVolt ?? 'None'} mono />
                  <KV label="GSM Signal" value={gps.GsmSignal ?? 'None'} mono />
                </div>
              </div>
            )}

            {/* iTeck App Info Section */}
            {crmData?.CellNo && (
              <div className="border-b border-white/5">
                <div className="px-4 py-2 bg-gradient-to-r from-purple-500/10 to-transparent flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-medium text-slate-400 uppercase">iTeck App Info</span>
                  </div>
                  {appInfo && (
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      appInfo.pushEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {appInfo.pushEnabled ? 'Push ON' : 'Push OFF'}
                    </span>
                  )}
                </div>

                {appInfoLoading ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading app info...</span>
                  </div>
                ) : appInfo ? (
                  <div className="p-4 space-y-3">
                    {/* App Version & Last Login */}
                    <div className="flex items-start gap-2">
                      <Activity className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-slate-500 uppercase">App Version</div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white font-medium">v{appInfo.appVersion}</span>
                          {appInfo.appVersion !== '6.8.1' && (
                            <span className="px-1 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 rounded">
                              Update Available
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Last active: {appInfo.lastLogin ? formatDistanceToNow(new Date(appInfo.lastLogin), { addSuffix: true }) : 'Unknown'}
                        </div>
                      </div>
                    </div>

                    {/* Device Info */}
                    <div className="flex items-start gap-2">
                      <Smartphone className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-slate-500 uppercase">Device</div>
                        <div className="text-sm text-white">
                          {appInfo.device.brand} {appInfo.device.model}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {appInfo.device.platform} {appInfo.device.osVersion}
                        </div>
                      </div>
                    </div>

                    {/* Email */}
                    {appInfo.email && (
                      <div className="flex items-start gap-2">
                        <Mail className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-slate-500 uppercase">App Email</div>
                          <div className="text-sm text-white truncate">{appInfo.email}</div>
                        </div>
                      </div>
                    )}

                    {/* Notification Stats */}
                    <div className="flex items-start gap-2 p-2 bg-white/5 rounded-lg">
                      <Bell className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500 uppercase mb-1">Notifications (30 days)</div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-400">
                            Sent: <span className="text-white font-medium">{appInfo.stats.notificationsSent30d}</span>
                          </span>
                          <span className="text-emerald-400">
                            <CheckCheck className="w-3 h-3 inline mr-0.5" />
                            {appInfo.stats.notificationsReceived30d}
                          </span>
                          {appInfo.stats.notificationsUnread30d > 0 && (
                            <span className="text-amber-400">
                              <XCircle className="w-3 h-3 inline mr-0.5" />
                              {appInfo.stats.notificationsUnread30d} unread
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recent Notifications Toggle */}
                    {appNotifications.length > 0 && (
                      <button
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="w-full flex items-center justify-between p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-purple-400" />
                          <span className="text-xs text-slate-300">Recent Notifications ({appNotifications.length})</span>
                        </div>
                        {showNotifications ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    )}

                    {/* Notification List */}
                    <AnimatePresence>
                      {showNotifications && appNotifications.length > 0 && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">
                            {appNotifications.map((notif) => (
                              <div
                                key={notif.id}
                                className={`p-2 rounded-lg text-xs ${
                                  notif.isRead ? 'bg-white/5' : 'bg-purple-500/10 border border-purple-500/20'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-medium text-white truncate flex-1">
                                    {notif.title.trim()}
                                  </span>
                                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                    {notif.isRead ? (
                                      <CheckCheck className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <span className="w-2 h-2 bg-purple-400 rounded-full" />
                                    )}
                                    <span className="text-[10px] text-slate-500">
                                      {formatDistanceToNow(new Date(notif.sentDate), { addSuffix: true })}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-slate-400 line-clamp-2">{notif.message}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="px-1 py-0.5 text-[9px] bg-white/10 text-slate-400 rounded">
                                    {notif.type}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="p-4 text-center text-slate-500 text-sm">
                    <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <div>No iTeck app found for this customer</div>
                    <div className="text-[10px] mt-1">Customer may not have installed the app</div>
                  </div>
                )}
              </div>
            )}

            {/* Vehicle Alerts Section */}
            <div className="border-b border-white/5">
              <div className="px-3 pt-2 pb-1.5 bg-gradient-to-r from-red-500/10 to-transparent">
                {/* Row 1: Title */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[11px] font-medium text-slate-400 uppercase">Vehicle Alerts</span>
                    {mergedTotal > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500/20 text-red-400 rounded">
                        {mergedTotal}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      refreshAlerts();
                      refreshConsoleAlerts();
                    }}
                    disabled={alertsLoading || consoleAlertsLoading}
                    className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                    title="Refresh alerts"
                  >
                    <RefreshCw className={`w-3 h-3 ${(alertsLoading || consoleAlertsLoading) ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                {/* Row 2: Controls */}
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center bg-white/5 rounded px-0.5 py-0.5 flex-shrink-0">
                    <button
                      onClick={() => setAlertsSource('all')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        alertsSource === 'all' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                      title="All alerts (Eventlog + Console)"
                    >
                      All
                    </button>
                    <button
                      onClick={() => setAlertsSource('eventlog')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        alertsSource === 'eventlog' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                      title="Eventlog alerts"
                    >
                      Eventlog
                    </button>
                    <button
                      onClick={() => setAlertsSource('console')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        alertsSource === 'console' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                      title="Console alerts"
                    >
                      Console
                    </button>
                  </div>
                  <select
                    value={alertsRange}
                    onChange={(e) => {
                      setAlertsRange(e.target.value as any);
                      setShowAllAlerts(false);
                    }}
                    className="flex-1 text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80 focus:outline-none focus:border-primary-500/60"
                    title="Quick range"
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                  </select>
                </div>
              </div>
              
              <div className="max-h-48 overflow-y-auto">
                {(alertsLoading || consoleAlertsLoading) && mergedAlerts.length === 0 ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Loading alerts...</span>
                  </div>
                ) : mergedAlerts.length === 0 ? (
                  <div className="p-4 text-center">
                    <CheckCircle className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">No alerts in the selected range</p>
                    <p className="text-[10px] text-slate-600 mt-1">Last {alertsDays === 1 ? '24 hours' : `${alertsDays} days`}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {mergedAlerts.map((alert) => {
                      const severityConfig = ALERT_SEVERITY_CONFIG[alert.severity];
                      const robocall = robocallMap[alert.id];
                      const rcLabel = robocall ? getRobocallLabel(robocall.status) : null;
                      const RcIcon = rcLabel?.icon;
                      return (
                        <div
                          key={alert.id}
                          className={`px-3 py-2 hover:bg-white/5 transition-colors cursor-pointer ${severityConfig.bgColor} bg-opacity-30`}
                          title={alert.description}
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-lg flex-shrink-0">{getAlertIcon(alert.alarmType)}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1.5 flex-nowrap">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className={`text-[11px] font-medium ${severityConfig.color} truncate`}>
                                    {alert.alarmType}
                                  </span>
                                  {alert.source && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10 flex-shrink-0">
                                      {alert.source === 'console' ? 'Con' : 'Evt'}
                                    </span>
                                  )}
                                </div>
                                <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${severityConfig.bgColor} ${severityConfig.color}`}>
                                  {severityConfig.label}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-slate-500">
                                  {formatDateTime(alert.occurredAt)}
                                </span>
                                {alert.speed > 0 && (
                                  <span className="text-[10px] text-slate-500">
                                    • {alert.speed} km/h
                                  </span>
                                )}
                              </div>
                              {rcLabel && RcIcon && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <RcIcon className={`w-3 h-3 ${rcLabel.color}`} />
                                  <span className={`text-[10px] font-medium ${rcLabel.color}`}>{rcLabel.text}</span>
                                  {robocall?.callPlacedAt && (
                                    <span className="text-[10px] text-slate-500">
                                      • {formatDateTime(robocall.callPlacedAt)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {mergedTotal > 20 && !showAllAlerts && (
                <button
                  onClick={() => setShowAllAlerts(true)}
                  className="w-full px-4 py-2 text-xs text-primary-400 hover:bg-white/5 transition-colors border-t border-white/5"
                >
                  Show all {mergedTotal} alerts
                </button>
              )}
              {showAllAlerts && mergedTotal > 20 && (
                <button
                  onClick={() => setShowAllAlerts(false)}
                  className="w-full px-4 py-2 text-xs text-slate-400 hover:bg-white/5 transition-colors border-t border-white/5"
                >
                  Show less
                </button>
              )}
            </div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Vehicle History Slide-out Panel - Slides LEFT from vehicle panel */}
      <AnimatePresence>
        {showVehicleLogs && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'clamp(360px, 38vw, 520px)', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute top-0 right-full h-full lg-sidebar-dense border-r border-white/6 shadow-2xl flex flex-col overflow-hidden rounded-l-2xl"
            style={{ marginRight: -1 }} // Overlap border slightly
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/6 lg-header shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <div>
                  <h2 className="text-xs font-medium text-white">Vehicle History</h2>
                  <p className="text-[10px] text-slate-400">{selectedVehicle.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setVehicleHistoryTab('technical')}
                    className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                      vehicleHistoryTab === 'technical'
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    title="ERP history / logs"
                  >
                    Technical
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleHistoryTab('closure')}
                    className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                      vehicleHistoryTab === 'closure'
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    title="Tracking EventLog closure + Warning Console"
                  >
                    Closure
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleHistoryTab('calls')}
                    className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                      vehicleHistoryTab === 'calls'
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    title="Call history (CDR) for this customer's numbers"
                  >
                    Calls
                  </button>
                </div>
              <button
                onClick={() => setShowVehicleLogs(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
              </div>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-hidden min-w-0">
              {vehicleHistoryTab === 'technical' ? (
                vehicleDbId ? (
                  <VehicleLogsPanel
                    vehicleId={vehicleDbId}
                    vehicleReg={selectedVehicle.name}
                  />
                ) : crmLoading ? (
                  <div className="h-full flex items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 p-4">
                    <FileText className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-xs text-center">Vehicle ID not found</p>
                  </div>
                )
              ) : vehicleHistoryTab === 'closure' ? (
                <VehicleClosurePanel objectId={selectedVehicle.objectId} vehicleName={selectedVehicle.name} />
              ) : (
                <VehicleCallHistoryPanel crmData={crmData} vehicleName={selectedVehicle.name} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      </div> {/* End scrollable content */}

      {/* Actions - Always visible - 5-column Grid */}
      <div className="p-3 grid grid-cols-5 gap-1.5 lg-footer-dense border-t border-white/5 shrink-0 rounded-b-2xl" style={{ height: 'auto' }}>
        <button
          onClick={() => togglePinVehicle(selectedVehicle.objectId, selectedVehicle)}
          className={`flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg text-[10px] font-medium transition-all ${
            isPinned
              ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
              : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/10'
          }`}
          title={isPinned ? 'Unpin from map' : 'Pin to map'}
        >
          {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          onClick={() => focusOnVehicle(selectedVehicle)}
          className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white text-[10px] font-medium transition-all border border-white/10"
          title="Center on map"
        >
          <Crosshair className="w-4 h-4" />
          Center
        </button>
        <button 
          onClick={() => openTrackDialog(selectedVehicle)}
          className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-[10px] font-medium transition-all border border-purple-500/30"
          title="View track history"
        >
          <Route className="w-4 h-4" />
          Track
        </button>
        <button 
          onClick={() => setShowVehicleLogs(true)}
          disabled={!vehicleDbId && !crmLoading}
          className={`flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg text-[10px] font-medium transition-all ${
            showVehicleLogs
              ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/50'
              : 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          title="View vehicle history logs"
        >
          <FileText className="w-4 h-4" />
          History
        </button>
        <button 
          onClick={() => setShowCommandCenter(true)}
          className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-[10px] font-medium transition-all border border-orange-500/30"
          title="Send commands to device"
        >
          <Radio className="w-4 h-4" />
          Cmd
        </button>
      </div>
      
      {/* Command Center Modal */}
      <CommandCenter
        isOpen={showCommandCenter}
        onClose={() => setShowCommandCenter(false)}
        vehicleId={selectedVehicle?.objectId ? parseInt(selectedVehicle.objectId) : null}
        vehicleName={selectedVehicle?.name}
      />
    </motion.div>
  );
}
