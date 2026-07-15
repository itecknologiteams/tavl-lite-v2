import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Car,
  Activity,
  MapPin,
  AlertTriangle,
  Clock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useVehicleStore } from '@store/vehicleStore';
import { useAlarmStore } from '@store/alarmStore';

export default function StatusCards() {
  const vehicles = useVehicleStore((state) => state.vehicles);
  const unacknowledgedCount = useAlarmStore((state) => state.unacknowledgedCount);

  // Calculate status counts
  const statusCounts = useMemo(() => {
    const counts = {
      total: vehicles.size,
      moving: 0,
      idle: 0,
      parked: 0,
      offline: 0,
      gpsInvalid: 0,
    };

    vehicles.forEach((vehicle) => {
      switch (vehicle.status) {
        case 'moving':
          counts.moving++;
          break;
        case 'idle':
          counts.idle++;
          break;
        case 'parked':
          counts.parked++;
          break;
        case 'offline':
          counts.offline++;
          break;
        case 'gps-invalid':
          counts.gpsInvalid++;
          break;
      }
    });

    return counts;
  }, [vehicles]);

  const stats = [
    {
      label: 'Total Vehicles',
      value: statusCounts.total.toLocaleString(),
      icon: Car,
      color: 'text-primary-400',
      bgColor: 'bg-primary-500/10',
      glow: 'glow-primary',
    },
    {
      label: 'Moving',
      value: statusCounts.moving.toLocaleString(),
      icon: Activity,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      glow: 'glow-success',
    },
    {
      label: 'Idle',
      value: statusCounts.idle.toLocaleString(),
      icon: Clock,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      glow: 'glow-warning',
    },
    {
      label: 'Parked',
      value: statusCounts.parked.toLocaleString(),
      icon: MapPin,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      glow: 'glow-primary',
    },
    {
      label: 'Offline',
      value: statusCounts.offline.toLocaleString(),
      icon: WifiOff,
      color: 'text-slate-400',
      bgColor: 'bg-slate-500/10',
    },
    {
      label: 'Alarms',
      value: unacknowledgedCount.toLocaleString(),
      icon: AlertTriangle,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      glow: unacknowledgedCount > 0 ? 'glow-danger' : '',
    },
  ];

  return (
    <div className="grid grid-cols-6 gap-4 p-4">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className={`glass-panel rounded-xl p-4 ${stat.glow || ''} hover:scale-105 transition-transform cursor-pointer`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className={`${stat.bgColor} p-2 rounded-lg`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
          <div className="text-xs text-slate-400">{stat.label}</div>
        </motion.div>
      ))}
    </div>
  );
}
