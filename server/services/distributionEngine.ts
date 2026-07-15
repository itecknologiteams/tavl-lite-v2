/**
 * Alert Distribution Engine
 * Handles smart distribution of alerts to agents based on:
 * - Least-loaded algorithm (40%)
 * - Performance score (30%)
 * - Low escalation rate (20%)
 * - Random factor for fairness (10%)
 *
 * Production features:
 * - In-memory performance score cache (refreshes every 5 min)
 * - Alert dedup: max 1 alert per vehicle+type within 5-min window
 * - Gradual ramp: max 3 new alerts per agent per distribution cycle
 * - Priority preemption: panic/SOS can exceed normal capacity by 2
 */

import {
  getOnlineAgents,
  getAgentAlerts,
  createAlertAssignment,
  assignAlertToAgent,
  resetAlertToPending,
  getPendingAlerts,
  getActiveDistributionRules,
  recordAlertHistory,
  updateAgentPerformance,
  getAgentPerformance,
} from '../db/alertDistribution';
import { sendToAgent, sendToSupervisors } from '../index';

// ==================== CONSTANTS ====================

const ALERT_PRIORITY: Record<string, number> = {
  'panic': 1,
  'sos': 1,
  'battery': 2,
  'battery_disconnect': 2,
  'geofence': 3,
  'geofence_exit': 3,
  'late_night': 4,
  'late_night_movement': 4,
  'default': 5,
};

const CRITICAL_ALERT_TYPES = new Set(['panic', 'sos']);
const CRITICAL_OVERFLOW_SLOTS = 2;

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ALERTS_PER_AGENT_PER_CYCLE = 3;
const PERF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Battery-family events get throttled to one alert per vehicle per clock-hour
// (e.g. 15:00–15:59 fires once; 16:15 fires again because it's a new bucket).
const BATTERY_FAMILY_KEYWORDS = ['battery', 'power', 'voltage'];
const BATTERY_HOUR_TTL_MS = 2 * 60 * 60 * 1000; // keep entries 2h to cover boundary skew

// ==================== DEDUP CACHE ====================

const recentAlerts = new Map<string, number>(); // "vehicleReg|alertType" → timestamp
const batteryHourLock = new Map<string, number>(); // "vehicleReg|YYYY-MM-DD-HH" → timestamp

function dedupKey(vehicleReg: string | undefined, alertType: string): string {
  return `${(vehicleReg || 'unknown').toLowerCase()}|${alertType.toLowerCase()}`;
}

function isDuplicate(vehicleReg: string | undefined, alertType: string): boolean {
  const key = dedupKey(vehicleReg, alertType);
  const lastSeen = recentAlerts.get(key);
  const now = Date.now();
  return !!(lastSeen && now - lastSeen < DEDUP_WINDOW_MS);
}

function markSeen(vehicleReg: string | undefined, alertType: string): void {
  recentAlerts.set(dedupKey(vehicleReg, alertType), Date.now());
}

function isBatteryFamily(alertType: string): boolean {
  const lower = (alertType || '').toLowerCase();
  return BATTERY_FAMILY_KEYWORDS.some(p => lower.includes(p));
}

function hourBucket(when: unknown): string {
  let d: Date;
  if (when instanceof Date) d = when;
  else if (typeof when === 'string' || typeof when === 'number') d = new Date(when);
  else d = new Date();
  if (isNaN(d.getTime())) d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

function batteryKey(vehicleReg: string | undefined, when: unknown): string {
  return `${(vehicleReg || 'unknown').toLowerCase()}|${hourBucket(when)}`;
}

function isBatterySuppressed(vehicleReg: string | undefined, alertType: string, when: unknown): boolean {
  if (!isBatteryFamily(alertType)) return false;
  return batteryHourLock.has(batteryKey(vehicleReg, when));
}

function markBatterySeen(vehicleReg: string | undefined, alertType: string, when: unknown): void {
  if (!isBatteryFamily(alertType)) return;
  batteryHourLock.set(batteryKey(vehicleReg, when), Date.now());
}

// Prune stale dedup + perf cache entries every 10 minutes
const pruneInterval = setInterval(() => {
  const dedupCutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, ts] of recentAlerts) {
    if (ts < dedupCutoff) recentAlerts.delete(key);
  }
  const batteryCutoff = Date.now() - BATTERY_HOUR_TTL_MS;
  for (const [key, ts] of batteryHourLock) {
    if (ts < batteryCutoff) batteryHourLock.delete(key);
  }
  const perfCutoff = Date.now() - PERF_CACHE_TTL_MS * 2;
  for (const [key, entry] of perfCache) {
    if (entry.fetchedAt < perfCutoff) perfCache.delete(key);
  }
}, 10 * 60 * 1000);

