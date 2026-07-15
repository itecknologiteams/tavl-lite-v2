/**
 * Top Alerting Vehicles Component
 * Shows vehicles generating the most alerts
 */

import { Car, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface VehicleData {
  objectid: number;
  vehicle_name: string;
  alert_count: number | string;
  critical_count: number | string;
  last_alert: string;
}

interface TopAlertingVehiclesProps {
  data: VehicleData[];
}

export default function TopAlertingVehicles({ data }: TopAlertingVehiclesProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-black/30 rounded-xl p-4 border border-white/10 flex-1">
        <div className="flex items-center gap-2 mb-3">
          <Car className="w-5 h-5 text-blue-400" />
          <span className="font-semibold text-white">Top Alerting Vehicles (24h)</span>
        </div>
        <div className="text-center text-gray-500 py-8">
          No vehicle data available
        </div>
      </div>
    );
  }
  
  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };
  
  return (
    <div className="bg-black/30 rounded-xl p-4 border border-white/10 flex-1 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <Car className="w-5 h-5 text-blue-400" />
        <span className="font-semibold text-white">Top Alerting Vehicles (24h)</span>
      </div>
      
      <div className="space-y-2 overflow-y-auto max-h-[calc(100%-3rem)]">
        {data.slice(0, 8).map((vehicle, idx) => {
          const alertCount = parseInt(String(vehicle.alert_count)) || 0;
          const criticalCount = parseInt(String(vehicle.critical_count)) || 0;
          
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`
                p-2 rounded-lg flex items-center justify-between
                ${criticalCount > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-white/5 border border-white/10'}
              `}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${idx === 0 ? 'bg-yellow-500 text-black' : 
                    idx === 1 ? 'bg-gray-400 text-black' : 
                    idx === 2 ? 'bg-amber-700 text-white' : 
                    'bg-white/10 text-gray-400'}
                `}>
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate" title={vehicle.vehicle_name}>
                    {vehicle.vehicle_name}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Last: {formatTimeAgo(vehicle.last_alert)}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {criticalCount > 0 && (
                  <div className="flex items-center gap-1 text-red-400">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="text-xs font-bold">{criticalCount}</span>
                  </div>
                )}
                <div className="text-right">
                  <div className="text-lg font-bold text-blue-400">{alertCount}</div>
                  <div className="text-[10px] text-gray-500">alerts</div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
