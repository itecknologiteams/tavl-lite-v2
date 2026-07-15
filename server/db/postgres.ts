/**
 * PostgreSQL Database Connection
 * Host: 192.168.20.186 / Database: Tracking
 */
import { Pool as PgPool } from 'pg';

let pool: PgPool | null = null;
let isPoolEnded = false;

interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const getConfig = (): PostgresConfig => ({
  host: process.env.PG_HOST || '192.168.20.186',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'Tracking',
  user: process.env.PG_USER || 'admin',
  password: process.env.PG_PASSWORD || 'admin123',
});

export const initPostgres = async (): Promise<void> => {
  if (pool && !isPoolEnded) return;
  
  const config = getConfig();
  
  try {
    pool = new PgPool({
      ...config,
      max: 30,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    isPoolEnded = false;
    
    // Set timezone to PKT (UTC+5) for proper timestamp handling
    // The source SQL Server stores timestamps in local PKT time
    pool.on('connect', (client) => {
      client.query("SET timezone = 'Asia/Karachi'");
    });
    
    const client = await pool.connect();
    // Set timezone for initial connection
    await client.query("SET timezone = 'Asia/Karachi'");
    console.log('✅ PostgreSQL connected to', config.database, 'on', config.host, '(timezone: Asia/Karachi)');
    client.release();
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    throw error;
  }
};

export const queryPostgres = async (query: string, params?: any[]): Promise<any[]> => {
  if (!pool || isPoolEnded) {
    await initPostgres();
  }

  try {
    const result = await pool!.query(query, params);
    return result.rows;
  } catch (error: any) {
    // Pool was ended concurrently (race during graceful shutdown); reinit and retry once.
    if (error.message === 'Cannot use a pool after calling end on the pool') {
      isPoolEnded = true;
      pool = null;
      await initPostgres();
      const result = await pool!.query(query, params);
      return result.rows;
    }
    console.error('PostgreSQL query error:', error.message);
    throw error;
  }
};

/**
 * Run multiple queries inside a single transaction.
 * If any query fails, the entire transaction is rolled back.
 */
export const withTransaction = async <T>(
  fn: (query: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>
): Promise<T> => {
  if (!pool || isPoolEnded) {
    await initPostgres();
  }
  const client = await pool!.connect().catch(async (e: any) => {
    if (e.message === 'Cannot use a pool after calling end on the pool') {
      isPoolEnded = true;
      pool = null;
      await initPostgres();
      return pool!.connect();
    }
    throw e;
  });
  try {
    await client.query('BEGIN');
    const txQuery = async (sql: string, params?: any[]): Promise<any[]> => {
      const result = await client.query(sql, params);
      return result.rows;
    };
    const result = await fn(txQuery);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const closePostgres = async (): Promise<void> => {
  if (pool && !isPoolEnded) {
    isPoolEnded = true;
    const draining = pool;
    pool = null;
    await draining.end();
    console.log('PostgreSQL connection closed');
  }
};
