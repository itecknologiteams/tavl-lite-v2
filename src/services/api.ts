/**
 * API Service - Replaces Electron IPC with HTTP calls
 * Provides the same interface as window.electron for easy migration
 */

// In development, use relative URLs (proxied through Vite)
// In production, use full URLs or relative
const API_BASE = import.meta.env.VITE_API_URL || '/api';
// Prefer same-origin WS via Vite proxy (/ws) to avoid mixed-content issues when dev server is https.
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// WebSocket connection
let ws: WebSocket | null = null;
let wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const wsListeners: Map<string, Set<(data: any) => void>> = new Map();

// Initialize WebSocket connection
export function initWebSocket() {
  if (ws?.readyState === WebSocket.OPEN) return;
  
  try {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      console.log('🔌 WebSocket connected');
      if (wsReconnectTimeout) {
        clearTimeout(wsReconnectTimeout);
        wsReconnectTimeout = null;
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { type, data } = message;
        
        // Notify all listeners for this type
        const listeners = wsListeners.get(type);
        if (listeners) {
          listeners.forEach(callback => callback(data));
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      // Reconnect after 3 seconds
      wsReconnectTimeout = setTimeout(initWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  } catch (error) {
    console.error('WebSocket connection failed:', error);
  }
}

// Subscribe to WebSocket events
export function subscribeToWs(type: string, callback: (data: any) => void) {
  if (!wsListeners.has(type)) {
    wsListeners.set(type, new Set());
  }
  wsListeners.get(type)!.add(callback);
  
  // Return unsubscribe function
  return () => {
    wsListeners.get(type)?.delete(callback);
  };
}

// Close WebSocket
export function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (wsReconnectTimeout) {
    clearTimeout(wsReconnectTimeout);
    wsReconnectTimeout = null;
  }
}

let _currentUserId: string | null = null;
export function setCurrentUserId(userId: string | null) { _currentUserId = userId; }
function getCurrentUserId(): string | null {
  if (_currentUserId) return _currentUserId;
  try {
    const stored = JSON.parse(sessionStorage.getItem('tavl-auth-session') || '{}');
    const id = stored?.state?.user?.id;
    if (id) { _currentUserId = id; return id; }
  } catch {}
  return null;
}

// Generic fetch wrapper with robust error handling
async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    };
    const resolvedUserId = getCurrentUserId();
    if (resolvedUserId) headers['X-User-Id'] = resolvedUserId;

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const text = await response.text();

    if (!text || text.trim().length === 0) {
      if (!response.ok) {
        return { success: false, error: `Server error (${response.status})` };
      }
      return { success: false, error: 'Empty response from server' };
    }

    try {
      return JSON.parse(text);
    } catch {
      return { success: false, error: `Invalid response from server (${response.status})` };
    }
  } catch (error: any) {
    console.error(`API Error (${endpoint}):`, error);
    return { success: false, error: error.message || 'Network error' };
  }
}

// ============================================
// API Interface (mirrors window.electron)
// ============================================

