import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { config } from 'dotenv';
import { initDatabase, executeQuery, updateDatabaseConfig } from './database';
import { initPostgres, queryPostgres, explorePostgresSchema, closePostgres } from './postgres';
import { initCrmDatabase, queryCrm, exploreCrmSchema, closeCrmDatabase } from './crm-database';

// In development we serve the renderer via Vite over HTTPS with a self-signed cert.
// Electron will reject that cert by default, so we explicitly allow it in dev only.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
if (isDev) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(true);
  });
}

// Load environment variables from .env file
// In development: dist-electron/../.env (project root)
// In production: resources/app/.env (bundled .env)
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../.env');

console.log('🔧 Loading .env from:', envPath);
const envResult = config({ path: envPath });

if (envResult.error) {
  console.warn('⚠️ Failed to load .env file:', envResult.error.message);
  console.warn('⚠️ Will use default database configuration');
} else {
  console.log('✅ Environment variables loaded successfully');
  console.log('📋 DB_SERVER:', process.env.DB_SERVER || '(not set)');
  console.log('📋 DB_NAME:', process.env.DB_NAME || '(not set)');
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#0F172A',
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  });

  // Load the app
  // When running `electron .` in dev, VITE_DEV_SERVER_URL may not be present.
  // In that case, fall back to the default Vite dev URL (configured as HTTPS).
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'https://localhost:5173';
  if (!app.isPackaged) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Maximize window on start
  mainWindow.maximize();
};

