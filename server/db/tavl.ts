/**
 * TAVL SQL Server Database Connection
 * Host: 192.168.20.253 / Database: tavl2
 * Also includes Tracking database connection for ConsoleWarning alerts
 */
import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;
let isConnecting = false;

// Tracking database pool (for ConsoleWarning alerts)
let trackingPool: sql.ConnectionPool | null = null;
let isConnectingTracking = false;

interface DatabaseConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    connectTimeout: number;
    requestTimeout: number;
  };
  pool: {
    max: number;
    min: number;
    idleTimeoutMillis: number;
  };
}

const getConfig = (): DatabaseConfig => ({
  server: process.env.DB_SERVER || '192.168.20.253',
  database: process.env.DB_NAME || 'tavl2',
  user: process.env.DB_USER || 'developer',
  password: process.env.DB_PASSWORD || 'tavldev123',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 15000,
    requestTimeout: 60000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
});

export const initTavlDatabase = async (): Promise<void> => {
  if (isConnecting) {
    let attempts = 0;
    while (isConnecting && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (pool?.connected) return;
  }
  
  if (pool?.connected) return;
  
  isConnecting = true;
  try {
    if (pool) {
      try { await pool.close(); } catch (e) {}
      pool = null;
    }
    
    const config = getConfig();
    console.log('🔧 TAVL Database Config:', {
      server: config.server,
      database: config.database,
      user: config.user,
    });
    
    pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => console.error('❌ TAVL Pool error:', err.message));
    
    await pool.connect();
    console.log('✅ TAVL Database connected to', config.database, 'on', config.server);
  } catch (error: any) {
    console.error('❌ TAVL Database connection failed:', error.message);
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const queryTavl = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  if (!pool?.connected) {
    await initTavlDatabase();
  }
  
  if (!pool) {
    throw new Error('TAVL Database not connected');
  }
  
  try {
    const request = pool.request();
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (typeof value === 'string') {
          request.input(key, sql.VarChar, value);
        } else if (typeof value === 'number') {
          request.input(key, sql.Int, value);
        } else if (typeof value === 'boolean') {
          request.input(key, sql.Bit, value);
        } else if (value instanceof Date) {
          request.input(key, sql.DateTime, value);
        } else {
          request.input(key, value);
        }
      });
    }
    
    const result = await request.query(query);
    return result.recordset;
  } catch (error: any) {
    console.error('TAVL Query error:', error.message);
    throw error;
  }
};

export const closeTavlDatabase = async (): Promise<void> => {
  if (pool) {
    try { await pool.close(); } catch (e) {}
    pool = null;
    console.log('TAVL Database connection closed');
  }
};

// Tracking Database (192.168.20.1) - for ConsoleWarning alerts
const getTrackingConfig = (): DatabaseConfig => ({
  server: process.env.TRACKING_SERVER || '192.168.20.1',
  database: process.env.TRACKING_NAME || 'Tracking',
  user: process.env.TRACKING_USER || 'sa',
  password: process.env.TRACKING_PASSWORD || 'iteck@12',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 15000,
    requestTimeout: 30000,
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
});

export const initTrackingDatabase = async (): Promise<void> => {
  if (isConnectingTracking) {
    let attempts = 0;
    while (isConnectingTracking && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (trackingPool?.connected) return;
  }
  
  if (trackingPool?.connected) return;
  
  isConnectingTracking = true;
  try {
    if (trackingPool) {
      try { await trackingPool.close(); } catch (e) {}
      trackingPool = null;
    }
    
    const config = getTrackingConfig();
    console.log('🔧 Tracking Database Config:', {
      server: config.server,
      database: config.database,
    });
    
    trackingPool = new sql.ConnectionPool(config);
    trackingPool.on('error', (err) => console.error('❌ Tracking Pool error:', err.message));
    
    await trackingPool.connect();
    console.log('✅ Tracking Database connected');
  } catch (error: any) {
    console.error('❌ Tracking Database connection failed:', error.message);
    throw error;
  } finally {
    isConnectingTracking = false;
  }
};

export const queryTracking = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  if (!trackingPool?.connected) {
    await initTrackingDatabase();
  }
  
  if (!trackingPool) {
    throw new Error('Tracking Database not connected');
  }
  
  try {
    const request = trackingPool.request();
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (typeof value === 'string') {
          request.input(key, sql.VarChar, value);
        } else if (typeof value === 'number') {
          // Use BigInt for large integers (e.g. EventLogId), Int for smaller ones
          if (Number.isInteger(value) && Math.abs(value) > 2147483647) {
            request.input(key, sql.BigInt, value);
          } else if (Number.isInteger(value)) {
            request.input(key, sql.Int, value);
          } else {
            request.input(key, sql.Float, value);
          }
        } else if (typeof value === 'boolean') {
          request.input(key, sql.Bit, value);
        } else if (value instanceof Date) {
          request.input(key, sql.DateTime, value);
        } else {
          request.input(key, value);
        }
      });
    }

    const result = await request.query(query);
    return result.recordset;
  } catch (error: any) {
    console.error('Tracking Query error:', error.message);
    throw error;
  }
};
