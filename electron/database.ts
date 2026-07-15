import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;
let currentConfig: DatabaseConfig | null = null;
let isConnecting = false;

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
    cancelTimeout: number;
  };
  pool: {
    max: number;
    min: number;
    idleTimeoutMillis: number;
    acquireTimeoutMillis: number;
  };
}

// Load config from environment or config file
const getConfig = (): DatabaseConfig => {
  // Start with TAVL database (primary for vehicle data - matches Python behavior)
  const config = {
    server: process.env.DB_SERVER || '192.168.20.253',
    database: process.env.DB_NAME || 'tavl2',
    user: process.env.DB_USER || 'developer',
    password: process.env.DB_PASSWORD || 'tavldev123',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 15000,    // 15 seconds to connect
      requestTimeout: 60000,    // 1 minute for queries
      cancelTimeout: 15000,     // 15 seconds to cancel
    },
    pool: {
      max: 5,                   // Smaller pool
      min: 0,                   // Don't keep idle connections
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      acquireTimeoutMillis: 30000, // Wait up to 30s to acquire connection
    },
  };
  
  console.log('🔧 Database Config:', {
    server: config.server,
    database: config.database,
    user: config.user,
  });
  
  return config;
};

// Check if pool is connected and healthy
const isPoolConnected = (): boolean => {
  return pool !== null && pool.connected && !pool.connecting;
};

// Track reconnection attempts to avoid spam
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_COOLDOWN = 30000; // 30 seconds
let lastReconnectTime = 0;

// Ensure connection is active, reconnect if needed
const ensureConnection = async (): Promise<void> => {
  if (isConnecting) {
    // Wait for ongoing connection attempt
    let attempts = 0;
    while (isConnecting && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (isPoolConnected()) return;
  }

  if (!isPoolConnected() && currentConfig) {
    // Check cooldown and attempt limit
    const now = Date.now();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS && (now - lastReconnectTime) < RECONNECT_COOLDOWN) {
      throw new Error('Database reconnection on cooldown');
    }
    
    if ((now - lastReconnectTime) > RECONNECT_COOLDOWN) {
      reconnectAttempts = 0; // Reset after cooldown
    }
    
    reconnectAttempts++;
    lastReconnectTime = now;
    isConnecting = true;
    
    try {
      // Clean up old pool
      if (pool) {
        try {
          await pool.close();
        } catch (e) {
          // Ignore close errors
        }
        pool = null;
      }
      
      // Create new pool with stored config
      pool = new sql.ConnectionPool(currentConfig);
      
      // Set up event handlers (minimal logging)
      pool.on('error', () => {
        // Silent - avoid log spam
      });
      
      await pool.connect();
      console.log('✅ Database reconnected to', currentConfig.database);
      reconnectAttempts = 0; // Reset on success
    } catch (error: any) {
      console.log('⚠️ Reconnection attempt', reconnectAttempts, 'failed:', error.message);
      throw error;
    } finally {
      isConnecting = false;
    }
  }
};

export const initDatabase = async (customConfig?: Partial<DatabaseConfig>): Promise<void> => {
  isConnecting = true;
  try {
    // Close existing connection if any
    if (pool) {
      try {
        await pool.close();
      } catch (e) {
        // Ignore close errors
      }
      pool = null;
    }

    const baseConfig = getConfig();
    const config = customConfig ? { ...baseConfig, ...customConfig } : baseConfig;
    
    currentConfig = config;
    pool = new sql.ConnectionPool(config);
    
    // Set up event handlers for connection monitoring
    pool.on('error', (err) => {
      console.error('❌ Pool error:', err.message);
    });
    
    await pool.connect();
    console.log('✅ Database connected successfully to', config.database, 'on', config.server);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  } finally {
    isConnecting = false;
  }
};

// Function to update database configuration dynamically
export const updateDatabaseConfig = async (newConfig: {
  server: string;
  database: string;
  user: string;
  password: string;
}): Promise<void> => {
  console.log('🔄 Updating database configuration:', {
    server: newConfig.server,
    database: newConfig.database,
    user: newConfig.user,
  });
  
  await initDatabase({
    server: newConfig.server,
    database: newConfig.database,
    user: newConfig.user,
    password: newConfig.password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 30000,
      requestTimeout: 120000,
      cancelTimeout: 30000,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 60000,
    },
  });
};

export const executeQuery = async (
  query: string,
  params?: Record<string, any>
): Promise<any> => {
  // Ensure we have a valid connection before executing
  await ensureConnection();
  
  if (!pool) {
    console.warn('Database not connected - query skipped');
    throw new Error('Database not connected');
  }

  try {
    const request = pool.request();

    // Add parameters to prevent SQL injection
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        // Infer SQL type based on JS type
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
    console.error('Query execution error:', error);
    
    // If it's a connection or timeout error, try to reconnect and retry once
    const isConnectionError = error.code === 'ECONNCLOSED' || error.code === 'ENOTOPEN';
    const isTimeoutError = error.code === 'ETIMEOUT';
    
    if (isConnectionError || isTimeoutError) {
      console.log(`🔄 ${isTimeoutError ? 'Timeout' : 'Connection'} error detected, attempting reconnection and retry...`);
      try {
        // Force reconnect
        if (pool) {
          try {
            await pool.close();
          } catch (e) {
            // Ignore
          }
          pool = null;
        }
        
        await ensureConnection();
        
        if (pool) {
          const request = (pool as sql.ConnectionPool).request();
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
          console.log('✅ Query succeeded after reconnection');
          return result.recordset;
        }
      } catch (retryError) {
        console.error('❌ Retry failed:', retryError);
        throw retryError;
      }
    }
    
    throw error;
  }
};

export const closeDatabase = async (): Promise<void> => {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('Database connection closed');
  }
};
