// Authentication types
export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  groups: string[];
  permissions: Permission[];
  loginIds?: number[]; // Login IDs from tavl2.tavl.Login for vehicle filtering
}

export type UserRole = 'admin' | 'supervisor' | 'operator' | 'viewer';

export type Permission = 
  | 'view_vehicles'
  | 'control_vehicles'
  | 'view_reports'
  | 'manage_users'
  | 'view_history'
  | 'acknowledge_alarms'
  | 'search'
  | 'view_agents'
  | 'assign_alerts'
  | 'view_metrics'
  | 'broadcast_message';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthSession {
  jsession: string;
  user: User;
  expiresAt: Date;
}

// API types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// MDVR API types
export interface MDVRLoginResponse {
  result: number;
  jsession?: string;
  JSESSIONID?: string;
}

export interface MDVRDeviceStatus {
  id: string;
  vid: string;
  lng: number;
  lat: number;
  mlng: number;
  mlat: number;
  sp: number;
  hx: number;
  ft: number;
  ol: number;
  gt: string;
  lc: number;
  yl: number;
  ps: string;
}

// Config types
export interface AppConfig {
  server: {
    mdvr: {
      api: MDVRAPIConfig;
    };
    gps: {
      api: GPSAPIConfig;
    };
    tracking: {
      db: DatabaseConfig;
    };
    tavl: {
      db: DatabaseConfig;
    };
    crm: {
      db: DatabaseConfig;
    };
    alarms: Record<string, string>;
  };
  local: {
    loader: string;
    icons: Record<string, string>;
  };
}

export interface MDVRAPIConfig {
  login: string;
  logout: string;
  getUserVehicle: string;
  getDeviceStatus: string;
  getDeviceTrack: string;
  getDeviceAlarm: string;
  mileage: string;
  parked: string;
}

export interface GPSAPIConfig {
  login: string;
  getMaxAlert: string;
  getAlerts: string;
  geocode: string;
}

export interface DatabaseConfig {
  ip: string;
  db: string;
  user: string;
  password: string;
  driver: string;
}
