/**
 * FusionPBX PostgreSQL Connection
 * Host: FreeSWITCH server (192.168.20.140) / Database: fusionpbx
 * Used for CDR queries and recording lookups.
 */
import { Pool as PgPool } from 'pg';

let pool: PgPool | null = null;
let isPoolEnded = false;

const getConfig = () => ({
  // FUSIONPBX_PG_HOST lets dev tunnel Postgres separately from FREESWITCH_HOST
  // (which is also used for ESL/SSH). Falls back to FREESWITCH_HOST for prod.
  host: process.env.FUSIONPBX_PG_HOST || process.env.FREESWITCH_HOST || '192.168.20.140',
  port: parseInt(process.env.FUSIONPBX_PG_PORT || '5432'),
  database: process.env.FUSIONPBX_PG_DATABASE || 'fusionpbx',
  user: process.env.FUSIONPBX_PG_USER || 'fusionpbx',
  password: process.env.FUSIONPBX_PG_PASSWORD || 'U1GbP18RSsAh5Dg0upylnnp37Q',
});

export const initFusionPbxDb = async (): Promise<void> => {
  if (pool && !isPoolEnded) return;
  const config = getConfig();
  try {
    pool = new PgPool({
      ...config,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    isPoolEnded = false;

    pool.on('connect', (client) => {
      client.query("SET timezone = 'Asia/Karachi'");
    });

    const client = await pool.connect();
    await client.query("SET timezone = 'Asia/Karachi'");
    console.log('✅ FusionPBX PostgreSQL connected to', config.database, 'on', config.host);
    client.release();
  } catch (error: any) {
    console.error('❌ FusionPBX PostgreSQL connection failed:', error.message);
    pool = null;
  }
};

export const queryFusionPbx = async (query: string, params?: any[]): Promise<any[]> => {
  if (!pool || isPoolEnded) {
    await initFusionPbxDb();
  }
  if (!pool) throw new Error('FusionPBX database not available');
  const result = await pool.query(query, params);
  return result.rows;
};

export const closeFusionPbxDb = async (): Promise<void> => {
  if (pool && !isPoolEnded) {
    await pool.end();
    isPoolEnded = true;
    pool = null;
    console.log('FusionPBX PostgreSQL connection closed');
  }
};
