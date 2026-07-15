/**
 * Cache Sync Service
 * Syncs read-heavy MSSQL tables into PostgreSQL cache tables.
 * Eliminates ~35 cross-network MSSQL queries by serving them from local PG.
 *
 * Tables synced:
 *   Phase 1 (TAVL MSSQL): tavl_objects, tavl_devices, tavl_logins
 *   Phase 2 (CRM MSSQL):  crm_customers, crm_vehicles, crm_installations,
 *                          crm_security, crm_users, crm_vehicle_details
 */

import { initPostgres, queryPostgres } from './postgres';
import { queryTavl } from './tavl';
import { queryCrm } from './crm';

let syncIntervals: NodeJS.Timeout[] = [];

// ================================================================
// TABLE CREATION
// ================================================================

export async function initCacheTables(): Promise<void> {
  await initPostgres();

  // One-time migration: drop tables with old VARCHAR schema so they're recreated with TEXT
  const migrationCheck = await queryPostgres(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'crm_vehicles' AND column_name = 'object_id'
  `);
  if (migrationCheck.length > 0 && migrationCheck[0].data_type !== 'text') {
    console.log('🔄 Migrating cache tables to TEXT schema...');
    for (const t of ['tavl_objects','tavl_devices','tavl_logins','crm_vehicles','crm_installations','crm_security','crm_users','crm_vehicle_details']) {
      await queryPostgres(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  }

  // Phase 1 tables
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS tavl_objects (
      object_id   INT PRIMARY KEY,
      plate_number TEXT,
      description  TEXT,
      imei         TEXT,
      enabled      BOOLEAN DEFAULT TRUE,
      synced_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS tavl_devices (
      object_id    INT PRIMARY KEY,
      plate_number TEXT,
      description  TEXT,
      imei         TEXT,
      module_id    INT,
      module_type  TEXT,
      sim_number   TEXT,
      identifier   TEXT,
      password     TEXT,
      synced_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS tavl_logins (
      login_id  INT PRIMARY KEY,
      username  TEXT,
      name      TEXT,
      synced_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Phase 2 tables
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS crm_customers (
      cust_id        INT PRIMARY KEY,
      fname          TEXT,
      address        TEXT,
      office_address TEXT,
      cont1          TEXT,
      cont2          TEXT,
      email          TEXT,
      nic            TEXT,
      synced_at      TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS crm_vehicles (
      v_id          INT PRIMARY KEY,
      object_id     TEXT,
      object_id_int INT,
      veh_reg       TEXT,
      engine_no     TEXT,
      chassis_no    TEXT,
      make          TEXT,
      model         TEXT,
      year          TEXT,
      color         TEXT,
      transmission  TEXT,
      corp_name     TEXT,
      agrn          TEXT,
      synced_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS crm_installations (
      v_id       INT PRIMARY KEY,
      cust_id    INT,
      synced_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS crm_security (
      veh_id           INT PRIMARY KEY,
      pass             TEXT,
      emr_pass         TEXT,
      sec_que          TEXT,
      sec_ans          TEXT,
      emr_cont_per     TEXT,
      emr_cont_no      TEXT,
      mother_name      TEXT,
      dob              TEXT,
      special_instruct TEXT,
      synced_at        TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS crm_users (
      u_id         INT PRIMARY KEY,
      u_name       TEXT,
      employee_id  INT,
      pass         TEXT,
      role_type    TEXT,
      is_active    BOOLEAN DEFAULT TRUE,
      hr_dept_id   INT,
      synced_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS crm_vehicle_details (
      vehicle_id          INT,
      customer_id         INT,
      customer_name       TEXT,
      cell_no             TEXT,
      telephone_no        TEXT,
      address1            TEXT,
      address2            TEXT,
      nic                 TEXT,
      vehicle_make        TEXT,
      vehicle_model       TEXT,
      vehicle_year        TEXT,
      vehicle_color       TEXT,
      vehicle_cc          TEXT,
      vehicle_transmission TEXT,
      vehicle_engine_no   TEXT,
      vehicle_chassis_no  TEXT,
      vehicle_reg_no      TEXT,
      vehicle_is_leased   TEXT,
      vehicle_lessee      TEXT,
      vehicle_is_insured  TEXT,
      insured_by          TEXT,
      vehicle_device_serial TEXT,
      vehicle_sim         TEXT,
      vehicle_imei_no     TEXT,
      vehicle_inst_date   TIMESTAMP,
      vehicle_inst_location TEXT,
      vehicle_technician  TEXT,
      product_segment     TEXT,
      fleet_type          TEXT,
      branch_name         TEXT,
      object_id           TEXT,
      special_instructions TEXT,
      synced_at           TIMESTAMP DEFAULT NOW()
    )
  `);

  // Indexes for fast lookups
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_tavl_objects_plate ON tavl_objects(plate_number)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_tavl_objects_imei ON tavl_objects(imei)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_customers_cont1 ON crm_customers(cont1)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_customers_cont2 ON crm_customers(cont2)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_vehicles_object_id ON crm_vehicles(object_id)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_vehicles_veh_reg ON crm_vehicles(veh_reg)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_vehicles_object_id_int ON crm_vehicles(object_id_int)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_installations_cust_id ON crm_installations(cust_id)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_vehicle_details_object_id ON crm_vehicle_details(object_id)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_vehicle_details_reg ON crm_vehicle_details(vehicle_reg_no)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_vehicle_details_customer ON crm_vehicle_details(customer_name)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_crm_users_uname ON crm_users(u_name)`);

  console.log('✅ Cache tables initialized');
}

// ================================================================
// SYNC FUNCTIONS
// ================================================================

async function syncTavlObjects(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryTavl(`
      SELECT ObjectId, Number as PlateNumber, Comment as Description,
             ObjectCode as IMEI, Enabled
      FROM [tavl2].[tavl].[Object] WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM tavl_objects`);

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 5;
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.ObjectId, r.PlateNumber || null, r.Description || null,
        r.IMEI || null, r.Enabled !== false && r.Enabled !== 0,
      ]);
      await queryPostgres(
        `INSERT INTO tavl_objects (object_id, plate_number, description, imei, enabled) VALUES ${values}
         ON CONFLICT (object_id) DO UPDATE SET plate_number=EXCLUDED.plate_number, description=EXCLUDED.description,
         imei=EXCLUDED.imei, enabled=EXCLUDED.enabled, synced_at=NOW()`,
        params
      );
    }
    console.log(`  tavl_objects: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  tavl_objects sync failed:', e.message);
    return 0;
  }
}

