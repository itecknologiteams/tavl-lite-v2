/**
 * Database Diagnostic Utility
 * Run this to understand the database schema and available tables
 */

export interface TableInfo {
  schema: string;
  table: string;
  rowCount?: number;
}

export interface DatabaseDiagnostic {
  database: string;
  schemas: string[];
  tables: TableInfo[];
  alarmTables: TableInfo[];
  eventTables: TableInfo[];
  messageTables: TableInfo[];
}

/**
 * Explore the database schema and find relevant tables
 * Simplified to avoid timeouts
 */
export async function runDatabaseDiagnostic(): Promise<DatabaseDiagnostic | null> {
  try {
    // Simple query to get database name only - avoid heavy INFORMATION_SCHEMA queries
    const dbResult = await window.electron.db.query(`SELECT DB_NAME() as DatabaseName`);
    const dbData = (dbResult as any)?.data || dbResult;
    const database = dbData?.[0]?.DatabaseName || 'Unknown';

    // Quick check for key tables only (not full schema scan)
    const keyTablesResult = await window.electron.db.query(`
      SELECT TOP 10 TABLE_SCHEMA as [schema], TABLE_NAME as [table]
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE' 
        AND (TABLE_NAME LIKE '%Event%' OR TABLE_NAME LIKE '%Message%' OR TABLE_NAME LIKE '%Object%')
      ORDER BY TABLE_NAME
    `);
    const keyTables = (keyTablesResult as any)?.data || keyTablesResult || [];
    
    const tables: TableInfo[] = Array.isArray(keyTables) ? keyTables.map((r: any) => ({
      schema: r.schema,
      table: r.table,
    })) : [];

    const eventTables = tables.filter(t => t.table.toLowerCase().includes('event'));

    return {
      database,
      schemas: [],
      tables,
      alarmTables: [],
      eventTables,
      messageTables: tables.filter(t => t.table.toLowerCase().includes('message')),
    };
  } catch (error: any) {
    console.log('ℹ️ DB diagnostic skipped:', error.message?.split('\n')[0]);
    return null;
  }
}

/**
 * Get column information for a specific table
 */
export async function getTableColumns(schema: string, table: string): Promise<any[]> {
  try {
    const result = await window.electron.db.query(`
      SELECT 
        COLUMN_NAME as name,
        DATA_TYPE as type,
        IS_NULLABLE as nullable,
        CHARACTER_MAXIMUM_LENGTH as maxLength
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `);
    const data = (result as any)?.data || result || [];
    console.log(`📝 Columns in [${schema}].[${table}]:`, data);
    return Array.isArray(data) ? data : [];
  } catch (error: any) {
    console.error(`Failed to get columns for ${schema}.${table}:`, error.message);
    return [];
  }
}

/**
 * Get sample data from a table (first 5 rows)
 */
export async function getSampleData(schema: string, table: string): Promise<any[]> {
  try {
    const result = await window.electron.db.query(`
      SELECT TOP 5 * FROM [${schema}].[${table}] WITH (NOLOCK)
    `);
    const data = (result as any)?.data || result || [];
    console.log(`📄 Sample data from [${schema}].[${table}]:`, data);
    return Array.isArray(data) ? data : [];
  } catch (error: any) {
    console.error(`Failed to get sample data from ${schema}.${table}:`, error.message);
    return [];
  }
}
