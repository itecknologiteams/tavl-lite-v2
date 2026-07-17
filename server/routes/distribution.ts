/**
 * Alert Distribution API Routes
 * Handles agent inbox, acknowledgment, resolution, escalation, and supervisor controls
 */
import { Router, Request, Response, NextFunction } from 'express';
import {
  upsertAgentSession,
  updateAgentStatus,
  getAgentSession,
  getAllAgentSessions,
  getAgentAlerts,
  acknowledgeAlert,
  resolveAlert,
  supervisorResolveAlert,
  bulkDismissAlerts,
  updateAgentMaxAlerts,
  RESOLUTION_TYPES,
  escalateAlert,
  reassignAlert,
  getEscalatedAlerts,
  getPendingAlerts,
  getAlertById,
  getAlertHistory,
  recordAlertHistory,
  updateAgentPerformance,
  getAgentPerformance,
  getAllAgentPerformanceToday,
  getDistributionStats,
  createDistributionRule,
  getActiveDistributionRules,
  getAllDistributionRules,
  updateDistributionRule,
  deleteDistributionRule,
  addAlertComment,
  getAlertComments,
  upsertShiftSchedule,
  getAgentShifts,
  getAllShifts,
  deleteShift,
  getAlertTypeConfigs,
  createAlertTypeConfig,
  updateAlertTypeConfig,
  deleteAlertTypeConfig,
} from '../db/alertDistribution';
import { distributeAlert, distributePendingAlerts, enforceRuleIsolation, isEventExcluded } from '../services/distributionEngine';
import { reloadAlertTypeConfigs } from '../websocket/alerts';
import { queryTracking } from '../db/tavl';
import { queryCrm } from '../db/crm';
import { sendToAgent, sendToSupervisors, broadcast } from '../index';
import eslConnection from '../freeswitch/esl';

const AUTOCALL_QUEUE = process.env.AUTOCALL_QUEUE || 'tavl-agents';

// Extensions authorised to receive callcenter queue calls (mirrors callcenter.conf.xml agents).
// Only these extensions will be dynamically added/removed from the queue on login/logout.
// NOTE: 453 and 456 are SUPERVISOR extensions — deliberately excluded so inbound queue
// calls are never offered to them (reconcile evicts them; login gate rejects them).
export const QUEUE_AGENT_EXTENSIONS = new Set([
  '449','450','451','452','454','455','457','458','459',
  '460','461','462','463','464','465','466','467','468','999',
]);

const router = Router();

const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req.headers['x-user-id'] || req.body?.userId || req.query?.userId || req.params?.userId) as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    try {
      const session = await getAgentSession(userId);
      if (!session) {
        return res.status(401).json({ success: false, error: 'No active session' });
      }
      if (!allowedRoles.includes(session.role)) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions' });
      }
      (req as any).agentSession = session;
      next();
    } catch {
      return res.status(500).json({ success: false, error: 'Auth check failed' });
    }
  };
};

// ============================================
// Agent Session Management
// ============================================

/**
 * POST /api/distribution/login
 * Register agent session when they log in
 */
