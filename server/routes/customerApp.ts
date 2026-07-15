/**
 * Customer App Info & Notification History API
 * Provides data from MobileApp database (AppLogin, Notifications)
 */
import { Router } from 'express';
import { initMobileAppDatabase, queryMobileApp } from '../db/mobileApp';

const router = Router();

// In-memory TTL cache (60 seconds)
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60_000;

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }
}

let dbInitialized = false;
const ensureDb = async () => {
  if (!dbInitialized) {
    await initMobileAppDatabase();
    dbInitialized = true;
  }
};

/**
 * Normalize any Pakistani phone number to last 10 digits.
 * Handles: 03001234567 → 3001234567
 *          923001234567 → 3001234567
 *          +923001234567 → 3001234567
 */
function normalizeTo10(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Strip country code 92
  if (digits.startsWith('92') && digits.length >= 12) return digits.slice(2);
  // Strip leading 0
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
}

/**
 * GET /api/customer-app/:contactNumber/info
 * Get customer's iTeck app usage information.
 *
 * Single-query approach: AppLogin + Notifications stats in one OUTER APPLY.
 * Phone matching: compares last 10 digits so format differences don't matter.
 */
router.get('/:contactNumber/info', async (req, res) => {
  const { contactNumber } = req.params;

  if (!contactNumber || contactNumber.replace(/\D/g, '').length < 9) {
    return res.status(400).json({
      success: false,
      error: 'Valid contact number is required',
    });
  }

  try {
    const last10 = normalizeTo10(contactNumber);
    const cacheKey = `app:info:${last10}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    await ensureDb();

    // Single query: AppLogin + Notification stats via OUTER APPLY (one round-trip)
    // Phone matching: RIGHT(Contact, 10) handles 03xx, 923xx, plain 3xx formats
    const rows = await queryMobileApp(`
      SELECT TOP 10
        al.LoginId,
        al.DeviceId,
        al.Email,
        al.Contact,
        al.LastLogin,
        al.IsActive,
        al.FcmToken,
        al.CreationTime,
        al.DeviceTypeId,
        al.AppVersion,
        RTRIM(al.OSVersion) AS OSVersion,
        RTRIM(al.Brand)     AS Brand,
        RTRIM(al.Model)     AS Model,
        ns.totalSent,
        ns.totalReceived
      FROM AppLogin al WITH (NOLOCK)
      OUTER APPLY (
        SELECT
          COUNT(*)                                                          AS totalSent,
          SUM(CASE WHEN n.RecvDate IS NOT NULL THEN 1 ELSE 0 END)          AS totalReceived
        FROM Notifications n WITH (NOLOCK)
        WHERE n.AppLoginId = al.LoginId
          AND n.SentDate >= DATEADD(day, -30, GETDATE())
      ) ns
      WHERE al.IsDeleted = 0
        AND RIGHT(REPLACE(REPLACE(al.Contact, '+', ''), ' ', ''), 10) = @last10
      ORDER BY al.LastLogin DESC
    `, { last10 });

    if (!rows || rows.length === 0) {
      const notFound = {
        success: true,
        data: null,
        message: 'No iTeck app found for this customer',
      };
      setCache(cacheKey, notFound);
      return res.json(notFound);
    }

    const primary = rows[0];

    const response = {
      success: true,
      data: {
        appVersion: primary.AppVersion || 'Unknown',
        lastLogin: primary.LastLogin,
        device: {
          brand: primary.Brand?.trim() || 'Unknown',
          model: primary.Model?.trim() || 'Unknown',
          osVersion: primary.OSVersion?.trim() || 'Unknown',
          platform: primary.DeviceTypeId === 1 ? 'Android' : 'iOS',
        },
        pushEnabled: !!primary.FcmToken,
        email: primary.Email,
        isActive: primary.IsActive === 1 || primary.IsActive === true,
        createdAt: primary.CreationTime,
        stats: {
          totalDevices: rows.length,
          notificationsSent30d: primary.totalSent || 0,
          notificationsReceived30d: primary.totalReceived || 0,
          notificationsUnread30d: (primary.totalSent || 0) - (primary.totalReceived || 0),
        },
        allDevices: rows.map((login: any) => ({
          loginId: login.LoginId,
          brand: login.Brand?.trim(),
          model: login.Model?.trim(),
          appVersion: login.AppVersion,
          lastLogin: login.LastLogin,
          isActive: login.IsActive === 1 || login.IsActive === true,
        })),
      },
    };

    setCache(cacheKey, response);
    res.json(response);

  } catch (error: any) {
    console.error('Error fetching customer app info:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/customer-app/:contactNumber/notifications
 * Get customer's notification history — single query with JOIN.
 */
router.get('/:contactNumber/notifications', async (req, res) => {
  const { contactNumber } = req.params;
  const { days = 7, vehicleReg, limit = 50 } = req.query;

  if (!contactNumber || contactNumber.replace(/\D/g, '').length < 9) {
    return res.status(400).json({
      success: false,
      error: 'Valid contact number is required',
    });
  }

  try {
    const last10 = normalizeTo10(contactNumber);
    const cacheKey = `app:notif:${last10}:${days}:${vehicleReg || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    await ensureDb();

    // Single query — join AppLogin → Notifications directly
    const vehicleFilter = vehicleReg ? 'AND RTRIM(n.VehicleRegistration) LIKE @vehicleReg' : '';

    const notifications = await queryMobileApp(`
      SELECT TOP (@limit)
        n.NotificationId,
        RTRIM(n.NotificationTitle)     AS Title,
        n.NotificationText             AS Message,
        n.SentDate,
        n.RecvDate,
        RTRIM(n.VehicleRegistration)   AS VehicleRegistration,
        n.NotificationTypeId,
        nt.NotificationTypeName        AS TypeName
      FROM AppLogin al WITH (NOLOCK)
      INNER JOIN Notifications n WITH (NOLOCK) ON n.AppLoginId = al.LoginId
      LEFT JOIN  NotificationTypes nt WITH (NOLOCK) ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE al.IsDeleted = 0
        AND RIGHT(REPLACE(REPLACE(al.Contact, '+', ''), ' ', ''), 10) = @last10
        AND n.SentDate >= DATEADD(day, -@days, GETDATE())
        ${vehicleFilter}
      ORDER BY n.SentDate DESC
    `, {
      last10,
      days: parseInt(days as string),
      limit: parseInt(limit as string),
      ...(vehicleReg ? { vehicleReg: `%${vehicleReg}%` } : {}),
    });

    const formatted = notifications.map((n: any) => ({
      id: n.NotificationId,
      title: n.Title?.trim() || 'Notification',
      message: n.Message,
      sentDate: n.SentDate,
      receivedDate: n.RecvDate,
      isRead: n.RecvDate !== null,
      vehicleRegistration: n.VehicleRegistration?.trim(),
      type: n.TypeName || 'General',
      typeId: n.NotificationTypeId,
    }));

    const response = { success: true, data: formatted, count: formatted.length };
    setCache(cacheKey, response);
    res.json(response);

  } catch (error: any) {
    console.error('Error fetching notifications:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/customer-app/vehicle/:vehicleReg/notifications
 * Get notifications for a specific vehicle (across all users).
 */
router.get('/vehicle/:vehicleReg/notifications', async (req, res) => {
  const { vehicleReg } = req.params;
  const { days = 7, limit = 30 } = req.query;

  if (!vehicleReg) {
    return res.status(400).json({ success: false, error: 'Vehicle registration is required' });
  }

  try {
    await ensureDb();

    const notifications = await queryMobileApp(`
      SELECT TOP (@limit)
        n.NotificationId,
        RTRIM(n.NotificationTitle)   AS Title,
        n.NotificationText           AS Message,
        n.SentDate,
        n.RecvDate,
        RTRIM(n.VehicleRegistration) AS VehicleRegistration,
        n.NotificationTypeId,
        nt.NotificationTypeName      AS TypeName
      FROM Notifications n WITH (NOLOCK)
      LEFT JOIN NotificationTypes nt WITH (NOLOCK) ON nt.NotificationTypeId = n.NotificationTypeId
      WHERE RTRIM(n.VehicleRegistration) LIKE @vehicleReg
        AND n.SentDate >= DATEADD(day, -@days, GETDATE())
      ORDER BY n.SentDate DESC
    `, {
      vehicleReg: `%${vehicleReg}%`,
      days: parseInt(days as string),
      limit: parseInt(limit as string),
    });

    const formatted = notifications.map((n: any) => ({
      id: n.NotificationId,
      title: n.Title?.trim() || 'Notification',
      message: n.Message,
      sentDate: n.SentDate,
      receivedDate: n.RecvDate,
      isRead: n.RecvDate !== null,
      vehicleRegistration: n.VehicleRegistration?.trim(),
      type: n.TypeName || 'General',
      typeId: n.NotificationTypeId,
    }));

    res.json({ success: true, data: formatted, count: formatted.length });

  } catch (error: any) {
    console.error('Error fetching vehicle notifications:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
