/**
 * CDR (Call Detail Records) API Routes
 * Provides call history, stats, recording playback, and CSV export
 * Data source: FusionPBX PostgreSQL `v_xml_cdr` table
 */

import { Router, Request, Response } from 'express';
import { queryFusionPbx } from '../db/fusionpbx';
import { queryPbxDb } from '../db/pbx-admin-db';
import { normalizeNumbers, buildCustomerCdrQuery, classifyCall } from './cdr-helpers';
import eslConnection from '../freeswitch/esl';
import fs from 'fs';

const router = Router();

const CUSTOMER_CDR_LIMIT = 300;

// Cached extension/agent name lookups (118 extensions, refreshed every 10 min)
let lookupCache: { ext: Record<string, string>; agents: Record<string, string>; ts: number } | null = null;
const LOOKUP_TTL_MS = 10 * 60 * 1000;

async function getLookupMaps(): Promise<{ ext: Record<string, string>; agents: Record<string, string> }> {
  if (lookupCache && Date.now() - lookupCache.ts < LOOKUP_TTL_MS) return lookupCache;
  const ext: Record<string, string> = {};
  const agents: Record<string, string> = {};
  // Office staff (100-308) live in FusionPBX v_extensions
  try {
    const rows = await queryFusionPbx(`SELECT extension, effective_caller_id_name FROM v_extensions`);
    for (const r of rows) if (r.extension && r.effective_caller_id_name) ext[String(r.extension)] = r.effective_caller_id_name;
  } catch (e: any) {
    console.error('Extension lookup (v_extensions) failed:', e.message);
  }
  // Call-center agents (450-468) and 999=Robocall live in pbx_admin.extensions — takes precedence
  try {
    const rows = await queryPbxDb(`SELECT extension, caller_id_name FROM extensions WHERE enabled = true`);
    for (const r of rows) if (r.extension && r.caller_id_name) ext[String(r.extension)] = r.caller_id_name;
  } catch (e: any) {
    console.error('Extension lookup (pbx_admin) failed:', e.message);
  }
  try {
    const rows = await queryFusionPbx(`SELECT call_center_agent_uuid, agent_name FROM v_call_center_agents`);
    for (const r of rows) if (r.call_center_agent_uuid && r.agent_name) agents[r.call_center_agent_uuid] = r.agent_name;
  } catch (e: any) {
    console.error('Agent lookup failed:', e.message);
  }
  lookupCache = { ext, agents, ts: Date.now() };
  return lookupCache;
}

const FS_HOST = process.env.FREESWITCH_HOST || '192.168.20.140';
const FS_USER = process.env.FREESWITCH_SSH_USER || 'iteckadmin';
const FS_PASS = process.env.FREESWITCH_SSH_PASSWORD || '';
const RECORDINGS_BASE = `/usr/local/freeswitch/recordings`;