// App lifecycle
app.whenReady().then(async () => {
  // Try to initialize database, but don't block app startup
  try {
    await initDatabase();
    console.log('✅ Initial database connection successful');
  } catch (dbError: any) {
    console.warn('⚠️ Initial database connection failed (will retry during login)');
    console.warn('⚠️ Error:', dbError.message);
  }
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('db:query', async (_, query: string, params?: any) => {
  try {
    const result = await executeQuery(query, params);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('Database query error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:update-config', async (_, newConfig: any) => {
  try {
    await updateDatabaseConfig(newConfig);
    return { success: true };
  } catch (error: any) {
    console.error('Database config update error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

ipcMain.handle('app:get-path', (_, name: string) => {
  return app.getPath(name as any);
});

// PostgreSQL handlers for Tracking database (192.168.20.186)
ipcMain.handle('pg:connect', async () => {
  try {
    await initPostgres();
    return { success: true };
  } catch (error: any) {
    console.error('PostgreSQL connection error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pg:query', async (_, query: string, params?: any[]) => {
  try {
    const result = await queryPostgres(query, params);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('PostgreSQL query error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pg:explore-schema', async () => {
  try {
    const schema = await explorePostgresSchema();
    return { success: true, data: schema };
  } catch (error: any) {
    console.error('PostgreSQL schema exploration error:', error);
    return { success: false, error: error.message };
  }
});

// Comprehensive schema exploration for both databases
ipcMain.handle('explore-all-databases', async () => {
  console.log('\n' + '='.repeat(80));
  console.log('🔬 COMPREHENSIVE DATABASE SCHEMA EXPLORATION');
  console.log('='.repeat(80) + '\n');
  
  const results: any = { postgres: null, tavl: null };
  
  // =====================================================
  // 1. POSTGRESQL (192.168.20.186/Tracking) - Real-time GPS Data
  // =====================================================
  try {
    console.log('📊 POSTGRESQL DATABASE (192.168.20.186/Tracking)');
    console.log('-'.repeat(50));
    results.postgres = await explorePostgresSchema();
    console.log('✅ PostgreSQL exploration complete\n');
  } catch (error: any) {
    results.postgres = { error: error.message };
    console.error('❌ PostgreSQL error:', error.message, '\n');
  }
  
  // =====================================================
  // 2. TAVL SQL SERVER (192.168.20.253/tavl2) - Vehicle Data
  // =====================================================
  try {
    console.log('📊 TAVL SQL SERVER DATABASE (192.168.20.253/tavl2)');
    console.log('-'.repeat(50));
    
    // --- Object table (vehicles) ---
    console.log('\n📋 [Object] table - Vehicles:');
    const objectCols = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'tavl' AND TABLE_NAME = 'Object'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columns:', objectCols?.map((c: any) => c.COLUMN_NAME).join(', '));
    
    const objectSample = await executeQuery(`SELECT TOP 3 ObjectId, Number, Comment, Enabled FROM [tavl2].[tavl].[Object] WITH (NOLOCK) WHERE Enabled = 1`);
    console.log('   Sample:', JSON.stringify(objectSample, null, 2));
    
    // --- GroupLogin table (user -> group mapping) ---
    console.log('\n📋 [GroupLogin] table - User to Group mapping:');
    const groupLoginCols = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'tavl' AND TABLE_NAME = 'GroupLogin'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columns:', groupLoginCols?.map((c: any) => c.COLUMN_NAME).join(', '));
    
    const groupLoginSample = await executeQuery(`SELECT TOP 5 * FROM [tavl2].[tavl].[GroupLogin] WITH (NOLOCK)`);
    console.log('   Sample:', JSON.stringify(groupLoginSample, null, 2));
    
    // --- GroupObject table (group -> vehicle mapping) ---
    console.log('\n📋 [GroupObject] table - Group to Vehicle mapping:');
    const groupObjectCols = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'tavl' AND TABLE_NAME = 'GroupObject'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columns:', groupObjectCols?.map((c: any) => c.COLUMN_NAME).join(', '));
    
    const groupObjectSample = await executeQuery(`SELECT TOP 5 * FROM [tavl2].[tavl].[GroupObject] WITH (NOLOCK)`);
    console.log('   Sample:', JSON.stringify(groupObjectSample, null, 2));
    
    // --- Login table (users) ---
    console.log('\n📋 [Login] table - Users:');
    const loginCols = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'tavl' AND TABLE_NAME = 'Login'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columns:', loginCols?.map((c: any) => c.COLUMN_NAME).join(', '));
    
    // Just select all columns from Login to see what's there
    const loginSample = await executeQuery(`SELECT TOP 3 * FROM [tavl2].[tavl].[Login] WITH (NOLOCK)`);
    console.log('   Sample:', JSON.stringify(loginSample, null, 2));
    
    // --- ObjectLastMessage table (latest GPS data) ---
    console.log('\n📋 [ObjectLastMessage] table - Latest GPS per vehicle:');
    const olmCols = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'tavl' AND TABLE_NAME = 'ObjectLastMessage'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columns:', olmCols?.map((c: any) => c.COLUMN_NAME).join(', '));
    
    // --- Message table (GPS messages) ---
    console.log('\n📋 [Message] table - GPS Messages:');
    const msgCols = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'tavl' AND TABLE_NAME = 'Message'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columns:', msgCols?.map((c: any) => c.COLUMN_NAME).join(', '));
    
    // --- Count vehicles per group ---
    console.log('\n📋 Vehicle counts by LoginId:');
    const groupCounts = await executeQuery(`
      SELECT GL.LoginId, COUNT(GO.ObjectId) as VehicleCount
      FROM [tavl2].[tavl].[GroupLogin] GL WITH (NOLOCK)
      INNER JOIN [tavl2].[tavl].[GroupObject] GO WITH (NOLOCK) ON GL.GroupId = GO.GroupId
      GROUP BY GL.LoginId
      ORDER BY VehicleCount DESC
    `);
    console.log('   LoginId -> Vehicle counts (top 10):');
    groupCounts?.slice(0, 10).forEach((g: any) => {
      console.log(`     LoginId ${g.LoginId}: ${g.VehicleCount} vehicles`);
    });
    
    // Store results
    results.tavl = {
      objectTable: {
        columns: objectCols?.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })) || [],
        sample: objectSample,
      },
      groupLoginTable: {
        columns: groupLoginCols?.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })) || [],
        sample: groupLoginSample,
      },
      groupObjectTable: {
        columns: groupObjectCols?.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })) || [],
        sample: groupObjectSample,
      },
      loginTable: {
        columns: loginCols?.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })) || [],
        sample: loginSample,
      },
      objectLastMessageTable: {
        columns: olmCols?.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })) || [],
      },
      messageTable: {
        columns: msgCols?.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })) || [],
      },
      vehicleCountsByGroup: groupCounts,
    };
    
    console.log('\n✅ TAVL SQL Server exploration complete\n');
    
  } catch (error: any) {
    results.tavl = { error: error.message };
    console.error('❌ TAVL SQL Server error:', error.message, '\n');
  }
  
  console.log('='.repeat(80));
  console.log('🏁 DATABASE EXPLORATION COMPLETE');
  console.log('='.repeat(80) + '\n');
  
  return results;
});

