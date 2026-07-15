/**
 * PostgreSQL Database Connection for Tracking/Events
 * Host: 192.168.20.186
 * Database: Tracking
 */

// Use require for pg to avoid bundling issues
const { Pool } = require('pg');

interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

let pool: any = null;
let isPoolEnded = false;

const DEFAULT_CONFIG: PostgresConfig = {
  host: '192.168.20.186',
  port: 5432,
  database: 'Tracking',
  user: 'admin',
  password: 'admin123',
};

export const initPostgres = async (customConfig?: Partial<PostgresConfig>): Promise<void> => {
  const config = { ...DEFAULT_CONFIG, ...customConfig };
  
  try {
    // If pool exists and is not ended, reuse it
    if (pool && !isPoolEnded) {
      return;
    }
    
    // Create new pool
    pool = new Pool({
      ...config,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    isPoolEnded = false;
    
    // Test connection
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected to', config.database, 'on', config.host);
    client.release();
    
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    throw error;
  }
};

export const queryPostgres = async (query: string, params?: any[]): Promise<any[]> => {
  // Auto-connect if not connected
  if (!pool || isPoolEnded) {
    await initPostgres();
  }
  
  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error('PostgreSQL query error:', error.message);
    throw error;
  }
};

export const closePostgres = async (): Promise<void> => {
  if (pool && !isPoolEnded) {
    await pool.end();
    isPoolEnded = true;
    pool = null;
    console.log('PostgreSQL connection closed');
  }
};

/**
 * Explore the PostgreSQL database schema
 */
export const explorePostgresSchema = async (): Promise<{
  tables: string[];
  eventLogColumns?: { name: string; type: string }[];
  vehicleLastLocationColumns?: { name: string; type: string }[];
  vehicleSummaryColumns?: { name: string; type: string }[];
  sampleEventLog?: any[];
  sampleVehicleLocation?: any[];
  sampleVehicleSummary?: any[];
}> => {
  if (!pool) {
    await initPostgres();
  }
  
  const result: any = { tables: [] };
  
  try {
    // Get all tables
    const tablesResult = await queryPostgres(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    result.tables = tablesResult.map((r: any) => r.table_name);
    console.log('📋 PostgreSQL tables:', result.tables);
    
    // Similar tables
    const similarTables = result.tables.filter((t: string) => 
      t.includes('event') || t.includes('log') || t.includes('gps') || 
      t.includes('location') || t.includes('vehicle') || t.includes('track') ||
      t.includes('summary')
    );
    console.log('🔍 Similar tables found:', similarTables);
    
    // Explore eventlog table
    try {
      const eventLogCols = await queryPostgres(`
        SELECT column_name, data_type
        FROM information_schema.columns 
        WHERE table_name = 'eventlog'
        ORDER BY ordinal_position
      `);
      if (eventLogCols.length > 0) {
        result.eventLogColumns = eventLogCols.map((c: any) => ({
          name: c.column_name,
          type: c.data_type,
        }));
        console.log('📝 eventlog columns:', result.eventLogColumns);
        
        const sample = await queryPostgres('SELECT * FROM eventlog LIMIT 3');
        result.sampleEventLog = sample;
        console.log('📄 eventlog sample:', sample);
      }
    } catch (e: any) {
      console.log('eventlog exploration error:', e.message);
    }
    
    // Explore vehiclelastlocation table
    try {
      const cols = await queryPostgres(`
        SELECT column_name, data_type
        FROM information_schema.columns 
        WHERE table_name = 'vehiclelastlocation'
        ORDER BY ordinal_position
      `);
      if (cols.length > 0) {
        result.vehicleLastLocationColumns = cols.map((c: any) => ({
          name: c.column_name,
          type: c.data_type,
        }));
        console.log('📝 vehiclelastlocation columns:', result.vehicleLastLocationColumns);
        
        const sample = await queryPostgres('SELECT * FROM vehiclelastlocation LIMIT 5');
        result.sampleVehicleLocation = sample;
        console.log('📄 vehiclelastlocation sample:', sample);
      }
    } catch (e: any) {
      console.log('vehiclelastlocation exploration error:', e.message);
    }
    
    // Explore vehiclesummary table
    try {
      const cols = await queryPostgres(`
        SELECT column_name, data_type
        FROM information_schema.columns 
        WHERE table_name = 'vehiclesummary'
        ORDER BY ordinal_position
      `);
      if (cols.length > 0) {
        result.vehicleSummaryColumns = cols.map((c: any) => ({
          name: c.column_name,
          type: c.data_type,
        }));
        console.log('📝 vehiclesummary columns:', result.vehicleSummaryColumns);
        
        const sample = await queryPostgres('SELECT * FROM vehiclesummary LIMIT 5');
        result.sampleVehicleSummary = sample;
        console.log('📄 vehiclesummary sample:', sample);
      }
    } catch (e: any) {
      console.log('vehiclesummary exploration error:', e.message);
    }
    
  } catch (error: any) {
    console.error('Schema exploration error:', error.message);
  }
  
  return result;
};
