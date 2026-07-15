import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // SQL Server database operations (TAVL - 192.168.20.253)
  db: {
    query: (query: string, params?: any) =>
      ipcRenderer.invoke('db:query', query, params),
    updateConfig: (config: any) =>
      ipcRenderer.invoke('db:update-config', config),
  },
  
  // PostgreSQL database operations (Tracking - 192.168.20.186)
  pg: {
    connect: () => ipcRenderer.invoke('pg:connect'),
    query: (query: string, params?: any[]) =>
      ipcRenderer.invoke('pg:query', query, params),
    exploreSchema: () => ipcRenderer.invoke('pg:explore-schema'),
    exploreEventlog: () => ipcRenderer.invoke('pg:explore-eventlog'),
  },
  
  // Vehicle Search API - On-demand vehicle lookup
  vehicle: {
    search: (searchTerm: string) => 
      ipcRenderer.invoke('vehicle:search', searchTerm),
    getDetails: (objectId: number) => 
      ipcRenderer.invoke('vehicle:get-details', objectId),
    getRealtimeGps: (vehicleId: number) => 
      ipcRenderer.invoke('vehicle:get-realtime-gps', vehicleId),
  },
  
  // Alerts API - Real-time alerts from PostgreSQL eventlog
  alerts: {
    getRecent: (options?: { 
      limit?: number; 
      category?: string; 
      sinceMinutes?: number;
      sinceId?: string;
    }) => ipcRenderer.invoke('alerts:get-recent', options),
    getStats: () => ipcRenderer.invoke('alerts:get-stats'),
  },
  
  // CRM API - Customer and vehicle details
  crm: {
    exploreSchema: () => ipcRenderer.invoke('crm:explore-schema'),
    getVehicleDetails: (identifier: string | number) => 
      ipcRenderer.invoke('crm:get-vehicle-details', identifier),
    query: (query: string, params?: Record<string, any>) =>
      ipcRenderer.invoke('crm:query', query, params),
  },
  
  // Database exploration
  exploreDatabases: () => ipcRenderer.invoke('explore-all-databases'),
  
  // App operations
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPath: (name: string) => ipcRenderer.invoke('app:get-path', name),
  },
});

// Type definitions for TypeScript
export interface VehicleSearchResult {
  ObjectId: number;
  PlateNumber: string;
  Description: string;
  IMEI: string;
  Enabled: boolean;
}

export interface VehicleDetails {
  id: string;
  objectId: number;
  plateNumber: string;
  description: string;
  imei: string;
  status: 'moving' | 'idle' | 'parked' | 'offline' | 'gps-invalid';
  latitude: number;
  longitude: number;
  speed: number;
  angle: number;
  altitude: number;
  satellites: number;
  gpsTime: string | null;
  serverTime: string | null;
  minutesSinceUpdate: number | null;
  gpsValid: boolean;
}

export interface AlertData {
  id: string;
  vehicleId: string;
  vehicleName: string;
  alarmType: string;
  alarmTypeId: number;
  description: string;
  latitude: number;
  longitude: number;
  speed: number;
  occurredAt: string;
  appearedAt: string;
  acknowledged: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'critical' | 'warning' | 'geofence' | 'info';
  value: number;
}

export interface AlertStats {
  critical: number;
  warning: number;
  geofence: number;
  other: number;
  total: number;
}

export interface ElectronAPI {
  db: {
    query: (query: string, params?: any) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    updateConfig: (config: {
      server: string;
      database: string;
      user: string;
      password: string;
    }) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
  pg: {
    connect: () => Promise<{ success: boolean; error?: string }>;
    query: (query: string, params?: any[]) => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    exploreSchema: () => Promise<{
      success: boolean;
      data?: {
        tables: string[];
        eventLogColumns?: { name: string; type: string }[];
        sampleData?: any[];
      };
      error?: string;
    }>;
  };
  vehicle: {
    search: (searchTerm: string) => Promise<{
      success: boolean;
      data?: VehicleSearchResult[];
      error?: string;
    }>;
    getDetails: (objectId: number) => Promise<{
      success: boolean;
      data?: VehicleDetails;
      error?: string;
    }>;
    getRealtimeGps: (vehicleId: number) => Promise<{
      success: boolean;
      data?: {
        v_id: number;
        latitude: number;
        longitude: number;
        speed: number;
        angle: number;
        altitude: number;
        gpstime: string;
        servertime: string;
        valid: boolean;
        satellites: number;
        ignition: boolean;
        enginecut: boolean;
        battery: number;
        gsmsignal: number;
      };
      error?: string;
    }>;
  };
  alerts: {
    getRecent: (options?: { 
      limit?: number; 
      category?: string; 
      sinceMinutes?: number;
      sinceId?: string;
    }) => Promise<{
      success: boolean;
      data?: AlertData[];
      maxId?: string;
      error?: string;
    }>;
    getStats: () => Promise<{
      success: boolean;
      data?: AlertStats;
      error?: string;
    }>;
  };
  crm: {
    exploreSchema: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    getVehicleDetails: (identifier: string | number) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    query: (query: string, params?: Record<string, any>) => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
  };
  exploreDatabases: () => Promise<{
    postgres: any;
    tavl: any;
  }>;
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
  };
}

// Note: Window.electron type is declared in src/vite-env.d.ts
