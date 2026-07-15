/**
 * Live Activity Feed Component
 * Shows real-time activity stream from all agents
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  User,
  Bell,
  Phone,
  CheckCircle,
  AlertTriangle,
  LogIn,
  LogOut,
  ArrowUp,
  Clock,
} from 'lucide-react';
import { useSupervisorStore, type ActivityLog } from '@store/supervisorStore';

export function LiveActivityFeed() {
  const activityLog = useSupervisorStore((state) => state.activityLog);
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new activity arrives
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [activityLog.length]);

  return (
    <div className="h-full p-6 overflow-hidden">
      <div className="h-full bg-slate-900/50 rounded-xl border border-white/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-violet-400" />
            <h3 className="font-medium text-white">Live Activity Feed</h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
        </div>

        {/* Activity List */}
        <div ref={feedRef} className="h-[calc(100%-52px)] overflow-auto">
          <AnimatePresence initial={false}>
            {activityLog.map((activity, index) => (
              <ActivityItem 
                key={activity.id} 
                activity={activity} 
                isNew={index === 0}
              />
            ))}
          </AnimatePresence>

          {activityLog.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Activity className="w-12 h-12 mb-3 opacity-50" />
              <span>No activity yet</span>
              <span className="text-sm">Activities will appear here in real-time</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ activity, isNew }: { activity: ActivityLog; isNew: boolean }) {
  const getIcon = () => {
    switch (activity.action) {
      case 'login':
        return <LogIn className="w-4 h-4 text-emerald-400" />;
      case 'logout':
        return <LogOut className="w-4 h-4 text-red-400" />;
      case 'alert_assigned':
        return <Bell className="w-4 h-4 text-violet-400" />;
      case 'alert_acknowledged':
        return <Bell className="w-4 h-4 text-blue-400" />;
      case 'alert_resolved':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'call_made':
      case 'call_ended':
        return <Phone className="w-4 h-4 text-blue-400" />;
      case 'status_change':
        return <User className="w-4 h-4 text-amber-400" />;
      case 'escalation':
        return <ArrowUp className="w-4 h-4 text-red-400" />;
      default:
        return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  const getBgColor = () => {
    switch (activity.action) {
      case 'login':
        return 'bg-emerald-500/10';
      case 'logout':
        return 'bg-red-500/10';
      case 'alert_resolved':
        return 'bg-emerald-500/10';
      case 'escalation':
        return 'bg-red-500/10';
      case 'alert_assigned':
        return 'bg-violet-500/10';
      default:
        return 'bg-slate-800/50';
    }
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <motion.div
      initial={isNew ? { opacity: 0, x: -20, backgroundColor: 'rgba(139, 92, 246, 0.2)' } : false}
      animate={{ opacity: 1, x: 0, backgroundColor: 'transparent' }}
      transition={{ duration: 0.3 }}
      className={`flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
        isNew ? 'bg-violet-500/10' : ''
      }`}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 p-2 rounded-lg ${getBgColor()}`}>
        {getIcon()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {activity.agentName && (
            <span className="font-medium text-white text-sm">{activity.agentName}</span>
          )}
          {activity.vehiclePlate && (
            <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">
              {activity.vehiclePlate}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">{activity.details}</p>
      </div>

      {/* Time */}
      <div className="flex-shrink-0 flex items-center gap-1 text-xs text-slate-500">
        <Clock className="w-3 h-3" />
        {formatTime(activity.timestamp)}
      </div>
    </motion.div>
  );
}
