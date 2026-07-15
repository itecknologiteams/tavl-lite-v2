import { useEffect, useRef } from 'react';
import { useVehicleStore, TrailPoint } from '@store/vehicleStore';
import type { Vehicle } from '@apptypes/vehicle';

const REFRESH_INTERVAL = 10000; // 10 seconds

/**
 * Hook to auto-refresh GPS data for pinned vehicles every 10 seconds
 * Also adds trail points for moving pinned vehicles
 */
export const usePinnedVehicleRefresh = () => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);
  const lastPositionsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const parseLocalDateTime = (raw?: any): Date | null => {
    if (!raw) return null;
    if (raw instanceof Date) {
      if (isNaN(raw.getTime())) return null;
      // Preserve DB wall-clock time even if Date was serialized with UTC/Z
      return new Date(
        raw.getUTCFullYear(),
        raw.getUTCMonth(),
        raw.getUTCDate(),
        raw.getUTCHours(),
        raw.getUTCMinutes(),
        raw.getUTCSeconds(),
        raw.getUTCMilliseconds()
      );
    }
    if (typeof raw === 'string') {
      const s = raw.trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const [_, yy, mo, dd, hh, mm, ss] = m;
        return new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
      }
      // ISO with timezone (Z / offset) → preserve wall time
      if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          return new Date(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours(),
            d.getUTCMinutes(),
            d.getUTCSeconds(),
            d.getUTCMilliseconds()
          );
        }
      }
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };
  
  useEffect(() => {
    // Cleanup any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    const refreshPinnedVehicles = async () => {
      if (isRefreshingRef.current) return;
      
      const store = useVehicleStore.getState();
      const pinnedIds = Array.from(store.pinnedVehicles);
      
      if (pinnedIds.length === 0) {
        console.log('🔄 No pinned vehicles to refresh');
        return;
      }
      
      isRefreshingRef.current = true;
      
      console.log(`🔄 Refreshing ${pinnedIds.length} pinned vehicles:`, pinnedIds);
      
      try {
        const response = await fetch('/api/vehicles/gps/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectIds: pinnedIds }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.data) {
          const currentStore = useVehicleStore.getState();
          let updatedCount = 0;
          let notFoundCount = 0;
          
          // Process each returned GPS data
          for (const [apiObjectId, gpsData] of Object.entries(result.data) as [string, any][]) {
            // Normalize objectId to string for consistent lookup
            const objectId = String(apiObjectId);
            
            // Try to find the vehicle with both string and original key
            let existingVehicle: Vehicle | undefined = 
              currentStore.pinnedVehicleData.get(objectId) || 
              currentStore.vehicles.get(objectId);
            
            // Debug: log what we found
            if (!existingVehicle) {
              console.warn(`⚠️ Vehicle ${objectId} not found in store. pinnedVehicleData keys:`, 
                Array.from(currentStore.pinnedVehicleData.keys()));
              notFoundCount++;
              continue;
            }
            
            const lat = parseFloat(gpsData.latitude) || 0;
            const lng = parseFloat(gpsData.longitude) || 0;
            const speed = parseInt(gpsData.speed) || 0;
            
            // Validate coordinates
            if (lat === 0 && lng === 0) {
              console.warn(`⚠️ Invalid GPS for ${existingVehicle.name}: 0,0`);
              continue;
            }
            
            // Check if position changed significantly (for trail points)
            const lastPos = lastPositionsRef.current.get(objectId);
            const positionChanged = !lastPos || 
              Math.abs(lastPos.lat - lat) > 0.00001 || 
              Math.abs(lastPos.lng - lng) > 0.00001;
            
            // Add trail point if position changed and vehicle is moving
            if (positionChanged && speed > 0) {
              const trailPoint: TrailPoint = {
                lat,
                lng,
                speed,
                timestamp: Date.now(),
              };
              currentStore.addTrailPoint(objectId, trailPoint);
            }
            
            // Always update last known position
            lastPositionsRef.current.set(objectId, { lat, lng });
            
            // Create updated vehicle object
            const updatedVehicle: Vehicle = {
              ...existingVehicle,
              status: gpsData.status || existingVehicle.status,
              gpsData: {
                latitude: lat,
                longitude: lng,
                speed: speed,
                angle: parseInt(gpsData.angle) || 0,
                altitude: parseInt(gpsData.altitude) || 0,
                satellites: parseInt(gpsData.satellites) || 0,
                gpsTimeRaw: gpsData.gpsTime ? String(gpsData.gpsTime) : undefined,
                serverTimeRaw: gpsData.serverTime ? String(gpsData.serverTime) : undefined,
                gpsTime: parseLocalDateTime(gpsData.gpsTime) || new Date(),
                serverTime: parseLocalDateTime(gpsData.serverTime) || new Date(),
                valid: true,
                // Telemetry (VehicleLastLocation)
                Ignition: gpsData.ignition ?? gpsData.Ignition,
                EngineCut: gpsData.engineCut ?? gpsData.EngineCut ?? gpsData.enginecut,
                Battery: gpsData.battery ?? gpsData.Battery,
                BackupBattery: gpsData.backupBattery ?? gpsData.BackupBattery ?? gpsData.backupbattery,
                PowerVolt: gpsData.powerVolt ?? gpsData.PowerVolt ?? gpsData.powervolt,
                GsmSignal: gpsData.gsmSignal ?? gpsData.GsmSignal ?? gpsData.gsmsignal,
                HarshBrake: gpsData.harshBrake ?? gpsData.HarshBrake ?? gpsData.harshbrake,
                HarshAccel: gpsData.harshAccel ?? gpsData.HarshAccel ?? gpsData.harshaccel,
                HarshCorner: gpsData.harshCorner ?? gpsData.HarshCorner ?? gpsData.harshcorner,
                Seatbelt: gpsData.seatbelt ?? gpsData.Seatbelt,
                FuelLevel: gpsData.fuelLevel ?? gpsData.FuelLevel ?? gpsData.fuellevel,
              },
            };
            
            // updateVehicle already updates vehicles, pinnedVehicleData, and selectedVehicle
            currentStore.updateVehicle(objectId, updatedVehicle);
            
            updatedCount++;
            
            if (positionChanged) {
              console.log(`📍 ${existingVehicle.name}: ${lat.toFixed(5)}, ${lng.toFixed(5)} @ ${speed}km/h`);
            }
          }
          
          console.log(`🔄 Refresh complete: ${updatedCount} updated, ${notFoundCount} not found`);
        } else {
          console.error('🔄 Refresh failed:', result.error || 'Unknown error');
        }
      } catch (error) {
        console.error('🔄 Failed to refresh pinned vehicles:', error);
      } finally {
        isRefreshingRef.current = false;
      }
    };
    
    // Start interval
    console.log('🔄 Starting pinned vehicle refresh (10s interval)');
    intervalRef.current = setInterval(refreshPinnedVehicles, REFRESH_INTERVAL);
    
    // Initial refresh immediately
    refreshPinnedVehicles();
    
    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      console.log('🔄 Pinned vehicle refresh stopped');
    };
  }, []); // Empty deps - run once on mount
  
  return { isActive: !!intervalRef.current };
};
