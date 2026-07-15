import { useState, useCallback, useRef } from 'react';
import { useVehicleStore } from '@store/vehicleStore';
import { api, isElectron } from '@services/api';
import type { Vehicle } from '../types/vehicle';

export interface SearchResult {
  ObjectId: number;
  PlateNumber: string;
  Description: string;
  IMEI: string;
  Enabled: boolean;
  // Enhanced search fields
  MatchSource?: 'tavl' | 'engine' | 'phone' | 'crm';
  EngineNo?: string;
  PhoneNo?: string;
}

export interface SearchOptions {
  includeDeactivated?: boolean;
}

export interface VehicleSearchState {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  selectedVehicle: Vehicle | null;
  loadingDetails: boolean;
  includeDeactivated: boolean;
}

export function useVehicleSearch() {
  const [state, setState] = useState<VehicleSearchState>({
    results: [],
    loading: false,
    error: null,
    selectedVehicle: null,
    loadingDetails: false,
    includeDeactivated: false,
  });

  // Tracks the most recently initiated search term to discard stale responses
  const latestTermRef = useRef<string>('');

  const { setVehicles, selectVehicle } = useVehicleStore();

  // Get the appropriate API
  const getVehicleApi = useCallback(() => {
    if (isElectron()) {
      return (window as any).electron?.vehicle;
    }
    return api.vehicle;
  }, []);

  // Toggle include deactivated vehicles
  const setIncludeDeactivated = useCallback((include: boolean) => {
    setState(prev => ({ ...prev, includeDeactivated: include }));
  }, []);

  // Search for vehicles by plate number, IMEI, description, engine number, or phone number
  const search = useCallback(async (searchTerm: string, options?: SearchOptions) => {
    if (!searchTerm.trim()) {
      setState(prev => ({ ...prev, results: [], error: null }));
      return;
    }

    latestTermRef.current = searchTerm;
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const vehicleApi = getVehicleApi();
      const includeDeactivated = options?.includeDeactivated ?? state.includeDeactivated;
      const response = await vehicleApi.search(searchTerm, { includeDeactivated });

      // Discard response if a newer search has already been initiated
      if (latestTermRef.current !== searchTerm) return;

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          results: response.data || [],
          loading: false,
        }));
      } else {
        setState(prev => ({
          ...prev,
          results: [],
          loading: false,
          error: response.error || 'Search failed',
        }));
      }
    } catch (error: any) {
      if (latestTermRef.current !== searchTerm) return;
      console.error('Search error:', error);
      setState(prev => ({
        ...prev,
        results: [],
        loading: false,
        error: error.message || 'Search failed',
      }));
    }
  }, [getVehicleApi, state.includeDeactivated]);

  // Get full details for a specific vehicle and show on map
  const getVehicleDetails = useCallback(async (objectId: number) => {
    setState(prev => ({ ...prev, loadingDetails: true, error: null }));

    try {
      const vehicleApi = getVehicleApi();
      const response = await vehicleApi.getDetails(objectId);

      if (response.success && response.data) {
        const vehicleData = response.data;

        const parseLocalDateTime = (raw?: any): Date | null => {
          if (!raw) return null;
          if (raw instanceof Date) {
            if (isNaN(raw.getTime())) return null;
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
        
        // Debug: Log received GPS time data
        console.log('📡 Received vehicle data:', {
          gpsTime: vehicleData.gpsTime,
          gpsTimeType: typeof vehicleData.gpsTime,
          serverTime: vehicleData.serverTime,
          minutesSinceUpdate: vehicleData.minutesSinceUpdate,
          parsedGpsTime: vehicleData.gpsTime ? new Date(vehicleData.gpsTime) : null,
        });
        
        // Convert to Vehicle type for the store
        const vehicle: Vehicle = {
          objectId: vehicleData.objectId.toString(),
          vehicleId: vehicleData.id,
          name: vehicleData.plateNumber,
          registrationNumber: vehicleData.plateNumber,
          companyId: '0',
          companyName: vehicleData.description || 'Unknown',
          deviceId: vehicleData.imei || '',
          status: vehicleData.status,
          gpsData: {
            latitude: vehicleData.latitude,
            longitude: vehicleData.longitude,
            speed: vehicleData.speed,
            angle: vehicleData.angle,
            altitude: vehicleData.altitude,
            satellites: vehicleData.satellites,
            gpsTimeRaw: vehicleData.gpsTime ? String(vehicleData.gpsTime) : undefined,
            serverTimeRaw: vehicleData.serverTime ? String(vehicleData.serverTime) : undefined,
            gpsTime: parseLocalDateTime(vehicleData.gpsTime) || new Date(),
            serverTime: parseLocalDateTime(vehicleData.serverTime) || new Date(),
            valid: vehicleData.gpsValid,
            // Telemetry (VehicleLastLocation)
            Ignition: vehicleData.ignition ?? vehicleData.Ignition,
            EngineCut: vehicleData.engineCut ?? vehicleData.EngineCut,
            Battery: vehicleData.battery ?? vehicleData.Battery,
            BackupBattery: vehicleData.backupBattery ?? vehicleData.BackupBattery,
            PowerVolt: vehicleData.powerVolt ?? vehicleData.PowerVolt,
            GsmSignal: vehicleData.gsmSignal ?? vehicleData.GsmSignal,
            HarshBrake: vehicleData.harshBrake ?? vehicleData.HarshBrake,
            HarshAccel: vehicleData.harshAccel ?? vehicleData.HarshAccel,
            HarshCorner: vehicleData.harshCorner ?? vehicleData.HarshCorner,
            Seatbelt: vehicleData.seatbelt ?? vehicleData.Seatbelt,
            FuelLevel: vehicleData.fuelLevel ?? vehicleData.FuelLevel,
          },
          meta: { source: 'vehicle_search' },
        };

        // Add to store and select it
        setVehicles([vehicle]);
        selectVehicle(vehicle);

        setState(prev => ({
          ...prev,
          selectedVehicle: vehicle,
          loadingDetails: false,
        }));

        return vehicle;
      } else {
        setState(prev => ({
          ...prev,
          loadingDetails: false,
          error: response.error || 'Failed to get vehicle details',
        }));
        return null;
      }
    } catch (error: any) {
      console.error('Get details error:', error);
      setState(prev => ({
        ...prev,
        loadingDetails: false,
        error: error.message || 'Failed to get vehicle details',
      }));
      return null;
    }
  }, [setVehicles, selectVehicle, getVehicleApi]);

  // Clear search results
  const clearSearch = useCallback(() => {
    setState(prev => ({
      results: [],
      loading: false,
      error: null,
      selectedVehicle: null,
      loadingDetails: false,
      includeDeactivated: prev.includeDeactivated,
    }));
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    search,
    getVehicleDetails,
    clearSearch,
    clearError,
    setIncludeDeactivated,
  };
}