async function syncTavlDevices(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryTavl(`
      SELECT O.ObjectId, O.Number as PlateNumber, O.Comment as Description,
             M.Imei, M.ModuleId, MT.Name as ModuleType,
             SC.GsmNumber as SimNumber, M.Identifier, M.Password
      FROM [tavl2].[tavl].[Object] O WITH (NOLOCK)
      LEFT JOIN [tavl2].[tavl].[ModuleObject] MO ON O.ObjectId = MO.ObjectId
      LEFT JOIN [tavl2].[tavl].[Module] M ON MO.ModuleId = M.ModuleId
      LEFT JOIN [tavl2].[tavl].[ModuleType] MT ON M.ModuleTypeId = MT.ModuleTypeId
      LEFT JOIN [tavl2].[tavl].[SimCardModule] SCM ON M.ModuleId = SCM.ModuleId
      LEFT JOIN [tavl2].[tavl].[SimCard] SC ON SCM.SimCardId = SC.SimCardId
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM tavl_devices`);

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 9;
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8},$${off+9})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.ObjectId, r.PlateNumber || null, r.Description || null,
        r.Imei || null, r.ModuleId || null, r.ModuleType || null,
        r.SimNumber || null, r.Identifier || null, r.Password || null,
      ]);
      await queryPostgres(
        `INSERT INTO tavl_devices (object_id, plate_number, description, imei, module_id, module_type, sim_number, identifier, password)
         VALUES ${values}
         ON CONFLICT (object_id) DO UPDATE SET plate_number=EXCLUDED.plate_number, description=EXCLUDED.description,
         imei=EXCLUDED.imei, module_id=EXCLUDED.module_id, module_type=EXCLUDED.module_type,
         sim_number=EXCLUDED.sim_number, identifier=EXCLUDED.identifier, password=EXCLUDED.password, synced_at=NOW()`,
        params
      );
    }
    console.log(`  tavl_devices: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  tavl_devices sync failed:', e.message);
    return 0;
  }
}

async function syncTavlLogins(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryTavl(`
      SELECT LoginId, [User] as Username, Comment as Name
      FROM [tavl2].[tavl].[Login] WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM tavl_logins`);
    const values = rows.map((_, idx) => {
      const off = idx * 3;
      return `($${off+1},$${off+2},$${off+3})`;
    }).join(',');
    const params = rows.flatMap((r: any) => [r.LoginId, r.Username || null, r.Name || null]);
    await queryPostgres(
      `INSERT INTO tavl_logins (login_id, username, name) VALUES ${values}
       ON CONFLICT (login_id) DO UPDATE SET username=EXCLUDED.username, name=EXCLUDED.name, synced_at=NOW()`,
      params
    );
    console.log(`  tavl_logins: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  tavl_logins sync failed:', e.message);
    return 0;
  }
}