/**
 * GET /api/cdr
 * Paginated CDR records with filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '50',
      dateFrom,
      dateTo,
      src,
      dst,
      disposition,
      userfield,
      search,
      sortBy = 'start_stamp',
      sortOrder = 'DESC',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    // Exclude callcenter agent-offer legs (cc_side='agent'): they are the
    // bridged answer legs whose destination is a meaningless WebRTC contact
    // (e.g. 'vmmoilkh') and they duplicate the member (caller) row. The agent
    // who answered is attached below via cc_member_session_uuid enrichment.
    const conditions: string[] = ["destination_number NOT LIKE 'autocall_%'", "cc_side IS DISTINCT FROM 'agent'"];
    const params: any[] = [];
    let paramIdx = 1;

    if (dateFrom) {
      conditions.push(`start_stamp >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`start_stamp <= $${paramIdx++}`);
      params.push(dateTo);
    }
    if (src) {
      conditions.push(`caller_id_number ILIKE $${paramIdx++}`);
      params.push(`%${src}%`);
    }
    if (dst) {
      conditions.push(`destination_number ILIKE $${paramIdx++}`);
      params.push(`%${dst}%`);
    }
    if (disposition) {
      const dispMap: Record<string, string[]> = {
        'ANSWERED': ['NORMAL_CLEARING'],
        'NO ANSWER': ['NO_ANSWER', 'NO_USER_RESPONSE', 'ORIGINATOR_CANCEL'],
        'BUSY': ['USER_BUSY'],
        'FAILED': ['CALL_REJECTED', 'NORMAL_TEMPORARY_FAILURE', 'UNALLOCATED_NUMBER', 'SUBSCRIBER_ABSENT'],
      };
      const causes = dispMap[disposition as string];
      if (causes) {
        if (disposition === 'ANSWERED') {
          conditions.push(`(hangup_cause = 'NORMAL_CLEARING' AND billsec > 0)`);
        } else {
          const placeholders = causes.map(() => `$${paramIdx++}`).join(', ');
          conditions.push(`hangup_cause IN (${placeholders})`);
          params.push(...causes);
        }
      } else {
        conditions.push(`hangup_cause = $${paramIdx++}`);
        params.push(disposition);
      }
    }
    if (userfield) {
      if (userfield === 'autocall') {
        // Robocall legs carry accountcode='autocall' (direction is blank).
        conditions.push(`accountcode = 'autocall'`);
      } else {
        conditions.push(`direction = $${paramIdx++} AND accountcode IS DISTINCT FROM 'autocall'`);
        params.push(userfield);
      }
    }
    if (search) {
      conditions.push(`(caller_id_number ILIKE $${paramIdx} OR destination_number ILIKE $${paramIdx} OR caller_id_name ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const DISPOSITION_CASE = `
      CASE
        WHEN hangup_cause = 'NORMAL_CLEARING' AND billsec > 0 THEN 'ANSWERED'
        WHEN hangup_cause IN ('NO_ANSWER','NO_USER_RESPONSE','ORIGINATOR_CANCEL') THEN 'NO ANSWER'
        WHEN hangup_cause = 'USER_BUSY' THEN 'BUSY'
        ELSE 'FAILED'
      END`;

    const allowedSorts: Record<string, string> = {
      calldate: 'start_stamp',
      start_stamp: 'start_stamp',
      src: 'caller_id_number',
      dst: 'destination_number',
      duration: 'duration',
      billsec: 'billsec',
      disposition: 'hangup_cause',
    };
    const safeSortBy = allowedSorts[sortBy as string] || 'start_stamp';
    const safeSortOrder = (sortOrder as string).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countQuery = `SELECT COUNT(*) as total FROM v_xml_cdr ${whereClause}`;
    const countResult = await queryFusionPbx(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0');

    const dataQuery = `
      SELECT
        xml_cdr_uuid as id,
        start_stamp as calldate,
        caller_id_name as clid,
        caller_id_number as src,
        destination_number as dst,
        context as dcontext,
        '' as channel,
        '' as dstchannel,
        last_app as lastapp,
        last_arg as lastdata,
        duration::int as duration,
        billsec::int as billsec,
        ${DISPOSITION_CASE} as disposition,
        0 as amaflags,
        accountcode,
        xml_cdr_uuid as uniqueid,
        CASE WHEN accountcode = 'autocall' THEN 'autocall' ELSE direction END as userfield,
        cc_side,
        bridge_uuid as linkedid,
        record_path,
        record_name,
        record_length
      FROM v_xml_cdr ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(limitNum, offset);

    const rows = await queryFusionPbx(dataQuery, params);

    // Enrich inbound queue calls with the agent who answered. The bridged agent
    // leg links back via cc_member_session_uuid = the member leg's xml_cdr_uuid.
    // Page-bounded (only this page's member UUIDs) to stay fast on the big table.
    const memberUuids = rows
      .filter((r: any) => r.cc_side === 'member' && r.uniqueid)
      .map((r: any) => r.uniqueid);
    if (memberUuids.length > 0) {
      try {
        const agentRows = await queryFusionPbx(
          `SELECT cc_member_session_uuid::text AS sess, cc_agent, accountcode, billsec
           FROM v_xml_cdr
           WHERE cc_side = 'agent' AND cc_member_session_uuid = ANY($1::uuid[])`,
          [memberUuids]
        );
        // A queued call may ring several agents; the one that answered has the
        // most talk time. Keep the max-billsec agent per member session.
        const bySession = new Map<string, any>();
        for (const a of agentRows) {
          const cur = bySession.get(a.sess);
          if (!cur || (a.billsec || 0) > (cur.billsec || 0)) bySession.set(a.sess, a);
        }
        for (const r of rows as any[]) {
          if (r.cc_side === 'member') {
            const a = bySession.get(r.uniqueid);
            const ext = a ? ((a.cc_agent ? String(a.cc_agent).split('@')[0] : '') || a.accountcode || '') : '';
            if (ext) r.answered_by = ext;
          }
        }
      } catch (e: any) {
        console.error('CDR answering-agent enrichment error:', e.message);
      }
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('CDR query error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cdr/customer
 * Call history for a customer: all CDR where any of the supplied numbers
 * appears as EITHER caller or destination. Used by the Vehicle History
 * panel's "Calls" tab. Numbers are matched on their last 10 digits.
 */
