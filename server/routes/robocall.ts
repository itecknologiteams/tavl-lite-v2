/**
 * Robocall Status API Routes
 * Fetches automated call status for alerts from AutoCalls database
 * 
 * AlertType mapping in AutoCalls.dbo.CallDetails:
 *   AlertType = 1 → Battery Tamper, Late Night Ignition
 *   AlertType = 2 → Geofence / Console Warning
 * 
 * Note: AutoCalls uses Tracking.dbo.ConsoleWarning.WarningId as AlertId.
 * We lookup WarningId by objectId + time proximity when warningId is not known.
 */
import { Router } from 'express';
import { initAutoCallsDatabase, queryAutoCalls } from '../db/autoCalls';
import sql from 'mssql';
import { getTrackingPool } from '../db/tracking';

const router = Router();

// In-memory TTL cache (60 seconds)
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60_000;

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }
}

// Map frontend alert type string → AutoCalls AlertType number
function getAutoCallAlertType(alertType?: string): number | null {
  if (!alertType) return null;
  const t = alertType.toLowerCase();
  if (t.includes('battery') || t.includes('late_night') || t.includes('late night')) return 1;
  if (t.includes('geofence') || t.includes('console')) return 2;
  return null; // unknown — search both types
}

// Call status mapping
const CALL_STATUS_MAP: Record<number, string> = {
  1: 'dialing',
  2: 'ringing',
  3: 'answered',
  4: 'no_answer',
  5: 'rejected',
  6: 'failed',
  7: 'unavailable',
};

function maskPhone(phone: string): string {
  return phone.length > 4 ? phone.slice(0, 3) + '****' + phone.slice(-4) : phone;
}

