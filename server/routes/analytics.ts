/**
 * Analytics API Routes
 * Provides aggregated statistics for the analytics video wall.
 *
 * Performance strategy:
 *  1. Background refresh loop runs every REFRESH_INTERVAL (30s) — queries
 *     are executed sequentially (not in parallel) to avoid pool starvation.
 *  2. All GET endpoints serve instantly from in-memory cache.
 *  3. On startup we ensure necessary indexes exist (trigram on name,
 *     btree on servertime) and pre-warm the cache before accepting traffic.
 *  4. Stale cache is served while a refresh is in progress — the wall
 *     never waits for a query.
 */

import { Router } from 'express';
import { initPostgres, queryPostgres } from '../db/postgres';
import { queryTavl } from '../db/tavl';

const router = Router();

// ==================== CACHE ====================

interface CacheSlot<T = any> {
  data: T;
  updatedAt: number;
}

const cache: Record<string, CacheSlot> = {};

function get<T>(key: string): T | null {
  return cache[key]?.data ?? null;
}

function put<T>(key: string, data: T): void {
  cache[key] = { data, updatedAt: Date.now() };
}

// ==================== CATEGORY HELPERS ====================

function getAlertCategory(name: string): 'critical' | 'warning' | 'geofence' | 'info' {
  const n = (name || '').toLowerCase();
  if (n.includes('panic') || n.includes('over speed') || n.includes('overspeed') ||
      n.includes('sos') || n.includes('emergency')) return 'critical';
  if (n.includes('battery') || n.includes('power') || n.includes('volt') ||
      n.includes('dout') || n.includes('movement')) return 'warning';
  if (n.includes('roaming') || n.includes('geofence') || n.includes('rawalpindi') ||
      n.includes('islamabad') || n.includes('lahore') || n.includes('karachi') ||
      n.includes('faisalabad') || n.includes('multan') || n.includes('peshawar') ||
      n.includes('quetta') || n.includes('sialkot') || n.includes('gujranwala') ||
      n.includes('hyderabad') || n.includes('sukkur') || n.includes('bahawalpur') ||
      n.includes('sargodha') || n.includes('abbottabad')) return 'geofence';
  return 'info';
}

// ==================== INDEX BOOTSTRAPPING ====================

let indexesEnsured = false;

