import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@store/authStore';
import { useVehicleStore } from '@store/vehicleStore';
import type { Vehicle } from '@apptypes/vehicle';

/**
 * Custom hook to load and manage vehicle data
 * 
 * PYTHON APP LOGIC (1:1 implementation):
 * 
 * 1. Login: CRM DB validation + get login_ids from TAVL DB (base1, base2, etc.)
 * 2. Load vehicles: Query TAVL DB directly using login_ids filter
 *    - Python uses: SELECT ObjectId, Number FROM tavl2.tavl.Object WHERE ObjectId IN (
 *        SELECT ObjectId FROM GroupObject WHERE GroupId IN (
 *          SELECT GroupId FROM GroupLogin WHERE LoginId IN (login_ids)
 *        )
 *      )
 * 3. NO MDVR API CALL FOR VEHICLE LIST! Python loads vehicles from DB only.
 * 4. GPS status comes from TAVL DB (ObjectLastMessage table), not MDVR API
 */
export const useVehicles = () => {
  const user = useAuthStore((state) => state.user);
  const setVehicles = useVehicleStore((state) => state.setVehicles);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Fetch vehicles from TAVL database using login_ids (EXACTLY like Python)
  // Python code from line 6876-6879:
  // cursor.execute('SELECT ObjectId, Number FROM tavl2.tavl.Object WHERE ObjectId IN 
  //   (SELECT ObjectId FROM GroupObject WHERE GroupId IN 
  //     (SELECT GroupId FROM GroupLogin WHERE LoginId IN (login_ids)))')
  const { data: dbVehicles, isLoading: vehiclesLoading, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: ['db-vehicles', user?.loginIds],
    queryFn: async () => {
      if (!user?.loginIds || user.loginIds.length === 0) {
        console.warn('⚠️ No loginIds found for user');
        return [];
      }

      const loginIdsStr = user.loginIds.join(',');
      console.log(`🔍 Loading vehicles from TAVL DB for loginIds: [${loginIdsStr}]`);

      // EXACT Python query from line 6876-6879:
      // SELECT ObjectId, Number FROM tavl2.tavl.Object WHERE ObjectId IN (
      //   SELECT ObjectId FROM GroupObject WHERE GroupId IN (
      //     SELECT GroupId FROM GroupLogin WHERE LoginId IN (login_ids)
      //   )
      // )
      const result = await window.electron.db.query(
        `SELECT [tavl2].[tavl].[Object].[ObjectId], [tavl2].[tavl].[Object].[Number] 
         FROM [tavl2].[tavl].[Object] WITH (NOLOCK)
         WHERE [tavl2].[tavl].[Object].[ObjectId] IN (
           SELECT [tavl2].[tavl].[GroupObject].[ObjectId] 
           FROM [tavl2].[tavl].[GroupObject] WITH (NOLOCK)
           WHERE [tavl2].[tavl].[GroupObject].[GroupId] IN (
             SELECT [tavl2].[tavl].[GroupLogin].[GroupId] 
             FROM [tavl2].[tavl].[GroupLogin] WITH (NOLOCK)
             WHERE [tavl2].[tavl].[GroupLogin].[LoginId] IN (${loginIdsStr})
           )
         )`
      );

      if (result.success && result.data) {
        console.log(`✅ Loaded ${result.data.length} vehicles from TAVL DB`);
        return result.data;
      }

      console.error('❌ Failed to load vehicles:', result.error);
      throw new Error(result.error || 'Failed to load vehicles');
    },
    enabled: !!user?.loginIds && user.loginIds.length > 0,
    staleTime: 60000, // Cache for 1 minute
    retry: 3, // Retry 3 times on failure
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff: 1s, 2s, 4s...
  });

  // Step 2: Fetch GPS status from TAVL database
  // Join ObjectLastMessage -> Message to get GPS data
  // Note: Ignition data is in separate Tracking database (not used here)
  const { data: gpsStatus, isLoading: gpsLoading, refetch: refetchGps } = useQuery({
    queryKey: ['gps-status', dbVehicles?.map((v: any) => v.ObjectId)],
    queryFn: async () => {
      if (!dbVehicles || dbVehicles.length === 0) {
        return [];
      }

      const objectIds = dbVehicles.map((v: any) => v.ObjectId).join(',');
      console.log(`📍 Loading GPS status for ${dbVehicles.length} vehicles...`);

      // Query ObjectLastMessage joined with Message to get GPS data
      // Also get GETDATE() to compare against server time (avoids timezone issues)
      // ObjectLastMessage: ObjectId, MessageId, GpsTime
      // Message: MessageId, X, Y, VectorSpeed, VectorAngle, Altitude, VisibleSatelites, Valid, GpsTime
      const result = await window.electron.db.query(
        `SELECT 
           OLM.[ObjectId],
           M.[Y] as Latitude,
           M.[X] as Longitude,
           M.[VectorSpeed] as Speed,
           M.[VectorAngle] as Angle,
           M.[GpsTime],
           M.[TimeStamp] as ServerTime,
           M.[Valid],
           M.[VisibleSatelites] as Satellites,
           M.[Altitude],
           O.[Number] as VehicleName,
           GETDATE() as CurrentServerTime,
           DATEDIFF(MINUTE, M.[GpsTime], GETDATE()) as MinutesSinceUpdate
         FROM [tavl2].[tavl].[ObjectLastMessage] OLM WITH (NOLOCK)
         INNER JOIN [tavl2].[tavl].[Message] M WITH (NOLOCK) ON OLM.[MessageId] = M.[MessageId]
         INNER JOIN [tavl2].[tavl].[Object] O WITH (NOLOCK) ON OLM.[ObjectId] = O.[ObjectId]
         WHERE OLM.[ObjectId] IN (${objectIds})`
      );

      if (result.success && result.data) {
        console.log(`✅ Loaded GPS status for ${result.data.length} vehicles`);
        
        // DEBUG: Log sample GPS data to understand the format
        if (result.data.length > 0) {
          const sample = result.data[0];
          console.log('📊 Sample GPS data:', {
            ObjectId: sample.ObjectId,
            VehicleName: sample.VehicleName,
            GpsTime: sample.GpsTime,
            CurrentServerTime: sample.CurrentServerTime,
            MinutesSinceUpdate: sample.MinutesSinceUpdate,
            Speed: sample.Speed,
            Valid: sample.Valid,
            Latitude: sample.Latitude,
            Longitude: sample.Longitude,
          });
          
          // Log a few more samples to see the distribution
          const movingCount = result.data.filter((d: any) => parseFloat(d.Speed) > 3).length;
          const recentCount = result.data.filter((d: any) => parseInt(d.MinutesSinceUpdate) < 10).length;
          const offlineCount = result.data.filter((d: any) => parseInt(d.MinutesSinceUpdate) >= 1440).length;
          
          console.log('📈 GPS Status Summary:', {
            total: result.data.length,
            moving: movingCount,
            recentUpdate: recentCount,
            offline24h: offlineCount,
          });
        }
        
        return result.data;
      }

      console.error('❌ Failed to load GPS status:', result.error);
      return [];
    },
    enabled: !!dbVehicles && dbVehicles.length > 0,
    refetchInterval: 5000, // Real-time updates every 5 seconds (like Python)
    staleTime: 3000,
    retry: 2, // Retry twice on failure (less aggressive for polling query)
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff
  });

  // Step 3: Process and combine vehicle data
  useEffect(() => {
    if (!dbVehicles || dbVehicles.length === 0) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // DEBUG: Count GPS matches
      let gpsMatchCount = 0;
      let noGpsCount = 0;
      
      // Create vehicle objects with GPS data
      const vehicles: Vehicle[] = dbVehicles.map((dbVehicle: any) => {
        // Find GPS status for this vehicle - compare as strings to avoid type mismatch
        const vehicleObjectId = String(dbVehicle.ObjectId);
        const gps = gpsStatus?.find((g: any) => String(g.ObjectId) === vehicleObjectId);
        
        if (gps) {
          gpsMatchCount++;
        } else {
          noGpsCount++;
        }

        // Determine vehicle status based on GPS data
        // Note: Ignition data is not available in tavl2, using speed-based logic
        let vehicleStatus: Vehicle['status'] = 'offline';
        
        if (gps) {
          // Use server-calculated minutes since update (avoids timezone issues!)
          const minutesSinceUpdate = parseInt(gps.MinutesSinceUpdate) || 0;
          const hoursSinceUpdate = minutesSinceUpdate / 60;
          
          // Parse speed properly - it might be a string or number
          const speed = typeof gps.Speed === 'string' ? parseFloat(gps.Speed) : (gps.Speed || 0);
          const isValid = gps.Valid === true || gps.Valid === 1 || gps.Valid === '1';

          // Thresholds: 
          // - Offline: > 24 hours (1440 minutes)
          // - Stale but ok: > 10 minutes but < 24 hours
          if (minutesSinceUpdate >= 1440) {
            // Not reporting for 24+ hours
            vehicleStatus = 'offline';
          } else if (!isValid) {
            // GPS invalid
            vehicleStatus = 'gps-invalid';
          } else if (speed > 3) {
            // Moving (speed > 3 km/h)
            vehicleStatus = 'moving';
          } else if (speed <= 3) {
            // Stationary or very slow
            // If no update for > 2 hours and stopped, consider parked
            if (hoursSinceUpdate > 2) {
              vehicleStatus = 'parked';
            } else {
              vehicleStatus = 'idle';
            }
          }
        }

        return {
          objectId: dbVehicle.ObjectId.toString(),
          vehicleId: dbVehicle.ObjectId.toString(),
          name: dbVehicle.Number || `Vehicle ${dbVehicle.ObjectId}`,
          registrationNumber: dbVehicle.Number,
          companyId: '0',
          companyName: 'Default',
          deviceId: dbVehicle.ObjectId.toString(),
          status: vehicleStatus,
          gpsData: gps ? {
            latitude: parseFloat(gps.Latitude) || 0,
            longitude: parseFloat(gps.Longitude) || 0,
            angle: parseInt(gps.Angle) || 0,
            speed: parseInt(gps.Speed) || 0,
            altitude: parseInt(gps.Altitude) || 0,
            satellites: parseInt(gps.Satellites) || 0,
            gpsTime: new Date(gps.GpsTime),
            serverTime: new Date(gps.ServerTime),
            valid: gps.Valid === true || gps.Valid === 1,
          } : undefined,
        };
      });

      setVehicles(vehicles);
      setError(null);
      
      // DEBUG: Log status breakdown
      const statusCounts = vehicles.reduce((acc, v) => {
        acc[v.status] = (acc[v.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`🚗 Processed ${vehicles.length} vehicles:`, {
        gpsMatched: gpsMatchCount,
        noGps: noGpsCount,
        statusBreakdown: statusCounts,
      });
    } catch (err: any) {
      console.error('Error processing vehicles:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dbVehicles, gpsStatus, setVehicles]);

  // Refetch function
  const refetch = useCallback(() => {
    refetchVehicles();
    refetchGps();
  }, [refetchVehicles, refetchGps]);

  // Get company list from vehicles
  const companies = useVehicleStore((state) => {
    const vehicleMap = state.vehicles;
    const companyMap = new Map<string, { id: string; name: string; count: number }>();

    vehicleMap.forEach((vehicle) => {
      if (!companyMap.has(vehicle.companyId)) {
        companyMap.set(vehicle.companyId, {
          id: vehicle.companyId,
          name: vehicle.companyName,
          count: 0,
        });
      }
      const company = companyMap.get(vehicle.companyId)!;
      company.count++;
    });

    return Array.from(companyMap.values());
  });

  return {
    loading: vehiclesLoading || gpsLoading || loading,
    error: vehiclesError?.message || error,
    refetch,
    companies,
    vehicleCount: dbVehicles?.length || 0,
  };
};
