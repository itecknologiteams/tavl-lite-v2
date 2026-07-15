/**
 * FreeSWITCH Event Socket Layer (ESL) Connection Module
 * Drop-in replacement for the Asterisk AMI module.
 *
 * Server: 192.168.20.140
 * Supports: Screen Pop, Click-to-Call, Call Events, Queue Management, Conferencing
 */

import { EventEmitter } from 'events';

// modesl has no @types – declare just enough to compile
let modesl: any;
try { modesl = require('modesl'); } catch { /* loaded lazily */ }

export interface CallEvent {
  type: 'inbound' | 'ringing' | 'answered' | 'hangup' | 'error';
  channel: string;
  callerId?: string;
  callerIdName?: string;
  uniqueId?: string;
  cause?: string;
  duration?: number;
  extension?: string;
  direction?: 'inbound' | 'outbound';
  context?: string;
  timestamp?: number;
}

export interface InboundCallInfo {
  uniqueId: string;
  channel: string;
  callerId: string;
  callerIdName?: string;
  extension?: string;
  startTime: number;
  answerTime?: number;
  state: 'ringing' | 'answered' | 'ended';
}

interface EslConfig {
  host: string;
  port: number;
  password: string;
}

const FS_DOMAIN = process.env.FREESWITCH_HOST || '192.168.20.140';

// ── Channel-identification helpers (pure, unit-tested) ──────────────────────────
// WebRTC agents (the app's softphone) register with a RANDOM contact, so their
// channel name is `sofia/internal/<random>@<random>.invalid` and the leg's cid_num
// is the *customer's* number — neither identifies the agent. The reliable id is
// `accountcode` (= the extension). Deskphones additionally carry the ext in the name.
export function isAgentChannel(ch: any, extension: string): boolean {
  if (!ch) return false;
  const name = String(ch.name || ch.channel || '');
  const ext = String(extension);
  return String(ch.accountcode) === ext
    || name.includes(`/${ext}@`)
    || name.includes(`/${ext}-`);
}

// `show channels as json` exposes NO b_uuid; bridged legs share a call_uuid (one
// leg's call_uuid points at the other's uuid, or both carry the same master value).
// Returns the bridge partner's uuid, or null if the channel isn't bridged.
export function findBridgePartnerUuid(ch: any, channels: any[]): string | null {
  if (!ch) return null;
  const cu = ch.callUuid;
  if (cu) {
    const p = channels.find((c: any) =>
      c.uniqueId !== ch.uniqueId && (c.uniqueId === cu || c.callUuid === cu));
    if (p) return p.uniqueId;
  }
  // Legacy: honour b_uuid if a future FS build ever populates it.
  if (ch.bridgeId) {
    const p = channels.find((c: any) => c.uniqueId === ch.bridgeId);
    if (p) return p.uniqueId;
  }
  return null;
}

const DEAD_STATES = new Set(['CS_HANGUP', 'HANGUP', 'DOWN']);

class EslConnection extends EventEmitter {
  private conn: any = null;
  private config: EslConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private connectingPromise: Promise<boolean> | null = null;
  private activeCalls: Map<string, any> = new Map();
  private inboundCalls: Map<string, InboundCallInfo> = new Map();
  private screenPopSent = new Set<string>();
  // Serializes _api() over the single ESL socket. modesl matches api() responses
  // to callbacks in FIFO order, so concurrent api() calls cross their replies
  // (e.g. queueStatus parsing the `sofia status` output → 0 agents). Each call
  // waits for the previous to settle before sending its command.
  private _apiChain: Promise<unknown> = Promise.resolve();

  constructor() {
    super();
    this.config = {
      host: process.env.FREESWITCH_HOST || '192.168.20.140',
      port: parseInt(process.env.FREESWITCH_ESL_PORT || '8021'),
      password: process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon',
    };
    this.on('error', (err) => {
      console.warn('⚠️ ESL EventEmitter error (handled):', err.message);
    });
  }

  async connect(): Promise<boolean> {
    if (this.isConnected) return true;
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this._doConnect();
    try { return await this.connectingPromise; } finally { this.connectingPromise = null; }
  }

  private _doConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        if (this.conn) {
          try { this.conn.disconnect(); } catch {}
          this.conn = null;
        }

        console.log(`📞 Connecting to FreeSWITCH ESL at ${this.config.host}:${this.config.port}...`);

        const conn = new modesl.Connection(
          this.config.host,
          this.config.port,
          this.config.password,
        );

        conn.on('esl::ready', () => {
          console.log('✅ ESL Connected successfully');
          this.conn = conn;
          this.isConnected = true;
          this.emit('connected');

          conn.subscribe([
            'CHANNEL_CREATE',
            'CHANNEL_ANSWER',
            'CHANNEL_HANGUP_COMPLETE',
            'CHANNEL_BRIDGE',
            'CUSTOM callcenter::info',
          ].join(' '), () => {});

          conn.on('esl::event::CHANNEL_CREATE::*', (evt: any) => this._onChannelCreate(evt));
          conn.on('esl::event::CHANNEL_ANSWER::*', (evt: any) => this._onChannelAnswer(evt));
          conn.on('esl::event::CHANNEL_HANGUP_COMPLETE::*', (evt: any) => this._onChannelHangup(evt));
          conn.on('esl::event::CHANNEL_BRIDGE::*', (evt: any) => this._onChannelBridge(evt));

          resolve(true);
        });

        conn.on('error', (err: Error) => {
          console.error('❌ ESL Error:', err.message);
          this.isConnected = false;
          this.scheduleReconnect();
        });

        conn.on('esl::end', () => {
          console.log('🔌 ESL Connection closed');
          this.isConnected = false;
          this.conn = null;
          this.emit('disconnected');
          this.scheduleReconnect();
        });

