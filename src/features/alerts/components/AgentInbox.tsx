/**
 * Agent Inbox — Situational Awareness Panel
 * Shows assigned alerts with autocall status, acknowledge/resolve/escalate actions.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  CheckCircle,
  AlertTriangle,
  Clock,
  ArrowUpCircle,
  Coffee,
  ChevronDown,
  ChevronUp,
  Car,
  Battery,
  MapPin,
  Moon,
  Shield,
  Loader2,
  RefreshCw,
  CheckCheck,
  Filter,
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneCall,
  PhoneMissed,
  Search,
  X,
  Mail,
  MessageCircle,
  Send as SendIcon,
} from 'lucide-react';
import { useAlertDistributionStore, AlertAssignment } from '@store/alertDistributionStore';
import { useVehicleStore } from '@store/vehicleStore';
import { useAuthStore } from '@store/authStore';
import { useRobocallStatus, RobocallStatus } from '@hooks/useRobocallStatus';
import { api, isElectron } from '@services/api';

// Alert type icons
const ALERT_TYPE_CONFIG: Record<string, { icon: any; color: string; bgColor: string; label: string; accent: string }> = {
  'panic':               { icon: Shield,  color: 'text-red-400',    bgColor: 'bg-red-500/20',    label: 'PANIC',      accent: '#f87171' },
  'sos':                 { icon: Shield,  color: 'text-red-400',    bgColor: 'bg-red-500/20',    label: 'SOS',        accent: '#f87171' },
  'battery':             { icon: Battery, color: 'text-amber-400',  bgColor: 'bg-amber-500/20',  label: 'Battery',    accent: '#fbbf24' },
  'battery_disconnect':  { icon: Battery, color: 'text-amber-400',  bgColor: 'bg-amber-500/20',  label: 'Battery',    accent: '#fbbf24' },
  'geofence':            { icon: MapPin,  color: 'text-purple-400', bgColor: 'bg-purple-500/20', label: 'Geofence',   accent: '#c084fc' },
  'geofence_exit':       { icon: MapPin,  color: 'text-purple-400', bgColor: 'bg-purple-500/20', label: 'Geofence',   accent: '#c084fc' },
  'late_night':          { icon: Moon,    color: 'text-blue-400',   bgColor: 'bg-blue-500/20',   label: 'Late Night', accent: '#60a5fa' },
  'late_night_movement': { icon: Moon,    color: 'text-blue-400',   bgColor: 'bg-blue-500/20',   label: 'Late Night', accent: '#60a5fa' },
};

const getAlertConfig = (alertType: string) => {
  const type = alertType?.toLowerCase().replace(/\s+/g, '_') || 'default';
  return ALERT_TYPE_CONFIG[type] || {
    icon: Bell,
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/20',
    label: alertType || 'Alert',
    accent: '#9ca3af',
  };
};

// Calculate time remaining until timeout (12 minutes)
const getTimeRemaining = (assignedAt: string): { minutes: number; seconds: number; isUrgent: boolean; isExpired: boolean } => {
  const assigned = new Date(assignedAt);
  const now = new Date();
  const elapsed = (now.getTime() - assigned.getTime()) / 1000;
  const timeoutSeconds = 12 * 60; // 12 minutes
  const remaining = timeoutSeconds - elapsed;
  
  if (remaining <= 0) {
    return { minutes: 0, seconds: 0, isUrgent: true, isExpired: true };
  }
  
  return {
    minutes: Math.floor(remaining / 60),
    seconds: Math.floor(remaining % 60),
    isUrgent: remaining < 180, // Less than 3 minutes
    isExpired: false,
  };
};

// Autocall status badge
const CALL_STATUS_CONFIG: Record<string, { icon: any; color: string; bgColor: string; label: string }> = {
  answered:    { icon: PhoneCall,     color: 'text-emerald-400', bgColor: 'bg-emerald-500/15', label: 'Answered' },
  ringing:     { icon: PhoneIncoming, color: 'text-amber-400',   bgColor: 'bg-amber-500/15',   label: 'Ringing' },
  dialing:     { icon: Phone,         color: 'text-blue-400',    bgColor: 'bg-blue-500/15',    label: 'Dialing' },
  no_answer:   { icon: PhoneMissed,   color: 'text-red-400',     bgColor: 'bg-red-500/15',     label: 'No Answer' },
  rejected:    { icon: PhoneOff,      color: 'text-red-400',     bgColor: 'bg-red-500/15',     label: 'Rejected' },
  failed:      { icon: PhoneOff,      color: 'text-red-400',     bgColor: 'bg-red-500/15',     label: 'Failed' },
  unavailable: { icon: PhoneOff,      color: 'text-slate-400',    bgColor: 'bg-slate-500/15',    label: 'Unavailable' },
  unknown:     { icon: Phone,         color: 'text-slate-500',    bgColor: 'bg-slate-500/10',    label: 'Unknown' },
};

const AutoCallBadge: React.FC<{
  callStatus?: RobocallStatus;
  onRefresh?: () => void;
  refreshing?: boolean;
}> = ({ callStatus, onRefresh, refreshing }) => {
  // Spinner inherits the badge's current text colour so the colour coding is preserved.
  const Spinner = () => (
    <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
  );
  const handleClick = onRefresh
    ? (e: React.MouseEvent) => { e.stopPropagation(); if (!refreshing) onRefresh(); }
    : undefined;

  if (!callStatus) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={refreshing}
        title="Click to check robocall status"
        className="lg-status-pill flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/3 text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors"
      >
        {refreshing ? <Spinner /> : <Phone className="w-3 h-3" />}
        <span className="text-[11px]">{refreshing ? 'Checking…' : 'No call'}</span>
      </button>
    );
  }

  const cfg = CALL_STATUS_CONFIG[callStatus.status] || CALL_STATUS_CONFIG.unknown;
  const Icon = cfg.icon;

  const safeDateTime = (raw?: string) => {
    if (!raw) return '';
    // Return the raw DB string without any timezone conversion
    return String(raw).replace('T', ' ').substring(0, 19);
  };

  const statusTime =
    callStatus.status === 'answered'
      ? safeDateTime(callStatus.callReceivedAt)
      : callStatus.status === 'failed' || callStatus.status === 'no_answer' || callStatus.status === 'rejected'
        ? safeDateTime(callStatus.callEndedAt || callStatus.callPlacedAt)
        : safeDateTime(callStatus.callPlacedAt);

  const timeTitle = statusTime ? ` • ${cfg.label} at ${statusTime}` : '';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={refreshing}
      className={`lg-status-pill flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${cfg.bgColor} ${cfg.color} hover:brightness-125 transition-[filter]`}
      title={
        (callStatus.phoneNumber
          ? `${cfg.label} — ${callStatus.phoneNumber}${callStatus.duration ? ` (${callStatus.duration}s)` : ''}${callStatus.userInput ? ` Input: ${callStatus.userInput}` : ''}${timeTitle}`
          : cfg.label) + ' • click to refresh'
      }
    >
      {refreshing ? <Spinner /> : <Icon className="w-3 h-3" />}
      <span className="text-[11px] font-medium">{cfg.label}</span>
      {statusTime && (
        <span className="text-[10px] opacity-60">{statusTime}</span>
      )}
      {callStatus.duration > 0 && (
        <span className="text-[10px] opacity-60">{callStatus.duration}s</span>
      )}
      {callStatus.userInput && (
        <span className="text-[10px] px-1.5 rounded-md bg-white/8 border border-white/5">Key:{callStatus.userInput}</span>
      )}
    </button>
  );
};

const safeDateTime = (raw?: string) => {
  if (!raw) return '';
  return String(raw).replace('T', ' ').substring(0, 19);
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Format GPS time as `YYYY-MM-DD HH:mm:ss` without surprising timezone coercion.
 * - If backend sends a plain SQL timestamp-like string, we keep it as-is (trimmed).
 * - Otherwise we fall back to Date parsing and format using local time.
 */