// Wall-clock comparison helpers. Alert occurredAt arrives as e.g.
// "2026-06-01T17:38:32.000Z" but the trailing Z is spurious — it's actually PKT
// wall-clock, the same clock CallDetails.CallPlacedTime ("2026-06-01 17:42:15")
// uses. So we extract Y-M-D H:M:S from either format and compare as wall-clock
// (built on a UTC base for both sides) instead of trusting timezone tags.
function wallClockMs(s?: string): number {
  if (!s) return NaN;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
function fmtWall(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// GET /api/robocall/history - Autocall history by reg number + date range
router.get('/history', async (req, res) => {
  const { regNum, dateFrom, dateTo, limit: qLimit } = req.query;

  if (!regNum) {
    return res.status(400).json({ success: false, error: 'regNum query param required' });
  }

  const lim = Math.min(parseInt(qLimit as string) || 100, 300);
  const from = dateFrom || '2000-01-01 00:00:00';
  const to = dateTo || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 23:59:59`; })();

  try {
    await initAutoCallsDatabase();
    const rows = await queryAutoCalls(`
      SELECT TOP ${lim}
        cd.[CLId],
        CONVERT(varchar(19), cd.[LogTime], 120) AS LogTime,
        cd.[RegNum],
        cd.[PhoneNumber],
        cd.[AlertTypeName],
        cd.[AlertType],
        cd.[CallType],
        cd.[CallStatus],
        cd.[CSId],
        cd.[SoundFile],
        CONVERT(varchar(19), cd.[CallReceiveTime], 120) AS CallReceiveTime,
        CONVERT(varchar(19), cd.[CallEndTime], 120) AS CallEndTime,
        cd.[Duration],
        cd.[UserInput],
        ISNULL(cl.[Attempts], 0) AS Attempts
      FROM [AutoCalls].[dbo].[CallDetails] cd WITH (NOLOCK)
      LEFT JOIN [AutoCalls].[dbo].[CallLogs] cl WITH (NOLOCK) ON cd.[CLId] = cl.[CLId]
      WHERE cd.[RegNum] = @regNum
        AND cd.[LogTime] >= CONVERT(datetime, @fromDate, 120)
        AND cd.[LogTime] <= CONVERT(datetime, @toDate, 120)
      ORDER BY cd.[LogTime] DESC
    `, { regNum: String(regNum), fromDate: from, toDate: to });

    res.json({ success: true, data: rows || [] });
  } catch (error: any) {
    console.error('❌ Autocall history error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/robocall/:alertId - Get robocall status for a single alert
// alertType query param optional: 'battery', 'geofence', etc.
router.get('/:alertId', async (req, res) => {
  const alertId = req.params.alertId;
  const alertTypeCode = getAutoCallAlertType(req.query.alertType as string);

  if (!alertId || isNaN(Number(alertId))) {
    return res.status(400).json({ success: false, error: 'Invalid alertId' });
  }

  try {
    const cacheKey = `robocall:${alertId}:${alertTypeCode ?? 'any'}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    await initAutoCallsDatabase();

    const alertTypeFilter = alertTypeCode !== null
      ? `AND [AlertType] = ${alertTypeCode}`
      : `AND [AlertType] IN (1, 2)`;

    const query = `
      SELECT TOP 1 
        [CLId],
        CONVERT(varchar(19), [LogTime], 120)         AS LogTime,
        [CSId],
        [CallStatus],
        [CallType],
        CONVERT(varchar(19), [CallPlacedTime], 120)  AS CallPlacedTime,
        [AlertId],
        [AlertType],
        CONVERT(varchar(19), [CallReceiveTime], 120) AS CallReceiveTime,
        CONVERT(varchar(19), [CallEndTime], 120)     AS CallEndTime,
        [Duration],
        [UserInput],
        [PhoneNumber],
        [VehicleId]
      FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
      WHERE [AlertId] = @alertId ${alertTypeFilter}
      ORDER BY [LogTime] DESC
    `;

    const result = await queryAutoCalls(query, { alertId: Number(alertId) });

    if (result && result.length > 0) {
      const call = result[0];
      const statusCode = call.CSId || 0;
      const status = CALL_STATUS_MAP[statusCode] || 'unknown';

      const response = {
        success: true,
        data: {
          alertId: call.AlertId?.toString(),
          status,
          statusCode,
          statusText: call.CallStatus,
          callPlacedAt: call.CallPlacedTime,
          callReceivedAt: call.CallReceiveTime,
          callEndedAt: call.CallEndTime,
          duration: call.Duration || 0,
          userInput: call.UserInput || '',
          phoneNumber: maskPhone(call.PhoneNumber || ''),
          vehicleId: call.VehicleId?.toString(),
        },
      };
      setCache(cacheKey, response);
      res.json(response);
    } else {
      const response = { success: true, data: null };
      setCache(cacheKey, response);
      res.json(response);
    }
  } catch (error: any) {
    console.error('❌ Robocall status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/robocall/batch - Get robocall status for multiple alerts (no type info available)
router.post('/batch', async (req, res) => {
  const { alertIds } = req.body;

  if (!alertIds || !Array.isArray(alertIds) || alertIds.length === 0) {
    return res.status(400).json({ success: false, error: 'alertIds array required' });
  }

  const limitedIds = alertIds.slice(0, 50);
  const batchKey = `robocall:batch:${limitedIds.sort().join(',')}`;

  try {
    const cached = getCached(batchKey);
    if (cached) return res.json(cached);

    await initAutoCallsDatabase();

    const idList = limitedIds.map(id => Number(id)).filter(id => !isNaN(id));
    if (idList.length === 0) return res.json({ success: true, data: {} });

    // Search both AlertType 1 and 2 since we don't know type per ID
    const query = `
      SELECT 
        [CLId],
        CONVERT(varchar(19), [LogTime], 120)         AS LogTime,
        [CSId],
        [CallStatus],
        CONVERT(varchar(19), [CallPlacedTime], 120)  AS CallPlacedTime,
        [AlertId],
        [AlertType],
        CONVERT(varchar(19), [CallReceiveTime], 120) AS CallReceiveTime,
        CONVERT(varchar(19), [CallEndTime], 120)     AS CallEndTime,
        [Duration],
        [UserInput],
        [PhoneNumber]
      FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
      WHERE [AlertId] IN (${idList.join(',')}) AND [AlertType] IN (1, 2)
    `;

    const results = await queryAutoCalls(query);

    const statusMap: Record<string, any> = {};
    for (const call of results) {
      const alertId = call.AlertId?.toString();
      if (!alertId) continue;
      if (!statusMap[alertId] || new Date(call.LogTime) > new Date(statusMap[alertId].logTime)) {
        const statusCode = call.CSId || 0;
        const status = CALL_STATUS_MAP[statusCode] || 'unknown';
        statusMap[alertId] = {
          alertId,
          status,
          statusCode,
          statusText: call.CallStatus,
          callPlacedAt: call.CallPlacedTime,
          callReceivedAt: call.CallReceiveTime,
          callEndedAt: call.CallEndTime,
          duration: call.Duration || 0,
          userInput: call.UserInput || '',
          phoneNumber: maskPhone(call.PhoneNumber || ''),
          logTime: call.LogTime,
        };
      }
    }

    Object.values(statusMap).forEach((item: any) => delete item.logTime);

    const response = { success: true, data: statusMap };
    setCache(batchKey, response);
    res.json(response);
  } catch (error: any) {
    console.error('❌ Robocall batch status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/robocall/lookup - Lookup robocall status by warningId or objectId + timestamp
// Each alert in payload: { id, objectId, timestamp, alertType, warningId? }
router.post('/lookup', async (req, res) => {
  const { alerts } = req.body;

  if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
    return res.status(400).json({ success: false, error: 'alerts array required' });
  }

  const limitedAlerts = alerts.slice(0, 30);

  try {
    await initAutoCallsDatabase();

    const statusMap: Record<string, any> = {};

    // Routing: prefer plate + time match (alerts are sourced from EventLog and carry
    // no WarningId, so we correlate the robocall by RegNum + event time). Fall back to
    // warningId (ConsoleWarning-sourced alerts) or objectId for older callers.
    const regLookupAlerts: typeof limitedAlerts = [];
    const directLookupAlerts: typeof limitedAlerts = [];
    const needsLookup: typeof limitedAlerts = [];

    for (const alert of limitedAlerts) {
      if (alert.reg && alert.timestamp) {
        regLookupAlerts.push(alert);
      } else if (alert.warningId) {
        directLookupAlerts.push(alert);
      } else if (alert.objectId) {
        needsLookup.push(alert);
      }
    }

    // ── Plate + time-window match against CallDetails (RegNum / CallPlacedTime) ──
    // CallDetails exposes RegNum + the live CSId/CallStatus (Dialing/Ringing/Received/
    // No Answer/Rejected/Failed), so this surfaces the exact current call state.
    if (regLookupAlerts.length > 0) {
      // A robocall counts as "this alert's" if placed within ±WINDOW of the event.
      // Observed: related calls land ~3-9 min before/after the alert; unrelated earlier
      // calls sit well outside this. Tune ROBOCALL_MATCH_WINDOW_MIN if needed.
      const WINDOW_MS = (parseInt(process.env.ROBOCALL_MATCH_WINDOW_MIN || '30')) * 60 * 1000;
      const parsed = regLookupAlerts
        .map((a) => ({ a, t: wallClockMs(a.timestamp) }))
        .filter((x) => !isNaN(x.t));

      if (parsed.length > 0) {
        const regs = [...new Set(parsed.map((x) => String(x.a.reg).trim()).filter(Boolean))];
        const params: Record<string, any> = {
          minTs: fmtWall(Math.min(...parsed.map((x) => x.t)) - WINDOW_MS),
          maxTs: fmtWall(Math.max(...parsed.map((x) => x.t)) + WINDOW_MS),
        };
        const placeholders = regs.map((r, i) => { params[`reg${i}`] = r; return `@reg${i}`; });

        const rows = await queryAutoCalls(`
          SELECT [RegNum], [AlertType], [CSId], [CallStatus],
            CONVERT(varchar(19), [CallPlacedTime], 120)  AS CallPlacedTime,
            CONVERT(varchar(19), [CallReceiveTime], 120) AS CallReceiveTime,
            CONVERT(varchar(19), [CallEndTime], 120)     AS CallEndTime,
            [Duration], [UserInput], [PhoneNumber]
          FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
          WHERE [RegNum] IN (${placeholders.join(',')})
            AND [CallPlacedTime] BETWEEN CONVERT(datetime, @minTs, 120) AND CONVERT(datetime, @maxTs, 120)
        `, params);

        const byReg: Record<string, any[]> = {};
        for (const row of rows) {
          const k = String(row.RegNum || '').trim();
          (byReg[k] = byReg[k] || []).push(row);
        }

        for (const { a, t } of parsed) {
          const reg = String(a.reg).trim();
          const inWindow = (byReg[reg] || []).filter((r) => {
            const ct = wallClockMs(r.CallPlacedTime);
            return !isNaN(ct) && Math.abs(ct - t) <= WINDOW_MS;
          });
          if (inWindow.length === 0) continue;

          // Prefer the expected AlertType (battery=1/Event, geofence=2/Warning) when it
          // resolves; otherwise accept any. Then take the call placed CLOSEST to the
          // alert event time (best attribution when a vehicle has several calls).
          const wantType = getAutoCallAlertType(a.alertType);
          const pool = wantType != null && inWindow.some((r) => r.AlertType === wantType)
            ? inWindow.filter((r) => r.AlertType === wantType)
            : inWindow;
          pool.sort((x, y) => Math.abs(wallClockMs(x.CallPlacedTime) - t) - Math.abs(wallClockMs(y.CallPlacedTime) - t));
          const call = pool[0];
          const statusCode = call.CSId || 0;
          statusMap[a.id] = {
            alertId: a.id,
            status: CALL_STATUS_MAP[statusCode] || 'unknown',
            statusCode,
            statusText: call.CallStatus,
            callPlacedAt: call.CallPlacedTime,
            callReceivedAt: call.CallReceiveTime,
            callEndedAt: call.CallEndTime,
            duration: call.Duration || 0,
            userInput: call.UserInput || '',
            phoneNumber: maskPhone(call.PhoneNumber || ''),
          };
        }
      }
    }

    // Direct lookup for alerts with warningId — group by alertType for correct filtering
    if (directLookupAlerts.length > 0) {
      // Group by alertType code so we query each type separately
      const byTypeCode: Record<number, typeof directLookupAlerts> = {};
      for (const alert of directLookupAlerts) {
        const typeCode = getAutoCallAlertType(alert.alertType) ?? 2; // default geofence
        if (!byTypeCode[typeCode]) byTypeCode[typeCode] = [];
        byTypeCode[typeCode].push(alert);
      }

      for (const [typeCode, group] of Object.entries(byTypeCode)) {
        const idList = group.map(a => Number(a.warningId)).filter(id => !isNaN(id));
        if (idList.length === 0) continue;

        const directQuery = `
          SELECT 
            [CSId], [CallStatus], [AlertId],
            CONVERT(varchar(19), [CallPlacedTime], 120)  AS CallPlacedTime,
            CONVERT(varchar(19), [CallReceiveTime], 120) AS CallReceiveTime,
            CONVERT(varchar(19), [CallEndTime], 120)     AS CallEndTime,
            [Duration], [UserInput], [PhoneNumber],
            CONVERT(varchar(19), [LogTime], 120)         AS LogTime
          FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
          WHERE [AlertId] IN (${idList.join(',')}) AND [AlertType] = ${typeCode}
        `;

        const directResults = await queryAutoCalls(directQuery);

        const byWarningId: Record<string, any> = {};
        for (const call of directResults) {
          const wId = call.AlertId?.toString();
          if (!wId) continue;
          if (!byWarningId[wId] || call.LogTime > byWarningId[wId].LogTime) {
            byWarningId[wId] = call;
          }
        }

        for (const alert of group) {
          if (byWarningId[alert.warningId]) {
            const call = byWarningId[alert.warningId];
            const statusCode = call.CSId || 0;
            statusMap[alert.id] = {
              alertId: alert.id,
              warningId: alert.warningId,
              status: CALL_STATUS_MAP[statusCode] || 'unknown',
              statusCode,
              statusText: call.CallStatus,
              callPlacedAt: call.CallPlacedTime,
              callReceivedAt: call.CallReceiveTime,
              callEndedAt: call.CallEndTime,
              duration: call.Duration || 0,
              userInput: call.UserInput || '',
              phoneNumber: maskPhone(call.PhoneNumber || ''),
            };
          }
        }
      }
    }

    // Fallback: lookup by objectId for alerts without warningId
    if (needsLookup.length > 0) {
      const trackingPool = await getTrackingPool();

      for (const alert of needsLookup) {
        const { id, objectId, timestamp, alertType } = alert;
        if (!objectId) continue;

        const alertTypeCode = getAutoCallAlertType(alertType) ?? 1; // battery is default for eventlog alerts

        try {
          const ts = timestamp ? new Date(timestamp) : null;
          const hasValidTs = !!ts && !isNaN(ts.getTime());

          const warningReq = trackingPool.request().input('objectId', sql.Int, parseInt(objectId));
          if (hasValidTs) warningReq.input('ts', sql.DateTime, ts as any);

          // Find the ConsoleWarning for this vehicle within ±30 minutes of the alert event time
          const warningResult = await warningReq.query(hasValidTs ? `
              SELECT TOP 1 WarningId, CreationTime
              FROM ConsoleWarning WITH (NOLOCK)
              WHERE ObjectId = @objectId
                AND CreationTime BETWEEN DATEADD(minute, -30, @ts) AND DATEADD(minute, 30, @ts)
              ORDER BY ABS(DATEDIFF(second, CreationTime, @ts)) ASC
            ` : `
              SELECT TOP 1 WarningId, CreationTime
              FROM ConsoleWarning WITH (NOLOCK)
              WHERE ObjectId = @objectId
                AND CreationTime > DATEADD(hour, -1, GETDATE())
              ORDER BY CreationTime DESC
            `);

          if (warningResult.recordset.length === 0) continue;

          const warningId = warningResult.recordset[0].WarningId;

          // Use the correct AlertType for battery (1) vs geofence (2)
          const callResult = await queryAutoCalls(`
            SELECT TOP 1 
              [CSId], [CallStatus], [AlertId],
              CONVERT(varchar(19), [CallPlacedTime], 120)  AS CallPlacedTime,
              CONVERT(varchar(19), [CallReceiveTime], 120) AS CallReceiveTime,
              CONVERT(varchar(19), [CallEndTime], 120)     AS CallEndTime,
              [Duration], [UserInput], [PhoneNumber]
            FROM [AutoCalls].[dbo].[CallDetails] WITH (NOLOCK)
            WHERE [AlertId] = @warningId AND [AlertType] = ${alertTypeCode}
            ORDER BY [LogTime] DESC
          `, { warningId: Number(warningId) });

          if (callResult && callResult.length > 0) {
            const call = callResult[0];
            const statusCode = call.CSId || 0;
            statusMap[id] = {
              alertId: id,
              warningId: warningId?.toString(),
              status: CALL_STATUS_MAP[statusCode] || 'unknown',
              statusCode,
              statusText: call.CallStatus,
              callPlacedAt: call.CallPlacedTime,
              callReceivedAt: call.CallReceiveTime,
              callEndedAt: call.CallEndTime,
              duration: call.Duration || 0,
              userInput: call.UserInput || '',
              phoneNumber: maskPhone(call.PhoneNumber || ''),
            };
          }
        } catch (err: any) {
          console.error(`Error looking up robocall for alert ${id}:`, err.message);
        }
      }
    }

    res.json({ success: true, data: statusMap });
  } catch (error: any) {
    console.error('❌ Robocall lookup error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
