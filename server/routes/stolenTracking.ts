/**
 * Stolen Vehicle Tracking Routes
 * API for managing stolen vehicle tracking wall
 */

import { Router } from 'express';
import { initPostgres, queryPostgres } from '../db/postgres';
import { queryCrm } from '../db/crm';
import { broadcast } from '../index';

const router = Router();

// Initialize stolen tracking table
export async function initStolenTrackingTable(): Promise<void> {
  await initPostgres();
  
  try {
    // Create the stolen vehicle tracking table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS stolen_vehicle_tracking (
        id SERIAL PRIMARY KEY,
        vehicle_id INT NOT NULL,
        object_id INT NOT NULL,
        vehicle_reg VARCHAR(50) NOT NULL,
        vehicle_desc VARCHAR(255),
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        marked_by VARCHAR(100),
        marked_at TIMESTAMP DEFAULT NOW(),
        priority INT DEFAULT 1,
        case_number VARCHAR(50),
        notes TEXT,
        status VARCHAR(20) DEFAULT 'active',
        last_lat DECIMAL(10, 7),
        last_lon DECIMAL(10, 7),
        last_speed INT DEFAULT 0,
        last_heading INT DEFAULT 0,
        last_address TEXT,
        last_update TIMESTAMP,
        total_distance_km DECIMAL(10, 2) DEFAULT 0,
        sms_alerts_enabled BOOLEAN DEFAULT false,
        sms_phone_number VARCHAR(50),
        sms_interval_km DECIMAL(5, 2) DEFAULT 5,
        last_sms_distance DECIMAL(10, 2) DEFAULT 0,
        last_sms_sent TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create indexes
    await queryPostgres(`
      CREATE INDEX IF NOT EXISTS idx_stolen_tracking_status 
      ON stolen_vehicle_tracking(status)
    `);
    
    await queryPostgres(`
      CREATE INDEX IF NOT EXISTS idx_stolen_tracking_object_id 
      ON stolen_vehicle_tracking(object_id)
    `);
    
    // Create SMS log table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS stolen_tracking_sms_log (
        id SERIAL PRIMARY KEY,
        tracking_id INT REFERENCES stolen_vehicle_tracking(id),
        phone_number VARCHAR(50),
        message TEXT,
        trigger_type VARCHAR(50),
        lat DECIMAL(10, 7),
        lon DECIMAL(10, 7),
        sent_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'sent'
      )
    `);
    
    console.log('✅ Stolen vehicle tracking tables initialized');
  } catch (error: any) {
    console.error('❌ Failed to initialize stolen tracking tables:', error.message);
  }
}

// GET /api/stolen-tracking/active - Get all active tracked vehicles
router.get('/active', async (req, res) => {
  try {
    await initPostgres();
    
    const vehicles = await queryPostgres(`
      SELECT * FROM stolen_vehicle_tracking 
      WHERE status = 'active'
      ORDER BY priority ASC, marked_at DESC
    `);
    
    res.json({
      success: true,
      data: vehicles,
      count: vehicles.length,
    });
  } catch (error: any) {
    console.error('❌ Failed to get active stolen vehicles:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stolen-tracking/:id - Get single tracked vehicle
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await initPostgres();
    
    const vehicles = await queryPostgres(`
      SELECT * FROM stolen_vehicle_tracking WHERE id = $1
    `, [id]);
    
    if (vehicles.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    
    res.json({ success: true, data: vehicles[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/stolen-tracking/mark - Mark vehicle as stolen
router.post('/mark', async (req, res) => {
  try {
    const {
      vehicleId,
      objectId,
      vehicleReg,
      vehicleDesc,
      customerName,
      customerPhone,
      markedBy,
      priority = 1,
      caseNumber,
      notes,
      smsAlertsEnabled = false,
      smsPhoneNumber,
      smsIntervalKm = 5,
    } = req.body;
    
    if (!objectId || !vehicleReg) {
      return res.status(400).json({ 
        success: false, 
        error: 'objectId and vehicleReg are required' 
      });
    }
    
    await initPostgres();
    
    // Check if vehicle is already being tracked
    const existing = await queryPostgres(`
      SELECT id FROM stolen_vehicle_tracking 
      WHERE object_id = $1 AND status = 'active'
    `, [objectId]);
    
    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vehicle is already being tracked' 
      });
    }
    
    // Check if we've reached the limit of 10 vehicles
    const activeCount = await queryPostgres(`
      SELECT COUNT(*) as count FROM stolen_vehicle_tracking WHERE status = 'active'
    `);
    
    if (parseInt(activeCount[0]?.count || '0') >= 10) {
      return res.status(400).json({ 
        success: false, 
        error: 'Maximum of 10 vehicles can be tracked. Remove a vehicle first.' 
      });
    }
    
    // Get V_ID from CRM database (for reference)
    // Also get customer information
    let vId = vehicleId || objectId;
    let custName = customerName;
    let custPhone = customerPhone;
    let vehDesc = vehicleDesc;
    
    try {
      const crmData = await queryCrm(`
        SELECT TOP 1
          v.V_ID as V_ID, v.VEH_REG as VEH_REG,
          c.FNAME as CUSTOMER_NAME, c.CONT1 as PHONE, c.CONT2 as PHONE2
        FROM VEHICLES v WITH (NOLOCK)
        LEFT JOIN INSTALLATION i WITH (NOLOCK) ON v.V_ID = i.V_ID
        LEFT JOIN CUSTOMER c WITH (NOLOCK) ON i.CUST_ID = c.CUST_ID
        WHERE v.OBJECTIDINT = @objectId OR v.VEH_REG = @vehicleReg
      `, { objectId, vehicleReg });
      
      if (crmData && crmData.length > 0) {
        const crm = crmData[0];
        vId = crm.V_ID || vId;
        custName = crm.CUSTOMER_NAME || custName;
        custPhone = crm.PHONE || crm.PHONE2 || custPhone;
        console.log(`📋 Found CRM data: V_ID=${vId}, Customer=${custName}, Phone=${custPhone}`);
      }
    } catch (crmError: any) {
      console.warn('⚠️ CRM cache lookup failed (continuing with provided data):', crmError.message);
    }
    
    // Get current location from eventlog using objectId (same source as agent panel)
    let lastLat = null, lastLon = null, lastSpeed = 0, lastHeading = 0;
    try {
      const location = await queryPostgres(`
        SELECT y as lat, x as lon, speed, angle 
        FROM eventlog 
        WHERE objectid = $1
        ORDER BY servertime DESC NULLS LAST
        LIMIT 1
      `, [objectId]);
      
      if (location.length > 0) {
        lastLat = location[0].lat;
        lastLon = location[0].lon;
        lastSpeed = location[0].speed || 0;
        lastHeading = location[0].angle || 0;
        console.log(`📍 Initial location from eventlog: ${lastLat}, ${lastLon}`);
      }
    } catch (e) {
      // Ignore location errors
    }
    
    // Insert into tracking table
    const result = await queryPostgres(`
      INSERT INTO stolen_vehicle_tracking (
        vehicle_id, object_id, vehicle_reg, vehicle_desc,
        customer_name, customer_phone, marked_by, priority,
        case_number, notes, sms_alerts_enabled, sms_phone_number,
        sms_interval_km, last_lat, last_lon, last_speed, last_heading,
        last_update
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW()
      )
      RETURNING *
    `, [
      vId, objectId, vehicleReg, vehDesc || null,
      custName || null, custPhone || null, markedBy || 'System',
      priority, caseNumber || null, notes || null,
      smsAlertsEnabled, smsPhoneNumber || null, smsIntervalKm,
      lastLat, lastLon, lastSpeed, lastHeading
    ]);
    
    const trackedVehicle = result[0];
    
    // Broadcast to all clients
    broadcast('stolen:added', trackedVehicle);
    
    console.log(`🚨 Vehicle marked as stolen: ${vehicleReg} by ${markedBy}`);
    
    res.json({ success: true, data: trackedVehicle });
  } catch (error: any) {
    console.error('❌ Failed to mark vehicle as stolen:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/stolen-tracking/:id - Update tracking settings
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      priority,
      caseNumber,
      notes,
      smsAlertsEnabled,
      smsPhoneNumber,
      smsIntervalKm,
      status,
    } = req.body;
    
    await initPostgres();
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }
    if (caseNumber !== undefined) {
      updates.push(`case_number = $${paramIndex++}`);
      values.push(caseNumber);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }
    if (smsAlertsEnabled !== undefined) {
      updates.push(`sms_alerts_enabled = $${paramIndex++}`);
      values.push(smsAlertsEnabled);
    }
    if (smsPhoneNumber !== undefined) {
      updates.push(`sms_phone_number = $${paramIndex++}`);
      values.push(smsPhoneNumber);
    }
    if (smsIntervalKm !== undefined) {
      updates.push(`sms_interval_km = $${paramIndex++}`);
      values.push(smsIntervalKm);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }
    
    values.push(id);
    
    const result = await queryPostgres(`
      UPDATE stolen_vehicle_tracking 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);
    
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    
    const updated = result[0];
    
    // Broadcast update
    if (status === 'recovered' || status === 'cancelled') {
      broadcast('stolen:removed', { id: updated.id, vehicle_reg: updated.vehicle_reg, status });
    } else {
      broadcast('stolen:updated', updated);
    }
    
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/stolen-tracking/:id - Remove from tracking
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status = 'cancelled' } = req.query;
    
    await initPostgres();
    
    // Update status instead of deleting (for history)
    const result = await queryPostgres(`
      UPDATE stolen_vehicle_tracking 
      SET status = $1
      WHERE id = $2 AND status = 'active'
      RETURNING *
    `, [status, id]);
    
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found or already removed' });
    }
    
    const removed = result[0];
    
    // Broadcast removal
    broadcast('stolen:removed', { 
      id: removed.id, 
      vehicle_reg: removed.vehicle_reg, 
      status 
    });
    
    console.log(`✅ Vehicle removed from stolen tracking: ${removed.vehicle_reg} (${status})`);
    
    res.json({ success: true, data: removed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/stolen-tracking/:id/update-location - Update vehicle location (called by GPS pipeline)
router.post('/:id/update-location', async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lon, speed, heading, address } = req.body;
    
    await initPostgres();
    
    // Get current tracking data
    const current = await queryPostgres(`
      SELECT * FROM stolen_vehicle_tracking WHERE id = $1 AND status = 'active'
    `, [id]);
    
    if (current.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    
    const vehicle = current[0];
    
    // Calculate distance traveled (Haversine formula)
    let distanceKm = 0;
    if (vehicle.last_lat && vehicle.last_lon && lat && lon) {
      distanceKm = calculateDistance(
        parseFloat(vehicle.last_lat),
        parseFloat(vehicle.last_lon),
        lat,
        lon
      );
    }
    
    const newTotalDistance = parseFloat(vehicle.total_distance_km || 0) + distanceKm;
    
    // Update location
    const updated = await queryPostgres(`
      UPDATE stolen_vehicle_tracking 
      SET last_lat = $1, last_lon = $2, last_speed = $3, last_heading = $4,
          last_address = $5, last_update = NOW(), total_distance_km = $6
      WHERE id = $7
      RETURNING *
    `, [lat, lon, speed || 0, heading || 0, address || null, newTotalDistance, id]);
    
    const updatedVehicle = updated[0];
    
    // Check if SMS should be sent
    if (updatedVehicle.sms_alerts_enabled && updatedVehicle.sms_phone_number) {
      const distanceSinceLastSms = newTotalDistance - parseFloat(updatedVehicle.last_sms_distance || 0);
      
      if (distanceSinceLastSms >= parseFloat(updatedVehicle.sms_interval_km)) {
        // Send SMS alert
        await sendSmsAlert(updatedVehicle, 'distance_threshold');
        
        // Update last SMS distance
        await queryPostgres(`
          UPDATE stolen_vehicle_tracking 
          SET last_sms_distance = $1, last_sms_sent = NOW()
          WHERE id = $2
        `, [newTotalDistance, id]);
      }
    }
    
    // Broadcast location update
    broadcast('stolen:location', {
      id: updatedVehicle.id,
      vehicle_reg: updatedVehicle.vehicle_reg,
      lat,
      lon,
      speed: speed || 0,
      heading: heading || 0,
      address,
      total_distance_km: newTotalDistance,
      last_update: updatedVehicle.last_update,
    });
    
    res.json({ success: true, data: updatedVehicle });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stolen-tracking/:id/sms-log - Get SMS log for a tracked vehicle
router.get('/:id/sms-log', async (req, res) => {
  try {
    const { id } = req.params;
    await initPostgres();
    
    const logs = await queryPostgres(`
      SELECT * FROM stolen_tracking_sms_log 
      WHERE tracking_id = $1
      ORDER BY sent_at DESC
      LIMIT 50
    `, [id]);
    
    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/stolen-tracking/:id/send-sms - Manually send SMS with current location
router.post('/:id/send-sms', async (req, res) => {
  try {
    const { id } = req.params;
    await initPostgres();
    
    const vehicles = await queryPostgres(`
      SELECT * FROM stolen_vehicle_tracking WHERE id = $1
    `, [id]);
    
    if (vehicles.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    
    const vehicle = vehicles[0];
    
    if (!vehicle.sms_phone_number) {
      return res.status(400).json({ success: false, error: 'No phone number configured' });
    }
    
    await sendSmsAlert(vehicle, 'manual');
    
    res.json({ success: true, message: 'SMS sent' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Helper: Send SMS alert
async function sendSmsAlert(vehicle: any, triggerType: string): Promise<void> {
  const googleMapsUrl = `https://maps.google.com/?q=${vehicle.last_lat},${vehicle.last_lon}`;
  
  const message = `🚨 STOLEN VEHICLE ALERT
Reg: ${vehicle.vehicle_reg}
${vehicle.case_number ? `Case: ${vehicle.case_number}` : ''}
Speed: ${vehicle.last_speed || 0} km/h
Distance: ${parseFloat(vehicle.total_distance_km || 0).toFixed(2)} km
Location: ${googleMapsUrl}
Time: ${new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' })}`;

  try {
    // Log the SMS attempt
    await queryPostgres(`
      INSERT INTO stolen_tracking_sms_log 
      (tracking_id, phone_number, message, trigger_type, lat, lon)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      vehicle.id,
      vehicle.sms_phone_number,
      message,
      triggerType,
      vehicle.last_lat,
      vehicle.last_lon,
    ]);
    
    // TODO: Integrate with actual SMS gateway
    // For now, log the message
    console.log(`📱 SMS Alert to ${vehicle.sms_phone_number}:`);
    console.log(message);
    
    // Example Twilio integration (uncomment when configured):
    // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
    // await twilio.messages.create({
    //   body: message,
    //   from: process.env.TWILIO_FROM,
    //   to: vehicle.sms_phone_number,
    // });
    
  } catch (error: any) {
    console.error('❌ Failed to send SMS:', error.message);
  }
}

export default router;
