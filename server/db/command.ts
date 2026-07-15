/**
 * Command Database Connection (SMS/GPRS commands)
 * Host: 192.168.21.33 / Database: tavl2
 * 
 * Tables:
 * - dbo.control_room_sms - SMS commands sent
 * - dbo.control_room_sms_received - SMS replies received
 * - dbo.to_be_sent - SMS queue
 * - dbo.GprsCommandQueue - GPRS commands pending
 * - dbo.GprsCommandSent - GPRS commands sent
 * - dbo.GprsCommandReply - GPRS replies received
 */
import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;
let isConnecting = false;

interface CmdConfig {
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

const getConfig = (): CmdConfig => ({
  server: process.env.CMD_SERVER || '192.168.21.33',
  database: process.env.CMD_NAME || 'tavl2',
  user: process.env.CMD_USER || 'sa',
  password: process.env.CMD_PASSWORD || 'iteck@1212',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 15000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
});

export const initCommandDatabase = async (): Promise<void> => {
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
    console.log('🔧 Command Database Config:', {
      server: config.server,
      database: config.database,
      user: config.user,
    });
    
    pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => console.error('❌ Command DB Pool error:', err.message));
    
    await pool.connect();
    console.log('✅ Command Database connected to', config.database, 'on', config.server);
  } catch (error: any) {
    console.error('❌ Command Database connection failed:', error.message);
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const queryCommand = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  if (!pool?.connected) {
    await initCommandDatabase();
  }
  
  if (!pool) {
    throw new Error('Command Database not connected');
  }
  
  try {
    const request = pool.request();
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (typeof value === 'string') {
          request.input(key, sql.NVarChar, value);
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
    console.error('Command DB Query error:', error.message);
    throw error;
  }
};

export const closeCommandDatabase = async (): Promise<void> => {
  if (pool) {
    try { await pool.close(); } catch (e) {}
    pool = null;
    console.log('Command Database connection closed');
  }
};
