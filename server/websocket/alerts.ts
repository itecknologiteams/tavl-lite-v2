/**
 * WebSocket Alert Broadcaster
 * Polls for NEW alerts only, distributes to agents, and broadcasts to clients.
 *
 * Key design decisions for real-world operation:
 * - lastAlertId is seeded from DB on startup (no re-processing after restart)
 * - Uses servertime (when event was received by server) for the polling window
 * - Alerts older than the polling window are never fetched
 * - A periodic expiry job auto-closes stale pending/assigned alerts
 */
import { broadcast, sendToAgent, sendToSupervisors } from '../index';
import { initPostgres } from '../db/postgres';
import { queryCrm } from '../db/crm';
import { queryTavl, queryTracking } from '../db/tavl';
import { distributeAlert } from '../services/distributionEngine';
import {
  getOnlineAgents, getMaxTrackedAlertId, expireStaleAlerts,
  reconcileAlertCounts, archiveOldAlerts, getAgentsOnShift,
  upsertAgentSession, updateAgentStatus, getAgentSession,
  getAlertTypeConfigs, AlertTypeConfig,
} from '../db/alertDistribution';

let pollInterval: NodeJS.Timeout | null = null;
let pendingDistributionInterval: NodeJS.Timeout | null = null;
let expiryInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;
let configRefreshInterval: NodeJS.Timeout | null = null;
let lastAlertId = '0';
let initialized = false;

const POLL_INTERVAL_MS = 15_000;
const PENDING_DISTRIBUTION_INTERVAL_MS = 30_000;
const EXPIRY_INTERVAL_MS = 300_000; // 5 minutes
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CONFIG_REFRESH_MS = 60_000; // Reload config every 60 s
const POLL_WINDOW_MINUTES = 5;
const MAX_ALERTS_PER_POLL = 50;

// ==================== DYNAMIC CONFIG CACHE ====================

let cachedConfigs: AlertTypeConfig[] = [];

async function refreshAlertTypeConfigs(): Promise<void> {
  try {
    cachedConfigs = await getAlertTypeConfigs(true);
  } catch (e: any) {
    console.error('Failed to refresh alert type configs:', e.message);
  }
}

/** Build the SQL WHERE clause from the current config cache (SQL Server named params).
 *  Returns { sql, params } where params is a Record<string, any> for queryTracking. */
function buildAllowedEventsFilter(): { sql: string; params: Record<string, any> } {
  if (cachedConfigs.length === 0) return { sql: 'AND 1=0', params: {} };

  const clauses: string[] = [];
  const params: Record<string, any> = {};
  let idx = 0;

  for (const c of cachedConfigs) {
    const key = `evtName${idx}`;
    if (c.match_mode === 'contains') {
      clauses.push(`Name LIKE '%' + @${key} + '%'`);
    } else {
      clauses.push(`Name LIKE @${key}`);
    }
    params[key] = c.event_name;
    idx++;
  }

  return { sql: `AND (${clauses.join(' OR ')})`, params };
}

// ==================== HELPERS ====================

function matchConfig(name: string): AlertTypeConfig | undefined {
  const lower = (name || '').toLowerCase();
  return cachedConfigs.find((c) => {
    const pattern = c.event_name.toLowerCase();
    return c.match_mode === 'contains'
      ? lower.includes(pattern)
      : lower === pattern;
  });
}

function getAlertCategory(name: string): string {
  return matchConfig(name)?.category || 'info';
}

function getAlertSeverity(name: string): 'critical' | 'high' | 'medium' | 'low' {
  const sev = matchConfig(name)?.severity;
  if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') return sev;
  return 'low';
}

function getDistributionAlertType(name: string): string {
  return matchConfig(name)?.category || 'other';
}

function getMatchedEventName(name: string): string | undefined {
  return matchConfig(name)?.event_name;
}

// ==================== INITIALIZATION ====================

/**
 * Seed lastAlertId so we only pick up truly new events after a restart.
 * Strategy: use the max alert_id we've already tracked, OR the max eventlogid
 * from the last few minutes — whichever is larger.
 */
