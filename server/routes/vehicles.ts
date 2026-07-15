import { Router } from 'express';
import { queryTavl, queryTracking } from '../db/tavl';
import { queryCrm } from '../db/crm';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache: TAVL ObjectId → Tracking V_ID (populated from CRM VEHICLES)
// CRM VEHICLES.OBJECTIDINT = TAVL ObjectId, VEHICLES.V_ID = Tracking V_Id
// ─────────────────────────────────────────────────────────────────────────────
const objectIdToVehicleIdCache = new Map<number, number>();

/**
 * Resolve a single TAVL ObjectId → Tracking V_ID via CRM VEHICLES table.
 * Fast: indexed lookup on OBJECTIDINT column, no eventlog scan needed.
 */
async function resolveVehicleId(objectId: number): Promise<number | null> {
  const cached = objectIdToVehicleIdCache.get(objectId);
  if (cached) return cached;

  try {
    const rows = await queryCrm(
      `SELECT TOP 1 V_ID FROM VEHICLES WITH (NOLOCK) WHERE OBJECTIDINT = @objectId`,
      { objectId }
    );
    const vId = Number(rows?.[0]?.V_ID);
    if (vId && !isNaN(vId)) {
      objectIdToVehicleIdCache.set(objectId, vId);
      return vId;
    }
  } catch {
    // non-fatal
  }
  return null;
}

/**
 * Batch resolve multiple TAVL ObjectIds → Tracking V_IDs in one CRM query.
 */
