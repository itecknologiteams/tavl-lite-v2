/**
 * Tracking Status Bar — Liquid Glass
 * Bottom status bar showing connection status, last update, and system info
 */

import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Clock, Database, Server } from 'lucide-react';

interface Props {
  vehicleCount: number;
  connected: boolean;
  lastUpdate: Date | null;
}

export default function TrackingStatusBar({ vehicleCount, connected, lastUpdate }: Props) {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  
  const formatLastUpdate = () => {
    if (!lastUpdate) return 'Never';
    const diff = Math.floor((currentTime.getTime() - lastUpdate.getTime()) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return lastUpdate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  };
  
  return (
    <footer className="lg-footer flex-shrink-0 h-10 px-6 flex items-center justify-between text-xs relative z-10">
      {/* Left */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          {connected ? (
            <Wifi className="w-4 h-4 text-emerald-400/60" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-400/60 animate-pulse" />
          )}
          <span className={connected ? 'text-emerald-400/60' : 'text-red-400/60'}>
            {connected ? 'WebSocket Connected' : 'Reconnecting...'}
          </span>
        </div>
        
        <div className="flex items-center gap-2 text-white/20">
          <Database className="w-4 h-4" />
          <span>Last update: {formatLastUpdate()}</span>
        </div>
        
        <div className="flex items-center gap-2 text-white/20">
          <Server className="w-4 h-4" />
          <span>Tracking {vehicleCount}/10 vehicles</span>
        </div>
      </div>
      
      {/* Right */}
      <div className="flex items-center gap-6">
        <div className="text-white/20">
          {currentTime.toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/20" />
          <span className="font-mono text-white/50 text-sm">
            {currentTime.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
        </div>
        
        <div className="text-white/15">
          iTecknologi • Stolen Vehicle Tracking
        </div>
      </div>
    </footer>
  );
}
