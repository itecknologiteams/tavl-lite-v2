import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle,
  MapPin,
  Bell,
  RefreshCw,
  ChevronRight,
  Volume2,
  VolumeX,
  Zap,
  Battery,
  Navigation,
  Clock,
  User,
  Phone,
  Car,
  Loader2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { useAlarmStore } from '@store/alarmStore';
import { useVehicleStore } from '@store/vehicleStore';
import { useAlarms } from '@hooks/useAlarms';
import { api, isElectron } from '@services/api';
import { formatDistanceToNow, format } from 'date-fns';
import type { Alarm, Vehicle } from '@apptypes/vehicle';

// Category configuration - only Critical, Warning, Geofence
const CATEGORY_CONFIG = {
  all: { label: 'All', icon: Bell, color: 'text-white', bgColor: 'bg-white/10' },
  critical: { label: 'Critical', icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/20' },
  high: { label: 'Warning', icon: Battery, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  medium: { label: 'Geofence', icon: Navigation, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
};

const SEVERITY_CONFIG = {
  critical: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/50',
    icon: AlertTriangle,
    pulse: true,
  },
  high: {
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    borderColor: 'border-orange-500/50',
    icon: Zap,
    pulse: false,
  },
  medium: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/50',
    icon: Navigation,
    pulse: false,
  },
  low: {
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/20',
    borderColor: 'border-slate-500/50',
    icon: Bell,
    pulse: false,
  },
};

// CRM data type
interface CrmData {
  CustomerName?: string;
  CellNo?: string;
  TelephoneNo?: string;
  Address1?: string;
  Address2?: string;
  Vehicle_Make?: string;
  Vehicle_Model?: string;
  Vehicle_Year?: string;
  Vehicle_Color?: string;
  Vehicle_RegistrationNo?: string;
  Vehicle_ChasisNo?: string;
  Vehicle_IsLeased?: string;
  Vehicle_Lessee?: string;
  Vehicle_IsInsured?: string;
  InsuredBy?: string;
  FLEET_TYPE?: string;
  Vehicle_TrackingSpecialInstructions?: string;
}

// Robocall status type
interface RobocallStatus {
  alertId: string;
  status: 'dialing' | 'ringing' | 'answered' | 'no_answer' | 'rejected' | 'failed' | 'unavailable' | 'unknown';
  statusCode: number;
  callPlacedAt?: string;
  callReceivedAt?: string;
  callEndedAt?: string;
  duration: number;
  userInput: string;
  phoneNumber: string;
}

// Cache for robocall status (with timestamp for expiry)
const robocallCache = new Map<string, { data: RobocallStatus | null; timestamp: number }>();
const ROBOCALL_CACHE_TTL = 3 * 60 * 1000; // 3 minutes cache

// Event type icons
function getEventIcon(alarmType: string) {
  const lowerType = (alarmType || '').toLowerCase();
  
  if (lowerType.includes('speed') || lowerType.includes('over')) return Zap;
  if (lowerType.includes('panic') || lowerType.includes('sos')) return AlertTriangle;
  if (lowerType.includes('battery') || lowerType.includes('power') || lowerType.includes('volt')) return Battery;
  if (lowerType.includes('roaming') || lowerType.includes('geofence')) return Navigation;
  
  return MapPin; // Default for city geofences
}

export default function LiveAlertsPanel() {
  const alarms = useAlarmStore((state) => state.alarms);
  const unacknowledgedCount = useAlarmStore((state) => state.unacknowledgedCount);
  const { acknowledgeAlarm, refreshAlerts, isPolling, lastError, pendingCount } = useAlarms();
  
  const setVehicles = useVehicleStore((state) => state.setVehicles);
  const showOnMapExclusive = useVehicleStore((state) => state.showOnMapExclusive);
  const vehicles = useVehicleStore((state) => state.vehicles);
  
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [expandedAlarm, setExpandedAlarm] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // CRM data cache per alarm
  const [crmDataCache, setCrmDataCache] = useState<Record<string, CrmData | null>>({});
  const [loadingCrm, setLoadingCrm] = useState<string | null>(null);
  
  // Robocall status cache per alarm
  const [robocallStatusCache, setRobocallStatusCache] = useState<Record<string, RobocallStatus | null>>({});
  const [loadingRobocall, setLoadingRobocall] = useState(false);
  
  const listRef = useRef<HTMLDivElement>(null);

  // Count by severity (only unacknowledged)
  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, total: 0 };
    alarms.filter(a => !a.acknowledged).forEach((a) => {
      counts.total++;
      if (a.severity === 'critical') counts.critical++;
      else if (a.severity === 'high') counts.high++;
      else if (a.severity === 'medium') counts.medium++;
    });
    return counts;
  }, [alarms]);

  // Filtered and sorted alarms (oldest first - newest at bottom)
  const filteredAlarms = useMemo(() => {
    return alarms
      .filter((alarm) => {
        // Only show unacknowledged
        if (alarm.acknowledged) return false;
        // Category filter
        if (categoryFilter !== 'all' && alarm.severity !== categoryFilter) return false;
        return true;
      })
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }, [alarms, categoryFilter]);

  // Auto-scroll to bottom when new alerts arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filteredAlarms.length]);

  // Fetch robocall status for visible alerts
  // Uses warningId for direct lookup (ConsoleWarning alerts)
  // Falls back to objectId + timestamp for other alerts
  useEffect(() => {
    const fetchRobocallStatus = async () => {
      // Get alerts that we don't have cached (or cache is expired)
      const now = Date.now();
      const alertsToFetch = filteredAlarms
        .filter(alarm => {
          const cached = robocallCache.get(alarm.id);
          return !cached || (now - cached.timestamp > ROBOCALL_CACHE_TTL);
        })
        .map(alarm => ({
          id: alarm.id,
          warningId: alarm.warningId, // Direct lookup if available
          objectId: alarm.vehicleId,
          timestamp: new Date(alarm.occurredAt).toISOString(),
        }))
        .slice(0, 20); // Limit batch size
      
      if (alertsToFetch.length === 0) return;
      
      setLoadingRobocall(true);
      try {
        let result;
        if (isElectron()) {
          const electron = (window as any).electron;
          if (electron.robocall?.lookupBatch) {
            result = await electron.robocall.lookupBatch(alertsToFetch);
          }
        } else {
          result = await api.robocall.lookupBatch(alertsToFetch);
        }
        
        if (result?.success && result.data) {
          const statusMap: Record<string, RobocallStatus | null> = {};
          
          // Update cache and state
          alertsToFetch.forEach(alert => {
            const status = result.data[alert.id] || null;
            robocallCache.set(alert.id, { data: status, timestamp: now });
            statusMap[alert.id] = status;
          });
          
          setRobocallStatusCache(prev => ({ ...prev, ...statusMap }));
        }
      } catch (error) {
        console.error('Failed to fetch robocall status:', error);
      } finally {
        setLoadingRobocall(false);
      }
    };
    
    // Debounce to avoid rapid refetching
    const timeout = setTimeout(fetchRobocallStatus, 500);
    return () => clearTimeout(timeout);
  }, [filteredAlarms]);

  // Fetch CRM data when alarm is expanded
  const fetchCrmData = async (alarm: Alarm) => {
    // Check cache first
    if (crmDataCache[alarm.id] !== undefined) return;
    
    setLoadingCrm(alarm.id);
    try {
      let result;
      if (isElectron()) {
        const electron = (window as any).electron;
        result = await electron.crm?.getVehicleDetails(alarm.vehicleId);
      } else {
        result = await api.crm.getVehicleDetails(alarm.vehicleId);
      }
      
      if (result?.success && result.data) {
        setCrmDataCache(prev => ({ ...prev, [alarm.id]: result.data }));
        console.log('✅ CRM data loaded for', alarm.vehicleName);
      } else {
        setCrmDataCache(prev => ({ ...prev, [alarm.id]: null }));
      }
    } catch (error) {
      console.error('Failed to fetch CRM data:', error);
      setCrmDataCache(prev => ({ ...prev, [alarm.id]: null }));
    } finally {
      setLoadingCrm(null);
    }
  };

  // Handle expand - fetch CRM data
  const handleExpand = (alarm: Alarm) => {
    const isExpanding = expandedAlarm !== alarm.id;
    setExpandedAlarm(isExpanding ? alarm.id : null);
    
    if (isExpanding) {
      fetchCrmData(alarm);
    }
  };

  // Handle show on map
  const handleShowOnMap = async (alarm: Alarm) => {
    try {
      // Prefer showing the alert snapshot (same behavior as Python: uses alert row gpstime/x/y/speed)
      if (alarm.latitude && alarm.longitude) {
        const vehicle: Vehicle = {
          objectId: String(alarm.vehicleId),
          vehicleId: String(alarm.vehicleId),
          name: (alarm as any).vehicleName || `Vehicle ${alarm.vehicleId}`,
          registrationNumber: (alarm as any).vehicleName || String(alarm.vehicleId),
          companyId: '',
          companyName: '',
          deviceId: '',
          status: 'moving',
          gpsData: {
            latitude: Number(alarm.latitude),
            longitude: Number(alarm.longitude),
            angle: 0,
            speed: Number((alarm as any).speed) || 0,
            altitude: 0,
            satellites: 0,
            gpsTime: new Date(alarm.occurredAt),
            serverTime: new Date(alarm.appearedAt || alarm.occurredAt),
            valid: true,
          },
        };

        // Add/update in the store for consistent UI
        const existingVehicles = Array.from(vehicles.values());
        const filtered = existingVehicles.filter(v => v.objectId !== vehicle.objectId);
        setVehicles([...filtered, vehicle]);
        showOnMapExclusive(vehicle);
        return;
      }

      // Fallback: no coordinates on alert (use latest details)
      const result = isElectron()
        ? await (window as any).electron.vehicle.getDetails(parseInt(alarm.vehicleId))
        : await api.vehicle.getDetails(parseInt(alarm.vehicleId));

      if (result.success && result.data) {
        const vehicleData = result.data;
        const vehicle: Vehicle = {
          objectId: vehicleData.objectId.toString(),
          vehicleId: vehicleData.id,
          name: vehicleData.plateNumber,
          registrationNumber: vehicleData.plateNumber,
          companyId: '',
          companyName: '',
          deviceId: vehicleData.imei,
          status: vehicleData.status,
          gpsData: {
            latitude: vehicleData.latitude,
            longitude: vehicleData.longitude,
            angle: vehicleData.angle,
            speed: vehicleData.speed,
            altitude: vehicleData.altitude,
            satellites: vehicleData.satellites,
            gpsTime: new Date(vehicleData.gpsTime),
            serverTime: new Date(vehicleData.serverTime),
            valid: vehicleData.gpsValid,
          },
        };
        const existingVehicles = Array.from(vehicles.values());
        const filtered = existingVehicles.filter(v => v.objectId !== vehicle.objectId);
        setVehicles([...filtered, vehicle]);
        showOnMapExclusive(vehicle);
      }
    } catch (error) {
      console.error('Failed to show vehicle on map:', error);
    }
  };

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setCrmDataCache({}); // Clear CRM cache
    await refreshAlerts();
    setIsRefreshing(false);
  };

  const AlarmCard = ({ alarm, index }: { alarm: Alarm; index: number }) => {
    const config = SEVERITY_CONFIG[alarm.severity] || SEVERITY_CONFIG.medium;
    const EventIcon = getEventIcon(alarm.alarmType);
    const isExpanded = expandedAlarm === alarm.id;
    const crmData = crmDataCache[alarm.id];
    const isLoadingCrm = loadingCrm === alarm.id;
    const robocallStatus = robocallStatusCache[alarm.id];
    
    // Render robocall status indicator
    const renderRobocallStatus = () => {
      // Check if robocall status is loading or available
      const cached = robocallCache.get(alarm.id);
      const isLoading = loadingRobocall && !cached;
      
      if (isLoading) {
        return (
          <div className="flex items-center gap-1 text-[10px] text-yellow-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Checking...</span>
          </div>
        );
      }
      
      if (!robocallStatus) {
        // No robocall for this alert
        return null;
      }
      
      const { status, duration, userInput } = robocallStatus;
      
      if (status === 'answered') {
        return (
          <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full">
            <ThumbsUp className="w-3 h-3" />
            <span>Answered ({duration}s){userInput && ` • Input: ${userInput}`}</span>
          </div>
        );
      }
      
      if (status === 'dialing' || status === 'ringing') {
        return (
          <div className="flex items-center gap-1.5 text-[10px] text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{status === 'dialing' ? 'Dialing...' : 'Ringing...'}</span>
          </div>
        );
      }
      
      // Failed states: no_answer, rejected, failed, unavailable
      return (
        <div className="flex items-center gap-1.5 text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">
          <ThumbsDown className="w-3 h-3" />
          <span>
            {status === 'no_answer' && 'No answer - Call required'}
            {status === 'rejected' && 'Rejected - Call required'}
            {status === 'failed' && 'Failed - Call required'}
            {status === 'unavailable' && 'Unavailable - Call required'}
            {status === 'unknown' && 'Unknown - Call required'}
          </span>
        </div>
      );
    };
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 10, height: 'auto' }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
        transition={{ duration: 0.2, delay: index * 0.02 }}
        layout
      >
        <div
          className={`relative overflow-hidden rounded-xl border transition-all ${config.bgColor} ${config.borderColor} ${config.pulse ? 'animate-pulse-slow' : ''}`}
        >
          {/* Main Content */}
          <div
            onClick={() => handleExpand(alarm)}
            className="p-3 cursor-pointer"
          >
            <div className="flex items-start gap-3">
              {/* Event Icon */}
              <div className={`p-2 rounded-lg ${config.bgColor}`}>
                <EventIcon className={`w-4 h-4 ${config.color}`} />
              </div>
              
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`font-semibold text-sm ${config.color} truncate`}>
                    {alarm.vehicleName}
                  </span>
                  <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(alarm.occurredAt, 'HH:mm:ss')}
                  </span>
                </div>
                <p className="text-sm text-white font-medium truncate">
                  {alarm.alarmType}
                </p>
                {/* Robocall Status Indicator */}
                <div className="mt-1">
                  {renderRobocallStatus()}
                </div>
              </div>
              
              {/* Expand Arrow */}
              <ChevronRight
                className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
            </div>
          </div>
          
          {/* Expanded Details */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-3 pt-1 border-t border-white/10">
                  {/* Alert Details */}
                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                    <div>
                      <span className="text-slate-500">Time:</span>
                      <span className="ml-1 text-white">
                        {format(alarm.occurredAt, 'HH:mm:ss')}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Date:</span>
                      <span className="ml-1 text-white">
                        {format(alarm.occurredAt, 'MMM dd')}
                      </span>
                    </div>
                    {alarm.latitude !== 0 && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Location:</span>
                        <span className="ml-1 text-white">
                          {alarm.latitude.toFixed(4)}, {alarm.longitude.toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* CRM Data Section */}
                  {isLoadingCrm ? (
                    <div className="flex items-center justify-center py-3 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span className="text-xs">Loading CRM data...</span>
                    </div>
                  ) : crmData ? (
                    <div className="mb-3 p-2 lg-card rounded-lg space-y-2 overflow-hidden">
                      {/* Customer Info */}
                      <div className="flex items-start gap-2 min-w-0">
                        <User className="w-3.5 h-3.5 text-primary-400 mt-0.5 flex-shrink-0" />
                        <div className="text-xs min-w-0 flex-1">
                          <div className="text-white font-medium truncate" title={crmData.CustomerName || 'N/A'}>
                            {crmData.CustomerName || 'N/A'}
                          </div>
                          {crmData.Address1 && (
                            <div className="text-slate-400 truncate" title={crmData.Address1}>{crmData.Address1}</div>
                          )}
                        </div>
                      </div>
                      
                      {/* Contact */}
                      {(crmData.CellNo || crmData.TelephoneNo) && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span className="text-xs text-white truncate">
                            {crmData.CellNo || crmData.TelephoneNo}
                          </span>
                        </div>
                      )}
                      
                      {/* Vehicle Info */}
                      <div className="flex items-start gap-2 min-w-0">
                        <Car className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div className="text-xs min-w-0 flex-1">
                          <div className="text-white truncate">
                            {[crmData.Vehicle_Make, crmData.Vehicle_Model, crmData.Vehicle_Year]
                              .filter(Boolean).join(' ') || 'N/A'}
                          </div>
                          {crmData.Vehicle_Color && (
                            <span className="text-slate-400">{crmData.Vehicle_Color}</span>
                          )}
                        </div>
                      </div>
                      
                      {/* Leased/Insured Info */}
                      {(crmData.Vehicle_IsLeased === 'YES' || crmData.Vehicle_IsInsured === 'YES') && (
                        <div className="flex gap-2 flex-wrap">
                          {crmData.Vehicle_IsLeased === 'YES' && (
                            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] rounded truncate max-w-full" title={`Leased: ${crmData.Vehicle_Lessee || 'Yes'}`}>
                              Leased: {crmData.Vehicle_Lessee || 'Yes'}
                            </span>
                          )}
                          {crmData.Vehicle_IsInsured === 'YES' && (
                            <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] rounded">
                              Insured
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Special Instructions */}
                      {crmData.Vehicle_TrackingSpecialInstructions && 
                       crmData.Vehicle_TrackingSpecialInstructions !== 'N.A' && (
                        <div className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                          ⚠️ {crmData.Vehicle_TrackingSpecialInstructions}
                        </div>
                      )}
                    </div>
                  ) : crmData === null ? (
                    <div className="mb-3 p-2 lg-card rounded-lg text-xs text-slate-500 text-center">
                      No CRM data available
                    </div>
                  ) : null}
                  
                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        acknowledgeAlarm(alarm.id);
                        setExpandedAlarm(null);
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Acknowledge
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShowOnMap(alarm);
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500/20 text-primary-400 text-xs font-medium hover:bg-primary-500/30 transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Show on Map
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="h-full flex flex-col w-[360px]">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-white/6 lg-header">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${
              severityCounts.critical > 0 ? 'bg-red-500/20' : 'bg-white/5'
            }`}>
              <AlertTriangle className={`w-5 h-5 ${
                severityCounts.critical > 0 ? 'text-red-400' : 'text-slate-400'
              }`} />
            </div>
            <div>
              <h2 className="font-semibold text-white">Live Alerts</h2>
              <p className="text-xs text-slate-400">
                {unacknowledgedCount} active
                {pendingCount > 0 && ` • ${pendingCount} queued`}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`p-2 rounded-lg transition-colors ${
                isRefreshing ? 'text-primary-400' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title="Refresh alerts"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            
            {/* Sound Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'bg-white/5 text-slate-400'
              }`}
              title={soundEnabled ? 'Mute alerts' : 'Enable alert sounds'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>
        
        {/* Category Filter Pills */}
        <div className="flex gap-1">
          {(['all', 'critical', 'high', 'medium'] as const).map((cat) => {
            const config = CATEGORY_CONFIG[cat];
            const count = cat === 'all' ? severityCounts.total : severityCounts[cat];
            const Icon = config.icon;
            const isActive = categoryFilter === cat;
            
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center ${
                  isActive
                    ? `${config.bgColor} ${config.color} lg-tab-active`
                    : 'lg-chip text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {config.label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    isActive ? 'bg-white/20' : 'bg-white/10'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error Banner */}
      {lastError && (
        <div className="flex-shrink-0 p-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400 text-center">{lastError}</p>
        </div>
      )}

      {/* Alert List - scrolls, newest at bottom */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        <AnimatePresence mode="popLayout">
          {filteredAlarms.map((alarm, index) => (
            <AlarmCard key={alarm.id} alarm={alarm} index={index} />
          ))}
        </AnimatePresence>
        
        {filteredAlarms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <CheckCircle className="w-12 h-12 mb-3 text-emerald-500/50" />
            <p className="font-medium text-emerald-400">All Clear</p>
            <p className="text-sm text-slate-500">No active alerts</p>
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="flex-shrink-0 px-4 py-2 border-t border-white/6 lg-footer" style={{ height: 'auto' }}>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
            <span>{isPolling ? 'Live (30s)' : 'Paused'}</span>
          </div>
          <span>Max 20 alerts</span>
        </div>
      </div>
    </div>
  );
}