export function stopDistributionEngine(): void {
  clearInterval(pruneInterval);
  recentAlerts.clear();
  batteryHourLock.clear();
  perfCache.clear();
}

// ==================== PERFORMANCE SCORE CACHE ====================

interface CachedScore {
  performanceScore: number;
  escalationScore: number;
  fetchedAt: number;
}

const perfCache = new Map<string, CachedScore>();

async function getAgentScores(userId: string): Promise<{ performanceScore: number; escalationScore: number }> {
  const cached = perfCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < PERF_CACHE_TTL_MS) {
    return cached;
  }

  let performanceScore = 5;
  let escalationScore = 8;

  try {
    const perfData = await getAgentPerformance(userId, 7);
    if (perfData && perfData.length > 0) {
      const totals = perfData.reduce((acc, day) => ({
        resolved: acc.resolved + (day.alerts_resolved || 0),
        escalated: acc.escalated + (day.alerts_escalated || 0),
        received: acc.received + (day.alerts_received || 0),
      }), { resolved: 0, escalated: 0, received: 0 });

      if (totals.received > 0) {
        performanceScore = (totals.resolved / totals.received) * 10;
        escalationScore = (1 - totals.escalated / totals.received) * 10;
      }
    }
  } catch {
    // defaults
  }

  const entry = { performanceScore, escalationScore, fetchedAt: Date.now() };
  perfCache.set(userId, entry);
  return entry;
}

// ==================== PUBLIC API ====================

export const getAlertPriority = (alertType: string): number => {
  const type = alertType.toLowerCase().replace(/\s+/g, '_');
  return ALERT_PRIORITY[type] || ALERT_PRIORITY['default'];
};

export const calculateAgentScore = async (agent: any): Promise<number> => {
  const maxAlerts = agent.max_alerts || 10;
  const currentAlerts = agent.current_alert_count || 0;
  const loadScore = ((maxAlerts - currentAlerts) / maxAlerts) * 10;

  const { performanceScore, escalationScore } = await getAgentScores(agent.user_id);
  const randomFactor = Math.random() * 10;

  return (loadScore * 0.4) + (performanceScore * 0.3) + (escalationScore * 0.2) + (randomFactor * 0.1);
};

// Throttle for capacity warning logs
let lastCapacityWarning = 0;
const CAPACITY_WARNING_THROTTLE_MS = 60000;

function isCriticalAlert(alertType: string): boolean {
  return CRITICAL_ALERT_TYPES.has(alertType.toLowerCase());
}

