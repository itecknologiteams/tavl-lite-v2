/**
 * Agent Status Grid Component
 * Shows all agents in a grid with their current status
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Phone,
  Clock,
  CheckCircle,
  AlertTriangle,
  MoreVertical,
  MessageSquare,
  PhoneCall,
  X,
} from 'lucide-react';
import { useSupervisorStore, type Agent, type AgentStatus } from '@store/supervisorStore';

export function AgentStatusGrid() {
  const agents = useSupervisorStore((state) => state.agents);
  const filterStatus = useSupervisorStore((state) => state.filterStatus);
  const setFilterStatus = useSupervisorStore((state) => state.setFilterStatus);
  const selectAgent = useSupervisorStore((state) => state.selectAgent);
  const selectedAgent = useSupervisorStore((state) => state.selectedAgent);

  const agentArray = Array.from(agents.values());
  
  const filteredAgents = filterStatus === 'all' 
    ? agentArray 
    : agentArray.filter(a => a.status === filterStatus);

  // Sort: online first, then by active alerts
  const sortedAgents = [...filteredAgents].sort((a, b) => {
    const statusOrder = { online: 0, busy: 1, away: 2, offline: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return b.activeAlerts - a.activeAlerts;
  });

  return (
    <div className="h-full flex">
      {/* Agent Grid */}
      <div className="flex-1 min-h-0 p-4 xl:p-6 overflow-auto">
        {/* Filter Bar */}
        <div className="flex items-center gap-2 mb-4 xl:mb-6">
          <span className="text-sm text-slate-500 mr-2">Filter:</span>
          <FilterButton 
            active={filterStatus === 'all'} 
            onClick={() => setFilterStatus('all')}
            label="All"
            count={agentArray.length}
          />
          <FilterButton 
            active={filterStatus === 'online'} 
            onClick={() => setFilterStatus('online')}
            label="Online"
            count={agentArray.filter(a => a.status === 'online').length}
            color="emerald"
          />
          <FilterButton 
            active={filterStatus === 'busy'} 
            onClick={() => setFilterStatus('busy')}
            label="Busy"
            count={agentArray.filter(a => a.status === 'busy').length}
            color="amber"
          />
          <FilterButton 
            active={filterStatus === 'away'} 
            onClick={() => setFilterStatus('away')}
            label="Away"
            count={agentArray.filter(a => a.status === 'away').length}
            color="gray"
          />
          <FilterButton 
            active={filterStatus === 'offline'} 
            onClick={() => setFilterStatus('offline')}
            label="Offline"
            count={agentArray.filter(a => a.status === 'offline').length}
            color="red"
          />
        </div>

        {/* Agent Grid */}
        <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-7 gap-3 xl:gap-4">
          {sortedAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={selectedAgent?.id === agent.id}
              onClick={() => selectAgent(agent)}
            />
          ))}
        </div>

        {sortedAgents.length === 0 && (
          <div className="flex items-center justify-center h-64 text-slate-500">
            No agents found with the selected filter
          </div>
        )}
      </div>

      {/* Agent Detail Sidebar */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="h-full border-l border-white/5 bg-slate-900/50 overflow-hidden"
          >
            <AgentDetailPanel 
              agent={selectedAgent} 
              onClose={() => selectAgent(null)} 
            />
          </motion.aside>
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

function AgentCard({ 
  agent, 
  selected,
  onClick 
}: { 
  agent: Agent; 
  selected: boolean;
  onClick: () => void;
}) {
  const statusColors: Record<AgentStatus, string> = {
    online: 'bg-emerald-500',
    busy: 'bg-amber-500',
    away: 'bg-slate-500',
    offline: 'bg-red-500',
  };

  const statusBgColors: Record<AgentStatus, string> = {
    online: 'bg-emerald-500/10 border-emerald-500/20',
    busy: 'bg-amber-500/10 border-amber-500/20',
    away: 'bg-slate-500/10 border-slate-500/20',
    offline: 'bg-red-500/10 border-red-500/20',
  };

  return (
    <motion.div
      layout
      onClick={onClick}
      className={`p-4 rounded-xl border cursor-pointer transition-all ${
        selected 
          ? 'bg-violet-500/20 border-violet-500/30 ring-1 ring-violet-500/50' 
          : `${statusBgColors[agent.status]} hover:bg-white/5`
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
              <User className="w-5 h-5 text-slate-400" />
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${statusColors[agent.status]}`} />
          </div>
          <div>
            <div className="text-sm font-medium text-white truncate max-w-[100px]">
              {agent.name}
            </div>
            <div className="text-[10px] text-slate-500">
              Ext: {agent.extension || 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-400">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span>{agent.activeAlerts} active</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <CheckCircle className="w-3 h-3 text-emerald-400" />
          <span>{agent.resolvedToday} done</span>
        </div>
      </div>

      {/* Current Task */}
      {agent.currentTask && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <p className="text-[10px] text-slate-500 truncate" title={agent.currentTask}>
            {agent.currentTask}
          </p>
        </div>
      )}
    </motion.div>
  );
}

function AgentDetailPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const setAgentStatus = useSupervisorStore((state) => state.setAgentStatus);
  const getAgentAlerts = useSupervisorStore((state) => state.getAgentAlerts);
  
  const agentAlerts = getAgentAlerts(agent.id);

  const statusColors: Record<AgentStatus, string> = {
    online: 'text-emerald-400',
    busy: 'text-amber-400',
    away: 'text-slate-400',
    offline: 'text-red-400',
  };

  const formatDuration = (date?: Date) => {
    if (!date) return 'N/A';
    const diff = Date.now() - new Date(date).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Agent Details</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {/* Agent Info */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center">
            <User className="w-7 h-7 text-slate-400" />
          </div>
          <div>
            <div className="text-lg font-medium text-white">{agent.name}</div>
            <div className="text-sm text-slate-500">@{agent.username}</div>
            <div className={`text-sm font-medium capitalize ${statusColors[agent.status]}`}>
              {agent.status}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors">
            <PhoneCall className="w-4 h-4" />
            <span className="text-sm">Call</span>
          </button>
          <button className="flex items-center justify-center gap-2 px-3 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 rounded-lg transition-colors">
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm">Message</span>
          </button>
        </div>

        {/* Stats */}
        <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Extension</span>
            <span className="text-white font-medium">{agent.extension || 'N/A'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Active Alerts</span>
            <span className="text-amber-400 font-medium">{agent.activeAlerts}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Resolved Today</span>
            <span className="text-emerald-400 font-medium">{agent.resolvedToday}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Logged In</span>
            <span className="text-white">{formatDuration(agent.loginTime)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Avg Response</span>
            <span className="text-white">{agent.avgResponseTime}s</span>
          </div>
        </div>

        {/* Current Task */}
        {agent.currentTask && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <div className="text-xs text-amber-400 font-medium mb-1">Current Task</div>
            <div className="text-sm text-white">{agent.currentTask}</div>
          </div>
        )}

        {/* Agent's Alerts */}
        {agentAlerts.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-2">Assigned Alerts ({agentAlerts.length})</h4>
            <div className="space-y-2">
              {agentAlerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="p-2 bg-slate-800/50 rounded-lg text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white">{alert.type}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                      alert.severity === 'high' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                      {alert.severity}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">{alert.vehiclePlate}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Change */}
        <div>
          <h4 className="text-sm font-medium text-slate-400 mb-2">Change Status</h4>
          <div className="grid grid-cols-2 gap-2">
            {(['online', 'busy', 'away', 'offline'] as AgentStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => setAgentStatus(agent.id, status)}
                disabled={agent.status === status}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  agent.status === status
                    ? 'bg-violet-500/30 text-violet-400 border border-violet-500/50'
                    : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