async function seedLastAlertId(): Promise<void> {
  try {
    // 1. Max ID we've already processed (in alert_assignments — PostgreSQL)
    const trackedMax = await getMaxTrackedAlertId();

    // 2. Max EventLogId from the last POLL_WINDOW_MINUTES (SQL Server EventLog)
    const recentMax = await queryTracking(`
      SELECT MAX(EventLogId) AS max_id
      FROM [Tracking].[dbo].[EventLog] WITH (NOLOCK)
      WHERE GpsTime >= DATEADD(minute, -${POLL_WINDOW_MINUTES}, GETDATE())
    `);
    const streamMax = recentMax?.[0]?.max_id?.toString() || '0';

    // Use the larger of the two so we never re-process
    const tracked = BigInt(trackedMax || '0');
    const stream = BigInt(streamMax || '0');
    lastAlertId = (tracked > stream ? tracked : stream).toString();

    console.log(`📡 Alert broadcaster seeded: lastAlertId=${lastAlertId} (tracked=${trackedMax}, stream=${streamMax})`);
    initialized = true;
  } catch (e: any) {
    console.error('Failed to seed lastAlertId:', e.message);
    // Fall back to streaming head only
    try {
      const recentMax = await queryTracking(`
        SELECT MAX(EventLogId) AS max_id
        FROM [Tracking].[dbo].[EventLog] WITH (NOLOCK)
        WHERE GpsTime >= DATEADD(minute, -${POLL_WINDOW_MINUTES}, GETDATE())
      `);
      lastAlertId = recentMax?.[0]?.max_id?.toString() || '0';
    } catch {
      lastAlertId = '0';
    }
    initialized = true;
  }
}

// ==================== POLL ====================

let polling = false;

