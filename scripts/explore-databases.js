/**
 * Database Schema Explorer
 * Explores both PostgreSQL (Tracking) and SQL Server (CRM) databases
 */

const { Client } = require('pg');
const sql = require('mssql');

// Database configurations
const POSTGRES_CONFIG = {
  host: '192.168.20.186',
  port: 5432,
  database: 'Tracking',
  user: 'admin',
  password: 'admin123',
  connectionTimeoutMillis: 10000,
};

const SQLSERVER_CONFIG = {
  server: '192.168.21.33',
  database: 'ERP_Tracking',
  user: 'crm',
  password: 'sadoIOJDDAS03209203@$#%',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 10000,
    requestTimeout: 30000,
  },
};

async function explorePostgres() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 POSTGRESQL DATABASE (192.168.20.186/Tracking)');
  console.log('='.repeat(60));

  const client = new Client(POSTGRES_CONFIG);

  try {
    console.log('🔄 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Get all tables
    console.log('📋 Tables in database:');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    for (const row of tablesResult.rows) {
      console.log(`   - ${row.table_name}`);
    }

    // Check if event_log exists and get its structure
    console.log('\n📝 Looking for event_log table...');
    const eventLogCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'event_log'
      ORDER BY ordinal_position
    `);

    if (eventLogCheck.rows.length > 0) {
      console.log('✅ event_log table found!\n');
      console.log('Columns:');
      for (const col of eventLogCheck.rows) {
        console.log(`   ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      }

      // Get sample data
      console.log('\n📄 Sample data (first 3 rows):');
      const sampleData = await client.query('SELECT * FROM event_log LIMIT 3');
      if (sampleData.rows.length > 0) {
        console.log(JSON.stringify(sampleData.rows, null, 2));
      } else {
        console.log('   (no data)');
      }

      // Get row count
      const countResult = await client.query('SELECT COUNT(*) as count FROM event_log');
      console.log(`\n📊 Total rows: ${countResult.rows[0].count}`);

    } else {
      console.log('❌ event_log table NOT found. Searching for similar tables...');
      
      // Search for tables with 'event', 'log', 'gps', 'location' in name
      const similarTables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND (table_name ILIKE '%event%' 
            OR table_name ILIKE '%log%' 
            OR table_name ILIKE '%gps%' 
            OR table_name ILIKE '%location%'
            OR table_name ILIKE '%vehicle%'
            OR table_name ILIKE '%track%')
        ORDER BY table_name
      `);
      
      if (similarTables.rows.length > 0) {
        console.log('Found similar tables:');
        for (const row of similarTables.rows) {
          console.log(`   - ${row.table_name}`);
          
          // Get columns for each
          const cols = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns 
            WHERE table_name = $1
            ORDER BY ordinal_position
          `, [row.table_name]);
          
          for (const col of cols.rows) {
            console.log(`       ${col.column_name}: ${col.data_type}`);
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ PostgreSQL Error:', error.message);
  } finally {
    await client.end();
  }
}

async function exploreSqlServer() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SQL SERVER DATABASE (192.168.21.33/ERP_Tracking)');
  console.log('='.repeat(60));

  try {
    console.log('🔄 Connecting to SQL Server...');
    await sql.connect(SQLSERVER_CONFIG);
    console.log('✅ Connected!\n');

    // Check VehiclesDetails_Table
    console.log('📝 Looking for VehiclesDetails_Table...');
    const vdtResult = await sql.query`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'VehiclesDetails_Table'
      ORDER BY ORDINAL_POSITION
    `;

    if (vdtResult.recordset.length > 0) {
      console.log('✅ VehiclesDetails_Table found!\n');
      console.log('Columns:');
      for (const col of vdtResult.recordset) {
        const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
        console.log(`   ${col.COLUMN_NAME.padEnd(30)} ${(col.DATA_TYPE + length).padEnd(20)} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
      }

      // Get sample data
      console.log('\n📄 Sample data (first 2 rows):');
      const sampleData = await sql.query`SELECT TOP 2 * FROM VehiclesDetails_Table`;
      if (sampleData.recordset.length > 0) {
        console.log(JSON.stringify(sampleData.recordset, null, 2));
      }

      // Get count
      const countResult = await sql.query`SELECT COUNT(*) as count FROM VehiclesDetails_Table`;
      console.log(`\n📊 Total rows: ${countResult.recordset[0].count}`);

    } else {
      console.log('❌ VehiclesDetails_Table NOT found. Searching for similar tables...');
      
      const similarTables = await sql.query`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND (TABLE_NAME LIKE '%Vehicle%' OR TABLE_NAME LIKE '%CRM%' OR TABLE_NAME LIKE '%Details%')
        ORDER BY TABLE_NAME
      `;
      
      if (similarTables.recordset.length > 0) {
        console.log('Found similar tables:');
        for (const row of similarTables.recordset) {
          console.log(`   - ${row.TABLE_NAME}`);
        }
      }
    }

    // Also check CRMVehiclesDetails_V view (used by Python)
    console.log('\n📝 Checking CRMVehiclesDetails_V view...');
    const viewResult = await sql.query`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'CRMVehiclesDetails_V'
      ORDER BY ORDINAL_POSITION
    `;
    
    if (viewResult.recordset.length > 0) {
      console.log('✅ CRMVehiclesDetails_V view found!\n');
      console.log('Columns:');
      for (const col of viewResult.recordset) {
        console.log(`   ${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE}`);
      }
    }

    // Check VEHICLES table
    console.log('\n📝 Checking VEHICLES table...');
    const vehiclesResult = await sql.query`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'VEHICLES'
      ORDER BY ORDINAL_POSITION
    `;
    
    if (vehiclesResult.recordset.length > 0) {
      console.log('✅ VEHICLES table found!\n');
      console.log('Key columns:');
      for (const col of vehiclesResult.recordset.slice(0, 15)) {
        console.log(`   ${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE}`);
      }
      if (vehiclesResult.recordset.length > 15) {
        console.log(`   ... and ${vehiclesResult.recordset.length - 15} more columns`);
      }
    }

  } catch (error) {
    console.error('❌ SQL Server Error:', error.message);
  } finally {
    await sql.close();
  }
}

async function main() {
  console.log('🔬 DATABASE SCHEMA EXPLORER');
  console.log('============================\n');
  console.log('This script will explore both databases to find:');
  console.log('1. PostgreSQL event_log table structure');
  console.log('2. SQL Server VehiclesDetails_Table structure');
  console.log('3. Common keys to link them together\n');

  await explorePostgres();
  await exploreSqlServer();

  console.log('\n' + '='.repeat(60));
  console.log('🏁 EXPLORATION COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
