import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Global error handlers to prevent server crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception (server kept running):', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection (server kept running):', reason);
});

// Import routes
import authRoutes from './routes/auth';
import vehicleRoutes from './routes/vehicles';
import alertRoutes from './routes/alerts';
import crmRoutes from './routes/crm';
import trackRoutes from './routes/track';
import callRoutes from './routes/calls';
import supervisorRoutes from './routes/supervisor';
import commandRoutes from './routes/commands';
import robocallRoutes from './routes/robocall';
import customerAppRoutes from './routes/customerApp';
import distributionRoutes from './routes/distribution';
import closureRoutes from './routes/closure';
import stolenTrackingRoutes, { initStolenTrackingTable } from './routes/stolenTracking';
import analyticsRoutes, { startAnalyticsRefresh, stopAnalyticsRefresh } from './routes/analytics';
import autocallRoutes, { initAutoCallTable } from './routes/autocall';
import cdrRoutes from './routes/cdr';
import pbxAdminRoutes from './routes/pbx-admin';

// Import database initializers
import { initTavlDatabase, closeTavlDatabase } from './db/tavl';
import { initPostgres, closePostgres, queryPostgres } from './db/postgres';
import { initFusionPbxDb, closeFusionPbxDb } from './db/fusionpbx';
import { initPbxAdminDb, closePbxAdminDb, ensurePbxSchema } from './db/pbx-admin-db';
import { queryCrm } from './db/crm';
import { initCrmDatabase, closeCrmDatabase } from './db/crm';
import {
  initAlertDistributionTables,
  markAllAgentsOffline,
  setAgentOffline,
  touchAgentActivity,
  markStaleAgentsOffline,
} from './db/alertDistribution';

// Import distribution engine for rule isolation enforcement
import { enforceRuleIsolation } from './services/distributionEngine';

// Import FreeSWITCH ESL (replaces Asterisk AMI)
import eslConnection, { initEsl } from './freeswitch/esl';

// Import WebSocket alert broadcaster
import { startAlertBroadcaster, stopAlertBroadcaster } from './websocket/alerts';
// Import timeout monitor
import { startTimeoutMonitor, stopTimeoutMonitor } from './services/timeoutMonitor';
// Import stolen vehicle tracking updater
import { startStolenTrackingUpdater, stopStolenTrackingUpdater } from './services/stolenTrackingUpdater';

const app = express();
const server = createServer(app);
let staleCheckInterval: NodeJS.Timeout | null = null;

// WebSocket server for real-time updates (noServer: manual upgrade routing
// so /ws/asterisk SIP proxy isn't rejected by ws library's path check)
const wss = new WebSocketServer({ noServer: true });

// Store connected clients with agent ID mapping
interface WSClient {
  ws: WebSocket;
  agentId?: string;
  role?: string;
  extension?: string;
}
export const wsClients = new Map<WebSocket, WSClient>();