async function syncCrmCustomers(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryCrm(`
      SELECT CUST_ID, FNAME, ADRESS, OFFICE_ADDRESS, CONT1, CONT2,
             EMAIL, CNIC
      FROM CUSTOMER WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM crm_customers`);
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 8;
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.CUST_ID, r.FNAME||null, r.ADRESS||null, r.OFFICE_ADDRESS||null,
        r.CONT1||null, r.CONT2||null, r.EMAIL||null, r.CNIC||null,
      ]);
      await queryPostgres(
        `INSERT INTO crm_customers (cust_id, fname, address, office_address, cont1, cont2, email, nic)
         VALUES ${values}
         ON CONFLICT (cust_id) DO UPDATE SET fname=EXCLUDED.fname, address=EXCLUDED.address,
         office_address=EXCLUDED.office_address, cont1=EXCLUDED.cont1, cont2=EXCLUDED.cont2,
         email=EXCLUDED.email, nic=EXCLUDED.nic, synced_at=NOW()`,
        params
      );
    }
    console.log(`  crm_customers: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  crm_customers sync failed:', e.message);
    return 0;
  }
}

async function syncCrmVehicles(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryCrm(`
      SELECT v.V_ID, v.OBJECTID as ObjectId, v.OBJECTIDINT as ObjectIdInt,
             v.VEH_REG, v.ENGINE as EngineNo, v.CHASIS as ChassisNo,
             mk.MK_NAME as Make, m.M_NAME as Model,
             y.Y_NAME as Year, cl.CL_NAME as Color,
             v.TRANSMISSION, corp.CORP_NAME, v.AGRN
      FROM VEHICLES v WITH (NOLOCK)
      LEFT JOIN MAKE mk ON v.MK_ID = mk.MK_ID
      LEFT JOIN MODEL m ON v.M_ID = m.M_ID
      LEFT JOIN YEARS y ON v.Y_ID = y.Y_ID
      LEFT JOIN COLOR cl ON v.CL_ID = cl.CL_ID
      LEFT JOIN CORPORATES corp ON v.CORP_ID = corp.CORP_ID
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM crm_vehicles`);
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 13;
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8},$${off+9},$${off+10},$${off+11},$${off+12},$${off+13})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.V_ID, r.ObjectId||null, r.ObjectIdInt||null, r.VEH_REG||null,
        r.EngineNo||null, r.ChassisNo||null, r.Make||null, r.Model||null,
        r.Year||null, r.Color||null, r.TRANSMISSION||null, r.CORP_NAME||null, r.AGRN||null,
      ]);
      await queryPostgres(
        `INSERT INTO crm_vehicles (v_id, object_id, object_id_int, veh_reg, engine_no, chassis_no, make, model, year, color, transmission, corp_name, agrn)
         VALUES ${values}
         ON CONFLICT (v_id) DO UPDATE SET object_id=EXCLUDED.object_id, object_id_int=EXCLUDED.object_id_int,
         veh_reg=EXCLUDED.veh_reg, engine_no=EXCLUDED.engine_no, chassis_no=EXCLUDED.chassis_no,
         make=EXCLUDED.make, model=EXCLUDED.model, year=EXCLUDED.year, color=EXCLUDED.color,
         transmission=EXCLUDED.transmission, corp_name=EXCLUDED.corp_name, agrn=EXCLUDED.agrn, synced_at=NOW()`,
        params
      );
    }
    console.log(`  crm_vehicles: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  crm_vehicles sync failed:', e.message);
    return 0;
  }
}

async function syncCrmInstallations(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryCrm(`
      SELECT V_ID, CUST_ID
      FROM INSTALLATION WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM crm_installations`);
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 2;
        return `($${off+1},$${off+2})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.V_ID, r.CUST_ID||null,
      ]);
      await queryPostgres(
        `INSERT INTO crm_installations (v_id, cust_id)
         VALUES ${values}
         ON CONFLICT (v_id) DO UPDATE SET cust_id=EXCLUDED.cust_id, synced_at=NOW()`,
        params
      );
    }
    console.log(`  crm_installations: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  crm_installations sync failed:', e.message);
    return 0;
  }
}