router.post('/login', async (req, res) => {
  const { userId, username, role, extension } = req.body;
  
  if (!userId || !username) {
    return res.status(400).json({
      success: false,
      error: 'userId and username are required',
    });
  }
  
  try {
    const session = await upsertAgentSession(userId, username, role || 'agent', undefined, extension);
    console.log(`🔑 Agent logged in: ${username} (${role || 'agent'})`);
    
    // Auto-join callcenter queues only for authorised queue-agent extensions.
    if (extension && (role || 'agent') === 'agent' && QUEUE_AGENT_EXTENSIONS.has(String(extension))) {
      const queuesToJoin = [AUTOCALL_QUEUE, 'uan-queue'];
      for (const q of queuesToJoin) {
        try {
          const queueResult = await eslConnection.queueAddMember(q, extension);
          if (queueResult.success) {
            console.log(`📞 Agent ${username} (ext ${extension}) auto-joined queue ${q}`);
          }
        } catch (err: any) {
          console.warn(`⚠️ Could not auto-join queue ${q}: ${err.message}`);
        }
      }
    } else if (extension && (role || 'agent') === 'agent') {
      console.log(`ℹ️  Agent ${username} (ext ${extension}) logged in — not a queue agent, skipping queue join`);
    }
    
    // Return any non-rule-matching alerts from this agent to the pending pool
    enforceRuleIsolation().catch((e) => console.error('❌ enforceRuleIsolation failed:', e?.message || e));

    // Notify supervisors of agent login
    sendToSupervisors('agent:login', {
      userId,
      username,
      role: role || 'agent',
      status: 'online',
      extension,
      loginTime: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error('❌ Agent login error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/logout
 * Mark agent as offline
 */
router.post('/logout', async (req, res) => {
  const { userId, extension } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const session = await getAgentSession(userId);
    await updateAgentStatus(userId, 'offline');
    console.log(`👋 Agent logged out: ${userId}`);

    // Auto-leave all Asterisk queues if extension provided
    if (extension) {
      const queuesToLeave = [AUTOCALL_QUEUE, 'uan-queue'];
      for (const q of queuesToLeave) {
        try {
          const queueResult = await eslConnection.queueRemoveMember(q, extension);
          if (queueResult.success) {
            console.log(`📞 Agent ${userId} (ext ${extension}) removed from queue ${q}`);
          }
        } catch (err: any) {
          console.warn(`⚠️ Could not remove from queue ${q}: ${err.message}`);
        }
      }
    }
    
    sendToSupervisors('agent:logout', {
      userId,
      username: session?.username || userId,
      status: 'offline',
      extension,
      logoutTime: new Date().toISOString(),
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Agent logout error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/distribution/session
 * Get current agent session
 */
router.get('/session', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const userId = req.query.userId as string;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const session = await getAgentSession(userId);
    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// Agent Inbox & Alert Actions
// ============================================

/**
 * GET /api/distribution/inbox
 * Get agent's assigned alerts
 */
router.get('/inbox', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const userId = req.query.userId as string;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const [alerts, session, rules] = await Promise.all([
      getAgentAlerts(userId),
      getAgentSession(userId),
      getActiveDistributionRules(),
    ]);

    // Find rules this agent belongs to
    const agentRules = rules.filter((r: any) => {
      const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
      return (cfg.agents || []).map(String).includes(String(userId));
    });

    const matchesAgentRules = (alert: any): boolean => {
      if (agentRules.length === 0) return true; // no rules → show everything
      const ad = typeof alert.alert_data === 'string' ? JSON.parse(alert.alert_data) : (alert.alert_data || {});
      return agentRules.some((r: any) => {
        const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
        if (r.rule_type === 'bank_routing') {
          if (ad.bankId == null || Number(ad.bankId) !== Number(cfg.bankId)) return false;
          if (isEventExcluded(ad.eventName, ad.matchedEventName, cfg.excludeAlertTypes)) return false;
          return true;
        }
        if (r.rule_type === 'corporate_routing') {
          if (ad.corpId == null || Number(ad.corpId) !== Number(cfg.corpId)) return false;
          if (isEventExcluded(ad.eventName, ad.matchedEventName, cfg.excludeAlertTypes)) return false;
          return true;
        }
        if (r.rule_type === 'alert_type_routing') return alert.alert_type?.toLowerCase() === cfg.alertType?.toLowerCase();
        return false;
      });
    };

    // Separate into unacknowledged and acknowledged; filter by rules for dedicated agents
    const unacknowledged = alerts.filter((a: any) => !a.acknowledged_at && matchesAgentRules(a));
    const acknowledged = alerts.filter((a: any) => a.acknowledged_at && matchesAgentRules(a));

    res.json({
      success: true,
      data: {
        unacknowledged,
        acknowledged,
        total: unacknowledged.length + acknowledged.length,
        session,
      },
    });
  } catch (error: any) {
    console.error('❌ Get inbox error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/acknowledge/:alertId
 * Acknowledge an alert
 */
router.post('/acknowledge/:alertId', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { alertId } = req.params;
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const alert = await acknowledgeAlert(alertId, userId);
    
    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found or not assigned to you',
      });
    }
    
    // Calculate time to acknowledge
    const assignedAt = new Date(alert.assigned_at);
    const acknowledgedAt = new Date(alert.acknowledged_at);
    const ackTimeSeconds = Math.round((acknowledgedAt.getTime() - assignedAt.getTime()) / 1000);
    
    // Record history
    await recordAlertHistory(alertId, 'acknowledged', userId, {
      acknowledgeTimeSeconds: ackTimeSeconds,
    }, ackTimeSeconds);
    
    // Update performance
    await updateAgentPerformance(userId, { alertsAcknowledged: 1 });
    
    console.log(`✅ Alert ${alertId} acknowledged by ${userId} (${ackTimeSeconds}s)`);
    
    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    console.error('❌ Acknowledge error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/resolve/:alertId
 * Resolve an alert
 */
router.post('/resolve/:alertId', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { alertId } = req.params;
  const { userId, resolutionType, notes } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }

  if (!resolutionType || !(RESOLUTION_TYPES as readonly string[]).includes(resolutionType)) {
    return res.status(400).json({
      success: false,
      error: `resolutionType is required. Valid values: ${RESOLUTION_TYPES.join(', ')}`,
    });
  }
  
  try {
    const alert = await resolveAlert(alertId, userId, resolutionType, notes);
    
    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found or not assigned to you',
      });
    }
    
    const assignedAt = new Date(alert.assigned_at);
    const resolvedAt = new Date(alert.resolved_at);
    const handlingTimeSeconds = Math.round((resolvedAt.getTime() - assignedAt.getTime()) / 1000);
    
    await recordAlertHistory(alertId, 'resolved', userId, {
      resolutionType,
      notes,
      handlingTimeSeconds,
    }, handlingTimeSeconds);
    
    await updateAgentPerformance(userId, { 
      alertsResolved: 1,
      handlingTimeSeconds,
    });
    
    console.log(`✅ Alert ${alertId} resolved by ${userId} [${resolutionType}] (${handlingTimeSeconds}s)`);
    
    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    console.error('❌ Resolve error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/supervisor-resolve/:alertId
 * Supervisor resolves an alert from any state (pending, assigned, acknowledged, escalated)
 */
router.post('/supervisor-resolve/:alertId', requireRole('supervisor', 'admin'), async (req, res) => {
  const { alertId } = req.params;
  const { supervisorId, resolutionType, notes } = req.body;

  if (!supervisorId) {
    return res.status(400).json({ success: false, error: 'supervisorId is required' });
  }
  if (!resolutionType || !(RESOLUTION_TYPES as readonly string[]).includes(resolutionType)) {
    return res.status(400).json({
      success: false,
      error: `resolutionType is required. Valid values: ${RESOLUTION_TYPES.join(', ')}`,
    });
  }

  try {
    const alert = await supervisorResolveAlert(alertId, supervisorId, resolutionType, notes);
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Alert not found or already resolved' });
    }

    const handlingTime = alert.assigned_at && alert.resolved_at
      ? Math.round((new Date(alert.resolved_at).getTime() - new Date(alert.assigned_at).getTime()) / 1000)
      : null;

    await recordAlertHistory(alertId, 'supervisor_resolved', supervisorId, {
      resolutionType,
      notes,
      previousStatus: alert.status,
      handlingTimeSeconds: handlingTime,
    }, handlingTime ?? undefined);

    console.log(`✅ Alert ${alertId} supervisor-resolved by ${supervisorId} [${resolutionType}]`);
    res.json({ success: true, data: alert });
  } catch (error: any) {
    console.error('❌ Supervisor resolve error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/distribution/dismiss
 * Supervisor bulk-dismiss stale alerts
 */
router.post('/dismiss', requireRole('supervisor', 'admin'), async (req, res) => {
  const { alertIds, supervisorId, reason } = req.body;

  if (!Array.isArray(alertIds) || alertIds.length === 0) {
    return res.status(400).json({ success: false, error: 'alertIds array is required' });
  }
  if (alertIds.length > 200) {
    return res.status(400).json({ success: false, error: 'Max 200 alerts per batch' });
  }

  try {
    const dismissed = await bulkDismissAlerts(alertIds, supervisorId || 'supervisor', reason || 'Dismissed by supervisor');

    for (const id of alertIds) {
      await recordAlertHistory(id, 'dismissed', supervisorId || 'supervisor', { reason });
    }

    console.log(`🗑️ ${dismissed} alerts dismissed by ${supervisorId}`);
    res.json({ success: true, data: { dismissed } });
  } catch (error: any) {
    console.error('❌ Dismiss error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/distribution/agent/:userId/max-alerts
 * Update agent's max alert capacity
 */
router.put('/agent/:userId/max-alerts', requireRole('supervisor', 'admin'), async (req, res) => {
  const { userId } = req.params;
  const { maxAlerts } = req.body;

  if (typeof maxAlerts !== 'number' || maxAlerts < 1 || maxAlerts > 50) {
    return res.status(400).json({ success: false, error: 'maxAlerts must be a number between 1 and 50' });
  }

  try {
    const agent = await updateAgentMaxAlerts(userId, maxAlerts);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent session not found' });
    }

    console.log(`⚙️ Agent ${userId} max_alerts updated to ${maxAlerts}`);
    res.json({ success: true, data: agent });
  } catch (error: any) {
    console.error('❌ Update max alerts error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/distribution/escalate/:alertId
 * Escalate an alert to supervisor
 */
router.post('/escalate/:alertId', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { alertId } = req.params;
  const { userId, supervisorId, reason } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    // Default supervisor ID if not provided
    const targetSupervisor = supervisorId || 'supervisor';
    
    const alert = await escalateAlert(alertId, userId, targetSupervisor, reason);
    
    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found or not assigned to you',
      });
    }
    
    // Record history
    await recordAlertHistory(alertId, 'escalated', userId, {
      escalatedTo: targetSupervisor,
      reason,
    });
    
    // Update performance
    await updateAgentPerformance(userId, { alertsEscalated: 1 });
    
    console.log(`⬆️ Alert ${alertId} escalated by ${userId} to ${targetSupervisor}`);
    
    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    console.error('❌ Escalate error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// Break Management
// ============================================

/**
 * POST /api/distribution/request-break
 * Agent requests a break
 */
router.post('/request-break', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const session = await updateAgentStatus(userId, 'break_requested');
    console.log(`☕ Agent ${userId} requested break`);
    
    // Get pending alerts count for supervisor info
    const alerts = await getAgentAlerts(userId);
    
    // Notify supervisors
    sendToSupervisors('break:requested', {
      userId,
      username: session?.username,
      pendingAlerts: alerts.length,
      requestedAt: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error('❌ Request break error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/cancel-break-request
 * Cancel break request
 */
router.post('/cancel-break-request', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const session = await updateAgentStatus(userId, 'online');
    console.log(`🔄 Agent ${userId} cancelled break request`);
    
    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// Supervisor Endpoints (role-gated)
// ============================================

/**
 * GET /api/distribution/agents
 * Get all agents with their status and workload
 */
router.get('/agents', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const agents = await getAllAgentSessions();
    const performance = await getAllAgentPerformanceToday();
    
    // Merge performance data with agent sessions
    const agentsWithPerformance = agents.map(agent => {
      const perf = performance.find(p => p.user_id === agent.user_id);
      return {
        ...agent,
        performance: perf || null,
      };
    });
    
    res.json({
      success: true,
      data: agentsWithPerformance,
    });
  } catch (error: any) {
    console.error('❌ Get agents error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/distribution/escalated
 * Get all escalated alerts
 */
router.get('/escalated', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const alerts = await getEscalatedAlerts();
    
    res.json({
      success: true,
      data: alerts,
    });
  } catch (error: any) {
    console.error('❌ Get escalated error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/distribution/pending
 * Get all pending (unassigned) alerts
 */
router.get('/pending', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const alerts = await getPendingAlerts();
    
    res.json({
      success: true,
      data: alerts,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/assign
 * Manually assign an alert to an agent
 */
router.post('/assign', requireRole('supervisor', 'admin'), async (req, res) => {
  const { alertId, agentId, supervisorId, reason, force } = req.body;
  
  if (!alertId || !agentId) {
    return res.status(400).json({
      success: false,
      error: 'alertId and agentId are required',
    });
  }
  
  try {
    if (!force) {
      const { getAgentSession: getSession } = await import('../db/alertDistribution');
      const agent = await getSession(agentId);
      if (agent && agent.current_alert_count >= (agent.max_alerts || 10)) {
        return res.status(409).json({
          success: false,
          error: `Agent ${agent.username} is at capacity (${agent.current_alert_count}/${agent.max_alerts || 10}). Use force=true to override.`,
        });
      }
    }

    const alert = await reassignAlert(alertId, agentId, reason || 'Manual assignment by supervisor');
    
    await recordAlertHistory(alertId, 'manual_assignment', supervisorId || 'supervisor', {
      assignedTo: agentId,
      reason,
      forced: !!force,
    });
    
    console.log(`📌 Alert ${alertId} manually assigned to ${agentId}${force ? ' (forced)' : ''}`);
    
    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    console.error('❌ Manual assign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/approve-break/:userId
 * Approve agent's break request
 */
router.post('/approve-break/:userId', requireRole('supervisor', 'admin'), async (req, res) => {
  const { userId } = req.params;
  const { supervisorId } = req.body;
  
  try {
    // Check if agent has pending alerts
    const alerts = await getAgentAlerts(userId);
    
    const session = await updateAgentStatus(userId, 'on_break');
    console.log(`☕ Break approved for ${userId} by ${supervisorId || 'supervisor'}`);
    
    // Notify the agent that break was approved
    sendToAgent(userId, 'break:approved', {
      approvedBy: supervisorId || 'supervisor',
      pendingAlerts: alerts.length,
      approvedAt: new Date().toISOString(),
    });
    
    // Broadcast agent status change
    broadcast('agent:status', {
      userId,
      status: 'on_break',
      pendingAlerts: alerts.length,
    });
    
    res.json({
      success: true,
      data: {
        session,
        pendingAlerts: alerts.length,
        message: alerts.length > 0 
          ? `Agent has ${alerts.length} pending alerts to handle`
          : 'Break approved',
      },
    });
  } catch (error: any) {
    console.error('❌ Approve break error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/end-break/:userId
 * End agent's break
 */
router.post('/end-break/:userId', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { userId } = req.params;
  
  try {
    const session = await updateAgentStatus(userId, 'online');
    console.log(`🔄 Break ended for ${userId}`);
    
    // Notify the agent
    sendToAgent(userId, 'break:ended', {
      endedAt: new Date().toISOString(),
    });
    
    // Broadcast agent status change
    broadcast('agent:status', {
      userId,
      status: 'online',
    });
    
    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// CRM Reference Data (banks & corporates for rule dropdowns)
// ============================================

router.get('/banks', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const banks = await queryCrm('SELECT B_ID AS id, B_NAME AS name FROM BANK ORDER BY B_NAME');
    res.json({ success: true, data: banks });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch banks' });
  }
});

router.get('/corporates', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const corporates = await queryCrm('SELECT CORP_ID AS id, CORP_NAME AS name FROM CORPORATES ORDER BY CORP_NAME');
    res.json({ success: true, data: corporates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch corporates' });
  }
});

// ============================================
// Distribution Rules
// ============================================

/**
 * GET /api/distribution/rules
 * Get all distribution rules
 */
router.get('/rules', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const rules = await getAllDistributionRules();
    
    res.json({
      success: true,
      data: rules,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/distribution/rules
 * Create a new distribution rule
 */
router.post('/rules', requireRole('supervisor', 'admin'), async (req, res) => {
  const { ruleType, ruleName, description, config, priority, createdBy } = req.body;
  
  if (!ruleType || !ruleName || !config) {
    return res.status(400).json({
      success: false,
      error: 'ruleType, ruleName, and config are required',
    });
  }
  
  try {
    const rule = await createDistributionRule({
      ruleType,
      ruleName,
      description,
      config,
      priority,
      createdBy: createdBy || 'supervisor',
    });
    
    console.log(`📋 Distribution rule created: ${ruleName}`);
    enforceRuleIsolation().catch((e) => console.error('❌ enforceRuleIsolation failed:', e?.message || e));

    res.json({
      success: true,
      data: rule,
    });
  } catch (error: any) {
    console.error('❌ Create rule error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PUT /api/distribution/rules/:ruleId
 * Update a distribution rule
 */
router.put('/rules/:ruleId', requireRole('supervisor', 'admin'), async (req, res) => {
  const ruleId = parseInt(req.params.ruleId);
  const { config, isActive, ruleName, description, priority, ruleType } = req.body;
  
  try {
    const rule = await updateDistributionRule(ruleId, {
      config, isActive, ruleName, description, priority, ruleType,
    });

    enforceRuleIsolation().catch((e) => console.error('❌ enforceRuleIsolation failed:', e?.message || e));

    res.json({
      success: true,
      data: rule,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * DELETE /api/distribution/rules/:ruleId
 * Delete a distribution rule
 */
router.delete('/rules/:ruleId', requireRole('supervisor', 'admin'), async (req, res) => {
  const ruleId = parseInt(req.params.ruleId);
  
  try {
    await deleteDistributionRule(ruleId);
    
    res.json({
      success: true,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// Statistics & Performance
// ============================================

/**
 * GET /api/distribution/stats
 * Get distribution statistics
 */
router.get('/stats', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const stats = await getDistributionStats();
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/distribution/snapshot
 * Combined endpoint: agents + escalated + pending + stats in a single round-trip
 * Reduces 4 HTTP requests + 4 requireRole auth checks to 1
 */
router.get('/snapshot', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const [agents, performance, escalated, pending, stats] = await Promise.all([
      getAllAgentSessions(),
      getAllAgentPerformanceToday(),
      getEscalatedAlerts(),
      getPendingAlerts(),
      getDistributionStats(),
    ]);

    const agentsWithPerformance = agents.map(agent => {
      const perf = performance.find((p: any) => p.user_id === agent.user_id);
      return { ...agent, performance: perf || null };
    });

    res.json({
      success: true,
      agents: agentsWithPerformance,
      escalated,
      pending,
      stats,
    });
  } catch (error: any) {
    console.error('❌ Snapshot error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/distribution/performance/:userId
 * Get agent performance metrics
 */
router.get('/performance/:userId', requireRole('supervisor', 'admin'), async (req, res) => {
  const { userId } = req.params;
  const days = parseInt(req.query.days as string) || 30;
  
  try {
    const performance = await getAgentPerformance(userId, days);
    
    res.json({
      success: true,
      data: performance,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/distribution/alert/:alertId/history
 * Get alert history
 */
router.get('/alert/:alertId/history', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { alertId } = req.params;
  
  try {
    const history = await getAlertHistory(alertId);
    const alert = await getAlertById(alertId);
    
    res.json({
      success: true,
      data: {
        alert,
        history,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/distribution/analytics
 * L6: Alert volume analytics — peak hours, type distribution, response times
 */
router.get('/analytics', requireRole('supervisor', 'admin'), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 365);
  try {
    const { queryPostgres } = await import('../db/postgres');

    const [hourly, byType, responseTimes] = await Promise.all([
      queryPostgres(`
        SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
        FROM alert_assignments
        WHERE created_at >= NOW() - make_interval(days => $1)
        GROUP BY hour ORDER BY hour
      `, [days]),
      queryPostgres(`
        SELECT alert_type, status, COUNT(*) as count
        FROM alert_assignments
        WHERE created_at >= NOW() - make_interval(days => $1)
        GROUP BY alert_type, status ORDER BY count DESC
      `, [days]),
      queryPostgres(`
        SELECT
          alert_type,
          ROUND(AVG(EXTRACT(EPOCH FROM (acknowledged_at - assigned_at)))) as avg_ack_seconds,
          ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - assigned_at)))) as avg_resolve_seconds,
          COUNT(*) as total
        FROM alert_assignments
        WHERE resolved_at IS NOT NULL
          AND created_at >= NOW() - make_interval(days => $1)
        GROUP BY alert_type
      `, [days]),
    ]);

    res.json({
      success: true,
      data: { hourlyDistribution: hourly, typeBreakdown: byType, responseTimes, days },
    });
  } catch (error: any) {
    console.error('❌ Analytics error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/distribution/recent-activity
 * Live feed of the most recent distribution events from alert_history
 */
router.get('/recent-activity', requireRole('supervisor', 'admin'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
  try {
    const { queryPostgres } = await import('../db/postgres');

    const rows = await queryPostgres(`
      SELECT
        ah.id,
        ah.alert_id,
        ah.action,
        ah.performed_by,
        ah.details,
        ah.handling_time_seconds,
        ah.performed_at,
        aa.alert_type,
        aa.vehicle_reg,
        aa.customer_name,
        aa.assigned_to,
        aa.priority,
        aa.status as current_status
      FROM alert_history ah
      LEFT JOIN alert_assignments aa ON ah.alert_id = aa.alert_id
      ORDER BY ah.performed_at DESC
      LIMIT $1
    `, [limit]);

    res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('❌ Recent activity error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/distribution/vehicle/:vehicleReg/history
 * Full alert history for a specific vehicle — used by supervisor vehicle lookup
 */
router.get('/vehicle/:vehicleReg/history', requireRole('supervisor', 'admin'), async (req, res) => {
  const vehicleReg = req.params.vehicleReg;
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 90, 1), 365);

  if (!vehicleReg) {
    return res.status(400).json({ success: false, error: 'vehicleReg is required' });
  }

  try {
    const { queryPostgres } = await import('../db/postgres');

    const [alerts, summary, timeline] = await Promise.all([
      queryPostgres(`
        SELECT aa.id, aa.alert_id, aa.alert_type, aa.vehicle_reg, aa.customer_name, aa.alert_message,
               aa.alert_data, aa.assigned_to, aa.assigned_at, aa.acknowledged_at, aa.resolved_at,
               aa.resolution, aa.resolution_notes, aa.escalated_to, aa.escalated_at, aa.escalation_reason,
               aa.assignment_count, aa.priority, aa.status, aa.created_at,
               COALESCE(cu.u_name, aa.assigned_to) AS agent_name
        FROM alert_assignments aa
        LEFT JOIN crm_users cu ON cu.employee_id::text = aa.assigned_to
        WHERE aa.vehicle_reg = $1 AND aa.created_at >= NOW() - make_interval(days => $2)
        ORDER BY aa.created_at DESC
        LIMIT $3
      `, [vehicleReg, days, limit]),

      queryPostgres(`
        SELECT
          COUNT(*) as total_alerts,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'escalated') as escalated,
          COUNT(*) FILTER (WHERE status IN ('assigned','acknowledged')) as active,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'dismissed') as dismissed,
          ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - assigned_at))) FILTER (WHERE resolved_at IS NOT NULL)) as avg_resolve_seconds,
          MIN(created_at) as first_alert,
          MAX(created_at) as last_alert
        FROM alert_assignments
        WHERE vehicle_reg = $1 AND created_at >= NOW() - make_interval(days => $2)
      `, [vehicleReg, days]),

      queryPostgres(`
        SELECT ah.id, ah.alert_id, ah.action, ah.performed_by, ah.details,
               ah.handling_time_seconds, ah.performed_at,
               aa.alert_type, aa.status as current_status
        FROM alert_history ah
        INNER JOIN alert_assignments aa ON ah.alert_id = aa.alert_id
        WHERE aa.vehicle_reg = $1 AND ah.performed_at >= NOW() - make_interval(days => $2)
        ORDER BY ah.performed_at DESC
        LIMIT $3
      `, [vehicleReg, days, limit]),
    ]);

    res.json({
      success: true,
      data: {
        alerts: alerts || [],
        summary: summary?.[0] || {},
        timeline: timeline || [],
        vehicleReg,
        days,
      },
    });
  } catch (error: any) {
    console.error('❌ Vehicle history error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/distribution/resolved
 * Fetch resolved alerts with resolution details for supervisor review
 */
router.get('/resolved', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  const agentId = req.query.agentId as string | undefined;
  const qRaw = req.query.q as string | undefined;
  const q = (qRaw || '').trim();

  try {
    const { queryPostgres } = await import('../db/postgres');

    const baseParams: any[] = [];
    let idx = 1;
    let where = `WHERE status = 'resolved'`;

    if (agentId) {
      where += ` AND assigned_to = $${idx}`;
      baseParams.push(agentId);
      idx += 1;
    }

    if (q) {
      where += ` AND (
        alert_id ILIKE $${idx}
        OR vehicle_reg ILIKE $${idx}
        OR customer_name ILIKE $${idx}
        OR alert_type ILIKE $${idx}
        OR alert_message ILIKE $${idx}
      )`;
      baseParams.push(`%${q}%`);
      idx += 1;
    }

    const listParams = [...baseParams, limit, offset];
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const [rows, countResult] = await Promise.all([
      queryPostgres(`
        SELECT id, alert_id, alert_type, vehicle_reg, customer_name, alert_message,
               alert_data, assigned_to, assigned_at, acknowledged_at, resolved_at,
               resolution, resolution_notes, resolved_by, status, priority, created_at
        FROM alert_assignments
        ${where}
        ORDER BY resolved_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `, listParams),
      queryPostgres(`
        SELECT COUNT(*) as total FROM alert_assignments
        ${where}
      `, baseParams),
    ]);

    res.json({
      success: true,
      data: rows,
      total: parseInt(countResult[0]?.total || '0'),
    });
  } catch (error: any) {
    console.error('❌ Resolved alerts error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/distribution/agent-history
 * Agent-scoped history list for acknowledged/resolved alerts with date range.
 * Query params:
 * - agentId (optional): defaults to current userId
 * - status: 'acknowledged' | 'resolved' | 'both' (default 'both')
 * - from: YYYY-MM-DD (optional)
 * - to: YYYY-MM-DD (optional)
 * - q: search text (optional)
 * - limit/offset
 */
router.get('/agent-history', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const session = (req as any).agentSession;
  const requestedAgentId = (req.query.agentId as string) || session.user_id;
  // Agents may only fetch their own history; supervisors/admins can fetch anyone's.
  const isPrivileged = session.role === 'supervisor' || session.role === 'admin';
  if (!isPrivileged && requestedAgentId !== session.user_id) {
    return res.status(403).json({ success: false, error: 'Agents can only view their own history' });
  }
  const agentId = requestedAgentId;
  if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });

  const statusRaw = String(req.query.status || 'both').toLowerCase();
  const status = (statusRaw === 'acknowledged' || statusRaw === 'resolved' || statusRaw === 'both')
    ? statusRaw
    : 'both';

  const from = (req.query.from as string | undefined) || undefined;
  const to = (req.query.to as string | undefined) || undefined;
  const qRaw = req.query.q as string | undefined;
  const q = (qRaw || '').trim();

  // Accept either date-only (YYYY-MM-DD) or datetime-local (YYYY-MM-DDTHH:mm)
  // We compare using `::timestamp` to match "wall-clock" display semantics.
  const normalizeTs = (s: string | undefined): string | null => {
    if (!s) return null;
    const v = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v} 00:00:00`;
    // datetime-local
    const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return `${m[1]} ${m[2]}:${m[3]}:${m[4] || '00'}`;
    return null;
  };
  const fromTs = normalizeTs(from);
  const toTs = normalizeTs(to);

  try {
    const { queryPostgres } = await import('../db/postgres');

    const params: any[] = [];
    let idx = 1;
    const whereBase = `WHERE assigned_to = $${idx}`;
    params.push(agentId);
    idx += 1;

    // Date/time filters are applied against the relevant action timestamp (ack/res)
    let dateFilterAck = `acknowledged_at IS NOT NULL AND acknowledged_at::timestamp >= (NOW() - INTERVAL '7 days')`;
    let dateFilterRes = `resolved_at IS NOT NULL AND resolved_at::timestamp >= (NOW() - INTERVAL '7 days')`;

    if (fromTs && toTs) {
      dateFilterAck = `acknowledged_at IS NOT NULL AND acknowledged_at::timestamp BETWEEN $${idx}::timestamp AND $${idx + 1}::timestamp`;
      dateFilterRes = `resolved_at IS NOT NULL AND resolved_at::timestamp BETWEEN $${idx}::timestamp AND $${idx + 1}::timestamp`;
      params.push(fromTs, toTs);
      idx += 2;
    }

    // "Both" window (used for counts)
    let whereBoth = `${whereBase} AND ( (status = 'acknowledged' AND ${dateFilterAck}) OR (status = 'resolved' AND ${dateFilterRes}) )`;
    let whereList = whereBoth;
    if (status === 'acknowledged') whereList += ` AND status = 'acknowledged'`;
    if (status === 'resolved') whereList += ` AND status = 'resolved'`;

    if (q) {
      const qClause = ` AND (
        alert_id ILIKE $${idx}
        OR vehicle_reg ILIKE $${idx}
        OR customer_name ILIKE $${idx}
        OR alert_type ILIKE $${idx}
        OR alert_message ILIKE $${idx}
      )`;
      whereBoth += qClause;
      whereList += qClause;
      params.push(`%${q}%`);
      idx += 1;
    }

    const listParams = [...params, limit, offset];
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const [rows, countsRow] = await Promise.all([
      queryPostgres(`
        SELECT id, alert_id, alert_type, vehicle_reg, customer_name, alert_message,
               alert_data, assigned_to, assigned_at, acknowledged_at, resolved_at,
               resolution, resolution_notes, status, priority, created_at
        FROM alert_assignments
        ${whereList}
        ORDER BY COALESCE(resolved_at, acknowledged_at, assigned_at) DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `, listParams),
      queryPostgres(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) as total
        FROM alert_assignments
        ${whereBoth}
      `, params),
    ]);

    res.json({
      success: true,
      data: rows,
      counts: {
        acknowledged: Number((countsRow?.[0] as any)?.acknowledged || 0),
        resolved: Number((countsRow?.[0] as any)?.resolved || 0),
        total: Number((countsRow?.[0] as any)?.total || 0),
      },
    });
  } catch (error: any) {
    console.error('❌ Agent history error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/distribution/resolution-types
 * Return available resolution types for the frontend
 */
router.get('/resolution-types', requireRole('agent', 'supervisor', 'admin'), async (_req, res) => {
  res.json({ success: true, data: RESOLUTION_TYPES });
});

/**
 * POST /api/distribution/distribute-pending
 * Manually trigger distribution of pending alerts
 */
router.post('/distribute-pending', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const distributed = await distributePendingAlerts();
    
    res.json({
      success: true,
      data: { distributed },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// Shift Scheduling (L5)
// ============================================

router.get('/shifts', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const shifts = await getAllShifts();
    res.json({ success: true, data: shifts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/shifts/:userId', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  try {
    const shifts = await getAgentShifts(req.params.userId);
    res.json({ success: true, data: shifts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/shifts', requireRole('supervisor', 'admin'), async (req, res) => {
  const { userId, dayOfWeek, startTime, endTime } = req.body;
  if (!userId || dayOfWeek === undefined || !startTime || !endTime) {
    return res.status(400).json({ success: false, error: 'userId, dayOfWeek, startTime, endTime required' });
  }
  try {
    const shift = await upsertShiftSchedule(userId, dayOfWeek, startTime, endTime);
    res.json({ success: true, data: shift });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/shifts/:id', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    await deleteShift(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Alert Comments (L4)
// ============================================

router.get('/alert/:alertId/comments', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  try {
    const comments = await getAlertComments(req.params.alertId);
    res.json({ success: true, data: comments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/alert/:alertId/comments', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { userId, username, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ success: false, error: 'userId and message required' });
  }
  try {
    const comment = await addAlertComment(req.params.alertId, userId, username || userId, message);
    sendToSupervisors('alert:comment', { alertId: req.params.alertId, comment });
    res.json({ success: true, data: comment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Vehicle Context (special instructions + recent CRM logs)
// ============================================

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `http://192.168.20.186:8090/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return '-';
    const data = await res.json();
    return data.display_name || '-';
  } catch {
    return '-';
  }
}

async function resolveVehicleIds(objectId: number): Promise<{ vehId: number; custId: number } | null> {
  const rows = await queryCrm(`
    SELECT TOP 1 v.V_ID as vehId, i.CUST_ID as custId
    FROM VEHICLES v WITH (NOLOCK)
    JOIN INSTALLATION i WITH (NOLOCK) ON v.V_ID = i.V_ID
    WHERE v.OBJECTIDINT = @objectId AND v.OBJECTIDINT > 0
  `, { objectId });
  if (!rows || rows.length === 0) return null;
  return { vehId: parseInt(rows[0].vehId), custId: parseInt(rows[0].custId) };
}

router.get('/alert/:alertId/vehicle-context', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const objectId = parseInt(req.query.objectId as string);
  if (!objectId || isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'objectId query param required' });
  }

  try {
    const ids = await resolveVehicleIds(objectId);
    if (!ids) {
      return res.json({ success: true, data: { specialInstructions: null, recentLogs: [], vehId: null, custId: null } });
    }

    const [siRows, logRows] = await Promise.all([
      queryCrm(`
        SELECT SPECIAL_INSRUCT as specialInstructions
        FROM SECURITYS WITH (NOLOCK)
        WHERE VEH_ID = @vehId
      `, { vehId: ids.vehId }).catch(() => [] as any[]),

      queryCrm(`
        SELECT TOP 5
          cr.CR_LD_ID as id, cr.LOG_ID as logId, cr.LOG_TYPE as logType,
          cr.SPOKE_TO as spokeTo, cr.CALLING_NO as callingNo,
          cr.COMMENTS as comments, cr.CREATION_DATE as createdAt,
          cr.CREATED_BY as createdBy
        FROM cr_logs cr WITH (NOLOCK)
        WHERE cr.VEH_ID = @vehId
        ORDER BY cr.CREATION_DATE DESC
      `, { vehId: ids.vehId }).catch(() => [] as any[]),
    ]);

    res.json({
      success: true,
      data: {
        specialInstructions: siRows?.[0]?.specialInstructions || null,
        recentLogs: logRows || [],
        vehId: ids.vehId,
        custId: ids.custId,
      },
    });
  } catch (error: any) {
    console.error('Vehicle context error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch vehicle context' });
  }
});

// ============================================
// CRM Log Insert (event_information + LOG_DETAILS + cr_logs via SCOPE_IDENTITY)
// ============================================

router.post('/alert/:alertId/crm-log', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const { objectId, comments, spokeTo, callingNo, latitude, longitude } = req.body;
  const userId = (req.headers['x-user-id'] || req.body?.userId) as string;

  if (!objectId || !comments?.trim()) {
    return res.status(400).json({ success: false, error: 'objectId and comments are required' });
  }

  try {
    const ids = await resolveVehicleIds(parseInt(objectId));
    if (!ids) {
      return res.status(404).json({ success: false, error: 'Vehicle not found in CRM' });
    }

    const location = (latitude && longitude)
      ? await reverseGeocode(parseFloat(latitude), parseFloat(longitude))
      : '-';

    // The frontend's "user id" is the agent's EMPLOYEE_ID (see auth.ts).
    // CRM CREATED_BY columns expect USERS.U_ID, and the GET_LOGS stored proc
    // INNER JOINs USERS on U_ID — so writing EMPLOYEE_ID here makes the new
    // log row invisible in the Events tab. Look up the real U_ID first.
    const empId = parseInt(userId) || 0;
    let createdBy = empId;
    if (empId > 0) {
      const userRows = await queryCrm(
        `SELECT TOP 1 U_ID FROM USERS WITH (NOLOCK) WHERE EMPLOYEE_ID = @empId`,
        { empId }
      ).catch(() => [] as any[]);
      const resolved = parseInt(userRows?.[0]?.U_ID);
      if (resolved > 0) {
        createdBy = resolved;
      } else {
        console.warn(`⚠️ crm-log: no USERS row for EMPLOYEE_ID=${empId}; falling back to that value`);
      }
    }
    // Use SQL Server's GETDATE() so the timestamp matches the rest of the CRM
    // (server clock is PKT). Binding a JS Date here causes the mssql driver to
    // serialise as UTC, which then displays "5 hours behind" when read back.
    const insertResult = await queryCrm(`
      INSERT INTO event_information (EVENT_ID, LOCATION, CALLING_DATE_TIME, RETURN_DATE_TIME, STATUS, CREATION_DATE, CREATED_BY)
      VALUES (3, @location, GETDATE(), GETDATE(), 1, GETDATE(), @createdBy);
      SELECT SCOPE_IDENTITY() AS LOG_ID;
    `, { location, createdBy });

    const logId = parseInt(insertResult?.[0]?.LOG_ID);
    if (!logId || isNaN(logId)) {
      return res.status(500).json({ success: false, error: 'Failed to create event_information record' });
    }

    await Promise.all([
      queryCrm(`
        INSERT INTO LOG_DETAILS (LOG_ID, LOG_TYPE, CUSTOMER_ID, VEH_ID, CALLING_NO, SPOKE_TO, COMMENTS, STATUS, CREATION_DATE, CREATED_BY)
        VALUES (@logId, 'EVENTS', @custId, @vehId, @callingNo, @spokeTo, @comments, 1, GETDATE(), @createdBy)
      `, { logId, custId: ids.custId, vehId: ids.vehId, callingNo: callingNo || '', spokeTo: spokeTo || '', comments: comments.trim(), createdBy }),

      queryCrm(`
        INSERT INTO cr_logs (LOG_ID, LOG_TYPE, CUSTOMER_ID, VEH_ID, CALLING_NO, SPOKE_TO, COMMENTS, STATUS, CREATION_DATE, CREATED_BY)
        VALUES (@logId, 'EVENTS', @custId, @vehId, @callingNo, @spokeTo, @comments, 1, GETDATE(), @createdBy)
      `, { logId, custId: ids.custId, vehId: ids.vehId, callingNo: callingNo || '', spokeTo: spokeTo || '', comments: comments.trim(), createdBy }),
    ]);

    res.json({ success: true, data: { logId } });
  } catch (error: any) {
    console.error('CRM log insert error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to insert CRM log' });
  }
});

// ============================================
// Event Discovery (live Tracking DB event names)
// ============================================

router.get('/event-names', requireRole('supervisor', 'admin'), async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
  try {
    const rows = await queryTracking(`
      SELECT TOP 100 Name, COUNT(*) as cnt
      FROM [Tracking].[dbo].[EventLog] WITH (NOLOCK)
      WHERE GpsTime >= DATEADD(HOUR, -${hours}, GETDATE())
      GROUP BY Name
      ORDER BY cnt DESC
    `);
    res.json({ success: true, data: rows || [] });
  } catch (error: any) {
    console.error('Event name discovery error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to query Tracking DB' });
  }
});

// ============================================
// Alert Type Configuration (dynamic filter)
// ============================================

router.get('/alert-types', requireRole('agent', 'supervisor', 'admin'), async (_req, res) => {
  try {
    const configs = await getAlertTypeConfigs();
    res.json({ success: true, data: configs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/alert-types', requireRole('supervisor', 'admin'), async (req, res) => {
  const { eventName, category, severity, matchMode, userId } = req.body;
  if (!eventName || !category) {
    return res.status(400).json({ success: false, error: 'eventName and category are required' });
  }
  try {
    const config = await createAlertTypeConfig(
      eventName, category, severity || 'medium', matchMode || 'exact', userId,
    );
    await reloadAlertTypeConfigs();
    broadcast('alertConfig:changed', {});
    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/alert-types/:id', requireRole('supervisor', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  try {
    const config = await updateAlertTypeConfig(id, req.body);
    await reloadAlertTypeConfigs();
    broadcast('alertConfig:changed', {});
    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/alert-types/:id', requireRole('supervisor', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  try {
    await deleteAlertTypeConfig(id);
    await reloadAlertTypeConfigs();
    broadcast('alertConfig:changed', {});
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/distribution/search?q=...
 * Global alert search across ALL agents — any logged-in user can search
 * Searches vehicle_reg, customer_name, alert_type, alert_message
 */
router.get('/search', requireRole('agent', 'supervisor', 'admin'), async (req, res) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

  try {
    const { queryPostgres } = await import('../db/postgres');
    const results = await queryPostgres(`
      SELECT
        aa.id, aa.alert_id, aa.alert_type, aa.vehicle_reg, aa.customer_name, aa.alert_message,
        aa.status, aa.assigned_to, aa.assigned_at, aa.acknowledged_at, aa.resolved_at,
        aa.priority, aa.assignment_count, aa.created_at, aa.resolution, aa.resolution_notes,
        COALESCE(cu.u_name, aa.assigned_to) AS agent_name
      FROM alert_assignments aa
      LEFT JOIN crm_users cu ON cu.employee_id::text = aa.assigned_to
      WHERE
        aa.created_at >= NOW() - INTERVAL '7 days'
        AND (
          aa.vehicle_reg    ILIKE $1
          OR aa.customer_name  ILIKE $1
          OR aa.alert_type     ILIKE $1
          OR aa.alert_message  ILIKE $1
        )
      ORDER BY aa.created_at DESC
      LIMIT $2
    `, [`%${q}%`, limit]);

    res.json({ success: true, data: results || [] });
  } catch (error: any) {
    console.error('❌ Global alert search error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
