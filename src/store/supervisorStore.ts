/**
 * Supervisor Store
 * Manages agent monitoring, alert assignment, and supervisor dashboard state
 */

import { create } from 'zustand';

// Types
export type AgentStatus = 'online' | 'away' | 'busy' | 'offline';

export interface Agent {
  id: string;
  name: string;
  username: string;
  extension?: string;
  status: AgentStatus;
  currentTask?: string;
  activeAlerts: number;
  resolvedToday: number;
  avgResponseTime: number; // in seconds
  loginTime?: Date;
  lastActivity?: Date;
}

export interface SupervisorAlert {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  vehiclePlate: string;
  vehicleId: string;
  description: string;
  timestamp: Date;
  assignedTo?: string;
  assignedAt?: Date;
  resolvedAt?: Date;
  status: 'pending' | 'assigned' | 'in_progress' | 'resolved' | 'escalated';
  customerName?: string;
  customerPhone?: string;
}

export interface ActivityLog {
  id: string;
  timestamp: Date;
  agentId?: string;
  agentName?: string;
  action: 'login' | 'logout' | 'alert_assigned' | 'alert_acknowledged' | 'alert_resolved' | 'call_made' | 'call_ended' | 'status_change' | 'escalation';
  details: string;
  alertId?: string;
  vehiclePlate?: string;
}

export interface DashboardStats {
  totalAgents: number;
  onlineAgents: number;
  awayAgents: number;
  busyAgents: number;
  totalAlertsToday: number;
  pendingAlerts: number;
  assignedAlerts: number;
  resolvedAlerts: number;
  escalatedAlerts: number;
  avgResponseTime: number;
  avgResolutionTime: number;
}

interface SupervisorState {
  // Data
  agents: Map<string, Agent>;
  alerts: Map<string, SupervisorAlert>;
  activityLog: ActivityLog[];
  stats: DashboardStats;
  
  // UI State
  selectedAgent: Agent | null;
  selectedAlert: SupervisorAlert | null;
  filterStatus: AgentStatus | 'all';
  alertFilter: 'all' | 'pending' | 'assigned' | 'escalated';
  isLoading: boolean;
  
  // Actions - Agents
  setAgents: (agents: Agent[]) => void;
  updateAgent: (agentId: string, update: Partial<Agent>) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  selectAgent: (agent: Agent | null) => void;
  
  // Actions - Alerts
  setAlerts: (alerts: SupervisorAlert[]) => void;
  addAlert: (alert: SupervisorAlert) => void;
  updateAlert: (alertId: string, update: Partial<SupervisorAlert>) => void;
  assignAlert: (alertId: string, agentId: string) => void;
  escalateAlert: (alertId: string) => void;
  resolveAlert: (alertId: string) => void;
  selectAlert: (alert: SupervisorAlert | null) => void;
  
  // Actions - Activity
  addActivity: (activity: Omit<ActivityLog, 'id' | 'timestamp'>) => void;
  clearActivityLog: () => void;
  
  // Actions - Stats
  updateStats: (stats: Partial<DashboardStats>) => void;
  refreshStats: () => void;
  
  // Actions - Filters
  setFilterStatus: (status: AgentStatus | 'all') => void;
  setAlertFilter: (filter: 'all' | 'pending' | 'assigned' | 'escalated') => void;
  
  // Actions - Loading
  setLoading: (loading: boolean) => void;
  
  // Getters
  getOnlineAgents: () => Agent[];
  getPendingAlerts: () => SupervisorAlert[];
  getEscalatedAlerts: () => SupervisorAlert[];
  getAgentAlerts: (agentId: string) => SupervisorAlert[];
}

// Initial stats
const initialStats: DashboardStats = {
  totalAgents: 0,
  onlineAgents: 0,
  awayAgents: 0,
  busyAgents: 0,
  totalAlertsToday: 0,
  pendingAlerts: 0,
  assignedAlerts: 0,
  resolvedAlerts: 0,
  escalatedAlerts: 0,
  avgResponseTime: 0,
  avgResolutionTime: 0,
};