async function syncCrmSecurity(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryCrm(`
      SELECT VEH_ID, PASS, EMR_PASS, SEC_QUE, SEC_ANS,
             EMR_CONT_PER, EMR_CONT_NO, MOTHER_NAME, DOB, SPECIAL_INSRUCT
      FROM SECURITYS WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM crm_security`);
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 10;
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8},$${off+9},$${off+10})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.VEH_ID, r.PASS||null, r.EMR_PASS||null, r.SEC_QUE||null, r.SEC_ANS||null,
        r.EMR_CONT_PER||null, r.EMR_CONT_NO||null, r.MOTHER_NAME||null,
        r.DOB ? String(r.DOB) : null, r.SPECIAL_INSRUCT||null,
      ]);
      await queryPostgres(
        `INSERT INTO crm_security (veh_id, pass, emr_pass, sec_que, sec_ans, emr_cont_per, emr_cont_no, mother_name, dob, special_instruct)
         VALUES ${values}
         ON CONFLICT (veh_id) DO UPDATE SET pass=EXCLUDED.pass, emr_pass=EXCLUDED.emr_pass,
         sec_que=EXCLUDED.sec_que, sec_ans=EXCLUDED.sec_ans, emr_cont_per=EXCLUDED.emr_cont_per,
         emr_cont_no=EXCLUDED.emr_cont_no, mother_name=EXCLUDED.mother_name, dob=EXCLUDED.dob,
         special_instruct=EXCLUDED.special_instruct, synced_at=NOW()`,
        params
      );
    }
    console.log(`  crm_security: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  crm_security sync failed:', e.message);
    return 0;
  }
}

async function syncCrmUsers(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryCrm(`
      SELECT u.U_ID, u.U_NAME, u.EMPLOYEE_ID, u.PASS, u.IS_ACTIVE, u.HR_Dept_Id,
        CASE
          WHEN u.EMPLOYEE_ID IN (SELECT DISTINCT HEAD_EMP_ID FROM USERS WHERE HEAD_EMP_ID IS NOT NULL) THEN 'supervisor'
          WHEN u.EMPLOYEE_ID IN (SELECT DISTINCT REPORTS_TO_EMP_ID FROM USERS WHERE REPORTS_TO_EMP_ID IS NOT NULL) THEN 'supervisor'
          ELSE 'operator'
        END AS ROLE_TYPE
      FROM USERS u WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM crm_users`);
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 7;
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.U_ID, r.U_NAME||null, r.EMPLOYEE_ID||null, r.PASS||null,
        r.ROLE_TYPE||'operator', r.IS_ACTIVE===1||r.IS_ACTIVE===true, r.HR_Dept_Id||null,
      ]);
      await queryPostgres(
        `INSERT INTO crm_users (u_id, u_name, employee_id, pass, role_type, is_active, hr_dept_id)
         VALUES ${values}
         ON CONFLICT (u_id) DO UPDATE SET u_name=EXCLUDED.u_name, employee_id=EXCLUDED.employee_id,
         pass=EXCLUDED.pass, role_type=EXCLUDED.role_type, is_active=EXCLUDED.is_active,
         hr_dept_id=EXCLUDED.hr_dept_id, synced_at=NOW()`,
        params
      );
    }
    console.log(`  crm_users: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  crm_users sync failed:', e.message);
    return 0;
  }
}