async function pollForAlerts() {
  if (!initialized || polling) return;
  polling = true;

  try {
    await initPostgres(); // still needed for alert distribution (PostgreSQL)

    const filter = buildAllowedEventsFilter();
    // Inline lastAlertId as a safe numeric literal (always a parsed integer string)
    const lastIdNum = parseInt(lastAlertId) || 0;
    const query = `
      SELECT TOP ${MAX_ALERTS_PER_POLL}
        EventLogId  AS eventlogid,
        ObjectId    AS objectid,
        VehicleId   AS vehicleid,
        Name        AS name,
        Value       AS value,
        Y           AS latitude,
        X           AS longitude,
        Speed       AS speed,
        GpsTime     AS gpstime,
        ServerTime  AS servertime
      FROM [Tracking].[dbo].[EventLog] WITH (NOLOCK)
      WHERE GpsTime >= DATEADD(minute, -${POLL_WINDOW_MINUTES}, GETDATE())
        ${filter.sql}
        AND EventLogId > ${lastIdNum}
      ORDER BY EventLogId ASC
    `;

    const events = await queryTracking(query, filter.params);

    if (!events || events.length === 0) {
      return;
    }

    // Resolve vehicle plate numbers + customer names (C1)
    const objectIds = [...new Set(events.map((e: any) => e.objectid))];
    let vehicleMap: Record<number, string> = {};
    let customerMap: Record<number, { name: string; phone1?: string; phone2?: string; address?: string; bankId?: number; corpId?: number }> = {};

    if (objectIds.length > 0) {
      try {
        const intIds = objectIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        if (intIds.length > 0) {
          // Step 1: Try TAVL Object table (Number = plate number)
          try {
            const vehicleNames = await queryTavl(
              `SELECT ObjectId as object_id, Number as plate_number FROM [tavl2].[tavl].[Object] WITH (NOLOCK) WHERE ObjectId IN (${intIds.join(',')})`
            );
            vehicleMap = (vehicleNames || []).reduce((acc: any, v: any) => {
              acc[v.object_id] = v.plate_number;
              return acc;
            }, {});
          } catch {
            // TAVL lookup failed — will fall back to CRM below
          }

          // Step 2: For any objectIds still missing, fall back to CRM VEHICLES using OBJECTIDINT
          const missingIds = intIds.filter((id: number) => !vehicleMap[id]);
          if (missingIds.length > 0) {
            try {
              const crmVehicles = await queryCrm(
                `SELECT OBJECTIDINT as object_id, VEH_REG as plate_number FROM VEHICLES WITH (NOLOCK) WHERE OBJECTIDINT IN (${missingIds.join(',')})`
              );
              (crmVehicles || []).forEach((v: any) => {
                if (v.object_id && v.plate_number) vehicleMap[v.object_id] = v.plate_number;
              });
            } catch {
              // CRM fallback also failed — will show objectid as name
            }
          }
        }
      } catch {
        // Vehicle name lookup is non-critical
      }

      // Resolve customer info via VEHICLES → INSTALLATION → CUSTOMER (MSSQL direct)
      try {
        const intIds = objectIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        if (intIds.length > 0) {
          const customers = await queryCrm(`
            SELECT cv.OBJECTIDINT as object_id_int,
                   cv.BANK_ID    AS bank_id,
                   cv.CORP_ID    AS corp_id,
                   cc.FNAME  AS customer_name,
                   cc.CONT1  AS phone1,
                   cc.CONT2  AS phone2,
                   cc.ADRESS AS address,
                   cc.EMAIL  AS email
            FROM VEHICLES cv WITH (NOLOCK)
            JOIN INSTALLATION ci WITH (NOLOCK) ON cv.V_ID = ci.V_ID
            JOIN CUSTOMER cc WITH (NOLOCK)    ON ci.CUST_ID = cc.CUST_ID
            WHERE cv.OBJECTIDINT IN (${intIds.join(',')})
          `);
          customerMap = (customers || []).reduce((acc: any, c: any) => {
            acc[c.object_id_int] = {
              name: c.customer_name,
              phone1: c.phone1 || undefined,
              phone2: c.phone2 || undefined,
              address: c.address || undefined,
              email: c.email || undefined,
              bankId: c.bank_id || undefined,
              corpId: c.corp_id || undefined,
            };
            return acc;
          }, {});
        }
      } catch {
        // Customer lookup is non-critical
      }
    }

    const onlineAgents = await getOnlineAgents();
    const hasAgents = onlineAgents && onlineAgents.length > 0;

    const alerts = events.map((event: any) => {
      const cust = customerMap[event.objectid];
      return {
      id: event.eventlogid.toString(),
      vehicleId: event.objectid.toString(),
      vehicleName: vehicleMap[event.objectid] || `Vehicle ${event.objectid}`,
      customerName: cust?.name || null,
      customerPhone: cust?.phone1 || cust?.phone2 || null,
      customerAddress: cust?.address || null,
      customerEmail: cust?.email || null,
      bankId: cust?.bankId || null,
      corpId: cust?.corpId || null,
      alarmType: event.name || 'Unknown Event',
      alarmTypeId: 0,
      description: `${event.name} ${event.value !== null ? `(Value: ${event.value})` : ''}`,
      latitude: parseFloat(event.latitude) || 0,
      longitude: parseFloat(event.longitude) || 0,
      speed: event.speed || 0,
      occurredAt: event.gpstime,
      appearedAt: event.servertime || event.gpstime,
      acknowledged: false,
      severity: getAlertSeverity(event.name),
      category: getAlertCategory(event.name),
      value: event.value,
    };
    });

    // Advance the cursor
    lastAlertId = events[events.length - 1]?.eventlogid?.toString() || lastAlertId;

    // Distribute to agents if any are online
    for (const alert of alerts) {
      if (hasAgents) {
        const result = await distributeAlert({
          id: alert.id,
          type: getDistributionAlertType(alert.alarmType),
          eventName: alert.alarmType,
          matchedEventName: getMatchedEventName(alert.alarmType),
          vehicleReg: alert.vehicleName,
          customerName: alert.customerName,
          bankId: alert.bankId ?? undefined,
          corpId: alert.corpId ?? undefined,
          message: alert.description,
          data: {
            vehicleId: alert.vehicleId,
            eventName: alert.alarmType,
            matchedEventName: getMatchedEventName(alert.alarmType),
            latitude: alert.latitude,
            longitude: alert.longitude,
            speed: alert.speed,
            occurredAt: alert.occurredAt,
            severity: alert.severity,
            category: alert.category,
            customerPhone: alert.customerPhone,
            customerAddress: alert.customerAddress,
            customerEmail: alert.customerEmail,
            bankId: alert.bankId ?? undefined,
            corpId: alert.corpId ?? undefined,
          },
        });

        if (result.assignedTo) {
          sendToAgent(result.assignedTo, 'alert:assigned', {
            alert: {
              ...alert,
              assignedTo: result.assignedTo,
              assignedAt: new Date().toISOString(),
            },
            assignment: result.alertAssignment,
          });

          sendToSupervisors('alert:distributed', {
            alertId: alert.id,
            assignedTo: result.assignedTo,
            alertType: alert.alarmType,
            vehicleReg: alert.vehicleName,
          });
        }
      }
    }

    sendToSupervisors('alerts:summary', { count: alerts.length, timestamp: new Date().toISOString() });

  } catch (error: any) {
    console.error('Alert poll error:', error.message);
  } finally {
    polling = false;
  }
}

