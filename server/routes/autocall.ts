/**
 * Auto-Call API Routes
 *
 * Originates outbound calls to customers via Asterisk. The customer hears
 * a recorded greeting and can press 0 to be connected to an available agent
 * in the tavl-agents queue.
 */

import { Router, Request, Response } from 'express';
import eslConnection from '../freeswitch/esl';
import { queryPostgres } from '../db/postgres';

const router = Router();

const AUTOCALL_QUEUE = process.env.AUTOCALL_QUEUE || 'tavl-agents';

// In-memory tracking of active auto-calls (supplemented by Asterisk CDR)
const activeAutoCalls = new Map<string, {
  actionId: string;
  destination: string;
  alertId?: string;
  vehicleReg?: string;
  status: 'originating' | 'ringing' | 'answered' | 'completed' | 'failed' | 'no-answer';
  startedAt: number;
  answeredAt?: number;
  endedAt?: number;
  pressedZero?: boolean;
  agentConnected?: boolean;
}>();

/**
 * POST /api/autocall/call
 * Originate a single auto-call to a customer.
 */
router.post('/call', async (req: Request, res: Response) => {
  try {
    const { destination, callerId, callerIdName, alertId, vehicleReg, timeout } = req.body;

    if (!destination) {
      return res.status(400).json({ success: false, error: 'destination is required' });
    }

    if (!eslConnection.getConnectionStatus()) {
      return res.status(503).json({ success: false, error: 'PBX not connected' });
    }

    const result = await eslConnection.originateAutoCall({
      destination,
      callerId,
      callerIdName,
      timeout: timeout || 45,
      variables: {
        ...(alertId && { ALERT_ID: String(alertId) }),
        ...(vehicleReg && { VEHICLE_REG: vehicleReg }),
      },
    });

    if (result.success && result.actionId) {
      activeAutoCalls.set(result.actionId, {
        actionId: result.actionId,
        destination,
        alertId,
        vehicleReg,
        status: 'originating',
        startedAt: Date.now(),
      });

      // Log to database
      try {
        await queryPostgres(
          `INSERT INTO autocall_log (action_id, destination, alert_id, vehicle_reg, status, started_at)
           VALUES ($1, $2, $3, $4, 'originating', NOW())
           ON CONFLICT DO NOTHING`,
          [result.actionId, destination, alertId || null, vehicleReg || null]
        );
      } catch { /* table may not exist yet */ }
    }

    res.json(result);
  } catch (error: any) {
    console.error('❌ Auto-call error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/autocall/batch
 * Originate multiple auto-calls with a configurable delay between each.
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { calls, delayMs = 2000 } = req.body;

    if (!Array.isArray(calls) || calls.length === 0) {
      return res.status(400).json({ success: false, error: 'calls array is required' });
    }

    if (calls.length > 50) {
      return res.status(400).json({ success: false, error: 'Maximum 50 calls per batch' });
    }

    if (!eslConnection.getConnectionStatus()) {
      return res.status(503).json({ success: false, error: 'PBX not connected' });
    }

    const batchId = `batch-${Date.now()}`;
    const results: any[] = [];

    // Originate calls sequentially with delay
    for (let i = 0; i < calls.length; i++) {
      const { destination, callerId, callerIdName, alertId, vehicleReg, timeout } = calls[i];

      if (!destination) {
        results.push({ destination, success: false, error: 'missing destination' });
        continue;
      }

      const result = await eslConnection.originateAutoCall({
        destination,
        callerId,
        callerIdName,
        timeout: timeout || 45,
        variables: {
          BATCH_ID: batchId,
          ...(alertId && { ALERT_ID: String(alertId) }),
          ...(vehicleReg && { VEHICLE_REG: vehicleReg }),
        },
      });

      if (result.success && result.actionId) {
        activeAutoCalls.set(result.actionId, {
          actionId: result.actionId,
          destination,
          alertId,
          vehicleReg,
          status: 'originating',
          startedAt: Date.now(),
        });
      }

      results.push({ destination, ...result });

      // Delay between calls to avoid trunk congestion
      if (i < calls.length - 1 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    res.json({ success: true, batchId, total: calls.length, results });
  } catch (error: any) {
    console.error('❌ Batch auto-call error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/autocall/status/:actionId
 * Check the status of a specific auto-call.
 */
router.get('/status/:actionId', (req: Request, res: Response) => {
  const { actionId } = req.params;
  const call = activeAutoCalls.get(actionId);

  if (!call) {
    return res.status(404).json({ success: false, error: 'Auto-call not found' });
  }

  res.json({ success: true, data: call });
});

/**
 * GET /api/autocall/active
 * List all active auto-calls.
 */
router.get('/active', (_req: Request, res: Response) => {
  const active = Array.from(activeAutoCalls.values())
    .filter(c => c.status === 'originating' || c.status === 'ringing' || c.status === 'answered')
    .sort((a, b) => b.startedAt - a.startedAt);

  res.json({ success: true, data: active, count: active.length });
});

/**
 * POST /api/autocall/stop/:actionId
 * Hangup a specific active auto-call.
 */
router.post('/stop/:actionId', async (req: Request, res: Response) => {
  const { actionId } = req.params;
  const call = activeAutoCalls.get(actionId);

  if (!call) {
    return res.status(404).json({ success: false, error: 'Auto-call not found' });
  }

  // Find the channel associated with this call
  const activeCalls = eslConnection.getActiveCalls();
  let channelToHangup: string | null = null;

  for (const [, c] of activeCalls) {
    if (c.callerId === call.destination || c.channel?.includes(call.destination)) {
      channelToHangup = c.channel;
      break;
    }
  }

  if (channelToHangup) {
    const result = await eslConnection.hangupCall(channelToHangup);
    if (result.success) {
      call.status = 'completed';
      call.endedAt = Date.now();
    }
    res.json(result);
  } else {
    call.status = 'completed';
    call.endedAt = Date.now();
    res.json({ success: true, message: 'Call already ended or not found in active channels' });
  }
});

/**
 * POST /api/autocall/stop-all
 * Stop all active auto-calls.
 */
router.post('/stop-all', async (_req: Request, res: Response) => {
  let stopped = 0;
  for (const [, call] of activeAutoCalls) {
    if (call.status === 'originating' || call.status === 'ringing' || call.status === 'answered') {
      call.status = 'completed';
      call.endedAt = Date.now();
      stopped++;
    }
  }
  res.json({ success: true, stopped });
});

// Clean up completed calls older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, call] of activeAutoCalls) {
    if (call.startedAt < cutoff && (call.status === 'completed' || call.status === 'failed' || call.status === 'no-answer')) {
      activeAutoCalls.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Initialize the autocall_log table (call on server startup).
 */
export async function initAutoCallTable(): Promise<void> {
  try {
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS autocall_log (
        id SERIAL PRIMARY KEY,
        action_id VARCHAR(100) UNIQUE NOT NULL,
        batch_id VARCHAR(100),
        destination VARCHAR(50) NOT NULL,
        alert_id VARCHAR(100),
        vehicle_reg VARCHAR(50),
        status VARCHAR(30) DEFAULT 'originating',
        pressed_zero BOOLEAN DEFAULT FALSE,
        agent_connected BOOLEAN DEFAULT FALSE,
        agent_extension VARCHAR(20),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        answered_at TIMESTAMPTZ,
        agent_connected_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ autocall_log table ready');
  } catch (err: any) {
    console.warn('⚠️ Could not create autocall_log table:', err.message);
  }
}

export default router;
