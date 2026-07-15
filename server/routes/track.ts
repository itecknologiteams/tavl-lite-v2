import { Router } from 'express';
import { initPostgres, queryPostgres } from '../db/postgres';
import { queryCrm } from '../db/crm';

const router = Router();

// OSRM server URL
const OSRM_SERVER = process.env.OSRM_SERVER || 'https://router.project-osrm.org';

// POST /api/track/osrm-match - Proxy for OSRM routing (avoids CORS issues)
router.post('/osrm-match', async (req, res) => {
  const { coordinates } = req.body;
  
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    return res.status(400).json({
      success: false,
      error: 'At least 2 coordinates required',
    });
  }
  
  try {
    // Sample waypoints - OSRM has limits on waypoints
    // Keep more waypoints for better accuracy (max ~25 for route service)
    let sampledCoords = coordinates;
    if (coordinates.length > 25) {
      const step = Math.ceil(coordinates.length / 24);
      sampledCoords = coordinates.filter((_: any, i: number) => i % step === 0);
      // Always include start and end points
      if (sampledCoords[0] !== coordinates[0]) {
        sampledCoords.unshift(coordinates[0]);
      }
      if (sampledCoords[sampledCoords.length - 1] !== coordinates[coordinates.length - 1]) {
        sampledCoords.push(coordinates[coordinates.length - 1]);
      }
    }
    
    // Build OSRM URL (lon,lat format)
    const coordsStr = sampledCoords
      .map((c: { lat: number; lon: number }) => `${c.lon},${c.lat}`)
      .join(';');
    
    // Use route service - calculates driving route through waypoints
    const url = `${OSRM_SERVER}/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&continue_straight=false`;
    
    console.log(`🗺️ OSRM route request for ${sampledCoords.length} waypoints`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn('⚠️ OSRM could not find route:', data.code, data.message);
      return res.json({
        success: false,
        error: data.message || 'Could not find route',
        code: data.code,
      });
    }
    
    // Extract route geometry - convert [lon, lat] to [lat, lon] for Leaflet
    const route = data.routes[0];
    const routeCoords: [number, number][] = [];
    
    if (route.geometry?.coordinates) {
      for (const coord of route.geometry.coordinates) {
        routeCoords.push([coord[1], coord[0]]); // [lat, lon]
      }
    }
    
    console.log(`✅ OSRM route: ${routeCoords.length} points, ${(route.distance / 1000).toFixed(2)} km, ${Math.round(route.duration / 60)} min`);
    
    res.json({
      success: true,
      route: routeCoords,
      distance: route.distance, // meters
      duration: route.duration, // seconds
    });
    
  } catch (error: any) {
    console.error('❌ OSRM error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Helper: Get all dates between two dates (inclusive)
function getDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  while (current <= end) {
    // Format as YYYYMMDD
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}${month}${day}`);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

// GET /api/track/:objectId
router.get('/:objectId', async (req, res) => {
  const objectId = parseInt(req.params.objectId);
  const fromDate = req.query.from as string;
  const toDate = req.query.to as string;
  const limit = parseInt(req.query.limit as string) || 5000;
  
  if (isNaN(objectId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid objectId',
    });
  }
  
  if (!fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      error: 'from and to dates are required',
    });
  }
  
  console.log('📍 Getting track history:', { objectId, fromDate, toDate, limit });
  
  try {
    // Step 1: Get V_ID from CRM MSSQL directly (ObjectId -> V_ID mapping)
    const vehicleMapping = await queryCrm(`
      SELECT TOP 1 v.V_ID as V_ID, v.OBJECTIDINT as OBJECTIDINT
      FROM VEHICLES v WITH (NOLOCK)
      WHERE v.OBJECTIDINT = @objectId
    `, { objectId });
    
    if (!vehicleMapping || vehicleMapping.length === 0) {
      console.log(`⚠️ No V_ID mapping found for ObjectId ${objectId}`);
      return res.json({
        success: true,
        data: [],
        totalPoints: 0,
        sampled: false,
        message: 'No vehicle mapping found',
      });
    }
    
    const vId = vehicleMapping[0].V_ID;
    console.log(`🔗 ObjectId ${objectId} mapped to V_ID ${vId}`);
    
    // Step 2: Calculate date range for table names
    // Note: TrackData stores local PKT time (UTC+5), so adjust input dates
    const startDt = new Date(fromDate);
    const endDt = new Date(toDate);
    
    // Convert UTC dates to PKT for PostgreSQL query (add 5 hours)
    // Use getUTC* methods since we're manually adding the offset
    const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
    const startPkt = new Date(startDt.getTime() + PKT_OFFSET_MS);
    const endPkt = new Date(endDt.getTime() + PKT_OFFSET_MS);
    
    // Format as local datetime string for PostgreSQL (YYYY-MM-DD HH:MM:SS)
    // Use getUTC* since we've already added PKT offset
    const formatPktDt = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    };
    const fromDateLocal = formatPktDt(startPkt);
    const toDateLocal = formatPktDt(endPkt);
    
    console.log(`📅 Time range: ${fromDate} -> ${toDate} (UTC) => ${fromDateLocal} -> ${toDateLocal} (PKT)`);
    
    const dateRange = getDateRange(startDt, endDt);
    console.log(`📅 Querying TrackData tables for dates: ${dateRange.join(', ')}`);
    
    // Step 3: Query TrackData tables from PostgreSQL Tracking database
    // Tables are named TrackDataYYYYMMDD (e.g., TrackData20260129)
    await initPostgres();
    
    let allPoints: any[] = [];
    
    for (const dateStr of dateRange) {
      const tableName = `TrackData${dateStr}`;
      
      try {
        // Query TrackData table from PostgreSQL Tracking database
        // Include telemetry data for graphs: speed, battery, voltage, ignition
        const points = await queryPostgres(`
          SELECT 
            t_id as id,
            v_id,
            y as latitude,
            x as longitude,
            speed,
            angle,
            altitude,
            satelites as satellites,
            gpstime,
            servertime,
            valid,
            ignition,
            enginecut,
            battery,
            backupbattery,
            powervolt,
            gsmsignal,
            fuellevel
          FROM "${tableName}"
          WHERE v_id = $1
            AND gpstime >= $2
            AND gpstime <= $3
          ORDER BY gpstime ASC
        `, [vId, fromDateLocal, toDateLocal]);
        
        if (points && points.length > 0) {
          allPoints = allPoints.concat(points);
          console.log(`  📊 ${tableName}: ${points.length} points`);
        }
      } catch (tableError: any) {
        // Table might not exist for this date, skip silently
        if (!tableError.message.includes('does not exist') && !tableError.message.includes('relation')) {
          console.warn(`  ⚠️ ${tableName}: ${tableError.message}`);
        }
      }
    }
    
    // Sort by gpstime and limit
    allPoints.sort((a, b) => new Date(a.gpstime).getTime() - new Date(b.gpstime).getTime());
    
    const sampled = allPoints.length > limit;
    if (sampled) {
      // Sample points if too many
      const step = Math.ceil(allPoints.length / limit);
      allPoints = allPoints.filter((_, i) => i % step === 0);
    }
    
    // Transform to frontend format (PostgreSQL lowercase columns)
    // Include telemetry data for charts: speed, battery, voltage, ignition
    // Calculate latency: time between GPS capture and server receipt
    //
    // TIMEZONE FIX: PostgreSQL TrackData stores gpstime/servertime as PKT local
    // time (UTC+5) in a "timestamp without time zone" column. The pg driver
    // reads it as if it were UTC, so the value arrives here already shifted
    // +5h from the truth. We subtract that offset before sending to the
    // browser; the browser then adds +5h back for PKT display → correct time.
    // (PKT_OFFSET_MS already declared above at query-filter step)

    const points = allPoints.map((p: any) => {
      const gpsTime = new Date(new Date(p.gpstime).getTime() - PKT_OFFSET_MS);
      const serverTime = new Date(new Date(p.servertime).getTime() - PKT_OFFSET_MS);
      // Latency in seconds (serverTime - gpsTime)
      const latencyMs = serverTime.getTime() - gpsTime.getTime();
      const latency = Math.max(0, Math.round(latencyMs / 1000)); // Clamp to 0 if negative (clock issues)
      
      return {
        id: p.id,
        latitude: parseFloat(p.latitude) || 0,
        longitude: parseFloat(p.longitude) || 0,
        speed: parseInt(p.speed) || 0,
        angle: parseInt(p.angle) || 0,
        altitude: parseFloat(p.altitude) || 0,
        satellites: parseInt(p.satellites) || 0,
        gpsTime: gpsTime.toISOString(),
        serverTime: serverTime.toISOString(),
        valid: p.valid,
        ignition: p.ignition ?? false,
        engineCut: p.enginecut ?? false,
        battery: parseFloat(p.battery) || 0,
        backupBattery: parseFloat(p.backupbattery) || 0,
        powerVolt: parseFloat(p.powervolt) || 0,
        gsmSignal: parseInt(p.gsmsignal) || 0,
        fuelLevel: parseFloat(p.fuellevel) || null,
        latency, // Transmission latency in seconds
      };
    });
    
    console.log(`✅ Retrieved ${points.length} track points for ObjectId ${objectId} (V_ID: ${vId})`);
    
    res.json({
      success: true,
      data: points,
      totalPoints: allPoints.length,
      sampled,
    });
    
  } catch (error: any) {
    console.error('❌ Track history error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