export const api = {
  // Auth
  auth: {
    login: async (username: string, password: string) => {
      return apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    },
  },
  
  // Vehicles
  vehicle: {
    search: async (term: string, options?: { includeDeactivated?: boolean }) => {
      const params = new URLSearchParams({ term });
      if (options?.includeDeactivated) params.set('includeDeactivated', 'true');
      return apiFetch(`/vehicles/search?${params.toString()}`);
    },
    
    getDetails: async (objectId: number) => {
      return apiFetch(`/vehicles/${objectId}`);
    },
    
    getRealtimeGps: async (objectId: number) => {
      return apiFetch(`/vehicles/${objectId}/gps`);
    },
  },
  
  // Alerts
  alerts: {
    getRecent: async (options?: {
      limit?: number;
      category?: string;
      sinceMinutes?: number;
      sinceId?: string;
    }) => {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.category) params.set('category', options.category);
      if (options?.sinceMinutes) params.set('sinceMinutes', options.sinceMinutes.toString());
      if (options?.sinceId) params.set('sinceId', options.sinceId);
      
      return apiFetch(`/alerts/recent?${params.toString()}`);
    },
    
    // Get ConsoleWarning alerts (geofence/battery/late night - have robocall data)
    getWarnings: async (options?: { limit?: number; sinceMinutes?: number; sinceId?: string }) => {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.sinceMinutes) params.set('sinceMinutes', options.sinceMinutes.toString());
      if (options?.sinceId) params.set('sinceId', options.sinceId);
      
      return apiFetch(`/alerts/warnings?${params.toString()}`);
    },
    
    getStats: async () => {
      return apiFetch('/alerts/stats');
    },
  },
  
  // CRM
  crm: {
    getVehicleDetails: async (identifier: string | number) => {
      return apiFetch(`/crm/${identifier}`);
    },
    // Vehicle Logs
    getLogTypes: async () => {
      return apiFetch('/crm/logs/types');
    },
    getLogSummary: async (vehicleId: number) => {
      return apiFetch(`/crm/logs/${vehicleId}/summary`);
    },
    getLogs: async (vehicleId: number, logType: string) => {
      return apiFetch(`/crm/logs/${vehicleId}/${logType}`);
    },
  },
  
  // Customer App (MobileApp database)
  customerApp: {
    getInfo: async (contactNumber: string) => {
      return apiFetch(`/customer-app/${contactNumber}/info`);
    },
    getNotifications: async (contactNumber: string, options?: { days?: number; vehicleReg?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.days) params.set('days', options.days.toString());
      if (options?.vehicleReg) params.set('vehicleReg', options.vehicleReg);
      if (options?.limit) params.set('limit', options.limit.toString());
      return apiFetch(`/customer-app/${contactNumber}/notifications?${params.toString()}`);
    },
    getVehicleNotifications: async (vehicleReg: string, options?: { days?: number; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.days) params.set('days', options.days.toString());
      if (options?.limit) params.set('limit', options.limit.toString());
      return apiFetch(`/customer-app/vehicle/${vehicleReg}/notifications?${params.toString()}`);
    },
  },
  
  // Robocall Status
  robocall: {
    getStatus: async (alertId: string | number) => {
      return apiFetch(`/robocall/${alertId}`);
    },
    getBatchStatus: async (alertIds: (string | number)[]) => {
      return apiFetch('/robocall/batch', {
        method: 'POST',
        body: JSON.stringify({ alertIds }),
      });
    },
    // Lookup by warningId (direct) or objectId + timestamp (fallback)
    lookupBatch: async (alerts: Array<{ id: string; reg?: string; warningId?: string; objectId?: string; alertType?: string; timestamp?: string }>) => {
      return apiFetch('/robocall/lookup', {
        method: 'POST',
        body: JSON.stringify({ alerts }),
      });
    },
    // Autocall history by plate number + date range
    getHistory: async (regNum: string, dateFrom: string, dateTo: string) => {
      const params = new URLSearchParams({ regNum, dateFrom, dateTo });
      return apiFetch(`/robocall/history?${params.toString()}`);
    },
  },
  
  // Track History
  track: {
    getHistory: async (objectId: number, fromDate: string, toDate: string, limit?: number) => {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
      });
      if (limit) params.set('limit', limit.toString());
      
      return apiFetch(`/track/${objectId}?${params.toString()}`);
    },
  },

  // Vehicle Closure / History (TDD-style: EventLog closure + Warning Console)
  closure: {
    get: async (
      objectId: number,
      fromDate: string,
      toDate: string,
      options?: { limit?: number; scope?: 'tdd' | 'all' }
    ) => {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
      });
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.scope) params.set('scope', options.scope);
      return apiFetch(`/closure/${objectId}?${params.toString()}`);
    },
    searchEvents: async (opts: {
      vehicle?: string;
      from: string;
      to: string;
      scope?: 'tdd' | 'all';
      limit?: number;
      offset?: number;
    }) => {
      const params = new URLSearchParams({
        from: opts.from,
        to: opts.to,
      });
      if (opts.vehicle) params.set('vehicle', opts.vehicle);
      if (opts.scope) params.set('scope', opts.scope);
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.offset) params.set('offset', String(opts.offset));
      return apiFetch(`/closure/search/events?${params.toString()}`);
    },
    searchWarnings: async (opts: {
      vehicle?: string;
      from: string;
      to: string;
      limit?: number;
      offset?: number;
    }) => {
      const params = new URLSearchParams({
        from: opts.from,
        to: opts.to,
      });
      if (opts.vehicle) params.set('vehicle', opts.vehicle);
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.offset) params.set('offset', String(opts.offset));
      return apiFetch(`/closure/search/warnings?${params.toString()}`);
    },
  },
  
  // CDR / Call History
  cdr: {
    // Calls where any of the customer's numbers appears as caller or callee
    getCustomerHistory: async (numbers: string[], dateFrom: string, dateTo: string) => {
      const params = new URLSearchParams({
        numbers: numbers.join(','),
        dateFrom,
        dateTo,
      });
      return apiFetch(`/cdr/customer?${params.toString()}`);
    },
  },

  // Database (for compatibility - maps to specific endpoints)
  db: {
    query: async (_query: string, _params?: any) => {
      // This is a legacy method - should not be used in web version
      console.warn('db.query is not available in web mode. Use specific API endpoints instead.');
      return { success: false, error: 'Not available in web mode' };
    },
  },
  
  // PostgreSQL (for compatibility)
  pg: {
    query: async (_query: string, _params?: any) => {
      console.warn('pg.query is not available in web mode. Use specific API endpoints instead.');
      return { success: false, error: 'Not available in web mode' };
    },
  },
  
  // App info
  app: {
    getVersion: () => '2.0.0-web',
  },
  
  // Calls / Softphone
  calls: {
    getConfig: async () => {
      return apiFetch('/calls/config');
    },
    
    originate: async (params: { extension: string; destination: string; callerId?: string; callerIdName?: string }) => {
      return apiFetch('/calls/originate', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
    
    hangup: async (channel: string) => {
      return apiFetch('/calls/hangup', {
        method: 'POST',
        body: JSON.stringify({ channel }),
      });
    },
    
    transfer: async (channel: string, destination: string) => {
      return apiFetch('/calls/transfer', {
        method: 'POST',
        body: JSON.stringify({ channel, destination }),
      });
    },
    
    getActiveCalls: async () => {
      return apiFetch('/calls/active');
    },
    
    getExtensionStatus: async (extension: string) => {
      return apiFetch(`/calls/extension/${extension}/status`);
    },
    
    getAmiStatus: async () => {
      return apiFetch('/calls/ami/status');
    },
  },
  
  // Alert Distribution
  distribution: {
    // Agent session
    login: async (userId: string, username: string, role?: string, extension?: string) => {
      return apiFetch('/distribution/login', {
        method: 'POST',
        body: JSON.stringify({ userId, username, role, extension }),
      });
    },
    logout: async (userId: string, extension?: string) => {
      return apiFetch('/distribution/logout', {
        method: 'POST',
        body: JSON.stringify({ userId, extension }),
      });
    },
    getSession: async (userId: string) => {
      return apiFetch(`/distribution/session?userId=${userId}`);
    },
    
    // Agent inbox
    getInbox: async (userId: string) => {
      return apiFetch(`/distribution/inbox?userId=${userId}`);
    },
    acknowledgeAlert: async (alertId: string, userId: string) => {
      return apiFetch(`/distribution/acknowledge/${alertId}`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
    },
    resolveAlert: async (alertId: string, userId: string, resolutionType: string, notes?: string) => {
      return apiFetch(`/distribution/resolve/${alertId}`, {
        method: 'POST',
        body: JSON.stringify({ userId, resolutionType, notes }),
      });
    },
    escalateAlert: async (alertId: string, userId: string, reason?: string) => {
      return apiFetch(`/distribution/escalate/${alertId}`, {
        method: 'POST',
        body: JSON.stringify({ userId, reason }),
      });
    },
    
    // Break management
    requestBreak: async (userId: string) => {
      return apiFetch('/distribution/request-break', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
    },
    cancelBreakRequest: async (userId: string) => {
      return apiFetch('/distribution/cancel-break-request', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
    },
    
    // Supervisor endpoints
    getAgents: async () => {
      return apiFetch('/distribution/agents');
    },
    getEscalated: async () => {
      return apiFetch('/distribution/escalated');
    },
    getPending: async () => {
      return apiFetch('/distribution/pending');
    },
    assignAlert: async (alertId: string, agentId: string, supervisorId?: string, reason?: string, force?: boolean) => {
      return apiFetch('/distribution/assign', {
        method: 'POST',
        body: JSON.stringify({ alertId, agentId, supervisorId, reason, force }),
      });
    },
    supervisorResolve: async (alertId: string, supervisorId: string, resolutionType: string, notes?: string) => {
      return apiFetch(`/distribution/supervisor-resolve/${alertId}`, {
        method: 'POST',
        body: JSON.stringify({ supervisorId, resolutionType, notes }),
      });
    },
    dismissAlerts: async (alertIds: string[], supervisorId: string, reason?: string) => {
      return apiFetch('/distribution/dismiss', {
        method: 'POST',
        body: JSON.stringify({ alertIds, supervisorId, reason }),
      });
    },
    updateMaxAlerts: async (userId: string, maxAlerts: number) => {
      return apiFetch(`/distribution/agent/${userId}/max-alerts`, {
        method: 'PUT',
        body: JSON.stringify({ maxAlerts }),
      });
    },
    approveBreak: async (userId: string, supervisorId?: string) => {
      return apiFetch(`/distribution/approve-break/${userId}`, {
        method: 'POST',
        body: JSON.stringify({ supervisorId }),
      });
    },
    endBreak: async (userId: string) => {
      return apiFetch(`/distribution/end-break/${userId}`, {
        method: 'POST',
      });
    },
    
    // Rules
    getRules: async () => {
      return apiFetch('/distribution/rules');
    },
    createRule: async (rule: { ruleType: string; ruleName: string; description?: string; config: any; priority?: number; createdBy?: string }) => {
      return apiFetch('/distribution/rules', {
        method: 'POST',
        body: JSON.stringify(rule),
      });
    },
    updateRule: async (ruleId: number, updates: { config?: any; isActive?: boolean; ruleName?: string; description?: string; priority?: number; ruleType?: string }) => {
      return apiFetch(`/distribution/rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    },
    deleteRule: async (ruleId: number) => {
      return apiFetch(`/distribution/rules/${ruleId}`, {
        method: 'DELETE',
      });
    },
    
    getSnapshot: async () => {
      return apiFetch('/distribution/snapshot');
    },
    getStats: async () => {
      return apiFetch('/distribution/stats');
    },
    getPerformance: async (userId: string, days?: number) => {
      const params = days ? `?days=${days}` : '';
      return apiFetch(`/distribution/performance/${userId}${params}`);
    },
    getAlertHistory: async (alertId: string) => {
      return apiFetch(`/distribution/alert/${alertId}/history`);
    },
    
    getResolved: async (limit = 50, offset = 0, agentId?: string, q?: string) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (agentId) params.set('agentId', agentId);
      if (q) params.set('q', q);
      return apiFetch(`/distribution/resolved?${params}`);
    },

    getAgentHistory: async (opts: {
      agentId?: string;
      status?: 'acknowledged' | 'resolved' | 'both';
      from?: string; // YYYY-MM-DD
      to?: string;   // YYYY-MM-DD
      q?: string;
      limit?: number;
      offset?: number;
    } = {}) => {
      const params = new URLSearchParams({
        limit: String(opts.limit ?? 50),
        offset: String(opts.offset ?? 0),
      });
      if (opts.agentId) params.set('agentId', opts.agentId);
      if (opts.status) params.set('status', opts.status);
      if (opts.from) params.set('from', opts.from);
      if (opts.to) params.set('to', opts.to);
      if (opts.q) params.set('q', opts.q);
      return apiFetch(`/distribution/agent-history?${params}`);
    },

    distributePending: async () => {
      return apiFetch('/distribution/distribute-pending', {
        method: 'POST',
      });
    },

    getAnalytics: async (days = 7) => {
      return apiFetch(`/distribution/analytics?days=${days}`);
    },
    getRecentActivity: async (limit = 50) => {
      return apiFetch(`/distribution/recent-activity?limit=${limit}`);
    },
    getVehicleHistory: async (vehicleReg: string, days = 90, limit = 100) => {
      return apiFetch(`/distribution/vehicle/${encodeURIComponent(vehicleReg)}/history?days=${days}&limit=${limit}`);
    },

    // Alert type configuration
    getAlertTypes: async () => {
      return apiFetch('/distribution/alert-types');
    },
    createAlertType: async (data: { eventName: string; category: string; severity?: string; matchMode?: string; userId?: string }) => {
      return apiFetch('/distribution/alert-types', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    updateAlertType: async (id: number, updates: { event_name?: string; category?: string; severity?: string; match_mode?: string; enabled?: boolean }) => {
      return apiFetch(`/distribution/alert-types/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    },
    deleteAlertType: async (id: number) => {
      return apiFetch(`/distribution/alert-types/${id}`, {
        method: 'DELETE',
      });
    },
    discoverEventNames: async (hours = 24) => {
      return apiFetch(`/distribution/event-names?hours=${hours}`);
    },
    getVehicleContext: async (alertId: string, objectId: number) => {
      return apiFetch(`/distribution/alert/${alertId}/vehicle-context?objectId=${objectId}`);
    },
    submitCrmLog: async (alertId: string, data: {
      objectId: number;
      comments: string;
      spokeTo?: string;
      callingNo?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      return apiFetch(`/distribution/alert/${alertId}/crm-log`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    getBanks: async () => {
      return apiFetch('/distribution/banks');
    },
    getCorporates: async () => {
      return apiFetch('/distribution/corporates');
    },
  },
};

// Check if running in Electron
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electron;
}

// Get the appropriate API (Electron IPC or HTTP)
export function getApi() {
  if (isElectron()) {
    return (window as any).electron;
  }
  return api;
}

// Export for direct import
export default api;
