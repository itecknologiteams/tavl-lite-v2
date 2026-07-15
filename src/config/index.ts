/**
 * Application Configuration
 * Loads from environment variables and provides type-safe access
 */

interface AppConfig {
  // Database
  database: {
    server: string;
    name: string;
    user: string;
    password: string;
    driver: string;
  };
  
  // APIs
  mdvr: {
    baseUrl: string;
    account?: string;
    password?: string;
  };
  
  gps: {
    baseUrl: string;
    username?: string;
    password?: string;
  };
  
  // App
  app: {
    name: string;
    version: string;
    env: 'development' | 'production';
  };
}

// Load from environment or use defaults
export const config: AppConfig = {
  database: {
    server: import.meta.env.DB_SERVER || '192.168.20.244',
    name: import.meta.env.DB_NAME || 'Tracking',
    user: import.meta.env.DB_USER || 'sa',
    password: import.meta.env.DB_PASSWORD || '',
    driver: import.meta.env.DB_DRIVER || 'ODBC Driver 17 for SQL Server',
  },
  
  mdvr: {
    baseUrl: import.meta.env.MDVR_BASE_URL || 'http://mdvr.itecknologi.com:8080',
    account: import.meta.env.MDVR_ACCOUNT || 'dhl',
    password: import.meta.env.MDVR_PASSWORD || 'dHl@mdvr',
  },
  
  gps: {
    baseUrl: import.meta.env.GPS_BASE_URL || 'http://webtrack.itecknologi.com/api',
    username: import.meta.env.GPS_USERNAME,
    password: import.meta.env.GPS_PASSWORD,
  },
  
  app: {
    name: 'iTecknologi Command Center',
    version: '2.0.0',
    env: (import.meta.env.MODE as any) || 'development',
  },
};

// Validate critical configuration
export function validateConfig(): string[] {
  const errors: string[] = [];
  
  if (!config.database.server) {
    errors.push('Database server not configured');
  }
  
  if (!config.database.password) {
    errors.push('Database password not configured');
  }
  
  if (!config.mdvr.baseUrl) {
    errors.push('MDVR API URL not configured');
  }
  
  return errors;
}

// Check if app is in development mode
export function isDevelopment(): boolean {
  return config.app.env === 'development';
}

// Check if app is in production mode
export function isProduction(): boolean {
  return config.app.env === 'production';
}

// Get API timeout (shorter in dev for faster feedback)
export function getApiTimeout(): number {
  return isDevelopment() ? 10000 : 15000;
}

// Get polling interval (longer in dev to reduce load)
export function getPollingInterval(): number {
  return isDevelopment() ? 10000 : 5000;
}
