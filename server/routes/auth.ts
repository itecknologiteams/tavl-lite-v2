import { Router } from 'express';
import { queryPostgres } from '../db/postgres';
import { queryCrm } from '../db/crm';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  console.log('🔐 Login attempt for:', username);
  
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password are required',
    });
  }
  
  try {
    // Prefer original CRM MSSQL over PG cache.
    // - Source: ERP_Tracking.dbo.USERS
    // - Cache:  Postgres crm_users (populated by cacheSync)
    //
    // You can force using cache only by setting AUTH_SOURCE=cache.
    const authSource = (process.env.AUTH_SOURCE || 'mssql').toLowerCase(); // 'mssql' | 'cache'

    const findUserFromMssql = async () => {
      const rows = await queryCrm(
        `
          SELECT TOP (1)
            u.U_ID as U_ID,
            u.U_NAME as U_NAME,
            u.EMPLOYEE_ID as EMPLOYEE_ID,
            u.PASS as PASS,
            u.IS_ACTIVE as IS_ACTIVE,
            u.HR_Dept_Id as HR_DEPT_ID,
            CASE
              WHEN u.EMPLOYEE_ID IN (SELECT DISTINCT HEAD_EMP_ID FROM USERS WHERE HEAD_EMP_ID IS NOT NULL) THEN 'supervisor'
              WHEN u.EMPLOYEE_ID IN (SELECT DISTINCT REPORTS_TO_EMP_ID FROM USERS WHERE REPORTS_TO_EMP_ID IS NOT NULL) THEN 'supervisor'
              ELSE 'operator'
            END AS ROLE_TYPE
          FROM USERS u WITH (NOLOCK)
          WHERE UPPER(u.U_NAME) = UPPER(@username)
          ORDER BY u.IS_ACTIVE DESC, u.U_ID DESC
        `,
        { username }
      );
      return rows?.[0] as any | undefined;
    };

    const findUserFromCache = async () => {
      const rows = await queryPostgres(
        `
          SELECT u_id as "U_ID", u_name as "U_NAME", employee_id as "EMPLOYEE_ID",
                 pass as "PASS", role_type as "ROLE_TYPE",
                 is_active as "IS_ACTIVE", hr_dept_id as "HR_DEPT_ID"
          FROM crm_users
          WHERE UPPER(u_name) = UPPER($1)
          ORDER BY is_active DESC, u_id DESC
          LIMIT 1
        `,
        [username]
      );
      return rows?.[0] as any | undefined;
    };

    let user: any | undefined;
    if (authSource !== 'cache') {
      try {
        user = await findUserFromMssql();
      } catch (e: any) {
        console.warn('⚠️ MSSQL auth lookup failed; falling back to cache:', e?.message || e);
      }
    }
    if (!user) {
      user = await findUserFromCache();
    }
    
    // Apply the same business rules regardless of source.
    // Existing logic requires: HR dept 3 + active.
    const isActive =
      user?.IS_ACTIVE === true ||
      user?.IS_ACTIVE === 1 ||
      String(user?.IS_ACTIVE).toLowerCase() === 'true';
    const hrDeptId = user?.HR_DEPT_ID != null ? Number(user.HR_DEPT_ID) : null;

    if (!user || !isActive || hrDeptId !== 3) {
      console.warn('⚠️ User not found / inactive / wrong dept:', username);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
      });
    }
    
    // Validate password (case-insensitive since DB stores uppercase)
    if (user.PASS?.toUpperCase() !== password?.toUpperCase()) {
      console.warn('⚠️ Invalid password for:', username);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
      });
    }
    
    console.log(`✅ Login successful for: ${username} (${user.ROLE_TYPE})`);
    
    // Return user data with role
    res.json({
      success: true,
      data: {
        id: String(user.EMPLOYEE_ID || user.U_ID),
        username: user.U_NAME,
        name: user.U_NAME,
        role: user.ROLE_TYPE, // 'supervisor' or 'operator'
      },
    });
    
  } catch (error: any) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Authentication service unavailable',
    });
  }
});

// GET /api/auth/me - Get current user info (for session validation)
router.get('/me', async (req, res) => {
  // For now, return unauthorized - frontend handles session via localStorage
  res.status(401).json({
    success: false,
    error: 'Not authenticated',
  });
});

export default router;