const formatGpsDateTime = (raw?: any): string => {
  if (!raw) return '';

  if (typeof raw === 'string') {
    const s = raw.trim();
    // Common DB formats:
    // - "2026-03-18 12:19:45"
    // - "2026-03-18T12:19:45"
    // - "2026-03-18T12:19:45.123Z"
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
  }

  try {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return '';
  }
};

const formatGpsDateTimeHuman = (raw?: any): string => {
  const s = formatGpsDateTime(raw);
  if (!s) return '';
  // s is expected as "YYYY-MM-DD HH:mm:ss"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  const [, yy, mo, dd, hh, mm] = m;
  const d = new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm), 0);
  if (Number.isNaN(d.getTime())) return s;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
  const h24 = d.getHours();
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  // Keep it compact to avoid truncating alert labels in the inbox list.
  return `${pad2(d.getDate())} ${months[d.getMonth()]} ${pad2(h12)}:${pad2(d.getMinutes())} ${ampm}`;
};

const parseAlertData = (raw: any): any => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
};

const getAlertSnapshot = (alert: AlertAssignment) => {
  const d = parseAlertData(alert.alert_data) || {};
  const lat = Number(d.latitude ?? d.Latitude ?? d.y ?? d.Y);
  const lng = Number(d.longitude ?? d.Longitude ?? d.x ?? d.X);
  const speed = Number(d.speed ?? d.Speed ?? 0);
  const satellites = Number(d.satellites ?? d.Satellites ?? d.satelites ?? d.Satelites ?? 0);
  const gpsTimeRaw = String(d.occurredAt ?? d.gpsTime ?? d.GpsTime ?? d.gpstime ?? '').trim();
  const vehicleId = String(d.vehicleId ?? d.vehicleID ?? d.VehicleId ?? d.objectId ?? d.ObjectId ?? '').trim();
  return {
    raw: d,
    vehicleId,
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
    speed: Number.isFinite(speed) ? speed : 0,
    satellites: Number.isFinite(satellites) ? satellites : 0,
    gpsTimeRaw,
  };
};

const RESOLUTION_OPTIONS = [
  { value: 'customer_contacted', label: 'Customer Contacted' },
  { value: 'false_alarm', label: 'False Alarm' },
  { value: 'field_team_dispatched', label: 'Field Team Dispatched' },
  { value: 'monitoring_completed', label: 'Monitoring Completed' },
  { value: 'vehicle_recovered', label: 'Vehicle Recovered' },
  { value: 'no_action_required', label: 'No Action Required' },
  { value: 'other', label: 'Other' },
] as const;

interface AlertCardProps {
  alert: AlertAssignment;
  isAcknowledged: boolean;
  onAcknowledge: () => void;
  onResolve: (resolutionType: string, notes?: string) => void;
  onEscalate: (reason?: string) => void;
  loading: boolean;
  callStatus?: RobocallStatus;
  onRefreshCallStatus?: () => void;
  callStatusRefreshing?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}