// Protocol-level ping/pong to detect dead connections (e.g. laptop sleep, network drop)
const PING_INTERVAL_MS = 30_000;
const pingInterval = setInterval(() => {
  wsClients.forEach((client, ws) => {
    if ((ws as any).__isAlive === false) {
      wsClients.delete(ws);
      ws.terminate();
      return;
    }
    (ws as any).__isAlive = false;
    try { ws.ping(); } catch { wsClients.delete(ws); }
  });
}, PING_INTERVAL_MS);

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  (ws as any).__isAlive = true;
  ws.on('pong', () => { (ws as any).__isAlive = true; });
  wsClients.set(ws, { ws });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'register-extension') {
        const client = wsClients.get(ws);
        if (client) {
          client.extension = message.extension ? String(message.extension) : undefined;
          console.log(`🔌 WS extension registered: ${client.agentId || 'anonymous'} → ${client.extension || '(cleared)'}`);
        }
      }

      if (message.type === 'identify') {
        const client = wsClients.get(ws);
        if (client && message.extension) {
          client.extension = String(message.extension);
        }
        if (client && message.agentId) {
          import('./db/alertDistribution').then(({ getAgentSession, updateAgentStatus }) => {
            getAgentSession(message.agentId).then(async (session) => {
              if (!session) {
                console.warn(`🔌 WS identify rejected: no session found for ${message.agentId}`);
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'identify:rejected', reason: 'No session — call /distribution/login first' }));
                }
                return;
              }

              // If session was offline (e.g. after server restart), restore it
              if (session.status === 'offline') {
                console.log(`🔌 WS identify: restoring offline session for ${message.agentId}`);
                await updateAgentStatus(message.agentId, 'online').catch(() => {});
              }

              // Close stale connections for this agentId to prevent duplicates
              wsClients.forEach((existing, existingWs) => {
                if (existingWs !== ws && existing.agentId === message.agentId) {
                  wsClients.delete(existingWs);
                  try { existingWs.close(); } catch {}
                }
              });

              client.agentId = message.agentId;
              client.role = session.role || message.role;
              console.log(`🔌 WebSocket client identified: ${message.agentId} (${client.role})`);
              touchAgentActivity(message.agentId).catch(() => {});
              // Return any non-rule-matching alerts back to the pending pool
              if ((client.role || 'agent') === 'agent') {
                enforceRuleIsolation().catch((e) => console.error('❌ enforceRuleIsolation failed:', e?.message || e));
              }
            }).catch(() => {});
          }).catch(() => {});
        }
      }
      
      if (message.type === 'heartbeat') {
        const client = wsClients.get(ws);
        if (client?.agentId) {
          touchAgentActivity(client.agentId).catch(() => {});
        }
        // Respond with pong so the client knows the connection is alive
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
  
  ws.on('close', () => {
    const client = wsClients.get(ws);
    const agentId = client?.agentId;
    const extension = client?.extension;
    console.log(`🔌 WebSocket client disconnected: ${agentId || 'anonymous'} (ext: ${extension || 'none'})`);
    wsClients.delete(ws);
    
    if (agentId) {
      wsClients.forEach((c, cws) => {
        if (cws.readyState !== WebSocket.OPEN && cws.readyState !== WebSocket.CONNECTING) {
          wsClients.delete(cws);
        }
      });
      const hasOtherConnection = Array.from(wsClients.values()).some(
        c => c.agentId === agentId && c.ws.readyState === WebSocket.OPEN
      );
      if (!hasOtherConnection) {
        // Remove from FreeSWITCH queue so the agent stops getting offered calls
        if (extension) {
          const AUTOCALL_QUEUE = process.env.AUTOCALL_QUEUE || 'tavl-agents';
          eslConnection.queueRemoveMember(AUTOCALL_QUEUE, extension).catch(() => {});
          // Log any unmatched (no_answer) calls as missed due to disconnect
          import('./db/alertDistribution').then(({ updateAgentCallLogMissedByDisconnect }) => {
            updateAgentCallLogMissedByDisconnect(extension).catch(() => {});
          }).catch(() => {});
        }
        setAgentOffline(agentId).then(() => {
          console.log(`👋 Agent ${agentId} marked offline (WebSocket closed)`);
          sendToSupervisors('agent:logout', { userId: agentId, status: 'offline', logoutTime: new Date().toISOString() });
        }).catch(() => {});
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    const client = wsClients.get(ws);
    const agentId = client?.agentId;
    wsClients.delete(ws);
    
    if (agentId) {
      const hasOtherConnection = Array.from(wsClients.values()).some(
        c => c.agentId === agentId && c.ws.readyState === WebSocket.OPEN
      );
      if (!hasOtherConnection) {
        setAgentOffline(agentId).catch(() => {});
      }
    }
  });
});

// ── SIP WebSocket Proxy (WS-to-WS relay) ────────────────────────────
// Accepts the browser's WebSocket, opens a second WebSocket to FreeSWITCH,
// and relays SIP messages between them at the application level.
// This approach works reliably through intermediary WS proxies (Vite, nginx).
const FS_WS_HOST = process.env.FREESWITCH_HOST || '192.168.20.140';
const FS_WSS_PORT = parseInt(process.env.FREESWITCH_WSS_PORT || '7443');

const sipProxyWss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols: (protocols) => {
    if (protocols.has('sip')) return 'sip';
    return protocols.values().next().value || false;
  },
});