        setTimeout(() => {
          if (!this.isConnected) {
            console.warn('⚠️ ESL connection timeout – will retry');
            this.scheduleReconnect();
            resolve(false);
          }
        }, 10000);
      } catch (error: any) {
        console.error('❌ ESL Connection failed:', error?.message || error);
        this.scheduleReconnect();
        resolve(false);
      }
    });
  }

  // ── ESL event handlers ─────────────────────────────────────────

  private _h(evt: any, key: string): string {
    return evt?.getHeader?.(key) || '';
  }

  private _onChannelCreate(evt: any) {
    const uuid = this._h(evt, 'Unique-ID');
    if (!uuid) return;

    const callerId = this._h(evt, 'Caller-Caller-ID-Number');
    const callerIdName = this._h(evt, 'Caller-Caller-ID-Name');
    const context = this._h(evt, 'Caller-Context');
    const destNumber = this._h(evt, 'Caller-Destination-Number');
    const direction = this._h(evt, 'Call-Direction');

    const callerDigits = callerId.replace(/\D/g, '');
    const isInbound = direction === 'inbound' &&
      (context === 'public' || context === 'from-trunk' || context === 'from-pstn') &&
      callerDigits.length >= 7;

    this.activeCalls.set(uuid, {
      uniqueId: uuid,
      channel: this._h(evt, 'Channel-Name') || uuid,
      callerId,
      callerIdName,
      context,
      extension: destNumber,
      state: 'new',
      startTime: Date.now(),
      direction: isInbound ? 'inbound' : 'outbound',
    });

    if (isInbound && callerId) {
      const dedupKey = callerDigits.slice(-10);
      if (this.screenPopSent.has(dedupKey)) return;
      this.screenPopSent.add(dedupKey);
      setTimeout(() => this.screenPopSent.delete(dedupKey), 120_000);

      const inboundCall: InboundCallInfo = {
        uniqueId: uuid,
        channel: this._h(evt, 'Channel-Name') || uuid,
        callerId,
        callerIdName,
        extension: destNumber,
        startTime: Date.now(),
        state: 'ringing',
      };
      this.inboundCalls.set(uuid, inboundCall);

      console.log(`📞 INBOUND CALL: ${callerId} (${callerIdName || 'Unknown'}) → ${destNumber || 'Queue'}`);
      this.emit('inboundCall', inboundCall);

      this.emit('callEvent', {
        type: 'inbound',
        channel: inboundCall.channel,
        callerId,
        callerIdName,
        uniqueId: uuid,
        direction: 'inbound',
        context,
        extension: destNumber,
        timestamp: Date.now(),
      } as CallEvent);
    } else {
      this.emit('callEvent', {
        type: 'ringing',
        channel: this._h(evt, 'Channel-Name') || uuid,
        callerId,
        callerIdName,
        uniqueId: uuid,
        direction: 'outbound',
        timestamp: Date.now(),
      } as CallEvent);

      // Detect the queue-originated B-leg to an agent extension.
      // When the callcenter module dials an agent, FreeSWITCH creates an
      // outbound channel whose Other-Leg-Unique-ID points back to the
      // inbound consumer. If we recognize that consumer as one we are
      // tracking, this is the agent who should receive the screen pop.
      const otherLegUuid = this._h(evt, 'Other-Leg-Unique-ID');
      const channelName = this._h(evt, 'Channel-Name') || '';
      const isUserLeg = /^(?:sofia\/[^/]+\/)?\d{2,5}@/.test(channelName) || /^loopback\/\d{2,5}/.test(channelName);
      if (otherLegUuid && destNumber && /^\d{2,5}$/.test(destNumber) && isUserLeg) {
        const inb = this.inboundCalls.get(otherLegUuid);
        if (inb) {
          console.log(`📞 AGENT RINGING: ext ${destNumber} ← consumer ${otherLegUuid} (${inb.callerId})`);
          this.emit('agentRinging', { extension: destNumber, inboundCall: inb });
        }
      }
    }
  }

  private _onChannelAnswer(evt: any) {
    const uuid = this._h(evt, 'Unique-ID');
    const call = this.activeCalls.get(uuid);
    if (!call) return;

    call.state = 'answered';
    call.answerTime = Date.now();

    const inb = this.inboundCalls.get(uuid);
    if (inb) {
      inb.state = 'answered';
      inb.answerTime = Date.now();
      console.log(`📞 CALL ANSWERED: ${inb.callerId}`);
    }

    this.emit('callEvent', {
      type: 'answered',
      channel: this._h(evt, 'Channel-Name') || uuid,
      uniqueId: uuid,
      callerId: call.callerId,
      direction: call.direction,
      timestamp: Date.now(),
    } as CallEvent);
  }

  private _onChannelHangup(evt: any) {
    const uuid = this._h(evt, 'Unique-ID');
    const call = this.activeCalls.get(uuid);
    if (!call) return;

    const duration = call.answerTime ? Math.floor((Date.now() - call.answerTime) / 1000) : 0;
    const cause = this._h(evt, 'Hangup-Cause');

    const inb = this.inboundCalls.get(uuid);
    if (inb) {
      inb.state = 'ended';
      console.log(`📞 CALL ENDED: ${inb.callerId} (duration: ${duration}s)`);
      this.inboundCalls.delete(uuid);
    }

    this.emit('callEvent', {
      type: 'hangup',
      channel: this._h(evt, 'Channel-Name') || uuid,
      uniqueId: uuid,
      cause,
      duration,
      callerId: call.callerId,
      direction: call.direction,
      timestamp: Date.now(),
    } as CallEvent);

    this.activeCalls.delete(uuid);
  }

  private _onChannelBridge(evt: any) {
    const ch1 = this._h(evt, 'Channel-Name');
    const ch2 = this._h(evt, 'Other-Leg-Channel-Name') || this._h(evt, 'Bridge-B-Unique-ID');
    console.log('📞 Call bridged:', ch1, '<->', ch2);
    this.emit('callBridged', {
      channel1: ch1,
      channel2: ch2,
      uniqueId1: this._h(evt, 'Unique-ID'),
      uniqueId2: this._h(evt, 'Other-Leg-Unique-ID'),
    });
  }

  // ── Reconnect ──────────────────────────────────────────────────

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log('Trying to reconnect to ESL in 10 seconds');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('🔄 Attempting ESL reconnection...');
      this.connect().catch((err) => {
        console.error('❌ ESL reconnection failed:', err?.message || err);
      });
    }, 10000);
  }

  // ── API helper ─────────────────────────────────────────────────

  private _api(cmd: string): Promise<string> {
    const run = (): Promise<string> => new Promise((resolve, reject) => {
      if (!this.conn || !this.isConnected) return reject(new Error('ESL not connected'));
      const timer = setTimeout(() => reject(new Error('ESL API timeout')), 10000);
      this.conn.api(cmd, (res: any) => {
        clearTimeout(timer);
        const body: string = res?.getBody?.() || '';
        if (body.startsWith('-ERR')) return reject(new Error(body));
        resolve(body);
      });
    });
    // Chain onto the previous call (run after it settles, success or failure)
    // so only one api() callback is ever in flight on the socket at a time.
    const result = this._apiChain.then(run, run);
    // Keep the chain alive on rejection — swallow only on the chain tail, the
    // caller still receives the real outcome via `result`.
    this._apiChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private _bgapi(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.conn || !this.isConnected) return reject(new Error('ESL not connected'));
      this.conn.bgapi(cmd, (res: any) => {
        const body: string = res?.getBody?.() || '';
        if (body.startsWith('-ERR')) return reject(new Error(body));
        resolve(body);
      });
    });
  }

  // Fire-and-forget sendmsg execute on a live channel (non-blocking: event-lock false)
  private _executeOnChannel(uuid: string, app: string, arg = ''): void {
    if (!this.conn || !this.isConnected) return;
    const headers: Record<string, string> = {
      'call-command': 'execute',
      'execute-app-name': app,
      'event-lock': 'false',
    };
    if (arg) headers['execute-app-arg'] = arg;
    // conn.send() writes "sendmsg {uuid}\nkey: val\n...\n" directly to the socket
    this.conn.send(`sendmsg ${uuid}`, headers);
  }

  // ── Call Origination ───────────────────────────────────────────

  async originateCall(params: {
    extension: string;
    destination: string;
    callerId?: string;
    callerIdName?: string;
    context?: string;
    timeout?: number;
  }): Promise<{ success: boolean; actionId?: string; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const {
      extension,
      destination,
      callerId = destination,
      callerIdName = 'TAVL Call',
      context = 'default',
      timeout = 30,
    } = params;

    const formattedDest = destination.replace(/[\s\-()]/g, '');
    const actionId = `tavl-${Date.now()}`;

    console.log(`📞 Originating call: user/${extension}@${FS_DOMAIN} → ${formattedDest}`);

    try {
      const cmd = `originate {origination_caller_id_number=${callerId},origination_caller_id_name='${callerIdName}',originate_timeout=${timeout}}user/${extension}@${FS_DOMAIN} ${formattedDest} XML ${context}`;
      await this._bgapi(cmd);
      console.log('✅ Call originated:', actionId);
      return { success: true, actionId };
    } catch (err: any) {
      console.error('❌ Originate failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async originateAutoCall(params: {
    destination: string;
    callerId?: string;
    callerIdName?: string;
    timeout?: number;
    variables?: Record<string, string>;
  }): Promise<{ success: boolean; actionId?: string; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const {
      destination,
      callerId = process.env.AUTOCALL_CALLERID || destination,
      callerIdName = 'iTecknologi',
      timeout = 45,
      variables = {},
    } = params;

    const formatted = destination.replace(/[\s\-()]/g, '');
    const trunk = process.env.FREESWITCH_TRUNK || process.env.ASTERISK_TRUNK || 'trunk-robocall';
    const actionId = `autocall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const vars = [
      `origination_caller_id_number=${callerId}`,
      `origination_caller_id_name='${callerIdName}'`,
      `originate_timeout=${timeout}`,
      `AUTOCALL=true`,
      `AUTOCALL_ID=${actionId}`,
      `AUTOCALL_DEST=${formatted}`,
      ...Object.entries(variables).map(([k, v]) => `${k}=${v}`),
    ].join(',');

    console.log(`📢 Auto-call originate: sofia/gateway/${trunk}/${formatted}`);

    try {
      // Route to tavl-autocall FS dialplan: plays greeting, reads DTMF, routes 0 → callcenter
      await this._bgapi(`originate {${vars}}sofia/gateway/${trunk}/${formatted} autocall_ivr XML tavl-autocall`);
      console.log('✅ Auto-call originated:', actionId);
      return { success: true, actionId };
    } catch (err: any) {
      console.error('❌ Auto-call originate failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ── Hangup / Transfer ──────────────────────────────────────────

  async hangupCall(channel: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      await this._api(`uuid_kill ${channel}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async holdCall(extension: string, hold: boolean): Promise<{ success: boolean; partnerUuid?: string; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    try {
      const { agentChannel, partnerChannel } = await this.findAgentCallChannels(extension);
      if (!agentChannel) return { success: false, error: `No active call found for extension ${extension}` };

      if (hold) {
        // Make the customer hear our MoH while held (default uuid_hold can be silent
        // when no hold_music is configured on the profile).
        await this._api(`uuid_setvar ${agentChannel} hold_music local_stream://tavl_moh`).catch(() => {});
        await this._api(`uuid_hold ${agentChannel}`);
      } else {
        await this._api(`uuid_hold off ${agentChannel}`);
      }
      console.log(`📞 ${hold ? 'Hold' : 'Unhold'}: ext ${extension} (uuid: ${agentChannel})`);
      return { success: true, partnerUuid: partnerChannel || undefined };
    } catch (err: any) {
      console.error(`❌ ${hold ? 'Hold' : 'Unhold'} failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async muteCall(extension: string, mute: boolean): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    try {
      const { agentChannel } = await this.findAgentCallChannels(extension);
      if (!agentChannel) return { success: false, error: `No active call found for extension ${extension}` };

      // uuid_audio start write mute  → silences the agent's outgoing audio to the caller
      // uuid_audio stop              → restores it
      const cmd = mute
        ? `uuid_audio ${agentChannel} start write mute`
        : `uuid_audio ${agentChannel} stop`;
      await this._api(cmd);
      console.log(`📞 ${mute ? 'Mute' : 'Unmute'}: ext ${extension} (uuid: ${agentChannel})`);
      return { success: true };
    } catch (err: any) {
      console.error(`❌ ${mute ? 'Mute' : 'Unmute'} failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async attendedTransfer(extension: string, partnerAUuid: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const channels = await this.getActiveChannels();

    // Agent has 2 legs (both accountcode=ext): held Call A (partner = customer =
    // partnerAUuid) + active Call B consult (partner = destination). Identify by
    // accountcode and pair partners via call_uuid — name/b_uuid don't work for WebRTC.
    const agentLegs = channels
      .filter((ch: any) => isAgentChannel(ch, extension) && !DEAD_STATES.has(ch.state))
      .map((ch: any) => ({ ch, partner: findBridgePartnerUuid(ch, channels) }));

    console.log(`🔀 attendedTransfer(${extension}): ${agentLegs.length} agent leg(s)`);
    agentLegs.forEach(({ ch, partner }) =>
      console.log(`   uuid=${ch.uniqueId} acct=${ch.accountcode} state=${ch.state} partner=${partner || 'none'}`));

    // Consult leg (Call B) = the agent leg whose partner is NOT the customer.
    const consult = agentLegs.find((l) => l.partner && l.partner !== partnerAUuid)
      || agentLegs.find((l) => l.partner); // fallback if held leg lost its pairing
    // Held leg (Call A) = the one bridged to the customer; unhold it so the
    // customer's media isn't frozen in MoH when we re-bridge.
    const heldLeg = agentLegs.find((l) => l.partner === partnerAUuid);

    if (!consult?.partner) {
      return { success: false, error: 'Cannot find consult call (Call B) — is the destination party answered?' };
    }

    const partnerBUuid = consult.partner;
    console.log(`🔀 Bridging customer=${partnerAUuid} ↔ destination=${partnerBUuid}`);

    try {
      if (heldLeg) await this._api(`uuid_hold off ${heldLeg.ch.uniqueId}`).catch(() => {});
      await this._api(`uuid_bridge ${partnerAUuid} ${partnerBUuid}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async transferCall(channel: string, destination: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      await this._api(`uuid_transfer ${channel} ${destination} XML default`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ── Extension / Registration ───────────────────────────────────

  async checkExtensionRegistered(extension: string): Promise<{ registered: boolean; contact?: string }> {
    const all = await this.getAllRegisteredContacts();
    return all.get(extension) || { registered: false };
  }

  async getAllRegisteredContacts(): Promise<Map<string, { registered: boolean; contact?: string; rtt?: string }>> {
    const results = new Map<string, { registered: boolean; contact?: string; rtt?: string }>();
    if (!this.conn || !this.isConnected) return results;

    try {
      const output = await this._api('sofia status profile internal reg');
      // Parse registration lines: "Call-ID: ...  User: 100@domain  Contact: sip:... ..."
      const blocks = output.split(/\n\n+/);
      for (const block of blocks) {
        const userMatch = block.match(/User:\s+(\d+)@/);
        const contactMatch = block.match(/Contact:\s+(\S+)/);
        const statusMatch = block.match(/Status:\s+Registered/i);
        if (userMatch) {
          results.set(userMatch[1], {
            registered: !!statusMatch,
            contact: contactMatch?.[1],
          });
        }
      }
    } catch (err: any) {
      console.error('Failed to get registrations:', err.message);
    }
    return results;
  }

  async getExtensionStatus(extension: string): Promise<{
    status: 'unknown' | 'not_inuse' | 'inuse' | 'busy' | 'unavailable' | 'ringing';
    hint?: string;
  }> {
    const reg = await this.checkExtensionRegistered(extension);
    if (!reg.registered) return { status: 'unavailable' };

    try {
      const channels = await this.getActiveChannels();
      const busy = channels.some((ch: any) => {
        const name: string = ch.channel || '';
        return name.includes(`/${extension}@`) || name.includes(`/${extension}-`);
      });
      return { status: busy ? 'inuse' : 'not_inuse' };
    } catch {
      return { status: reg.registered ? 'not_inuse' : 'unavailable' };
    }
  }

  async getSipPeerStatus(peer: string): Promise<{
    registered: boolean;
    address?: string;
    status?: string;
  }> {
    const reg = await this.checkExtensionRegistered(peer);
    return {
      registered: reg.registered,
      address: reg.contact,
      status: reg.registered ? 'Registered' : 'Unregistered',
    };
  }

  // ── Active Channels ────────────────────────────────────────────

  async getActiveChannels(): Promise<any[]> {
    if (!this.conn || !this.isConnected) return [];
    try {
      const output = await this._api('show channels as json');
      const parsed = JSON.parse(output);
      const rows = parsed.rows || [];
      return rows.map((r: any) => ({
        channel: r.uuid || r.name,
        uniqueId: r.uuid,
        state: r.callstate || r.state,
        callerId: r.cid_num,
        callerIdName: r.cid_name,
        // `show channels as json` has no `elapsed` column; derive age from created_epoch.
        duration: r.created_epoch ? Math.floor(Date.now() / 1000) - parseInt(r.created_epoch) : 0,
        application: r.application,
        dest: r.dest,
        name: r.name,
        bridgeId: r.b_uuid || '',
        // `show channels` exposes no b_uuid; bridged legs share call_uuid. Callers
        // that need the bridge partner pair on this instead.
        callUuid: r.call_uuid || '',
        accountcode: r.accountcode || '',
        context: r.context || '',
        direction: r.direction || '',
      }));
    } catch (err: any) {
      console.error('getActiveChannels error:', err.message);
      return [];
    }
  }

  // ── Call Monitoring (Spy/Whisper/Barge) ─────────────────────────

  async monitorCall(params: {
    supervisorExtension: string;
    agentExtension: string;
    mode: 'spy' | 'whisper' | 'barge';
  }): Promise<{ success: boolean; error?: string; actionId?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const { supervisorExtension, agentExtension, mode } = params;
    const actionId = `monitor-${Date.now()}`;

    // Find agent's active channel UUID
    const channels = await this.getActiveChannels();
    const agentCh = channels.find((ch: any) => {
      const name: string = ch.name || ch.channel || '';
      return (name.includes(`/${agentExtension}@`) || name.includes(`/${agentExtension}-`)) && ch.state !== 'CS_HANGUP';
    });

    if (!agentCh) {
      return { success: false, error: `No active channel found for extension ${agentExtension}` };
    }

    // eavesdrop flags: dtmf controlled
    // default: listen only (spy), 'w' option flag not applicable the same way
    // For whisper, use eavesdrop with DTMF toggle or originate with specific flags
    let flags = '';
    if (mode === 'whisper') flags = 'w';
    if (mode === 'barge') flags = 'bw';

    const flagStr = flags ? `,eavesdrop_indicate_failed=true,eavesdrop_whisper_aleg=${mode === 'whisper' || mode === 'barge'},eavesdrop_whisper_bleg=${mode === 'barge'}` : '';

    console.log(`🎧 ${mode.toUpperCase()}: Supervisor ${supervisorExtension} → Agent ${agentExtension} (uuid: ${agentCh.uniqueId})`);

    try {
      await this._bgapi(`originate {origination_caller_id_name='Monitor ${agentExtension}',origination_caller_id_number=*${flagStr}}user/${supervisorExtension}@${FS_DOMAIN} &eavesdrop(${agentCh.uniqueId})`);
      console.log(`✅ Monitor ${mode} initiated: ${actionId}`);
      return { success: true, actionId };
    } catch (err: any) {
      console.error(`❌ Monitor ${mode} failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ── Queue Management ───────────────────────────────────────────

  private _agentName(extension: string): string {
    return `${extension}@${FS_DOMAIN}`;
  }

  async queueAddMember(queue: string, extension: string, penalty = 0): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const agent = this._agentName(extension);
    const queueName = queue.includes('@') ? queue : `${queue}@${FS_DOMAIN}`;

    try {
      // Ensure agent exists and is set to Available
      try { await this._api(`callcenter_config agent add ${agent} callback`); } catch {}
      try { await this._api(`callcenter_config agent set contact ${agent} user/${extension}@${FS_DOMAIN}`); } catch {}
      // Backoff windows before the queue may re-dial this agent after a failed leg.
      // FS defaults these to 0 for dynamically-added agents, which causes immediate
      // re-ring on the same agent after a decline. Match the values used by the
      // static agents in callcenter.conf.xml.
      try { await this._api(`callcenter_config agent set reject_delay_time ${agent} 10`); } catch {}
      try { await this._api(`callcenter_config agent set busy_delay_time ${agent} 60`); } catch {}
      try { await this._api(`callcenter_config agent set no_answer_delay_time ${agent} 0`); } catch {}
      await this._api(`callcenter_config agent set status ${agent} Available`);
      // Link to queue via tier if not already linked
      try { await this._api(`callcenter_config tier add ${queueName} ${agent} 1 ${penalty}`); } catch {}
      console.log(`👤 Agent ${extension} added to queue ${queue}`);
      return { success: true };
    } catch (err: any) {
      console.error(`❌ QueueAdd failed (${extension} → ${queue}):`, err.message);
      return { success: false, error: err.message };
    }
  }

  async queueRemoveMember(queue: string, extension: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const agent = this._agentName(extension);

    try {
      await this._api(`callcenter_config agent set status ${agent} Logged Out`);
      console.log(`👤 Agent ${extension} removed from queue ${queue}`);
      return { success: true };
    } catch (err: any) {
      console.error(`❌ QueueRemove failed (${extension} ← ${queue}):`, err.message);
      return { success: false, error: err.message };
    }
  }

  async queuePauseMember(queue: string, extension: string, paused: boolean, reason?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const agent = this._agentName(extension);

    try {
      const status = paused ? 'On Break' : 'Available';
      await this._api(`callcenter_config agent set status ${agent} '${status}'`);
      console.log(`👤 Agent ${extension} ${paused ? 'paused' : 'unpaused'} in ${queue}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async queueStatus(queue?: string): Promise<{ success: boolean; members: any[]; callers: any[]; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, members: [], callers: [], error: 'ESL not connected' };

    try {
      const members: any[] = [];
      const callers: any[] = [];

      // Get agents
      // Columns: name|instance_id|uuid|type|contact|status|state|max_no_answer|wrap_up_time|
      //          reject_delay_time|busy_delay_time|no_answer_delay_time|last_bridge_start|
      //          last_bridge_end|last_offered_call|last_status_change|no_answer_count|
      //          calls_answered|talk_time|ready_time|external_calls_count
      const agentOutput = await this._api('callcenter_config agent list');
      const agentLines = agentOutput.split('\n').filter((l: string) => l.includes('|'));
      for (const line of agentLines) {
        const parts = line.split('|').map((s: string) => s.trim());
        if (parts.length < 5) continue;
        if (parts[0] === 'name') continue; // header row
        const agentName = parts[0];
        const contact = parts[4] || '';
        const status = parts[5] || '';
        const state = parts[6] || '';

        const extMatch = agentName.match(/^(\d+)@/);
        const contactExtMatch = contact.match(/user\/(\d+)@/);
        const ext = extMatch ? extMatch[1] : contactExtMatch ? contactExtMatch[1] : agentName;

        // Derive statusLabel from both status AND state so call activity is reflected:
        // - Logged Out → unavailable
        // - On Break   → not_inuse (paused=true controls the amber colour)
        // - Available + Receiving        → ringing
        // - Available + In a queue call  → inuse
        // - Available + Waiting/other    → not_inuse
        const statusLabel =
          status === 'Logged Out'       ? 'unavailable' :
          status === 'On Break'         ? 'not_inuse'   :
          state  === 'Receiving'        ? 'ringing'     :
          state  === 'In a queue call'  ? 'inuse'       :
          'not_inuse';

        members.push({
          queue: queue || 'tavl-agents',
          name: ext,          // supervisor route will enrich with real name from DB
          interface: `user/${ext}@${FS_DOMAIN}`,
          status: statusLabel,
          paused: status === 'On Break',
          callsTaken: parseInt(parts[17]) || 0,     // calls_answered column
          lastStatusChange: parseInt(parts[15]) || 0, // last_status_change epoch
          lastCall: 0,
          penalty: 0,
          statusLabel,
          stateLabel: state,
        });
      }

      // Get waiting callers
      // Columns: queue|instance_id|uuid|session_uuid|cid_number|cid_name|system_epoch|
      //          joined_epoch|rejoined_epoch|bridge_epoch|abandoned_epoch|base_score|
      //          skill_score|serving_agent|serving_system|state|score
      const queueName = queue
        ? (queue.includes('@') ? queue : `${queue}@${FS_DOMAIN}`)
        : `tavl-agents@${FS_DOMAIN}`;
      const nowEpoch = Math.floor(Date.now() / 1000);
      try {
        const queueOutput = await this._api(`callcenter_config queue list members ${queueName}`);
        const qLines = queueOutput.split('\n').filter((l: string) => l.includes('|'));
        let position = 1;
        for (const line of qLines) {
          const parts = line.split('|').map((s: string) => s.trim());
          if (parts.length < 8) continue;
          if (parts[0] === 'queue') continue; // header row
          const state = parts[15] || '';
          // Only callers STILL waiting in queue. mod_callcenter member states are
          // Waiting | Trying | Answered | Abandoned. 'Answered' = already bridged to
          // an agent (now an active call shown on the Agent Board, NOT waiting);
          // 'Abandoned' = hung up. Showing either inflated the waiting list/count.
          if (state !== 'Waiting' && state !== 'Trying') continue;
          const joinedEpoch = parseInt(parts[7]) || 0;
          callers.push({
            queue: queue || 'tavl-agents',
            position: position++,
            channel: parts[2] || '',       // uuid (channel identifier)
            callerId: parts[4] || '',      // cid_number (actual phone number)
            callerIdName: parts[5] || '',  // cid_name
            wait: joinedEpoch > 0 ? Math.max(0, nowEpoch - joinedEpoch) : 0,
          });
        }
      } catch { /* no waiting callers */ }

      return { success: true, members, callers };
    } catch (err: any) {
      console.error('Queue status error:', err.message);
      return { success: false, members: [], callers: [], error: err.message };
    }
  }

  /**
   * Remove any agent tiered to `queue` whose extension is NOT in `allowedExtensions`.
   * Guards against stray tiers (e.g. orphaned FusionPBX/runtime agents, executive
   * extensions) that would otherwise ring on inbound queue calls. Defensive: if the
   * agent/tier list can't be read, it does nothing rather than risk removing real agents.
   */
  async reconcileQueueAgents(queue: string, allowedExtensions: Set<string>): Promise<{ removed: string[] }> {
    const removed: string[] = [];
    if (!this.conn || !this.isConnected) return { removed };
    const queueName = queue.includes('@') ? queue : `${queue}@${FS_DOMAIN}`;

    try {
      // Map agent name → resolved extension (from "<ext>@" name or "user/<ext>@" contact)
      const agentOutput = await this._api('callcenter_config agent list');
      const agentLines = agentOutput.split('\n').filter((l) => l.includes('|'));
      if (agentLines.length === 0) return { removed }; // can't read — don't risk removals
      const extByAgent = new Map<string, string>();
      for (const line of agentLines) {
        const p = line.split('|').map((s) => s.trim());
        if (p.length < 5 || p[0] === 'name') continue;
        const name = p[0];
        const contact = p[4] || '';
        const m = name.match(/^(\d+)@/) || contact.match(/user\/(\d+)@/);
        if (m) extByAgent.set(name, m[1]);
      }

      const tierOutput = await this._api('callcenter_config tier list');
      const tierLines = tierOutput.split('\n').filter((l) => l.includes('|'));
      for (const line of tierLines) {
        const p = line.split('|').map((s) => s.trim());
        if (p.length < 2 || p[0] === 'queue') continue;
        if (p[0] !== queueName) continue; // only this queue
        const agentName = p[1];
        const ext = extByAgent.get(agentName);
        if (!ext) continue;                       // can't resolve — leave it alone
        if (allowedExtensions.has(ext)) continue; // authorised agent — keep
        try {
          await this._api(`callcenter_config tier del ${queueName} ${agentName}`);
          await this._api(`callcenter_config agent del ${agentName}`);
          removed.push(`${ext} (${agentName})`);
        } catch (e: any) {
          console.warn(`⚠️ reconcile: failed to remove ${agentName}: ${e.message}`);
        }
      }
      if (removed.length) {
        console.log(`🧹 Queue reconcile (${queue}): removed unauthorised agents → ${removed.join(', ')}`);
      }
    } catch (err: any) {
      console.error('Queue reconcile error:', err.message);
    }
    return { removed };
  }

  // ── Channel Lookup ─────────────────────────────────────────────

  async findAgentCallChannels(extension: string): Promise<{
    agentChannel: string | null;
    partnerChannel: string | null;
  }> {
    if (!this.conn || !this.isConnected) return { agentChannel: null, partnerChannel: null };

    try {
      const channels = await this.getActiveChannels();

      console.log(`🔍 findAgentCallChannels(${extension}): ${channels.length} active channels`);

      // Agent legs for this ext (accountcode is the only reliable id for WebRTC;
      // name match also catches deskphones). Prefer a leg that is actually bridged.
      const agentLegs = channels.filter((ch: any) => isAgentChannel(ch, extension) && !DEAD_STATES.has(ch.state));
      const agentCh = agentLegs.find((ch: any) => findBridgePartnerUuid(ch, channels)) || agentLegs[0];

      if (!agentCh) {
        console.log(`🔍 No channel found for extension ${extension}`);
        return { agentChannel: null, partnerChannel: null };
      }

      const agentUuid = agentCh.uniqueId || agentCh.channel;

      // Partner via call_uuid pairing (b_uuid is not present in `show channels`).
      let partnerUuid = findBridgePartnerUuid(agentCh, channels);

      // Fallback — ask FreeSWITCH directly for the bridged partner uuid.
      if (!partnerUuid && agentUuid) {
        for (const v of ['bridge_uuid', 'signal_bond']) {
          try {
            const u = (await this._api(`uuid_getvar ${agentUuid} ${v}`)).trim();
            if (u && !u.startsWith('-ERR') && u !== '_undef_') { partnerUuid = u; break; }
          } catch { /* keep trying */ }
        }
      }

      console.log(`🔍 Result: agent=${agentUuid} (acct=${agentCh.accountcode}), partner=${partnerUuid || 'NONE'}`);

      return { agentChannel: agentUuid, partnerChannel: partnerUuid || null };
    } catch (err: any) {
      console.error(`🔍 findAgentCallChannels error:`, err.message);
      return { agentChannel: null, partnerChannel: null };
    }
  }

  // ── Conferencing ───────────────────────────────────────────────

  async startConference(params: {
    extension: string;
    destination: string;
    callerId?: string;
    callerIdName?: string;
  }): Promise<{ success: boolean; conferenceRoom?: string; heldChannelUuid?: string; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const { extension, destination, callerId, callerIdName } = params;
    const { agentChannel, partnerChannel } = await this.findAgentCallChannels(extension);

    if (!agentChannel) return { success: false, error: 'No active call found for this extension' };
    if (!partnerChannel) return { success: false, error: 'Cannot find bridged partner channel' };

    const ts = Date.now() % 100000;
    const conferenceRoom = `tavlconf${extension}${ts}`;
    const holdRoom = `tavlhold${extension}${ts}`;
    console.log(`🎤 Starting conference ${conferenceRoom}, hold room ${holdRoom}: agent=${agentChannel} partner=${partnerChannel} third=${destination}`);

    try {
      // Keep both legs alive when the bridge breaks — must be set before any transfer.
      // park_after_bridge=true on agent means it briefly parks when the bridge dissolves,
      // giving us a stable state to immediately grab and move into the conference.
      await this._api(`uuid_setvar ${agentChannel} park_after_bridge true`).catch(() => {});
      await this._api(`uuid_setvar ${partnerChannel} park_after_bridge true`).catch(() => {});
      await this._api(`uuid_setvar ${agentChannel} hangup_after_bridge false`).catch(() => {});
      await this._api(`uuid_setvar ${partnerChannel} hangup_after_bridge false`).catch(() => {});

      // Override the conference's moh-sound and alone-sound for the customer so they hear
      // our custom MoH instead of the default hold_music, with no "you are alone" message.
      // The conference module auto-plays moh-sound to members who are alone and stops it
      // when others join — far cleaner than uuid_displace overlay.
      await this._api(`uuid_setvar ${partnerChannel} conference_moh_sound local_stream://tavl_moh`).catch(() => {});
      await this._api(`uuid_setvar ${partnerChannel} conference_alone_sound silence_stream://1`).catch(() => {});

      // Move customer into hold conference first (breaks bridge).
      try {
        await this._api(`uuid_transfer ${partnerChannel} conference:${holdRoom}@default inline`);
        console.log(`🎤 Customer moved to hold room ${holdRoom}`);
      } catch (err: any) {
        console.warn(`🎤 Customer hold transfer failed: ${err.message}`);
      }

      // Move agent into main conference immediately — no delay.
      // The callcenter module reclaims the agent channel within ~300ms;
      // we must transfer it before that window closes.
      try {
        await this._api(`uuid_transfer ${agentChannel} conference:${conferenceRoom}@default inline`);
        console.log(`🎤 Agent moved into conference ${conferenceRoom}`);
      } catch (err: any) {
        console.error(`🎤 Agent transfer failed (${agentChannel}): ${err.message}`);
        return { success: false, error: `Could not move agent into conference: ${err.message}` };
      }

      // Brief pause then originate third party (bank/leasing) into the conference.
      await new Promise(r => setTimeout(r, 300));

      const formattedDest = destination.replace(/[\s\-()]/g, '');
      const isInternal = /^\d{2,5}$/.test(formattedDest);
      const channel = isInternal
        ? `user/${formattedDest}@${FS_DOMAIN}`
        : `sofia/gateway/${process.env.FREESWITCH_TRUNK || 'trunk-robocall'}/${formattedDest}`;

      try {
        await this._bgapi(`originate {origination_caller_id_name='${callerIdName || 'Conference'}',origination_caller_id_number=${callerId || extension},ignore_early_media=true}${channel} &conference(${conferenceRoom}@default)`);
        console.log(`🎤 Third-party originate queued: ${channel} → ${conferenceRoom}`);
      } catch (err: any) {
        console.warn(`⚠️ Third-party originate failed: ${err.message} — conference still active with agent only`);
      }

      // Return heldChannelUuid so the client can trigger merge when ready.
      return { success: true, conferenceRoom, holdRoom, heldChannelUuid: partnerChannel };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async mergeHeldToConference(conferenceRoom: string, holdRoom: string, heldChannelUuid: string): Promise<{ success: boolean; error?: string }> {
    console.log(`🎤 mergeHeld: conferenceRoom=${conferenceRoom} holdRoom=${holdRoom} heldChannelUuid=${heldChannelUuid}`);
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      // Find the member ID inside the hold conference, then use the native conference
      // transfer command. The conference module auto-stops moh-sound the moment another
      // member is present in the target room — no MoH cleanup needed.
      let merged = false;
      try {
        const listOut = await this._api(`conference ${holdRoom} list`);
        const memberLine = listOut.split('\n').find(l => l.includes(heldChannelUuid));
        if (memberLine) {
          const memberId = memberLine.split(';')[0].trim();
          const transferOut = await this._api(`conference ${holdRoom} transfer ${conferenceRoom} ${memberId}`);
          console.log(`🎤 Merged held customer ${heldChannelUuid} from ${holdRoom} → ${conferenceRoom} (member ${memberId}): ${transferOut.trim()}`);
          merged = true;
        }
      } catch (e: any) {
        console.warn(`🎤 Conference transfer threw: ${e.message}`);
      }

      if (!merged) {
        const out = await this._api(`uuid_transfer ${heldChannelUuid} conference:${conferenceRoom}@default inline`);
        console.log(`🎤 Merged via uuid_transfer fallback: ${out.trim()}`);
      }

      return { success: true };
    } catch (err: any) {
      console.error(`🎤 mergeHeld FATAL: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async addToConference(params: {
    destination: string;
    conferenceRoom: string;
    callerId?: string;
    callerIdName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };

    const { destination, conferenceRoom, callerId, callerIdName } = params;
    const formattedDest = destination.replace(/[\s\-()]/g, '');
    const isInternal = /^\d{2,5}$/.test(formattedDest);
    const channel = isInternal
      ? `user/${formattedDest}@${FS_DOMAIN}`
      : `sofia/gateway/${process.env.FREESWITCH_TRUNK || 'trunk-robocall'}/${formattedDest}`;

    try {
      await this._bgapi(`originate {origination_caller_id_name='${callerIdName || 'Conference'}',origination_caller_id_number=${callerId || ''},ignore_early_media=true}${channel} &conference(${conferenceRoom}@default)`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getConferenceParticipants(conferenceRoom: string): Promise<{
    success: boolean;
    participants: Array<{ memberId: string; channel: string; uuid: string; callerIdNum: string; callerIdName: string; admin: boolean; muted: boolean }>;
  }> {
    if (!this.conn || !this.isConnected) return { success: false, participants: [] };

    try {
      const output = await this._api(`conference ${conferenceRoom} list`);
      const participants: Array<{ memberId: string; channel: string; uuid: string; callerIdNum: string; callerIdName: string; admin: boolean; muted: boolean }> = [];

      // Format: member_id;channel;uuid;caller_id_name;caller_id_number;flags\n
      const lines = output.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        const parts = line.split(';');
        if (parts.length < 5) continue;
        participants.push({
          memberId: parts[0] || '',
          channel: parts[1] || '',
          uuid: parts[2] || '',
          callerIdNum: parts[4] || '',
          callerIdName: parts[3] || '',
          admin: (parts[5] || '').includes('moderator'),
          // FS shows 'mute' in flags when mic-muted; absence of 'speak' also indicates muted
          muted: (parts[5] || '').includes('mute') || !(parts[5] || '').includes('speak'),
        });
      }

      return { success: true, participants };
    } catch {
      return { success: true, participants: [] };
    }
  }

  async kickFromConference(conferenceRoom: string, memberId: string, uuid?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      await this._api(`conference ${conferenceRoom} kick ${memberId}`);
      return { success: true };
    } catch (err: any) {
      if (uuid) {
        try { await this._api(`uuid_kill ${uuid}`); return { success: true }; } catch {}
      }
      return { success: false, error: err.message };
    }
  }

  async muteConferenceParticipant(conferenceRoom: string, memberId: string, mute: boolean): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      // mute  = participant can't speak (others can't hear them)
      // deaf  = participant can't hear (they can't hear others)
      // Both together = full isolation from the conference
      const muteCmd = mute
        ? `conference ${conferenceRoom} mute ${memberId}`
        : `conference ${conferenceRoom} unmute ${memberId}`;
      const deafCmd = mute
        ? `conference ${conferenceRoom} deaf ${memberId}`
        : `conference ${conferenceRoom} undeaf ${memberId}`;
      await this._api(muteCmd);
      await this._api(deafCmd);
      console.log(`📞 Conference ${mute ? 'mute+deaf' : 'unmute+undeaf'}: room=${conferenceRoom} member=${memberId}`);
      return { success: true };
    } catch (err: any) {
      console.error(`❌ Conference ${mute ? 'mute' : 'unmute'} failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async endConference(conferenceRoom: string): Promise<{ success: boolean; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      await this._api(`conference ${conferenceRoom} hupall`);
      console.log(`📞 Conference ended: room=${conferenceRoom}`);
      return { success: true };
    } catch (err: any) {
      console.error(`❌ Conference end failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ── Generic command / action ───────────────────────────────────

  async sendCommand(command: string): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!this.conn || !this.isConnected) return { success: false, error: 'ESL not connected' };
    try {
      const output = await this._api(command);
      return { success: true, output };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async sendAction(params: Record<string, any>): Promise<{ success: boolean; data?: any; error?: string }> {
    const cmd = params.command || params.action || '';
    if (!cmd) return { success: false, error: 'No command provided' };
    return this.sendCommand(cmd);
  }

  // ── Status / Getters ───────────────────────────────────────────

  getConnectionStatus(): boolean { return this.isConnected; }
  getActiveCalls(): Map<string, any> { return this.activeCalls; }
  getInboundCalls(): Map<string, InboundCallInfo> { return this.inboundCalls; }

  getInboundCallByCallerId(callerId: string): InboundCallInfo | undefined {
    for (const call of this.inboundCalls.values()) {
      if (call.callerId === callerId) return call;
    }
    return undefined;
  }

  getActiveInboundCalls(): InboundCallInfo[] {
    return Array.from(this.inboundCalls.values()).filter(c => c.state !== 'ended');
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.conn) { try { this.conn.disconnect(); } catch {} this.conn = null; }
    this.isConnected = false;
  }
}

// Singleton — same export shape as ami.ts
export const eslConnection = new EslConnection();

export async function initEsl(): Promise<boolean> {
  return eslConnection.connect();
}

// Default export matches `amiConnection` usage across the codebase
export default eslConnection;