const AlertCard: React.FC<AlertCardProps> = ({
  alert,
  isAcknowledged,
  onAcknowledge,
  onResolve,
  onEscalate,
  loading,
  callStatus,
  onRefreshCallStatus,
  callStatusRefreshing,
  expanded,
  onToggleExpand,
}) => {
  const [showResolve, setShowResolve] = useState(false);
  const [resolutionType, setResolutionType] = useState('');
  const [notes, setNotes] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [showEscalate, setShowEscalate] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(getTimeRemaining(alert.assigned_at));
  const [locating, setLocating] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Vehicle context (special instructions + recent CRM logs)
  const [vehicleContext, setVehicleContext] = useState<{
    specialInstructions: string | null;
    recentLogs: any[];
    vehId: number | null;
    custId: number | null;
  } | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [submittingLog, setSubmittingLog] = useState(false);
  const showOnMapExclusiveFocusOnly = useVehicleStore(s => s.showOnMapExclusiveFocusOnly);
  const vehicleMap = useVehicleStore(s => s.vehicles);
  const updateVehicle = useVehicleStore(s => s.updateVehicle);
  const setAlertLocate = useVehicleStore(s => s.setAlertLocate);
  const currentUser = useAuthStore(s => s.user);

  const config = getAlertConfig(alert.alert_type);
  const Icon = config.icon;
  const snap = getAlertSnapshot(alert);
  const gpsTimeShort = (() => {
    const full = formatGpsDateTime(snap.gpsTimeRaw);
    if (!full) return '';
    const parts = full.split(' ');
    return parts[1] || full;
  })();
  const gpsTimeLabel = formatGpsDateTimeHuman(snap.gpsTimeRaw);

  const fetchComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const res = await fetch(`/api/distribution/alert/${alert.alert_id}/comments`, {
        headers: { 'x-user-id': currentUser?.id || '' },
      });
      const json = await res.json();
      if (json.success) setComments(json.data || []);
    } catch { /* non-fatal */ }
    finally { setCommentsLoading(false); }
  }, [alert.alert_id, currentUser?.id]);

  const handlePostComment = useCallback(async () => {
    if (!newComment.trim() || !currentUser) return;
    setPostingComment(true);
    try {
      await fetch(`/api/distribution/alert/${alert.alert_id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({
          userId: currentUser.id,
          username: currentUser.name || currentUser.username,
          message: newComment.trim(),
        }),
      });
      setNewComment('');
      fetchComments();
    } catch { /* non-fatal */ }
    finally { setPostingComment(false); }
  }, [alert.alert_id, currentUser, newComment, fetchComments]);

  useEffect(() => {
    if (expanded) fetchComments();
  }, [expanded, fetchComments]);

  // Fetch vehicle context when expanded
  useEffect(() => {
    if (!expanded || vehicleContext) return;
    const objectId = getAlertSnapshot(alert).vehicleId;
    if (!objectId) return;
    setContextLoading(true);
    api.distribution.getVehicleContext(alert.alert_id, parseInt(objectId))
      .then((res: any) => {
        if (res.success && res.data) setVehicleContext(res.data as typeof vehicleContext);
      })
      .catch(() => {})
      .finally(() => setContextLoading(false));
  }, [expanded, alert.alert_id]);

  const handleResolveWithLog = useCallback(async () => {
    if (!resolutionType) return;
    if (resolutionType === 'other' && !notes.trim()) return;

    // Best-effort: create CRM log from typed notes (no separate "Submit Log" step).
    setSubmittingLog(true);
    try {
      const snap = getAlertSnapshot(alert);
      const objectId = parseInt(snap.vehicleId) || 0;
      const crmComments = notes.trim() || `Resolved: ${resolutionType}`;
      if (objectId && crmComments) {
        await api.distribution.submitCrmLog(alert.alert_id, {
          objectId,
          comments: crmComments,
          latitude: snap.lat || undefined,
          longitude: snap.lng || undefined,
        });
        try {
          const updated = await api.distribution.getVehicleContext(alert.alert_id, objectId);
          if (updated.success && updated.data) setVehicleContext(updated.data as typeof vehicleContext);
        } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
    finally { setSubmittingLog(false); }

    onResolve(resolutionType, notes);
    setShowResolve(false);
    setResolutionType('');
    setNotes('');
  }, [alert, notes, onResolve, resolutionType]);

  const selectVehicle = useVehicleStore(s => s.selectVehicle);

  const handleLocate = useCallback(async () => {
    const data = snap.raw;
    const vehicleId = snap.vehicleId;

    const lat = snap.lat;
    const lng = snap.lng;
    if (lat && lng) {
      const id = vehicleId || alert.alert_id;
      showOnMapExclusiveFocusOnly({
        objectId: id,
        vehicleId: id,
        name: alert.vehicle_reg || `Vehicle ${id}`,
        registrationNumber: alert.vehicle_reg,
        companyId: '0',
        companyName: '',
        deviceId: id,
        status: 'moving',
        gpsData: {
          latitude: lat,
          longitude: lng,
          angle: 0,
          speed: snap.speed,
          altitude: 0,
          satellites: snap.satellites || 0,
          gpsTime: new Date(snap.gpsTimeRaw || data?.occurredAt || alert.assigned_at),
          serverTime: new Date(alert.assigned_at),
          valid: true,
        },
        meta: {
          source: 'alert_inbox',
          alertSnapshot: {
            gpsTimeRaw: snap.gpsTimeRaw || undefined,
            latitude: lat,
            longitude: lng,
            speed: snap.speed,
            satellites: snap.satellites || undefined,
          },
        },
      });

      setAlertLocate({
        objectId: vehicleId || alert.alert_id,
        lat,
        lng,
        speed: snap.speed,
        alertType: alert.alert_type,
        vehicleReg: alert.vehicle_reg || '',
        gpsTime: snap.gpsTimeRaw || data?.occurredAt || alert.assigned_at,
        assignedAt: alert.assigned_at,
      });

      if (vehicleId) {
        try {
          const result = isElectron()
            ? await (window as any).electron.vehicle.getDetails(parseInt(vehicleId))
            : await api.vehicle.getDetails(parseInt(vehicleId));
          if (result?.success && result?.data) {
            const d = result.data;
            updateVehicle(id, {
              gpsData: {
                latitude: lat,
                longitude: lng,
                angle: 0,
                speed: snap.speed,
                altitude: 0,
                satellites: snap.satellites || 0,
                gpsTime: new Date(snap.gpsTimeRaw || data?.occurredAt || alert.assigned_at),
                serverTime: new Date(alert.assigned_at),
                valid: true,
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
        } catch {
          // Non-fatal
        }
      }
      return;
    }

    if (!vehicleId) return;
    setLocating(true);
    try {
      const result = isElectron()
        ? await (window as any).electron.vehicle.getDetails(parseInt(vehicleId))
        : await api.vehicle.getDetails(parseInt(vehicleId));

      if (result.success && result.data) {
        const d = result.data;
      showOnMapExclusiveFocusOnly({
          objectId: d.objectId.toString(),
          vehicleId: d.id || d.objectId.toString(),
          name: d.plateNumber || alert.vehicle_reg || `Vehicle ${vehicleId}`,
          registrationNumber: d.plateNumber || alert.vehicle_reg,
          companyId: '',
          companyName: '',
          deviceId: d.imei || '',
          status: d.status || 'idle',
          gpsData: {
            latitude: d.latitude,
            longitude: d.longitude,
            angle: d.angle || 0,
            speed: d.speed || 0,
            altitude: d.altitude || 0,
            satellites: d.satellites || 0,
            gpsTime: d.gpsTime ? new Date(d.gpsTime) : new Date(),
            serverTime: d.serverTime ? new Date(d.serverTime) : new Date(),
            valid: d.gpsValid ?? true,
          },
        });
      }
    } catch (err) {
      console.error('Locate vehicle failed:', err);
    } finally {
      setLocating(false);
    }
  }, [alert, vehicleMap, showOnMapExclusiveFocusOnly]);

  const handleOpenInformation = useCallback(() => {
    const vehicleId = snap.vehicleId;
    if (!vehicleId) return;

    const id = String(vehicleId);
    const lat = snap.lat;
    const lng = snap.lng;
    const gpsTime = snap.gpsTimeRaw || (snap.raw as any)?.occurredAt || alert.assigned_at;

    selectVehicle({
      objectId: id,
      vehicleId: id,
      name: alert.vehicle_reg || `Vehicle ${id}`,
      registrationNumber: alert.vehicle_reg,
      companyId: '0',
      companyName: '',
      deviceId: id,
      status: 'moving',
      ...(lat && lng ? {
        gpsData: {
          latitude: lat,
          longitude: lng,
          angle: 0,
          speed: snap.speed,
          altitude: 0,
          satellites: snap.satellites || 0,
          gpsTime: new Date(gpsTime),
          serverTime: new Date(alert.assigned_at),
          valid: true,
        },
      } : {}),
      meta: {
        source: 'alert_inbox',
        alertSnapshot: {
          gpsTimeRaw: snap.gpsTimeRaw || undefined,
          latitude: lat || undefined,
          longitude: lng || undefined,
          speed: snap.speed || undefined,
          satellites: snap.satellites || undefined,
        },
      },
    } as any);
  }, [alert.assigned_at, alert.vehicle_reg, snap, selectVehicle]);

  useEffect(() => {
    if (isAcknowledged) return;
    const interval = setInterval(() => {
      setTimeRemaining(getTimeRemaining(alert.assigned_at));
    }, 1000);
    return () => clearInterval(interval);
  }, [alert.assigned_at, isAcknowledged]);

  const alertDataParsed = (() => {
    const d = typeof alert.alert_data === 'string'
      ? (() => { try { return JSON.parse(alert.alert_data); } catch { return {}; } })()
      : (alert.alert_data || {});
    return d;
  })();
  const customerPhone = alertDataParsed.customerPhone || null;
  const customerAddress = alertDataParsed.customerAddress || null;
  const customerEmail = alertDataParsed.customerEmail || null;

  const callCfg = callStatus
    ? (CALL_STATUS_CONFIG[callStatus.status] || CALL_STATUS_CONFIG.unknown)
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.15 }}
      className={`rounded-lg overflow-hidden ${
        !isAcknowledged && timeRemaining.isUrgent ? 'lg-alert-urgent' : ''
      }`}
      style={{ borderLeft: `3px solid ${config.accent}` }}
    >
      {/* ===== COMPACT ROW ===== */}
      <div
        onClick={onToggleExpand}
        className={`flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none transition-colors ${
          expanded ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
        }`}
      >
        <div className={`w-5 h-5 rounded flex-shrink-0 ${config.bgColor} flex items-center justify-center`}>
          <Icon className={`w-3 h-3 ${config.color}`} />
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleOpenInformation(); }}
          className="text-[11px] font-bold text-white truncate min-w-[80px] max-w-[110px] text-left hover:underline"
          title="Open Information"
        >
          {alert.vehicle_reg}
        </button>

        <span
          className="text-[10px] text-slate-200 truncate flex-1 min-w-0"
          title={alert.alert_message?.split('(')[0]?.trim() || config.label}
        >
          {alert.alert_message?.split('(')[0]?.trim() || config.label}
        </span>

        {/* GPS snapshot datetime (from alert payload) */}
        {!!(gpsTimeLabel || gpsTimeShort) && (
          <span
            className="text-[10px] text-slate-500 flex-shrink-0 tabular-nums font-mono"
            title={gpsTimeLabel || gpsTimeShort}
          >
            {gpsTimeLabel || gpsTimeShort}
          </span>
        )}

        {/* Timer / Status badge */}
        {!isAcknowledged ? (
          <div
            title={
              timeRemaining.isExpired
                ? 'TIMEOUT'
                : `${timeRemaining.minutes}:${timeRemaining.seconds.toString().padStart(2, '0')}`
            }
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
            timeRemaining.isExpired
              ? 'bg-red-500/20 text-red-300'
              : timeRemaining.isUrgent
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-white/5 text-slate-400'
          }`}>
            <Clock className="w-2.5 h-2.5" />
            {timeRemaining.isExpired && <span className="font-mono">TIMEOUT</span>}
          </div>
        ) : (
          <span className="text-[10px] text-emerald-400/70 flex-shrink-0">ACK</span>
        )}

        {/* Locate snapshot (button) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleLocate(); }}
          disabled={locating}
          className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0
                   bg-primary-500/10 text-primary-400 hover:bg-primary-500/20
                   disabled:opacity-40 transition-colors"
          title="Alert snapshot (Locate)"
        >
          {locating ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
        </button>

        {/* Autocall micro-badge — color-coded robocall status; click to refresh this
            alert on-demand (no 30s wait). Always shown so "No call" is clickable too. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (!callStatusRefreshing) onRefreshCallStatus?.(); }}
          disabled={callStatusRefreshing}
          title={`${callCfg ? callCfg.label : 'No call'} • click to refresh`}
          className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
            callCfg ? callCfg.bgColor : 'bg-white/5 hover:bg-white/10'
          }`}
        >
          {callStatusRefreshing ? (
            <span className={`w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin ${callCfg ? callCfg.color : 'text-slate-400'}`} />
          ) : callCfg ? (
            <callCfg.icon className={`w-2.5 h-2.5 ${callCfg.color}`} />
          ) : (
            <Phone className="w-2.5 h-2.5 text-slate-500" />
          )}
        </button>

        {/* Inline Ack button (unacknowledged only) */}
        {!isAcknowledged && (
          <button
            onClick={(e) => { e.stopPropagation(); onAcknowledge(); }}
            disabled={loading}
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0
                     bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30
                     disabled:opacity-40 transition-colors"
            title="Acknowledge"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
          </button>
        )}

        <ChevronDown className={`w-3 h-3 text-slate-600 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* ===== EXPANDED DETAIL ===== */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2.5 bg-white/[0.03] border-t border-white/5 space-y-2">
              {/* Customer info line */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span className="text-slate-300 font-medium">{alert.customer_name || 'Unknown Customer'}</span>
                {customerPhone && (
                  <span className="flex items-center gap-1 text-slate-500">
                    <Phone className="w-2.5 h-2.5" />{customerPhone}
                  </span>
                )}
                {customerAddress && (
                  <span className="flex items-center gap-1 text-slate-500 truncate max-w-[200px]">
                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />{customerAddress}
                  </span>
                )}
                {customerEmail && (
                  <span className="flex items-center gap-1 text-slate-500">
                    <Mail className="w-2.5 h-2.5" />{customerEmail}
                  </span>
                )}
              </div>

              {/* Meta line: GPS time, reassignment, autocall */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <Car className="w-2.5 h-2.5" />
                  GPS {formatGpsDateTime(snap.gpsTimeRaw) || safeDateTime(alert.assigned_at)}
                </span>
                {alert.assignment_count > 1 && (
                  <span className="text-amber-400/80">Reassigned {alert.assignment_count - 1}x</span>
                )}
                <AutoCallBadge callStatus={callStatus} onRefresh={onRefreshCallStatus} refreshing={callStatusRefreshing} />
              </div>

              {/* Special Instructions */}
              {contextLoading && (
                <div className="flex items-center gap-2 py-1 text-slate-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-[11px]">Loading vehicle context...</span>
                </div>
              )}
              {vehicleContext?.specialInstructions && (
                <div className="px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Special Instructions</span>
                  </div>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed whitespace-pre-line">
                    {vehicleContext.specialInstructions}
                  </p>
                </div>
              )}

              {/* Recent CRM Logs */}
              {vehicleContext && vehicleContext.recentLogs.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">
                    Recent Logs ({vehicleContext.recentLogs.length})
                  </span>
                  <div className="space-y-0.5 max-h-28 overflow-y-auto">
                    {vehicleContext.recentLogs.map((log: any) => (
                      <div key={log.id} className="flex items-start gap-2 px-2 py-1 rounded bg-white/[0.03] text-[11px]">
                        <span className="text-slate-600 flex-shrink-0 tabular-nums whitespace-nowrap">
                          {safeDateTime(log.createdAt).substring(5, 16)}
                        </span>
                        {log.spokeTo && <span className="text-blue-400 flex-shrink-0 truncate max-w-[80px]">{log.spokeTo}</span>}
                        <span className="text-slate-400 truncate flex-1">{log.comments}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 pt-1">
                {!isAcknowledged ? (
                  <button
                    onClick={onAcknowledge}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                             bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Acknowledge
                  </button>
                ) : (
                  <>
                    {!showResolve && !showEscalate && (
                      <>
                        <button
                          onClick={() => setShowResolve(true)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                   bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50
                                   `}
                        >
                          <CheckCircle className="w-3 h-3" />
                          Resolve
                        </button>
                        <button
                          onClick={() => setShowEscalate(true)}
                          disabled={loading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                   bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          <ArrowUpCircle className="w-3 h-3" />
                          Escalate
                        </button>
                      </>
                    )}
                  </>
                )}

                <button
                  onClick={(e) => { e.stopPropagation(); handleLocate(); }}
                  disabled={locating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                           text-primary-400 bg-primary-500/10 hover:bg-primary-500/15 disabled:opacity-50"
                >
                  {locating ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                  Locate
                </button>

              </div>

              {/* Resolve form */}
              {showResolve && (
                <div className="space-y-2 pt-1">
                  <select
                    value={resolutionType}
                    onChange={(e) => setResolutionType(e.target.value)}
                    className="w-full px-2.5 py-1.5 liquid-input rounded-lg text-xs text-white appearance-none cursor-pointer"
                  >
                    <option value="" disabled className="bg-slate-800">Select resolution…</option>
                    {RESOLUTION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value} className="bg-slate-800">{opt.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={resolutionType === 'other' ? 'Notes (required)…' : 'Notes (optional)…'}
                    className="w-full px-2.5 py-1.5 liquid-input rounded-lg text-xs text-white placeholder-white/20 resize-none"
                    rows={2}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleResolveWithLog}
                      disabled={loading || submittingLog || !resolutionType || (resolutionType === 'other' && !notes.trim())}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      {loading || submittingLog ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                      Resolve
                    </button>
                    <button
                      onClick={() => { setShowResolve(false); setResolutionType(''); setNotes(''); }}
                      className="px-3 py-1.5 rounded-lg text-xs text-slate-400 bg-white/5 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Escalate form */}
              {showEscalate && (
                <div className="space-y-2 pt-1">
                  <input
                    value={escalateReason}
                    onChange={(e) => setEscalateReason(e.target.value)}
                    placeholder="Reason for escalation..."
                    className="w-full px-2.5 py-1.5 liquid-input rounded-lg text-xs text-white placeholder-white/20"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => { onEscalate(escalateReason); setShowEscalate(false); }}
                      disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                      Escalate
                    </button>
                    <button
                      onClick={() => setShowEscalate(false)}
                      className="px-3 py-1.5 rounded-lg text-xs text-slate-400 bg-white/5 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Notes thread (always visible; no "Hide Notes" toggle) */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <MessageCircle className="w-3 h-3" />
                  Notes
                  {comments.length > 0 && (
                    <span className="px-1 py-0.5 text-[9px] font-bold bg-blue-500/15 text-blue-400 rounded">
                      {comments.length}
                    </span>
                  )}
                </div>
                {commentsLoading ? (
                  <div className="flex items-center gap-2 py-1 text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span className="text-[11px]">Loading...</span>
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-[11px] text-slate-600 py-1">No notes yet</p>
                ) : (
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {comments.map((c: any) => (
                      <div key={c.id} className="px-2 py-1.5 rounded bg-white/4 border border-white/6">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] font-medium text-blue-400">{c.username}</span>
                          <span className="text-[9px] text-slate-600">{safeDateTime(c.created_at)}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug">{c.message}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                    placeholder="Add a note..."
                    className="flex-1 px-2 py-1 text-[11px] rounded bg-white/5 border border-white/10 text-white placeholder-slate-600 focus:outline-none focus:border-primary-500/50"
                  />
                  <button
                    onClick={handlePostComment}
                    disabled={postingComment || !newComment.trim()}
                    className="p-1 rounded bg-primary-500/15 text-primary-400 hover:bg-primary-500/25 disabled:opacity-40 transition-colors"
                  >
                    {postingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : <SendIcon className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Main Agent Inbox component
const FILTER_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'panic', label: 'Panic/SOS' },
  { value: 'battery', label: 'Battery' },
  { value: 'geofence', label: 'Geofence' },
  { value: 'late_night', label: 'Late Night' },
  { value: 'other', label: 'Other' },
];

const AgentInbox: React.FC = () => {
  const {
    session,
    unacknowledgedAlerts,
    acknowledgedAlerts,
    totalAlerts,
    inboxLoading,
    fetchInbox,
    acknowledgeAlert,
    resolveAlert,
    escalateAlert,
    requestBreak,
    cancelBreakRequest,
  } = useAlertDistributionStore();

  // Autocall status for all current alerts
  const allAlerts = useMemo(
    () => [...unacknowledgedAlerts, ...acknowledgedAlerts],
    [unacknowledgedAlerts, acknowledgedAlerts],
  );
  const { statusMap: callStatusMap, refreshOne: refreshCallStatus, refreshingIds: callStatusRefreshingIds } = useRobocallStatus(allAlerts);
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [loadingAlertId, setLoadingAlertId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showBatchResolve, setShowBatchResolve] = useState(false);
  const [batchResolutionType, setBatchResolutionType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [globalResults, setGlobalResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Agent history (acknowledged/resolved) with date range
  const toLocalDatetimeInputValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const nowLocal = useMemo(() => new Date(), []);
  const sevenDaysAgoLocal = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    // start of that day (local)
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [historyStatus, setHistoryStatus] = useState<'acknowledged' | 'resolved' | 'both'>('both');
  const [historyFromDraft, setHistoryFromDraft] = useState<string>(toLocalDatetimeInputValue(sevenDaysAgoLocal));
  const [historyToDraft, setHistoryToDraft] = useState<string>(toLocalDatetimeInputValue(nowLocal));
  const [historyFrom, setHistoryFrom] = useState<string>(toLocalDatetimeInputValue(sevenDaysAgoLocal));
  const [historyTo, setHistoryTo] = useState<string>(toLocalDatetimeInputValue(nowLocal));
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyCounts, setHistoryCounts] = useState<{ acknowledged: number; resolved: number; total: number }>({ acknowledged: 0, resolved: 0, total: 0 });
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyDirty, setHistoryDirty] = useState(false);

  // L3: Filtered alert lists
  const filterAlerts = useCallback((alerts: AlertAssignment[]) => {
    let result = alerts;

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter(a => {
        const t = (a.alert_type || '').toLowerCase();
        if (typeFilter === 'panic') return t === 'panic' || t === 'sos';
        if (typeFilter === 'battery') return t.includes('battery');
        if (typeFilter === 'geofence') return t.includes('geofence');
        if (typeFilter === 'late_night') return t.includes('late_night');
        return !['panic', 'sos', 'battery', 'geofence', 'late_night'].some(k => t.includes(k));
      });
    }

    // Live search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(a =>
        (a.vehicle_reg || '').toLowerCase().includes(q) ||
        (a.customer_name || '').toLowerCase().includes(q) ||
        (a.alert_type || '').toLowerCase().includes(q) ||
        (a.alert_message || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [typeFilter, searchQuery]);

  const filteredUnack = useMemo(() => filterAlerts(unacknowledgedAlerts), [filterAlerts, unacknowledgedAlerts]);
  const filteredAck = useMemo(() => filterAlerts(acknowledgedAlerts), [filterAlerts, acknowledgedAlerts]);

  useEffect(() => {
    if (!session) return;
    fetchInbox();
    const interval = setInterval(() => { fetchInbox(); }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user_id]);

  // Global search — debounced 350ms, searches all agents' alerts
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setGlobalResults([]); return; }

    const timer = setTimeout(async () => {
      if (!session) return;
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/distribution/search?q=${encodeURIComponent(q)}&limit=50`, {
          headers: { 'x-user-id': session.user_id },
        });
        const json = await res.json();
        setGlobalResults(json.success ? json.data : []);
      } catch {
        setGlobalResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load my history when filters panel is open / applied inputs change
  useEffect(() => {
    if (!session) return;
    if (!showFilters) return;

    let cancelled = false;
    const run = async () => {
      setHistoryLoading(true);
      try {
        const res = await api.distribution.getAgentHistory({
          agentId: session.user_id,
          status: historyStatus,
          from: historyFrom,
          to: historyTo,
          q: historyQuery.trim() || undefined,
          limit: 50,
          offset: 0,
        });
        if (cancelled) return;
        setHistoryRows(res.success && res.data ? (res.data as any[]) : []);
        setHistoryCounts((res as any)?.counts || { acknowledged: 0, resolved: 0, total: 0 });
      } catch {
        if (cancelled) return;
        setHistoryRows([]);
        setHistoryCounts({ acknowledged: 0, resolved: 0, total: 0 });
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [session?.user_id, showFilters, historyStatus, historyFrom, historyTo, historyQuery]);

  // Reset draft dates when opening panel
  useEffect(() => {
    if (!showFilters) return;
    setHistoryFromDraft(historyFrom);
    setHistoryToDraft(historyTo);
    setHistoryDirty(false);
  }, [showFilters]);

  // (History search is fetched live via historyQuery dependency)
  
  const handleAcknowledge = useCallback(async (alertId: string) => {
    setLoadingAlertId(alertId);
    await acknowledgeAlert(alertId);
    setLoadingAlertId(null);
  }, [acknowledgeAlert]);
  
  const handleResolve = useCallback(async (alertId: string, resolutionType: string, notes?: string) => {
    setLoadingAlertId(alertId);
    await resolveAlert(alertId, resolutionType, notes);
    setLoadingAlertId(null);
  }, [resolveAlert]);
  
  const handleEscalate = useCallback(async (alertId: string, reason?: string) => {
    setLoadingAlertId(alertId);
    await escalateAlert(alertId, reason);
    setLoadingAlertId(null);
  }, [escalateAlert]);

  // L1: Batch actions
  const handleAcknowledgeAll = useCallback(async () => {
    setBatchLoading(true);
    const concurrency = 8;
    let idx = 0;
    const runners = Array.from({ length: Math.min(concurrency, filteredUnack.length) }, async () => {
      while (idx < filteredUnack.length) {
        const a = filteredUnack[idx++];
        try {
          // Parallelize for speed (server still validates each one)
          await acknowledgeAlert(a.alert_id);
        } catch {
          // non-fatal per-item
        }
      }
    });
    await Promise.all(runners);
    setBatchLoading(false);
  }, [filteredUnack, acknowledgeAlert]);

  const handleResolveAll = useCallback(async (resType: string) => {
    setBatchLoading(true);
    const concurrency = 8;
    let idx = 0;
    const runners = Array.from({ length: Math.min(concurrency, filteredAck.length) }, async () => {
      while (idx < filteredAck.length) {
        const a = filteredAck[idx++];
        try {
          await resolveAlert(a.alert_id, resType);
        } catch {
          // non-fatal per-item
        }
      }
    });
    await Promise.all(runners);
    setBatchLoading(false);
    setShowBatchResolve(false);
    setBatchResolutionType('');
  }, [filteredAck, resolveAlert]);

  if (!session) {
    return null;
  }
  
  const isOnBreak = session.status === 'on_break';
  const hasBreakRequested = session.status === 'break_requested';
  
  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 lg-header flex items-center justify-between cursor-pointer flex-shrink-0"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl lg-chip flex items-center justify-center">
              <Bell className="w-4 h-4 text-primary-400" />
            </div>
            {unacknowledgedAlerts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 rounded-full
                             flex items-center justify-center text-[10px] font-bold text-white
                             ring-2 ring-slate-900/80 shadow-lg shadow-red-500/25">
                {unacknowledgedAlerts.length}
              </span>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-tight">Alert Inbox</h3>
            <p className="text-[11px] text-slate-500">
              {totalAlerts} active • {unacknowledgedAlerts.length} new
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isOnBreak ? (
            <span className="lg-status-pill px-2.5 py-1 text-[11px] font-medium bg-amber-500/15 text-amber-400 rounded-lg">
              On Break
            </span>
          ) : hasBreakRequested ? (
            <button
              onClick={(e) => { e.stopPropagation(); cancelBreakRequest(); }}
              className="lg-status-pill px-2.5 py-1 text-[11px] font-medium bg-amber-500/15 text-amber-400 rounded-lg
                       hover:bg-amber-500/25 transition-colors"
            >
              Cancel Break
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); requestBreak(); }}
              className="lg-icon-btn flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium
                       text-slate-400 rounded-lg hover:text-white"
              title="Request Break"
            >
              <Coffee className="w-3 h-3" />
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); setShowFilters(!showFilters); }}
            className={`p-1.5 rounded-lg lg-icon-btn ${
              typeFilter !== 'all' ? 'text-primary-400 !bg-primary-500/10' : 'text-slate-400'
            }`}
            title="Filter by type"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); fetchInbox(); }}
            className="p-1.5 rounded-lg lg-icon-btn text-slate-400 hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${inboxLoading ? 'animate-spin' : ''}`} />
          </button>

          <div className="w-px h-4 bg-white/5 mx-0.5" />

          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </div>
      
      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden flex-1 flex flex-col"
          >
            <div className="px-3 py-3 space-y-3 flex-1 overflow-y-auto custom-scrollbar">
              {/* Search box */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by plate, customer, type…"
                  className="w-full pl-8 pr-8 py-2 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-600 focus:outline-none focus:border-primary-500/50 focus:bg-white/8 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Global search results — shown when search is active */}
              {searchQuery.trim() && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Search className="w-3 h-3 text-slate-500" />
                    <span className="text-[11px] text-slate-400">
                      {searchLoading ? 'Searching…' : `${globalResults.length} result${globalResults.length !== 1 ? 's' : ''} across all agents`}
                    </span>
                  </div>
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-6 gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs">Searching…</span>
                    </div>
                  ) : globalResults.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No alerts found for "{searchQuery}"</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {globalResults.map((a: any) => {
                        const cfg = getAlertConfig(a.alert_type);
                        const Icon = cfg.icon;
                        const statusColor =
                          a.status === 'resolved' ? 'text-emerald-400' :
                          a.status === 'acknowledged' ? 'text-blue-400' :
                          a.status === 'escalated' ? 'text-amber-400' :
                          'text-slate-400';
                        return (
                          <div
                            key={a.id}
                            className="rounded-xl px-3 py-2.5 bg-white/4 border border-white/8"
                            style={{ borderLeft: `3px solid ${cfg.accent}` }}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color}`} />
                                <span className={`text-xs font-semibold truncate ${cfg.color}`}>
                                  {a.vehicle_reg || '—'}
                                </span>
                              </div>
                              <span className={`text-[10px] font-medium flex-shrink-0 capitalize ${statusColor}`}>
                                {a.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">{a.customer_name || '—'}</div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">{a.alert_message || '—'}</div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-slate-500">
                              <span className={`px-1.5 py-0.5 rounded flex-shrink-0 ${cfg.bgColor} ${cfg.color}`}>{cfg.label}</span>
                              {a.agent_name && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  <span className="text-slate-600">👤</span>
                                  <span className="text-blue-300 font-medium">{a.agent_name}</span>
                                </span>
                              )}
                              {a.status === 'acknowledged' && a.acknowledged_at && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  <span className="text-slate-600">✔</span>
                                  <span className="text-blue-400">Ack: {safeDateTime(a.acknowledged_at)}</span>
                                </span>
                              )}
                              {(a.status === 'resolved' || a.status === 'closed') && a.resolved_at && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  <span className="text-slate-600">✅</span>
                                  <span className="text-emerald-400">Closed: {safeDateTime(a.resolved_at)}</span>
                                </span>
                              )}
                              <span className="ml-auto flex-shrink-0 text-slate-600">{safeDateTime(a.created_at)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Personal inbox — hidden while searching */}
              {!searchQuery.trim() && <>

              {/* Filter bar */}
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="p-2 lg-section-label rounded-xl space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {FILTER_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setTypeFilter(opt.value)}
                            className={`px-2.5 py-1 text-xs rounded-lg transition-all duration-150 ${
                              typeFilter === opt.value
                                ? 'lg-tab-active text-white font-medium'
                                : 'lg-chip text-slate-400 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Agent history filter (ack/resolved) */}
                      <div className="pt-2 border-t border-white/8">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              My History
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Ack <span className="text-blue-300 font-semibold">{historyCounts.acknowledged}</span> • Res <span className="text-emerald-300 font-semibold">{historyCounts.resolved}</span>
                            </span>
                          </div>
                          {historyLoading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
                        </div>

                        {/* History search */}
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                          <input
                            type="text"
                            value={historyQuery}
                            onChange={(e) => setHistoryQuery(e.target.value)}
                            placeholder="Search my history…"
                            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-600 focus:outline-none focus:border-primary-500/50 focus:bg-white/8 transition-colors"
                          />
                        </div>

                        <div className="mb-2 space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              onClick={() => setHistoryStatus('acknowledged')}
                              className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                                historyStatus === 'acknowledged'
                                  ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/8 hover:text-white'
                              }`}
                            >
                              Ack ({historyCounts.acknowledged})
                            </button>
                            <button
                              onClick={() => setHistoryStatus('resolved')}
                              className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                                historyStatus === 'resolved'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/8 hover:text-white'
                              }`}
                            >
                              Resolved ({historyCounts.resolved})
                            </button>
                            <button
                              onClick={() => setHistoryStatus('both')}
                              className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                                historyStatus === 'both'
                                  ? 'bg-white/10 text-white border-white/20'
                                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/8 hover:text-white'
                              }`}
                            >
                              Both ({historyCounts.total})
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              type="datetime-local"
                              value={historyFromDraft}
                              onChange={(e) => { setHistoryFromDraft(e.target.value); setHistoryDirty(true); }}
                              className="w-full min-w-0 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200"
                              title="From"
                            />
                            <input
                              type="datetime-local"
                              value={historyToDraft}
                              onChange={(e) => { setHistoryToDraft(e.target.value); setHistoryDirty(true); }}
                              className="w-full min-w-0 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200"
                              title="To"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setHistoryFrom(historyFromDraft);
                              setHistoryTo(historyToDraft);
                              setHistoryDirty(false);
                            }}
                            disabled={!historyDirty}
                            className="w-full px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                                       bg-primary-500/15 text-primary-300 border-primary-500/25 hover:bg-primary-500/25"
                          >
                            Apply Date Range
                          </button>
                        </div>

                        <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                          {!historyLoading && historyRows.length === 0 ? (
                            <div className="text-[11px] text-slate-500 py-3 text-center">
                              No records in selected range.
                            </div>
                          ) : (
                            historyRows.map((a: any) => {
                              const cfg = getAlertConfig(a.alert_type);
                              const Icon = cfg.icon;
                              const statusColor =
                                a.status === 'resolved' ? 'text-emerald-400' :
                                a.status === 'acknowledged' ? 'text-blue-400' :
                                'text-slate-400';
                              const actionTime =
                                a.status === 'resolved' ? safeDateTime(a.resolved_at) :
                                a.status === 'acknowledged' ? safeDateTime(a.acknowledged_at) :
                                safeDateTime(a.assigned_at);
                              return (
                                <div
                                  key={a.id}
                                  className="rounded-lg px-2 py-1.5 bg-white/4 border border-white/8"
                                  style={{ borderLeft: `3px solid ${cfg.accent}` }}
                                  title={`${a.vehicle_reg || '—'} • ${a.customer_name || '—'} • ${a.alert_message || ''}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <Icon className={`w-3 h-3 flex-shrink-0 ${cfg.color}`} />
                                      <span className="text-[11px] font-semibold text-white truncate leading-none">
                                        {a.vehicle_reg || '—'}
                                      </span>
                                    </div>
                                    <span className={`text-[10px] font-medium capitalize ${statusColor} leading-none`}>
                                      {a.status}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 min-w-0">
                                    <span className={`px-1 py-0.5 rounded text-[9px] leading-none ${cfg.bgColor} ${cfg.color} flex-shrink-0`}>
                                      {cfg.label}
                                    </span>
                                    <span className="truncate min-w-0">
                                      {a.customer_name || '—'}
                                    </span>
                                    <span className="ml-auto flex-shrink-0 text-slate-600 font-mono text-[9px] leading-none">
                                      {actionTime}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {isOnBreak && (
                <div className="p-3 lg-alert-card rounded-xl" style={{ borderLeft: '3px solid #fbbf24' }}>
                  <div className="flex items-center gap-2 text-amber-400">
                    <Coffee className="w-4 h-4" />
                    <span className="text-sm font-medium">You are on break</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    You won't receive new alerts. Clear your pending alerts to complete your break.
                  </p>
                </div>
              )}

              {/* Unacknowledged Alerts */}
              {filteredUnack.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                      <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">
                        New — Action Required
                      </span>
                      <span className="lg-status-pill px-1.5 py-0.5 text-[10px] font-bold text-red-400 bg-red-500/15 rounded-md">
                        {filteredUnack.length}
                      </span>
                    </div>
                    <button
                      onClick={handleAcknowledgeAll}
                      disabled={batchLoading}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg
                               lg-btn-action bg-emerald-500/10 text-emerald-400
                               hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {batchLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                      Ack All
                    </button>
                  </div>
                  <div className="space-y-1">
                    <AnimatePresence>
                      {filteredUnack.map((alert) => (
                        <AlertCard
                          key={alert.alert_id}
                          alert={alert}
                          isAcknowledged={false}
                          onAcknowledge={() => handleAcknowledge(alert.alert_id)}
                          onResolve={(resType, notes) => handleResolve(alert.alert_id, resType, notes)}
                          onEscalate={(reason) => handleEscalate(alert.alert_id, reason)}
                          loading={loadingAlertId === alert.alert_id}
                          callStatus={callStatusMap[alert.alert_id]}
                          onRefreshCallStatus={() => refreshCallStatus(alert)}
                          callStatusRefreshing={callStatusRefreshingIds.has(alert.alert_id)}
                          expanded={expandedAlertId === alert.alert_id}
                          onToggleExpand={() => setExpandedAlertId(expandedAlertId === alert.alert_id ? null : alert.alert_id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Acknowledged Alerts */}
              {filteredAck.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                        In Progress
                      </span>
                      <span className="lg-status-pill px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 rounded-md">
                        {filteredAck.length}
                      </span>
                    </div>
                    <button
                      onClick={() => setShowBatchResolve(!showBatchResolve)}
                      disabled={batchLoading}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg
                               lg-btn-action bg-emerald-500/10 text-emerald-400
                               hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {batchLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                      Resolve All
                    </button>
                  </div>
                  <AnimatePresence>
                    {showBatchResolve && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                        className="mb-3 overflow-hidden"
                      >
                        <div className="p-3 lg-alert-card rounded-xl space-y-2">
                          <select
                            value={batchResolutionType}
                            onChange={(e) => setBatchResolutionType(e.target.value)}
                            className="w-full px-3 py-2 liquid-input rounded-lg
                                     text-sm text-white appearance-none cursor-pointer"
                          >
                            <option value="" disabled className="bg-slate-800">Select resolution for all…</option>
                            {RESOLUTION_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value} className="bg-slate-800">{opt.label}</option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleResolveAll(batchResolutionType)}
                              disabled={!batchResolutionType || batchLoading}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2
                                       lg-btn-action bg-emerald-500/15 text-emerald-400 rounded-lg
                                       font-medium text-sm hover:bg-emerald-500/25 disabled:opacity-50"
                            >
                              {batchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCheck className="w-3.5 h-3.5" /> Resolve {filteredAck.length}</>}
                            </button>
                            <button
                              onClick={() => { setShowBatchResolve(false); setBatchResolutionType(''); }}
                              className="px-3 py-2 lg-btn-action bg-white/5 text-slate-400
                                       rounded-lg text-sm hover:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="space-y-1">
                    <AnimatePresence>
                      {filteredAck.map((alert) => (
                        <AlertCard
                          key={alert.alert_id}
                          alert={alert}
                          isAcknowledged={true}
                          onAcknowledge={() => {}}
                          onResolve={(resType, notes) => handleResolve(alert.alert_id, resType, notes)}
                          onEscalate={(reason) => handleEscalate(alert.alert_id, reason)}
                          loading={loadingAlertId === alert.alert_id}
                          callStatus={callStatusMap[alert.alert_id]}
                          onRefreshCallStatus={() => refreshCallStatus(alert)}
                          callStatusRefreshing={callStatusRefreshingIds.has(alert.alert_id)}
                          expanded={expandedAlertId === alert.alert_id}
                          onToggleExpand={() => setExpandedAlertId(expandedAlertId === alert.alert_id ? null : alert.alert_id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {filteredUnack.length === 0 && filteredAck.length === 0 && (
                <div className="text-center py-12 lg-empty-state rounded-xl mx-1">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl lg-chip flex items-center justify-center">
                    <Bell className="w-7 h-7 text-slate-500 opacity-50" />
                  </div>
                  <p className="text-sm font-medium text-slate-300">
                    {searchQuery ? 'No results found' : typeFilter !== 'all' ? 'No matching alerts' : 'No alerts assigned'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1.5 max-w-[200px] mx-auto">
                    {typeFilter !== 'all' ? 'Try a different filter or clear the selection' : 'New alerts will appear here automatically'}
                  </p>
                </div>
              )}

              </> /* end personal inbox */}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentInbox;
