// Vehicle related types
export interface Vehicle {
  objectId: string;
  vehicleId: string;
  name: string;
  registrationNumber?: string;
  companyId: string;
  companyName: string;
  deviceId: string;
  status: VehicleStatus;
  gpsData?: GPSData;
  ioStatus?: IOStatus;
  /**
   * Optional extra context used by UI (e.g. alert snapshot vs live).
   * Safe to ignore by most consumers.
   */
  meta?: {
    source?: 'alert_inbox' | 'vehicle_search' | 'screen_pop' | 'live';
    alertSnapshot?: {
      /** Raw GPS time from the alert row/payload (no timezone coercion). */
      gpsTimeRaw?: string;
      latitude?: number;
      longitude?: number;
      speed?: number;
      satellites?: number;
    };
  };
}

export interface GPSData {
  latitude: number;
  longitude: number;
  angle: number;
  speed: number;
  altitude: number;
  satellites: number;
  gpsTime: Date;
  serverTime: Date;
  valid: boolean;
  /** Raw local datetime strings (from VehicleLastLocation), used to avoid timezone shifts in UI. */
  gpsTimeRaw?: string;
  serverTimeRaw?: string;
  // Telemetry data from VehicleLastLocation
  Ignition?: boolean;
  EngineCut?: boolean;
  Battery?: number;
  BackupBattery?: number;
  PowerVolt?: number;
  GsmSignal?: number;
  HarshBrake?: number;
  HarshAccel?: number;
  HarshCorner?: number;
  Seatbelt?: boolean;
  FuelLevel?: number;
}

export interface IOStatus {
  ignition: boolean;
  engineCut: boolean;
  battery: number;
  backupBattery: number;
  powerVolt: number;
  gsmSignal: number;
  harshBrake: boolean;
  harshAccel: boolean;
  harshCorner: boolean;
  seatBelt: boolean;
}

export type VehicleStatus = 
  | 'moving' 
  | 'idle' 
  | 'parked' 
  | 'offline' 
  | 'gps-invalid'
  | 'alarm';

export interface Company {
  id: string;
  name: string;
  vehicleCount: number;
}

// Alarm related types
export interface Alarm {
  id: string;
  warningId?: string; // WarningId from ConsoleWarning (for direct robocall lookup)
  vehicleId: string;
  vehicleName: string;
  alarmType: string;
  alarmTypeId: number;
  description: string;
  latitude: number;
  longitude: number;
  occurredAt: Date;
  appearedAt: Date;
  acknowledged: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// Track/History types
export interface TrackPoint {
  latitude: number;
  longitude: number;
  angle: number;
  speed: number;
  altitude: number;
  satellites: number;
  gpsTime: Date;
  serverTime?: Date;
  ignition: boolean;
  gpsValid: boolean;
  // Telemetry fields for graphs
  engineCut?: boolean;
  battery?: number;
  backupBattery?: number;
  powerVolt?: number;
  gsmSignal?: number;
  fuelLevel?: number | null;
  // Latency: time for data to reach server (seconds)
  latency?: number;
}

export interface TrackHistory {
  vehicleId: string;
  vehicleName: string;
  startTime: Date;
  endTime: Date;
  points: TrackPoint[];
  totalDistance: number;
  totalDuration: number;
  stops: StopPoint[];
}

export interface StopPoint {
  latitude: number;
  longitude: number;
  startTime: Date;
  endTime: Date;
  duration: number;
  address?: string;
}

// Report types
export interface MileageReport {
  vehicleId: string;
  vehicleName: string;
  startDate: Date;
  endDate: Date;
  totalMileage: number;
  tripCount: number;
  averageSpeed: number;
}

export interface ParkingReport {
  vehicleId: string;
  vehicleName: string;
  startDate: Date;
  endDate: Date;
  parkingEvents: ParkingEvent[];
}

export interface ParkingEvent {
  latitude: number;
  longitude: number;
  startTime: Date;
  endTime: Date;
  duration: number;
  address?: string;
}
