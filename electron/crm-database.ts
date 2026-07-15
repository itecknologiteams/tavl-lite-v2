import sql from 'mssql';

let crmPool: sql.ConnectionPool | null = null;
let isConnecting = false;

interface CrmConfig {
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

// Get CRM config from environment
const getCrmConfig = (): CrmConfig => {
  const config = {
    server: process.env.CRM_SERVER || '192.168.21.33',
    database: process.env.CRM_NAME || 'ERP_Tracking',
    user: process.env.CRM_USER || 'sa',
    password: process.env.CRM_PASSWORD || 'iteck@1212',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 15000,
      requestTimeout: 30000,
    },
    pool: {
      max: 3,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
  
  return config;
};

// Initialize CRM database connection
export const initCrmDatabase = async (): Promise<void> => {
  if (isConnecting) {
    // Wait for ongoing connection
    let attempts = 0;
    while (isConnecting && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (crmPool?.connected) return;
  }
  
  if (crmPool?.connected) return;
  
  isConnecting = true;
  try {
    // Close existing connection
    if (crmPool) {
      try {
        await crmPool.close();
      } catch (e) {
        // Ignore
      }
      crmPool = null;
    }
    
    const config = getCrmConfig();
    console.log('🔧 CRM Database Config:', {
      server: config.server,
      database: config.database,
      user: config.user,
    });
    
    crmPool = new sql.ConnectionPool(config);
    
    crmPool.on('error', (err) => {
      console.error('❌ CRM Pool error:', err.message);
    });
    
    await crmPool.connect();
    console.log('✅ CRM Database connected to', config.database, 'on', config.server);
    
  } catch (error: any) {
    console.error('❌ CRM Database connection failed:', error.message);
    throw error;
  } finally {
    isConnecting = false;
  }
};

// Execute CRM query
export const queryCrm = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  // Ensure connected
  if (!crmPool?.connected) {
    await initCrmDatabase();
  }
  
  if (!crmPool) {
    throw new Error('CRM Database not connected');
  }
  
  try {
    const request = crmPool.request();
    
    // Add parameters
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
    console.error('CRM Query error:', error.message);
    throw error;
  }
};

// Close CRM connection
export const closeCrmDatabase = async (): Promise<void> => {
  if (crmPool) {
    try {
      await crmPool.close();
    } catch (e) {
      // Ignore
    }
    crmPool = null;
    console.log('CRM Database connection closed');
  }
};

// Explore CRM schema
export const exploreCrmSchema = async (): Promise<any> => {
  await initCrmDatabase();
  
  const results: any = {};
  
  // Get all tables
  const tables = await queryCrm(`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  results.tables = tables.map((t: any) => t.TABLE_NAME);
  
  // Look for vehicle-related tables
  const vehicleTables = results.tables.filter((t: string) => 
    t.toLowerCase().includes('vehicle') || 
    t.toLowerCase().includes('car') ||
    t.toLowerCase().includes('customer') ||
    t.toLowerCase().includes('client')
  );
  
  results.vehicleRelatedTables = vehicleTables;
  
  // Get columns for vehicle-related tables
  for (const tableName of vehicleTables.slice(0, 5)) {
    const columns = await queryCrm(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName
      ORDER BY ORDINAL_POSITION
    `, { tableName });
    
    results[tableName] = {
      columns: columns.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })),
    };
    
    // Get sample data
    try {
      const sample = await queryCrm(`SELECT TOP 3 * FROM [${tableName}]`);
      results[tableName].sample = sample;
    } catch (e) {
      results[tableName].sample = [];
    }
  }
  
  return results;
};
