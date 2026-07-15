/**
 * Supervisor WebSocket Events Hook
 * Subscribes to real-time supervisor events
 */

import { useEffect } from 'react';
import { subscribeToWs, initWebSocket } from '@services/api';
import { useSupervisorStore } from '@store/supervisorStore';

export function useSupervisorEvents() {
  useEffect(() => {
    // Initialize WebSocket
    initWebSocket();
    
    // Get store functions via getState() to avoid dependency issues
    const getStore = () => useSupervisorStore.getState();

    // Subscribe to agent events
    const unsubAgentLogin = subscribeToWs('agentLogin', (data) => {
      console.log('📥 Agent login:', data);
      getStore().addActivity({
        agentId: data.agentId,
        agentName: data.name,
        action: 'login',
        details: `${data.name} logged in`,
      });
      getStore().refreshStats();
    });

    const unsubAgentLogout = subscribeToWs('agentLogout', (data) => {
      console.log('📥 Agent logout:', data);
      getStore().addActivity({
        agentId: data.agentId,
        agentName: data.name,
        action: 'logout',
        details: `${data.name} logged out`,
      });
      getStore().refreshStats();
    });

    const unsubAgentStatus = subscribeToWs('agentStatusChange', (data) => {
      console.log('📥 Agent status change:', data);
      getStore().updateAgent(data.agentId, { status: data.status });
      getStore().addActivity({
        agentId: data.agentId,
        action: 'status_change',
        details: `Agent changed status to ${data.status}`,
      });
      getStore().refreshStats();
    });

    // Subscribe to alert events
    const unsubAlertAssigned = subscribeToWs('alertAssigned', (data) => {
      console.log('📥 Alert assigned:', data);
      getStore().updateAlert(data.alertId, { 
        assignedTo: data.agentId, 
        status: 'assigned',
        assignedAt: new Date(),
      });
      getStore().addActivity({
        agentId: data.agentId,
        agentName: data.agentName,
        action: 'alert_assigned',
        details: `Alert assigned to ${data.agentName}`,
        alertId: data.alertId,
      });
      getStore().refreshStats();
    });

    const unsubAlertEscalated = subscribeToWs('alertEscalated', (data) => {
      console.log('📥 Alert escalated:', data);
      getStore().updateAlert(data.alertId, { status: 'escalated' });
      getStore().addActivity({
        action: 'escalation',
        details: `Alert ${data.alertId} escalated`,
        alertId: data.alertId,
      });
      getStore().refreshStats();
    });

    const unsubAlertResolved = subscribeToWs('alertResolved', (data) => {
      console.log('📥 Alert resolved:', data);
      getStore().updateAlert(data.alertId, { 
        status: 'resolved',
        resolvedAt: new Date(),
      });
      getStore().addActivity({
        agentId: data.agentId,
        action: 'alert_resolved',
        details: `Alert resolved`,
        alertId: data.alertId,
      });
      getStore().refreshStats();
    });

    // Subscribe to new activity events
    const unsubNewActivity = subscribeToWs('newActivity', (data) => {
      console.log('📥 New activity:', data);
      // Activity is already added server-side, just refresh if needed
    });

    // Subscribe to supervisor messages
    const unsubMessage = subscribeToWs('supervisorMessage', (data) => {
      console.log('📥 Supervisor message:', data);
      // Could show a toast notification here
      getStore().addActivity({
        action: 'broadcast_message' as any,
        details: `Broadcast: ${data.message}`,
      });
    });

    // Cleanup
    return () => {
      unsubAgentLogin();
      unsubAgentLogout();
      unsubAgentStatus();
      unsubAlertAssigned();
      unsubAlertEscalated();
      unsubAlertResolved();
      unsubNewActivity();
      unsubMessage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount
}
