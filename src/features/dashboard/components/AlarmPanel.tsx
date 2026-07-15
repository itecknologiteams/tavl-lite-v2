import { motion } from 'framer-motion';
import { AlertTriangle, Clock, CheckCircle, X, MapPin, Calendar } from 'lucide-react';
import { useAlarmStore } from '@store/alarmStore';
import { useAlarms } from '@hooks/useAlarms';
import { format } from 'date-fns';

export default function AlarmPanel() {
  const alarms = useAlarmStore((state) => state.alarms);
  const { acknowledgeAlarm } = useAlarms();

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-500/20 border-red-500 text-red-400',
      high: 'bg-orange-500/20 border-orange-500 text-orange-400',
      medium: 'bg-amber-500/20 border-amber-500 text-amber-400',
      low: 'bg-blue-500/20 border-blue-500 text-blue-400',
    };
    return colors[severity] || colors.low;
  };

  const unacknowledgedAlarms = alarms.filter((a) => !a.acknowledged);
  const acknowledgedAlarms = alarms.filter((a) => a.acknowledged);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-glass-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Alarms</h2>
          <span className="px-2 py-1 bg-red-500/20 rounded-full text-xs text-red-400 font-medium">
            {unacknowledgedAlarms.length} Active
          </span>
        </div>
        <div className="flex gap-2 text-xs">
          <button className="glass-button px-3 py-1.5 rounded-lg text-white">
            All ({alarms.length})
          </button>
          <button className="glass-button px-3 py-1.5 rounded-lg text-slate-400">
            Unacked ({unacknowledgedAlarms.length})
          </button>
        </div>
      </div>

      {/* Alarm List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {alarms.length === 0 ? (
          <div className="text-center py-12">
            <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No alarms</p>
          </div>
        ) : (
          <>
            {/* Unacknowledged Alarms */}
            {unacknowledgedAlarms.map((alarm, index) => (
              <motion.div
                key={alarm.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`glass-panel rounded-xl p-4 border ${getSeverityColor(alarm.severity)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-2 flex-1">
                    <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm">{alarm.alarmType}</h3>
                      <p className="text-xs text-slate-400">{alarm.vehicleName}</p>
                      {alarm.description && (
                        <p className="text-xs text-slate-300 mt-1">{alarm.description}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{format(alarm.occurredAt, 'HH:mm:ss')}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>{format(alarm.occurredAt, 'MMM dd')}</span>
                  </div>
                </div>

                {alarm.latitude !== 0 && alarm.longitude !== 0 && (
                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-3">
                    <MapPin className="w-3 h-3" />
                    <span>
                      {alarm.latitude.toFixed(4)}, {alarm.longitude.toFixed(4)}
                    </span>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => acknowledgeAlarm(alarm.id)}
                    className="flex-1 glass-button py-1.5 rounded-lg text-xs hover:glow-success transition-all flex items-center justify-center gap-1"
                  >
                    <CheckCircle className="w-3 h-3" />
                    Acknowledge
                  </button>
                  <button className="glass-button px-3 py-1.5 rounded-lg text-xs hover:glow-primary transition-all">
                    View
                  </button>
                </div>
              </motion.div>
            ))}

            {/* Acknowledged Alarms */}
            {acknowledgedAlarms.length > 0 && (
              <div className="pt-4 border-t border-glass-100">
                <p className="text-xs text-slate-500 mb-3">Acknowledged</p>
                {acknowledgedAlarms.slice(0, 5).map((alarm) => (
                  <div
                    key={alarm.id}
                    className="glass-input rounded-lg p-3 mb-2 opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-sm text-white">{alarm.alarmType}</h3>
                        <p className="text-xs text-slate-400">{alarm.vehicleName}</p>
                      </div>
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
