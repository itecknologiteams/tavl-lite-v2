import { useCallback, useEffect, useState } from 'react';
import type { VehicleAlert } from './useVehicleAlerts';

interface UseVehicleConsoleAlertsOptions {
  days?: number;
  start?: string;
  end?: string;
  limit?: number;
  enabled?: boolean;
}

export const useVehicleConsoleAlerts = (
  params: { vehicleId?: number | null; objectId?: string | number | null },
  options: UseVehicleConsoleAlertsOptions = {}
) => {
  const { days = 7, start, end, limit = 20, enabled = true } = options;
  const { vehicleId, objectId } = params;

  const [alerts, setAlerts] = useState<VehicleAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchAlerts = useCallback(async () => {
    if (!enabled || (!vehicleId && !objectId)) {
      setAlerts([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const base = vehicleId
        ? `/api/alerts/console/vehicle/${vehicleId}`
        : `/api/alerts/console/object/${objectId}`;

      const qs = new URLSearchParams();
      if (start) qs.set('start', start);
      if (end) qs.set('end', end);
      if (!start && !end) qs.set('days', String(days));
      qs.set('limit', String(limit));

      const response = await fetch(`${base}?${qs.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch console alerts');

      const result = await response.json();
      if (result.success) {
        const mapped = (result.data || []).map((a: any) => ({ ...a, source: a.source || 'console' }));
        setAlerts(mapped);
        setTotal(result.total || mapped.length || 0);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Console alerts fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch console alerts');
      setAlerts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [enabled, vehicleId, objectId, days, start, end, limit]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  return { alerts, loading, error, total, refresh: fetchAlerts };
};