async function syncCrmVehicleDetails(): Promise<number> {
  const t0 = Date.now();
  try {
    const rows = await queryCrm(`
      SELECT Vehicle_Id, CustomerId, CustomerName, CellNo, TelephoneNo,
             Address1, Address2, NIC, Vehicle_Make, Vehicle_Model,
             Vehicle_Year, Vehicle_Color, Vehicle_CC, Vehicle_Transmission,
             Vehicle_EngineNo, Vehicle_ChasisNo, Vehicle_RegistrationNo,
             Vehicle_IsLeased, Vehicle_Lessee, Vehicle_IsInsured, InsuredBy,
             Vehicle_DeviceSerial, Vehicle_SIM, Vehicle_IMEINo,
             Vehicle_DateOfInstallation, Vehicle_Installation_location,
             Vehicle_Technician, [Product Segment] as ProductSegment,
             FLEET_TYPE, BRANCH_NAME, OBJECTID,
             Vehicle_TrackingSpecialInstructions
      FROM [VehiclesDetails_Table] WITH (NOLOCK)
    `);
    if (!rows || rows.length === 0) return 0;

    await queryPostgres(`DELETE FROM crm_vehicle_details`);
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, idx) => {
        const off = idx * 32;
        return `(${Array.from({length:32},(_,k)=>`$${off+k+1}`).join(',')})`;
      }).join(',');
      const params = batch.flatMap((r: any) => [
        r.Vehicle_Id||null, r.CustomerId||null, r.CustomerName||null,
        r.CellNo||null, r.TelephoneNo||null, r.Address1||null, r.Address2||null,
        r.NIC||null, r.Vehicle_Make||null, r.Vehicle_Model||null,
        r.Vehicle_Year||null, r.Vehicle_Color||null, r.Vehicle_CC||null,
        r.Vehicle_Transmission||null, r.Vehicle_EngineNo||null, r.Vehicle_ChasisNo||null,
        r.Vehicle_RegistrationNo||null, r.Vehicle_IsLeased||null, r.Vehicle_Lessee||null,
        r.Vehicle_IsInsured||null, r.InsuredBy||null, r.Vehicle_DeviceSerial||null,
        r.Vehicle_SIM||null, r.Vehicle_IMEINo||null, r.Vehicle_DateOfInstallation||null,
        r.Vehicle_Installation_location||null, r.Vehicle_Technician||null,
        r.ProductSegment||null, r.FLEET_TYPE||null, r.BRANCH_NAME||null,
        r.OBJECTID ? String(r.OBJECTID) : null,
        r.Vehicle_TrackingSpecialInstructions||null,
      ]);
      await queryPostgres(
        `INSERT INTO crm_vehicle_details (
          vehicle_id, customer_id, customer_name, cell_no, telephone_no,
          address1, address2, nic, vehicle_make, vehicle_model,
          vehicle_year, vehicle_color, vehicle_cc, vehicle_transmission,
          vehicle_engine_no, vehicle_chassis_no, vehicle_reg_no,
          vehicle_is_leased, vehicle_lessee, vehicle_is_insured, insured_by,
          vehicle_device_serial, vehicle_sim, vehicle_imei_no,
          vehicle_inst_date, vehicle_inst_location, vehicle_technician,
          product_segment, fleet_type, branch_name, object_id,
          special_instructions
        ) VALUES ${values}`,
        params
      );
    }
    console.log(`  crm_vehicle_details: ${rows.length} rows (${Date.now()-t0}ms)`);
    return rows.length;
  } catch (e: any) {
    console.error('  crm_vehicle_details sync failed:', e.message);
    return 0;
  }
}

// ================================================================
// ORCHESTRATION
// ================================================================

export async function runFullSync(): Promise<void> {
  const t0 = Date.now();
  console.log('🔄 Running full cache sync...');

  // Phase 1 - TAVL
  await Promise.all([
    syncTavlObjects(),
    syncTavlDevices(),
    syncTavlLogins(),
  ]);

  // Phase 2 - CRM (run in parallel batches to limit MSSQL load)
  await Promise.all([
    syncCrmCustomers(),
    syncCrmVehicles(),
    syncCrmInstallations(),
  ]);
  await Promise.all([
    syncCrmSecurity(),
    syncCrmUsers(),
    syncCrmVehicleDetails(),
  ]);

  console.log(`✅ Full cache sync complete (${Date.now()-t0}ms)`);
}

export function startSyncScheduler(): void {
  // Phase 1: TAVL tables - every 10 minutes
  syncIntervals.push(setInterval(async () => {
    try {
      await Promise.all([syncTavlObjects(), syncTavlDevices()]);
    } catch (e: any) {
      console.error('TAVL sync error:', e.message);
    }
  }, 600_000));

  // TAVL logins - every 30 minutes
  syncIntervals.push(setInterval(async () => {
    try { await syncTavlLogins(); } catch (e: any) { console.error('Login sync error:', e.message); }
  }, 1_800_000));

  // Phase 2: CRM tables - every 15 minutes
  syncIntervals.push(setInterval(async () => {
    try {
      await Promise.all([syncCrmCustomers(), syncCrmVehicles(), syncCrmInstallations()]);
      await Promise.all([syncCrmSecurity(), syncCrmUsers(), syncCrmVehicleDetails()]);
    } catch (e: any) {
      console.error('CRM sync error:', e.message);
    }
  }, 900_000));

  console.log('📅 Cache sync scheduler started (TAVL: 10min, Logins: 30min, CRM: 15min)');
}

export function stopSyncScheduler(): void {
  syncIntervals.forEach(clearInterval);
  syncIntervals = [];
}