router.get('/customer', async (req: Request, res: Response) => {
  try {
    const { numbers, dateFrom, dateTo, limit } = req.query;

    const rawList = String(numbers || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const normalized = normalizeNumbers(rawList);

    if (normalized.length === 0) {
      return res.json({ success: true, data: [], numbers: [], truncated: false });
    }

    const limitNum = Math.min(
      CUSTOMER_CDR_LIMIT,
      Math.max(1, parseInt(String(limit || CUSTOMER_CDR_LIMIT)) || CUSTOMER_CDR_LIMIT)
    );
    const from = (dateFrom as string) || '1970-01-01 00:00:00';
    const to = (dateTo as string) || '2999-12-31 23:59:59';

    const { text, values } = buildCustomerCdrQuery(normalized, from, to, limitNum);
    const [rows, maps] = await Promise.all([queryFusionPbx(text, values), getLookupMaps()]);
    const enriched = rows.map((r) => classifyCall(r, maps.ext, maps.agents));

    res.json({
      success: true,
      data: enriched,
      numbers: normalized,
      truncated: rows.length >= limitNum,
    });
  } catch (error: any) {
    console.error('Customer CDR error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cdr/stats
 * Aggregated call statistics for a date range
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (dateFrom) {
      conditions.push(`start_stamp >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`start_stamp <= $${paramIdx++}`);
      params.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const statsQuery = `
      SELECT
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE hangup_cause = 'NORMAL_CLEARING' AND billsec > 0) as answered,
        COUNT(*) FILTER (WHERE hangup_cause IN ('NO_ANSWER','NO_USER_RESPONSE','ORIGINATOR_CANCEL')) as no_answer,
        COUNT(*) FILTER (WHERE hangup_cause = 'USER_BUSY') as busy,
        COUNT(*) FILTER (WHERE hangup_cause NOT IN ('NORMAL_CLEARING','NO_ANSWER','NO_USER_RESPONSE','USER_BUSY','ORIGINATOR_CANCEL')) as failed,
        COUNT(*) FILTER (WHERE hangup_cause = 'NORMAL_CLEARING' AND billsec = 0) as other,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound,
        COUNT(*) FILTER (WHERE direction = 'local') as internal,
        0 as autocall,
        ROUND(AVG(duration), 1) as avg_duration,
        ROUND(AVG(billsec), 1) as avg_billsec,
        MAX(duration)::int as max_duration,
        SUM(billsec)::int as total_billsec,
        ROUND(
          (COUNT(*) FILTER (WHERE hangup_cause = 'NORMAL_CLEARING' AND billsec > 0))::numeric /
          NULLIF(COUNT(*), 0) * 100, 1
        ) as answer_rate
      FROM v_xml_cdr ${whereClause}
    `;

    const stats = await queryFusionPbx(statsQuery, params);

    const hourlyQuery = `
      SELECT
        EXTRACT(HOUR FROM start_stamp) as hour,
        COUNT(*) as calls,
        COUNT(*) FILTER (WHERE hangup_cause = 'NORMAL_CLEARING' AND billsec > 0) as answered
      FROM v_xml_cdr ${whereClause}
      GROUP BY EXTRACT(HOUR FROM start_stamp)
      ORDER BY hour
    `;
    const hourly = await queryFusionPbx(hourlyQuery, params);

    const topCallersQuery = `
      SELECT caller_id_number as src, COUNT(*) as call_count,
             ROUND(AVG(duration), 0) as avg_duration
      FROM v_xml_cdr ${whereClause} ${conditions.length > 0 ? 'AND' : 'WHERE'}
        caller_id_number != '' AND LENGTH(caller_id_number) >= 7
      GROUP BY caller_id_number ORDER BY call_count DESC LIMIT 10
    `;
    const topCallers = await queryFusionPbx(topCallersQuery, params);

    const topDestQuery = `
      SELECT destination_number as dst, COUNT(*) as call_count,
             ROUND(AVG(duration), 0) as avg_duration
      FROM v_xml_cdr ${whereClause} ${conditions.length > 0 ? 'AND' : 'WHERE'}
        destination_number != '' AND destination_number != 's'
      GROUP BY destination_number ORDER BY call_count DESC LIMIT 10
    `;
    const topDestinations = await queryFusionPbx(topDestQuery, params);

    res.json({
      success: true,
      stats: stats[0] || {},
      hourly,
      topCallers,
      topDestinations,
    });
  } catch (error: any) {
    console.error('CDR stats error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cdr/recording/:uniqueid
 * Stream a call recording file
 * FusionPBX stores recordings with path+name in v_xml_cdr
 */
router.get('/recording/:uniqueid', async (req: Request, res: Response) => {
  try {
    const { uniqueid } = req.params;

    if (!uniqueid) {
      return res.status(400).json({ success: false, error: 'uniqueid required' });
    }

    if (!FS_PASS) {
      return res.status(500).json({ success: false, error: 'SSH password not configured' });
    }

    const { execSync } = require('child_process');

    // The recording filename embeds an xml_cdr_uuid, but for a bridged call it
    // may be EITHER leg's uuid. The displayed row and its bridge partner
    // reference each other (xml_cdr_uuid <-> bridge_uuid), so search by both.
    let recordPath = '';
    let recordName = '';
    const candidateUuids = [uniqueid];
    try {
      const rows = await queryFusionPbx(
        `SELECT bridge_uuid::text AS bridge, record_path, record_name
         FROM v_xml_cdr WHERE xml_cdr_uuid::text = $1 LIMIT 1`,
        [uniqueid]
      );
      if (rows[0]?.bridge) candidateUuids.push(rows[0].bridge);
      if (rows[0]?.record_name) {
        recordPath = rows[0].record_path || '';
        recordName = rows[0].record_name || '';
      }
    } catch {}
    // Sanitize (these go into a shell command) and de-dupe.
    const uuids = [...new Set(candidateUuids)].filter(u => /^[a-fA-F0-9-]{8,}$/.test(u));

    // Build the search command: DB path first, then by UUID across both stores.
    const searchPaths: string[] = [];
    if (recordPath && recordName) {
      searchPaths.push(`${recordPath}/${recordName}`);
    }
    for (const u of uuids) {
      searchPaths.push(
        // Custom dialplan recordings: /callrecording/{incoming,outgoing}/YYYY/MM/DD/<TYPE>_<num>_<num>_<uuid>.wav
        `/callrecording/*/*/*/*/*${u}*.wav`,
        // FusionPBX default record-session location
        `${RECORDINGS_BASE}/${FS_HOST}/${u}.wav`,
        `${RECORDINGS_BASE}/${FS_HOST}/archive/*/*/*/${u}.wav`,
      );
    }

    const findCmd = searchPaths.map(p => `ls "${p}" 2>/dev/null`).join(' ; ');
    const listCmd = `sshpass -p '${FS_PASS}' ssh -o StrictHostKeyChecking=no ${FS_USER}@${FS_HOST} "(${findCmd}) | head -1"`;

    let remoteFile: string;
    try {
      remoteFile = execSync(listCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }

    if (!remoteFile) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }

    const safeId = uniqueid.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = remoteFile.endsWith('.mp3') ? 'mp3' : 'wav';
    const localTmp = `/tmp/cdr-recording-${safeId}.${ext}`;

    const scpCmd = `sshpass -p '${FS_PASS}' scp -o StrictHostKeyChecking=no ${FS_USER}@${FS_HOST}:"${remoteFile}" "${localTmp}"`;
    execSync(scpCmd, { timeout: 15000 });

    const stat = fs.statSync(localTmp);
    const asDownload = req.query.download === '1' || req.query.download === 'true';
    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'audio/wav');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `${asDownload ? 'attachment' : 'inline'}; filename="recording-${safeId}.${ext}"`);

    const stream = fs.createReadStream(localTmp);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(localTmp, () => {});
    });
  } catch (error: any) {
    console.error('Recording fetch error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cdr/recordings/list
 * List available recordings from FreeSWITCH server
 */
router.get('/recordings/list', async (_req: Request, res: Response) => {
  try {
    if (!FS_PASS) {
      return res.json({ success: true, recordings: [], error: 'SSH not configured' });
    }

    // Query the database for recent recordings
    try {
      const rows = await queryFusionPbx(`
        SELECT xml_cdr_uuid as uniqueid, start_stamp as date,
               caller_id_number as src, destination_number as dst,
               record_name as filename, record_length as length,
               duration::int as duration, hangup_cause
        FROM v_xml_cdr
        WHERE record_name IS NOT NULL AND record_name != ''
          AND destination_number NOT LIKE 'autocall_%'
        ORDER BY start_stamp DESC
        LIMIT 100
      `);
      const recordings = rows.map((r: any) => ({
        uniqueid: r.uniqueid,
        filename: r.filename || '',
        size: 0,
        date: r.date,
        src: r.src,
        dst: r.dst,
        duration: r.duration,
        length: r.length,
      }));
      return res.json({ success: true, recordings });
    } catch {}

    // Fallback: list files from disk via SSH
    const { execSync } = require('child_process');
    const listCmd = `sshpass -p '${FS_PASS}' ssh -o StrictHostKeyChecking=no ${FS_USER}@${FS_HOST} "find ${RECORDINGS_BASE}/${FS_HOST} -name '*.wav' -o -name '*.mp3' 2>/dev/null | head -100"`;

    let output: string;
    try {
      output = execSync(listCmd, { encoding: 'utf-8', timeout: 10000 }).trim();
    } catch {
      return res.json({ success: true, recordings: [] });
    }

    const recordings = output.split('\n')
      .filter(line => line.trim())
      .map(filepath => {
        const filename = filepath.split('/').pop() || '';
        return { filename, size: 0, date: '', uniqueid: filename.replace(/\.(wav|mp3)$/, '') };
      });

    res.json({ success: true, recordings });
  } catch (error: any) {
    console.error('Recordings list error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cdr/export
 * Export CDR data as CSV
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { dateFrom, dateTo, disposition, userfield } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (dateFrom) {
      conditions.push(`start_stamp >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`start_stamp <= $${paramIdx++}`);
      params.push(dateTo);
    }
    if (disposition) {
      conditions.push(`hangup_cause = $${paramIdx++}`);
      params.push(disposition);
    }
    if (userfield) {
      if (userfield === 'autocall') {
        // Robocall legs carry accountcode='autocall' (direction is blank).
        conditions.push(`accountcode = 'autocall'`);
      } else {
        conditions.push(`direction = $${paramIdx++} AND accountcode IS DISTINCT FROM 'autocall'`);
        params.push(userfield);
      }
    }

    conditions.push("destination_number NOT LIKE 'autocall_%'");
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await queryFusionPbx(
      `SELECT start_stamp as calldate, caller_id_name as clid,
              caller_id_number as src, destination_number as dst,
              context as dcontext, duration::int as duration,
              billsec::int as billsec,
              CASE
                WHEN hangup_cause = 'NORMAL_CLEARING' AND billsec > 0 THEN 'ANSWERED'
                WHEN hangup_cause IN ('NO_ANSWER','NO_USER_RESPONSE','ORIGINATOR_CANCEL') THEN 'NO ANSWER'
                WHEN hangup_cause = 'USER_BUSY' THEN 'BUSY'
                ELSE 'FAILED'
              END as disposition,
              CASE WHEN accountcode = 'autocall' THEN 'autocall' ELSE direction END as userfield, xml_cdr_uuid as uniqueid
       FROM v_xml_cdr ${whereClause}
       ORDER BY start_stamp DESC
       LIMIT 10000`,
      params
    );

    const csvHeader = 'Date,CallerID,Source,Destination,Context,Duration(s),BillSec(s),Disposition,Type,UniqueID\n';
    const csvRows = rows.map((r: any) =>
      `"${r.calldate}","${r.clid || ''}","${r.src || ''}","${r.dst || ''}","${r.dcontext || ''}",${r.duration},${r.billsec},"${r.disposition}","${r.userfield || ''}","${r.uniqueid}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cdr-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvHeader + csvRows);
  } catch (error: any) {
    console.error('CDR export error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cdr/queue-stats
 * Live queue statistics from ESL
 */
router.get('/queue-stats', async (_req: Request, res: Response) => {
  try {
    const eslConn = eslConnection;
    const queueName = process.env.AUTOCALL_QUEUE || 'tavl-agents';
    const result = await eslConn.queueStatus(queueName);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Queue stats error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cdr/monitor
 * Supervisor call monitoring: spy (silent), whisper (agent only), barge (both)
 */
router.post('/monitor', async (req: Request, res: Response) => {
  try {
    const { supervisorExtension, agentExtension, mode } = req.body;

    if (!supervisorExtension || !agentExtension) {
      res.status(400).json({ success: false, error: 'supervisorExtension and agentExtension are required' });
      return;
    }
    if (!['spy', 'whisper', 'barge'].includes(mode)) {
      res.status(400).json({ success: false, error: 'mode must be spy, whisper, or barge' });
      return;
    }

    const eslConn = eslConnection;
    if (!eslConn.getConnectionStatus()) {
      res.status(503).json({ success: false, error: 'PBX not connected' });
      return;
    }

    const result = await eslConn.monitorCall({ supervisorExtension, agentExtension, mode });
    res.json(result);
  } catch (error: any) {
    console.error('Monitor error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cdr/monitor/stop
 * Hang up the supervisor's monitoring channel
 */
router.post('/monitor/stop', async (req: Request, res: Response) => {
  try {
    const { supervisorExtension } = req.body;
    if (!supervisorExtension) {
      res.status(400).json({ success: false, error: 'supervisorExtension is required' });
      return;
    }

    const eslConn = eslConnection;
    if (!eslConn.getConnectionStatus()) {
      res.status(503).json({ success: false, error: 'PBX not connected' });
      return;
    }

    const channels = await eslConn.getActiveChannels();
    const spyChannels = channels.filter((ch: any) => {
      const name: string = ch.name || ch.channel || '';
      return name.includes(`/${supervisorExtension}@`) && (ch.application === 'eavesdrop' || ch.application === 'ChanSpy');
    });

    if (spyChannels.length === 0) {
      res.json({ success: true, message: 'No active monitoring session found' });
      return;
    }

    for (const ch of spyChannels) {
      await eslConn.hangupCall(ch.uniqueId || ch.channel);
    }

    res.json({ success: true, message: `Stopped ${spyChannels.length} monitor session(s)` });
  } catch (error: any) {
    console.error('Monitor stop error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
