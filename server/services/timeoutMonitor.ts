/**
 * Alert Timeout Monitor Service
 * Monitors for:
 * 1. Unacknowledged alerts (12-minute timeout → reassign)
 * 2. Acknowledged but unresolved alerts (30-minute timeout → auto-escalate)
 *
 * Production safety:
 * - Max 3 reassignments before forced supervisor escalation
 * - Notifies both the agent and supervisors on every timeout
 */

import {
  getTimedOutAlerts,
  getResolutionTimedOutAlerts,
  reassignAlert,
  escalateAlert,
  recordAlertHistory,
  updateAgentPerformance,
  getOnlineAgents,
  getActiveDistributionRules,
} from '../db/alertDistribution';
import { calculateAgentScore, isEventExcluded } from './distributionEngine';
import { sendToAgent, sendToSupervisors, broadcast } from '../index';

let monitorInterval: NodeJS.Timeout | null = null;
const MONITOR_INTERVAL_MS = 60000;
const ACK_TIMEOUT_MINUTES = 12;
const RESOLUTION_TIMEOUT_MINUTES = 30;
const MAX_REASSIGNMENT_COUNT = 3;

async function findAlternateAgent(
  excludeUserId: string,
  bankId?: number,
  corpId?: number,
  alertType?: string,
  eventName?: string,
  matchedEventName?: string,
): Promise<any | null> {
  let onlineAgents: any[], rules: any[];
  try {
    [onlineAgents, rules] = await Promise.all([getOnlineAgents(), getActiveDistributionRules()]);
  } catch (err: any) {
    console.warn('findAlternateAgent: cannot load agents/rules, skipping reassignment:', err.message);
    return null;
  }
  if (!onlineAgents || onlineAgents.length === 0) return null;

  // Build dedicated agent set — same logic as findBestAgent
  const dedicatedAgentIds = new Set<string>();
  for (const rule of rules) {
    const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
    for (const agentId of (cfg.agents || [])) dedicatedAgentIds.add(String(agentId));
  }

  const availableAgents = onlineAgents.filter(agent =>
    agent.user_id !== excludeUserId &&
    agent.status === 'online' &&
    agent.current_alert_count < (agent.max_alerts || 10)
  );
  if (availableAgents.length === 0) return null;

  // Mirror findBestAgent rule logic: if a rule matches, it is the authoritative
  // router. Pick the least-loaded available rule agent, or return null if all
  // are at capacity (alert stays pending rather than leaking to the fallback pool).
  for (const rule of rules) {
    const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;

    let ruleMatches = false;
    if (rule.rule_type === 'alert_type_routing' && alertType && cfg.alertType?.toLowerCase() === alertType.toLowerCase()) {
      ruleMatches = true;
    }
    if (rule.rule_type === 'bank_routing' && bankId && cfg.bankId && Number(cfg.bankId) === bankId) {
      if (!isEventExcluded(eventName, matchedEventName, cfg.excludeAlertTypes)) {
        ruleMatches = true;
      }
    }
    if (rule.rule_type === 'corporate_routing' && corpId && cfg.corpId && Number(cfg.corpId) === corpId) {
      if (!isEventExcluded(eventName, matchedEventName, cfg.excludeAlertTypes)) {
        ruleMatches = true;
      }
    }

    if (ruleMatches) {
      const ruleAgentIds = (cfg.agents || []).map(String);
      const ruleAvailable = availableAgents.filter(a => ruleAgentIds.includes(String(a.user_id)));
      if (ruleAvailable.length === 0) return null;
      return ruleAvailable.reduce((best: any, agent: any) =>
        (agent.current_alert_count || 0) < (best.current_alert_count || 0) ? agent : best
      );
    }
  }

  // No rule matched. Score-based fallback — excludes dedicated agents.
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
}

