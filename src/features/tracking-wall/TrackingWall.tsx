/**
 * Stolen Vehicle Tracking Wall — Liquid Glass
 * Video wall optimized display for tracking stolen vehicles in real-time
 * No authentication required — designed for command center displays
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Wifi,
  WifiOff,
  Car,
  MapPin,
  Clock,
  Maximize,
  Volume2,
  VolumeX,
} from 'lucide-react';
import TrackedVehicleCard from './components/TrackedVehicleCard';
import TrackingStatusBar from './components/TrackingStatusBar';

interface TrackedVehicle {
  id: number;
  vehicle_id: number;
  object_id: number;
  vehicle_reg: string;
  vehicle_desc?: string;
  customer_name?: string;
  customer_phone?: string;
  marked_by?: string;
  marked_at: string;
  priority: number;
  case_number?: string;
  notes?: string;
  status: string;
  last_lat?: number | string;
  last_lon?: number | string;
  last_speed: number;
  last_heading: number;
  last_address?: string;
  last_update?: string;
  total_distance_km: number | string;
  sms_alerts_enabled: boolean;
  sms_phone_number?: string;
}

interface LocationUpdate {
  id: number;
  vehicle_reg: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  address?: string;
  total_distance_km: number;
  last_update: string;
}

export default function TrackingWall() {
  const [vehicles, setVehicles] = useState<TrackedVehicle[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alerts, setAlerts] = useState<string[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const fetchVehicles = useCallback(async () => {
    try {
      const response = await fetch('/api/stolen-tracking/active');
      const data = await response.json();
      
      if (data.success) {
        setVehicles(data.data);
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch stolen vehicles:', error);
    }
  }, []);
  
  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('🔌 Tracking Wall WebSocket connected');
        setConnected(true);
        ws.send(JSON.stringify({ type: 'identify', agentId: 'tracking-wall', role: 'tracking-wall' }));
      };
      
      ws.onmessage = (event) => {
        try { handleWebSocketMessage(JSON.parse(event.data)); } catch {}
      };
      
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };
      
      ws.onerror = () => {};
    } catch {
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    }
  }, []);
  
  const handleWebSocketMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'stolen:added':
        setVehicles(prev => {
          if (prev.some(v => v.id === message.data.id)) return prev;
          return [...prev, message.data].sort((a, b) => a.priority - b.priority);
        });
        playAlertSound();
        addAlert(`🚨 New vehicle added: ${message.data.vehicle_reg}`);
        break;
      case 'stolen:removed':
        setVehicles(prev => prev.filter(v => v.id !== message.data.id));
        addAlert(`✅ Vehicle removed: ${message.data.vehicle_reg} (${message.data.status})`);
        break;
      case 'stolen:updated':
        setVehicles(prev => prev.map(v => v.id === message.data.id ? { ...v, ...message.data } : v));
        break;
      case 'stolen:location':
        const update = message.data as LocationUpdate;
        setVehicles(prev => prev.map(v =>
          v.id === update.id ? {
            ...v, last_lat: update.lat, last_lon: update.lon, last_speed: update.speed,
            last_heading: update.heading, last_address: update.address,
            total_distance_km: update.total_distance_km, last_update: update.last_update,
          } : v
        ));
        setLastUpdate(new Date());
        break;
      case 'stolen:alert':
        playAlertSound();
        addAlert(`⚠️ ${message.data.message}`);
        break;
    }
  }, []);
  
  const playAlertSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.2);
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.4);
    } catch {}
  }, [soundEnabled]);
  
  const addAlert = useCallback((message: string) => {
    setAlerts(prev => [message, ...prev].slice(0, 5));
    setTimeout(() => { setAlerts(prev => prev.filter(a => a !== message)); }, 10000);
  }, []);
  
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen(); }
    else { document.exitFullscreen(); }
  }, []);
  
  useEffect(() => {
    fetchVehicles();
    connectWebSocket();
    const refreshInterval = setInterval(fetchVehicles, 30000);
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try { if ('wakeLock' in navigator) { wakeLock = await (navigator as any).wakeLock.request('screen'); } } catch {}
    };
    requestWakeLock();
    return () => {
      clearInterval(refreshInterval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
      if (wakeLock) wakeLock.release();
    };
  }, [fetchVehicles, connectWebSocket]);
  
  const getGridClass = () => {
    const count = vehicles.length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 2) return 'grid-cols-2';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 6) return 'grid-cols-3';
    return 'grid-cols-4 xl:grid-cols-5';
  };
  
  return (
    <div className="lg-page-bg w-full h-screen flex flex-col overflow-hidden">
      {/* Ambient blobs — red-tinted for urgency */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="lg-page-blob" style={{ width: 600, height: 600, background: 'radial-gradient(circle, rgba(239,68,68,0.08) 0%, transparent 70%)', top: '-15%', left: '-10%' }} />
        <div className="lg-page-blob" style={{ width: 450, height: 450, background: 'radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)', bottom: '-10%', right: '-10%', animationDelay: '10s' }} />
        <div className="lg-page-blob" style={{ width: 300, height: 300, background: 'radial-gradient(circle, rgba(239,68,68,0.05) 0%, transparent 70%)', top: '40%', left: '60%', animationDelay: '15s' }} />
      </div>

      <div className="absolute inset-0 login-grid-bg pointer-events-none z-0" />

      {/* Header */}
      <header className="lg-header flex-shrink-0 h-16 px-6 flex items-center justify-between relative z-20" style={{ borderBottomColor: 'rgba(239,68,68,0.12)' }}>
        {/* Left — Title */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logot.png" alt="iTecknologi" className="h-10 w-auto drop-shadow-[0_0_12px_rgba(239,68,68,0.2)]" />
            <div className="h-8 w-px bg-red-500/15" />
            <div>
              <h1 className="text-2xl font-bold text-white/90 leading-none">STOLEN VEHICLE TRACKING</h1>
              <p className="text-sm text-red-400/50 uppercase tracking-wider">Command Center - Live Monitoring</p>
            </div>
          </div>
        </div>
        
        {/* Center — Stats */}
        <div className="flex items-center gap-8">
          <div className="lg-chip flex items-center gap-3 px-4 py-2 rounded-xl border-red-500/15 bg-red-500/8">
            <Car className="w-6 h-6 text-red-400/70" />
            <div>
              <div className="text-3xl font-bold text-red-400/80">{vehicles.length}</div>
              <div className="text-xs text-white/20 uppercase">Tracking</div>
            </div>
          </div>
          
          <div className="lg-chip flex items-center gap-3 px-4 py-2 rounded-xl border-amber-500/15 bg-amber-500/8">
            <MapPin className="w-6 h-6 text-amber-400/70" />
            <div>
              <div className="text-3xl font-bold text-amber-400/80">
                {vehicles.filter(v => v.last_speed > 0).length}
              </div>
              <div className="text-xs text-white/20 uppercase">Moving</div>
            </div>
          </div>
        </div>
        
        {/* Right — Controls */}
        <div className="flex items-center gap-4">
          <div className={`lg-chip flex items-center gap-2 px-3 py-2 rounded-xl ${
            connected ? 'border-emerald-500/15 bg-emerald-500/8' : 'border-red-500/15 bg-red-500/8'
          }`}>
            {connected ? (
              <Wifi className="w-5 h-5 text-emerald-400/70" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-400/70 animate-pulse" />
            )}
            <span className={`text-sm font-medium ${connected ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              {connected ? 'CONNECTED' : 'RECONNECTING...'}
            </span>
          </div>
          
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`lg-icon-btn p-2.5 rounded-xl ${
              soundEnabled ? 'text-emerald-400/60 border-emerald-500/15 bg-emerald-500/8' : 'text-white/20'
            }`}
            title={soundEnabled ? 'Sound On' : 'Sound Off'}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          
          <button
            onClick={toggleFullscreen}
            className="lg-icon-btn p-2.5 rounded-xl text-white/25 hover:text-white/50"
            title="Toggle Fullscreen"
          >
            <Maximize className="w-5 h-5" />
          </button>
          
          <div className="lg-chip flex items-center gap-2 px-4 py-2 rounded-xl">
            <Clock className="w-5 h-5 text-white/25" />
            <span className="text-xl font-mono text-white/70">
              {new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </span>
          </div>
        </div>
      </header>
      
      {/* Alert Banner */}
      <AnimatePresence>
        {alerts.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-10 overflow-hidden"
            style={{ background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.12)' }}
          >
            <div className="px-6 py-2 flex items-center gap-4">
              <AlertTriangle className="w-5 h-5 text-red-400/60 flex-shrink-0 animate-pulse" />
              <div className="flex-1 overflow-hidden">
                {alerts.map((alert, i) => (
                  <motion.div
                    key={alert + i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-sm text-red-300/70"
                  >
                    {alert}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Main Content */}
      <div className="flex-1 p-4 overflow-hidden relative z-10">
        {vehicles.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center lg-empty-state rounded-2xl p-12">
              <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center">
                <Car className="w-12 h-12 text-white/15" />
              </div>
              <h2 className="text-2xl font-bold text-white/40 mb-2">No Vehicles Being Tracked</h2>
              <p className="text-white/15 max-w-md">
                When a supervisor marks a vehicle as stolen, it will appear here for real-time monitoring.
              </p>
            </div>
          </div>
        ) : (
          <div className={`grid ${getGridClass()} gap-4 h-full auto-rows-fr`}>
            {vehicles.map((vehicle) => (
              <TrackedVehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        )}
      </div>
      
      <TrackingStatusBar vehicleCount={vehicles.length} connected={connected} lastUpdate={lastUpdate} />
    </div>
  );
}
