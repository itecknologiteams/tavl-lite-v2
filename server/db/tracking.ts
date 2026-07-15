import sql from 'mssql';

// Lazy singleton pool for Tracking (MSSQL)
let trackingPool: sql.ConnectionPool | null = null;

function toSqlType(v: any): sql.ISqlTypeFactory | sql.ISqlTypeFactoryWithLength | sql.ISqlTypeFactoryWithNoParams {
  if (v instanceof Date) return sql.DateTime;
  if (typeof v === 'number') return Number.isInteger(v) ? sql.Int : sql.Float;
  if (typeof v === 'boolean') return sql.Bit;
  return sql.NVarChar;
}

export async function getTrackingPool(): Promise<sql.ConnectionPool> {
  if (trackingPool?.connected) return trackingPool;

  trackingPool = new sql.ConnectionPool({
    server: process.env.TRACKING_SERVER || '192.168.20.1',
    database: process.env.TRACKING_NAME || 'Tracking',
    user: process.env.TRACKING_USER || 'sa',
    password: process.env.TRACKING_PASSWORD || 'iteck@12',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 10_000,
      requestTimeout: 20_000,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  });

  await trackingPool.connect();
  return trackingPool;
}

export async function queryTracking<T = any>(
  query: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  const pool = await getTrackingPool();
  const req = pool.request();

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const typ = toSqlType(v);
    // NVarChar needs a length; let mssql infer by passing without explicit type for strings
    if (typ === sql.NVarChar) req.input(k, v);
    else req.input(k, typ as any, v);
  }

  const result = await req.query(query);
  return (result.recordset || []) as T[];
}

export async function getTrackingTableColumns(
  tableName: string,
  schema = 'dbo'
): Promise<string[]> {
  const rows = await queryTracking<{ COLUMN_NAME: string }>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS WITH (NOLOCK)
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `,
    { schema, table: tableName }
  );
  return rows.map((r) => r.COLUMN_NAME);
}

