import { Router } from 'express';
import { initCrmDatabase, queryCrm, getVehicleLogs, getVehicleLogSummary, LOG_TYPE_METADATA, VehicleLogType } from '../db/crm';

const router = Router();

// GET /api/crm/groups - Get all fleet groups with vehicle counts
router.get('/groups/list', async (_req, res) => {
  console.log('🏢 Fetching fleet groups...');
  
  try {
    // Get customer groups with vehicle counts from CRM MSSQL directly
    const result = await queryCrm(`
      SELECT CustomerName, COUNT(*) as VehicleCount
      FROM [ERP_Tracking].[dbo].[CRMVehiclesDetails_V] WITH (NOLOCK)
      WHERE CustomerName IS NOT NULL AND CustomerName != ''
      GROUP BY CustomerName
      ORDER BY VehicleCount DESC, CustomerName
    `);
    
    const totalResult = await queryCrm(`SELECT COUNT(*) as Total FROM [ERP_Tracking].[dbo].[CRMVehiclesDetails_V] WITH (NOLOCK)`);
    const total = parseInt(totalResult[0]?.Total) || 0;
    
    console.log(`✅ Found ${result.length} fleet groups, ${total} total vehicles`);
    
    res.json({
      success: true,
      data: {
        groups: (result || []).map((r: any) => ({
          name: r.CustomerName,
          count: r.VehicleCount,
        })),
        total,
      },
    });
  } catch (error: any) {
    console.error('❌ Fleet groups error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/crm/groups/:customerName/vehicles - Get vehicles for a specific customer
router.get('/groups/:customerName/vehicles', async (req, res) => {
  const customerName = req.params.customerName;
  console.log('🏢 Fetching vehicles for:', customerName);
  
  try {
    const result = await queryCrm(`
      SELECT
        OBJECTID,
        Vehicle_RegistrationNo,
        Vehicle_Make,
        Vehicle_Model,
        Vehicle_Color,
        CustomerName,
        CellNo
      FROM [ERP_Tracking].[dbo].[CRMVehiclesDetails_V] WITH (NOLOCK)
      WHERE CustomerName = @customerName
      ORDER BY Vehicle_RegistrationNo
    `, { customerName });
    
    console.log(`✅ Found ${result.length} vehicles for ${customerName}`);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('❌ Fleet vehicles error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/crm/:identifier
router.get('/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  
  console.log('🔍 CRM lookup for:', identifier);
  
  try {
    const isBlank = (v: any) => {
      if (v === null || v === undefined) return true;
      const s = String(v).trim();
      if (!s) return true;
      return s === '-' || /^n\.?a\.?$/i.test(s) || /^null$/i.test(s) || /^undefined$/i.test(s);
    };

    // Query MSSQL CRM directly (no PG cache) — CRMVehiclesDetails_V + SECURITYS + CUSTOMER + BANK + VEHICLES
    const ident = String(identifier);
    const rows = await queryCrm(
      `
        SELECT TOP (1)
          A.Vehicle_Make,
          A.Vehicle_Model,
          A.Vehicle_Year,
          A.Vehicle_Color,
          A.Vehicle_Transmission,
          A.Vehicle_EngineNo,
          A.Vehicle_ChasisNo,
          A.Vehicle_RegistrationNo,
          A.Vehicle_SIM,
          A.Vehicle_DateOfInstallation,
          A.Vehicle_Device,
          A.Vehicle_DeviceSerial,
          A.InsuredBy,
          A.[Product Segment] as ProductSegment,
          C.FNAME as CustomerName,
          C.CONT1 as CellNo,
          C.CONT2 as TelephoneNo,
          C.CONT3 as AlternateContact,
          C.CNIC as NIC,
          B.SECONDARY_CONTACT as SecondaryContact,
          B.SEC_CONTACT_2 as SecondaryContact2,
          B.EMR_CONT_PER as EmergencyContactPerson,
          B.EMR_CONT_NO as EmergencyContactNumber,
          B.EMR_CONTACT_2 as EmergencyContactNumber2,
          B.MOTHER_NAME as MotherName,
          B.DOB as DateOfBirth,
          C.ADRESS as Address1,
          C.EMAIL as Email,
          D.B_NAME as LeasedBy,
          B.PASS as VerificationPassword,
          B.EMR_PASS as EmergencyPassword,
          B.SEC_QUE as SecurityQuestion,
          B.SEC_ANS as SecurityAnswer,
          B.SPECIAL_INSRUCT as SpecialInstructions,
          B.SECONDARY_USER as SecondaryUser,
          A.CustomerId,
          B.VEH_ID as Vehicle_Id,
          E.IMMOBILIZER as Immobilizer,
          A.OBJECTID as OBJECTID
        FROM [ERP_Tracking].[dbo].[CRMVehiclesDetails_V] as A WITH (NOLOCK)
        LEFT JOIN [ERP_Tracking].[dbo].SECURITYS as B WITH (NOLOCK) ON A.Vehicle_Id = B.VEH_ID
        LEFT JOIN [ERP_Tracking].[dbo].CUSTOMER as C WITH (NOLOCK) ON A.CustomerId = C.CUST_ID
        LEFT JOIN [ERP_Tracking].[dbo].BANK as D WITH (NOLOCK) ON A.Vehicle_Leased_CompanyId = D.B_ID
        LEFT JOIN [ERP_Tracking].[dbo].VEHICLES as E WITH (NOLOCK) ON B.VEH_ID = E.V_ID
        WHERE A.Vehicle_RegistrationNo = @ident
           OR A.OBJECTID = @ident
           OR CAST(A.Vehicle_Id AS NVARCHAR) = @ident
        ORDER BY
          CASE
            WHEN A.Vehicle_RegistrationNo = @ident THEN 0
            WHEN CAST(A.OBJECTID AS NVARCHAR(50)) = @ident THEN 1
            WHEN CAST(A.Vehicle_Id AS NVARCHAR(50)) = @ident THEN 2
            ELSE 3
          END,
          A.Vehicle_RegistrationNo
      `,
      { ident }
    );

    const data = rows?.[0] as any | undefined;

    if (data) {
      // Safety net: VEH_CONFIG.DOC (often the DOI)
      if (!data.Vehicle_DateOfInstallation) {
        try {
          const docRows = await queryCrm(
            `
              SELECT TOP (1) vc.DOC as DOI
              FROM [ERP_Tracking].[dbo].VEHICLES v WITH (NOLOCK)
              LEFT JOIN [ERP_Tracking].[dbo].VEH_CONFIG vc WITH (NOLOCK) ON v.V_ID = vc.V_ID
              WHERE v.VEH_REG = @ident
                 OR v.OBJECTID = @ident
                 OR CAST(v.V_ID AS NVARCHAR) = @ident
              ORDER BY vc.DOC DESC
            `,
            { ident }
          );
          const doi = (docRows?.[0] as any)?.DOI;
          if (doi) data.Vehicle_DateOfInstallation = doi;
        } catch {
          // non-critical
        }
      }

      console.log('✅ Found vehicle in CRM:', data.Vehicle_RegistrationNo || data.CustomerName);
      res.json({ success: true, data });
    } else {
      console.log('ℹ️ Vehicle not found in CRM');
      res.json({ success: true, data: null });
    }
    
  } catch (error: any) {
    console.error('❌ CRM error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// Vehicle Logs Routes
// ============================================

// GET /api/crm/logs/types - Get available log types with metadata
router.get('/logs/types', (_req, res) => {
  const types = Object.entries(LOG_TYPE_METADATA).map(([key, meta]) => ({
    type: key,
    ...meta,
  }));
  
  res.json({ success: true, data: types });
});

// GET /api/crm/logs/:vehicleId/summary - Get log counts for a vehicle
router.get('/logs/:vehicleId/summary', async (req, res) => {
  const vehicleId = parseInt(req.params.vehicleId);
  
  if (isNaN(vehicleId)) {
    return res.status(400).json({ success: false, error: 'Invalid vehicle ID' });
  }
  
  console.log(`📋 Fetching log summary for vehicle ${vehicleId}`);
  
  try {
    await initCrmDatabase();
    const summary = await getVehicleLogSummary(vehicleId);
    
    // Map log types to metadata
    const enrichedSummary = summary.map(s => {
      // Map database LOG_TYPE to our VehicleLogType
      const typeMap: Record<string, VehicleLogType> = {
        'EVENTS': 'Events',
        'SMS TAB': 'SMS_TAB',
        'N.R': 'NOT_REPORTING',
        'PRE INFORMATION': 'PRE_INFORMATION',
        'LOCATION ON CALL': 'LOCATION_ON_CALL',
        'COMPLAIN': 'COMPLAIN',
        'REMOVAL': 'Removal',
        'REDO INFORMATION': 'REDO_INFORMATION',
        'REDO COMPLETE': 'REDO_INFORMATION', // Group with REDO_INFORMATION
        'CUSTOMER FEEDBACK': 'CUSTOMER_FEEDBACK',
        'CODE RED': 'CODE_RED',
        'CODE RED RECOVERY': 'CODE_RED', // Group with CODE_RED
        'FOLLOW UP': 'general_logs',
      };
      
      const mappedType = typeMap[s.logType] || s.logType;
      const meta = LOG_TYPE_METADATA[mappedType as VehicleLogType];
      
      return {
        logType: mappedType,
        originalType: s.logType,
        count: s.count,
        label: meta?.label || s.logType,
        icon: meta?.icon || 'FileText',
        category: meta?.category || 'Other',
      };
    });
    
    // Group counts by mapped type
    const grouped = enrichedSummary.reduce((acc, item) => {
      const existing = acc.find(a => a.logType === item.logType);
      if (existing) {
        existing.count += item.count;
      } else {
        acc.push({ ...item });
      }
      return acc;
    }, [] as typeof enrichedSummary);
    
    console.log(`✅ Found ${grouped.length} log types for vehicle ${vehicleId}`);
    res.json({ success: true, data: grouped });
  } catch (error: any) {
    console.error(`❌ Log summary error:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/crm/logs/:vehicleId/:logType - Get logs for a vehicle by type
router.get('/logs/:vehicleId/:logType', async (req, res) => {
  const vehicleId = parseInt(req.params.vehicleId);
  const logType = req.params.logType as VehicleLogType;
  
  if (isNaN(vehicleId)) {
    return res.status(400).json({ success: false, error: 'Invalid vehicle ID' });
  }
  
  // Validate log type
  if (!LOG_TYPE_METADATA[logType]) {
    return res.status(400).json({ success: false, error: 'Invalid log type' });
  }
  
  console.log(`📋 Fetching ${logType} logs for vehicle ${vehicleId}`);
  
  try {
    await initCrmDatabase();
    const logs = await getVehicleLogs(vehicleId, logType);
    
    console.log(`✅ Found ${logs.length} ${logType} records`);
    res.json({ 
      success: true, 
      data: logs,
      meta: LOG_TYPE_METADATA[logType],
    });
  } catch (error: any) {
    console.error(`❌ Logs error (${logType}):`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
