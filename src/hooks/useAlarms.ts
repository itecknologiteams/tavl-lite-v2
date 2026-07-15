import { useEffect, useCallback, useRef, useState } from 'react';
import { useAlarmStore } from '@store/alarmStore';
import { api, isElectron, subscribeToWs, initWebSocket } from '@services/api';
import type { Alarm } from '@apptypes/vehicle';

// Maximum alerts to show at once
const MAX_ALERTS = 20;

// Polling interval for checking new alerts (30 seconds - give agents time)
const POLL_INTERVAL = 30000;

// Time window for alerts (60 minutes)
const TIME_WINDOW_MINUTES = 60;

/**
 * Custom hook to monitor and manage real-time events/alarms
 * 
 * Fetches from Tracking.dbo.ConsoleWarning (192.168.20.1)
 * Shows Geofence, Battery, and Late Night alerts (important for agents)
 * These alerts have robocall data available
 * Limited to 20 alerts at a time to give agents time to acknowledge
 */
export const useAlarms = () => {
  const { alarms, setAlarms, addAlarm, acknowledgeAlarm: storeAcknowledge } = useAlarmStore();
  const maxEventIdRef = useRef<string>('0');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAlertsRef = useRef<Alarm[]>([]); // Queue for alerts waiting to be shown
  const [isPolling, setIsPolling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Get the appropriate API
  const getAlertsApi = useCallback(() => {
    if (isElectron()) {
      return (window as any).electron?.alerts;
    }
    return api.alerts;
  }, []);

  // Transform API alert data to store Alarm format
  const transformAlert = useCallback((alert: any): Alarm & { warningId?: string } => ({
    id: alert.id,
    warningId: alert.warningId, // Keep warningId for direct robocall lookup
    vehicleId: alert.vehicleId,
    vehicleName: alert.vehicleName,
    alarmType: alert.alarmType,
    alarmTypeId: alert.alarmTypeId || 0,
    description: alert.description,
    latitude: alert.latitude || 0,
    longitude: alert.longitude || 0,
    occurredAt: new Date(alert.occurredAt),
    appearedAt: new Date(alert.appearedAt || alert.occurredAt),
    acknowledged: false,
    severity: alert.severity || 'low',
  }), []);

  // Add alerts from pending queue when there's room
  const processQueue = useCallback(() => {
    const currentAlarms = useAlarmStore.getState().alarms;
    const unackedCount = currentAlarms.filter(a => !a.acknowledged).length;
    const roomAvailable = MAX_ALERTS - unackedCount;
    
    if (roomAvailable > 0 && pendingAlertsRef.current.length > 0) {
      const toAdd = pendingAlertsRef.current.splice(0, roomAvailable);
      toAdd.forEach(alert => {
        addAlarm(alert);
      });
      setPendingCount(pendingAlertsRef.current.length);
      console.log(`📥 Added ${toAdd.length} alerts from queue (${pendingAlertsRef.current.length} pending)`);
    }
  }, [addAlarm]);

  // Load initial alerts from ConsoleWarning
  const loadInitialAlerts = useCallback(async () => {
    console.log('🔔 Loading initial alerts from ConsoleWarning...');
    
    try {
      const alertsApi = getAlertsApi();
      // Use getWarnings (ConsoleWarning) for Geofence/Battery/Late Night alerts
      if (!alertsApi?.getWarnings) {
        console.warn('⚠️ Alerts API not available');
        setAlarms([]);
        return;
      }
      
      const result = await alertsApi.getWarnings({
        limit: MAX_ALERTS,
        sinceMinutes: TIME_WINDOW_MINUTES,
      });
      
      if (!result.success) {
        console.error('❌ Failed to load alerts:', result.error);
        setLastError(result.error || 'Unknown error');
        setAlarms([]);
        return;
      }
      
      const alerts = (result.data || []).map(transformAlert);
      maxEventIdRef.current = result.maxId || '0';
      
      // Clear pending queue
      pendingAlertsRef.current = [];
      setPendingCount(0);
      
      console.log(`✅ Loaded ${alerts.length} ConsoleWarning alerts (max ID: ${maxEventIdRef.current})`);
      setAlarms(alerts);
      setLastError(null);
      
    } catch (error: any) {
      console.error('❌ Error loading alerts:', error.message);
      setLastError(error.message);
      setAlarms([]);
    }
  }, [setAlarms, transformAlert, getAlertsApi]);

  // Poll for new alerts from ConsoleWarning (HTTP polling fallback for web)
  const pollNewAlerts = useCallback(async () => {
    if (!maxEventIdRef.current || maxEventIdRef.current === '0') return;
    
    try {
      const alertsApi = getAlertsApi();
      if (!alertsApi?.getWarnings) return;
      
      const result = await alertsApi.getWarnings({
        limit: 10, // Only fetch a few new ones at a time
        sinceMinutes: 5,
        sinceId: maxEventIdRef.current,
      });
      
      if (!result.success) {
        console.warn('⚠️ Poll failed:', result.error);
        return;
      }
      
      if (result.data && result.data.length > 0) {
        const newAlerts = result.data.map(transformAlert);
        maxEventIdRef.current = result.maxId || maxEventIdRef.current;
        
        // Add to pending queue
        pendingAlertsRef.current.push(...newAlerts);
        setPendingCount(pendingAlertsRef.current.length);
        
        console.log(`🔔 ${newAlerts.length} new ConsoleWarning alerts queued (${pendingAlertsRef.current.length} total pending)`);
        
        // Try to process queue
        processQueue();
        
        // Play sound for critical alerts
        if (newAlerts.some((a: Alarm) => a.severity === 'critical')) {
          playAlertSound();
        }
      }
      
    } catch (error: any) {
      console.warn('⚠️ Poll error:', error.message);
    }
  }, [transformAlert, processQueue, getAlertsApi]);

  // Handle WebSocket alerts (for web mode)
  const handleWsAlerts = useCallback((alerts: any[]) => {
    if (!alerts || alerts.length === 0) return;
    
    const newAlerts = alerts.map(transformAlert);
    const latestId = alerts[alerts.length - 1]?.id;
    if (latestId) {
      maxEventIdRef.current = latestId;
    }
    
    // Add to pending queue
    pendingAlertsRef.current.push(...newAlerts);
    setPendingCount(pendingAlertsRef.current.length);
    
    console.log(`📡 WS: ${newAlerts.length} new alerts (${pendingAlertsRef.current.length} total pending)`);
    
    // Try to process queue
    processQueue();
    
    // Play sound for critical alerts
    if (newAlerts.some((a: Alarm) => a.severity === 'critical')) {
      playAlertSound();
    }
  }, [transformAlert, processQueue]);

  // Start/stop polling
  useEffect(() => {
    // Load initial alerts
    loadInitialAlerts();
    
    // In web mode, use WebSocket for real-time updates + polling as fallback
    let unsubscribe: (() => void) | null = null;
    
    if (!isElectron()) {
      // Initialize WebSocket
      initWebSocket();
      
      // Subscribe to WebSocket alerts
      unsubscribe = subscribeToWs('alerts', handleWsAlerts);
    }
    
    // Start polling (works for both Electron and web as fallback)
    const startPolling = () => {
      if (pollingRef.current) return;
      
      pollingRef.current = setInterval(pollNewAlerts, POLL_INTERVAL);
      setIsPolling(true);
      console.log('▶️ Started alerts polling (30s interval)');
    };
    
    // Delay polling start
    const timer = setTimeout(startPolling, 5000);
    
    return () => {
      clearTimeout(timer);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        setIsPolling(false);
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [loadInitialAlerts, pollNewAlerts, handleWsAlerts]);

  // Acknowledge alarm and process queue
  const acknowledgeAlarm = useCallback(async (alarmId: string) => {
    storeAcknowledge(alarmId);
    
    // Process queue after a short delay to add new alert
    setTimeout(() => {
      processQueue();
    }, 500);
  }, [storeAcknowledge, processQueue]);

  // Refresh alerts manually
  const refreshAlerts = useCallback(async () => {
    maxEventIdRef.current = '0';
    pendingAlertsRef.current = [];
    setPendingCount(0);
    await loadInitialAlerts();
  }, [loadInitialAlerts]);

  return {
    acknowledgeAlarm,
    refreshAlerts,
    isPolling,
    lastError,
    pendingCount,
  };
};

// Play alert sound for critical events
function playAlertSound() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.warn('Could not play alert sound');
  }
}
