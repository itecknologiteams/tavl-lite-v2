/**
 * Screen Pop — Inbound Call Vehicle Auto-Open
 *
 * Listens for screenPop CustomEvents (dispatched by useDistributionWebSocket)
 * and automatically opens the VehicleDetailPanel for the caller's first vehicle.
 * Also stores CRM customer+vehicle data in callStore for IncomingCallPopup enrichment.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useVehicleStore } from '@store/vehicleStore';
import { useCallStore } from '@store/callStore';
import type { Vehicle } from '@apptypes/vehicle';

interface ScreenPopPayload {
  call: {
    uniqueId: string;
    channel: string;
    callerId: string;
    callerIdName?: string;
    startTime: number;
    state: string;
  };
  found: boolean;
  customer?: { id: number; name: string; address?: string; phone1?: string; phone2?: string };
  vehicles?: { vehicleId: number; plateNumber: string; make?: string; model?: string }[];
  error?: string;
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length > 10) digits = digits.substring(2);
  if (digits.startsWith('0')) digits = digits.substring(1);
  return digits;
}

function parseLocalDateTime(raw?: any): Date | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const [, yy, mo, dd, hh, mm, ss] = m;
      return new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
    }
    if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
          d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
      }
    }
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export default function ScreenPop() {
  const selectVehicle = useVehicleStore(s => s.selectVehicle);
  const focusOnVehicle = useVehicleStore(s => s.focusOnVehicle);
  const setVehicles = useVehicleStore(s => s.setVehicles);
  const setScreenPopData = useCallStore(s => s.setScreenPopData);
  const lastPopRef = useRef<string>('');

  const fetchAndFocusVehicle = useCallback(async (objectId: number, plateNumber: string, description: string) => {
    try {
      const detailResp = await fetch(`/api/vehicles/${objectId}`);
      const detailResult = await detailResp.json();
      if (!detailResult.success || !detailResult.data) return;
      const d = detailResult.data;

      const vehicle: Vehicle = {
        objectId: String(d.objectId ?? objectId),
        vehicleId: d.id || String(objectId),
        name: d.plateNumber || plateNumber,
        registrationNumber: d.plateNumber || plateNumber,
        companyId: '0',
        companyName: d.description || description || 'Unknown',
        deviceId: d.imei || '',
        status: d.status || 'unknown',
        gpsData: {
          latitude: d.latitude,
          longitude: d.longitude,
          speed: d.speed,
          angle: d.angle,
          altitude: d.altitude,
          satellites: d.satellites,
          gpsTimeRaw: d.gpsTime ? String(d.gpsTime) : undefined,
          serverTimeRaw: d.serverTime ? String(d.serverTime) : undefined,
          gpsTime: parseLocalDateTime(d.gpsTime) || new Date(),
          serverTime: parseLocalDateTime(d.serverTime) || new Date(),
          valid: d.gpsValid,
          Ignition: d.ignition ?? d.Ignition,
          EngineCut: d.engineCut ?? d.EngineCut,
          Battery: d.battery ?? d.Battery,
          BackupBattery: d.backupBattery ?? d.BackupBattery,
          PowerVolt: d.powerVolt ?? d.PowerVolt,
          GsmSignal: d.gsmSignal ?? d.GsmSignal,
          HarshBrake: d.harshBrake ?? d.HarshBrake,
          HarshAccel: d.harshAccel ?? d.HarshAccel,
          HarshCorner: d.harshCorner ?? d.HarshCorner,
          Seatbelt: d.seatbelt ?? d.Seatbelt,
          FuelLevel: d.fuelLevel ?? d.FuelLevel,
        },
        meta: { source: 'screen_pop' },
      };

      setVehicles([vehicle]);
      selectVehicle(vehicle);
      focusOnVehicle(vehicle);
      console.log(`📞 Screen Pop: Focused map on ${vehicle.name}`);
    } catch (e) {
      console.warn('📞 Screen Pop: Detail fetch failed:', e);
    }
  }, [setVehicles, selectVehicle, focusOnVehicle]);

  const openVehicle = useCallback(async (plateNumber: string, customerName?: string) => {
    if (lastPopRef.current === plateNumber) {
      console.log(`📞 Screen Pop: Skipping duplicate for ${plateNumber}`);
      return;
    }
    lastPopRef.current = plateNumber;
    setTimeout(() => { if (lastPopRef.current === plateNumber) lastPopRef.current = ''; }, 30_000);

    try {
      console.log(`📞 Screen Pop: Searching tracking system for plate "${plateNumber}"...`);
      const response = await fetch(`/api/vehicles/search?term=${encodeURIComponent(plateNumber)}`);
      const result = await response.json();
      const vehicles = result.data || result.vehicles;
      if (result.success && vehicles?.length) {
        console.log(`📞 Screen Pop: Opening vehicle ${plateNumber} for ${customerName || 'unknown'}`);
        const objectId = parseInt(vehicles[0].ObjectId);
        if (!isNaN(objectId)) {
          await fetchAndFocusVehicle(objectId, vehicles[0].PlateNumber || plateNumber, vehicles[0].Description || '');
        } else {
          selectVehicle(vehicles[0]);
        }
      } else {
        console.warn(`📞 Screen Pop: Vehicle "${plateNumber}" not found in tracking system, trying phone lookup...`);
      }
    } catch (e) {
      console.warn('📞 Screen Pop: Failed to open vehicle:', e);
    }
  }, [selectVehicle, fetchAndFocusVehicle]);

  const openByPhone = useCallback(async (callerId: string, customerName?: string) => {
    const normalized = normalizePhone(callerId);
    if (!normalized || normalized.length < 7) return;

    const dedup = `phone-${normalized}`;
    if (lastPopRef.current === dedup) return;
    lastPopRef.current = dedup;
    setTimeout(() => { if (lastPopRef.current === dedup) lastPopRef.current = ''; }, 30_000);

    try {
      const withZero = `0${normalized}`;
      console.log(`📞 Screen Pop: Searching by phone "${withZero}" (normalized from "${callerId}")...`);
      const response = await fetch(`/api/vehicles/search?term=${encodeURIComponent(withZero)}`);
      const result = await response.json();
      const vehicles = result.data || result.vehicles;
      if (result.success && vehicles?.length) {
        console.log(`📞 Screen Pop: Found vehicle by phone — opening ${vehicles[0].PlateNumber}`);
        const objectId = parseInt(vehicles[0].ObjectId);
        if (!isNaN(objectId)) {
          await fetchAndFocusVehicle(objectId, vehicles[0].PlateNumber || withZero, vehicles[0].Description || '');
        } else {
          selectVehicle(vehicles[0]);
        }
      } else {
        console.warn(`📞 Screen Pop: No vehicle found by phone "${withZero}"`);
      }
    } catch (e) {
      console.warn('📞 Screen Pop: Phone search failed:', e);
    }
  }, [selectVehicle, fetchAndFocusVehicle]);

  useEffect(() => {
    const handleScreenPop = (e: Event) => {
      const payload = (e as CustomEvent<ScreenPopPayload>).detail;
      if (!payload) {
        console.warn('📞 Screen Pop: Empty payload');
        return;
      }

      console.log(`📞 Screen Pop event: found=${payload.found}, customer=${payload.customer?.name}, vehicles=${payload.vehicles?.length}, caller=${payload.call?.callerId}`);

      // Store CRM data in callStore so IncomingCallPopup can show it
      if (payload.customer || payload.vehicles?.length) {
        setScreenPopData({
          customer: payload.customer,
          vehicles: payload.vehicles,
        });
      }

      if (payload.found && payload.vehicles && payload.vehicles.length > 0) {
        const vehicle = payload.vehicles[0];
        openVehicle(vehicle.plateNumber, payload.customer?.name);
      } else if (payload.call?.callerId) {
        openByPhone(payload.call.callerId, payload.customer?.name);
      }
    };

    console.log('📞 Screen Pop: Listener attached');
    window.addEventListener('screenPop', handleScreenPop);
    return () => {
      console.log('📞 Screen Pop: Listener removed');
      window.removeEventListener('screenPop', handleScreenPop);
    };
  }, [openVehicle, openByPhone, setScreenPopData]);

  return null;
}
