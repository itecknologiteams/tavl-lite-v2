import { Router } from 'express';
import { queryTracking, queryTavl } from '../db/tavl';
import { queryCrm } from '../db/crm';

const router = Router();

// No in-memory cache — all alert reads go directly to the database

// Alert types that trigger robocalls (from ConsoleWarning)
const ROBOCALL_ALERT_TYPES = ['geofence', 'battery', 'late_night'];

// Some customers encode geofence/city alerts as short codes or zone names in `eventlog.name`
// e.g. "KHI L", "LHR SAHIWAL", "WAH CANTT", etc. We include these (case-insensitive) when
// filtering `eventlog` for "vehicle alerts" so they don't disappear from the UI.
const GEOFENCE_NAME_KEYWORDS = [
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
  // Additional common zone names (examples seen in production)
  'kohat',
  'sahiwal',
  'wah cantt',
  'wah',
  'chaman',
  // Short codes / abbreviations
  'khi',
  'lhr',
  'hyd',
];

const GEOFENCE_NAME_SQL = GEOFENCE_NAME_KEYWORDS
  .map((k) => k.replace(/'/g, "''"))
  .map((k) => `OR name ILIKE '%${k}%'`)
  .join('\n        ');

// Classify event name into alert category
function getAlertCategory(name: string): 'critical' | 'warning' | 'geofence' | 'info' {
  const lowerName = (name || '').toLowerCase();
  
  // Critical
  if (lowerName.includes('panic') || 
      lowerName.includes('over speed') ||
      lowerName.includes('overspeed') ||
      lowerName.includes('sos') ||
      lowerName.includes('emergency')) {
    return 'critical';
  }
  
  // Warning
  if (lowerName.includes('fmb battery') || 
      lowerName.includes('power volt') ||
      lowerName.includes('battery status') ||
      lowerName.includes('bb volt') ||
      lowerName.includes('dout')) {
    return 'warning';
  }
  
  // Geofence
  const cities = [
    'rawalpindi', 'islamabad', 'lahore', 'karachi', 'faisalabad',
    'multan', 'peshawar', 'quetta', 'sialkot', 'gujranwala',
    'hyderabad', 'sukkur',
    // Additional common zones
    'kohat', 'sahiwal', 'wah cantt', 'wah', 'chaman',
    // Short codes
    'lhr', 'khi', 'hyd',
  ];
  if (cities.some(city => lowerName.includes(city)) ||
      lowerName.includes('geofence') ||
      lowerName.includes('roaming')) {
    return 'geofence';
  }
  
  return 'info';
}

// Map category to severity
function getAlertSeverity(name: string, _value: any): 'critical' | 'high' | 'medium' | 'low' {
  const category = getAlertCategory(name);
  switch (category) {
    case 'critical': return 'critical';
    case 'warning': return 'high';
    case 'geofence': return 'medium';
    default: return 'low';
  }
}

function classifyConsoleWarning(message: string, zoneName?: string): {
  category: 'critical' | 'warning' | 'geofence' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  alarmType: string;
} {
  const msg = message || '';
  const lower = msg.toLowerCase();

  if (lower.includes('panic') || lower.includes('sos') || lower.includes('emergency')) {
    return { category: 'critical', severity: 'critical', alarmType: 'Console Critical' };
  }

  if (lower.includes('battery') || lower.includes('volt') || lower.includes('power')) {
    return { category: 'warning', severity: 'high', alarmType: 'Console Battery/Power' };
  }

  if (lower.includes('geofence') || lower.includes('zone') || !!zoneName) {
    return { category: 'geofence', severity: 'medium', alarmType: zoneName ? `Console (${zoneName})` : 'Console Geofence' };
  }

  return { category: 'info', severity: 'low', alarmType: 'Console Warning' };
}

// GET /api/alerts/recent
router.get('/recent', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const category = req.query.category as string;
  const sinceMinutes = parseInt(req.query.sinceMinutes as string) || 60;
  const sinceId = req.query.sinceId as string;
  
  console.log('🔔 Fetching alerts:', { limit, category, sinceMinutes, sinceId });

  try {
    // Only show Critical, Warning, and Geofence alerts
    const allowedEvents = `
      AND (
        Name LIKE '%panic%'
        OR Name LIKE '%over speed%'
        OR Name LIKE '%overspeed%'
        OR Name LIKE '%sos%'
        OR Name LIKE '%emergency%'
        OR Name LIKE '%battery%'
        OR Name LIKE '%power%'
        OR Name LIKE '%volt%'
        OR Name LIKE '%roaming%'
        OR Name LIKE '%geofence%'
        ${GEOFENCE_NAME_SQL.replace(/ILIKE/g, 'LIKE')}
      )
    `;

    // Category filter
    let categoryFilter = '';
    if (category === 'critical') {
      categoryFilter = `AND (Name LIKE '%panic%' OR Name LIKE '%over speed%' OR Name LIKE '%overspeed%' OR Name LIKE '%sos%' OR Name LIKE '%emergency%')`;
    } else if (category === 'warning') {
      categoryFilter = `AND (Name LIKE '%battery%' OR Name LIKE '%power%' OR Name LIKE '%volt%')`;
    } else if (category === 'geofence') {
      categoryFilter = `AND (
        Name LIKE '%roaming%'
        OR Name LIKE '%geofence%'
        ${GEOFENCE_NAME_SQL.replace(/ILIKE/g, 'LIKE')}
      )`;
    }

    // Since ID filter for polling (inline — always numeric)
    const sinceFilter = sinceId ? `AND EventLogId > ${parseInt(sinceId) || 0}` : '';

    const query = `
      SELECT TOP ${limit}
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
      WHERE GpsTime >= DATEADD(minute, -${sinceMinutes}, GETDATE())
        ${category ? categoryFilter : allowedEvents}
        ${sinceFilter}
      ORDER BY GpsTime ASC
    `;

    const events = await queryTracking(query);
    
    if (!events || events.length === 0) {
      return res.json({ success: true, data: [], maxId: sinceId || '0' });
    }
    
    // Get vehicle names from TAVL with CRM fallback
    const objectIds = [...new Set(events.map((e: any) => e.objectid))];
    let vehicleMap: Record<number, string> = {};

    if (objectIds.length > 0) {
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
        } catch (e) {
          console.warn('⚠️ TAVL vehicle lookup failed, will try CRM fallback');
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
          } catch (e) {
            console.warn('⚠️ CRM fallback vehicle lookup also failed');
          }
        }
      }
    }
    
    // Transform events to alerts
    const alerts = events.map((event: any) => ({
      id: event.eventlogid.toString(),
      vehicleId: event.objectid.toString(),
      vehicleName: vehicleMap[event.objectid] || `Vehicle ${event.objectid}`,
      alarmType: event.name || 'Unknown Event',
      alarmTypeId: 0,
      description: `${event.name} ${event.value !== null ? `(Value: ${event.value})` : ''}`,
      latitude: parseFloat(event.latitude) || 0,
      longitude: parseFloat(event.longitude) || 0,
      speed: event.speed || 0,
      occurredAt: event.gpstime,
      appearedAt: event.servertime || event.gpstime,
      acknowledged: false,
      severity: getAlertSeverity(event.name, event.value),
      category: getAlertCategory(event.name),
      value: event.value,
    }));
    
    const maxId = events[events.length - 1]?.eventlogid?.toString() || sinceId || '0';
    console.log(`✅ Fetched ${alerts.length} alerts (max ID: ${maxId})`);
    
    res.json({
      success: true,
      data: alerts,
      maxId,
    });
    
  } catch (error: any) {
    console.error('❌ Alerts error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/alerts/vehicle/:objectId - Get alerts for a specific vehicle
router.get('/vehicle/:objectId', async (req, res) => {
  const objectId = parseInt(req.params.objectId);
  const days = parseInt(req.query.days as string) || 7;
  const startRaw = req.query.start as string | undefined;
  const endRaw = req.query.end as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  
  if (isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }
  
  const parseIso = (raw?: string) => {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };
  const start = parseIso(startRaw);
  const end = parseIso(endRaw);

  if ((startRaw && !start) || (endRaw && !end)) {
    return res.status(400).json({ success: false, error: 'Invalid start/end datetime (expected ISO string)' });
  }

  console.log(
    `🔔 Fetching alerts for vehicle ${objectId} (${start || end ? 'date range' : `last ${days} days`}, limit ${limit})`
  );
  
  try {
    let timeClause = '';
    const queryParams: Record<string, any> = { objectId };

    if (start) {
      timeClause += ` AND GpsTime >= @start`;
      queryParams.start = start;
    }
    if (end) {
      timeClause += ` AND GpsTime <= @end`;
      queryParams.end = end;
    }
    if (!start && !end) {
      timeClause += ` AND GpsTime >= DATEADD(day, -${days}, GETDATE())`;
    }

    const query = `
      SELECT TOP ${limit}
        EventLogId  AS eventlogid,
        ObjectId    AS objectid,
        VehicleId   AS vehicleid,
        Name        AS name,
        Value       AS value,
        Y           AS latitude,
        X           AS longitude,
        Speed       AS speed,
        CONVERT(varchar(19), GpsTime, 120)    AS gpstime,
        CONVERT(varchar(19), ServerTime, 120) AS servertime
      FROM [Tracking].[dbo].[EventLog] WITH (NOLOCK)
      WHERE ObjectId = @objectId
        ${timeClause}
        AND (
          Name LIKE '%panic%'
          OR Name LIKE '%over speed%'
          OR Name LIKE '%overspeed%'
          OR Name LIKE '%sos%'
          OR Name LIKE '%emergency%'
          OR Name LIKE '%battery%'
          OR Name LIKE '%power%'
          OR Name LIKE '%volt%'
          OR Name LIKE '%roaming%'
          OR Name LIKE '%geofence%'
          ${GEOFENCE_NAME_SQL.replace(/ILIKE/g, 'LIKE')}
        )
      ORDER BY GpsTime DESC
    `;

    const events = await queryTracking(query, queryParams);
    
    if (!events || events.length === 0) {
      console.log(`✅ No alerts found for vehicle ${objectId}`);
      return res.json({ success: true, data: [], total: 0 });
    }
    
    // Transform events to alerts
    const alerts = events.map((event: any) => ({
      id: event.eventlogid.toString(),
      vehicleId: event.objectid.toString(),
      alarmType: event.name || 'Unknown Event',
      description: `${event.name} ${event.value !== null ? `(Value: ${event.value})` : ''}`,
      latitude: parseFloat(event.latitude) || 0,
      longitude: parseFloat(event.longitude) || 0,
      speed: event.speed || 0,
      occurredAt: event.gpstime,
      appearedAt: event.servertime || event.gpstime,
      severity: getAlertSeverity(event.name, event.value),
      category: getAlertCategory(event.name),
      value: event.value,
    }));
    
    console.log(`✅ Found ${alerts.length} alerts for vehicle ${objectId}`);
    
    res.json({
      success: true,
      data: alerts,
      total: alerts.length,
    });
    
  } catch (error: any) {
    console.error(`❌ Vehicle alerts error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/alerts/warnings - Get alerts from ConsoleWarning (geofence alerts with robocall data)
router.get('/warnings', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const sinceMinutes = parseInt(req.query.sinceMinutes as string) || 60;
  const sinceId = req.query.sinceId as string;
  
  console.log('🔔 Fetching ConsoleWarning alerts:', { limit, sinceMinutes, sinceId });
  
  try {

    // Build query - get recent ConsoleWarning entries
    let query = `
      SELECT TOP ${limit}
        w.WarningId,
        w.ObjectId,
        w.Number,
        w.MessageText,
        w.CreationTime,
        w.X as Longitude,
        w.Y as Latitude
      FROM [Tracking].[dbo].[ConsoleWarning] w WITH (NOLOCK)
      WHERE w.CreationTime >= DATEADD(minute, -${sinceMinutes}, GETDATE())
    `;
    
    if (sinceId) {
      query += ` AND w.WarningId > ${parseInt(sinceId)}`;
    }
    
    query += ` ORDER BY w.CreationTime ASC`;
    
    const warnings = await queryTracking(query);
    
    if (!warnings || warnings.length === 0) {
      return res.json({ success: true, data: [], maxId: sinceId || '0' });
    }
    
    // Transform warnings to alerts format
    const alerts = warnings.map((w: any) => {
      // Parse message to determine alert type
      const message = w.MessageText || '';
      let alarmType = 'Geofence';
      let category: 'geofence' | 'warning' | 'critical' = 'geofence';
      let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      
      if (message.toLowerCase().includes('battery')) {
        alarmType = 'Battery Alert';
        category = 'warning';
        severity = 'high';
      } else if (message.toLowerCase().includes('late night') || message.toLowerCase().includes('ignition')) {
        alarmType = 'Late Night Ignition';
        category = 'warning';
        severity = 'high';
      } else if (message.includes('has left zone')) {
        // Extract zone name from message
        const zoneMatch = message.match(/has left zone ([^,]+)/);
        alarmType = zoneMatch ? `Left ${zoneMatch[1]}` : 'Geofence Exit';
      } else if (message.includes('has entered zone')) {
        const zoneMatch = message.match(/has entered zone ([^,]+)/);
        alarmType = zoneMatch ? `Entered ${zoneMatch[1]}` : 'Geofence Entry';
      }
      
      return {
        id: w.WarningId.toString(),
        warningId: w.WarningId.toString(), // Keep for robocall lookup
        vehicleId: w.ObjectId.toString(),
        vehicleName: w.Number || `Vehicle ${w.ObjectId}`,
        alarmType,
        alarmTypeId: 0,
        description: message,
        latitude: parseFloat(w.Latitude) || 0,
        longitude: parseFloat(w.Longitude) || 0,
        speed: 0,
        occurredAt: w.CreationTime,
        appearedAt: w.CreationTime,
        acknowledged: false,
        severity,
        category,
        hasRobocall: true, // These alerts trigger robocalls
      };
    });
    
    const maxId = warnings[warnings.length - 1]?.WarningId?.toString() || sinceId || '0';
    console.log(`✅ Fetched ${alerts.length} ConsoleWarning alerts (max ID: ${maxId})`);
    
    res.json({ success: true, data: alerts, maxId });
    
  } catch (error: any) {
    console.error('❌ ConsoleWarning alerts error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/alerts/console/vehicle/:vehicleId - ConsoleWarningFilter alerts for a specific vehicle (Tracking DB 192.168.20.1)
router.get('/console/vehicle/:vehicleId', async (req, res) => {
  const vehicleId = parseInt(req.params.vehicleId);
  const days = parseInt(req.query.days as string) || 7;
  const startRaw = req.query.start as string | undefined;
  const endRaw = req.query.end as string | undefined;
  const limitRaw = parseInt(req.query.limit as string) || 50;
  const limit = Math.max(1, Math.min(limitRaw, 1000));

  if (isNaN(vehicleId)) {
    return res.status(400).json({ success: false, error: 'Invalid vehicleId' });
  }

  const parseIso = (raw?: string) => {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };
  const start = parseIso(startRaw);
  const end = parseIso(endRaw);

  if ((startRaw && !start) || (endRaw && !end)) {
    return res.status(400).json({ success: false, error: 'Invalid start/end datetime (expected ISO string)' });
  }

  console.log(
    `🔔 Fetching ConsoleWarningFilter for VehicleId ${vehicleId} (${start || end ? 'date range' : `last ${days} days`}, limit ${limit})`
  );

  try {
    // NOTE: TOP cannot be reliably parameterized in SQL Server, so we clamp and inline it safely.
    const timeClause = (start || end)
      ? `
        ${start ? 'AND [CreationTime] >= @start' : ''}
        ${end ? 'AND [CreationTime] <= @end' : ''}
      `
      : 'AND [CreationTime] >= DATEADD(day, -@days, GETDATE())';

    const query = `
      SELECT TOP (${limit})
        [WarningId],
        [VehicleId],
        [ObjectId],
        [MessageText],
        CONVERT(varchar(19), [CreationTime], 120) AS [CreationTime],
        [Confirmation],
        CONVERT(varchar(19), [SourceTime], 120)   AS [SourceTime],
        [ZoneName],
        CONVERT(varchar(19), [GpsTime], 120)      AS [GpsTime],
        [Speed],
        [Altitude],
        [X],
        [Y],
        [Angle],
        [Satelites],
        [Number],
        [ZoneId],
        [ZSEId]
      FROM [Tracking].[dbo].[ConsoleWarningFilter] WITH (NOLOCK)
      WHERE [VehicleId] = @vehicleId
        ${timeClause}
      ORDER BY [WarningId] DESC
    `;

    const rows = await queryTracking(query, {
      vehicleId,
      ...(start || end ? {} : { days }),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    });

    const alerts = (rows || []).map((w: any) => {
      const message = w.MessageText || '';
      const cls = classifyConsoleWarning(message, w.ZoneName);
      return {
        id: `console:${w.WarningId}`,
        vehicleId: String(w.ObjectId ?? w.VehicleId ?? vehicleId),
        alarmType: cls.alarmType,
        description: message || 'Console warning',
        latitude: parseFloat(w.Y) || 0,
        longitude: parseFloat(w.X) || 0,
        speed: Number(w.Speed) || 0,
        occurredAt: String(w.GpsTime || w.CreationTime || w.SourceTime || ''),
        appearedAt: String(w.CreationTime || w.SourceTime || w.GpsTime || ''),
        severity: cls.severity,
        category: cls.category,
        value: {
          WarningId: w.WarningId,
          VehicleId: w.VehicleId,
          ObjectId: w.ObjectId,
          ZoneName: w.ZoneName,
          Confirmation: w.Confirmation,
          Number: w.Number,
          ZoneId: w.ZoneId,
          ZSEId: w.ZSEId,
          Satellites: w.Satelites,
          Angle: w.Angle,
          Altitude: w.Altitude,
          SourceTime: w.SourceTime,
          CreationTime: w.CreationTime,
          GpsTime: w.GpsTime,
        },
        source: 'console',
      };
    });

    res.json({ success: true, data: alerts, total: alerts.length });
  } catch (error: any) {
    console.error('❌ ConsoleWarningFilter error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/alerts/console/object/:objectId - ConsoleWarningFilter alerts filtered by ObjectId (fallback)
router.get('/console/object/:objectId', async (req, res) => {
  const objectId = parseInt(req.params.objectId);
  const days = parseInt(req.query.days as string) || 7;
  const startRaw = req.query.start as string | undefined;
  const endRaw = req.query.end as string | undefined;
  const limitRaw = parseInt(req.query.limit as string) || 50;
  const limit = Math.max(1, Math.min(limitRaw, 1000));

  if (isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }

  const parseIso = (raw?: string) => {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };
  const start = parseIso(startRaw);
  const end = parseIso(endRaw);

  if ((startRaw && !start) || (endRaw && !end)) {
    return res.status(400).json({ success: false, error: 'Invalid start/end datetime (expected ISO string)' });
  }

  console.log(
    `🔔 Fetching ConsoleWarningFilter for ObjectId ${objectId} (${start || end ? 'date range' : `last ${days} days`}, limit ${limit})`
  );

  try {
    const timeClause = (start || end)
      ? `
        ${start ? 'AND [CreationTime] >= @start' : ''}
        ${end ? 'AND [CreationTime] <= @end' : ''}
      `
      : 'AND [CreationTime] >= DATEADD(day, -@days, GETDATE())';

    const query = `
      SELECT TOP (${limit})
        [WarningId],
        [VehicleId],
        [ObjectId],
        [MessageText],
        [CreationTime],
        [Confirmation],
        [SourceTime],
        [ZoneName],
        [GpsTime],
        [Speed],
        [Altitude],
        [X],
        [Y],
        [Angle],
        [Satelites],
        [Number],
        [ZoneId],
        [ZSEId]
      FROM [Tracking].[dbo].[ConsoleWarningFilter] WITH (NOLOCK)
      WHERE [ObjectId] = @objectId
        ${timeClause}
      ORDER BY [WarningId] DESC
    `;

    const rows = await queryTracking(query, {
      objectId,
      ...(start || end ? {} : { days }),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    });

    const alerts = (rows || []).map((w: any) => {
      const message = w.MessageText || '';
      const cls = classifyConsoleWarning(message, w.ZoneName);
      return {
        id: `console:${w.WarningId}`,
        vehicleId: String(w.ObjectId ?? objectId),
        alarmType: cls.alarmType,
        description: message || 'Console warning',
        latitude: parseFloat(w.Y) || 0,
        longitude: parseFloat(w.X) || 0,
        speed: Number(w.Speed) || 0,
        occurredAt: (w.GpsTime || w.CreationTime || w.SourceTime || new Date()).toISOString?.() || String(w.GpsTime || w.CreationTime || w.SourceTime),
        appearedAt: (w.CreationTime || w.SourceTime || w.GpsTime || new Date()).toISOString?.() || String(w.CreationTime || w.SourceTime || w.GpsTime),
        severity: cls.severity,
        category: cls.category,
        value: w,
        source: 'console',
      };
    });

    res.json({ success: true, data: alerts, total: alerts.length });
  } catch (error: any) {
    console.error('❌ ConsoleWarningFilter error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/alerts/stats
router.get('/stats', async (req, res) => {
  console.log('📊 Fetching alert statistics...');
  
  try {
    const stats = await queryTracking(`
      SELECT TOP 20
        Name        AS name,
        COUNT(*)    AS count
      FROM [Tracking].[dbo].[EventLog] WITH (NOLOCK)
      WHERE GpsTime >= DATEADD(minute, -60, GETDATE())
        AND Name NOT LIKE '%gnition%'
      GROUP BY Name
      ORDER BY COUNT(*) DESC
    `);
    
    // Categorize
    const categories = {
      critical: 0,
      warning: 0,
      geofence: 0,
      other: 0,
      total: 0,
    };
    
    (stats || []).forEach((stat: any) => {
      const cat = getAlertCategory(stat.name);
      const count = parseInt(stat.count) || 0;
      categories.total += count;
      
      if (cat === 'critical') categories.critical += count;
      else if (cat === 'warning') categories.warning += count;
      else if (cat === 'geofence') categories.geofence += count;
      else categories.other += count;
    });
    
    console.log('✅ Alert stats:', categories);
    res.json({ success: true, data: categories });
    
  } catch (error: any) {
    console.error('❌ Stats error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