// =====================================================
// VEHICLE SEARCH - On-demand search for vehicles
// =====================================================

// Search vehicle by plate number, IMEI, or name
ipcMain.handle('vehicle:search', async (_, searchTerm: string) => {
  console.log('🔍 Searching for vehicle:', searchTerm);
  
  try {
    // Search in TAVL Object table (Number = plate, Comment = description)
    const vehicles = await executeQuery(`
      SELECT TOP 20 
        O.ObjectId,
        O.Number as PlateNumber,
        O.Comment as Description,
        O.Enabled,
        O.ObjectCode as IMEI
      FROM [tavl2].[tavl].[Object] O WITH (NOLOCK)
      WHERE O.Enabled = 1 
        AND (O.Number LIKE @search OR O.Comment LIKE @search OR O.ObjectCode LIKE @search)
      ORDER BY O.Number
    `, { search: `%${searchTerm}%` });
    
    console.log(`✅ Found ${vehicles?.length || 0} vehicles matching "${searchTerm}"`);
    return { success: true, data: vehicles || [] };
    
  } catch (error: any) {
    console.error('❌ Vehicle search error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get complete vehicle details by ObjectId
ipcMain.handle('vehicle:get-details', async (_, objectId: number) => {
  console.log('📋 Getting details for ObjectId:', objectId);
  
  try {
    // 1. Get vehicle info from TAVL SQL Server
    const vehicleInfo = await executeQuery(`
      SELECT 
        O.ObjectId,
        O.Number as PlateNumber,
        O.Comment as Description,
        O.ObjectCode as IMEI,
        O.Enabled
      FROM [tavl2].[tavl].[Object] O WITH (NOLOCK)
      WHERE O.ObjectId = @objectId
    `, { objectId });
    
    if (!vehicleInfo || vehicleInfo.length === 0) {
      return { success: false, error: 'Vehicle not found' };
    }
    
    const vehicle = vehicleInfo[0];
    let gps: any = null;
    let gpsSource = 'none';
    
    // 2. Get latest GPS from PostgreSQL eventlog (REAL-TIME DATA - PRIMARY SOURCE)
    try {
      await initPostgres();
      const pgGpsData = await queryPostgres(`
        SELECT 
          y as latitude,
          x as longitude,
          speed,
          angle,
          altitude,
          satelites as satellites,
          gpstime,
          servertime,
          name as event_name,
          EXTRACT(EPOCH FROM (NOW() - gpstime)) / 60 as minutes_since_update
        FROM eventlog 
        WHERE objectid = $1 
        ORDER BY gpstime DESC 
        LIMIT 1
      `, [objectId]);
      
      if (pgGpsData && pgGpsData.length > 0) {
        const pgGps = pgGpsData[0];
        gps = {
          Latitude: pgGps.latitude,
          Longitude: pgGps.longitude,
          Speed: pgGps.speed,
          Angle: pgGps.angle,
          Altitude: pgGps.altitude || 0,
          Satellites: pgGps.satellites,
          GpsTime: pgGps.gpstime,
          ServerTime: pgGps.servertime,
          MinutesSinceUpdate: Math.round(pgGps.minutes_since_update),
          Valid: true,
        };
        gpsSource = 'postgresql';
        console.log('📡 GPS from PostgreSQL eventlog:', {
          GpsTime: gps.GpsTime,
          MinutesSinceUpdate: gps.MinutesSinceUpdate,
        });
      }
    } catch (pgError: any) {
      console.warn('⚠️ PostgreSQL GPS fetch failed:', pgError.message);
    }
    
    // 3. Fallback to TAVL SQL Server if PostgreSQL has no data
    if (!gps) {
      const sqlGpsData = await executeQuery(`
        SELECT TOP 1
          M.[Y] as Latitude,
          M.[X] as Longitude,
          M.[VectorSpeed] as Speed,
          M.[VectorAngle] as Angle,
          M.[GpsTime],
          M.[TimeStamp] as ServerTime,
          M.[Valid],
          M.[VisibleSatelites] as Satellites,
          M.[Altitude],
          DATEDIFF(MINUTE, M.[GpsTime], GETDATE()) as MinutesSinceUpdate
        FROM [tavl2].[tavl].[ObjectLastMessage] OLM WITH (NOLOCK)
        INNER JOIN [tavl2].[tavl].[Message] M WITH (NOLOCK) ON OLM.[MessageId] = M.[MessageId]
        WHERE OLM.[ObjectId] = @objectId
      `, { objectId });
      
      if (sqlGpsData && sqlGpsData.length > 0) {
        gps = sqlGpsData[0];
        gpsSource = 'sqlserver';
        console.log('📡 GPS from SQL Server (fallback):', {
          GpsTime: gps.GpsTime,
          MinutesSinceUpdate: gps.MinutesSinceUpdate,
        });
      }
    }
    
    // 4. Determine status based on GPS data
    let status = 'offline';
    if (gps) {
      const minutesSinceUpdate = gps.MinutesSinceUpdate || 999;
      if (gps.Valid === false) {
        status = 'gps-invalid';
      } else if (minutesSinceUpdate > 30) {
        status = 'offline';
      } else if (gps.Speed > 5) {
        status = 'moving';
      } else if (gps.Speed >= 0 && gps.Speed <= 5) {
        status = 'idle';
      }
    }
    
    const result = {
      id: vehicle.ObjectId.toString(),
      objectId: vehicle.ObjectId,
      plateNumber: vehicle.PlateNumber,
      description: vehicle.Description,
      imei: vehicle.IMEI,
      status,
      latitude: gps?.Latitude || 0,
      longitude: gps?.Longitude || 0,
      speed: gps?.Speed || 0,
      angle: gps?.Angle || 0,
      altitude: gps?.Altitude || 0,
      satellites: gps?.Satellites || 0,
      gpsTime: gps?.GpsTime,
      serverTime: gps?.ServerTime,
      minutesSinceUpdate: gps?.MinutesSinceUpdate || null,
      gpsValid: gps?.Valid !== false,
      gpsSource,
    };
    
    console.log('✅ Vehicle details:', result.plateNumber, '| Source:', gpsSource, '| Minutes ago:', result.minutesSinceUpdate);
    return { success: true, data: result };
    
  } catch (error: any) {
    console.error('❌ Get vehicle details error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get real-time GPS from PostgreSQL for a vehicle
ipcMain.handle('vehicle:get-realtime-gps', async (_, vehicleId: number) => {
  console.log('📡 Getting real-time GPS for v_id:', vehicleId);
  
  try {
    // Ensure PostgreSQL is connected
    await initPostgres();
    
    const gpsData = await queryPostgres(`
      SELECT 
        v_id,
        y as latitude,
        x as longitude,
        speed,
        angle,
        altitude,
        gpstime,
        servertime,
        valid,
        satelites as satellites,
        ignition,
        enginecut,
        battery,
        gsmsignal
      FROM vehiclelastlocation
      WHERE v_id = $1
    `, [vehicleId]);
    
    if (gpsData && gpsData.length > 0) {
      console.log('✅ Real-time GPS retrieved from PostgreSQL');
      return { success: true, data: gpsData[0] };
    }
    
    return { success: true, data: null };
    
  } catch (error: any) {
    console.error('❌ Real-time GPS error:', error.message);
    return { success: false, error: error.message };
  }
});

// =====================================================
// ALERTS - Real-time alerts from PostgreSQL eventlog
// =====================================================

// Classify event name into alert category
function getAlertCategory(name: string): 'critical' | 'warning' | 'geofence' | 'info' {
  const lowerName = (name || '').toLowerCase();
  
  // Critical: Panic, Over Speeding, Power issues
  if (lowerName.includes('panic') || 
      lowerName.includes('over speed') ||
      lowerName.includes('overspeed') ||
      lowerName.includes('sos') ||
      lowerName.includes('emergency')) {
    return 'critical';
  }
  
  // Warning: Battery, Power, Din/Dout
  if (lowerName.includes('fmb battery') || 
      lowerName.includes('power volt') ||
      lowerName.includes('battery status') ||
      lowerName.includes('bb volt') ||
      lowerName.includes('dout') ||
      lowerName.includes('movement')) {
    return 'warning';
  }
  
  // Geofence: City names and location-based events
  const cities = ['rawalpindi', 'islamabad', 'lahore', 'karachi', 'faisalabad', 
                  'multan', 'peshawar', 'quetta', 'sialkot', 'gujranwala',
                  'hyderabad', 'sukkur', 'lhr', 'khi', 'hyd'];
  if (cities.some(city => lowerName.includes(city)) ||
      lowerName.includes('geofence') ||
      lowerName.includes('roaming')) {
    return 'geofence';
  }
  
  // Info: Everything else (Ignition, Trip Odometer, etc.)
  return 'info';
}

// Classify event into severity level
function getAlertSeverity(name: string, value: number): 'critical' | 'high' | 'medium' | 'low' {
  const category = getAlertCategory(name);
  
  if (category === 'critical') return 'critical';
  if (category === 'warning') return 'high';
  if (category === 'geofence') return 'medium';
  return 'low';
}

// Get recent alerts from PostgreSQL eventlog
ipcMain.handle('alerts:get-recent', async (_, options?: { 
  limit?: number; 
  category?: string;
  sinceMinutes?: number;
  sinceId?: string;
}) => {
  const { limit = 20, category, sinceMinutes = 60, sinceId } = options || {};
  console.log('🔔 Fetching alerts:', { limit, category, sinceMinutes, sinceId });
  
  try {
    await initPostgres();
    
    // Only show Critical, Warning, and Geofence alerts
    // Critical: Panic, Over Speeding, SOS, Emergency
    // Warning: Battery, Power, Volt, Movement
    // Geofence: Roaming, city names
    const allowedEvents = `
      AND (
        -- Critical events
        LOWER(name) LIKE '%panic%' 
        OR LOWER(name) LIKE '%over speed%' 
        OR LOWER(name) LIKE '%overspeed%' 
        OR LOWER(name) LIKE '%sos%' 
        OR LOWER(name) LIKE '%emergency%'
        -- Warning events
        OR LOWER(name) LIKE '%battery%' 
        OR LOWER(name) LIKE '%power%' 
        OR LOWER(name) LIKE '%volt%' 
        OR LOWER(name) LIKE '%movement%'
        -- Geofence events (roaming and cities)
        OR LOWER(name) LIKE '%roaming%' 
        OR LOWER(name) LIKE '%geofence%'
        OR LOWER(name) IN ('rawalpindi', 'islamabad', 'lahore', 'karachi', 'faisalabad', 
                           'multan', 'peshawar', 'quetta', 'sialkot', 'gujranwala',
                           'hyderabad', 'sukkur', 'bahawalpur', 'sargodha', 'abbottabad')
      )
    `;
    
    // Additional category filter if specified
    let categoryFilter = '';
    if (category === 'critical') {
      categoryFilter = `AND (LOWER(name) LIKE '%panic%' OR LOWER(name) LIKE '%over speed%' OR LOWER(name) LIKE '%overspeed%' OR LOWER(name) LIKE '%sos%' OR LOWER(name) LIKE '%emergency%')`;
    } else if (category === 'warning') {
      categoryFilter = `AND (LOWER(name) LIKE '%battery%' OR LOWER(name) LIKE '%power%' OR LOWER(name) LIKE '%volt%' OR LOWER(name) LIKE '%movement%')`;
    } else if (category === 'geofence') {
      categoryFilter = `AND (LOWER(name) LIKE '%roaming%' OR LOWER(name) LIKE '%geofence%' OR LOWER(name) IN ('rawalpindi', 'islamabad', 'lahore', 'karachi', 'faisalabad', 'multan', 'peshawar', 'quetta', 'sialkot', 'gujranwala', 'hyderabad', 'sukkur', 'bahawalpur', 'sargodha', 'abbottabad'))`;
    }
    
    // Additional filter for polling (only new events since last ID)
    let sinceFilter = '';
    if (sinceId) {
      sinceFilter = `AND eventlogid > $2`;
    }
    
    // Query with category-based filtering, sorted by time ASC (oldest first, newest at bottom)
    const query = `
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
      WHERE gpstime >= NOW() - INTERVAL '${sinceMinutes} minutes'
        ${category ? categoryFilter : allowedEvents}
        ${sinceFilter}
      ORDER BY gpstime ASC 
      LIMIT $1
    `;
    
    const params = sinceId ? [limit, sinceId] : [limit];
    const events = await queryPostgres(query, params);
    
    if (!events || events.length === 0) {
      console.log('ℹ️ No alerts found');
      return { success: true, data: [], maxId: sinceId || '0' };
    }
    
    // Get vehicle names from TAVL
    const objectIds = [...new Set(events.map((e: any) => e.objectid))];
    let vehicleMap: Record<number, string> = {};
    
    if (objectIds.length > 0) {
      try {
        const vehicleNames = await executeQuery(`
          SELECT ObjectId, Number as PlateNumber 
          FROM [tavl2].[tavl].[Object] WITH (NOLOCK)
          WHERE ObjectId IN (${objectIds.join(',')})
        `);
        vehicleMap = (vehicleNames || []).reduce((acc: any, v: any) => {
          acc[v.ObjectId] = v.PlateNumber;
          return acc;
        }, {});
      } catch (e) {
        console.warn('⚠️ Could not fetch vehicle names');
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
    
    const maxId = Math.max(...events.map((e: any) => parseInt(e.eventlogid) || 0)).toString();
    
    console.log(`✅ Fetched ${alerts.length} alerts (max ID: ${maxId})`);
    return { success: true, data: alerts, maxId };
    
  } catch (error: any) {
    console.error('❌ Alerts fetch error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get alert statistics
ipcMain.handle('alerts:get-stats', async () => {
  console.log('📊 Fetching alert statistics...');
  
  try {
    await initPostgres();
    
    // Get counts by category for the last hour (excluding ignition events)
    const stats = await queryPostgres(`
      SELECT 
        name,
        COUNT(*) as count
      FROM eventlog 
      WHERE gpstime >= NOW() - INTERVAL '60 minutes'
        AND LOWER(name) NOT LIKE '%ignition%'
      GROUP BY name
      ORDER BY count DESC
      LIMIT 20
    `);
    
    // Categorize the stats
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
    return { success: true, data: categories };
    
  } catch (error: any) {
    console.error('❌ Alert stats error:', error.message);
    return { success: false, error: error.message };
  }
});

// Explore PostgreSQL eventlog table in detail
ipcMain.handle('pg:explore-eventlog', async () => {
  console.log('\n' + '='.repeat(80));
  console.log('🔬 EXPLORING POSTGRESQL EVENTLOG TABLE (192.168.20.186/Tracking)');
  console.log('='.repeat(80) + '\n');
  
  try {
    await initPostgres();
    
    // 1. Get table structure
    console.log('📋 Table Structure:');
    const columns = await queryPostgres(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'eventlog'
      ORDER BY ordinal_position
    `);
    console.log('Columns:', JSON.stringify(columns, null, 2));
    
    // 2. Get row count
    const countResult = await queryPostgres('SELECT COUNT(*) as total FROM eventlog');
    console.log('Total rows:', countResult[0]?.total);
    
    // 3. Get sample data (latest 10 records)
    console.log('\n📄 Latest 10 records:');
    const latestRecords = await queryPostgres(`
      SELECT * FROM eventlog 
      ORDER BY servertime DESC 
      LIMIT 10
    `);
    console.log(JSON.stringify(latestRecords, null, 2));
    
    // 4. Check date range
    console.log('\n📅 Date range in eventlog:');
    const dateRange = await queryPostgres(`
      SELECT 
        MIN(servertime) as oldest,
        MAX(servertime) as newest,
        NOW() as current_time
      FROM eventlog
    `);
    console.log('Date range:', JSON.stringify(dateRange, null, 2));
    
    // 5. Check for BMW-984 (ObjectId: 122543) data
    console.log('\n🔍 Checking for BMW-984 (objectid=122543) in eventlog:');
    const bmwData = await queryPostgres(`
      SELECT * FROM eventlog 
      WHERE objectid = 122543 
      ORDER BY gpstime DESC 
      LIMIT 10
    `);
    console.log('BMW-984 data in eventlog:', JSON.stringify(bmwData, null, 2));
    
    // 6. Check distinct objectid values (sample)
    console.log('\n🔍 Sample objectid values:');
    const distinctObjects = await queryPostgres(`
      SELECT DISTINCT objectid FROM eventlog LIMIT 20
    `);
    console.log('Sample objectids:', distinctObjects.map((r: any) => r.objectid));
    
    // 6. Check distinct NAME values
    console.log('\n📊 Distinct NAME values:');
    const distinctNames = await queryPostgres(`
      SELECT name, COUNT(*) as count 
      FROM eventlog 
      GROUP BY name 
      ORDER BY count DESC
    `);
    console.log(JSON.stringify(distinctNames, null, 2));
    
    // 7. Check distinct VALUE values
    console.log('\n📊 Distinct VALUE values:');
    const distinctValues = await queryPostgres(`
      SELECT value, COUNT(*) as count 
      FROM eventlog 
      GROUP BY value 
      ORDER BY count DESC 
      LIMIT 50
    `);
    console.log(JSON.stringify(distinctValues, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('🏁 EVENTLOG EXPLORATION COMPLETE');
    console.log('='.repeat(80) + '\n');
    
    return {
      success: true,
      data: {
        columns,
        totalRows: countResult[0]?.total,
        latestRecords,
        dateRange: dateRange[0],
        sampleObjectIds: distinctObjects.map((r: any) => r.objectid),
        distinctNames,
        distinctValues,
      }
    };
    
  } catch (error: any) {
    console.error('❌ Eventlog exploration error:', error.message);
    return { success: false, error: error.message };
  }
});

// =====================================================
// CRM DATABASE - Customer and Vehicle Details
// =====================================================

// Explore CRM database schema
ipcMain.handle('crm:explore-schema', async () => {
  console.log('\n' + '='.repeat(80));
  console.log('🔬 EXPLORING CRM DATABASE (192.168.21.33/ERP_Tracking)');
  console.log('='.repeat(80) + '\n');
  
  try {
    const schema = await exploreCrmSchema();
    console.log('📋 CRM Tables:', schema.tables?.length || 0);
    console.log('📋 Vehicle-related tables:', schema.vehicleRelatedTables);
    
    // Log details of each vehicle table
    for (const tableName of (schema.vehicleRelatedTables || [])) {
      if (schema[tableName]) {
        console.log(`\n📋 ${tableName}:`);
        console.log('   Columns:', schema[tableName].columns?.map((c: any) => c.name).join(', '));
        if (schema[tableName].sample?.length > 0) {
          console.log('   Sample:', JSON.stringify(schema[tableName].sample[0], null, 2));
        }
      }
    }
    
    console.log('\n✅ CRM schema exploration complete');
    return { success: true, data: schema };
    
  } catch (error: any) {
    console.error('❌ CRM schema exploration error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get vehicle details from CRM by plate number or ObjectId
ipcMain.handle('crm:get-vehicle-details', async (_, identifier: string | number) => {
  console.log('🔍 CRM lookup for:', identifier);
  
  try {
    await initCrmDatabase();
    
    // Query CRMVehiclesDetails_Table - the main vehicle details table
    // Can search by OBJECTID (from TAVL) or Vehicle_RegistrationNo (plate)
    const query = `
      SELECT TOP 1
        Vehicle_Id,
        CustomerId,
        CustomerName,
        CellNo,
        TelephoneNo,
        Address1,
        Address2,
        NIC,
        Vehicle_Make,
        Vehicle_Model,
        Vehicle_Year,
        Vehicle_Color,
        Vehicle_CC,
        Vehicle_Transmission,
        Vehicle_EngineNo,
        Vehicle_ChasisNo,
        Vehicle_RegistrationNo,
        Vehicle_IsLeased,
        Vehicle_Lessee,
        Vehicle_IsInsured,
        InsuredBy,
        Vehicle_DeviceSerial,
        Vehicle_SIM,
        Vehicle_IMEINo,
        Vehicle_DateOfInstallation,
        Vehicle_Installation_location,
        Vehicle_Technician,
        [Product Segment] as ProductSegment,
        FLEET_TYPE,
        BRANCH_NAME,
        OBJECTID,
        Vehicle_TrackingSpecialInstructions
      FROM [CRMVehiclesDetails_Table]
      WHERE OBJECTID = @identifier 
         OR Vehicle_RegistrationNo = @identifier
         OR Vehicle_Id = @identifier
    `;
    
    const result = await queryCrm(query, { identifier: String(identifier) });
    
    if (result && result.length > 0) {
      console.log('✅ Found vehicle in CRM:', result[0].Vehicle_RegistrationNo || result[0].CustomerName);
      return { success: true, data: result[0] };
    }
    
    console.log('ℹ️ Vehicle not found in CRM for identifier:', identifier);
    return { success: true, data: null };
    
  } catch (error: any) {
    console.error('❌ CRM vehicle lookup error:', error.message);
    return { success: false, error: error.message };
  }
});

// Query CRM with custom query
ipcMain.handle('crm:query', async (_, query: string, params?: Record<string, any>) => {
  try {
    await initCrmDatabase();
    const result = await queryCrm(query, params);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('❌ CRM query error:', error.message);
    return { success: false, error: error.message };
  }
});

// Prevent app from quitting when closing window (minimize to tray later)
app.on('before-quit', () => {
  // Cleanup
  closeCrmDatabase();
});

export { mainWindow };
