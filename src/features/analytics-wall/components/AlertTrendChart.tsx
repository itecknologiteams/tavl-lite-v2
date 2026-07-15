/**
 * Alert Trend Chart Component
 * Displays 24-hour alert trend as a bar chart using pure CSS/HTML
 */

import { useMemo } from 'react';

interface HourlyData {
  hour: string;
  critical: number | string;
  warning: number | string;
  geofence: number | string;
  total: number | string;
}

interface AlertTrendChartProps {
  data: HourlyData[];
}

export default function AlertTrendChart({ data }: AlertTrendChartProps) {
  const { chartData, maxValue } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], maxValue: 100 };
    }
    
    // Process data with hour labels - parse all numeric values
    const processed = data.map(d => {
      const date = new Date(d.hour);
      const critical = parseInt(String(d.critical)) || 0;
      const warning = parseInt(String(d.warning)) || 0;
      const geofence = parseInt(String(d.geofence)) || 0;
      
      return {
        ...d,
        critical,
        warning,
        geofence,
        total: critical + warning + geofence,
        label: date.getHours().toString().padStart(2, '0'),
        fullLabel: date.toLocaleTimeString('en-PK', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Karachi'
        }),
      };
    });
    
    // Find max value for scaling
    const max = Math.max(...processed.map(d => d.total), 1);
    
    return { chartData: processed, maxValue: max };
  }, [data]);
  
  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        No data available
      </div>
    );
  }
  
  return (
    <div className="h-[calc(100%-2rem)] flex flex-col">
      {/* Chart area */}
      <div className="flex-1 flex items-end gap-1 pb-6">
        {chartData.map((item, idx) => {
          const criticalHeight = (item.critical / maxValue) * 100;
          const warningHeight = (item.warning / maxValue) * 100;
          const geofenceHeight = (item.geofence / maxValue) * 100;
          const total = item.critical + item.warning + item.geofence;
          
          return (
            <div
              key={idx}
              className="flex-1 flex flex-col items-center group relative"
            >
              {/* Stacked Bar */}
              <div className="w-full flex flex-col-reverse items-center h-full justify-end">
                {item.critical > 0 && (
                  <div
                    className="w-full bg-gradient-to-t from-red-600 to-red-500 rounded-t transition-all duration-300"
                    style={{ height: `${criticalHeight}%`, minHeight: item.critical > 0 ? '4px' : 0 }}
                  />
                )}
                {item.warning > 0 && (
                  <div
                    className="w-full bg-gradient-to-t from-amber-600 to-amber-500 transition-all duration-300"
                    style={{ height: `${warningHeight}%`, minHeight: item.warning > 0 ? '4px' : 0 }}
                  />
                )}
                {item.geofence > 0 && (
                  <div
                    className={`w-full bg-gradient-to-t from-emerald-600 to-emerald-500 transition-all duration-300 ${
                      item.critical === 0 && item.warning === 0 ? 'rounded-t' : ''
                    }`}
                    style={{ height: `${geofenceHeight}%`, minHeight: item.geofence > 0 ? '4px' : 0 }}
                  />
                )}
              </div>
              
              {/* Hour label */}
              <div className="absolute -bottom-5 text-[10px] text-gray-500">
                {item.label}
              </div>
              
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 shadow-xl text-xs whitespace-nowrap">
                  <div className="font-semibold text-white mb-1">{item.fullLabel}</div>
                  <div className="flex items-center gap-2 text-red-400">
                    <span className="w-2 h-2 bg-red-500 rounded" />
                    Critical: {item.critical}
                  </div>
                  <div className="flex items-center gap-2 text-amber-400">
                    <span className="w-2 h-2 bg-amber-500 rounded" />
                    Warning: {item.warning}
                  </div>
                  <div className="flex items-center gap-2 text-emerald-400">
                    <span className="w-2 h-2 bg-emerald-500 rounded" />
                    Geofence: {item.geofence}
                  </div>
                  <div className="border-t border-gray-700 mt-1 pt-1 text-white font-semibold">
                    Total: {total}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* X-axis line */}
      <div className="h-px bg-gray-700 -mt-5" />
    </div>
  );
}