async function batchResolveVehicleIds(objectIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const toFetch: number[] = [];

  for (const id of objectIds) {
    const cached = objectIdToVehicleIdCache.get(id);
    if (cached) {
      result.set(id, cached);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    try {
      // Single query for all missing ObjectIds — much faster than N individual queries
      const idList = toFetch.join(',');
      const rows = await queryCrm(
        `SELECT OBJECTIDINT, V_ID FROM VEHICLES WITH (NOLOCK) WHERE OBJECTIDINT IN (${idList})`
      );
      for (const row of (rows || [])) {
        const oId = Number(row.OBJECTIDINT);
        const vId = Number(row.V_ID);
        if (oId && vId) {
          objectIdToVehicleIdCache.set(oId, vId);
          result.set(oId, vId);
        }
      }
    } catch {
      // non-fatal
    }
  }

  return result;
}

// GPS columns to select from VehicleLastLocation
const GPS_SQL_COLUMNS = `
  V_Id,
  Y as Latitude, X as Longitude,
  Speed, Angle, Altitude,
  Satelites as Satellites,
  GpsTime, ServerTime,
  Valid,
  Ignition, EngineCut,
  Battery, BackupBattery, PowerVolt, GSMSignal,
  HarshBrake, HarshAccel, HarshCorner, SeatBelt,
  DATEDIFF(MINUTE, GpsTime, GETDATE()) as MinutesSinceUpdate
`;

function calcStatus(speed: number, minutesAgo: number): string {
  if (minutesAgo >= 1440) return 'offline';
  if (speed > 3) return 'moving';
  if (minutesAgo > 120) return 'parked';
  return 'idle';
}

function formatGpsRow(gps: any, objectId: number) {
  const minutesAgo = Number(gps.MinutesSinceUpdate) || 0;
  const speed = Number(gps.Speed) || 0;
  return {
    objectId,
    latitude: parseFloat(gps.Latitude) || 0,
    longitude: parseFloat(gps.Longitude) || 0,
    speed,
    angle: parseInt(gps.Angle) || 0,
    altitude: parseInt(gps.Altitude) || 0,
    satellites: parseInt(gps.Satellites) || 0,
    gpsTime: gps.GpsTime,
    serverTime: gps.ServerTime,
    minutesAgo,
    status: calcStatus(speed, minutesAgo),
    ignition: gps.Ignition,
    engineCut: gps.EngineCut,
    battery: gps.Battery,
    backupBattery: gps.BackupBattery,
    powerVolt: gps.PowerVolt,
    gsmSignal: gps.GSMSignal,
    harshBrake: gps.HarshBrake,
    harshAccel: gps.HarshAccel,
    harshCorner: gps.HarshCorner,
    seatbelt: gps.SeatBelt,
    fuelLevel: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicles/search?term=xxx&includeDeactivated=true
// Unified search: plate, IMEI, description, engine, VEH_REG, phone, customer
// All queries run in PARALLEL. Plate matching is normalized (hyphens/spaces
// stripped) so "AABE-134", "AABE134", and "AABE 134" all find the same vehicle.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const searchTerm = (req.query.term as string || '').trim();
  const includeDeactivated = req.query.includeDeactivated === 'true';

  if (!searchTerm || searchTerm.length < 2) {
    return res.status(400).json({ success: false, error: 'Search term must be at least 2 characters' });
  }

  console.log('🔍 Searching:', searchTerm);

  try {
    const searchPattern = `%${searchTerm}%`;
    const enabledFilter = includeDeactivated ? '' : 'AND Enabled = 1';

    // Normalized plate: strip hyphens, spaces, dots for plate matching
    const normalizedTerm = searchTerm.replace(/[-\s.]/g, '');
    const normalizedPattern = `%${normalizedTerm}%`;
    const normalizedExact = normalizedTerm;           // exact plate match
    const normalizedPrefix = `${normalizedTerm}%`;   // starts-with match

    // Phone normalization: strip non-digits, then strip country code prefix
    const digitsOnly = searchTerm.replace(/\D/g, '');
    let phoneCore = digitsOnly;
    if (phoneCore.startsWith('92') && phoneCore.length > 10) phoneCore = phoneCore.substring(2);
    if (phoneCore.startsWith('0') && phoneCore.length > 7) phoneCore = phoneCore.substring(1);
    const isPhoneLike = phoneCore.length >= 7;
    const phonePattern = isPhoneLike ? `%${phoneCore}%` : searchPattern;

    // ── Run all searches IN PARALLEL ────────────────────────────────────────
    const [tavlRows, regResults, engineResults, phoneResults, nameResults] = await Promise.all([

      // 1. TAVL: plate + IMEI + description (normalized plate matching)
      queryTavl(`
        SELECT TOP 30
          ObjectId, Number as PlateNumber, Comment as Description,
          ObjectCode as IMEI, Enabled
        FROM [tavl2].[tavl].[Object] WITH (NOLOCK)
        WHERE (
          REPLACE(REPLACE(REPLACE(Number, '-', ''), ' ', ''), '.', '') LIKE @normalized
          OR ObjectCode LIKE @search
          OR Comment LIKE @search
        )
          ${enabledFilter}
        ORDER BY
          CASE
            WHEN REPLACE(REPLACE(REPLACE(Number, '-', ''), ' ', ''), '.', '') = @exact THEN 0
            WHEN REPLACE(REPLACE(REPLACE(Number, '-', ''), ' ', ''), '.', '') LIKE @prefix THEN 1
            WHEN REPLACE(REPLACE(REPLACE(Number, '-', ''), ' ', ''), '.', '') LIKE @normalized THEN 2
            ELSE 3
          END,
          Enabled DESC, Number
      `, { search: searchPattern, normalized: normalizedPattern, exact: normalizedExact, prefix: normalizedPrefix }),

      // 2. CRM: vehicle registration search (normalized — the missing piece)
      queryCrm(`
        SELECT TOP 20
          v.V_ID,
          CAST(v.OBJECTID AS NVARCHAR(50)) as ObjectId,
          v.VEH_REG as PlateNumber,
          c.FNAME as Description,
          v.ENGINE as EngineNo,
          c.CONT1 as CellNo,
          c.CUST_ID
        FROM VEHICLES v WITH (NOLOCK)
        LEFT JOIN INSTALLATION i WITH (NOLOCK) ON v.V_ID = i.V_ID
        LEFT JOIN CUSTOMER c WITH (NOLOCK) ON i.CUST_ID = c.CUST_ID
        WHERE REPLACE(REPLACE(REPLACE(v.VEH_REG, '-', ''), ' ', ''), '.', '') LIKE @normalized
        ORDER BY
          CASE
            WHEN REPLACE(REPLACE(REPLACE(v.VEH_REG, '-', ''), ' ', ''), '.', '') = @exact THEN 0
            WHEN REPLACE(REPLACE(REPLACE(v.VEH_REG, '-', ''), ' ', ''), '.', '') LIKE @prefix THEN 1
            ELSE 2
          END,
          v.VEH_REG
      `, { normalized: normalizedPattern, exact: normalizedExact, prefix: normalizedPrefix }).catch(() => [] as any[]),

      // 3. CRM: engine number search
      queryCrm(`
        SELECT TOP 10
          v.V_ID,
          CAST(v.OBJECTID AS NVARCHAR(50)) as ObjectId, v.VEH_REG as PlateNumber,
          c.FNAME as Description, v.ENGINE as EngineNo
        FROM VEHICLES v WITH (NOLOCK)
        LEFT JOIN INSTALLATION i WITH (NOLOCK) ON v.V_ID = i.V_ID
        LEFT JOIN CUSTOMER c WITH (NOLOCK) ON i.CUST_ID = c.CUST_ID
        WHERE v.ENGINE LIKE @search
        ORDER BY v.VEH_REG
      `, { search: searchPattern }).catch(() => [] as any[]),

      // 4. CRM: phone number search (normalized)
      queryCrm(`
        SELECT TOP 10
          v.V_ID,
          CAST(v.OBJECTID AS NVARCHAR(50)) as ObjectId, v.VEH_REG as PlateNumber,
          c.FNAME as Description, c.CONT1 as CellNo
        FROM CUSTOMER c WITH (NOLOCK)
        INNER JOIN INSTALLATION i WITH (NOLOCK) ON c.CUST_ID = i.CUST_ID
        INNER JOIN VEHICLES v WITH (NOLOCK) ON i.V_ID = v.V_ID
        WHERE (
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.CONT1, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE @phoneSearch
          OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.CONT2, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE @phoneSearch
        )
        ORDER BY v.VEH_REG
      `, { phoneSearch: phonePattern }).catch(() => [] as any[]),

      // 5. CRM: customer name search
      queryCrm(`
        SELECT TOP 10
          v.V_ID,
          CAST(v.OBJECTID AS NVARCHAR(50)) as ObjectId, v.VEH_REG as PlateNumber,
          c.FNAME as Description
        FROM CUSTOMER c WITH (NOLOCK)
        INNER JOIN INSTALLATION i WITH (NOLOCK) ON c.CUST_ID = i.CUST_ID
        INNER JOIN VEHICLES v WITH (NOLOCK) ON i.V_ID = v.V_ID
        WHERE c.FNAME LIKE @search
        ORDER BY v.VEH_REG
      `, { search: searchPattern }).catch(() => [] as any[]),

    ]);

    // ── Process TAVL results ─────────────────────────────────────────────────
    const tavlVehicles = (tavlRows || []).map((v: any) => ({
      ObjectId: String(v.ObjectId),
      PlateNumber: v.PlateNumber,
      Description: v.Description,
      Enabled: v.Enabled === 1 || v.Enabled === true,
      IMEI: v.IMEI,
      MatchSource: 'tavl' as string,
    }));

    const foundObjectIds = new Set(tavlVehicles.map((v: any) => String(v.ObjectId)));
    const foundVIds = new Set<string>();

    // ── Collect unique CRM results, dedup by ObjectId and V_ID ──────────────
    const crmByKey = new Map<string, any>();
    const allCrmRows = [
      ...(regResults || []).map((r: any) => ({ ...r, _source: 'registration' })),
      ...(engineResults || []).map((r: any) => ({ ...r, _source: 'engine' })),
      ...(phoneResults || []).map((r: any) => ({ ...r, _source: 'phone' })),
      ...(nameResults || []).map((r: any) => ({ ...r, _source: 'name' })),
    ];

    for (const r of allCrmRows) {
      const objId = r.ObjectId ? String(parseInt(r.ObjectId)) : null;
      const vId = r.V_ID ? String(r.V_ID) : null;
      const hasObjectId = objId && objId !== '0' && objId !== 'NaN';

      if (hasObjectId && foundObjectIds.has(objId!)) continue;
      if (vId && foundVIds.has(vId)) continue;

      const key = hasObjectId ? `obj:${objId}` : (vId ? `vid:${vId}` : null);
      if (!key || crmByKey.has(key)) continue;

      crmByKey.set(key, r);
      if (vId) foundVIds.add(vId);
      if (hasObjectId) foundObjectIds.add(objId!);
    }

    // ── Batch TAVL lookup for CRM matches that have ObjectId ────────────────
    const withObjectId = new Map<string, any>();
    const withoutObjectId: any[] = [];

    for (const [, crm] of crmByKey) {
      const objId = crm.ObjectId ? String(parseInt(crm.ObjectId)) : null;
      const hasObjectId = objId && objId !== '0' && objId !== 'NaN';
      if (hasObjectId) {
        withObjectId.set(objId!, crm);
      } else {
        withoutObjectId.push(crm);
      }
    }

    let crmMatches: any[] = [];

    if (withObjectId.size > 0) {
      const ids = Array.from(withObjectId.keys())
        .map(id => parseInt(id))
        .filter(id => !isNaN(id));

      if (ids.length > 0) {
        try {
          const tavlCheckRows = await queryTavl(`
            SELECT ObjectId, Number as PlateNumber, Comment as Description,
                   Enabled, ObjectCode as IMEI
            FROM [tavl2].[tavl].[Object] WITH (NOLOCK)
            WHERE ObjectId IN (${ids.join(',')})
          `);
          const tavlMap = new Map(
            (tavlCheckRows || []).map((v: any) => [String(v.ObjectId), v])
          );
          for (const [objId, crm] of withObjectId) {
            const tv = tavlMap.get(objId);
            const enabled = tv ? (tv.Enabled === 1 || tv.Enabled === true) : true;
            if (!includeDeactivated && !enabled) continue;
            crmMatches.push({
              ObjectId: objId,
              PlateNumber: tv?.PlateNumber || crm.PlateNumber,
              Description: crm.Description || tv?.Description,
              Enabled: enabled,
              IMEI: tv?.IMEI || null,
              MatchSource: crm._source || 'crm',
              EngineNo: crm.EngineNo,
              PhoneNo: crm.CellNo,
            });
          }
        } catch {
          for (const [objId, crm] of withObjectId) {
            crmMatches.push({
              ObjectId: objId,
              PlateNumber: crm.PlateNumber,
              Description: crm.Description,
              Enabled: true,
              IMEI: null,
              MatchSource: crm._source || 'crm',
              EngineNo: crm.EngineNo,
              PhoneNo: crm.CellNo,
            });
          }
        }
      }
    }

    // ── Vehicles found in CRM but not linked to TAVL yet ────────────────────
    for (const crm of withoutObjectId) {
      crmMatches.push({
        ObjectId: null,
        V_ID: crm.V_ID,
        PlateNumber: crm.PlateNumber,
        Description: crm.Description,
        Enabled: true,
        IMEI: null,
        MatchSource: crm._source || 'crm',
        EngineNo: crm.EngineNo,
        PhoneNo: crm.CellNo,
        CrmOnly: true,
      });
    }

    // Final sort: exact plate match → starts-with → contains → other (IMEI/engine/phone/name)
    const rank = (plate: string) => {
      const n = plate.replace(/[-\s.]/g, '').toUpperCase();
      const t = normalizedTerm.toUpperCase();
      if (n === t) return 0;
      if (n.startsWith(t)) return 1;
      if (n.includes(t)) return 2;
      return 3;
    };
    const allVehicles = [...tavlVehicles, ...crmMatches]
      .sort((a, b) => rank(a.PlateNumber || '') - rank(b.PlateNumber || ''))
      .slice(0, 50);

    console.log(`✅ Search "${searchTerm}": ${allVehicles.length} results (TAVL:${tavlVehicles.length}, CRM:${crmMatches.length})`);

    res.json({
      success: true,
      data: allVehicles,
      meta: { tavlMatches: tavlVehicles.length, crmMatches: crmMatches.length, includeDeactivated },
    });

  } catch (error: any) {
    console.error('❌ Vehicle search error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicles/:objectId
// FIX: TAVL info + CRM V_ID fetched in PARALLEL, then direct SQL Server GPS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:objectId', async (req, res) => {
  const objectId = parseInt(req.params.objectId);

  if (isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }

  console.log('📋 Vehicle detail:', objectId);

  try {
    // Step 1: TAVL info + CRM V_ID — fetched IN PARALLEL
    const [vehicleRows, vId] = await Promise.all([
      queryTavl(`
        SELECT ObjectId, Number as PlateNumber, Comment as Description,
               ObjectCode as IMEI, Enabled
        FROM [tavl2].[tavl].[Object] WITH (NOLOCK)
        WHERE ObjectId = @objectId
      `, { objectId }),
      resolveVehicleId(objectId),  // CRM: OBJECTIDINT → V_ID (fast indexed lookup)
    ]);

    if (!vehicleRows || vehicleRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    const vehicle = vehicleRows[0];

    // Step 2: GPS from SQL Server VehicleLastLocation DIRECTLY (no FDW, no eventlog!)
    let gps: any = null;
    let gpsSource = 'none';

    if (vId) {
      try {
        const gpsRows = await queryTracking(`
          SELECT TOP 1 ${GPS_SQL_COLUMNS}
          FROM [Tracking].[dbo].[VehicleLastLocation] WITH (NOLOCK)
          WHERE V_Id = @vId
        `, { vId });

        if (gpsRows && gpsRows.length > 0) {
          gps = gpsRows[0];
          gpsSource = 'sqlserver';
          console.log(`📡 GPS for ${vehicle.PlateNumber}: V_Id=${vId}, MinutesAgo=${gps.MinutesSinceUpdate}`);
        }
      } catch (e: any) {
        console.warn('⚠️ GPS fetch failed:', e.message);
      }
    }

    // Determine status
    const minutesAgo = Number(gps?.MinutesSinceUpdate) || 9999;
    const speed = Number(gps?.Speed) || 0;
    const status = calcStatus(speed, minutesAgo);

    res.json({
      success: true,
      data: {
        id: String(vehicle.ObjectId),
        objectId: String(vehicle.ObjectId),
        plateNumber: vehicle.PlateNumber,
        description: vehicle.Description,
        imei: vehicle.IMEI,
        enabled: vehicle.Enabled === 1 || vehicle.Enabled === true,
        status,
        gpsSource,
        latitude: parseFloat(gps?.Latitude) || 0,
        longitude: parseFloat(gps?.Longitude) || 0,
        speed,
        angle: parseInt(gps?.Angle) || 0,
        altitude: parseInt(gps?.Altitude) || 0,
        satellites: parseInt(gps?.Satellites) || 0,
        gpsTime: gps?.GpsTime || null,
        serverTime: gps?.ServerTime || null,
        minutesSinceUpdate: minutesAgo,
        gpsValid: gps?.Valid ?? false,
        // Telemetry
        ignition: gps?.Ignition ?? null,
        engineCut: gps?.EngineCut ?? null,
        battery: gps?.Battery ?? null,
        backupBattery: gps?.BackupBattery ?? null,
        powerVolt: gps?.PowerVolt ?? null,
        gsmSignal: gps?.GSMSignal ?? null,
        harshBrake: gps?.HarshBrake ?? null,
        harshAccel: gps?.HarshAccel ?? null,
        harshCorner: gps?.HarshCorner ?? null,
        seatbelt: gps?.SeatBelt ?? null,
        fuelLevel: null,
      },
    });

  } catch (error: any) {
    console.error('❌ Vehicle detail error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicles/:objectId/gps — Real-time GPS only (for live polling)
// FIX: Direct SQL Server VehicleLastLocation — no eventlog, no FDW
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:objectId/gps', async (req, res) => {
  const objectId = parseInt(req.params.objectId);

  if (isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }

  try {
    const vId = await resolveVehicleId(objectId);
    if (!vId) {
      return res.json({ success: true, data: null });
    }

    const gpsRows = await queryTracking(`
      SELECT TOP 1 ${GPS_SQL_COLUMNS}
      FROM [Tracking].[dbo].[VehicleLastLocation] WITH (NOLOCK)
      WHERE V_Id = @vId
    `, { vId });

    if (gpsRows && gpsRows.length > 0) {
      const g = gpsRows[0];
      res.json({
        success: true,
        data: {
          objectid: objectId,
          latitude: parseFloat(g.Latitude) || 0,
          longitude: parseFloat(g.Longitude) || 0,
          speed: g.Speed,
          angle: g.Angle,
          altitude: g.Altitude,
          gpstime: g.GpsTime,
          servertime: g.ServerTime,
          satellites: g.Satellites,
          ignition: g.Ignition,
          enginecut: g.EngineCut,
          minutes_ago: g.MinutesSinceUpdate,
        },
      });
    } else {
      res.json({ success: true, data: null });
    }

  } catch (error: any) {
    console.error('❌ GPS error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vehicles/gps/batch — Batch GPS for pinned vehicles
// FIX: One CRM batch query + One SQL Server query — no N+1, no eventlog scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/gps/batch', async (req, res) => {
  const { objectIds } = req.body;

  if (!objectIds || !Array.isArray(objectIds) || objectIds.length === 0) {
    return res.status(400).json({ success: false, error: 'objectIds array is required' });
  }

  const limitedIds = objectIds
    .slice(0, 50)
    .map((id: any) => parseInt(id))
    .filter((id: number) => !isNaN(id));

  if (limitedIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid objectIds' });
  }

  console.log(`📍 Batch GPS for ${limitedIds.length} vehicles`);

  try {
    // Step 1: Batch resolve all ObjectIds → V_IDs (one CRM query for all misses)
    const idMapping = await batchResolveVehicleIds(limitedIds);

    if (idMapping.size === 0) {
      return res.json({ success: true, data: {}, count: 0, requested: limitedIds.length });
    }

    // Step 2: ONE SQL Server query for all V_IDs at once
    const vIds = Array.from(idMapping.values());
    const vIdToObjectId = new Map<number, number>();
    for (const [oId, vId] of idMapping) {
      vIdToObjectId.set(vId, oId);
    }

    const gpsRows = await queryTracking(`
      SELECT ${GPS_SQL_COLUMNS}
      FROM [Tracking].[dbo].[VehicleLastLocation] WITH (NOLOCK)
      WHERE V_Id IN (${vIds.join(',')})
    `);

    // Build response map keyed by ObjectId
    const gpsMap: Record<string, any> = {};
    for (const gps of (gpsRows || [])) {
      const objId = vIdToObjectId.get(Number(gps.V_Id));
      if (objId != null) {
        gpsMap[String(objId)] = formatGpsRow(gps, objId);
      }
    }

    console.log(`📍 Batch GPS: ${Object.keys(gpsMap).length}/${limitedIds.length} resolved`);

    res.json({
      success: true,
      data: gpsMap,
      count: Object.keys(gpsMap).length,
      requested: limitedIds.length,
    });

  } catch (error: any) {
    console.error('❌ Batch GPS error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
