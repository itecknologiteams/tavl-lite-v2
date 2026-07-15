/**
 * Call Management API Routes
 * Handles call origination, hangup, transfer, status, and caller lookup
 * 
 * Screen Pop: When an inbound call arrives, lookup customer info by phone number
 */

import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import path from 'path';
import eslConnection from '../freeswitch/esl';
import { queryCrm } from '../db/crm';
import { QUEUE_AGENT_EXTENSIONS } from './distribution';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const router = Router();
const execAsync = promisify(exec);

const getFreeSwitchEnv = () => ({
  host: process.env.FREESWITCH_HOST || '192.168.20.140',
  sshUser: process.env.FREESWITCH_SSH_USER || 'iteckadmin',
  sshPass: process.env.FREESWITCH_SSH_PASSWORD || '',
});

/**
 * Normalize phone number for search
 * Removes spaces, dashes, parentheses, and leading zeros/country codes
 */
function normalizePhone(phone: string): string {
  // Remove all non-digits
  let normalized = phone.replace(/\D/g, '');
  
  // Handle Pakistan numbers (92 prefix)
  if (normalized.startsWith('92') && normalized.length > 10) {
    normalized = normalized.substring(2);
  }
  // Handle leading zeros
  if (normalized.startsWith('0')) {
    normalized = normalized.substring(1);
  }
  
  return normalized;
}

/**
 * GET /api/calls/lookup/:phone
 * Screen Pop - Lookup customer info by phone number
 * Returns: customer details, all vehicles, recent alerts, complaints
 */