export function isEventExcluded(
  eventName: string | undefined,
  matchedEventName: string | undefined,
  excludeList: unknown,
): boolean {
  if (!Array.isArray(excludeList) || excludeList.length === 0) return false;
  const needles = excludeList
    .map((e: any) => String(e || '').trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (needles.length === 0) return false;
  const candidates = [eventName, matchedEventName]
    .filter((v): v is string => !!v)
    .map((v) => v.trim().toLowerCase());
  return candidates.some((c) => needles.includes(c));
}

export const findBestAgent = async (alertType: string, vehicleReg?: string, bankId?: number, corpId?: number, eventName?: string, matchedEventName?: string): Promise<any | null> => {
  const onlineAgents = await getOnlineAgents();

  if (!onlineAgents || onlineAgents.length === 0) {
    const now = Date.now();
    if (now - lastCapacityWarning > CAPACITY_WARNING_THROTTLE_MS) {
      console.log('⚠️ No online agents available for alert distribution');
      lastCapacityWarning = now;
    }
    return null;
  }

  const critical = isCriticalAlert(alertType);

  // For critical alerts, allow overflow beyond normal capacity
  const availableAgents = onlineAgents.filter(agent => {
    if (agent.status !== 'online') return false;
    const max = (agent.max_alerts || 10) + (critical ? CRITICAL_OVERFLOW_SLOTS : 0);
    return (agent.current_alert_count || 0) < max;
  });

  if (availableAgents.length === 0) {
    const now = Date.now();
    if (now - lastCapacityWarning > CAPACITY_WARNING_THROTTLE_MS) {
      const totalCapacity = onlineAgents.reduce((sum, a) => sum + (a.max_alerts || 10), 0);
      const currentLoad = onlineAgents.reduce((sum, a) => sum + (a.current_alert_count || 0), 0);
      console.log(`⚠️ All ${onlineAgents.length} agents at maximum capacity (${currentLoad}/${totalCapacity} alerts assigned)`);
      lastCapacityWarning = now;
    }
    return null;
  }

  // Load active rules once — used for both matching AND fallback exclusion.
  // If rules fail to load, abort rather than treating all agents as non-dedicated.
  let rules: any[] = [];
  try {
    rules = await getActiveDistributionRules();
  } catch (e: any) {
    console.warn('⚠️ Cannot load distribution rules, skipping assignment:', e.message);
    return null;
  }

  // Build the set of agents dedicated to at least one rule.
  // A dedicated agent only receives alerts that explicitly match their rule —
  // they are never chosen by the score-based fallback for unrelated alerts.
  const dedicatedAgentIds = new Set<string>();
  for (const rule of rules) {
    const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
    for (const agentId of (cfg.agents || [])) dedicatedAgentIds.add(String(agentId));
  }

  // Evaluate rules in priority order (DB already returns them sorted ASC).
  // If a rule matches, it is the authoritative router for this alert:
  //   - Pick the least-loaded available agent from that rule's agent list.
  //   - If the rule matched but ALL its agents are at capacity → return null
  //     (alert stays pending until a dedicated agent has room; never falls
  //     through to the next rule or the score-based fallback pool).
  for (const rule of rules) {
    const config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;

    let ruleMatches = false;
    if (rule.rule_type === 'alert_type_routing' && config.alertType?.toLowerCase() === alertType.toLowerCase()) {
      ruleMatches = true;
    }
    if (rule.rule_type === 'bank_routing' && bankId && config.bankId && Number(config.bankId) === bankId) {
      if (!isEventExcluded(eventName, matchedEventName, config.excludeAlertTypes)) {
        ruleMatches = true;
      }
    }
    if (rule.rule_type === 'corporate_routing' && corpId && config.corpId && Number(config.corpId) === corpId) {
      // Skip this rule if the alert's event name (raw or alert-type-config
      // matched pattern) is in the rule's exclude list. The alert then falls
      // through to other rules / score-based fallback.
      if (!isEventExcluded(eventName, matchedEventName, config.excludeAlertTypes)) {
        ruleMatches = true;
      }
    }

    if (ruleMatches) {
      const ruleAgentIds = (config.agents || []).map(String);
      const ruleAvailable = availableAgents.filter(a => ruleAgentIds.includes(String(a.user_id)));

      if (ruleAvailable.length === 0) {
        // Rule matched but every dedicated agent is at capacity — keep the alert pending.
        return null;
      }

      // Pick the least-loaded agent among those available in this rule.
      return ruleAvailable.reduce((best: any, agent: any) =>
        (agent.current_alert_count || 0) < (best.current_alert_count || 0) ? agent : best
      );
    }
  }

  // No rule matched. Score-based fallback — excludes dedicated agents so they
  // are never assigned alerts outside their configured rules.
  const fallbackPool = availableAgents.filter(a => !dedicatedAgentIds.has(String(a.user_id)));

  if (fallbackPool.length === 0) return null;

  let bestAgent = null;
  let bestScore = -1;
  for (const agent of fallbackPool) {
    const score = await calculateAgentScore(agent);
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return bestAgent;
};

// Distribute a single alert
export const distributeAlert = async (alert: {
  id: string;
  type: string;
  eventName?: string;
  matchedEventName?: string;
  vehicleReg?: string;
  customerName?: string;
  bankId?: number;
  corpId?: number;
  message?: string;
  data?: any;
}): Promise<{ success: boolean; assignedTo?: string; alertAssignment?: any }> => {
  // Battery-family throttle: at most one alert per vehicle per clock-hour
  // (15:00–15:59 fires once; 16:15 fires again as it's a new hour bucket).
  const occurredAt = alert.data?.occurredAt;
  if (isBatterySuppressed(alert.vehicleReg, alert.type, occurredAt)) {
    return { success: false };
  }

  // C5: Dedup — skip if same vehicle+type within 5 min window
  if (isDuplicate(alert.vehicleReg, alert.type)) {
    return { success: false };
  }

  const priority = getAlertPriority(alert.type);

  const alertAssignment = await createAlertAssignment({
    alertId: alert.id,
    alertType: alert.type,
    vehicleReg: alert.vehicleReg,
    customerName: alert.customerName,
    alertMessage: alert.message,
    alertData: alert.data,
    priority,
  });

  if (!alertAssignment) {
    return { success: false };
  }

  // Only mark as seen after the assignment row was created successfully
  markSeen(alert.vehicleReg, alert.type);
  markBatterySeen(alert.vehicleReg, alert.type, occurredAt);

  const bestAgent = await findBestAgent(alert.type, alert.vehicleReg, alert.bankId, alert.corpId, alert.eventName, alert.matchedEventName);

  if (!bestAgent) {
    await recordAlertHistory(alert.id, 'created', 'system', {
      status: 'pending',
      reason: 'No available agents',
    });
    return { success: true, alertAssignment };
  }

  const assigned = await assignAlertToAgent(alert.id, bestAgent.user_id);
  if (!assigned) {
    // Another concurrent call already assigned this alert
    return { success: true, alertAssignment };
  }

  await recordAlertHistory(alert.id, 'assigned', 'system', {
    assignedTo: bestAgent.user_id,
    agentName: bestAgent.username,
    priority,
  });

  await updateAgentPerformance(bestAgent.user_id, { alertsReceived: 1 });

  return {
    success: true,
    assignedTo: bestAgent.user_id,
    alertAssignment: assigned,
  };
};

// C4: Gradual ramp — distribute pending with per-agent cap per cycle
let distributing = false;

export const distributePendingAlerts = async (): Promise<number> => {
  if (distributing) return 0;
  distributing = true;

  let pendingAlerts: any[];
  try {
    pendingAlerts = await getPendingAlerts();
  } catch (err) {
    distributing = false;
    throw err;
  }

  if (pendingAlerts.length === 0) {
    distributing = false;
    return 0;
  }

  console.log(`📬 Distributing ${pendingAlerts.length} pending alerts...`);

  let distributed = 0;
  const agentAssignedThisCycle = new Map<string, number>();

  try {
    for (const alert of pendingAlerts) {
      try {
        const alertData = typeof alert.alert_data === 'string' ? JSON.parse(alert.alert_data) : (alert.alert_data || {});
        const bestAgent = await findBestAgent(alert.alert_type, alert.vehicle_reg, alertData.bankId, alertData.corpId, alertData.eventName, alertData.matchedEventName);

        if (!bestAgent) continue;

        const alreadyAssigned = agentAssignedThisCycle.get(bestAgent.user_id) || 0;
        if (alreadyAssigned >= MAX_ALERTS_PER_AGENT_PER_CYCLE) continue;

        const assigned = await assignAlertToAgent(alert.alert_id, bestAgent.user_id);
        if (!assigned) continue;

        await recordAlertHistory(alert.alert_id, 'assigned', 'system', {
          assignedTo: bestAgent.user_id,
          agentName: bestAgent.username,
          fromPendingQueue: true,
        });

        await updateAgentPerformance(bestAgent.user_id, { alertsReceived: 1 });

        sendToAgent(bestAgent.user_id, 'alert:assigned', {
          assignment: assigned,
          isUrgent: isCriticalAlert(alert.alert_type),
        });

        agentAssignedThisCycle.set(bestAgent.user_id, alreadyAssigned + 1);
        distributed++;
      } catch (err: any) {
        console.error(`Failed to distribute pending alert ${alert.alert_id}:`, err.message);
      }
    }

    if (distributed > 0) {
      console.log(`✅ Distributed ${distributed}/${pendingAlerts.length} pending alerts`);
    }
  } finally {
    distributing = false;
  }

  return distributed;
};

export const mapAlertCategory = (category: string): string => {
  const categoryMap: Record<string, string> = {
    'geofence': 'geofence',
    'battery': 'battery',
    'latenight': 'late_night',
    'panic': 'panic',
    'sos': 'panic',
  };
  return categoryMap[category.toLowerCase()] || category.toLowerCase();
};

export interface DistributedAlert {
  alertId: string;
  alertType: string;
  vehicleReg: string;
  customerName?: string;
  message: string;
  priority: number;
  assignedTo: string;
  assignedAt: Date;
}

/**
 * Enforce rule isolation: for every agent that appears in at least one active rule,
 * find their unacknowledged assigned alerts that do NOT match any of their rules
 * and return those alerts to the pending pool so they can be routed correctly.
 *
 * Called on: agent login, rule create/update/toggle.
 */
export const enforceRuleIsolation = async (): Promise<number> => {
  let rules: any[] = [];
  try {
    rules = await getActiveDistributionRules();
  } catch { return 0; }
  if (rules.length === 0) return 0;

  // Build map: agentId → their rule criteria
  type RuleCriteria = { ruleType: string; bankId?: number; corpId?: number; alertType?: string };
  const agentRuleMap = new Map<string, RuleCriteria[]>();
  for (const rule of rules) {
    const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
    for (const agentId of (cfg.agents || [])) {
      const key = String(agentId);
      if (!agentRuleMap.has(key)) agentRuleMap.set(key, []);
      agentRuleMap.get(key)!.push({
        ruleType: rule.rule_type,
        bankId: cfg.bankId != null ? Number(cfg.bankId) : undefined,
        corpId: cfg.corpId != null ? Number(cfg.corpId) : undefined,
        alertType: cfg.alertType,
        excludeAlertTypes: cfg.excludeAlertTypes,
      });
    }
  }

  let reassigned = 0;
  for (const [agentId, agentRules] of agentRuleMap) {
    let agentAlerts: any[];
    try {
      agentAlerts = await getAgentAlerts(agentId);
    } catch { continue; }

    // Only touch unacknowledged (status='assigned') — leave acked ones alone
    const unacked = agentAlerts.filter((a: any) => a.status === 'assigned' && !a.acknowledged_at);

    for (const alert of unacked) {
      const ad = typeof alert.alert_data === 'string'
        ? JSON.parse(alert.alert_data)
        : (alert.alert_data || {});

      const matches = agentRules.some(r => {
        if (r.ruleType === 'bank_routing') {
          if (ad.bankId == null || Number(ad.bankId) !== r.bankId) return false;
          if (isEventExcluded(ad.eventName, ad.matchedEventName, r.excludeAlertTypes)) return false;
          return true;
        }
        if (r.ruleType === 'corporate_routing') {
          if (ad.corpId == null || Number(ad.corpId) !== r.corpId) return false;
          if (isEventExcluded(ad.eventName, ad.matchedEventName, r.excludeAlertTypes)) return false;
          return true;
        }
        if (r.ruleType === 'alert_type_routing')
          return r.alertType != null && alert.alert_type?.toLowerCase() === r.alertType.toLowerCase();
        return false;
      });

      if (!matches) {
        try {
          const reset = await resetAlertToPending(alert.alert_id, agentId);
          if (reset) reassigned++;
        } catch { /* non-fatal */ }
      }
    }
  }

  if (reassigned > 0) {
    console.log(`🔄 Rule isolation: returned ${reassigned} non-matching alerts to pending pool`);
  }
  return reassigned;
};