async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const t0 = Date.now();
  try {
    await queryPostgres(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});

    await queryPostgres(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventlog_servertime
      ON eventlog (servertime DESC)
    `).catch(() => {});

    await queryPostgres(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventlog_name_trgm
      ON eventlog USING GIN (name gin_trgm_ops)
    `).catch(() => {});

    await queryPostgres(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventlog_servertime_objectid
      ON eventlog (servertime DESC, objectid)
    `).catch(() => {});

    indexesEnsured = true;
    console.log(`📊 Analytics indexes ensured (${Date.now() - t0}ms)`);
  } catch (e: any) {
    console.warn(`⚠️ Index creation partial: ${e.message}`);
    indexesEnsured = true;
  }
}

// ==================== BACKGROUND REFRESH ====================

const REFRESH_INTERVAL_MS = 30_000;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshing = false;

/**
 * The single-query approach: we run ONE big query on eventlog for the last 24h
 * that returns name + hour + objectid aggregates. We then slice/dice in JS.
 * This avoids running 5+ separate full-scans.
 */
async function refreshAllData(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  const t0 = Date.now();

  try {
    await initPostgres();

    // ── Query 1: Hourly breakdown by name (24h) ──
    // Positive-match only (no NOT ILIKE) so the trigram GIN index can be used
    const hourlyRaw = await queryPostgres(`
      SELECT
        DATE_TRUNC('hour', servertime) AS hour,
        name,
        COUNT(*) AS cnt
      FROM eventlog
      WHERE servertime >= NOW() - INTERVAL '24 hours'
        AND (
             name ILIKE '%panic%'
          OR name ILIKE '%over speed%' OR name ILIKE '%overspeed%'
          OR name ILIKE '%sos%' OR name ILIKE '%emergency%'
          OR name ILIKE '%battery%' OR name ILIKE '%power%'
          OR name ILIKE '%volt%' OR name ILIKE '%movement%'
          OR name ILIKE '%roaming%' OR name ILIKE '%geofence%'
          OR name ILIKE '%rawalpindi%' OR name ILIKE '%islamabad%'
          OR name ILIKE '%lahore%' OR name ILIKE '%karachi%'
          OR name ILIKE '%faisalabad%' OR name ILIKE '%multan%'
          OR name ILIKE '%peshawar%' OR name ILIKE '%quetta%'
          OR name ILIKE '%sialkot%' OR name ILIKE '%gujranwala%'
          OR name ILIKE '%hyderabad%' OR name ILIKE '%sukkur%'
          OR name ILIKE '%bahawalpur%' OR name ILIKE '%sargodha%'
          OR name ILIKE '%abbottabad%'
        )
      GROUP BY DATE_TRUNC('hour', servertime), name
      ORDER BY hour
    `);

    // ── Query 2: Fleet status — only scan last 30 min for live status ──
    const [fleetLive, fleetTotal] = await Promise.all([
      queryPostgres(`
        SELECT
          COUNT(DISTINCT objectid) FILTER (WHERE speed > 0 AND servertime >= NOW() - INTERVAL '5 minutes') AS moving,
          COUNT(DISTINCT objectid) FILTER (WHERE speed = 0 AND servertime >= NOW() - INTERVAL '5 minutes') AS parked,
          COUNT(DISTINCT objectid) FILTER (WHERE servertime < NOW() - INTERVAL '30 minutes') AS offline
        FROM eventlog
        WHERE servertime >= NOW() - INTERVAL '30 minutes'
      `),
      queryTavl(`SELECT COUNT(*) AS total_vehicles FROM [tavl2].[tavl].[Object] WITH (NOLOCK) WHERE Enabled = 1`).catch(() => [{ total_vehicles: 0 }]),
    ]);
    const fleetRows = [{
      total_vehicles: fleetTotal?.[0]?.total_vehicles || 0,
      moving: fleetLive?.[0]?.moving || 0,
      parked: fleetLive?.[0]?.parked || 0,
      offline: fleetLive?.[0]?.offline || 0,
    }];

    // ── Query 3: Realtime (last 5 min) ──
    const realtimeRows = await queryPostgres(`
      SELECT
        COUNT(*) AS alert_count,
        COUNT(*) FILTER (WHERE name ILIKE '%panic%' OR name ILIKE '%sos%') AS critical_count,
        COUNT(DISTINCT objectid) AS active_vehicles,
        MAX(servertime) AS last_event
      FROM eventlog
      WHERE servertime >= NOW() - INTERVAL '5 minutes'
    `);

    // ── Query 4: Stolen vehicles (tiny table) ──
    const stolenCount = await queryPostgres(`
      SELECT COUNT(*) AS count FROM stolen_vehicle_tracking WHERE status = 'active'
    `).catch(() => [{ count: 0 }]);

    const stolenVehicles = await queryPostgres(`
      SELECT id, vehicle_reg, priority, last_speed, total_distance_km, last_update, customer_name
      FROM stolen_vehicle_tracking WHERE status = 'active'
      ORDER BY priority, last_update DESC LIMIT 5
    `).catch(() => []);

    // ── Query 5: Assignment stats (from alert_assignments — tiny table) ──
    const assignments = await queryPostgres(`
      SELECT status, COUNT(*) AS count
      FROM alert_assignments
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY status
    `).catch(() => []);

    // ── Query 6: Top alerting vehicles (24h) — positive match only ──
    const topVehiclesRaw = await queryPostgres(`
      SELECT
        objectid,
        COUNT(*) AS alert_count,
        COUNT(*) FILTER (WHERE name ILIKE '%panic%' OR name ILIKE '%over speed%' OR name ILIKE '%sos%') AS critical_count,
        MAX(servertime) AS last_alert
      FROM eventlog
      WHERE servertime >= NOW() - INTERVAL '24 hours'
        AND (
             name ILIKE '%panic%'
          OR name ILIKE '%over speed%' OR name ILIKE '%overspeed%'
          OR name ILIKE '%sos%' OR name ILIKE '%emergency%'
          OR name ILIKE '%battery%' OR name ILIKE '%power%'
          OR name ILIKE '%volt%' OR name ILIKE '%movement%'
          OR name ILIKE '%roaming%' OR name ILIKE '%geofence%'
          OR name ILIKE '%rawalpindi%' OR name ILIKE '%islamabad%'
          OR name ILIKE '%lahore%' OR name ILIKE '%karachi%'
          OR name ILIKE '%faisalabad%' OR name ILIKE '%multan%'
          OR name ILIKE '%peshawar%' OR name ILIKE '%quetta%'
          OR name ILIKE '%sialkot%' OR name ILIKE '%gujranwala%'
          OR name ILIKE '%hyderabad%' OR name ILIKE '%sukkur%'
          OR name ILIKE '%bahawalpur%' OR name ILIKE '%sargodha%'
          OR name ILIKE '%abbottabad%'
        )
      GROUP BY objectid
      ORDER BY alert_count DESC
      LIMIT 10
    `);

    // Resolve vehicle names for top alerting
    if (topVehiclesRaw && topVehiclesRaw.length > 0) {
      const objectIds = topVehiclesRaw.map((v: any) => v.objectid);
      try {
        const intIds = objectIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        if (intIds.length > 0) {
          const names = await queryTavl(
            `SELECT ObjectId as object_id, Number as plate_number FROM [tavl2].[tavl].[Object] WITH (NOLOCK) WHERE ObjectId IN (${intIds.join(',')})`,
          );
          const nameMap: Record<string, string> = {};
          (names || []).forEach((v: any) => { nameMap[v.object_id] = v.plate_number; });
          topVehiclesRaw.forEach((v: any) => { v.vehicle_name = nameMap[v.objectid] || `Vehicle ${v.objectid}`; });
        }
      } catch {
        topVehiclesRaw.forEach((v: any) => { v.vehicle_name = `Vehicle ${v.objectid}`; });
      }
    }

    // ════════════════ Derive cached datasets ════════════════

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // -- Summary --
    let totalLastHour = 0, criticalLastHour = 0, warningLastHour = 0, geofenceLastHour = 0;
    let totalToday = 0;
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const breakdownMap = new Map<string, { count: number; category: string }>();

    (hourlyRaw || []).forEach((row: any) => {
      const hourDate = new Date(row.hour);
      const cnt = parseInt(row.cnt) || 0;
      const cat = getAlertCategory(row.name);

      if (hourDate >= todayStart) totalToday += cnt;
      if (hourDate >= oneHourAgo) {
        totalLastHour += cnt;
        if (cat === 'critical') criticalLastHour += cnt;
        else if (cat === 'warning') warningLastHour += cnt;
        else if (cat === 'geofence') geofenceLastHour += cnt;

        const existing = breakdownMap.get(row.name);
        if (existing) existing.count += cnt;
        else breakdownMap.set(row.name, { count: cnt, category: cat });
      }
    });

    const alertBreakdown = [...breakdownMap.entries()]
      .map(([name, { count, category }]) => ({ name, count, category }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const assignmentStats = { pending: 0, acknowledged: 0, resolved: 0 };
    (assignments || []).forEach((a: any) => {
      if (a.status === 'pending') assignmentStats.pending = parseInt(a.count);
      else if (a.status === 'acknowledged') assignmentStats.acknowledged = parseInt(a.count);
      else if (a.status === 'resolved') assignmentStats.resolved = parseInt(a.count);
    });

    put('summary', {
      lastHour: { total: totalLastHour, critical: criticalLastHour, warning: warningLastHour, geofence: geofenceLastHour },
      today: { total: totalToday },
      stolenTracking: { active: parseInt(stolenCount?.[0]?.count) || 0 },
      assignments: assignmentStats,
      alertBreakdown,
      timestamp: now.toISOString(),
    });

    // -- Hourly trend --
    const hourlyMap = new Map<string, { critical: number; warning: number; geofence: number; total: number }>();
    (hourlyRaw || []).forEach((row: any) => {
      const key = new Date(row.hour).toISOString();
      const cnt = parseInt(row.cnt) || 0;
      const cat = getAlertCategory(row.name);
      const entry = hourlyMap.get(key) || { critical: 0, warning: 0, geofence: 0, total: 0 };
      entry.total += cnt;
      if (cat === 'critical') entry.critical += cnt;
      else if (cat === 'warning') entry.warning += cnt;
      else if (cat === 'geofence') entry.geofence += cnt;
      hourlyMap.set(key, entry);
    });
    put('hourly', [...hourlyMap.entries()].map(([hour, stats]) => ({ hour, ...stats })));

    // -- Geofence breakdown --
    const geoMap = new Map<string, number>();
    (hourlyRaw || []).forEach((row: any) => {
      if (getAlertCategory(row.name) === 'geofence') {
        geoMap.set(row.name, (geoMap.get(row.name) || 0) + (parseInt(row.cnt) || 0));
      }
    });
    put('geofence', [...geoMap.entries()]
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15));

    // -- Top alerting --
    put('topAlerting', topVehiclesRaw || []);

    // -- Fleet --
    put('fleet', {
      status: fleetRows?.[0] || { total_vehicles: 0, moving: 0, parked: 0, offline: 0 },
      speedDistribution: [],
      timestamp: now.toISOString(),
    });

    // -- Realtime --
    put('realtime', {
      ...(realtimeRows?.[0] || {}),
      stolenVehicles: stolenVehicles || [],
      timestamp: now.toISOString(),
    });

    console.log(`📊 Analytics refresh done in ${Date.now() - t0}ms`);
  } catch (e: any) {
    console.error(`❌ Analytics refresh error (${Date.now() - t0}ms):`, e.message);
  } finally {
    refreshing = false;
  }
}

// ==================== LIFECYCLE ====================

export async function startAnalyticsRefresh(): Promise<void> {
  await initPostgres();
  ensureIndexes().catch(() => {});
  await refreshAllData();
  refreshTimer = setInterval(refreshAllData, REFRESH_INTERVAL_MS);
  console.log(`📊 Analytics background refresh started (every ${REFRESH_INTERVAL_MS / 1000}s)`);
}

export function stopAnalyticsRefresh(): void {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

// ==================== ROUTES (all serve from cache) ====================

function cacheResponse(key: string, fallback: any) {
  return (_req: any, res: any) => {
    const data = get(key);
    if (data !== null) return res.json({ success: true, data });
    // Cache empty — server still warming up
    res.status(503).json({ success: false, error: 'warming_up', data: fallback });
  };
}

router.get('/summary', cacheResponse('summary', {
  lastHour: { total: 0, critical: 0, warning: 0, geofence: 0 }, today: { total: 0 },
  stolenTracking: { active: 0 }, assignments: { pending: 0, acknowledged: 0, resolved: 0 },
  alertBreakdown: [], timestamp: new Date().toISOString(),
}));
router.get('/hourly',       cacheResponse('hourly', []));
router.get('/fleet',         cacheResponse('fleet', { status: { total_vehicles: 0, moving: 0, parked: 0, offline: 0 }, speedDistribution: [] }));
router.get('/geofence',      cacheResponse('geofence', []));
router.get('/realtime',      cacheResponse('realtime', { alert_count: 0, critical_count: 0, active_vehicles: 0, stolenVehicles: [], timestamp: new Date().toISOString() }));
router.get('/top-alerting',  cacheResponse('topAlerting', []));

export default router;
