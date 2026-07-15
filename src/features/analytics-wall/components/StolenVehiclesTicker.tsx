/**
 * Stolen Vehicles Ticker Component
 * Scrolling ticker showing active stolen vehicle cases
 */

import { motion } from 'framer-motion';
import { AlertTriangle, Radio, Gauge } from 'lucide-react';

interface StolenVehicle {
  id: number;
  vehicle_reg: string;
  priority: number;
  last_speed: number | string;
  total_distance_km: string | number;
  last_update: string;
  customer_name?: string;
}

interface StolenVehiclesTickerProps {
  vehicles: StolenVehicle[];
}

export default function StolenVehiclesTicker({ vehicles }: StolenVehiclesTickerProps) {
  if (!vehicles || vehicles.length === 0) {
    return null;
  }
  
  const priorityColors = {
    1: { bg: 'bg-red-500/20', border: 'border-red-500/50', text: 'text-red-400' },
    2: { bg: 'bg-amber-500/20', border: 'border-amber-500/50', text: 'text-amber-400' },
    3: { bg: 'bg-blue-500/20', border: 'border-blue-500/50', text: 'text-blue-400' },
  };
  
  return (
    <div className="bg-gradient-to-r from-red-900/30 via-red-800/20 to-red-900/30 rounded-xl p-3 border border-red-500/30">
      <div className="flex items-center gap-2 mb-2">
        <Radio className="w-4 h-4 text-red-400 animate-pulse" />
        <span className="text-sm font-semibold text-red-400">STOLEN VEHICLES - ACTIVE TRACKING</span>
        <span className="ml-auto text-xs text-gray-400">{vehicles.length} active</span>
      </div>
      
      <div className="flex gap-3 overflow-x-auto pb-1">
        {vehicles.map((vehicle) => {
          const colors = priorityColors[vehicle.priority as 1 | 2 | 3] || priorityColors[3];
          const distance = parseFloat(String(vehicle.total_distance_km || 0));
          
          return (
            <motion.div
              key={vehicle.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`
                flex-shrink-0 p-3 rounded-lg ${colors.bg} border ${colors.border}
                min-w-[200px]
              `}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-4 h-4 ${colors.text}`} />
                <span className="font-bold text-white">{vehicle.vehicle_reg}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} font-bold`}>
                  P{vehicle.priority}
                </span>
              </div>
              
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-gray-400">
                  <Gauge className="w-3 h-3" />
                  <span>{parseInt(String(vehicle.last_speed)) || 0} km/h</span>
                </div>
                <div className="text-gray-400">
                  {distance.toFixed(1)} km tracked
                </div>
              </div>
              
              {vehicle.customer_name && (
                <div className="text-xs text-gray-500 mt-1 truncate">
                  {vehicle.customer_name}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
