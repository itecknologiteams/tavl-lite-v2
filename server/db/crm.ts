/**
 * CRM SQL Server Database Connection
 * Host: 192.168.21.33 / Database: ERP_Tracking
 */
import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;
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

const getConfig = (): CrmConfig => ({
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
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
});

export const initCrmDatabase = async (): Promise<void> => {
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
    console.log('🔧 CRM Database Config:', {
      server: config.server,
      database: config.database,
      user: config.user,
    });
    
    pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => console.error('❌ CRM Pool error:', err.message));
    
    await pool.connect();
    console.log('✅ CRM Database connected to', config.database, 'on', config.server);
  } catch (error: any) {
    console.error('❌ CRM Database connection failed:', error.message);
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const queryCrm = async (
  query: string,
  params?: Record<string, any>
): Promise<any[]> => {
  if (!pool?.connected) {
    await initCrmDatabase();
  }
  
  if (!pool) {
    throw new Error('CRM Database not connected');
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
    console.error('CRM Query error:', error.message);
    throw error;
  }
};

export const closeCrmDatabase = async (): Promise<void> => {
  if (pool) {
    try { await pool.close(); } catch (e) {}
    pool = null;
    console.log('CRM Database connection closed');
  }
};

// Vehicle Logs types
export type VehicleLogType = 
  | 'general_logs'
  | 'PRE_INFORMATION'
  | 'Events'
  | 'Removal'
  | 'Removal_Logs'
  | 'REPOSSESSION'
  | 'REDO_INFORMATION'
  | 'COMPLAIN'
  | 'COMPLAIN-NEW'
  | 'CODE_RED'
  | 'SMS_TAB'
  | 'CUSTOMER_FEEDBACK'
  | 'LOCATION_ON_CALL'
  | 'NOT_REPORTING'
  | 'PAYMENT_OUTSTANDING_RECOLLECTION_LOG'
  | 'RENEWAL_LOG';

// Log type metadata for UI display
export const LOG_TYPE_METADATA: Record<VehicleLogType, { label: string; description: string; icon: string; category: string }> = {
  general_logs: { label: 'General Logs', description: 'Basic interaction logs', icon: 'FileText', category: 'Communication' },
  PRE_INFORMATION: { label: 'Pre-Information', description: 'Scheduled events & trips', icon: 'Calendar', category: 'Events' },
  Events: { label: 'Events', description: 'Events that occurred', icon: 'Activity', category: 'Events' },
  Removal: { label: 'Removal', description: 'Device removal records', icon: 'MinusCircle', category: 'Service' },
  Removal_Logs: { label: 'Removal Follow-ups', description: 'Removal case follow-ups', icon: 'ClipboardList', category: 'Service' },
  REPOSSESSION: { label: 'Repossession', description: 'Vehicle repossession cases', icon: 'AlertOctagon', category: 'Critical' },
  REDO_INFORMATION: { label: 'Redo/Reinstall', description: 'Reinstallation records', icon: 'RefreshCw', category: 'Service' },
  COMPLAIN: { label: 'Complaints (Legacy)', description: 'Old complaint records', icon: 'MessageSquare', category: 'Complaints' },
  'COMPLAIN-NEW': { label: 'Complaints', description: 'Customer complaints', icon: 'AlertCircle', category: 'Complaints' },
  CODE_RED: { label: 'Code Red', description: 'Security incidents', icon: 'Shield', category: 'Critical' },
  SMS_TAB: { label: 'SMS History', description: 'SMS sent to customer', icon: 'MessageCircle', category: 'Communication' },
  CUSTOMER_FEEDBACK: { label: 'Feedback', description: 'Customer feedback', icon: 'Star', category: 'Communication' },
  LOCATION_ON_CALL: { label: 'Location Calls', description: 'Location requests', icon: 'PhoneCall', category: 'Communication' },
  NOT_REPORTING: { label: 'Not Reporting', description: 'NR follow-up logs', icon: 'WifiOff', category: 'Technical' },
  PAYMENT_OUTSTANDING_RECOLLECTION_LOG: { label: 'Payment Collection', description: 'Outstanding payments', icon: 'DollarSign', category: 'Finance' },
  RENEWAL_LOG: { label: 'Renewals', description: 'Renewal follow-ups', icon: 'RotateCw', category: 'Finance' },
};

/**
 * Get vehicle logs.
 * For Events: read directly from cr_logs (denormalised, no join filters).
 * Everything else: fall back to the dbo.GET_LOGS stored procedure.
 */
export const getVehicleLogs = async (
  vehicleId: number,
  logType: VehicleLogType
): Promise<any[]> => {
  if (!pool?.connected) {
    await initCrmDatabase();
  }
  if (!pool) {
    throw new Error('CRM Database not connected');
  }

  // Events: skip the SP entirely. The SP INNER JOINs USERS on U_ID, which
  // hides any row whose CREATED_BY holds an EMPLOYEE_ID instead of a U_ID.
  // cr_logs has the raw row regardless, so read it directly.
  if (logType === 'Events') {
    try {
      const r = await pool.request()
        .input('vid', sql.Int, vehicleId)
        .query(`
          SELECT TOP 200
            cr.CR_LD_ID                       AS EVENT_INFO_ID,
            cr.LOG_TYPE                       AS [EVENT TYPE],
            cr.CALLING_NO                     AS [CALLING NO],
            cr.SPOKE_TO                       AS [SPOKE TO],
            cr.COMMENTS,
            cr.CREATION_DATE                  AS [DATE],
            cr.CREATION_DATE                  AS [CALLING DATE TIME],
            COALESCE(u1.U_NAME, u2.U_NAME, CAST(cr.CREATED_BY AS VARCHAR(20))) AS [CREATED BY]
          FROM cr_logs cr WITH (NOLOCK)
          LEFT JOIN USERS u1 ON u1.U_ID        = cr.CREATED_BY
          LEFT JOIN USERS u2 ON u2.EMPLOYEE_ID = cr.CREATED_BY
          WHERE cr.VEH_ID = @vid AND cr.LOG_TYPE = 'EVENTS'
          ORDER BY cr.CR_LD_ID DESC
        `);
      return r.recordset || [];
    } catch (error: any) {
      console.error('cr_logs Events query error:', error.message);
      throw error;
    }
  }

  try {
    const request = pool.request();
    request.input('ID', sql.Int, vehicleId);
    request.input('LOG_STRING', sql.VarChar(100), logType);

    const result = await request.execute('dbo.GET_LOGS');
    return result.recordset || [];
  } catch (error: any) {
    console.error(`Vehicle logs query error (${logType}):`, error.message);
    throw error;
  }
};

/**
 * Get available log types with counts for a vehicle
 */
export const getVehicleLogSummary = async (vehicleId: number): Promise<{ logType: string; count: number }[]> => {
  if (!pool?.connected) {
    await initCrmDatabase();
  }
  
  if (!pool) {
    throw new Error('CRM Database not connected');
  }
  
  try {
    const request = pool.request();
    request.input('vid', sql.Int, vehicleId);
    
    const result = await request.query(`
      SELECT LOG_TYPE as logType, COUNT(*) as count 
      FROM LOG_DETAILS WITH (NOLOCK) 
      WHERE VEH_ID = @vid 
      GROUP BY LOG_TYPE
      ORDER BY count DESC
    `);
    
    return result.recordset || [];
  } catch (error: any) {
    console.error('Vehicle log summary error:', error.message);
    return [];
  }
};