// Rewrite SIP Via/Contact transport headers at the WS↔WSS boundary.
// Browser connects to us over plain WS and puts SIP/2.0/WS in Via.
// FreeSWITCH only responds to messages whose Via matches the connection
// transport (WSS). We rewrite headers in both directions so FS sees WSS
// and the browser sees WS, keeping both sides consistent.
function rewriteSipTransport(raw: Buffer | string, toFs: boolean): string {
  const text = Buffer.isBuffer(raw) ? raw.toString('binary') : raw;
  const sepIdx = text.indexOf('\r\n\r\n');
  const headers = sepIdx >= 0 ? text.substring(0, sepIdx) : text;
  const body = sepIdx >= 0 ? text.substring(sepIdx) : '';

  const rewritten = headers.split('\r\n').map(line => {
    const low = line.toLowerCase();
    if (!low.startsWith('via:') && !low.startsWith('v:') &&
        !low.startsWith('contact:') && !low.startsWith('c:')) return line;
    if (toFs) {
      return line
        .replace(/SIP\/2\.0\/WS /g, 'SIP/2.0/WSS ')
        .replace(/;transport=ws([;>\s\r]|$)/gi, ';transport=wss$1');
    }
    return line
      .replace(/SIP\/2\.0\/WSS /g, 'SIP/2.0/WS ')
      .replace(/;transport=wss([;>\s\r]|$)/gi, ';transport=ws$1');
  });
  return rewritten.join('\r\n') + body;
}

function relaySipToFreeSwitch(req: import('http').IncomingMessage, socket: import('stream').Duplex, head: Buffer) {
  sipProxyWss.handleUpgrade(req, socket, head, (clientWs) => {
    const fsUrl = `wss://${FS_WS_HOST}:${FS_WSS_PORT}`;
    console.log(`📡 SIP relay: client connected, opening WSS to ${fsUrl}`);

    const fsWs = new WebSocket(fsUrl, ['sip'], {
      perMessageDeflate: false,
      rejectUnauthorized: false,
    });
    let fsReady = false;
    const pendingMessages: { data: any; isBinary: boolean }[] = [];

    fsWs.on('open', () => {
      console.log('📡 SIP relay: FreeSWITCH WS connected');
      fsReady = true;
      for (const msg of pendingMessages) {
        fsWs.send(rewriteSipTransport(msg.data, true), { binary: false });
      }
      pendingMessages.length = 0;
    });

    clientWs.on('message', (data, isBinary) => {
      const out = isBinary ? data : rewriteSipTransport(data as Buffer, true);
      if (fsReady && fsWs.readyState === WebSocket.OPEN) {
        fsWs.send(out, { binary: isBinary });
      } else {
        pendingMessages.push({ data: out, isBinary });
      }
    });

    fsWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        const out = isBinary ? data : rewriteSipTransport(data as Buffer, false);
        clientWs.send(out, { binary: isBinary });
      }
    });

    clientWs.on('close', (code) => {
      console.log(`📡 SIP relay: client closed (${code})`);
      if (fsWs.readyState === WebSocket.OPEN || fsWs.readyState === WebSocket.CONNECTING) {
        fsWs.close(1000);
      }
    });

    fsWs.on('close', (code) => {
      console.log(`📡 SIP relay: FreeSWITCH closed (${code})`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000);
      }
    });

    clientWs.on('error', (err) => { console.error('SIP relay client error:', err.message); fsWs.terminate(); });
    fsWs.on('error', (err) => { console.error('SIP relay FS error:', err.message); clientWs.terminate(); });
  });
}

server.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0];
  const subprotocol = (req.headers['sec-websocket-protocol'] || '').toLowerCase();

  // SIP proxy: dedicated path or 'sip' subprotocol on /ws
  if (pathname === '/ws/sip' || pathname === '/ws/asterisk' || (pathname === '/ws' && subprotocol.includes('sip'))) {
    console.log(`📡 SIP relay: routing to FreeSWITCH (path=${pathname})`);
    relaySipToFreeSwitch(req, socket, head);
    return;
  }

  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

// Safe send helper — catches errors from sockets transitioning to CLOSING mid-send
function safeSend(ws: WebSocket, message: string): boolean {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      return true;
    }
  } catch (err) {
    wsClients.delete(ws);
    try { ws.terminate(); } catch {}
  }
  return false;
}

// Broadcast to all identified clients (not anonymous)
export function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  let sent = 0;
  wsClients.forEach((client, ws) => {
    if (client.agentId) {
      safeSend(ws, message);
      sent++;
    }
  });
  if (type === 'screenPop' || type === 'callEvent') {
    console.log(`📡 Broadcast ${type} → ${sent} client(s)`);
  }
}

