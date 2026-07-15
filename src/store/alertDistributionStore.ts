/**
 * Alert Distribution Store
 * Manages state for agent inbox, alerts, and distribution system
 */
import { create } from 'zustand';
import { api } from '@services/api';
import { toast } from '@store/toastStore';

// Types
export interface AlertAssignment {
  id: number;
  alert_id: string;
  alert_type: string;
  vehicle_reg: string;
  customer_name: string;
  alert_message: string;
  alert_data: any;
  assigned_to: string;
  assigned_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  resolution_notes: string | null;
  escalated_to: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  resolved_by: string | null;
  assignment_count: number;
  priority: number;
  status: string;
  created_at: string;
}

export interface AgentSession {
  id: number;
  user_id: string;
  username: string;
  role: string;
  status: 'online' | 'break_requested' | 'on_break' | 'offline';
  logged_in_at: string;
  last_activity: string;
  current_alert_count: number;
  max_alerts: number;
  ws_connection_id: string | null;
}

export interface DistributionRule {
  id: number;
  rule_type: string;
  rule_name: string;
  description: string | null;
  config: any;
  is_active: boolean;
  priority: number;
  created_by: string;
  created_at: string;
}

export interface BankOption {
  id: number;
  name: string;
}

export interface CorporateOption {
  id: number;
  name: string;
}

export interface DistributionStats {
  online_agents: number;
  break_requested: number;
  on_break: number;
  pending_alerts: number;
  assigned_alerts: number;
  acknowledged_alerts: number;
  escalated_alerts: number;
  resolved_today: number;
}

interface AlertDistributionState {
  // Agent state
  session: AgentSession | null;
  isLoggedIn: boolean;
  
  // Inbox state
  unacknowledgedAlerts: AlertAssignment[];
  acknowledgedAlerts: AlertAssignment[];
  totalAlerts: number;
  inboxLoading: boolean;
  
  // Supervisor state
  allAgents: AgentSession[];
  escalatedAlerts: AlertAssignment[];
  pendingAlerts: AlertAssignment[];
  resolvedAlerts: AlertAssignment[];
  resolvedTotal: number;
  rules: DistributionRule[];
  stats: DistributionStats | null;
  banks: BankOption[];
  corporates: CorporateOption[];

  // Loading states
  loading: boolean;
  error: string | null;
  