router.get('/lookup/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    
    if (!phone || phone.length < 7) {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required (min 7 digits)',
      });
    }

    const normalizedPhone = normalizePhone(phone);
    console.log(`🔍 Screen Pop: Looking up customer for phone ${phone} (normalized: ${normalizedPhone})`);

    // Search CRM MSSQL directly for customer by phone number
    const phonePattern = `%${normalizedPhone}%`;
    const customers = await queryCrm(`
      SELECT DISTINCT TOP 5
        c.CUST_ID as customerId,
        c.FNAME as customerName,
        c.ADRESS as address,
        c.CONT1 as phone1,
        c.CONT2 as phone2,
        c.EMAIL as email,
        c.CNIC as nic
      FROM CUSTOMER c WITH (NOLOCK)
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(c.CONT1, ' ', ''), '-', ''), '(', ''), ')', '') LIKE @phone
         OR REPLACE(REPLACE(REPLACE(REPLACE(c.CONT2, ' ', ''), '-', ''), '(', ''), ')', '') LIKE @phone
    `, { phone: phonePattern });

    if (!customers || customers.length === 0) {
      console.log(`📞 No customer found for phone: ${phone}`);
      return res.json({
        success: true,
        found: false,
        phone: phone,
        message: 'No customer found for this phone number',
      });
    }

    const customer = customers[0];
    console.log(`✅ Found customer: ${customer.customerName} (ID: ${customer.customerId})`);

    // Get all vehicles for this customer from CRM MSSQL directly
    const vehicles = await queryCrm(`
      SELECT
        v.V_ID as vehicleId,
        v.VEH_REG as plateNumber,
        mk.MK_NAME as make,
        m.M_NAME as model,
        cl.CL_NAME as color,
        y.Y_NAME as year,
        v.ENGINE as engineNumber,
        v.CHASIS as chassisNumber,
        vd.Vehicle_IMEINo as imei,
        vd.Vehicle_SIM as simNumber,
        vd.Vehicle_DateOfInstallation as installDate
      FROM INSTALLATION i WITH (NOLOCK)
      INNER JOIN VEHICLES v WITH (NOLOCK) ON i.V_ID = v.V_ID
      LEFT JOIN MAKE mk WITH (NOLOCK) ON v.MK_ID = mk.MK_ID
      LEFT JOIN MODEL m WITH (NOLOCK) ON v.M_ID = m.M_ID
      LEFT JOIN COLOR cl WITH (NOLOCK) ON v.CL_ID = cl.CL_ID
      LEFT JOIN YEARS y WITH (NOLOCK) ON v.Y_ID = y.Y_ID
      LEFT JOIN VehiclesDetails_Table vd WITH (NOLOCK) ON v.V_ID = vd.Vehicle_Id
      WHERE i.CUST_ID = @custId
      ORDER BY vd.Vehicle_DateOfInstallation DESC
    `, { custId: customer.customerId });
    console.log(`🚗 Found ${vehicles.length} vehicles for customer`);

    // Get vehicle IDs for fetching alerts and complaints
    const vehicleIds = vehicles.map((v: any) => v.vehicleId);
    
    // Get recent alerts for all vehicles (last 30 days)
    let recentAlerts: any[] = [];
    if (vehicleIds.length > 0) {
      const alertsQuery = `
        SELECT TOP 10
          ld.LOG_ID as logId,
          ld.VEH_ID as vehicleId,
          v.V_REG_NO as plateNumber,
          ld.LOG_TYPE as logType,
          ld.LOG_DETAIL as detail,
          ld.LOG_DATE as logDate,
          ld.LOG_BY as logBy
        FROM LOG_DETAILS ld WITH (NOLOCK)
        INNER JOIN VEHICLES v WITH (NOLOCK) ON ld.VEH_ID = v.V_ID
        WHERE ld.VEH_ID IN (${vehicleIds.join(',')})
          AND ld.LOG_TYPE NOT IN ('general_logs', 'SMS_TAB')
          AND ld.LOG_DATE >= DATEADD(day, -30, GETDATE())
        ORDER BY ld.LOG_DATE DESC
      `;
      
      try {
        recentAlerts = await queryCrm(alertsQuery, {});
      } catch (e) {
        console.warn('Could not fetch alerts:', e);
      }
    }

    // Get recent complaints for all vehicles
    let recentComplaints: any[] = [];
    if (vehicleIds.length > 0) {
      const complaintsQuery = `
        SELECT TOP 5
          ld.LOG_ID as logId,
          ld.VEH_ID as vehicleId,
          v.V_REG_NO as plateNumber,
          ld.LOG_DETAIL as detail,
          ld.LOG_DATE as logDate,
          ld.LOG_BY as logBy,
          ld.LOG_STATUS as status
        FROM LOG_DETAILS ld WITH (NOLOCK)
        INNER JOIN VEHICLES v WITH (NOLOCK) ON ld.VEH_ID = v.V_ID
        WHERE ld.VEH_ID IN (${vehicleIds.join(',')})
          AND ld.LOG_TYPE IN ('COMPLAIN', 'COMPLAIN-NEW')
        ORDER BY ld.LOG_DATE DESC
      `;
      
      try {
        recentComplaints = await queryCrm(complaintsQuery, {});
      } catch (e) {
        console.warn('Could not fetch complaints:', e);
      }
    }

    // Get call history from LOG_DETAILS (LOCATION_ON_CALL logs)
    let callHistory: any[] = [];
    if (vehicleIds.length > 0) {
      const callHistoryQuery = `
        SELECT TOP 10
          ld.LOG_ID as logId,
          ld.VEH_ID as vehicleId,
          v.V_REG_NO as plateNumber,
          ld.LOG_DETAIL as detail,
          ld.LOG_DATE as callDate,
          ld.LOG_BY as agent
        FROM LOG_DETAILS ld WITH (NOLOCK)
        INNER JOIN VEHICLES v WITH (NOLOCK) ON ld.VEH_ID = v.V_ID
        WHERE ld.VEH_ID IN (${vehicleIds.join(',')})
          AND ld.LOG_TYPE = 'LOCATION_ON_CALL'
        ORDER BY ld.LOG_DATE DESC
      `;
      
      try {
        callHistory = await queryCrm(callHistoryQuery, {});
      } catch (e) {
        console.warn('Could not fetch call history:', e);
      }
    }

    // Return complete screen pop data
    res.json({
      success: true,
      found: true,
      phone: phone,
      customer: {
        id: customer.customerId,
        name: customer.customerName,
        address: customer.address,
        phone1: customer.phone1,
        phone2: customer.phone2,
        email: customer.email,
        nic: customer.nic,
      },
      vehicles: vehicles.map((v: any) => ({
        id: v.vehicleId,
        plateNumber: v.plateNumber,
        make: v.make,
        model: v.model,
        color: v.color,
        type: v.vehicleType,
        year: v.year,
        imei: v.imei,
        simNumber: v.simNumber,
        installDate: v.installDate,
      })),
      recentAlerts: recentAlerts,
      recentComplaints: recentComplaints,
      callHistory: callHistory,
      summary: {
        vehicleCount: vehicles.length,
        alertCount: recentAlerts.length,
        complaintCount: recentComplaints.length,
      },
    });

  } catch (error) {
    console.error('Phone lookup error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/calls/inbound
 * Get currently ringing inbound calls
 */
router.get('/inbound', (_req: Request, res: Response) => {
  try {
    const inboundCalls = eslConnection.getActiveInboundCalls();
    res.json({
      success: true,
      calls: inboundCalls,
    });
  } catch (error) {
    console.error('Get inbound calls error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/calls/originate
 * Originate a call from agent to customer
 */
router.post('/originate', async (req: Request, res: Response) => {
  try {
    const { extension, destination, callerId, callerIdName } = req.body;

    if (!extension || !destination) {
      return res.status(400).json({
        success: false,
        error: 'Extension and destination are required',
      });
    }

    console.log(`📞 Originating call: ${extension} -> ${destination}`);

    const result = await eslConnection.originateCall({
      extension,
      destination,
      callerId,
      callerIdName,
    });

    res.json(result);
  } catch (error) {
    console.error('Originate error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/calls/hangup
 * Hangup an active call
 */
router.post('/hangup', async (req: Request, res: Response) => {
  try {
    const { channel } = req.body;

    if (!channel) {
      return res.status(400).json({
        success: false,
        error: 'Channel is required',
      });
    }

    const result = await eslConnection.hangupCall(channel);
    res.json(result);
  } catch (error) {
    console.error('Hangup error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/calls/transfer
 * Transfer an active call to another extension/number
 */
router.post('/transfer', async (req: Request, res: Response) => {
  try {
    const { channel, destination } = req.body;

    if (!channel || !destination) {
      return res.status(400).json({
        success: false,
        error: 'Channel and destination are required',
      });
    }

    const result = await eslConnection.transferCall(channel, destination);
    res.json(result);
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/calls/hold
 * Toggle hold on the agent's active call via FreeSWITCH uuid_hold (plays MOH)
 */
router.post('/hold', async (req: Request, res: Response) => {
  try {
    const { extension, hold } = req.body;

    if (!extension || typeof hold !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'extension (string) and hold (boolean) are required',
      });
    }

    const result = await eslConnection.holdCall(extension, hold);
    res.json(result);
  } catch (error) {
    console.error('Hold error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/calls/mute
 * Mute/unmute the agent's outgoing audio via FreeSWITCH uuid_audio (AMI/click-to-call mode).
 */
router.post('/mute', async (req: Request, res: Response) => {
  try {
    const { extension, mute } = req.body;

    if (!extension || typeof mute !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'extension (string) and mute (boolean) are required',
      });
    }

    const result = await eslConnection.muteCall(extension, mute);
    res.json(result);
  } catch (error) {
    console.error('Mute error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/calls/attended-transfer
 * Complete an attended transfer: bridge the held call's partner with the consult call's partner.
 * The agent must be on hold on Call A (partnerAUuid = customer) and actively speaking on Call B (consult).
 */
router.post('/attended-transfer', async (req: Request, res: Response) => {
  try {
    const { extension, partnerAUuid } = req.body;
    if (!extension || !partnerAUuid) {
      return res.status(400).json({ success: false, error: 'extension and partnerAUuid are required' });
    }
    const result = await eslConnection.attendedTransfer(extension, partnerAUuid);
    res.json(result);
  } catch (error) {
    console.error('Attended transfer error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/calls/active
 * Get list of active calls
 */
router.get('/active', async (_req: Request, res: Response) => {
  try {
    const channels = await eslConnection.getActiveChannels();
    res.json({
      success: true,
      calls: channels,
    });
  } catch (error) {
    console.error('Get active calls error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/calls/extension/:ext/status
 * Get extension status (registered, in-call, etc.)
 */
router.get('/extension/:ext/status', async (req: Request, res: Response) => {
  try {
    const { ext } = req.params;
    const status = await eslConnection.getExtensionStatus(ext);
    const sipStatus = await eslConnection.getSipPeerStatus(ext);

    res.json({
      success: true,
      extension: ext,
      ...status,
      registered: sipStatus.registered,
      sipAddress: sipStatus.address,
    });
  } catch (error) {
    console.error('Extension status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/calls/ami/status
 * Get AMI connection status
 */
router.get('/ami/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    connected: eslConnection.getConnectionStatus(),
    host: process.env.FREESWITCH_HOST,
    activeCalls: eslConnection.getActiveCalls().size,
  });
});

/**
 * GET /api/calls/config
 * Get SIP/PBX configuration for frontend
 */
router.get('/config', (_req: Request, res: Response) => {
  const { host: fsHost } = getFreeSwitchEnv();
  const wsPort = process.env.FREESWITCH_WS_PORT || '5066';

  res.json({
    success: true,
    config: {
      host: fsHost,
      sipPort: '5060',
      sipTransport: 'udp',
      context: 'default',
      wsServer: `ws://${fsHost}:${wsPort}`,
      realm: fsHost,
      stunServer: 'stun:stun.l.google.com:19302',
      amiConnected: eslConnection.getConnectionStatus(),
    },
  });
});

/**
 * GET /api/calls/extension-check/:ext
 * Probe Asterisk to check if an extension is WebRTC-ready (available to agents, no admin auth)
 */
router.get('/extension-check/:ext', async (req: Request, res: Response) => {
  try {
    const ext = req.params.ext;
    if (!/^\d{2,5}$/.test(ext)) {
      return res.json({ success: true, found: false, extension: ext, message: 'Invalid extension format' });
    }

    // Check registration via ESL
    const regStatus = await eslConnection.checkExtensionRegistered(ext);
    if (!regStatus.registered) {
      return res.json({ success: true, found: true, extension: ext, state: 'Unavailable', webrtcReady: true, issues: ['Extension not registered'], params: {} });
    }

    const extStatus = await eslConnection.getExtensionStatus(ext);
    const stateMap: Record<string, string> = {
      not_inuse: 'Not in use',
      inuse: 'In use',
      busy: 'Busy',
      ringing: 'Ringing',
      unavailable: 'Unavailable',
    };

    res.json({
      success: true,
      found: true,
      extension: ext,
      state: stateMap[extStatus.status] || 'Unknown',
      webrtcReady: true,
      issues: [],
      params: { contact: regStatus.contact || '' },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Conference (3-Way Call) Management ────────────────────────────

/**
 * POST /api/calls/conference/start
 * Start a 3-way conference from the agent's active call.
 * Redirects agent + customer into a ConfBridge, then dials the third party.
 */
router.post('/conference/start', async (req: Request, res: Response) => {
  try {
    const { extension, destination, callerId, callerIdName } = req.body;

    if (!extension || !destination) {
      return res.status(400).json({
        success: false,
        error: 'extension and destination are required',
      });
    }

    console.log(`🎤 Conference start request: ext=${extension} dest=${destination}`);
    const result = await eslConnection.startConference({
      extension,
      destination,
      callerId,
      callerIdName,
    });

    console.log(`🎤 Conference start result:`, JSON.stringify(result));
    res.json(result);
  } catch (error: any) {
    console.error('Conference start error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/conference/add
 * Add another participant to an existing conference room.
 */
router.post('/conference/add', async (req: Request, res: Response) => {
  try {
    const { destination, conferenceRoom, callerId, callerIdName } = req.body;

    if (!destination || !conferenceRoom) {
      return res.status(400).json({
        success: false,
        error: 'destination and conferenceRoom are required',
      });
    }

    const result = await eslConnection.addToConference({
      destination,
      conferenceRoom,
      callerId,
      callerIdName,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Conference add error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/calls/conference/:room/participants
 * List participants in a conference room.
 */
router.get('/conference/:room/participants', async (req: Request, res: Response) => {
  try {
    const { room } = req.params;
    const result = await eslConnection.getConferenceParticipants(room);
    res.json(result);
  } catch (error: any) {
    console.error('Conference participants error:', error);
    res.status(500).json({ success: false, participants: [], error: error.message });
  }
});

/**
 * POST /api/calls/conference/kick
 * Kick a participant from the conference.
 */
router.post('/conference/kick', async (req: Request, res: Response) => {
  try {
    const { conferenceRoom, memberId, uuid } = req.body;

    if (!conferenceRoom || !memberId) {
      return res.status(400).json({
        success: false,
        error: 'conferenceRoom and memberId are required',
      });
    }

    const result = await eslConnection.kickFromConference(conferenceRoom, memberId, uuid);
    res.json(result);
  } catch (error: any) {
    console.error('Conference kick error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/conference/mute
 * Mute or unmute a specific participant in a conference room.
 */
router.post('/conference/mute', async (req: Request, res: Response) => {
  try {
    const { conferenceRoom, memberId, mute } = req.body;

    if (!conferenceRoom || !memberId || typeof mute !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'conferenceRoom (string), memberId (string) and mute (boolean) are required',
      });
    }

    const result = await eslConnection.muteConferenceParticipant(conferenceRoom, memberId, mute);
    res.json(result);
  } catch (error: any) {
    console.error('Conference mute error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/conference/merge-held
 * Move the held customer from park+MoH into the active conference room.
 */
router.post('/conference/merge-held', async (req: Request, res: Response) => {
  try {
    const { conferenceRoom, holdRoom, heldChannelUuid } = req.body;
    console.log(`🎤 POST /conference/merge-held body:`, JSON.stringify(req.body));
    if (!conferenceRoom || !heldChannelUuid) {
      return res.status(400).json({ success: false, error: 'conferenceRoom and heldChannelUuid are required' });
    }
    const result = await eslConnection.mergeHeldToConference(conferenceRoom, holdRoom || '', heldChannelUuid);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/conference/end
 * Destroy the conference room and disconnect all participants.
 */
router.post('/conference/end', async (req: Request, res: Response) => {
  try {
    const { conferenceRoom } = req.body;
    if (!conferenceRoom) {
      return res.status(400).json({ success: false, error: 'conferenceRoom is required' });
    }
    const result = await eslConnection.endConference(conferenceRoom);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Queue Management ──────────────────────────────────────────────

const AUTOCALL_QUEUE = process.env.AUTOCALL_QUEUE || 'tavl-agents';

/**
 * POST /api/calls/queue/login
 * Add an agent's extension to the Asterisk queue.
 */
router.post('/queue/login', async (req: Request, res: Response) => {
  try {
    const { extension, queue } = req.body;

    if (!extension) {
      return res.status(400).json({ success: false, error: 'extension is required' });
    }

    // Only authorised call-center extensions may join the queue (prevents executive /
    // non-agent extensions from being added as ringing agents).
    if (!QUEUE_AGENT_EXTENSIONS.has(String(extension))) {
      return res.status(403).json({ success: false, error: `Extension ${extension} is not an authorised queue agent` });
    }

    const targetQueue = queue || AUTOCALL_QUEUE;
    const result = await eslConnection.queueAddMember(targetQueue, extension);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/queue/logout
 * Remove an agent's extension from the Asterisk queue.
 */
router.post('/queue/logout', async (req: Request, res: Response) => {
  try {
    const { extension, queue } = req.body;

    if (!extension) {
      return res.status(400).json({ success: false, error: 'extension is required' });
    }

    const targetQueue = queue || AUTOCALL_QUEUE;
    const result = await eslConnection.queueRemoveMember(targetQueue, extension);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/queue/pause
 * Pause/unpause an agent in the queue.
 */
router.post('/queue/pause', async (req: Request, res: Response) => {
  try {
    const { extension, paused, reason, queue } = req.body;

    if (!extension || paused === undefined) {
      return res.status(400).json({ success: false, error: 'extension and paused are required' });
    }

    const targetQueue = queue || AUTOCALL_QUEUE;
    const result = await eslConnection.queuePauseMember(targetQueue, extension, !!paused, reason);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/calls/queue/status
 * Get queue status — members and callers waiting.
 */
router.get('/queue/status', async (_req: Request, res: Response) => {
  try {
    const result = await eslConnection.queueStatus(AUTOCALL_QUEUE);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, members: [], callers: [], error: error.message });
  }
});

/**
 * POST /api/calls/ami/command
 * Run an Asterisk CLI command via AMI (admin only).
 */
router.post('/ami/command', async (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ success: false, error: 'command required' });
    const result = await eslConnection.sendCommand(command);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/ami/action
 * Send a raw AMI action (admin only).
 */
router.post('/ami/action', async (req: Request, res: Response) => {
  try {
    const { action: amiAction } = req.body;
    if (!amiAction) return res.status(400).json({ success: false, error: 'action object required' });
    const result = await eslConnection.sendAction(amiAction);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