// Send to a specific agent
export function sendToAgent(agentId: string, type: string, data: any): boolean {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  let sent = false;
  wsClients.forEach((client, ws) => {
    if (client.agentId === agentId) {
      if (safeSend(ws, message)) sent = true;
    }
  });
  if (!sent) {
    console.warn(`⚠️ sendToAgent: no active WS for ${agentId}`);
  }
  return sent;
}

// Send to whichever client(s) have the given softphone extension registered.
export function sendToExtension(extension: string, type: string, data: any): number {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  let sent = 0;
  wsClients.forEach((client, ws) => {
    if (client.extension && client.extension === extension) {
      if (safeSend(ws, message)) sent++;
    }
  });
  return sent;
}

// Send to all supervisors
export function sendToSupervisors(type: string, data: any) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wsClients.forEach((client, ws) => {
    if (client.role === 'supervisor') safeSend(ws, message);
  });
}

// Get connected agent IDs (deduplicated)
export function getConnectedAgentIds(): string[] {
  const agentIds = new Set<string>();
  wsClients.forEach((client, ws) => {
    if (client.agentId && ws.readyState === WebSocket.OPEN) {
      agentIds.add(client.agentId);
    }
  });
  return [...agentIds];
}

// Middleware
app.use(cors({
  origin: true, // Allow all origins (frontend served from same server in production)
  credentials: true,
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/robocall', robocallRoutes);
app.use('/api/customer-app', customerAppRoutes);
app.use('/api/distribution', distributionRoutes);
app.use('/api/closure', closureRoutes);
app.use('/api/stolen-tracking', stolenTrackingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/autocall', autocallRoutes);
app.use('/api/cdr', cdrRoutes);
app.use('/api/pbx-admin', pbxAdminRoutes);

// Reverse geocode proxy — avoids browser CORS issues with direct Nominatim access
app.get('/api/geocode/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const url = `http://192.168.20.186:8090/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=en`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Geocode proxy error:', err.message);
    res.status(502).json({ error: 'Geocode service unavailable' });
  }
});

// Health check — always reachable, reports readiness
app.get('/api/health', (_req, res) => {
  res.status(serverReady ? 200 : 503).json({
    status: serverReady ? 'ready' : 'warming_up',
    timestamp: new Date().toISOString(),
    wsClients: wsClients.size,
  });
});

// Serve static files from dist/ in production
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));

// SPA fallback - serve index.html for any non-API routes
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ 
    success: false, 
    error: err.message || 'Internal server error' 
  });
});

const PORT = process.env.PORT || 3001;

// ── Readiness state ──────────────────────────────────────────────────
// The server starts accepting HTTP immediately.  Before warm-up completes,
// most API routes serve 503.  The health endpoint reports readiness.
export let serverReady = false;

