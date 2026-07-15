/**
 * PBX Admin PostgreSQL Connection
 * Connects to our custom 'pbx_admin' database on the FreeSWITCH server.
 * This replaces FusionPBX as the source of truth.
 */
import { Pool as PgPool, PoolClient } from 'pg';

let pool: PgPool | null = null;
let isPoolEnded = false;

const getConfig = () => ({
  // PBX_ADMIN_PG_HOST lets dev tunnel Postgres separately from FREESWITCH_HOST
  // (also used for ESL/SSH). Falls back to FREESWITCH_HOST for prod.
  host: process.env.PBX_ADMIN_PG_HOST || process.env.FREESWITCH_HOST || '192.168.20.140',
  port: parseInt(process.env.PBX_ADMIN_PG_PORT || '5432'),
  database: process.env.PBX_ADMIN_PG_DATABASE || 'pbx_admin',
  user: process.env.PBX_ADMIN_PG_USER || 'pbx_admin',
  password: process.env.PBX_ADMIN_PG_PASSWORD || 'pbx_admin_2026_secure',
});

export const initPbxAdminDb = async (): Promise<void> => {
  if (pool && !isPoolEnded) return;
  const config = getConfig();
  try {
    pool = new PgPool({
      ...config,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    isPoolEnded = false;

    pool.on('connect', (client) => {
      client.query("SET timezone = 'Asia/Karachi'");
    });

    const client = await pool.connect();
    await client.query("SET timezone = 'Asia/Karachi'");
    console.log('✅ PBX Admin DB connected to', config.database, 'on', config.host);
    client.release();
  } catch (error: any) {
    console.error('❌ PBX Admin DB connection failed:', error.message);
    pool = null;
  }
};

export const queryPbxDb = async (query: string, params?: any[]): Promise<any[]> => {
  if (!pool || isPoolEnded) {
    await initPbxAdminDb();
  }
  if (!pool) throw new Error('PBX Admin database not available');
  const result = await pool.query(query, params);
  return result.rows;
};

export const queryPbxDbOne = async (query: string, params?: any[]): Promise<any | null> => {
  const rows = await queryPbxDb(query, params);
  return rows[0] || null;
};

export const getClient = async (): Promise<PoolClient> => {
  if (!pool || isPoolEnded) {
    await initPbxAdminDb();
  }
  if (!pool) throw new Error('PBX Admin database not available');
  return pool.connect();
};

export const getDefaultDomainId = async (): Promise<string> => {
  const row = await queryPbxDbOne('SELECT id FROM domain WHERE enabled = true LIMIT 1');
  if (!row) throw new Error('No domain configured');
  return row.id;
};

export const getDefaultDomain = async (): Promise<{ id: string; name: string; ip: string }> => {
  const row = await queryPbxDbOne('SELECT id, name, ip FROM domain WHERE enabled = true LIMIT 1');
  if (!row) throw new Error('No domain configured');
  return row;
};

export const ensurePbxSchema = async (): Promise<void> => {
  try {
    // Extensions — add columns that the edit form uses but were missing from initial schema
    const extCols: [string, string][] = [
      ['email',                'VARCHAR(255)'],
      ['dnd',                  'BOOLEAN DEFAULT false'],
      ['call_forward_enabled', 'BOOLEAN DEFAULT false'],
      ['call_forward_dest',    'VARCHAR(50)'],
      ['call_recording',       "VARCHAR(20) DEFAULT 'all'"],
      ['transport',            "VARCHAR(20) DEFAULT 'udp'"],
      ['codecs',               "TEXT[] DEFAULT ARRAY['PCMU','PCMA']"],
      ['max_contacts',         'INTEGER DEFAULT 1'],
      ['dtmf_mode',            "VARCHAR(20) DEFAULT 'rfc2833'"],
      ['nat_enabled',          'BOOLEAN DEFAULT false'],
    ];
    for (const [col, def] of extCols) {
      await queryPbxDb(`ALTER TABLE extensions ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }

    // Time conditions
    await queryPbxDb(`
      CREATE TABLE IF NOT EXISTS time_conditions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        domain_id   UUID REFERENCES domain(id),
        name        VARCHAR(255) NOT NULL,
        extension   VARCHAR(20),
        description TEXT,
        enabled     BOOLEAN DEFAULT true,
        destination_match    VARCHAR(255),
        destination_mismatch VARCHAR(255),
        created_at  TIMESTAMP DEFAULT now(),
        updated_at  TIMESTAMP DEFAULT now(),
        UNIQUE (domain_id, name)
      )
    `);
    await queryPbxDb(`
      CREATE TABLE IF NOT EXISTS time_condition_ranges (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        condition_id UUID REFERENCES time_conditions(id) ON DELETE CASCADE,
        type         VARCHAR(20) NOT NULL,
        days         TEXT[],
        start_time   TIME,
        end_time     TIME,
        start_date   DATE,
        end_date     DATE
      )
    `);

    // Fax configurations
    await queryPbxDb(`
      CREATE TABLE IF NOT EXISTS fax_configs (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        domain_id        UUID REFERENCES domain(id),
        extension        VARCHAR(20) NOT NULL,
        name             VARCHAR(255),
        email            VARCHAR(255),
        caller_id_number VARCHAR(50),
        caller_id_name   VARCHAR(255),
        description      TEXT,
        enabled          BOOLEAN DEFAULT true,
        created_at       TIMESTAMP DEFAULT now(),
        updated_at       TIMESTAMP DEFAULT now(),
        UNIQUE (domain_id, extension)
      )
    `);

    console.log('✅ PBX Admin schema up to date');
  } catch (err: any) {
    console.error('PBX Admin schema migration error:', err.message);
  }
};

export const closePbxAdminDb = async (): Promise<void> => {
  if (pool && !isPoolEnded) {
    await pool.end();
    isPoolEnded = true;
    pool = null;
    console.log('PBX Admin DB connection closed');
  }
};
