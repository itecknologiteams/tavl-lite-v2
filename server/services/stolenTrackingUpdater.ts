/**
 * Stolen Vehicle Tracking Updater
 * Polls GPS data for tracked vehicles and broadcasts updates
 */

import { initPostgres, queryPostgres } from '../db/postgres';
import { broadcast } from '../index';

let updateInterval: NodeJS.Timeout | null = null;
const UPDATE_INTERVAL_MS = 5000; // 5 seconds for real-time tracking

// Calculate distance between two coordinates (Haversine formula)
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

// Send SMS alert
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
    console.log(`📱 SMS Alert to ${vehicle.sms_phone_number}:`);
    console.log(message);
    
  } catch (error: any) {
    console.error('❌ Failed to send SMS:', error.message);
  }
}

async function updateTrackedVehicles() {
  try {
    await initPostgres();
    
    // Get all active tracked vehicles
    const trackedVehicles = await queryPostgres(`
      SELECT * FROM stolen_vehicle_tracking WHERE status = 'active'
    `);
    
    if (!trackedVehicles || trackedVehicles.length === 0) {
      return; // No vehicles to track
    }
    
    // Get current locations from eventlog (same source as agent panel)
    // Using object_id to match how the agent panel fetches data
    const objectIds = trackedVehicles.map((v: any) => v.object_id);
    
    // Get the latest event for each vehicle using DISTINCT ON
    const locations = await queryPostgres(`
      SELECT DISTINCT ON (objectid) 
        objectid, y as lat, x as lon, speed, angle, servertime
      FROM eventlog
      WHERE objectid = ANY($1)
      ORDER BY objectid, servertime DESC NULLS LAST
    `, [objectIds]);
    
    // Create location map using object_id
    const locationMap = new Map<number, any>();
    locations.forEach((loc: any) => {
      locationMap.set(parseInt(loc.objectid), loc);
    });
    
    // Process each tracked vehicle
    for (const vehicle of trackedVehicles) {
      const location = locationMap.get(vehicle.object_id);
      
      if (!location) {
        console.log(`⚠️ No location for ${vehicle.vehicle_reg} (objectid: ${vehicle.object_id})`);
        continue; // No location data available
      }
      
      const newLat = parseFloat(location.lat);
      const newLon = parseFloat(location.lon);
      const newSpeed = parseInt(location.speed) || 0;
      const newHeading = parseInt(location.angle) || 0;
      const newAddress = null; // eventlog doesn't have address
      
      // Check if location has changed
      const hasLocationChange = 
        !vehicle.last_lat || 
        !vehicle.last_lon ||
        Math.abs(newLat - parseFloat(vehicle.last_lat)) > 0.00001 ||
        Math.abs(newLon - parseFloat(vehicle.last_lon)) > 0.00001;
      
      if (!hasLocationChange) {
        continue; // No update needed
      }
      
      // Calculate distance traveled
      let distanceKm = 0;
      if (vehicle.last_lat && vehicle.last_lon) {
        distanceKm = calculateDistance(
          parseFloat(vehicle.last_lat),
          parseFloat(vehicle.last_lon),
          newLat,
          newLon
        );
      }
      
      const newTotalDistance = parseFloat(vehicle.total_distance_km || 0) + distanceKm;
      
      // Update database
      await queryPostgres(`
        UPDATE stolen_vehicle_tracking 
        SET last_lat = $1, last_lon = $2, last_speed = $3, last_heading = $4,
            last_address = $5, last_update = NOW(), total_distance_km = $6
        WHERE id = $7
      `, [newLat, newLon, newSpeed, newHeading, newAddress, newTotalDistance, vehicle.id]);
      
      // Broadcast location update
      broadcast('stolen:location', {
        id: vehicle.id,
        vehicle_reg: vehicle.vehicle_reg,
        lat: newLat,
        lon: newLon,
        speed: newSpeed,
        heading: newHeading,
        address: newAddress,
        total_distance_km: newTotalDistance,
        last_update: new Date().toISOString(),
      });
      
      // Check if SMS should be sent
      if (vehicle.sms_alerts_enabled && vehicle.sms_phone_number) {
        const distanceSinceLastSms = newTotalDistance - parseFloat(vehicle.last_sms_distance || 0);
        const smsInterval = parseFloat(vehicle.sms_interval_km || 5);
        
        if (distanceSinceLastSms >= smsInterval) {
          // Send SMS alert
          await sendSmsAlert({
            ...vehicle,
            last_lat: newLat,
            last_lon: newLon,
            last_speed: newSpeed,
            total_distance_km: newTotalDistance,
          }, 'distance_threshold');
          
          // Update last SMS distance
          await queryPostgres(`
            UPDATE stolen_vehicle_tracking 
            SET last_sms_distance = $1, last_sms_sent = NOW()
            WHERE id = $2
          `, [newTotalDistance, vehicle.id]);
          
          console.log(`📱 SMS sent for ${vehicle.vehicle_reg} at ${newTotalDistance.toFixed(2)}km`);
        }
      }
    }
    
  } catch (error: any) {
    console.error('❌ Stolen tracking update error:', error.message);
  }
}

export function startStolenTrackingUpdater() {
  if (updateInterval) return;
  
  console.log('🚨 Starting stolen vehicle tracking updater (every 5s)');
  
  // Initial update after a short delay
  setTimeout(updateTrackedVehicles, 3000);
  
  // Regular updates
  updateInterval = setInterval(updateTrackedVehicles, UPDATE_INTERVAL_MS);
}

export function stopStolenTrackingUpdater() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
    console.log('🚨 Stolen vehicle tracking updater stopped');
  }
}
