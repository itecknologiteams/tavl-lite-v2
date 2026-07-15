/**
 * Hook to fetch and auto-refresh robocall (autocall) status for a set of alerts.
 * Uses the /api/robocall/lookup batch endpoint and refreshes every 45 seconds.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@services/api';
import type { AlertAssignment } from '@store/alertDistributionStore';

export interface RobocallStatus {
  alertId: string;
  warningId?: string;
  status: 'dialing' | 'ringing' | 'answered' | 'no_answer' | 'rejected' | 'failed' | 'unavailable' | 'unknown';
  statusCode: number;
  statusText?: string;
  callPlacedAt?: string;
  callReceivedAt?: string;
  callEndedAt?: string;
  duration: number;
  userInput: string;
  phoneNumber: string;
}

const REFRESH_INTERVAL_MS = 30_000;

// Build the per-alert lookup payload. Plate is the reliable key into CallDetails.RegNum
// (alerts come from EventLog and carry no WarningId; the alert's vehicleId is ObjectId,
// not CallDetails.VehicleId). alert_type lets the server prefer the correct AlertType
// (1=battery/Event, 2=geofence/Warning). timestamp = the alert's event time (occurredAt),
// matched against CallDetails.CallPlacedTime as wall-clock — NOT the agent assignment time.
function toLookupItem(a: AlertAssignment) {
  const data = typeof a.alert_data === 'string'
    ? (() => { try { return JSON.parse(a.alert_data); } catch { return null; } })()
    : a.alert_data;
  return {
    id: a.alert_id,
    reg: a.vehicle_reg,
    alertType: a.alert_type,
    objectId: data?.vehicleId ? String(data.vehicleId) : undefined,
    timestamp: data?.occurredAt || a.created_at || a.assigned_at,
  };
}

export function useRobocallStatus(alerts: AlertAssignment[]) {
  const [statusMap, setStatusMap] = useState<Record<string, RobocallStatus>>({} as Record<string, RobocallStatus>);
  const [loading, setLoading] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const prevKeysRef = useRef('');

  const fetchStatuses = useCallback(async (alertList: AlertAssignment[]) => {
    if (alertList.length === 0) {
      setStatusMap({} as Record<string, RobocallStatus>);
      return;
    }

    try {
      setLoading(true);
      const res = await api.robocall.lookupBatch(alertList.map(toLookupItem));
      if (res.success && res.data) {
        setStatusMap(res.data as Record<string, RobocallStatus>);
      }
    } catch {
      // Robocall DB may be unavailable — don't block inbox
    } finally {
      setLoading(false);
    }
  }, []);

  // On-demand refresh for a single alert (agent clicks its badge). Single-plate lookup
  // is a fast, reliable index seek — and merges into statusMap without disturbing others.
  const refreshOne = useCallback(async (alert: AlertAssignment) => {
    const id = alert.alert_id;
    setRefreshingIds(prev => new Set(prev).add(id));
    try {
      const res = await api.robocall.lookupBatch([toLookupItem(alert)]);
      if (res.success && res.data) {
        const incoming = (res.data as Record<string, RobocallStatus>)[id];
        setStatusMap(prev => {
          const next = { ...prev };
          if (incoming) next[id] = incoming;
          else delete next[id]; // confirmed no call → clear any stale status
          return next;
        });
      }
    } catch {
      // ignore — leave existing status untouched
    } finally {
      setRefreshingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  useEffect(() => {
    const keys = alerts.map(a => a.alert_id).sort().join(',');
    const changed = keys !== prevKeysRef.current;
    prevKeysRef.current = keys;

    if (alerts.length === 0) {
      setStatusMap({} as Record<string, RobocallStatus>);
      return;
    }

    // Fetch immediately on mount or when alert list changes
    if (changed) fetchStatuses(alerts);

    const interval = setInterval(() => fetchStatuses(alerts), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [alerts, fetchStatuses]);

  return { statusMap, loading, refreshOne, refreshingIds };
}