  // Actions
  login: (userId: string, username: string, role?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  
  // Inbox actions
  fetchInbox: () => Promise<void>;
  acknowledgeAlert: (alertId: string) => Promise<boolean>;
  resolveAlert: (alertId: string, resolutionType: string, notes?: string) => Promise<boolean>;
  escalateAlert: (alertId: string, reason?: string) => Promise<boolean>;
  
  // Break management
  requestBreak: () => Promise<void>;
  cancelBreakRequest: () => Promise<void>;
  
  // Supervisor actions
  fetchSnapshot: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchEscalated: () => Promise<void>;
  fetchPending: () => Promise<void>;
  fetchResolved: (limit?: number, offset?: number, q?: string) => Promise<void>;
  fetchRules: () => Promise<void>;
  fetchStats: () => Promise<void>;
  assignAlert: (alertId: string, agentId: string, reason?: string, force?: boolean) => Promise<boolean>;
  supervisorResolve: (alertId: string, resolutionType: string, notes?: string) => Promise<boolean>;
  dismissAlerts: (alertIds: string[], reason?: string) => Promise<number>;
  updateMaxAlerts: (userId: string, maxAlerts: number) => Promise<boolean>;
  distributePending: () => Promise<number>;
  approveBreak: (userId: string) => Promise<void>;
  endBreak: (userId: string) => Promise<void>;
  createRule: (rule: Partial<DistributionRule>) => Promise<void>;
  updateRule: (ruleId: number, updates: { config?: any; isActive?: boolean; ruleName?: string; description?: string; priority?: number; ruleType?: string }) => Promise<void>;
  deleteRule: (ruleId: number) => Promise<void>;
  fetchBanks: () => Promise<void>;
  fetchCorporates: () => Promise<void>;

  // Utility
  clearError: () => void;
  addNewAlert: (alert: AlertAssignment) => void;
  updateAlert: (alertId: string, updates: Partial<AlertAssignment>) => void;
  removeAlert: (alertId: string) => void;
}

const SESSION_STORAGE_KEY = 'tavl_distribution_session';

function persistSession(session: AgentSession | null) {
  try {
    if (session) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch { /* storage unavailable */ }
}

function loadPersistedSession(): AgentSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const initialSession = loadPersistedSession();

const inflight = new Map<string, Promise<void>>();
function dedup(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const useAlertDistributionStore = create<AlertDistributionState>((set, get) => ({
  session: initialSession,
  isLoggedIn: !!initialSession,
  
  unacknowledgedAlerts: [],
  acknowledgedAlerts: [],
  totalAlerts: 0,
  inboxLoading: false,
  
  allAgents: [],
  escalatedAlerts: [],
  pendingAlerts: [],
  resolvedAlerts: [],
  resolvedTotal: 0,
  rules: [],
  stats: null,
  banks: [],
  corporates: [],

  loading: false,
  error: null,
  
  login: async (userId: string, username: string, role?: string) => {
    set({ loading: true, error: null });
    
    try {
      // Pass softphone extension so backend can auto-join the agent queue
      let ext: string | undefined;
      try {
        const saved = localStorage.getItem('tavl_softphone_settings');
        if (saved) ext = JSON.parse(saved).extension || undefined;
      } catch {}
      const response = await api.distribution.login(userId, username, role, ext);
      
      if (response.success && response.data) {
        const session = response.data as AgentSession;
        persistSession(session);
        set({
          session,
          isLoggedIn: true,
          loading: false,
        });
        get().fetchInbox();
      } else {
        set({ error: response.error || 'Login failed', loading: false });
      }
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },
  
  // Logout action
  logout: async () => {
    const { session } = get();
    if (!session) return;
    
    try {
      let ext: string | undefined;
      try {
        const saved = localStorage.getItem('tavl_softphone_settings');
        if (saved) ext = JSON.parse(saved).extension || undefined;
      } catch {}
      await api.distribution.logout(session.user_id, ext);
    } catch (e) {
      // Ignore logout errors
    }
    
    persistSession(null);
    set({
      session: null,
      isLoggedIn: false,
      unacknowledgedAlerts: [],
      acknowledgedAlerts: [],
      totalAlerts: 0,
    });
  },
  
  // Refresh session
  refreshSession: async () => {
    const { session } = get();
    if (!session) return;
    
    try {
      const response = await api.distribution.getSession(session.user_id);
      if (response.success && response.data) {
        const updated = response.data as AgentSession;
        persistSession(updated);
        set({ session: updated });
      }
    } catch (e) {
      // Ignore refresh errors
    }
  },
  
  fetchInbox: () => dedup('inbox', async () => {
    const { session } = get();
    if (!session) return;
    
    set({ inboxLoading: true });
    
    try {
      const response = await api.distribution.getInbox(session.user_id);
      
      if (response.success && response.data) {
        const data = response.data as {
          unacknowledged?: AlertAssignment[];
          acknowledged?: AlertAssignment[];
          total?: number;
          session?: AgentSession;
        };
        set({
          unacknowledgedAlerts: data.unacknowledged || [],
          acknowledgedAlerts: data.acknowledged || [],
          totalAlerts: data.total || 0,
          session: data.session || get().session,
          inboxLoading: false,
        });
      } else {
        set({ inboxLoading: false });
      }
    } catch (error: any) {
      set({ inboxLoading: false, error: error.message });
    }
  }),
  
  // Acknowledge alert
  acknowledgeAlert: async (alertId: string) => {
    const { session } = get();
    if (!session) return false;
    
    try {
      const response = await api.distribution.acknowledgeAlert(alertId, session.user_id);
      
      if (response.success) {
        const updatedAlert = response.data as AlertAssignment;
        set((state) => {
          const alert = state.unacknowledgedAlerts.find(a => a.alert_id === alertId);
          if (!alert) return state;
          return {
            unacknowledgedAlerts: state.unacknowledgedAlerts.filter(a => a.alert_id !== alertId),
            acknowledgedAlerts: [{ ...alert, ...updatedAlert }, ...state.acknowledgedAlerts],
          };
        });
        return true;
      }
      return false;
    } catch (error: any) {
      set({ error: error.message });
      return false;
    }
  },
  
  // Resolve alert
  resolveAlert: async (alertId: string, resolutionType: string, notes?: string) => {
    const { session } = get();
    if (!session) return false;
    
    try {
      const response = await api.distribution.resolveAlert(alertId, session.user_id, resolutionType, notes);
      
      if (response.success) {
        set((state) => ({
          acknowledgedAlerts: state.acknowledgedAlerts.filter(a => a.alert_id !== alertId),
          totalAlerts: state.totalAlerts - 1,
        }));
        
        get().refreshSession();
        
        return true;
      }
      return false;
    } catch (error: any) {
      set({ error: error.message });
      return false;
    }
  },
  
  // Escalate alert
  escalateAlert: async (alertId: string, reason?: string) => {
    const { session } = get();
    if (!session) return false;
    
    try {
      const response = await api.distribution.escalateAlert(alertId, session.user_id, reason);
      
      if (response.success) {
        set((state) => ({
          unacknowledgedAlerts: state.unacknowledgedAlerts.filter(a => a.alert_id !== alertId),
          acknowledgedAlerts: state.acknowledgedAlerts.filter(a => a.alert_id !== alertId),
          totalAlerts: state.totalAlerts - 1,
        }));
        
        get().refreshSession();
        
        return true;
      }
      return false;
    } catch (error: any) {
      set({ error: error.message });
      return false;
    }
  },
  
  // Request break
  requestBreak: async () => {
    const { session } = get();
    if (!session) return;
    
    try {
      const response = await api.distribution.requestBreak(session.user_id);
      if (response.success && response.data) {
        set({ session: response.data as AgentSession });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  },
  
  // Cancel break request
  cancelBreakRequest: async () => {
    const { session } = get();
    if (!session) return;
    
    try {
      const response = await api.distribution.cancelBreakRequest(session.user_id);
      if (response.success && response.data) {
        set({ session: response.data as AgentSession });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  },
  
  fetchSnapshot: () => dedup('snapshot', async () => {
    try {
      const response = await api.distribution.getSnapshot();
      if (response.success) {
        set({
          allAgents: (response as any).agents || [],
          escalatedAlerts: (response as any).escalated || [],
          pendingAlerts: (response as any).pending || [],
          stats: (response as any).stats || null,
        });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  }),

  fetchAgents: () => dedup('agents', async () => {
    try {
      const response = await api.distribution.getAgents();
      if (response.success && response.data) {
        set({ allAgents: response.data as AgentSession[] });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  }),
  
  fetchEscalated: () => dedup('escalated', async () => {
    try {
      const response = await api.distribution.getEscalated();
      if (response.success && response.data) {
        set({ escalatedAlerts: response.data as AlertAssignment[] });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  }),
  
  fetchPending: () => dedup('pending', async () => {
    try {
      const response = await api.distribution.getPending();
      if (response.success && response.data) {
        set({ pendingAlerts: response.data as AlertAssignment[] });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  }),
  
  fetchResolved: async (limit = 50, offset = 0, q?: string) => {
    try {
      const response = await api.distribution.getResolved(limit, offset, undefined, q);
      if (response.success && response.data) {
        const total = (response as any).total ?? 0;
        set({ resolvedAlerts: response.data as AlertAssignment[], resolvedTotal: total });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  fetchRules: () => dedup('rules', async () => {
    try {
      const response = await api.distribution.getRules();
      if (response.success && response.data) {
        set({ rules: response.data as DistributionRule[] });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  }),
  
  fetchStats: () => dedup('stats', async () => {
    try {
      const response = await api.distribution.getStats();
      if (response.success && response.data) {
        set({ stats: response.data as DistributionStats });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  }),
  
  // Supervisor: Assign alert
  assignAlert: async (alertId: string, agentId: string, reason?: string, force?: boolean) => {
    const { session } = get();
    
    try {
      const response = await api.distribution.assignAlert(alertId, agentId, session?.user_id, reason, force);
      
      if (response.success) {
        toast.success('Alert assigned successfully');
        get().fetchEscalated();
        get().fetchPending();
        get().fetchAgents();
        get().fetchStats();
        return true;
      }
      toast.error(response.error || 'Failed to assign alert');
      return false;
    } catch (error: any) {
      toast.error(error.message || 'Failed to assign alert');
      set({ error: error.message });
      return false;
    }
  },

  supervisorResolve: async (alertId: string, resolutionType: string, notes?: string) => {
    const { session } = get();
    if (!session) return false;

    try {
      const response = await api.distribution.supervisorResolve(alertId, session.user_id, resolutionType, notes);
      if (response.success) {
        toast.success('Alert resolved');
        get().fetchEscalated();
        get().fetchPending();
        get().fetchAgents();
        get().fetchStats();
        return true;
      }
      toast.error(response.error || 'Failed to resolve alert');
      return false;
    } catch (error: any) {
      toast.error(error.message || 'Failed to resolve alert');
      set({ error: error.message });
      return false;
    }
  },

  dismissAlerts: async (alertIds: string[], reason?: string) => {
    const { session } = get();
    if (!session) return 0;

    try {
      const response = await api.distribution.dismissAlerts(alertIds, session.user_id, reason);
      if (response.success) {
        const count = (response.data as any)?.dismissed ?? 0;
        toast.success(`${count} alert${count !== 1 ? 's' : ''} dismissed`);
        get().fetchEscalated();
        get().fetchPending();
        get().fetchAgents();
        get().fetchStats();
        return count;
      }
      toast.error('Failed to dismiss alerts');
      return 0;
    } catch (error: any) {
      toast.error(error.message || 'Failed to dismiss alerts');
      set({ error: error.message });
      return 0;
    }
  },

  updateMaxAlerts: async (userId: string, maxAlerts: number) => {
    try {
      const response = await api.distribution.updateMaxAlerts(userId, maxAlerts);
      if (response.success) {
        toast.success(`Agent capacity updated to ${maxAlerts}`);
        get().fetchAgents();
        return true;
      }
      toast.error('Failed to update capacity');
      return false;
    } catch (error: any) {
      toast.error(error.message || 'Failed to update capacity');
      set({ error: error.message });
      return false;
    }
  },

  distributePending: async () => {
    try {
      const response = await api.distribution.distributePending();
      if (response.success) {
        const count = (response.data as any)?.distributed ?? 0;
        toast.success(count > 0 ? `${count} alert${count !== 1 ? 's' : ''} distributed` : 'No alerts to distribute');
        get().fetchPending();
        get().fetchAgents();
        get().fetchStats();
        return count;
      }
      toast.error('Distribution failed');
      return 0;
    } catch (error: any) {
      toast.error(error.message || 'Distribution failed');
      set({ error: error.message });
      return 0;
    }
  },

  approveBreak: async (userId: string) => {
    const { session } = get();
    
    try {
      await api.distribution.approveBreak(userId, session?.user_id);
      toast.success('Break approved');
      get().fetchAgents();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve break');
      set({ error: error.message });
    }
  },
  
  endBreak: async (userId: string) => {
    try {
      await api.distribution.endBreak(userId);
      toast.info('Break ended');
      get().fetchAgents();
    } catch (error: any) {
      toast.error(error.message || 'Failed to end break');
      set({ error: error.message });
    }
  },
  
  createRule: async (rule: Partial<DistributionRule>) => {
    try {
      if (!rule.rule_type || !rule.rule_name) {
        toast.error('Rule type and name are required');
        return;
      }
      const payload = {
        ruleType: rule.rule_type,
        ruleName: rule.rule_name,
        description: rule.description ?? undefined,
        config: rule.config,
        priority: rule.priority,
        createdBy: rule.created_by || 'supervisor',
      };
      const response = await api.distribution.createRule(payload);
      if (response.success) {
        toast.success('Rule created');
      } else {
        toast.error(response.error || 'Failed to create rule');
      }
      get().fetchRules();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create rule');
      set({ error: error.message });
    }
  },
  
  updateRule: async (ruleId: number, updates: { config?: any; isActive?: boolean; ruleName?: string; description?: string; priority?: number; ruleType?: string }) => {
    try {
      const response = await api.distribution.updateRule(ruleId, updates);
      if (response.success) {
        toast.success('Rule updated');
      } else {
        toast.error(response.error || 'Failed to update rule');
      }
      get().fetchRules();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update rule');
      set({ error: error.message });
    }
  },
  
  deleteRule: async (ruleId: number) => {
    try {
      const response = await api.distribution.deleteRule(ruleId);
      if (response.success) {
        toast.success('Rule deleted');
      } else {
        toast.error(response.error || 'Failed to delete rule');
      }
      get().fetchRules();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete rule');
      set({ error: error.message });
    }
  },
  
  // Clear error
  clearError: () => set({ error: null }),
  
  addNewAlert: (alert: AlertAssignment) => {
    set((state) => {
      const exists = state.unacknowledgedAlerts.some(a => a.alert_id === alert.alert_id)
        || state.acknowledgedAlerts.some(a => a.alert_id === alert.alert_id);
      if (exists) return state;
      return {
        unacknowledgedAlerts: [alert, ...state.unacknowledgedAlerts],
        totalAlerts: state.totalAlerts + 1,
      };
    });
  },
  
  updateAlert: (alertId: string, updates: Partial<AlertAssignment>) => {
    set((state) => {
      if (updates.status === 'acknowledged') {
        const alert = state.unacknowledgedAlerts.find(a => a.alert_id === alertId);
        if (alert) {
          return {
            unacknowledgedAlerts: state.unacknowledgedAlerts.filter(a => a.alert_id !== alertId),
            acknowledgedAlerts: [{ ...alert, ...updates }, ...state.acknowledgedAlerts],
          };
        }
      }
      return {
        unacknowledgedAlerts: state.unacknowledgedAlerts.map(a =>
          a.alert_id === alertId ? { ...a, ...updates } : a
        ),
        acknowledgedAlerts: state.acknowledgedAlerts.map(a =>
          a.alert_id === alertId ? { ...a, ...updates } : a
        ),
      };
    });
  },
  
  fetchBanks: async () => {
    try {
      const resp = await api.distribution.getBanks() as any;
      if (resp.success) set({ banks: resp.data as BankOption[] });
    } catch { /* non-critical */ }
  },

  fetchCorporates: async () => {
    try {
      const resp = await api.distribution.getCorporates() as any;
      if (resp.success) set({ corporates: resp.data as CorporateOption[] });
    } catch { /* non-critical */ }
  },

  removeAlert: (alertId: string) => {
    set((state) => {
      const wasPresent = state.unacknowledgedAlerts.some(a => a.alert_id === alertId)
        || state.acknowledgedAlerts.some(a => a.alert_id === alertId);
      return {
        unacknowledgedAlerts: state.unacknowledgedAlerts.filter(a => a.alert_id !== alertId),
        acknowledgedAlerts: state.acknowledgedAlerts.filter(a => a.alert_id !== alertId),
        totalAlerts: wasPresent ? state.totalAlerts - 1 : state.totalAlerts,
      };
    });
  },
}));
