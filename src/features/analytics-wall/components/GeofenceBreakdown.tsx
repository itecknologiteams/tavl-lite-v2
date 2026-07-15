/**
 * Geofence Breakdown Component
 * Shows alert counts by geographic zone
 */

import { MapPin } from 'lucide-react';
import { motion } from 'framer-motion';

interface GeofenceData {
  zone: string;
  count: number | string;
}

interface GeofenceBreakdownProps {
  data: GeofenceData[];
}

export default function GeofenceBreakdown({ data }: GeofenceBreakdownProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-black/30 rounded-xl p-4 border border-white/10 flex-1">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-5 h-5 text-emerald-400" />
          <span className="font-semibold text-white">Geofence Alerts (24h)</span>
        </div>
        <div className="text-center text-gray-500 py-8">
          No geofence data available
        </div>
      </div>
    );
  }
  
  const maxCount = Math.max(...data.map(d => parseInt(String(d.count)) || 0));
  
  return (
    <div className="bg-black/30 rounded-xl p-4 border border-white/10 flex-1 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-5 h-5 text-emerald-400" />
        <span className="font-semibold text-white">Geofence Alerts (24h)</span>
      </div>
      
      <div className="space-y-2 overflow-y-auto max-h-[calc(100%-3rem)]">
        {data.slice(0, 10).map((item, idx) => {
          const count = parseInt(String(item.count)) || 0;
          const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
          
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative"
            >
              {/* Background bar */}
              <div
                className="absolute inset-0 bg-emerald-500/20 rounded"
                style={{ width: `${percentage}%` }}
              />
              
              {/* Content */}
              <div className="relative flex items-center justify-between p-2">
                <span className="text-sm text-gray-300 truncate max-w-[70%]" title={item.zone}>
                  {item.zone}
                </span>
                <span className="text-sm font-bold text-emerald-400">
                  {count.toLocaleString()}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
