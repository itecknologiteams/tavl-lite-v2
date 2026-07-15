/**
 * Alert Queue Component
 * Shows pending alerts that can be assigned to agents
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  AlertTriangle,
  Clock,
  User,
  Phone,
  Car,
  ChevronRight,
  UserPlus,
  CheckCircle,
  X,
  ArrowUp,
} from 'lucide-react';
import { useSupervisorStore, type SupervisorAlert, type Agent } from '@store/supervisorStore';

export function AlertQueue() {
  const alerts = useSupervisorStore((state) => state.alerts);
  const agents = useSupervisorStore((state) => state.agents);
  const alertFilter = useSupervisorStore((state) => state.alertFilter);
  const setAlertFilter = useSupervisorStore((state) => state.setAlertFilter);
  const assignAlert = useSupervisorStore((state) => state.assignAlert);
  const escalateAlert = useSupervisorStore((state) => state.escalateAlert);
  const resolveAlert = useSupervisorStore((state) => state.resolveAlert);
  const selectAlert = useSupervisorStore((state) => state.selectAlert);
  const selectedAlert = useSupervisorStore((state) => state.selectedAlert);

  const [showAssignModal, setShowAssignModal] = useState<string | null>(null);

  const alertArray = Array.from(alerts.values());
  
  const filteredAlerts = alertFilter === 'all'
    ? alertArray.filter(a => a.status !== 'resolved')
    : alertFilter === 'pending'
      ? alertArray.filter(a => a.status === 'pending')
      : alertFilter === 'assigned'
        ? alertArray.filter(a => a.status === 'assigned' || a.status === 'in_progress')
        : alertArray.filter(a => a.status === 'escalated');

  // Sort by severity and timestamp
  const sortedAlerts = [...filteredAlerts].sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const onlineAgents = Array.from(agents.values()).filter(a => a.status !== 'offline');

  return (
    <div className="h-full flex">
      {/* Alert List */}
      <div className="flex-1 min-h-0 p-4 xl:p-6 overflow-auto">
        {/* Filter Bar */}
        <div className="flex items-center gap-2 mb-4 xl:mb-6">
          <span className="text-sm text-slate-500 mr-2">Filter:</span>
          <FilterButton 
            active={alertFilter === 'all'} 
            onClick={() => setAlertFilter('all')}
            label="All Active"
            count={alertArray.filter(a => a.status !== 'resolved').length}
          />
          <FilterButton 
            active={alertFilter === 'pending'} 
            onClick={() => setAlertFilter('pending')}
            label="Pending"
            count={alertArray.filter(a => a.status === 'pending').length}
            color="amber"
          />
          <FilterButton 
            active={alertFilter === 'assigned'} 
            onClick={() => setAlertFilter('assigned')}
            label="Assigned"
            count={alertArray.filter(a => a.status === 'assigned' || a.status === 'in_progress').length}
            color="blue"
          />
          <FilterButton 
            active={alertFilter === 'escalated'} 
            onClick={() => setAlertFilter('escalated')}
            label="Escalated"
            count={alertArray.filter(a => a.status === 'escalated').length}
            color="red"
          />
        </div>

        {/* Alert List */}
        <div className="space-y-3">
          {sortedAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              agents={agents}
              selected={selectedAlert?.id === alert.id}
              onClick={() => selectAlert(alert)}
              onAssign={() => setShowAssignModal(alert.id)}
              onEscalate={() => escalateAlert(alert.id)}
              onResolve={() => resolveAlert(alert.id)}
            />
          ))}
        </div>

        {sortedAlerts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <CheckCircle className="w-12 h-12 mb-3 text-emerald-500/50" />
            <span>No alerts in this category</span>
          </div>
        )}
      </div>

      {/* Assignment Modal */}
      <AnimatePresence>
        {showAssignModal && (
          <AssignModal
            alertId={showAssignModal}
            agents={onlineAgents}
            onAssign={(agentId) => {
              assignAlert(showAssignModal, agentId);
              setShowAssignModal(null);
            }}
            onClose={() => setShowAssignModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterButton({ 
  active, 
  onClick, 
  label, 
  count,
  color = 'violet'
}: { 
  active: boolean; 
  onClick: () => void; 
  label: string; 
  count: number;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {label} <span className="ml-1 opacity-60">({count})</span>
    </button>
  );
}

function AlertCard({
  alert,
  agents,
  selected,
  onClick,
  onAssign,
  onEscalate,
  onResolve,
}: {
  alert: SupervisorAlert;
  agents: Map<string, Agent>;
  selected: boolean;
  onClick: () => void;
  onAssign: () => void;
  onEscalate: () => void;
  onResolve: () => void;
}) {
  const severityColors = {
    critical: 'bg-red-500/20 border-red-500/30 text-red-400',
    high: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
    medium: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
    low: 'bg-slate-500/20 border-slate-500/30 text-slate-400',
  };

  const severityBadge = {
    critical: 'bg-red-500 text-white',
    high: 'bg-amber-500 text-white',
    medium: 'bg-blue-500 text-white',
    low: 'bg-slate-500 text-white',
  };

  const assignedAgent = alert.assignedTo ? agents.get(alert.assignedTo) : null;

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const getTimeAgo = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <motion.div
      layout
      onClick={onClick}
      className={`p-4 rounded-xl border cursor-pointer transition-all ${
        selected
          ? 'bg-violet-500/20 border-violet-500/30 ring-1 ring-violet-500/50'
          : `${severityColors[alert.severity]} hover:bg-white/5`
      }`}
    >
      <div className="flex items-start justify-between">
        {/* Left - Alert Info */}
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${alert.severity === 'critical' ? 'bg-red-500/20' : 'bg-slate-700/50'}`}>
            <AlertTriangle className={`w-5 h-5 ${
              alert.severity === 'critical' ? 'text-red-400' : 
              alert.severity === 'high' ? 'text-amber-400' : 'text-slate-400'
            }`} />
          </div>
          
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white">{alert.type}</span>
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${severityBadge[alert.severity]}`}>
                {alert.severity.toUpperCase()}
              </span>
              {alert.status === 'escalated' && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500 text-white flex items-center gap-0.5">
                  <ArrowUp className="w-3 h-3" />
                  ESCALATED
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <span className="flex items-center gap-1">
                <Car className="w-3.5 h-3.5" />
                {alert.vehiclePlate}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {getTimeAgo(alert.timestamp)}
              </span>
              {alert.customerPhone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" />
                  {alert.customerPhone}
                </span>
              )}
            </div>

            {/* Assigned Agent */}
            {assignedAgent && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <User className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-violet-400">Assigned to {assignedAgent.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right - Actions */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {alert.status === 'pending' && (
            <>
              <button
                onClick={onAssign}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 rounded-lg text-sm transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                Assign
              </button>
              <button
                onClick={onEscalate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
                Escalate
              </button>
            </>
          )}
          
          {(alert.status === 'assigned' || alert.status === 'in_progress') && (
            <button
              onClick={onResolve}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              Resolve
            </button>
          )}

          {alert.status === 'escalated' && (
            <button
              onClick={onAssign}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 rounded-lg text-sm transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Reassign
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AssignModal({
  alertId,
  agents,
  onAssign,
  onClose,
}: {
  alertId: string;
  agents: Agent[];
  onAssign: (agentId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.username.toLowerCase().includes(search.toLowerCase())
  );

  // Sort by active alerts (least busy first)
  const sortedAgents = [...filteredAgents].sort((a, b) => a.activeAlerts - b.activeAlerts);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] max-h-[500px] bg-slate-900 border border-white/10 rounded-xl shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="text-lg font-semibold text-white">Assign Alert</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        {/* Agent List */}
        <div className="max-h-[300px] overflow-auto p-2">
          {sortedAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onAssign(agent.id)}
              className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-400" />
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                    agent.status === 'online' ? 'bg-emerald-500' :
                    agent.status === 'busy' ? 'bg-amber-500' : 'bg-slate-500'
                  }`} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-white">{agent.name}</div>
                  <div className="text-xs text-slate-500">
                    {agent.activeAlerts} active alerts
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          ))}

          {sortedAgents.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No online agents found
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
