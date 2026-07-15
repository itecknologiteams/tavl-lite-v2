/**
 * AutoCalls SQL Server Database Connection
 * Host: 192.168.20.1 / Database: AutoCalls
 * Used for robocall status tracking
 */
import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;
let isConnecting = false;

interface AutoCallsConfig {
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

const getConfig = (): AutoCallsConfig => ({
  server: process.env.AUTOCALLS_SERVER || '192.168.20.1',
  database: process.env.AUTOCALLS_NAME || 'AutoCalls',
  user: process.env.AUTOCALLS_USER || 'sa',
  password: process.env.AUTOCALLS_PASSWORD || 'iteck@12',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 10000,
    // CallDetails is a ~26M-row view; normal queries run ~2-4s but spike under load.
    // 15s was too tight — a single timeout makes the whole inbox lookup fail and show
    // "No call" for every alert. Give generous headroom (env-tunable).
    requestTimeout: parseInt(process.env.AUTOCALLS_REQUEST_TIMEOUT || '40000'),
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
});

export const initAutoCallsDatabase = async (): Promise<void> => {
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
    console.log('🔧 AutoCalls Database Config:', {
      server: config.server,
      database: config.database,
    });
    
    pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => console.error('❌ AutoCalls Pool error:', err.message));
    
    await pool.connect();
    console.log('✅ AutoCalls Database connected');
  } catch (error: any) {
    console.error('❌ AutoCalls Database connection failed:', error.message);
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const queryAutoCalls = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  if (!pool?.connected) {
    await initAutoCallsDatabase();
  }
  
  if (!pool) {
    throw new Error('AutoCalls Database not connected');
  }
  
  try {
    const request = pool.request();
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (typeof value === 'string') {
          request.input(key, sql.VarChar, value);
        } else if (typeof value === 'number') {
          request.input(key, sql.BigInt, value);
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
    console.error('AutoCalls Query error:', error.message);
    throw error;
  }
};

export const closeAutoCallsDatabase = async (): Promise<void> => {
  if (pool) {
    try { await pool.close(); } catch (e) {}
    pool = null;
    console.log('AutoCalls Database connection closed');
  }
};