async function startServer() {
  console.log('🚀 Starting TAVL Web Server...\n');

  // ── Phase 1: Start HTTP listener IMMEDIATELY ──────────────────────
  // This eliminates all ECONNREFUSED errors from Vite / clients.
  const HOST = '0.0.0.0';
  await new Promise<void>((resolve) => {
    server.listen(PORT, HOST, () => {
      const os = require('os');
      const localIPs: string[] = [];
      Object.values(os.networkInterfaces()).forEach((interfaces: any) => {
        interfaces?.forEach((iface: any) => {
          if (iface.family === 'IPv4' && !iface.internal) localIPs.push(iface.address);
        });
      });
      console.log(`🌐 Server listening at:`);
      console.log(`   ➜  Local:   http://localhost:${PORT}`);
      localIPs.forEach(ip => console.log(`   ➜  Network: http://${ip}:${PORT}`));
      console.log(`📡 WebSocket available at ws://localhost:${PORT}/ws\n`);
      resolve();
    });
  });

  // ── Phase 2: Connect databases with retry ─────────────────────────
  let pgReady = false;
  const PG_RETRY_ATTEMPTS = 5;
  const PG_RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= PG_RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`📊 Connecting to PostgreSQL (attempt ${attempt}/${PG_RETRY_ATTEMPTS})...`);
      await initPostgres();
      console.log('✅ PostgreSQL connected');
      pgReady = true;
      break;
    } catch (err: any) {
      console.warn(`⚠️ PostgreSQL attempt ${attempt} failed: ${err.message}`);
      if (attempt < PG_RETRY_ATTEMPTS) {
        await new Promise(r => setTimeout(r, PG_RETRY_DELAY_MS));
      }
    }
  }

  if (!pgReady) {
    console.error('❌ PostgreSQL unavailable after all retries — server cannot function without it');
    process.exit(1);
  }

  // PBX Admin database (our custom DB — replaces FusionPBX)
  try {
    await initPbxAdminDb();
    await ensurePbxSchema();
  } catch (err: any) {
    console.warn('⚠️ PBX Admin DB unavailable — PBX admin features will be limited:', err.message);
  }

  // FusionPBX database (non-fatal — CDR data still lives here)
  try {
    await initFusionPbxDb();
  } catch (err: any) {
    console.warn('⚠️ FusionPBX DB unavailable — CDR features will be limited:', err.message);
  }

  // MSSQL connections are non-fatal
  let mssqlAvailable = false;
  try {
    await initTavlDatabase();
    await initCrmDatabase();
    mssqlAvailable = true;
    console.log('✅ MSSQL databases connected');
  } catch (mssqlErr: any) {
    console.warn(`⚠️ MSSQL unavailable (${mssqlErr.message}) — running on PostgreSQL cache only`);
  }

  // ── Phase 3: Essential schema (fast, required before serving data) ──
  await initAlertDistributionTables();
  await initStolenTrackingTable();
  await initAutoCallTable();

  const staleCount = await markAllAgentsOffline();
  if (staleCount > 0) console.log(`🧹 Cleared ${staleCount} stale agent sessions`);

  // ── Phase 4: Warm-up (background, non-blocking) ───────────────────
  // Everything after this point runs concurrently. The server is already
  // serving 503 to data endpoints while these complete.
  warmUpInBackground(mssqlAvailable).then(() => {
    serverReady = true;
    console.log('✅ Server fully ready — all caches warm');
  }).catch(err => {
    // Even if warm-up partially fails, mark ready so endpoints serve
    // whatever data is available rather than perpetual 503.
    serverReady = true;
    console.warn('⚠️ Warm-up completed with errors:', err.message);
  });
}

