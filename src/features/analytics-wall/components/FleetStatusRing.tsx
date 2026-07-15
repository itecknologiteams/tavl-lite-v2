/**
 * Fleet Status Ring Component
 * Circular visualization of fleet status
 */

import { Car, CircleDot, Pause, WifiOff } from 'lucide-react';

interface FleetData {
  status: {
    total_vehicles: number;
    moving: number;
    parked: number;
    offline: number;
  };
  speedDistribution: { speed_range: string; vehicle_count: number }[];
}

interface FleetStatusRingProps {
  data: FleetData;
}

export default function FleetStatusRing({ data }: FleetStatusRingProps) {
  const { status, speedDistribution } = data;
  
  const total = parseInt(String(status.total_vehicles)) || 0;
  const moving = parseInt(String(status.moving)) || 0;
  const parked = parseInt(String(status.parked)) || 0;
  const offline = parseInt(String(status.offline)) || 0;
  
  // Calculate percentages for the ring
  const movingPct = total > 0 ? (moving / total) * 100 : 0;
  const parkedPct = total > 0 ? (parked / total) * 100 : 0;
  const offlinePct = total > 0 ? (offline / total) * 100 : 0;
  
  // SVG ring calculations
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  
  const movingOffset = 0;
  const parkedOffset = (movingPct / 100) * circumference;
  const offlineOffset = ((movingPct + parkedPct) / 100) * circumference;
  
  return (
    <div className="bg-black/30 rounded-xl p-4 border border-white/10 flex-1">
      <div className="flex items-center gap-2 mb-3">
        <Car className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-white">Fleet Status</span>
      </div>
      
      <div className="flex items-center gap-4">
        {/* Ring Chart */}
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            {/* Background circle */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="10"
            />
            
            {/* Moving segment */}
            {movingPct > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="#22c55e"
                strokeWidth="10"
                strokeDasharray={`${(movingPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-movingOffset}
                strokeLinecap="round"
              />
            )}
            
            {/* Parked segment */}
            {parkedPct > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="10"
                strokeDasharray={`${(parkedPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-parkedOffset}
                strokeLinecap="round"
              />
            )}
            
            {/* Offline segment */}
            {offlinePct > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="#6b7280"
                strokeWidth="10"
                strokeDasharray={`${(offlinePct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-offlineOffset}
                strokeLinecap="round"
              />
            )}
          </svg>
          
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white">{total.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">VEHICLES</span>
          </div>
        </div>
        
        {/* Legend */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleDot className="w-3 h-3 text-emerald-500" />
              <span className="text-xs text-gray-400">Moving</span>
            </div>
            <span className="text-sm font-bold text-emerald-400">{moving.toLocaleString()}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pause className="w-3 h-3 text-blue-500" />
              <span className="text-xs text-gray-400">Parked</span>
            </div>
            <span className="text-sm font-bold text-blue-400">{parked.toLocaleString()}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WifiOff className="w-3 h-3 text-gray-500" />
              <span className="text-xs text-gray-400">Offline</span>
            </div>
            <span className="text-sm font-bold text-gray-400">{offline.toLocaleString()}</span>
          </div>
        </div>
      </div>
      
      {/* Speed Distribution */}
      {speedDistribution && speedDistribution.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="text-[10px] text-gray-500 mb-2">Speed Distribution</div>
          <div className="flex flex-wrap gap-1">
            {speedDistribution.map((speed, idx) => (
              <div
                key={idx}
                className="text-[10px] px-2 py-1 bg-white/5 rounded text-gray-400"
              >
                {speed.speed_range}: <span className="text-white font-medium">{speed.vehicle_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