async function processAckTimeout(alert: any): Promise<void> {
  const alertId = alert.alert_id;
  const previousAgent = alert.assigned_to;
  const assignmentCount = alert.assignment_count || 1;

  console.log(`⏰ Alert ${alertId} ack-timeout (agent ${previousAgent}, reassigned ${assignmentCount}x)`);

  await recordAlertHistory(alertId, 'timeout', 'system', {
    previousAgent,
    timeoutMinutes: ACK_TIMEOUT_MINUTES,
    assignmentCount,
  });
  await updateAgentPerformance(previousAgent, { alertsTimeout: 1 });

  // H3: If already reassigned MAX times, force-escalate to supervisor
  if (assignmentCount >= MAX_REASSIGNMENT_COUNT) {
    await escalateAlert(alertId, previousAgent, 'supervisor',
      `Auto-escalated: unacknowledged after ${assignmentCount} reassignments`
    );

    sendToAgent(previousAgent, 'alert:timeout', {
      alertId,
      message: `Alert escalated to supervisor after ${assignmentCount} failed assignments`,
      reassignedFrom: previousAgent,
    });
    sendToSupervisors('alert:critical_escalation', {
      alertId,
      vehicleReg: alert.vehicle_reg,
      alertType: alert.alert_type,
      previousAgent,
      reason: `Unacknowledged after ${assignmentCount} reassignments`,
      priority: 1,
      requiresManualIntervention: true,
    });
    return;
  }

  const alertData = typeof alert.alert_data === 'string' ? JSON.parse(alert.alert_data) : (alert.alert_data || {});
  const newAgent = await findAlternateAgent(
    previousAgent,
    alertData.bankId,
    alertData.corpId,
    alert.alert_type,
    alertData.eventName,
    alertData.matchedEventName,
  );

  if (newAgent) {
    const reassigned = await reassignAlert(
      alertId, newAgent.user_id,
      `Timeout after ${ACK_TIMEOUT_MINUTES}min without acknowledgment`
    );

    console.log(`🔄 Alert ${alertId} reassigned: ${previousAgent} → ${newAgent.user_id}`);

    sendToAgent(newAgent.user_id, 'alert:assigned', {
      alert: {
        id: alertId,
        vehicleReg: alert.vehicle_reg,
        alertType: alert.alert_type,
        message: alert.alert_message,
        priority: alert.priority,
        reassigned: true,
        previousAgent,
        assignmentCount: assignmentCount + 1,
      },
      assignment: reassigned,
      isUrgent: true,
    });

    sendToAgent(previousAgent, 'alert:timeout', {
      alertId,
      message: `Alert reassigned due to ${ACK_TIMEOUT_MINUTES}-minute timeout`,
      reassignedFrom: previousAgent,
      reassignedTo: newAgent.user_id,
    });

    sendToSupervisors('alert:escalated', {
      alertId,
      vehicleReg: alert.vehicle_reg,
      alertType: alert.alert_type,
      previousAgent,
      newAgent: newAgent.user_id,
      reason: `Timeout after ${ACK_TIMEOUT_MINUTES}min`,
      isAutoEscalation: true,
      assignmentCount: assignmentCount + 1,
    });
  } else {
    console.log(`⚠️ Alert ${alertId} timed out, no agents available for reassignment`);
    sendToAgent(previousAgent, 'alert:timeout', {
      alertId,
      message: `Alert timeout — no agents available for reassignment`,
      needsAttention: true,
    });
    sendToSupervisors('alert:critical_escalation', {
      alertId,
      vehicleReg: alert.vehicle_reg,
      alertType: alert.alert_type,
      previousAgent,
      reason: `Timeout with no available agents`,
      priority: 1,
      requiresManualIntervention: true,
    });
  }
}