async function warmUpInBackground(mssqlAvailable: boolean) {
  const t0 = Date.now();

  // Start ESL, alerts, and analytics immediately — don't wait for cache sync
  const eslPromise = initEslAndWire();

  const alertsPromise = startAlertBroadcaster().catch(e => {
    console.warn('⚠️ Alert broadcaster start error:', e.message);
  });

  const analyticsPromise = startAnalyticsRefresh().catch(e => {
    console.warn('⚠️ Analytics refresh start error:', e.message);
  });

  // Cache sync runs in parallel (can take 30-120s for 100K+ records)
  const { initCacheTables, runFullSync, startSyncScheduler } = await import('./db/cacheSync');
  const cacheSyncPromise = (async () => {
    await initCacheTables();
    if (mssqlAvailable) {
      try {
        await runFullSync();
        startSyncScheduler();
      } catch (syncErr: any) {
        console.warn('⚠️ Cache sync failed:', syncErr.message);
      }
    }
  })();

  await Promise.all([eslPromise, alertsPromise, analyticsPromise, cacheSyncPromise]);

  startTimeoutMonitor();
  startStolenTrackingUpdater();

  // Clean up any non-rule-matching alerts from dedicated agents' inboxes
  enforceRuleIsolation().catch((e) => console.error('❌ enforceRuleIsolation failed:', e?.message || e));

  // Stale-session monitor
  const STALE_CHECK_INTERVAL_MS = 120_000;
  const STALE_THRESHOLD_MINUTES = 2;
  staleCheckInterval = setInterval(async () => {
    try {
      const connectedIds = getConnectedAgentIds();
      const marked = await markStaleAgentsOffline(STALE_THRESHOLD_MINUTES, connectedIds);
      if (marked.length > 0) {
        console.log(`🧹 Marked ${marked.length} stale agents offline: ${marked.join(', ')}`);
      }
    } catch (e: any) {
      console.error('Stale-session check error:', e.message);
    }
  }, STALE_CHECK_INTERVAL_MS);

  console.log(`🔥 Background warm-up complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function initEslAndWire() {
  try {
    console.log('📞 Connecting to FreeSWITCH ESL at', process.env.FREESWITCH_HOST || '192.168.20.140');
    const eslConnected = await initEsl();
    if (!eslConnected) {
      console.warn('⚠️ FreeSWITCH ESL connection failed — calls will not work');
      return;
    }
    console.log('✅ FreeSWITCH ESL connected');

    // Prune stray/unauthorised agents from the call-center queue on startup
    // (orphaned FusionPBX/runtime agents, executive extensions). Only agents whose
    // extension is in the distribution allowlist are allowed to ring.
    try {
      const { QUEUE_AGENT_EXTENSIONS } = await import('./routes/distribution');
      await eslConnection.reconcileQueueAgents(process.env.AUTOCALL_QUEUE || 'tavl-agents', QUEUE_AGENT_EXTENSIONS);
    } catch (e: any) {
      console.warn('⚠️ Queue agent reconcile skipped:', e?.message);
    }

    eslConnection.on('callEvent', (event) => {
      broadcast('callEvent', event);

      // Update agent call logs on answer/hangup for tracked agent channels
      if (event.type === 'answered' && agentRingingChannels.has(event.uniqueId)) {
        const entry = agentRingingChannels.get(event.uniqueId);
        if (entry) {
          import('./db/alertDistribution').then(({ updateAgentCallLogAnswered }) => {
            updateAgentCallLogAnswered(entry.logId).catch(() => {});
          }).catch(() => {});
        }
      } else if (event.type === 'hangup' && agentRingingChannels.has(event.uniqueId)) {
        const entry = agentRingingChannels.get(event.uniqueId);
        if (entry) {
          import('./db/alertDistribution').then(({ updateAgentCallLogEnded }) => {
            updateAgentCallLogEnded(entry.logId, event.cause).catch(() => {});
          }).catch(() => {});
          agentRingingChannels.delete(event.uniqueId);
        }
      }
    });
    eslConnection.on('callBridged', (event) => broadcast('callBridged', event));

    // Cache the CRM lookup keyed by the inbound consumer UUID so we can deliver
    // it to the specific agent whose phone actually rings, not every connected client.
    const screenPopCache = new Map<string, any>();

    // Track agent ringing channels → agent_call_logs IDs so we can update outcomes
    const agentRingingChannels = new Map<string, { logId: number; extension: string }>();

    eslConnection.on('agentRinging', ({ extension, inboundCall, agentChannelUuid }: { extension: string; inboundCall: any; agentChannelUuid?: string }) => {
      const cached = screenPopCache.get(inboundCall.uniqueId);
      const screenPopData = cached || { type: 'screenPop', call: inboundCall, found: false };
      const delivered = sendToExtension(extension, 'screenPop', screenPopData);
      if (delivered > 0) {
        console.log(`📡 Screen pop → ext ${extension} (${delivered} client(s))`);
      } else {
        console.log(`📡 Screen pop for ext ${extension}: no logged-in client with that extension`);
      }

      // Log the call offering for per-agent tracking
      if (agentChannelUuid) {
        (async () => {
          let crmUsername: string | undefined;
          try {
            const rows = await queryPostgres(
              `SELECT username FROM agent_sessions WHERE extension = $1 AND status = 'online' LIMIT 1`,
              [extension]
            );
            crmUsername = rows?.[0]?.username || undefined;
          } catch {}
          const { insertAgentCallLog } = await import('./db/alertDistribution');
          insertAgentCallLog(extension, inboundCall.callerId, inboundCall.callerIdName, inboundCall.uniqueId, agentChannelUuid, crmUsername).then((logId) => {
            if (logId > 0) {
              agentRingingChannels.set(agentChannelUuid, { logId, extension });
              setTimeout(() => agentRingingChannels.delete(agentChannelUuid), 120_000);
            }
          }).catch(() => {});
        })();
      }
    });

    eslConnection.on('inboundCall', async (inboundCall) => {
      console.log(`📞 Screen Pop: Incoming call from ${inboundCall.callerId} — looking up CRM, will deliver when an agent's phone rings`);
      try {
        // Smart phone normalization: strip country code (+92 / 92), leading 0, non-digits
        let normalizedPhone = inboundCall.callerId.replace(/\D/g, '');
        if (normalizedPhone.startsWith('92') && normalizedPhone.length > 10) {
          normalizedPhone = normalizedPhone.substring(2);
        }
        if (normalizedPhone.startsWith('0')) {
          normalizedPhone = normalizedPhone.substring(1);
        }
        // normalizedPhone is now the core number e.g. "3072298767"

        // Build multiple search patterns to handle CRM storing numbers in various formats:
        //   CRM may have: 03072298767, 3072298767, +923072298767, 923072298767
        // We search with the core number which matches all variants via LIKE
        const corePattern = `%${normalizedPhone}%`;
        // Also try with leading 0 for exact-match scenarios
        const withZero = `0${normalizedPhone}`;
        const withCountryCode = `92${normalizedPhone}`;
        const withPlusCountryCode = `+92${normalizedPhone}`;

        console.log(`📞 Screen Pop: Searching CRM with core="${normalizedPhone}", patterns: [${withZero}, ${withCountryCode}, ${withPlusCountryCode}]`);

        const customers = await queryCrm(`
          SELECT DISTINCT TOP 1
            c.CUST_ID as customerId,
            c.FNAME as customerName,
            c.ADRESS as address,
            c.CONT1 as phone1,
            c.CONT2 as phone2
          FROM CUSTOMER c WITH (NOLOCK)
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.CONT1, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE @corePattern
             OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.CONT2, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE @corePattern
        `, { corePattern });

        let screenPopData: any = { type: 'screenPop', call: inboundCall, found: false };

        if (customers && customers.length > 0) {
          const customer = customers[0];
          const vehicles = await queryCrm(`
            SELECT TOP 10 v.V_ID as vehicleId, v.VEH_REG as plateNumber,
                          mk.MK_NAME as make, m.M_NAME as model
            FROM INSTALLATION i WITH (NOLOCK)
            INNER JOIN VEHICLES v WITH (NOLOCK) ON i.V_ID = v.V_ID
            LEFT JOIN MAKE mk WITH (NOLOCK) ON v.MK_ID = mk.MK_ID
            LEFT JOIN MODEL m WITH (NOLOCK) ON v.M_ID = m.M_ID
            WHERE i.CUST_ID = @custId
          `, { custId: customer.customerId });

          screenPopData = {
            type: 'screenPop', call: inboundCall, found: true,
            customer: { id: customer.customerId, name: customer.customerName, address: customer.address, phone1: customer.phone1, phone2: customer.phone2 },
            vehicles: vehicles || [],
          };
          console.log(`✅ Screen Pop: Found customer ${customer.customerName} with ${vehicles?.length || 0} vehicles`);
        } else {
          console.log(`📞 Screen Pop: Unknown caller ${inboundCall.callerId}`);
        }

        screenPopCache.set(inboundCall.uniqueId, screenPopData);
        // Garbage-collect after a couple of minutes — well past any realistic ring duration.
        setTimeout(() => screenPopCache.delete(inboundCall.uniqueId), 120_000);
      } catch (error: any) {
        console.error('Screen Pop lookup error:', error.message);
        screenPopCache.set(inboundCall.uniqueId, { type: 'screenPop', call: inboundCall, found: false, error: 'Lookup failed' });
        setTimeout(() => screenPopCache.delete(inboundCall.uniqueId), 120_000);
      }
    });
  } catch (e: any) {
    console.warn('⚠️ ESL setup error:', e.message);
  }
}

// Graceful shutdown
async function gracefulShutdown() {
  console.log('\n🛑 Shutting down...');

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);

  // Stop all background services
  stopAlertBroadcaster();
  stopTimeoutMonitor();
  stopStolenTrackingUpdater();
  clearInterval(pingInterval);
  if (staleCheckInterval) clearInterval(staleCheckInterval);
  try { const { stopDistributionEngine } = await import('./services/distributionEngine'); stopDistributionEngine(); } catch {}
  try { const { stopSyncScheduler } = await import('./db/cacheSync'); stopSyncScheduler(); } catch {}
  stopAnalyticsRefresh();

  // Close all WebSocket connections
  wsClients.forEach((_client, ws) => {
    try { ws.close(1001, 'Server shutting down'); } catch {}
  });
  wsClients.clear();

  // Mark all agents offline before closing DB
  try {
    const { markAllAgentsOffline } = await import('./db/alertDistribution');
    await markAllAgentsOffline();
  } catch {}

  await closeTavlDatabase();
  await closePostgres();
  await closePbxAdminDb();
  await closeFusionPbxDb();
  await closeCrmDatabase();

  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

startServer();
