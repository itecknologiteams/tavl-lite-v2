import { useState, useEffect, useCallback } from 'react';

export interface VehicleAlert {
  id: string;
  vehicleId: string;
  alarmType: string;
  description: string;
  latitude: number;
  longitude: number;
  speed: number;
  occurredAt: string;
  appearedAt: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'critical' | 'warning' | 'geofence' | 'info';
  value: any;
  source?: 'eventlog' | 'console';
}

interface UseVehicleAlertsOptions {
  days?: number;
  start?: string;
  end?: string;
  limit?: number;
  enabled?: boolean;
}

export const useVehicleAlerts = (
  objectId: string | number | null,
  options: UseVehicleAlertsOptions = {}
) => {
  const { days = 7, start, end, limit = 20, enabled = true } = options;
  
  const [alerts, setAlerts] = useState<VehicleAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchAlerts = useCallback(async () => {
    if (!objectId || !enabled) {
      setAlerts([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const qs = new URLSearchParams();
      if (start) qs.set('start', start);
      if (end) qs.set('end', end);
      if (!start && !end) qs.set('days', String(days));
      qs.set('limit', String(limit));

      const response = await fetch(`/api/alerts/vehicle/${objectId}?${qs.toString()}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch vehicle alerts');
      }

      const result = await response.json();

      if (result.success) {
        const mapped = (result.data || []).map((a: any) => ({ ...a, source: a.source || 'eventlog' }));
        setAlerts(mapped);
        setTotal(result.total || 0);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Vehicle alerts fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
      setAlerts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [objectId, days, start, end, limit, enabled]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  return {
    alerts,
    loading,
    error,
    total,
    refresh: fetchAlerts,
  };
};

// Severity configuration for UI
export const ALERT_SEVERITY_CONFIG = {
  critical: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/50',
    label: 'Critical',
  },
  high: {
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    borderColor: 'border-orange-500/50',
    label: 'Warning',
  },
  medium: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/50',
    label: 'Geofence',
  },
  low: {
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    borderColor: 'border-gray-500/50',
    label: 'Info',
  },
};

// Get icon based on alert type
export const getAlertIcon = (alarmType: string): string => {
  const lowerType = (alarmType || '').toLowerCase();
  
  if (lowerType.includes('panic') || lowerType.includes('sos') || lowerType.includes('emergency')) {
    return '🆘';
  }
  if (lowerType.includes('speed') || lowerType.includes('over')) {
    return '⚡';
  }
  if (lowerType.includes('battery') || lowerType.includes('power') || lowerType.includes('volt')) {
    return '🔋';
  }
  if (lowerType.includes('geofence') || lowerType.includes('roaming')) {
    return '📍';
  }
  if (lowerType.includes('movement')) {
    return '🚨';
  }
  
  // City names = geofence
  const cities = ['rawalpindi', 'islamabad', 'lahore', 'karachi', 'faisalabad', 'multan', 'peshawar'];
  if (cities.some(city => lowerType.includes(city))) {
    return '🏙️';
  }
  
  return '🔔';
};
