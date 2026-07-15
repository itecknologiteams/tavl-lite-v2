/**
 * Supervisor API Routes
 * Handles agent monitoring, alert assignment, and supervisor dashboard data
 */

import { Router, Request, Response } from 'express';
import { initPostgres, queryPostgres } from '../db/postgres';
import { queryTavl } from '../db/tavl';
import { queryFusionPbx } from '../db/fusionpbx';
import eslConnection from '../freeswitch/esl';
import { getCachedCustomers, refreshCustomersByPhones, normalizePhone } from '../services/crmLookup';
import { broadcast } from '../index';
import { getAllAgentSessions } from '../db/alertDistribution';

const router = Router();

// In-memory store for real-time agent status (would be Redis in production)
interface AgentSession {
  id: string;
  username: string;
  name: string;
  extension?: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  loginTime: Date;
  lastActivity: Date;
  activeAlerts: number;
  resolvedToday: number;
}

const agentSessions = new Map<string, AgentSession>();
const alertAssignments = new Map<string, { agentId: string; assignedAt: Date }>();
const activityLog: any[] = [];

/**
 * GET /api/supervisor/agents
 * Get all agents from TAVL Login table
 */
router.get('/agents', async (_req: Request, res: Response) => {
  try {
    const users = await queryPostgres(`
      SELECT login_id as id, username, name
      FROM tavl_logins
      ORDER BY name, username
    `);

    // Build lookup from distribution agent_sessions (PostgreSQL).
    // agent_sessions uses crm_users employee_id & username, which differ
    // from tavl_logins login_id & username. Match by both to be safe.
    let distByUsername: Map<string, any> = new Map();
    let distByUserId: Map<string, any> = new Map();
    let allDistSessions: any[] = [];
    try {
      allDistSessions = await getAllAgentSessions();
      for (const s of allDistSessions) {
        distByUsername.set((s.username || '').toUpperCase(), s);
        distByUserId.set(s.user_id, s);
      }
    } catch { /* fallback to empty */ }

    const matchedDistUsernames = new Set<string>();

    const agents = (users || []).map((user: any) => {
      const uid = user.id.toString();
      const ds = distByUsername.get((user.username || '').toUpperCase()) || distByUserId.get(uid);
      const legacy = agentSessions.get(uid);
      if (ds) matchedDistUsernames.add((ds.username || '').toUpperCase());

      const status = ds?.status || legacy?.status || 'offline';

      return {
        id: uid,
        username: user.username,
        name: user.name || user.username,
        extension: legacy?.extension || `${220 + (user.id % 50)}`,
        status,
        loginTime: ds?.logged_in_at || legacy?.loginTime,
        lastActivity: ds?.updated_at || legacy?.lastActivity,
        activeAlerts: ds?.current_alert_count || legacy?.activeAlerts || 0,
        resolvedToday: legacy?.resolvedToday || 0,
        avgResponseTime: Math.floor(Math.random() * 60) + 30,
      };
    });

    // Append distribution-only agents not found in tavl_logins
    for (const ds of allDistSessions) {
      if (!matchedDistUsernames.has((ds.username || '').toUpperCase())) {
        agents.unshift({
          id: ds.user_id,
          username: ds.username,
          name: ds.username,
          extension: '',
          status: ds.status || 'offline',
          loginTime: ds.logged_in_at,
          lastActivity: ds.updated_at,
          activeAlerts: ds.current_alert_count || 0,
          resolvedToday: 0,
          avgResponseTime: 0,
        });
      }
    }

    console.log(`📋 Found ${agents.length} agents from Login table`);
    res.json({ success: true, agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agents' });
  }
});

/**
 * POST /api/supervisor/agents/:id/status
 * Update agent status
 */
router.post('/agents/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const session = agentSessions.get(id);
    if (session) {
      session.status = status;
      session.lastActivity = new Date();
      
      // Broadcast status change
      broadcast('agentStatusChange', { agentId: id, status });
      
      // Log activity
      addActivity({
        agentId: id,
        agentName: session.name,
        action: 'status_change',
        details: `${session.name} changed status to ${status}`,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating agent status:', error);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

/**
 * GET /api/supervisor/alerts
 * Get all alerts from PostgreSQL eventlog
 */
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    await initPostgres();
    
    // Include geofence/zone names that are stored as short codes or combined names in `eventlog.name`
    // e.g. "KHI L", "LHR SAHIWAL", "WAH CANTT", etc. (case-insensitive).
    const GEOFENCE_NAME_SQL = [
      // Full city names
      'rawalpindi',
      'islamabad',
      'lahore',
      'karachi',
      'faisalabad',
      'multan',
      'peshawar',
      'quetta',
      'sialkot',
      'gujranwala',
      'hyderabad',
      'sukkur',
      'bahawalpur',
      'sargodha',
      'abbottabad',
      // Additional common zones
      'kohat',
      'sahiwal',
      'wah cantt',
      'wah',
      'chaman',
      // Short codes
      'khi',
      'lhr',
      'hyd',
    ]
      .map((k) => k.replace(/'/g, "''"))
      .map((k) => `OR name ILIKE '%${k}%'`)
      .join('\n          ');

    // Get recent events from PostgreSQL
    const events = await queryPostgres(`
      SELECT 
        eventlogid,
        objectid,
        vehicleid,
        name,
        value,
        y as latitude,
        x as longitude,
        speed,
        gpstime,
        servertime
      FROM eventlog 
      WHERE gpstime >= NOW() - INTERVAL '120 minutes'
        AND (
          name ILIKE '%panic%'
          OR name ILIKE '%over speed%'
          OR name ILIKE '%overspeed%'
          OR name ILIKE '%sos%'
          OR name ILIKE '%emergency%'
          OR name ILIKE '%battery%'
          OR name ILIKE '%power%'
          OR name ILIKE '%volt%'
          OR name ILIKE '%movement%'
          OR name ILIKE '%roaming%'
          OR name ILIKE '%geofence%'
          ${GEOFENCE_NAME_SQL}
        )
      ORDER BY gpstime DESC 
      LIMIT 200
    `);
    
    // Get vehicle names from TAVL
    const objectIds = [...new Set((events || []).map((e: any) => e.objectid))];
    let vehicleMap: Record<number, string> = {};
    
    if (objectIds.length > 0) {
      try {
        const intIds = objectIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        if (intIds.length > 0) {
          const vehicleNames = await queryTavl(
            `SELECT ObjectId as object_id, Number as plate_number FROM [tavl2].[tavl].[Object] WITH (NOLOCK) WHERE ObjectId IN (${intIds.join(',')})`
          );
          vehicleMap = (vehicleNames || []).reduce((acc: any, v: any) => {
            acc[v.object_id] = v.plate_number;
            return acc;
          }, {});
        }
      } catch (e) {
        console.warn('⚠️ Could not fetch vehicle names for supervisor');
      }
    }
    
    // Transform events to supervisor alerts
    const alerts = (events || []).map((event: any) => {
      const assignment = alertAssignments.get(event.eventlogid.toString());
      return {
        id: event.eventlogid.toString(),
        type: event.name || 'Unknown Event',
        severity: getAlertSeverity(event.name),
        vehiclePlate: vehicleMap[event.objectid] || `Vehicle ${event.objectid}`,
        vehicleId: event.objectid?.toString(),
        description: `${event.name} ${event.value !== null ? `(Value: ${event.value})` : ''}`,
        timestamp: event.gpstime || new Date(),
        assignedTo: assignment?.agentId,
        assignedAt: assignment?.assignedAt,
        status: assignment ? 'assigned' : 'pending',
        latitude: parseFloat(event.latitude) || 0,
        longitude: parseFloat(event.longitude) || 0,
        speed: event.speed || 0,
      };
    });

    console.log(`🔔 Found ${alerts.length} alerts for supervisor`);
    res.json({ success: true, alerts });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
  }
});

// Helper: Get alert severity from event name
function getAlertSeverity(name: string): 'critical' | 'high' | 'medium' | 'low' {
  const lowerName = (name || '').toLowerCase();
  if (lowerName.includes('panic') || lowerName.includes('sos') || lowerName.includes('emergency')) {
    return 'critical';
  }
  if (lowerName.includes('over speed') || lowerName.includes('overspeed')) {
    return 'high';
  }
  if (lowerName.includes('battery') || lowerName.includes('power') || lowerName.includes('volt')) {
    return 'medium';
  }
  return 'low';
}

/**
 * POST /api/supervisor/alerts/:id/assign
 * Assign an alert to an agent
 */
router.post('/alerts/:id/assign', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId, agentName } = req.body;

    // Store assignment in memory
    alertAssignments.set(id, {
      agentId,
      assignedAt: new Date(),
    });

    // Update agent's active alerts count
    const session = agentSessions.get(agentId);
    if (session) {
      session.activeAlerts = (session.activeAlerts || 0) + 1;
      session.lastActivity = new Date();
    }
    
    // Broadcast assignment to all clients
    broadcast('alertAssigned', { 
      alertId: id, 
      agentId,
      agentName: agentName || session?.name || `Agent ${agentId}`,
    });

    // Log activity
    addActivity({
      agentId,
      agentName: agentName || session?.name || `Agent ${agentId}`,
      action: 'alert_assigned',
      details: `Alert assigned to ${agentName || session?.name || agentId}`,
      alertId: id,
    });

    console.log(`📋 Alert ${id} assigned to agent ${agentId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error assigning alert:', error);
    res.status(500).json({ success: false, error: 'Failed to assign alert' });
  }
});

/**
 * POST /api/supervisor/alerts/:id/escalate
 * Escalate an alert
 */
router.post('/alerts/:id/escalate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Broadcast escalation
    broadcast('alertEscalated', { alertId: id });

    // Log activity
    addActivity({
      action: 'escalation',
      details: `Alert ${id} escalated`,
      alertId: id,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error escalating alert:', error);
    res.status(500).json({ success: false, error: 'Failed to escalate alert' });
  }
});

/**
 * POST /api/supervisor/alerts/:id/resolve
 * Resolve an alert
 */
router.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId } = req.body;

    // Remove assignment
    alertAssignments.delete(id);

    // Update agent stats
    if (agentId) {
      const session = agentSessions.get(agentId);
      if (session) {
        session.activeAlerts = Math.max(0, session.activeAlerts - 1);
        session.resolvedToday += 1;
      }
    }

    // Broadcast resolution
    broadcast('alertResolved', { alertId: id, agentId });

    res.json({ success: true });
  } catch (error) {
    console.error('Error resolving alert:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve alert' });
  }
});

/**
 * GET /api/supervisor/stats
 * Get dashboard statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Get agent count from PG cache
    let totalAgents = 0;
    try {
      const agentCount = await queryPostgres(`SELECT COUNT(*) as count FROM tavl_logins`);
      totalAgents = parseInt(agentCount?.[0]?.count) || 0;
    } catch (e) {
      totalAgents = 23;
    }
    
    // Get alert stats from PostgreSQL
    let alertStats = { total: 0, critical: 0, warning: 0, geofence: 0 };
    try {
      await initPostgres();
      const stats = await queryPostgres(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN LOWER(name) LIKE '%panic%' OR LOWER(name) LIKE '%sos%' OR LOWER(name) LIKE '%emergency%' OR LOWER(name) LIKE '%overspeed%' THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN LOWER(name) LIKE '%battery%' OR LOWER(name) LIKE '%power%' OR LOWER(name) LIKE '%volt%' THEN 1 ELSE 0 END) as warning,
          SUM(CASE WHEN LOWER(name) LIKE '%roaming%' OR LOWER(name) LIKE '%geofence%' THEN 1 ELSE 0 END) as geofence
        FROM eventlog 
        WHERE gpstime >= NOW() - INTERVAL '60 minutes'
          AND (
            LOWER(name) LIKE '%panic%' OR LOWER(name) LIKE '%over speed%' OR LOWER(name) LIKE '%overspeed%' 
            OR LOWER(name) LIKE '%sos%' OR LOWER(name) LIKE '%emergency%'
            OR LOWER(name) LIKE '%battery%' OR LOWER(name) LIKE '%power%' OR LOWER(name) LIKE '%volt%'
            OR LOWER(name) LIKE '%roaming%' OR LOWER(name) LIKE '%geofence%'
          )
      `);
      if (stats?.[0]) {
        alertStats = {
          total: parseInt(stats[0].total) || 0,
          critical: parseInt(stats[0].critical) || 0,
          warning: parseInt(stats[0].warning) || 0,
          geofence: parseInt(stats[0].geofence) || 0,
        };
      }
    } catch (e) {
      console.warn('Could not get alert stats:', e);
    }
    
    const assignedCount = alertAssignments.size;

    // Read live agent status from distribution agent_sessions table
    let onlineAgents = 0, awayAgents = 0, busyAgents = 0;
    try {
      const distSessions = await getAllAgentSessions();
      for (const s of distSessions) {
        if (s.status === 'online') onlineAgents++;
        else if (s.status === 'away' || s.status === 'on_break') awayAgents++;
        else if (s.status === 'busy' || s.status === 'break_requested') busyAgents++;
      }
    } catch {
      const agents = Array.from(agentSessions.values());
      onlineAgents = agents.filter(a => a.status === 'online').length;
      awayAgents = agents.filter(a => a.status === 'away').length;
      busyAgents = agents.filter(a => a.status === 'busy').length;
    }

    const stats = {
      totalAgents,
      onlineAgents,
      awayAgents,
      busyAgents,
      totalAlertsToday: alertStats.total,
      pendingAlerts: Math.max(0, alertStats.total - assignedCount),
      assignedAlerts: assignedCount,
      resolvedAlerts: 0,
      escalatedAlerts: alertStats.critical,
      avgResponseTime: 45,
      avgResolutionTime: 180,
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/supervisor/activity
 * Get recent activity log
 */
router.get('/activity', (_req: Request, res: Response) => {
  res.json({ 
    success: true, 
    activities: activityLog.slice(0, 50) 
  });
});

/**
 * POST /api/supervisor/broadcast
 * Send a broadcast message to all agents
 */
router.post('/broadcast', (req: Request, res: Response) => {
  try {
    const { message, priority } = req.body;

    // Broadcast to all connected clients
    broadcast('supervisorMessage', {
      message,
      priority: priority || 'normal',
      timestamp: new Date(),
    });

    // Log activity
    addActivity({
      action: 'broadcast_message' as any,
      details: `Supervisor broadcast: ${message}`,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error broadcasting message:', error);
    res.status(500).json({ success: false, error: 'Failed to broadcast message' });
  }
});

/**
 * POST /api/supervisor/agent/login
 * Register agent login (called when agent logs in)
 */
router.post('/agent/login', (req: Request, res: Response) => {
  try {
    const { id, username, name, extension } = req.body;

    agentSessions.set(id, {
      id,
      username,
      name,
      extension,
      status: 'online',
      loginTime: new Date(),
      lastActivity: new Date(),
      activeAlerts: 0,
      resolvedToday: 0,
    });

    // Broadcast login
    broadcast('agentLogin', { agentId: id, name });

    // Log activity
    addActivity({
      agentId: id,
      agentName: name,
      action: 'login',
      details: `${name} logged in`,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error registering agent login:', error);
    res.status(500).json({ success: false, error: 'Failed to register login' });
  }
});

/**
 * POST /api/supervisor/agent/logout
 * Register agent logout
 */
router.post('/agent/logout', (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    
    const session = agentSessions.get(id);
    if (session) {
      // Log activity before removing
      addActivity({
        agentId: id,
        agentName: session.name,
        action: 'logout',
        details: `${session.name} logged out`,
      });
      
      // Broadcast logout
      broadcast('agentLogout', { agentId: id, name: session.name });
      
      agentSessions.delete(id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error registering agent logout:', error);
    res.status(500).json({ success: false, error: 'Failed to register logout' });
  }
});


/**
 * GET /api/supervisor/call-stats
 * Live call visualisation: active channels (inbound/outbound), queue health, leaderboard
 */
router.get('/call-stats', async (_req: Request, res: Response) => {
  try {
    const eslConn = eslConnection;
    const queueName = process.env.AUTOCALL_QUEUE || 'tavl-agents';

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const [queueRes, channelsRes, todayRes, agentCdrRes, slRes, regRes, abandonRes] = await Promise.allSettled([
      eslConn.queueStatus(queueName),
      eslConn.getActiveChannels(),
      queryFusionPbx(`
        SELECT
          COUNT(*)::int                                                                           AS total_calls,
          COUNT(*) FILTER (WHERE hangup_cause = 'NORMAL_CLEARING' AND billsec > 0)::int          AS answered,
          COUNT(*) FILTER (WHERE direction = 'inbound')::int                                     AS inbound,
          COUNT(*) FILTER (WHERE direction = 'outbound')::int                                    AS outbound,
          COALESCE(ROUND(AVG(billsec) FILTER (WHERE billsec > 0)), 0)::int                       AS avg_talk_sec,
          CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE hangup_cause = 'NORMAL_CLEARING' AND billsec > 0) * 100.0 / COUNT(*), 1)
            ELSE 0 END                                                                           AS answer_rate,
          COUNT(*) FILTER (WHERE direction = 'inbound' AND cc_side = 'member' AND cc_cause = 'cancel'
                            AND EXTRACT(EPOCH FROM (end_stamp - start_stamp)) >= 10)::int AS abandoned
        -- Abandoned = the caller (cc_side='member') leg whose callcenter outcome is
        -- 'cancel' (left the queue without an agent answering). NOTE: this dialplan
        -- answers at the IVR before the queue, so abandons are NORMAL_CLEARING with
        -- billsec>0 — cc_cause is the only reliable answered-vs-abandoned signal.
        -- Exclude cc_side='agent' offer legs (one per agent ring, billsec=0) which
        -- otherwise inflate totals and get miscounted as abandoned.
        FROM v_xml_cdr WHERE start_stamp >= $1 AND cc_side IS DISTINCT FROM 'agent'
      `, [todayISO]),
      queryFusionPbx(`
        SELECT destination_number AS ext,
          COUNT(*)::int                        AS calls_answered,
          COALESCE(SUM(billsec), 0)::int       AS total_talk_sec
        FROM v_xml_cdr
        WHERE start_stamp >= $1
          AND direction = 'inbound'
          AND destination_number ~ '^\\d{3,4}$'
          AND hangup_cause = 'NORMAL_CLEARING'
          AND billsec > 0
        GROUP BY destination_number
        ORDER BY calls_answered DESC
        LIMIT 15
      `, [todayISO]),
      // Service Level: % of inbound calls answered within 20s (industry standard threshold)
      queryFusionPbx(`
        SELECT
          COUNT(*) FILTER (WHERE direction = 'inbound')::int AS offered,
          COUNT(*) FILTER (
            WHERE direction = 'inbound'
              AND hangup_cause = 'NORMAL_CLEARING' AND billsec > 0
              AND answer_stamp IS NOT NULL
              AND EXTRACT(EPOCH FROM (answer_stamp - start_stamp)) <= 20
          )::int AS within_sl,
          COALESCE(ROUND(AVG(
            EXTRACT(EPOCH FROM (answer_stamp - start_stamp))
          ) FILTER (
            WHERE direction = 'inbound'
              AND hangup_cause = 'NORMAL_CLEARING' AND billsec > 0
              AND answer_stamp IS NOT NULL
          ), 0)::int, 0) AS asa_sec
        FROM v_xml_cdr WHERE start_stamp >= $1 AND cc_side IS DISTINCT FROM 'agent'
      `, [todayISO]),
      // Live SIP registration map — the real source of "online/offline".
      eslConn.getAllRegisteredContacts(),
      // Recently abandoned inbound callers (caller hung up while waiting, never
      // reached an agent) — deduped by number for a call-back list.
      queryFusionPbx(`
        SELECT caller_id_number AS number,
               to_char(MAX(start_stamp), 'HH24:MI') AS last_at,
               COUNT(*)::int AS attempts,
               MAX(EXTRACT(EPOCH FROM (end_stamp - start_stamp))::int) AS max_wait_sec
        FROM v_xml_cdr
        WHERE direction = 'inbound'
          AND cc_side = 'member'
          AND cc_cause = 'cancel'
          AND EXTRACT(EPOCH FROM (end_stamp - start_stamp)) >= 10   -- ignore <10s misdials / instant hang-ups
          AND caller_id_number ~ '^[0-9]{6,}$'
          AND start_stamp >= $1
          -- drop numbers already connected with today (answered) — nothing to call back.
          -- Uncorrelated NOT IN (evaluated once) — a correlated NOT EXISTS here
          -- exceeded the 10s statement timeout against the busy CDR table.
          AND caller_id_number NOT IN (
            SELECT caller_id_number FROM v_xml_cdr
            WHERE direction = 'inbound' AND cc_side = 'member' AND cc_cause = 'answered'
              AND caller_id_number IS NOT NULL AND start_stamp >= $1
          )
        GROUP BY caller_id_number
        ORDER BY MAX(start_stamp) DESC
        LIMIT 25
      `, [todayISO]),
    ]);

    const queueData  = queueRes.status  === 'fulfilled' ? queueRes.value  : { success: false, members: [], callers: [] };
    const allChans   = channelsRes.status === 'fulfilled' ? channelsRes.value : [];
    const todayStat  = todayRes.status  === 'fulfilled' ? (todayRes.value[0] || {}) : {};
    const agentCdr   = agentCdrRes.status === 'fulfilled' ? agentCdrRes.value : [];
    const slStat     = slRes.status === 'fulfilled' ? (slRes.value[0] || {}) : {};
    const regMap: Map<string, any> = (regRes.status === 'fulfilled' && regRes.value instanceof Map) ? regRes.value : new Map();
    const abandonedCallbacks = ((abandonRes.status === 'fulfilled' ? abandonRes.value : []) as any[]).map((r: any) => ({
      number: r.number,
      lastAt: r.last_at,
      attempts: parseInt(r.attempts) || 1,
      maxWaitSec: parseInt(r.max_wait_sec) || 0,
    }));

    // ── Categorise active channels ──────────────────────────────────────
    const chanMap = new Map<string, any>();
    for (const ch of allChans) {
      if (ch.name && !ch.name.startsWith('Local/') && ch.state !== 'Down') {
        chanMap.set(ch.uniqueId, ch);
      }
    }

    const inboundCalls: any[]  = [];
    const outboundCalls: any[] = [];
    const autocallCalls: any[] = [];
    const seen = new Set<string>();

    // Pair bridged legs by call_uuid. `show channels` exposes no b_uuid, so the
    // agent leg carries the customer leg's uuid in call_uuid (both legs share the
    // same call_uuid value). This replaces the always-empty ch.bridgeId here.
    const byCallUuid = new Map<string, string[]>();
    for (const ch of chanMap.values()) {
      if (!ch.callUuid) continue;
      const arr = byCallUuid.get(ch.callUuid) || [];
      arr.push(ch.uniqueId);
      byCallUuid.set(ch.callUuid, arr);
    }
    const partnerOf = (uuid: string, callUuid: string): string => {
      const grp = callUuid ? byCallUuid.get(callUuid) || [] : [];
      return grp.find((u) => u !== uuid) || '';
    };
    // Agent extension lives in accountcode — WebRTC agents register with random
    // SIP usernames (sofia/internal/<random>@…), so the ext is NOT in the name.
    const extOf = (c: any): string =>
      /^\d{3,4}$/.test(String(c?.accountcode || ''))
        ? String(c.accountcode)
        : (c?.name || '').match(/sofia\/internal\/(\d+)@/)?.[1] || '';

    // Pass 1: autocall WAN channels (accountcode=autocall or context=tavl-autocall)
    for (const ch of chanMap.values()) {
      if (seen.has(ch.uniqueId)) continue;
      const name: string = ch.name || '';
      if (!name.startsWith('sofia/wan/')) continue;
      if (ch.accountcode !== 'autocall' && ch.context !== 'tavl-autocall') continue;

      const partner = partnerOf(ch.uniqueId, ch.callUuid);
      seen.add(ch.uniqueId);
      if (partner) seen.add(partner);

      const agentCh = partner ? chanMap.get(partner) : null;
      const agentExt = agentCh ? extOf(agentCh) : '';

      // Outbound robocall: cid_num is the system caller-ID and `dest` is the
      // dialplan target ("autocall_ivr"), so neither is the customer. The dialled
      // customer number is in the channel name: sofia/wan/<number>[@<gateway>]
      // (autocall legs often have no @host suffix).
      const custNumber = (name.match(/^sofia\/wan\/([^@]+)/)?.[1] || '').replace(/[^\d+]/g, '');

      autocallCalls.push({
        uniqueId: ch.uniqueId,
        phase: agentExt ? 'connected' : 'calling',
        callerId: ch.callerId || '',
        destination: custNumber,
        agentExt: agentExt || null,
        duration: ch.duration || 0,
        state: ch.state,
      });
    }

    // Pass 2: internal agent channels → inbound and manual UAN outbound
    for (const ch of chanMap.values()) {
      if (seen.has(ch.uniqueId)) continue;
      const name: string = ch.name || '';
      if (!name.startsWith('sofia/internal/')) continue;
      const agentExt = extOf(ch);
      if (!agentExt) continue;
      const dest: string = ch.dest || '';

      // Manual outbound: agent dialled an external number
      if (/^0\d{8,10}$/.test(dest)) {
        const partnerUuid = partnerOf(ch.uniqueId, ch.callUuid);
        seen.add(ch.uniqueId);
        if (partnerUuid) seen.add(partnerUuid);
        outboundCalls.push({
          uniqueId: ch.uniqueId,
          agentExt,
          destination: dest,
          duration: ch.duration || 0,
          state: ch.state,
        });
        continue;
      }

      // Inbound: agent bridged to a non-autocall WAN channel
      const partnerUuid = partnerOf(ch.uniqueId, ch.callUuid);
      if (partnerUuid && chanMap.has(partnerUuid)) {
        const partner = chanMap.get(partnerUuid);
        if ((partner.name || '').startsWith('sofia/wan/') && partner.accountcode !== 'autocall') {
          seen.add(ch.uniqueId);
          seen.add(partnerUuid);
          inboundCalls.push({
            uniqueId: partnerUuid,
            agentExt,
            callerId: partner.callerId || '',
            callerIdName: partner.callerIdName || '',
            duration: partner.duration || ch.duration || 0,
            state: ch.state,
          });
        }
      }
    }

    // ── Queue data ──────────────────────────────────────────────────────
    // esl.ts already computes statusLabel correctly from status+state; just pass through.
    const rawMembers: any[] = queueData.members || [];

    // Enrich agent display names from pbx_admin extensions table
    try {
      const { queryPbxDb } = await import('../db/pbx-admin-db');
      const extNames: { extension: string; caller_id_name: string }[] = await queryPbxDb(
        `SELECT extension, caller_id_name FROM extensions WHERE caller_id_name IS NOT NULL AND caller_id_name != ''`,
        []
      );
      const nameMap = new Map(extNames.map((r) => [r.extension, r.caller_id_name]));
      for (const m of rawMembers) {
        const extNum = (m.interface || '').match(/user\/(\d+)@/)?.[1] || m.name;
        m.name = nameMap.get(extNum) || `Ext ${extNum}`;
        m.ext = extNum;
      }
    } catch { /* non-fatal — names fall back to ext numbers */ }

    // ── Online/offline from ACTUAL SIP registration ────────────────────────
    // "Online" means the extension's phone is registered/reachable — NOT merely
    // logged into the callcenter queue. Previously status came only from the
    // queue login state, so a phone that dropped kept showing Online until a
    // queue logout happened (the "not live" bug). Registration is the source of
    // truth for online/offline; callcenter state is kept only as the activity
    // sub-state (ringing / on-call / on-break) when the phone IS registered.
    for (const m of rawMembers) {
      const ext = (m.interface || '').match(/user\/(\d+)@/)?.[1] || m.ext || m.name;
      const registered = !!regMap.get(ext)?.registered;
      m.registered = registered;
      if (!registered) {
        // Phone not registered → Offline, regardless of queue login state.
        m.statusLabel = 'unavailable';
        m.status = 'unavailable';
        m.paused = false;
      } else if (m.statusLabel === 'unavailable') {
        // Registered but logged out of the queue → still reachable → online/idle.
        m.statusLabel = 'not_inuse';
        m.status = 'not_inuse';
      }
      // Registered + ringing/inuse/not_inuse/On-Break: keep as-is.
    }

    const rawCallers: any[] = queueData.callers || [];

    // ── Leaderboard (merge callcenter calls_taken + CDR talk time) ──────
    const cdrMap = new Map<string, any>();
    for (const row of agentCdr) {
      cdrMap.set(row.ext, { callsAnswered: parseInt(row.calls_answered) || 0, totalTalkSec: parseInt(row.total_talk_sec) || 0 });
    }

    const lbMap = new Map<string, any>();
    for (const m of rawMembers) {
      const ext = m.ext || (m.interface || '').match(/user\/(\d+)@/)?.[1];
      if (!ext) continue;
      const cdr = cdrMap.get(ext) || { callsAnswered: 0, totalTalkSec: 0 };
      lbMap.set(ext, {
        ext,
        name: m.name || `Ext ${ext}`,
        callsTaken: parseInt(m.callsTaken) || 0,
        callsAnswered: cdr.callsAnswered,
        totalTalkSec: cdr.totalTalkSec,
        statusLabel: m.statusLabel,
        paused: m.paused,
      });
    }
    for (const row of agentCdr) {
      if (!lbMap.has(row.ext)) {
        lbMap.set(row.ext, {
          ext: row.ext,
          name: `Ext ${row.ext}`,
          callsTaken: 0,
          callsAnswered: parseInt(row.calls_answered) || 0,
          totalTalkSec: parseInt(row.total_talk_sec) || 0,
          statusLabel: 'unknown',
          paused: false,
        });
      }
    }

    const leaderboard = Array.from(lbMap.values())
      .sort((a, b) => (b.callsTaken + b.callsAnswered) - (a.callsTaken + a.callsAnswered))
      .slice(0, 10);

    const agentsAvailable = rawMembers.filter((m) => m.statusLabel === 'not_inuse' && !m.paused).length;
    const agentsOnCall    = rawMembers.filter((m) => ['inuse', 'ringinuse', 'ringing'].includes(m.statusLabel)).length;
    const longestWait     = rawCallers.length ? Math.max(...rawCallers.map((c: any) => c.wait || 0)) : 0;

    const slOffered      = parseInt(slStat.offered) || 0;
    const slWithin       = parseInt(slStat.within_sl) || 0;
    const serviceLevel   = slOffered > 0 ? Math.round(slWithin * 100 / slOffered) : 100;
    const asaSec         = parseInt(slStat.asa_sec) || 0;
    const totalAgents    = agentsAvailable + agentsOnCall;
    const occupancy      = totalAgents > 0 ? Math.round(agentsOnCall * 100 / totalAgents) : 0;

    // ── CRM enrichment: resolve caller numbers → customer name + vehicle ──────
    // Strictly non-blocking: we read the CRM cache synchronously and kick off a
    // background warm for anything missing/expired. The MSSQL CRM box is never
    // awaited on this 3-second poll path, so a slow/heavy CRM lookup can never
    // stall (and time out) the call-stats response. Newly resolved numbers show
    // up on the next poll. Unmatched items just keep their raw number.
    try {
      const numbers = [
        ...rawCallers.map((c: any) => c.callerId),
        ...inboundCalls.map((c: any) => c.callerId),
        ...outboundCalls.map((c: any) => c.destination),
        ...autocallCalls.map((c: any) => c.destination || c.callerId),
        ...abandonedCallbacks.map((a: any) => a.number),
      ].filter((n): n is string => !!n);

      refreshCustomersByPhones(numbers);
      const crm = getCachedCustomers(numbers);
      const enrich = (raw?: string) => {
        if (!raw) return null;
        const r = crm.get(normalizePhone(raw));
        if (!r?.found || !r.customer) return null;
        const v = r.vehicles?.[0];
        return {
          customerName: r.customer.name,
          vehicleReg: v?.plate || null,
          vehicleInfo: v ? [v.make, v.model].filter(Boolean).join(' ') : null,
        };
      };
      for (const c of rawCallers)        Object.assign(c, enrich(c.callerId) || {});
      for (const c of inboundCalls)      Object.assign(c, enrich(c.callerId) || {});
      for (const c of outboundCalls)     Object.assign(c, enrich(c.destination) || {});
      for (const c of autocallCalls)     Object.assign(c, enrich(c.destination || c.callerId) || {});
      for (const a of abandonedCallbacks) Object.assign(a, enrich(a.number)  || {});
    } catch (e: any) {
      console.error('CRM enrichment skipped:', e.message);
    }

    res.json({
      success: true,
      queue: {
        name: queueName,
        callersWaiting: rawCallers.length,
        longestWaitSec: longestWait,
        callers: rawCallers,
        agents: rawMembers,
      },
      activeCalls: { inbound: inboundCalls, outbound: outboundCalls, autocall: autocallCalls },
      leaderboard,
      abandonedCallbacks,
      summary: {
        totalActive: inboundCalls.length + outboundCalls.length + autocallCalls.length,
        totalInbound: inboundCalls.length,
        totalOutbound: outboundCalls.length,
        totalAutocall: autocallCalls.length,
        callsWaiting: rawCallers.length,
        agentsAvailable,
        agentsOnCall,
        serviceLevel,   // % answered within 20s
        slOffered,      // total inbound calls offered today
        asaSec,         // average speed of answer (seconds)
        occupancy,      // % of logged-in agents currently on call
        todayTotal: parseInt(todayStat.total_calls) || 0,
        todayAnswered: parseInt(todayStat.answered) || 0,
        todayInbound: parseInt(todayStat.inbound) || 0,
        todayOutbound: parseInt(todayStat.outbound) || 0,
        answerRate: parseFloat(todayStat.answer_rate) || 0,
        avgTalkSec: parseInt(todayStat.avg_talk_sec) || 0,
        abandoned: parseInt(todayStat.abandoned) || 0,
      },
    });
  } catch (error) {
    console.error('Call stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch call stats' });
  }
});

// Helper functions
function addActivity(activity: Omit<typeof activityLog[0], 'id' | 'timestamp'>) {
  const newActivity = {
    ...activity,
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
  };
  
  activityLog.unshift(newActivity);
  
  // Keep only last 100 activities
  if (activityLog.length > 100) {
    activityLog.pop();
  }
  
  // Broadcast activity
  broadcast('newActivity', newActivity);
}

export default router;
