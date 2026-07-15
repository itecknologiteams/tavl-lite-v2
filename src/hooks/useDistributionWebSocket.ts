/**
 * WebSocket hook for Alert Distribution
 * Handles real-time alert delivery to agents.
 * Falls back to HTTP polling when WebSocket is disconnected (M3).
 * Plays severity-differentiated notification sounds (L2).
 * Screen pops are handled DIRECTLY here (no CustomEvent indirection).
 */
import { useEffect, useRef, useCallback } from 'react';
import { useAlertDistributionStore, AlertAssignment } from '@store/alertDistributionStore';
import { useVehicleStore } from '@store/vehicleStore';

interface UseDistributionWebSocketOptions {
  agentId: string;
  role?: string;
  enabled?: boolean;
  extension?: string | null;
  onAlertAssigned?: (alert: AlertAssignment) => void;
}

const FALLBACK_POLL_MS = 15_000;

export function useDistributionWebSocket({
  agentId,
  role = 'agent',
  enabled = true,
  extension,
  onAlertAssigned,
}: UseDistributionWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const MAX_RECONNECT_DELAY = 60_000;
  
  const addNewAlert = useAlertDistributionStore((state) => state.addNewAlert);
  const updateAlert = useAlertDistributionStore((state) => state.updateAlert);
  const removeAlert = useAlertDistributionStore((state) => state.removeAlert);
  const fetchInbox = useAlertDistributionStore((state) => state.fetchInbox);
  const refreshSession = useAlertDistributionStore((state) => state.refreshSession);

  const startFallbackPoll = useCallback(() => {
    if (pollIntervalRef.current) return;
    fetchInbox();
    pollIntervalRef.current = setInterval(fetchInbox, FALLBACK_POLL_MS);
  }, [fetchInbox]);

  const stopFallbackPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    intentionalCloseRef.current = true;
    connectedRef.current = false;
    stopFallbackPoll();
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [stopFallbackPoll]);

  const connect = useCallback(() => {
    if (!enabled || !agentId) return;

    // Prevent duplicate connections
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    intentionalCloseRef.current = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('🔌 Distribution WebSocket connected');
        connectedRef.current = true;
        reconnectAttemptRef.current = 0;
        stopFallbackPoll();

        fetchInbox();

        ws.send(JSON.stringify({ type: 'identify', agentId, role, extension: extension || undefined }));

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat', agentId }));
          }
        }, 30_000);
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'alert:assigned':
              if (message.data?.assignment) {
                const assignment = message.data.assignment as AlertAssignment;
                addNewAlert(assignment);

                const severity = assignment.alert_data?.severity || 'low';
                playNotificationSound(severity);

                showNotification(
                  severity === 'critical' ? 'URGENT Alert Assigned' : 'New Alert Assigned',
                  `${assignment.alert_type}: ${assignment.vehicle_reg}`
                );

                onAlertAssigned?.(assignment);
              }
              break;
              
            case 'alert:acknowledged':
              if (message.data?.alertId) {
                updateAlert(message.data.alertId, {
                  acknowledged_at: message.data.acknowledgedAt,
                  status: 'acknowledged',
                });
              }
              break;
              
            case 'alert:resolved':
              if (message.data?.alertId) {
                removeAlert(message.data.alertId);
              }
              break;
              
            case 'alert:escalated':
              if (message.data?.alertId) {
                removeAlert(message.data.alertId);
              }
              break;
              
            case 'alert:timeout':
              if (message.data?.alertId) {
                if (message.data.reassignedFrom === agentId) {
                  removeAlert(message.data.alertId);
                } else if (message.data.reassignedTo === agentId) {
                  fetchInbox();
                }
              }
              break;
              
            case 'agent:status':
              if (message.data?.userId === agentId) {
                refreshSession();
              }
              if (role === 'supervisor') {
                const store = useAlertDistributionStore.getState();
                store.fetchAgents();
                store.fetchStats();
              }
              break;
              
            case 'break:approved':
              if (message.data?.userId === agentId) {
                refreshSession();
              }
              break;
              
            case 'inbox:refresh':
              fetchInbox();
              break;

            case 'alert:distributed':
            case 'alert:critical_escalation':
            case 'distribution:update': {
              const store = useAlertDistributionStore.getState();
              if (role === 'supervisor') {
                store.fetchAgents();
                store.fetchEscalated();
                store.fetchPending();
                store.fetchStats();
              }
              break;
            }

            case 'break:requested': {
              const store = useAlertDistributionStore.getState();
              if (role === 'supervisor') store.fetchAgents();
              break;
            }

            case 'agent:login':
            case 'agent:logout': {
              if (role === 'supervisor') {
                const store = useAlertDistributionStore.getState();
                store.fetchAgents();
                store.fetchStats();
              }
              break;
            }

            case 'alertConfig:changed': {
              if (role === 'supervisor') {
                window.dispatchEvent(new CustomEvent('alertConfigChanged'));
              }
              break;
            }

            case 'screenPop': {
              const sp = message.data;
              console.log(`📞 screenPop received: found=${sp?.found}, customer=${sp?.customer?.name}, vehicles=${sp?.vehicles?.length}`);
              
              // Dispatch event for any other listeners
              window.dispatchEvent(new CustomEvent('screenPop', { detail: sp }));

              // DIRECTLY open the vehicle panel — no dependency on ScreenPop component
              if (sp?.found && sp?.vehicles?.length > 0) {
                const plate = sp.vehicles[0].plateNumber;
                if (plate) {
                  handleScreenPopVehicle(plate, sp.customer?.name);
                }
              } else if (sp?.call?.callerId) {
                handleScreenPopByPhone(sp.call.callerId, sp.customer?.name);
              }
              break;
            }

            case 'callEvent': {
              window.dispatchEvent(new CustomEvent('callEvent', { detail: message.data }));
              break;
            }

            case 'identify:rejected':
              console.warn('🔌 WS identify rejected — will retry in 10s');
              intentionalCloseRef.current = true;
              if (ws.readyState === WebSocket.OPEN) ws.close();
              reconnectTimeoutRef.current = setTimeout(() => {
                intentionalCloseRef.current = false;
                connect();
              }, 10_000);
              break;

            default:
              break;
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      ws.onerror = () => {
        connectedRef.current = false;
      };
      
      ws.onclose = () => {
        console.log('🔌 Distribution WebSocket closed');
        const thisWs = wsRef.current;
        if (thisWs === ws) {
          wsRef.current = null;
        }
        connectedRef.current = false;

        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        // Only reconnect if the close was NOT intentional
        if (!intentionalCloseRef.current && enabled && agentId) {
          startFallbackPoll();
          const attempt = reconnectAttemptRef.current++;
          const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY) + Math.random() * 1000;
          reconnectTimeoutRef.current = setTimeout(() => {
            connectedRef.current = false;
            connect();
          }, delay);
        }
      };
    } catch (error) {
      console.error('🔌 Failed to connect WebSocket:', error);
      connectedRef.current = false;
      
      if (!intentionalCloseRef.current && enabled && agentId) {
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY) + Math.random() * 1000;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, agentId, role]);

  useEffect(() => {
    connect();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Push extension to the server whenever it changes (after the WS is already open).
  // The initial value is sent in the identify message; this covers later changes
  // (user configures softphone after login, or switches extensions).
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'register-extension', extension: extension || undefined }));
  }, [extension]);

  return {
    connected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnect: connect,
  };
}