async function processResolutionTimeout(alert: any): Promise<void> {
  const alertId = alert.alert_id;
  const agentId = alert.assigned_to;

  console.log(`⏰ Alert ${alertId} resolution-timeout (agent ${agentId}, acknowledged but unresolved for ${RESOLUTION_TIMEOUT_MINUTES}min)`);

  await escalateAlert(alertId, agentId, 'supervisor',
    `Auto-escalated: acknowledged but unresolved after ${RESOLUTION_TIMEOUT_MINUTES}min`
  );

  await recordAlertHistory(alertId, 'resolution_timeout', 'system', {
    agentId,
    acknowledgedAt: alert.acknowledged_at,
    timeoutMinutes: RESOLUTION_TIMEOUT_MINUTES,
  });

  sendToAgent(agentId, 'alert:escalated', {
    alertId,
    message: `Alert auto-escalated — unresolved for ${RESOLUTION_TIMEOUT_MINUTES} minutes`,
  });

  sendToSupervisors('alert:critical_escalation', {
    alertId,
    vehicleReg: alert.vehicle_reg,
    alertType: alert.alert_type,
    previousAgent: agentId,
    reason: `Acknowledged but unresolved for ${RESOLUTION_TIMEOUT_MINUTES}min`,
    priority: 2,
    requiresManualIntervention: true,
  });
}

async function checkForTimeouts(): Promise<void> {
  try {
    // Check unacknowledged alerts
    const ackTimeouts = await getTimedOutAlerts(ACK_TIMEOUT_MINUTES);
    if (ackTimeouts && ackTimeouts.length > 0) {
      console.log(`⏰ Found ${ackTimeouts.length} unacknowledged timed-out alerts`);
      for (const alert of ackTimeouts) {
        try {
          await processAckTimeout(alert);
        } catch (err: any) {
          console.error(`Failed to process ack timeout for ${alert.alert_id}:`, err.message);
        }
      }
    }

    const resolutionTimeouts = await getResolutionTimedOutAlerts(RESOLUTION_TIMEOUT_MINUTES);
    if (resolutionTimeouts && resolutionTimeouts.length > 0) {
      console.log(`⏰ Found ${resolutionTimeouts.length} resolution timed-out alerts`);
      for (const alert of resolutionTimeouts) {
        try {
          await processResolutionTimeout(alert);
        } catch (err: any) {
          console.error(`Failed to process resolution timeout for ${alert.alert_id}:`, err.message);
        }
      }
    }

    const totalTimeouts = (ackTimeouts?.length || 0) + (resolutionTimeouts?.length || 0);
    if (totalTimeouts > 0) {
      broadcast('distribution:update', {
        timedOutCount: totalTimeouts,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    console.error('❌ Timeout monitor error:', error.message);
  }
}

export function startTimeoutMonitor(): void {
  if (monitorInterval) return;
  console.log(`⏰ Starting timeout monitor (${ACK_TIMEOUT_MINUTES}min ack, ${RESOLUTION_TIMEOUT_MINUTES}min resolution, checks every ${MONITOR_INTERVAL_MS / 1000}s)`);
  setTimeout(checkForTimeouts, 10000);
  monitorInterval = setInterval(checkForTimeouts, MONITOR_INTERVAL_MS);
}

export function stopTimeoutMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('⏰ Timeout monitor stopped');
  }
}

export async function triggerTimeoutCheck(): Promise<number> {
  try {
    const ackTimeouts = await getTimedOutAlerts(ACK_TIMEOUT_MINUTES);
    const resTimeouts = await getResolutionTimedOutAlerts(RESOLUTION_TIMEOUT_MINUTES);
    const all = [...(ackTimeouts || []), ...(resTimeouts || [])];
    for (const alert of ackTimeouts || []) {
      try { await processAckTimeout(alert); } catch (err: any) {
        console.error(`triggerTimeoutCheck: ack timeout failed for ${alert.alert_id}:`, err.message);
      }
    }
    for (const alert of resTimeouts || []) {
      try { await processResolutionTimeout(alert); } catch (err: any) {
        console.error(`triggerTimeoutCheck: resolution timeout failed for ${alert.alert_id}:`, err.message);
      }
    }
    return all.length;
  } catch (err: any) {
    console.error('triggerTimeoutCheck error:', err.message);
    return 0;
  }
}

export default { start: startTimeoutMonitor, stop: stopTimeoutMonitor, check: triggerTimeoutCheck };