export const useSupervisorStore = create<SupervisorState>((set, get) => ({
  // Initial State
  agents: new Map(),
  alerts: new Map(),
  activityLog: [],
  stats: initialStats,
  selectedAgent: null,
  selectedAlert: null,
  filterStatus: 'all',
  alertFilter: 'all',
  isLoading: false,

  // Agent Actions
  setAgents: (agents) => {
    const agentMap = new Map(agents.map(a => [a.id, a]));
    set({ agents: agentMap });
    get().refreshStats();
  },

  updateAgent: (agentId, update) => {
    set((state) => {
      const agents = new Map(state.agents);
      const agent = agents.get(agentId);
      if (agent) {
        agents.set(agentId, { ...agent, ...update, lastActivity: new Date() });
      }
      return { agents };
    });
  },

  setAgentStatus: (agentId, status) => {
    const agent = get().agents.get(agentId);
    if (agent) {
      get().updateAgent(agentId, { status });
      get().addActivity({
        agentId,
        agentName: agent.name,
        action: 'status_change',
        details: `${agent.name} is now ${status}`,
      });
      get().refreshStats();
    }
  },

  selectAgent: (agent) => set({ selectedAgent: agent }),

  // Alert Actions
  setAlerts: (alerts) => {
    const alertMap = new Map(alerts.map(a => [a.id, a]));
    set({ alerts: alertMap });
    get().refreshStats();
  },

  addAlert: (alert) => {
    set((state) => {
      const alerts = new Map(state.alerts);
      alerts.set(alert.id, alert);
      return { alerts };
    });
    get().addActivity({
      action: 'alert_assigned',
      details: `New ${alert.severity} alert: ${alert.type} for ${alert.vehiclePlate}`,
      alertId: alert.id,
      vehiclePlate: alert.vehiclePlate,
    });
    get().refreshStats();
  },

  updateAlert: (alertId, update) => {
    set((state) => {
      const alerts = new Map(state.alerts);
      const alert = alerts.get(alertId);
      if (alert) {
        alerts.set(alertId, { ...alert, ...update });
      }
      return { alerts };
    });
  },

  assignAlert: (alertId, agentId) => {
    const alert = get().alerts.get(alertId);
    const agent = get().agents.get(agentId);
    
    if (alert && agent) {
      get().updateAlert(alertId, {
        assignedTo: agentId,
        assignedAt: new Date(),
        status: 'assigned',
      });
      
      get().updateAgent(agentId, {
        activeAlerts: agent.activeAlerts + 1,
        currentTask: `Handling ${alert.type} - ${alert.vehiclePlate}`,
      });
      
      get().addActivity({
        agentId,
        agentName: agent.name,
        action: 'alert_assigned',
        details: `${alert.type} alert for ${alert.vehiclePlate} assigned to ${agent.name}`,
        alertId,
        vehiclePlate: alert.vehiclePlate,
      });
      
      get().refreshStats();
    }
  },

  escalateAlert: (alertId) => {
    const alert = get().alerts.get(alertId);
    if (alert) {
      get().updateAlert(alertId, { status: 'escalated' });
      get().addActivity({
        action: 'escalation',
        details: `Alert escalated: ${alert.type} for ${alert.vehiclePlate}`,
        alertId,
        vehiclePlate: alert.vehiclePlate,
      });
      get().refreshStats();
    }
  },

  resolveAlert: (alertId) => {
    const alert = get().alerts.get(alertId);
    if (alert) {
      get().updateAlert(alertId, {
        status: 'resolved',
        resolvedAt: new Date(),
      });
      
      if (alert.assignedTo) {
        const agent = get().agents.get(alert.assignedTo);
        if (agent) {
          get().updateAgent(alert.assignedTo, {
            activeAlerts: Math.max(0, agent.activeAlerts - 1),
            resolvedToday: agent.resolvedToday + 1,
            currentTask: agent.activeAlerts <= 1 ? undefined : agent.currentTask,
          });
          
          get().addActivity({
            agentId: alert.assignedTo,
            agentName: agent.name,
            action: 'alert_resolved',
            details: `${agent.name} resolved ${alert.type} alert for ${alert.vehiclePlate}`,
            alertId,
            vehiclePlate: alert.vehiclePlate,
          });
        }
      }
      
      get().refreshStats();
    }
  },

  selectAlert: (alert) => set({ selectedAlert: alert }),

  // Activity Actions
  addActivity: (activity) => {
    const newActivity: ActivityLog = {
      ...activity,
      id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
    };
    
    set((state) => ({
      activityLog: [newActivity, ...state.activityLog].slice(0, 100), // Keep last 100 activities
    }));
  },

  clearActivityLog: () => set({ activityLog: [] }),

  // Stats Actions
  updateStats: (stats) => {
    set((state) => ({
      stats: { ...state.stats, ...stats },
    }));
  },

  refreshStats: () => {
    const { agents, alerts } = get();
    
    const agentArray = Array.from(agents.values());
    const alertArray = Array.from(alerts.values());
    
    const stats: DashboardStats = {
      totalAgents: agentArray.length,
      onlineAgents: agentArray.filter(a => a.status === 'online').length,
      awayAgents: agentArray.filter(a => a.status === 'away').length,
      busyAgents: agentArray.filter(a => a.status === 'busy').length,
      totalAlertsToday: alertArray.length,
      pendingAlerts: alertArray.filter(a => a.status === 'pending').length,
      assignedAlerts: alertArray.filter(a => a.status === 'assigned' || a.status === 'in_progress').length,
      resolvedAlerts: alertArray.filter(a => a.status === 'resolved').length,
      escalatedAlerts: alertArray.filter(a => a.status === 'escalated').length,
      avgResponseTime: agentArray.length > 0 
        ? agentArray.reduce((sum, a) => sum + a.avgResponseTime, 0) / agentArray.length 
        : 0,
      avgResolutionTime: 0, // Calculate from resolved alerts
    };
    
    set({ stats });
  },

  // Filter Actions
  setFilterStatus: (status) => set({ filterStatus: status }),
  setAlertFilter: (filter) => set({ alertFilter: filter }),
  
  // Loading
  setLoading: (loading) => set({ isLoading: loading }),

  // Getters
  getOnlineAgents: () => {
    return Array.from(get().agents.values()).filter(a => a.status !== 'offline');
  },

  getPendingAlerts: () => {
    return Array.from(get().alerts.values()).filter(a => a.status === 'pending');
  },

  getEscalatedAlerts: () => {
    return Array.from(get().alerts.values()).filter(a => a.status === 'escalated');
  },

  getAgentAlerts: (agentId) => {
    return Array.from(get().alerts.values()).filter(a => a.assignedTo === agentId);
  },
}));