// ─── Screen Pop: directly open vehicle panel ─────────────────────────────────

let _lastScreenPopPlate = '';
let _lastScreenPopTime = 0;

function handleScreenPopVehicle(plateNumber: string, customerName?: string) {
  const now = Date.now();
  if (_lastScreenPopPlate === plateNumber && now - _lastScreenPopTime < 30_000) {
    console.log(`📞 Screen Pop: Skipping duplicate for ${plateNumber}`);
    return;
  }
  _lastScreenPopPlate = plateNumber;
  _lastScreenPopTime = now;

  console.log(`📞 Screen Pop (WS): Searching for plate "${plateNumber}" (customer: ${customerName || 'unknown'})...`);

  fetch(`/api/vehicles/search?term=${encodeURIComponent(plateNumber)}`)
    .then(r => r.json())
    .then(result => {
      const vehicles = result.data || result.vehicles;
      if (result.success && vehicles?.length) {
        console.log(`📞 Screen Pop (WS): Opening vehicle ${plateNumber}`);
        useVehicleStore.getState().selectVehicle(vehicles[0]);
      } else {
        console.warn(`📞 Screen Pop (WS): Vehicle "${plateNumber}" not found in tracking`);
      }
    })
    .catch(e => console.warn('📞 Screen Pop (WS): Vehicle search failed:', e));
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length > 10) digits = digits.substring(2);
  if (digits.startsWith('0')) digits = digits.substring(1);
  return digits;
}

function handleScreenPopByPhone(callerId: string, customerName?: string) {
  const core = normalizePhone(callerId);
  if (!core || core.length < 7) return;

  const withZero = `0${core}`;
  console.log(`📞 Screen Pop (WS-phone): Searching by phone "${withZero}" (from "${callerId}")...`);

  fetch(`/api/vehicles/search?term=${encodeURIComponent(withZero)}`)
    .then(r => r.json())
    .then(result => {
      const vehicles = result.data || result.vehicles;
      if (result.success && vehicles?.length) {
        console.log(`📞 Screen Pop (WS-phone): Found vehicle — opening ${vehicles[0].PlateNumber}`);
        useVehicleStore.getState().selectVehicle(vehicles[0]);
      } else {
        console.warn(`📞 Screen Pop (WS-phone): No vehicle found by phone "${withZero}"`);
      }
    })
    .catch(e => console.warn('📞 Screen Pop (WS-phone): Phone search failed:', e));
}


// ─── Audio & Notification helpers ────────────────────────────────────────────

let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playNotificationSound(severity: string = 'low') {
  try {
    const audioContext = getAudioContext();

    if (severity === 'critical') {
      for (let i = 0; i < 3; i++) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = i % 2 === 0 ? 1200 : 900;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.25, audioContext.currentTime + i * 0.2);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + (i + 1) * 0.2);
        osc.start(audioContext.currentTime + i * 0.2);
        osc.stop(audioContext.currentTime + (i + 1) * 0.2);
      }
    } else if (severity === 'high') {
      for (let i = 0; i < 2; i++) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = 1000;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, audioContext.currentTime + i * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.3 + 0.2);
        osc.start(audioContext.currentTime + i * 0.3);
        osc.stop(audioContext.currentTime + i * 0.3 + 0.2);
      }
    } else {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      osc.start(audioContext.currentTime);
      osc.stop(audioContext.currentTime + 0.4);
    }
  } catch {
    // Audio not available
  }
}

function showNotification(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'alert-distribution',
    });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: 'alert-distribution',
        });
      }
    });
  }
}

export default useDistributionWebSocket;
