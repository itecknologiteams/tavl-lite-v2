/**
 * MobileApp SQL Server Database Connection
 * Host: 192.168.20.1 / Database: MobileApp
 * Contains: AppLogin, Notifications tables
 */
import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;
let isConnecting = false;

interface MobileAppConfig {
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

const getConfig = (): MobileAppConfig => ({
  server: process.env.MOBILEAPP_SERVER || '192.168.20.1',
  database: process.env.MOBILEAPP_NAME || 'MobileApp',
  user: process.env.MOBILEAPP_USER || 'sa',
  password: process.env.MOBILEAPP_PASSWORD || 'iteck@12',
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

export const initMobileAppDatabase = async (): Promise<void> => {
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
    console.log('🔧 MobileApp Database Config:', {
      server: config.server,
      database: config.database,
    });
    
    pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => console.error('❌ MobileApp Pool error:', err.message));
    
    await pool.connect();
    console.log('✅ MobileApp Database connected to', config.database, 'on', config.server);
  } catch (error: any) {
    console.error('❌ MobileApp Database connection failed:', error.message);
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const queryMobileApp = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  if (!pool?.connected) {
    await initMobileAppDatabase();
  }
  
  if (!pool) {
    throw new Error('MobileApp Database not connected');
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
    console.error('MobileApp Query error:', error.message);
    throw error;
  }
};

export const closeMobileAppDatabase = async (): Promise<void> => {
  if (pool) {
    try { await pool.close(); } catch (e) {}
    pool = null;
    console.log('MobileApp Database connection closed');
  }
};
