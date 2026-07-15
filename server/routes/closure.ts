/**
 * Closure / History routes (TDD-style)
 * - EventLog + Events_closure + EventLogCall
 * - ConsoleWarning + ConsoleWarningCall
 *
 * Used by the Vehicle History "Closure" tab in the frontend.
 */
import { Router } from 'express';
import sql from 'mssql';
import { getTrackingPool, getTrackingTableColumns, queryTracking } from '../db/tracking';
import { initAutoCallsDatabase, queryAutoCalls } from '../db/autoCalls';
import { queryPostgres } from '../db/postgres';
import { queryTavl } from '../db/tavl';

const router = Router();

// Matches the legacy TDD Tracking Panel "Event History" allowlist
const TDD_EVENT_NAMES = [
  'Battery Status',
  'Chaman',
  'Faisalabad',
  'FMB Battery',
  'FMB Battery(PV)',
  'KHI L',
  'KHI S',
  'Kohat',
  'LHR L',
  'LHR MOTORWAY',
  'LHR S',
  'Sahiwal',
  'Wah Cantt',
] as const;

function sqlStringList(values: readonly string[]): string {
  // Safe here because we only ever call this with a hardcoded allowlist.
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
}

function pickFirstKey(obj: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

function normalizeCallFields(call: Record<string, any> | null | undefined) {
  if (!call) return { callPlaced: null, callTime: null, callStatus: null };
  const callPlaced = pickFirstKey(call, [
    'CallPlacedTime',
    'CallPlacedAt',
    'CallPlaced',
    'PlacedTime',
  ]);
  const callTime = pickFirstKey(call, ['CreationTime', 'LogTime', 'CallTime', 'CreatedAt']);
  const callStatus = pickFirstKey(call, ['CallStatus', 'Status', 'CSId', 'CallState']);
  return { callPlaced: callPlaced ?? null, callTime: callTime ?? null, callStatus: callStatus ?? null };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

// ============================================
// Global search (map panel) — Python parity
// ============================================

/**
 * GET /api/closure/search/events?vehicle=...&from=...&to=...&scope=tdd|all&limit=...&offset=...
 * Returns EventLog + Events_closure + EventLogCall across vehicles, filtered by:
 * - vehicle: plate/number (partial match) OR objectId (exact numeric)
 * - from/to: datetime range (required)
 */
router.get('/search/events', async (req, res) => {
  const fromStr = (req.query.from as string) || '';
  const toStr = (req.query.to as string) || '';
  const scope = (req.query.scope as string) === 'all' ? 'all' : 'tdd';
  const vehicle = String(req.query.vehicle || '').trim(); // plate substring or objectId (optional)
  const limit = clamp(Number(req.query.limit || 200), 1, 1000);
  const offset = clamp(Number(req.query.offset || 0), 0, 50_000);

  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (!fromStr || !toStr || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ success: false, error: 'from/to are required (ISO datetime)' });
  }
  const rangeMs = to.getTime() - from.getTime();
  const MAX_GLOBAL_RANGE_MS = 24 * 60 * 60 * 1000; // 24h for all-vehicles search
  if (!vehicle && (rangeMs <= 0 || rangeMs > MAX_GLOBAL_RANGE_MS)) {
    return res.status(400).json({
      success: false,
      error: 'For all-vehicles search, please select a range <= 24 hours (or enter a vehicle).',
    });
  }

  try {
    await getTrackingPool();

    // Resolve objectIds for a plate search (via linked server). Optional.
    const numericOid = vehicle && /^\d+$/.test(vehicle) ? Number(vehicle) : null;
    let objectIds: number[] | null = null;

    if (!vehicle) {
      objectIds = null; // global search
    } else if (numericOid && Number.isFinite(numericOid)) {
      objectIds = [numericOid];
    } else if (vehicle) {
      const oidRows = await queryTracking<{ ObjectId: number; Number: string }>(
        `
          SELECT TOP (50)
            O.ObjectId,
            O.Number
          FROM [TAVL_REMOTE].[tavl2].[tavl].[Object] O WITH (NOLOCK)
          WHERE O.Number LIKE @veh
          ORDER BY O.Number
        `,
        { veh: `%${vehicle}%` }
      );
      objectIds = oidRows.map((r) => Number(r.ObjectId)).filter((n) => Number.isFinite(n));
      if (objectIds.length === 0) objectIds = [-1]; // no match → empty result
    }

    // Python parity: when doing global search, always use TDD allowlist
    const effectiveScope = !vehicle ? 'tdd' : scope;
    const eventNameFilterSql =
      effectiveScope === 'tdd' ? ` AND A.Name IN (${sqlStringList(TDD_EVENT_NAMES)})` : '';

    const whereObj = objectIds ? ` AND A.ObjectId IN (${(objectIds || [-1]).slice(0, 50).join(',')})` : '';

    const effLimit = !vehicle ? Math.min(limit, 200) : limit;
    const effOffset = !vehicle ? Math.min(offset, 10_000) : offset;
    const rows = await queryTracking<any>(
      `
        SELECT
          A.EventLogId AS alertId,
          A.ObjectId AS objectId,
          A.GpsTime AS eventTime,
          A.Name AS eventType,
          B.Closure_DT AS closureDateTime,
          B.Agent_Name AS closedBy,
          B.Base_Name AS closingBase,
          B.Appear_DT AS gridTime
        FROM Tracking.dbo.EventLog A WITH (NOLOCK)
        LEFT JOIN Tracking.dbo.Events_closure B WITH (NOLOCK)
          ON A.EventLogId = B.Event_ID
        WHERE A.GpsTime >= @from
          AND A.GpsTime <= @to
          ${eventNameFilterSql}
          ${whereObj}
        ORDER BY A.EventLogId DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `,
      { from, to, limit: effLimit, offset: effOffset }
    );

    // Resolve plates in one shot (avoid per-row linked-server join)
    const objectIdList = Array.from(new Set(rows.map((r: any) => Number(r.objectId)).filter((n: number) => Number.isFinite(n)))).slice(0, 50);
    let plateMap: Record<string, string> = {};
    if (objectIdList.length > 0) {
      try {
        const plateRows = await queryTracking<{ ObjectId: number; Number: string }>(
          `
            SELECT ObjectId, Number
            FROM [TAVL_REMOTE].[tavl2].[tavl].[Object] WITH (NOLOCK)
            WHERE ObjectId IN (${objectIdList.join(',')})
          `
        );
        for (const pr of (plateRows || [])) {
          const k = String(pr.ObjectId);
          if (pr.Number) plateMap[k] = String(pr.Number);
        }
      } catch {
        plateMap = {};
      }
    }

    const eventIds = rows.map((r: any) => Number(r.alertId)).filter((n: number) => !Number.isNaN(n));

    // Fetch latest call per event (optional)
    let eventCallMap: Record<string, any> = {};
    try {
      const callCols = await getTrackingTableColumns('EventLogCall');
      if (callCols.length > 0 && eventIds.length > 0) {
        const orderCol =
          callCols.includes('CreationTime') ? 'CreationTime' :
          callCols.includes('LogTime') ? 'LogTime' :
          callCols.includes('CallTime') ? 'CallTime' :
          null;
        const idList = eventIds.slice(0, 300).join(',');
        const callRows = await queryTracking<any>(
          `
            WITH X AS (
              SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY EventLogId
                  ORDER BY ${orderCol ? `[${orderCol}] DESC` : 'EventLogId DESC'}
                ) AS rn
              FROM Tracking.dbo.EventLogCall WITH (NOLOCK)
              WHERE EventLogId IN (${idList})
            )
            SELECT * FROM X WHERE rn = 1
          `
        );
        for (const c of callRows) {
          const id = c.EventLogId?.toString?.();
          if (id) eventCallMap[id] = c;
        }
      }
    } catch {
      eventCallMap = {};
    }

    const events = rows.map((r: any) => {
      const call = eventCallMap[r.alertId?.toString?.() ?? ''] || null;
      const norm = normalizeCallFields(call);
      const handled = !!r.closureDateTime;
      return {
        alertId: r.alertId?.toString?.() ?? null,
        objectId: r.objectId?.toString?.() ?? null,
        vehicleReg: plateMap[r.objectId?.toString?.() ?? ''] || null,
        eventTime: r.eventTime || null,
        eventType: r.eventType || '',
        closureStatus: handled ? 'Handled' : 'Un-Handled',
        closureDateTime: r.closureDateTime || null,
        closedBy: r.closedBy || null,
        closingBase: r.closingBase || null,
        gridTime: r.gridTime || null,
        callPlaced: norm.callPlaced,
        callTime: norm.callTime,
        callStatus: norm.callStatus,
        autoCallPlaced: null,
        autoCallTime: null,
        autoCallStatus: null,
        autoUserInput: null,
        autoCallDuration: null,
      };
    });

    // Enrich events with AutoCalls data (AlertType=1: battery/late night)
    try {
      await initAutoCallsDatabase();
      const uniquePlates = [...new Set(events.map((e: any) => e.vehicleReg).filter(Boolean))];
      if (uniquePlates.length > 0) {
        const WINDOW_MS = 30 * 60 * 1000;
        const fmtLocal = (d: Date) => {
          const p = (n: number) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        };
        const pktStrToMs = (s: string) => {
          const m = String(s).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (!m) return 0;
          return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        };
        for (const plate of uniquePlates) {
          const autoRows = await queryAutoCalls(`
            SELECT LogTime, CallPlacedTime, CallReceiveTime, CallEndTime,
                   CallStatus, CSId, Duration, UserInput, AlertTypeName
            FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
            WHERE RegNum = @regNum AND AlertType = 1
              AND LogTime >= @fromDate AND LogTime <= @toDate
            ORDER BY LogTime DESC
          `, {
            regNum: plate,
            fromDate: fmtLocal(from),
            toDate: fmtLocal(to),
          });
          if (autoRows && autoRows.length > 0) {
            for (const evt of events) {
              if (evt.vehicleReg !== plate) continue;
              const evtMs = evt.eventTime ? new Date(evt.eventTime).getTime() : 0;
              if (!evtMs) continue;
              let closest = null;
              let closestDist = Infinity;
              for (const a of autoRows) {
                const aMs = a.LogTime ? pktStrToMs(a.LogTime) : 0;
                if (!aMs) continue;
                const dist = Math.abs(aMs - evtMs);
                if (dist <= WINDOW_MS && dist < closestDist) {
                  closest = a;
                  closestDist = dist;
                }
              }
              if (closest) {
                evt.autoCallPlaced = closest.CallPlacedTime || null;
                evt.autoCallTime = closest.CallReceiveTime || closest.LogTime || null;
                evt.autoCallStatus = closest.CallStatus || null;
                evt.autoUserInput = closest.UserInput || null;
                evt.autoCallDuration = closest.Duration ?? null;
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('AutoCalls enrichment failed for events:', e.message);
    }

    res.json({ success: true, data: events });
  } catch (error: any) {
    console.error('❌ Closure events search error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/closure/search/warnings?vehicle=...&from=...&to=...&limit=...&offset=...
 * Returns ConsoleWarning + ConsoleWarningCall across vehicles.
 */
router.get('/search/warnings', async (req, res) => {
  const fromStr = (req.query.from as string) || '';
  const toStr = (req.query.to as string) || '';
  const vehicle = String(req.query.vehicle || '').trim();
  const limit = clamp(Number(req.query.limit || 200), 1, 1000);
  const offset = clamp(Number(req.query.offset || 0), 0, 50_000);

  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (!fromStr || !toStr || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ success: false, error: 'from/to are required (ISO datetime)' });
  }
  const rangeMs = to.getTime() - from.getTime();
  const MAX_GLOBAL_RANGE_MS = 6 * 60 * 60 * 1000; // 6h for all-vehicles warnings search
  if (!vehicle && (rangeMs <= 0 || rangeMs > MAX_GLOBAL_RANGE_MS)) {
    return res.status(400).json({
      success: false,
      error: 'For all-vehicles WC search, please select a range <= 6 hours (or enter a vehicle).',
    });
  }

  try {
    await getTrackingPool();

    const numericOid = vehicle && /^\d+$/.test(vehicle) ? Number(vehicle) : null;
    let objectIds: number[] | null = null;
    if (!vehicle) {
      objectIds = null; // global search
    } else if (numericOid && Number.isFinite(numericOid)) {
      objectIds = [numericOid];
    } else if (vehicle) {
      const oidRows = await queryTracking<{ ObjectId: number; Number: string }>(
        `
          SELECT TOP (50)
            O.ObjectId,
            O.Number
          FROM [TAVL_REMOTE].[tavl2].[tavl].[Object] O WITH (NOLOCK)
          WHERE O.Number LIKE @veh
          ORDER BY O.Number
        `,
        { veh: `%${vehicle}%` }
      );
      objectIds = oidRows.map((r) => Number(r.ObjectId)).filter((n) => Number.isFinite(n));
      if (objectIds.length === 0) objectIds = [-1];
    }

    const whereObj = objectIds ? ` AND A.ObjectId IN (${(objectIds || [-1]).slice(0, 50).join(',')})` : '';

    const effLimit = !vehicle ? Math.min(limit, 200) : limit;
    const effOffset = !vehicle ? Math.min(offset, 10_000) : offset;
    const rows = await queryTracking<any>(
      `
        SELECT
          A.WarningId AS warningId,
          A.ObjectId AS objectId,
          A.MessageText AS messageText,
          A.CreationTime AS createdTime,
          A.SourceTime AS emittedTime,
          A.ZoneName AS zoneName,
          A.GpsTime AS gpsTime,
          A.Speed AS speed,
          A.Angle AS angle,
          A.Satelites AS satellites,
          A.X AS x,
          A.Y AS y,
          CWC.Detail AS callDetail,
          CWC.CreationTime AS callTime,
          CWC.CallStatus AS callStatus,
          CWC.UserInput AS userInput
        FROM Tracking.dbo.ConsoleWarning A WITH (NOLOCK)
        LEFT JOIN Tracking.dbo.ConsoleWarningCall CWC WITH (NOLOCK)
          ON A.WarningId = CWC.WarningId
        WHERE A.CreationTime >= @from
          AND A.CreationTime <= @to
          ${whereObj}
        ORDER BY A.WarningId DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `,
      { from, to, limit: effLimit, offset: effOffset }
    );

    const objectIdList = Array.from(new Set(rows.map((r: any) => Number(r.objectId)).filter((n: number) => Number.isFinite(n)))).slice(0, 50);
    let plateMap: Record<string, string> = {};
    if (objectIdList.length > 0) {
      try {
        const plateRows = await queryTracking<{ ObjectId: number; Number: string }>(
          `
            SELECT ObjectId, Number
            FROM [TAVL_REMOTE].[tavl2].[tavl].[Object] WITH (NOLOCK)
            WHERE ObjectId IN (${objectIdList.join(',')})
          `
        );
        for (const pr of (plateRows || [])) {
          const k = String(pr.ObjectId);
          if (pr.Number) plateMap[k] = String(pr.Number);
        }
      } catch {
        plateMap = {};
      }
    }

    const warnings = rows.map((w: any) => ({
      warningId: w.warningId ?? null,
      objectId: w.objectId?.toString?.() ?? null,
      vehicleReg: plateMap[w.objectId?.toString?.() ?? ''] || null,
      createdTime: w.createdTime || null,
      emittedTime: w.emittedTime || null,
      zoneName: w.zoneName || null,
      gpsTime: w.gpsTime || null,
      messageText: w.messageText || null,
      callTime: w.callTime || null,
      callStatus: w.callStatus || null,
      userInput: w.userInput || null,
      callDuration: null,
    }));

    // Enrich warnings with AutoCalls data (AlertType=2: geofence)
    try {
      await initAutoCallsDatabase();
      const warningIds = warnings.map((w: any) => w.warningId).filter(Boolean);
      if (warningIds.length > 0) {
        const idList = warningIds.slice(0, 300).join(',');
        const autoWarnRows = await queryAutoCalls(`
          SELECT AlertId, CallPlacedTime, CallReceiveTime, CallEndTime,
                 CallStatus, CSId, UserInput, LogTime, Duration
          FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
          WHERE AlertId IN (${idList}) AND AlertType = 2
        `);
        if (autoWarnRows && autoWarnRows.length > 0) {
          const warnByAlertId: Record<string, any> = {};
          for (const a of autoWarnRows) {
            const key = String(a.AlertId);
            if (!warnByAlertId[key] || new Date(a.LogTime) > new Date(warnByAlertId[key].LogTime)) {
              warnByAlertId[key] = a;
            }
          }
          for (const w of warnings) {
            const match = warnByAlertId[String(w.warningId)];
            if (match) {
              if (!w.callStatus) w.callStatus = match.CallStatus || null;
              if (!w.callTime) w.callTime = match.CallReceiveTime || match.LogTime || null;
              if (!w.userInput) w.userInput = match.UserInput || null;
              if (!w.callDuration) w.callDuration = match.Duration ?? null;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('AutoCalls enrichment failed for warnings:', e.message);
    }

    res.json({ success: true, data: warnings });
  } catch (error: any) {
    console.error('❌ Closure warnings search error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/closure/:objectId?from=...&to=...&limit=...
router.get('/:objectId', async (req, res) => {
  const objectIdStr = req.params.objectId;
  const objectId = Number(objectIdStr);

  if (!objectIdStr || Number.isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }

  const fromStr = (req.query.from as string) || '';
  const toStr = (req.query.to as string) || '';
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);

  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // By default, match the TDD panel behavior (only particular EventLog names).
  // Use scope=all to fetch all EventLog names for the vehicle.
  const scope = (req.query.scope as string) === 'all' ? 'all' : 'tdd';

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid from/to date' });
  }

  try {
    // Ensure pool is connected (and fail early with useful error)
    await getTrackingPool();

    // 1) EventLog + closure
    const eventNameFilterSql =
      scope === 'tdd' ? ` AND A.Name IN (${sqlStringList(TDD_EVENT_NAMES)})` : '';

    const eventRows = await queryTracking<any>(
      `
        SELECT TOP (@limit)
          A.EventLogId AS alertId,
          A.ObjectId AS objectId,
          A.GpsTime AS eventTime,
          A.Name AS eventType,
          B.Closure_DT AS closureDateTime,
          B.Agent_Name AS closedBy,
          B.Base_Name AS closingBase,
          B.Appear_DT AS gridTime
        FROM Tracking.dbo.EventLog A WITH (NOLOCK)
        LEFT JOIN Tracking.dbo.Events_closure B WITH (NOLOCK)
          ON A.EventLogId = B.Event_ID
        WHERE A.ObjectId = @objectId
          AND A.GpsTime >= @from
          AND A.GpsTime <= @to
          ${eventNameFilterSql}
        ORDER BY A.EventLogId DESC
      `,
      { objectId, from, to, limit }
    );

    const eventIds = eventRows.map((r: any) => Number(r.alertId)).filter((n: number) => !Number.isNaN(n));

    // 1b) Fetch latest EventLogCall per event (if table exists)
    let eventCallMap: Record<string, any> = {};
    try {
      const callCols = await getTrackingTableColumns('EventLogCall');
      if (callCols.length > 0 && eventIds.length > 0) {
        const orderCol =
          callCols.includes('CreationTime') ? 'CreationTime' :
          callCols.includes('LogTime') ? 'LogTime' :
          callCols.includes('CallTime') ? 'CallTime' :
          null;

        // Build safe IN list (numbers only)
        const idList = eventIds.slice(0, 300).join(',');
        const callRows = await queryTracking<any>(
          `
            WITH X AS (
              SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY EventLogId
                  ORDER BY ${orderCol ? `[${orderCol}] DESC` : 'EventLogId DESC'}
                ) AS rn
              FROM Tracking.dbo.EventLogCall WITH (NOLOCK)
              WHERE EventLogId IN (${idList})
            )
            SELECT * FROM X WHERE rn = 1
          `
        );

        for (const c of callRows) {
          const id = c.EventLogId?.toString?.();
          if (id) eventCallMap[id] = c;
        }
      }
    } catch {
      // If table not present / permission denied, just skip call fields
      eventCallMap = {};
    }

    const events = eventRows.map((r: any) => {
      const call = eventCallMap[r.alertId?.toString?.() ?? ''] || null;
      const norm = normalizeCallFields(call);
      const handled = !!r.closureDateTime;
      return {
        alertId: r.alertId?.toString?.() ?? null,
        objectId: r.objectId?.toString?.() ?? objectIdStr,
        eventTime: r.eventTime || null,
        eventType: r.eventType || '',
        closureStatus: handled ? 'Handled' : 'Un-Handled',
        closureDateTime: r.closureDateTime || null,
        closedBy: r.closedBy || null,
        closingBase: r.closingBase || null,
        gridTime: r.gridTime || null,
        callPlaced: norm.callPlaced,
        callTime: norm.callTime,
        callStatus: norm.callStatus,
        autoCallPlaced: null,
        autoCallTime: null,
        autoCallStatus: null,
        autoUserInput: null,
        autoCallDuration: null,
      };
    });

    // Enrich events with AutoCalls data (AlertType=1: battery/late night)
    try {
      await initAutoCallsDatabase();
      // Resolve plate number from objectId
      let regNum: string | null = null;
      const pgRows = await queryPostgres(
        `SELECT plate_number FROM tavl_devices WHERE object_id = $1 LIMIT 1`,
        [objectId]
      );
      if (pgRows && pgRows.length > 0 && pgRows[0].plate_number) {
        regNum = String(pgRows[0].plate_number).trim();
      } else {
        const tavlRows = await queryTavl(
          `SELECT TOP 1 Number FROM [tavl2].[tavl].[Object] WITH (NOLOCK) WHERE ObjectId = @objectId`,
          { objectId }
        );
        if (tavlRows && tavlRows.length > 0 && tavlRows[0].Number) {
          regNum = String(tavlRows[0].Number).trim();
        }
      }

      if (regNum) {
        // Use local datetime strings (PKT) instead of UTC to match MSSQL's PKT LogTime
        const fmtLocal = (d: Date) => {
          const p = (n: number) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        };
        const autoRows = await queryAutoCalls(`
          SELECT LogTime, CallPlacedTime, CallReceiveTime, CallEndTime,
                 CallStatus, CSId, Duration, UserInput, AlertTypeName
          FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
          WHERE RegNum = @regNum AND AlertType = 1
            AND LogTime >= @fromDate AND LogTime <= @toDate
          ORDER BY LogTime DESC
        `, {
          regNum,
          fromDate: fmtLocal(from),
          toDate: fmtLocal(to),
        });

        if (autoRows && autoRows.length > 0) {
          const WINDOW_MS = 30 * 60 * 1000;
          // AutoCalls LogTime varchar is PKT; parse as UTC to match MSSQL driver's PKT-as-UTC behavior
          const pktStrToMs = (s: string) => {
            const m = String(s).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
            if (!m) return 0;
            return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
          };
          for (const evt of events) {
            const evtMs = evt.eventTime ? new Date(evt.eventTime).getTime() : 0;
            if (!evtMs) continue;
            let closest = null;
            let closestDist = Infinity;
            for (const a of autoRows) {
              const aMs = a.LogTime ? pktStrToMs(a.LogTime) : 0;
              if (!aMs) continue;
              const dist = Math.abs(aMs - evtMs);
              if (dist <= WINDOW_MS && dist < closestDist) {
                closest = a;
                closestDist = dist;
              }
            }
            if (closest) {
              evt.autoCallPlaced = closest.CallPlacedTime || null;
              evt.autoCallTime = closest.CallReceiveTime || closest.LogTime || null;
              evt.autoCallStatus = closest.CallStatus || null;
              evt.autoUserInput = closest.UserInput || null;
              evt.autoCallDuration = closest.Duration ?? null;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('AutoCalls enrichment failed for events:', e.message);
    }

    // 2) ConsoleWarning + call info (TDD Warning Console)
    const warnings = await queryTracking<any>(
      `
        SELECT TOP (@limit)
          A.WarningId AS warningId,
          A.ObjectId AS objectId,
          A.MessageText AS messageText,
          A.CreationTime AS createdTime,
          A.SourceTime AS emittedTime,
          A.ZoneName AS zoneName,
          A.GpsTime AS gpsTime,
          A.Speed AS speed,
          A.Angle AS angle,
          A.Satelites AS satellites,
          A.X AS x,
          A.Y AS y,
          CWC.Detail AS callDetail,
          CWC.CreationTime AS callTime,
          CWC.CallStatus AS callStatus,
          CWC.UserInput AS userInput
        FROM Tracking.dbo.ConsoleWarning A WITH (NOLOCK)
        LEFT JOIN Tracking.dbo.ConsoleWarningCall CWC WITH (NOLOCK)
          ON A.WarningId = CWC.WarningId
        WHERE A.ObjectId = @objectId
          AND A.CreationTime >= @from
          AND A.CreationTime <= @to
        ORDER BY A.WarningId DESC
      `,
      { objectId, from, to, limit }
    );

    // Enrich warnings with AutoCalls data (AlertType=2: geofence)
    try {
      const warningIds = warnings.map((w: any) => w.warningId).filter(Boolean);
      if (warningIds.length > 0 && regNum) {
        const idList = warningIds.slice(0, 300).join(',');
        const autoWarnRows = await queryAutoCalls(`
          SELECT AlertId, CallPlacedTime, CallReceiveTime, CallEndTime,
                 CallStatus, CSId, UserInput, LogTime, Duration
          FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
          WHERE AlertId IN (${idList}) AND AlertType = 2
        `);

        if (autoWarnRows && autoWarnRows.length > 0) {
          const warnByAlertId: Record<string, any> = {};
          for (const a of autoWarnRows) {
            const key = String(a.AlertId);
            if (!warnByAlertId[key] || new Date(a.LogTime) > new Date(warnByAlertId[key].LogTime)) {
              warnByAlertId[key] = a;
            }
          }
          for (const w of warnings) {
            const match = warnByAlertId[String(w.warningId)];
            if (match) {
              // Only supplement if ConsoleWarningCall returned nothing
              if (!w.callStatus) w.callStatus = match.CallStatus || null;
              if (!w.callTime) w.callTime = match.CallReceiveTime || match.LogTime || null;
              if (!w.userInput) w.userInput = match.UserInput || null;
              if (!w.callDuration) w.callDuration = match.Duration ?? null;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('AutoCalls enrichment failed for warnings:', e.message);
    }

    res.json({
      success: true,
      data: {
        events,
        warnings,
        range: { from: from.toISOString(), to: to.toISOString() },
      },
    });
  } catch (error: any) {
    console.error('❌ Closure fetch error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