// ==================== PENDING DISTRIBUTION ====================

async function tryDistributePending() {
  try {
    const { distributePendingAlerts } = await import('../services/distributionEngine');
    await distributePendingAlerts();
    // distributePendingAlerts already sends alert:assigned to each assigned agent —
    // no need to broadcast inbox:refresh to all connected clients.
  } catch (error: any) {
    console.error('Pending distribution error:', error.message);
  }
}

// ==================== EXPIRY JOB ====================

async function runExpiryJob() {
  try {
    const expired = await expireStaleAlerts();
    if (expired > 0) {
      console.log(`🗑️ Auto-expired ${expired} stale alerts (pending >2h / assigned >24h)`);
    }
    const reconciled = await reconcileAlertCounts();
    if (reconciled > 0) {
      console.log(`🔧 Reconciled alert counts for ${reconciled} agents`);
    }
  } catch (error: any) {
    console.error('Expiry job error:', error.message);
  }
}

async function enforceShiftSchedules() {
  try {
    const agentsOnShift = await getAgentsOnShift();
    if (agentsOnShift.length === 0) return;

    for (const userId of agentsOnShift) {
      const session = await getAgentSession(userId);
      if (session && session.status === 'offline') {
        await updateAgentStatus(userId, 'online');
        console.log(`📅 Shift auto-online: ${userId}`);
      }
    }
  } catch (error: any) {
    console.error('Shift enforcement error:', error.message);
  }
}

async function runCleanupJob() {
  try {
    const archived = await archiveOldAlerts(30);
    if (archived > 0) {
      console.log(`🧹 Cleaned up ${archived} old alert records (>30 days)`);
    }
  } catch (error: any) {
    console.error('Cleanup job error:', error.message);
  }
}

// ==================== LIFECYCLE ====================

export async function startAlertBroadcaster() {
  if (pollInterval) return;

  console.log('📡 Starting alert broadcaster (every 15s)');

  await initPostgres();

  // Load dynamic alert type config before first poll
  await refreshAlertTypeConfigs();
  console.log(`📡 Loaded ${cachedConfigs.length} alert type configs`);
  configRefreshInterval = setInterval(refreshAlertTypeConfigs, CONFIG_REFRESH_MS);

  // Seed so we don't replay old events
  await seedLastAlertId();

  // Run expiry immediately to clean up historical garbage
  await runExpiryJob();

  // Start polling after a short delay
  setTimeout(pollForAlerts, 3000);
  pollInterval = setInterval(pollForAlerts, POLL_INTERVAL_MS);

  // Pending alert re-distribution
  pendingDistributionInterval = setInterval(tryDistributePending, PENDING_DISTRIBUTION_INTERVAL_MS);

  // Periodic expiry of stale alerts + shift enforcement
  expiryInterval = setInterval(async () => {
    await runExpiryJob();
    await enforceShiftSchedules();
  }, EXPIRY_INTERVAL_MS);

  // Daily cleanup of old records
  cleanupInterval = setInterval(runCleanupJob, CLEANUP_INTERVAL_MS);
}

/** Force-reload config (called when supervisor changes config via API) */
export async function reloadAlertTypeConfigs(): Promise<void> {
  await refreshAlertTypeConfigs();
  console.log(`📡 Alert type configs reloaded: ${cachedConfigs.length} active rules`);
}

export function stopAlertBroadcaster() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('📡 Alert broadcaster stopped');
  }
  if (pendingDistributionInterval) {
    clearInterval(pendingDistributionInterval);
    pendingDistributionInterval = null;
  }
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (configRefreshInterval) {
    clearInterval(configRefreshInterval);
    configRefreshInterval = null;
  }
}
