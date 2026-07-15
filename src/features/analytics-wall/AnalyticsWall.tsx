/**
 * Analytics Video Wall — Liquid Glass Command Center
 * Real-time analytics dashboard optimized for video wall displays
 * No authentication required — designed for command center monitors
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Car,
  MapPin,
  Maximize,
  Activity,
  Shield,
  Zap,
  Bell,
  Radio,
  Gauge,
  TrendingUp,
  Users,
} from 'lucide-react';

// Types
interface AnalyticsSummary {
  lastHour: {
    total: number;
    critical: number;
    warning: number;
    geofence: number;
  };
  today: {
    total: number;
  };
  stolenTracking: {
    active: number;
  };
  assignments: {
    pending: number;
    acknowledged: number;
    resolved: number;
  };
  alertBreakdown: { name: string; count: number | string; category: string }[];
  timestamp: string;
}

interface HourlyData {
  hour: string;
  critical: number | string;
  warning: number | string;
  geofence: number | string;
  total: number | string;
}

interface RealtimeData {
  alert_count: number | string;
  critical_count: number | string;
  active_vehicles: number | string;
  last_event: string;
  stolenVehicles: any[];
  timestamp: string;
}

export default function AnalyticsWall() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [geofenceData, setGeofenceData] = useState<any[]>([]);
  const [topAlerting, setTopAlerting] = useState<any[]>([]);
  const [realtime, setRealtime] = useState<RealtimeData | null>(null);
  const [fleetData, setFleetData] = useState<any>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const retryRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const MAX_WARMUP_RETRIES = 20;

  const fetchAllData = useCallback(async () => {
    try {
      const [summaryRes, hourlyRes, geofenceRes, topRes, fleetRes] = await Promise.all([
        fetch('/api/analytics/summary'),
        fetch('/api/analytics/hourly'),
        fetch('/api/analytics/geofence'),
        fetch('/api/analytics/top-alerting'),
        fetch('/api/analytics/fleet'),
      ]);

      const isWarmingUp = summaryRes.status === 503;

      const [summaryData, hourlyD, geofenceD, topD, fleetD] = await Promise.all([
        summaryRes.json(),
        hourlyRes.json(),
        geofenceRes.json(),
        topRes.json(),
        fleetRes.json(),
      ]);

      if (summaryData.success) setSummary(summaryData.data);
      if (hourlyD.success) setHourlyData(hourlyD.data);
      if (geofenceD.success) setGeofenceData(geofenceD.data);
      if (topD.success) setTopAlerting(topD.data);
      if (fleetD.success) setFleetData(fleetD.data);

      setLastUpdate(new Date());
      if (!isWarmingUp) setLoading(false);

      if (isWarmingUp && retryCountRef.current < MAX_WARMUP_RETRIES && !retryRef.current) {
        retryCountRef.current++;
        retryRef.current = setTimeout(() => { retryRef.current = null; fetchAllData(); }, 3000);
      } else if (!isWarmingUp) {
        retryCountRef.current = 0;
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      if (retryCountRef.current < MAX_WARMUP_RETRIES && !retryRef.current) {
        retryCountRef.current++;
        retryRef.current = setTimeout(() => { retryRef.current = null; fetchAllData(); }, 3000);
      } else {
        setLoading(false);
      }
    }
  }, []);
  
  const fetchRealtime = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/realtime');
      const data = await res.json();
      if (data.success) {
        setRealtime(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch realtime data:', error);
    }
  }, []);
  
  useEffect(() => {
    fetchAllData();
    fetchRealtime();
    
    refreshIntervalRef.current = setInterval(fetchAllData, 60000);
    realtimeIntervalRef.current = setInterval(fetchRealtime, 10000);
    
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen').catch(() => {});
    }
    
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (realtimeIntervalRef.current) clearInterval(realtimeIntervalRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [fetchAllData, fetchRealtime]);
  
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };
  
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  const formatTime = (date: Date) => date.toLocaleTimeString('en-PK', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Karachi'
  });
  
  const num = (v: any) => parseInt(String(v)) || 0;
  const pct = (v: number, total: number) => total > 0 ? ((v / total) * 100).toFixed(1) : '0';
  
  const chartData = hourlyData.map(d => ({
    hour: new Date(d.hour).getHours(),
    critical: num(d.critical),
    warning: num(d.warning),
    geofence: num(d.geofence),
  }));
  const maxHourly = Math.max(...chartData.map(d => d.critical + d.warning + d.geofence), 1);
  
  if (loading) {
    return (
      <div className="lg-page-bg h-screen w-screen flex items-center justify-center">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="login-blob login-blob-1" style={{ opacity: 0.3 }} />
          <div className="login-blob login-blob-2" style={{ opacity: 0.2 }} />
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center relative z-10">
          <motion.img
            src="/images/logot.png"
            alt="iTecknologi"
            className="h-16 w-auto mx-auto mb-6 drop-shadow-[0_0_30px_rgba(6,182,212,0.3)]"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="w-16 h-16 border-4 border-cyan-500/60 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold text-cyan-400/80 tracking-widest">INITIALIZING SYSTEMS...</h2>
          <p className="text-sm text-white/20 mt-2">Warming up data caches</p>
        </motion.div>
      </div>
    );
  }
  
  const moving = num(fleetData?.status?.moving);
  const parked = num(fleetData?.status?.parked);
  const offline = num(fleetData?.status?.offline);
  const totalFleet = num(fleetData?.status?.total_vehicles);
  
  return (
    <div className="lg-page-bg h-screen w-screen text-white overflow-hidden flex flex-col font-mono">
      {/* Ambient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="lg-page-blob" style={{ width: 600, height: 600, background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)', top: '-15%', left: '-10%' }} />
        <div className="lg-page-blob" style={{ width: 500, height: 500, background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)', bottom: '-10%', right: '-10%', animationDelay: '12s' }} />
        <div className="lg-page-blob" style={{ width: 350, height: 350, background: 'radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%)', top: '50%', left: '40%', animationDelay: '6s' }} />
      </div>

      {/* Subtle grid */}
      <div className="absolute inset-0 login-grid-bg pointer-events-none z-0" />

      {/* TOP BAR */}
      <header className="lg-header h-12 flex items-center justify-between px-4 flex-shrink-0 relative z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/logot.png" alt="iTecknologi" className="h-8 w-auto drop-shadow-[0_0_12px_rgba(6,182,212,0.2)]" />
          </div>
          <div className="h-6 w-px bg-cyan-500/15" />
          <span className="text-xs text-white/25 tracking-widest">ANALYTICS CONSOLE</span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/40" />
            <span className="text-xs text-emerald-400/70 tracking-widest">SYSTEMS NOMINAL</span>
          </div>
          <button onClick={toggleFullscreen} className="lg-icon-btn p-1.5 rounded-lg text-white/25 hover:text-white/50">
            <Maximize className="w-4 h-4" />
          </button>
          <div className="text-2xl font-bold text-cyan-400/80 tracking-widest tabular-nums">
            {formatTime(currentTime)}
          </div>
        </div>
      </header>

      {/* MAIN GRID */}
      <main className="flex-1 p-3 grid grid-cols-12 grid-rows-6 gap-3 min-h-0 relative z-10">
        
        {/* TOP LEFT — PRIMARY METRICS */}
        <div className="col-span-3 row-span-2 grid grid-cols-2 gap-2">
          <MetricCard label="ALERTS TODAY" value={num(summary?.today.total)} icon={<Bell className="w-4 h-4" />} color="cyan" />
          <MetricCard label="LAST HOUR" value={num(summary?.lastHour.total)} icon={<Activity className="w-4 h-4" />} color="blue" />
          <MetricCard label="CRITICAL" value={num(summary?.lastHour.critical)} icon={<AlertTriangle className="w-4 h-4" />} color="red" pulse={num(summary?.lastHour.critical) > 0} />
          <MetricCard label="WARNINGS" value={num(summary?.lastHour.warning)} icon={<Shield className="w-4 h-4" />} color="amber" />
        </div>

        {/* TOP CENTER — 24H TREND CHART */}
        <div className="col-span-6 row-span-2 lg-card lg-card-cyan rounded-xl p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400/70" />
              <span className="text-xs font-bold text-cyan-400/80 tracking-widest">24H ALERT TREND</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-white/30">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-sm" />CRITICAL</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-sm" />WARNING</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" />GEOFENCE</span>
            </div>
          </div>
          <div className="flex-1 relative min-h-0">
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="border-t border-white/[0.03] w-full" />
              ))}
            </div>
            <div className="absolute inset-0 flex items-end gap-1 pb-5">
              {chartData.map((d, i) => {
                const total = d.critical + d.warning + d.geofence;
                const barHeight = maxHourly > 0 ? (total / maxHourly) * 100 : 0;
                const criticalRatio = total > 0 ? d.critical / total : 0;
                const warningRatio = total > 0 ? d.warning / total : 0;
                const geofenceRatio = total > 0 ? d.geofence / total : 0;
                
                return (
                  <div key={i} className="flex-1 h-full flex flex-col justify-end group relative">
                    <div 
                      className="w-full rounded-t-sm flex flex-col-reverse overflow-hidden transition-all duration-300 hover:opacity-80"
                      style={{ height: `${Math.max(barHeight, total > 0 ? 3 : 0)}%` }}
                    >
                      {d.geofence > 0 && (
                        <div className="w-full bg-gradient-to-t from-emerald-600/80 to-emerald-400/80" style={{ height: `${geofenceRatio * 100}%` }} />
                      )}
                      {d.warning > 0 && (
                        <div className="w-full bg-gradient-to-t from-amber-600/80 to-amber-400/80" style={{ height: `${warningRatio * 100}%` }} />
                      )}
                      {d.critical > 0 && (
                        <div className="w-full bg-gradient-to-t from-red-600/80 to-red-400/80" style={{ height: `${criticalRatio * 100}%` }} />
                      )}
                    </div>
                    <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] text-white/20">
                      {i % 3 === 0 ? d.hour.toString().padStart(2, '0') : ''}
                    </span>
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-20">
                      <div className="liquid-glass rounded-lg px-3 py-2 text-[11px] whitespace-nowrap shadow-xl shadow-black/50">
                        <div className="text-cyan-400 font-bold mb-1">{d.hour.toString().padStart(2, '0')}:00</div>
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-red-400/80">Critical:</span>
                            <span className="text-white font-bold">{d.critical.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-amber-400/80">Warning:</span>
                            <span className="text-white font-bold">{d.warning.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-emerald-400/80">Geofence:</span>
                            <span className="text-white font-bold">{d.geofence.toLocaleString()}</span>
                          </div>
                          <div className="border-t border-white/10 mt-1 pt-1 flex items-center justify-between gap-4">
                            <span className="text-white/30">Total:</span>
                            <span className="text-cyan-400 font-bold">{total.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {maxHourly > 0 && (
              <div className="absolute top-0 right-0 text-[9px] text-white/15">
                Peak: {maxHourly.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* TOP RIGHT — TOP ALERTING VEHICLES */}
        <div className="col-span-3 row-span-2 lg-card lg-card-cyan rounded-xl p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Car className="w-4 h-4 text-cyan-400/70" />
            <span className="text-xs font-bold text-cyan-400/80 tracking-widest">TOP ALERTING</span>
          </div>
          <div className="flex-1 overflow-hidden space-y-1">
            {topAlerting.slice(0, 6).map((v, i) => (
              <div key={i} className="flex items-center justify-between py-1 px-2 rounded-lg text-xs" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    i === 0 ? 'bg-yellow-500/80 text-black' : i === 1 ? 'bg-gray-400/80 text-black' : i === 2 ? 'bg-amber-700/80 text-white' : 'bg-white/10 text-white/40'
                  }`}>{i + 1}</span>
                  <span className="text-white/50 truncate max-w-[100px]">{v.vehicle_name}</span>
                </div>
                <span className="text-cyan-400/80 font-bold">{num(v.alert_count).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* MIDDLE LEFT — FLEET STATUS */}
        <div className="col-span-3 row-span-2 lg-card lg-card-cyan rounded-xl p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-cyan-400/70" />
            <span className="text-xs font-bold text-cyan-400/80 tracking-widest">FLEET STATUS</span>
          </div>
          <div className="flex-1 flex items-center gap-4">
            <div className="relative w-24 h-24 flex-shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                {totalFleet > 0 && (
                  <>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#22c55e" strokeWidth="8" strokeOpacity="0.7"
                      strokeDasharray={`${(moving / totalFleet) * 251.2} 251.2`} strokeLinecap="round" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" strokeWidth="8" strokeOpacity="0.7"
                      strokeDasharray={`${(parked / totalFleet) * 251.2} 251.2`}
                      strokeDashoffset={`${-(moving / totalFleet) * 251.2}`} strokeLinecap="round" />
                  </>
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-white/80">{totalFleet.toLocaleString()}</span>
                <span className="text-[8px] text-white/20 tracking-widest">TOTAL</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <FleetStat label="MOVING" value={moving} pct={pct(moving, totalFleet)} color="emerald" />
              <FleetStat label="PARKED" value={parked} pct={pct(parked, totalFleet)} color="blue" />
              <FleetStat label="OFFLINE" value={offline} pct={pct(offline, totalFleet)} color="gray" />
            </div>
          </div>
        </div>

        {/* MIDDLE CENTER — STOLEN VEHICLES */}
        <div className="col-span-6 row-span-2 lg-card lg-card-red rounded-xl p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-400/70 animate-pulse" />
              <span className="text-xs font-bold text-red-400/80 tracking-widest">STOLEN VEHICLE TRACKING</span>
            </div>
            <span className="text-xs text-white/20">{num(summary?.stolenTracking.active)} ACTIVE</span>
          </div>
          <div className="flex-1 flex gap-3 overflow-x-auto">
            {realtime?.stolenVehicles?.length ? realtime.stolenVehicles.map((v, i) => (
              <div key={i} className={`flex-shrink-0 w-64 p-3 rounded-xl lg-card ${
                v.priority === 1 ? 'lg-card-red' : 
                v.priority === 2 ? 'lg-card-amber' : 'lg-card-cyan'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white/80">{v.vehicle_reg}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                    v.priority === 1 ? 'bg-red-500/70 text-white' : v.priority === 2 ? 'bg-amber-500/70 text-black' : 'bg-blue-500/70 text-white'
                  }`}>P{v.priority}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-white/30">Speed: <span className="text-white/70">{num(v.last_speed)} km/h</span></div>
                  <div className="text-white/30">Dist: <span className="text-white/70">{parseFloat(String(v.total_distance_km || 0)).toFixed(1)} km</span></div>
                </div>
                {v.customer_name && <div className="text-[10px] text-white/20 mt-1 truncate">{v.customer_name}</div>}
              </div>
            )) : (
              <div className="flex-1 flex items-center justify-center text-white/15 text-sm">
                NO ACTIVE STOLEN VEHICLES
              </div>
            )}
          </div>
        </div>

        {/* MIDDLE RIGHT — GEOFENCE BREAKDOWN */}
        <div className="col-span-3 row-span-2 lg-card lg-card-emerald rounded-xl p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-emerald-400/70" />
            <span className="text-xs font-bold text-cyan-400/80 tracking-widest">GEOFENCE (24H)</span>
          </div>
          <div className="flex-1 overflow-hidden space-y-1">
            {geofenceData.slice(0, 6).map((g, i) => {
              const cnt = num(g.count);
              const maxG = num(geofenceData[0]?.count) || 1;
              return (
                <div key={i} className="relative py-1 px-2 rounded-lg text-xs">
                  <div className="absolute inset-0 bg-emerald-500/10 rounded-lg" style={{ width: `${(cnt / maxG) * 100}%` }} />
                  <div className="relative flex items-center justify-between">
                    <span className="text-white/40 truncate max-w-[120px]">{g.zone}</span>
                    <span className="text-emerald-400/80 font-bold">{cnt.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTTOM LEFT — REAL-TIME FEED */}
        <div className="col-span-4 row-span-2 lg-card lg-card-cyan rounded-xl p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-yellow-400/70" />
            <span className="text-xs font-bold text-cyan-400/80 tracking-widest">REAL-TIME (5 MIN)</span>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div className="lg-metric rounded-xl p-3 flex flex-col items-center justify-center bg-gradient-to-br from-cyan-500/8 to-transparent">
              <span className="text-3xl font-bold text-white/80">{num(realtime?.alert_count).toLocaleString()}</span>
              <span className="text-[10px] text-white/20 tracking-widest">ALERTS</span>
            </div>
            <div className="lg-metric rounded-xl p-3 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500/8 to-transparent">
              <span className="text-3xl font-bold text-emerald-400/80">{num(realtime?.active_vehicles).toLocaleString()}</span>
              <span className="text-[10px] text-white/20 tracking-widest">ACTIVE VEHICLES</span>
            </div>
          </div>
        </div>

        {/* BOTTOM RIGHT — ALERT BREAKDOWN */}
        <div className="col-span-8 row-span-2 lg-card lg-card-cyan rounded-xl p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-cyan-400/70" />
            <span className="text-xs font-bold text-cyan-400/80 tracking-widest">ALERT BREAKDOWN (LAST HOUR)</span>
          </div>
          <div className="flex-1 grid grid-cols-5 gap-2">
            {summary?.alertBreakdown.slice(0, 10).map((a, i) => {
              const cnt = num(a.count);
              return (
                <div key={i} className={`lg-metric rounded-xl p-2 text-center ${
                  a.category === 'critical' ? 'bg-gradient-to-br from-red-500/10 to-transparent border-red-500/15' :
                  a.category === 'warning' ? 'bg-gradient-to-br from-amber-500/10 to-transparent border-amber-500/15' :
                  a.category === 'geofence' ? 'bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/15' :
                  'bg-gradient-to-br from-white/5 to-transparent'
                }`}>
                  <div className="text-lg font-bold text-white/80">{cnt.toLocaleString()}</div>
                  <div className="text-[9px] text-white/25 truncate" title={a.name}>{a.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* BOTTOM STATUS BAR */}
      <footer className="lg-footer h-6 flex items-center justify-between px-4 text-[10px] text-white/20 flex-shrink-0 relative z-10">
        <span>iTECKNOLOGI COMMAND CENTER | {currentTime.toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Karachi' })}</span>
        <div className="flex items-center gap-4">
          {lastUpdate && <span>LAST SYNC: {formatTime(lastUpdate)}</span>}
          <span className="text-emerald-400/60">SYSTEM ONLINE</span>
        </div>
      </footer>
    </div>
  );
}

function MetricCard({ label, value, icon, color, pulse }: { 
  label: string; 
  value: number; 
  icon: React.ReactNode; 
  color: 'cyan' | 'blue' | 'red' | 'amber' | 'emerald';
  pulse?: boolean;
}) {
  const accents: Record<string, string> = {
    cyan:    'from-cyan-500/10 border-cyan-500/15 text-cyan-400/70',
    blue:    'from-blue-500/10 border-blue-500/15 text-blue-400/70',
    red:     'from-red-500/10 border-red-500/15 text-red-400/70',
    amber:   'from-amber-500/10 border-amber-500/15 text-amber-400/70',
    emerald: 'from-emerald-500/10 border-emerald-500/15 text-emerald-400/70',
  };
  
  return (
    <div className={`lg-metric rounded-xl bg-gradient-to-br ${accents[color]} to-transparent p-3 flex flex-col ${pulse ? 'animate-pulse' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={accents[color].split(' ').pop()}>{icon}</span>
        {pulse && <span className="w-2 h-2 bg-red-500 rounded-full animate-ping" />}
      </div>
      <span className="text-2xl font-bold text-white/80">{value.toLocaleString()}</span>
      <span className="text-[9px] text-white/25 tracking-widest">{label}</span>
    </div>
  );
}

function FleetStat({ label, value, pct, color }: { label: string; value: number; pct: string; color: string }) {
  const colorClass = color === 'emerald' ? 'text-emerald-400/70' : color === 'blue' ? 'text-blue-400/70' : 'text-white/30';
  const bgClass = color === 'emerald' ? 'bg-emerald-500' : color === 'blue' ? 'bg-blue-500' : 'bg-gray-600';
  
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${bgClass} shadow-sm`} style={{ boxShadow: color !== 'gray' ? `0 0 6px ${color === 'emerald' ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.4)'}` : 'none' }} />
      <span className="text-[10px] text-white/25 w-14">{label}</span>
      <span className={`text-sm font-bold ${colorClass}`}>{value.toLocaleString()}</span>
      <span className="text-[10px] text-white/15">({pct}%)</span>
    </div>
  );
}
