import * as express from 'express';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
const multer = require('multer');
import { randomUUID } from 'crypto';
import eslConnection from '../freeswitch/esl';
import { queryPbxDb, queryPbxDbOne, getDefaultDomainId, getDefaultDomain } from '../db/pbx-admin-db';
import { queryFusionPbx } from '../db/fusionpbx';
import {
  generatePublicXml,
  generateDefaultXml,
  generateIvrConfXml,
  generateCallcenterConfXml,
  generateAllExtensionsXml,
  generateDomainIncludeXml,
  generateGatewayXmlFiles,
  generateLocalStreamConfXml,
} from '../freeswitch/xml-generator';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const router = express.Router();
const execAsync = promisify(exec);

const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================================================
// ENVIRONMENT
// ============================================================================

const PBX_HOST = process.env.FREESWITCH_HOST || '192.168.20.140';
const PBX_SSH_USER = process.env.FREESWITCH_SSH_USER || 'iteckadmin';
const PBX_SSH_PASSWORD = process.env.FREESWITCH_SSH_PASSWORD || 'Developer&*^18';
const FS_DOMAIN = process.env.FREESWITCH_DOMAIN || PBX_HOST;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-key-min-32-characters-long';

// ============================================================================
// AUTH HELPERS
// ============================================================================

function generateToken(username: string): string {
  return jwt.sign({ username, role: 'admin' }, ADMIN_JWT_SECRET, { expiresIn: '8h' });
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET) as { username: string; role: string };
    if (decoded.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }
    (req as any).adminUser = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// ============================================================================
// SSH / FS CLI HELPERS
// ============================================================================

async function sshExec(command: string): Promise<{ stdout: string; stderr: string }> {
  const sshCmd = `sshpass -p '${PBX_SSH_PASSWORD}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${PBX_SSH_USER}@${PBX_HOST} "echo '${PBX_SSH_PASSWORD}' | sudo -S ${command}" 2>&1`;
  const result = await execAsync(sshCmd, { timeout: 30000 });
  result.stdout = result.stdout.replace(/\[sudo\] password for \S+:\s*/g, '');
  return result;
}

async function scpUpload(localPath: string, remotePath: string, owner = 'freeswitch:freeswitch'): Promise<void> {
  const tmpRemotePath = `/tmp/${path.basename(localPath)}_${randomUUID()}`;
  const scpCmd = `sshpass -p '${PBX_SSH_PASSWORD}' scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${localPath}" ${PBX_SSH_USER}@${PBX_HOST}:"${tmpRemotePath}"`;
  await execAsync(scpCmd, { timeout: 30000 });
  await sshExec(`mv "${tmpRemotePath}" "${remotePath}"`);
  await sshExec(`chown ${owner} "${remotePath}"`);
  await sshExec(`chmod 644 "${remotePath}"`);
}

async function readFsFile(filepath: string): Promise<string> {
  try {
    const { stdout } = await sshExec(`cat ${filepath}`);
    return stdout;
  } catch (error: any) {
    console.error(`Error reading ${filepath}:`, error.message);
    throw new Error(`Failed to read ${filepath}`);
  }
}

async function writeFsFile(filepath: string, content: string, owner = 'freeswitch:freeswitch'): Promise<void> {
  const tempFile = `/tmp/fs_config_${Date.now()}.xml`;
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  await sshExec(`bash -c 'echo ${b64} | base64 -d > ${tempFile}'`);
  await sshExec(`cp ${tempFile} ${filepath}`);
  await sshExec(`chown ${owner} ${filepath}`);
  await sshExec(`chmod 644 ${filepath}`);
  await sshExec(`rm ${tempFile}`);
}

async function fsCli(command: string): Promise<string> {
  try {
    const result = await eslConnection.sendCommand(command);
    if (result.success && result.output) return result.output;
    throw new Error(result.error || 'ESL command failed');
  } catch (eslError: any) {
    console.warn(`ESL command failed, trying SSH fallback: ${eslError.message}`);
    try {
      const { stdout } = await sshExec(`/usr/local/freeswitch/bin/fs_cli -x '${command}'`);
      return stdout;
    } catch (sshError: any) {
      console.error(`fs_cli error (both ESL and SSH failed):`, sshError.message);
      throw sshError;
    }
  }
}

// ============================================================================
// XML SYNC — push all generated XML to FS after any config change
// ============================================================================

type SyncScope = 'dialplan' | 'extensions' | 'gateways' | 'moh' | 'all';

async function uploadText(content: string, remotePath: string): Promise<void> {
  const tmp = `/tmp/pbx_sync_${randomUUID()}`;
  fs.writeFileSync(tmp, content);
  try {
    await scpUpload(tmp, remotePath);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Upload an audio file to FS, converting to 8kHz mono WAV via remote ffmpeg.
// Falls back to raw copy if the file is already WAV or ffmpeg fails.
async function uploadAudioToFs(localPath: string, remoteFinalPath: string): Promise<{ converted: boolean }> {
  const uid = randomUUID().replace(/-/g, '').slice(0, 12);
  const origExt = path.extname(localPath).toLowerCase() || '.wav';
  const tmpOrig = `/tmp/pbx_audio_${uid}_orig${origExt}`;
  const tmpConv = `/tmp/pbx_audio_${uid}_conv.wav`;

  // SCP the original file to FS /tmp/
  const scpCmd = `sshpass -p '${PBX_SSH_PASSWORD}' scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${localPath}" ${PBX_SSH_USER}@${PBX_HOST}:"${tmpOrig}"`;
  await execAsync(scpCmd, { timeout: 30000 });

  // Convert on FS using its ffmpeg; fall back to cp for already-WAV files
  let converted = false;
  try {
    await sshExec(`/usr/bin/ffmpeg -y -i "${tmpOrig}" -ar 8000 -ac 1 -acodec pcm_s16le "${tmpConv}" 2>/dev/null`);
    converted = true;
  } catch {
    await sshExec(`cp "${tmpOrig}" "${tmpConv}"`);
  }

  // Ensure target directory exists, then move and fix ownership
  const remoteDir = remoteFinalPath.substring(0, remoteFinalPath.lastIndexOf('/'));
  await sshExec(`mkdir -p "${remoteDir}"`);
  await sshExec(`mv "${tmpConv}" "${remoteFinalPath}"`);
  await sshExec(`chown freeswitch:freeswitch "${remoteFinalPath}"`);
  await sshExec(`chmod 644 "${remoteFinalPath}"`);

  // Best-effort cleanup of temp files
  try { await sshExec(`rm -f "${tmpOrig}" 2>/dev/null`); } catch {}

  return { converted };
}

async function syncXmlToFs(scope: SyncScope = 'dialplan'): Promise<void> {
  const domain = await getDefaultDomain();
  const domainDir = `/etc/freeswitch/directory/${domain.name}`;

  // Dialplan + IVR + callcenter (the "core" admin-managed config)
  if (scope === 'dialplan' || scope === 'all') {
    const publicXml = await generatePublicXml(domain.name, domain.id);
    const defaultXml = await generateDefaultXml(domain.name, domain.id);
    const ivrXml = await generateIvrConfXml(domain.name, domain.id);
    const ccXml = await generateCallcenterConfXml(domain.name, domain.id);
    // Write to BOTH files so public.xml always has our content.
    // FusionPBX's conflicting v_dialplans entries are deleted during sync (see below)
    // so event_guard no longer regenerates public.xml with wrong content.
    await uploadText(publicXml, '/etc/freeswitch/dialplan/00-iteck-public.xml');
    await uploadText(publicXml, '/etc/freeswitch/dialplan/public.xml');
    await uploadText(defaultXml, '/etc/freeswitch/dialplan/default.xml');
    await uploadText(ivrXml, '/etc/freeswitch/autoload_configs/ivr.conf.xml');
    await uploadText(ccXml, '/etc/freeswitch/autoload_configs/callcenter.conf.xml');
    // Remove legacy FusionPBX autocall-default.xml — its rules are now in default.xml.
    // Having two files with <context name="default"> causes FS to silently drop the second one.
    await sshExec('rm -f /etc/freeswitch/dialplan/autocall-default.xml /etc/freeswitch/dialplan/autocall-default.xml.disabled').catch(() => {});
  }

  // SIP directory (extensions) — single bundle upload instead of one SCP per extension
  if (scope === 'extensions' || scope === 'all') {
    await sshExec(`mkdir -p ${domainDir}`);
    await sshExec(`chown freeswitch:freeswitch ${domainDir}`);
    // Wipe stale per-extension files (FusionPBX legacy or previous individual syncs)
    await sshExec(`rm -f ${domainDir}/*.xml`);
    // All extensions in one file — 1 SCP regardless of extension count
    const bundleXml = await generateAllExtensionsXml(domain.name, domain.id);
    await uploadText(bundleXml, `${domainDir}/_extensions.xml`);
    // Domain include
    await uploadText(generateDomainIncludeXml(domain.name), `/etc/freeswitch/directory/${domain.name}.xml`);
  }

  // SIP gateways (trunks)
  if (scope === 'gateways' || scope === 'all') {
    const gws = await generateGatewayXmlFiles(domain.id);
    const profiles = new Set(gws.map((g) => g.profile));
    // Clean known profile dirs we manage
    for (const profile of ['external', 'wan']) {
      // Only clear files we manage (all *.xml); operators can override via other profiles
      if (profiles.has(profile) || ['external', 'wan'].includes(profile)) {
        await sshExec(`mkdir -p /etc/freeswitch/sip_profiles/${profile}`);
        await sshExec(`rm -f /etc/freeswitch/sip_profiles/${profile}/*.xml`);
      }
    }
    for (const g of gws) {
      const dir = `/etc/freeswitch/sip_profiles/${g.profile}`;
      await sshExec(`mkdir -p ${dir}`);
      await uploadText(g.content, `${dir}/${g.filename}`);
    }
  }

  // MOH local_stream.conf
  if (scope === 'moh' || scope === 'all') {
    const mohXml = await generateLocalStreamConfXml(domain.id);
    await uploadText(mohXml, '/etc/freeswitch/autoload_configs/local_stream.conf.xml');
  }

  // Reload XML (always cheap)
  await sshExec('/usr/local/freeswitch/bin/fs_cli -x "reloadxml"');

  // IVR and callcenter runtime state do not always refresh on reloadxml alone.
  // Reload these modules whenever core dialplan/config files are regenerated.
  if (scope === 'dialplan' || scope === 'all') {
    await sshExec('/usr/local/freeswitch/bin/fs_cli -x "reload mod_dptools"').catch(() => {});
    await sshExec('/usr/local/freeswitch/bin/fs_cli -x "callcenter_config reload"').catch(() => {});
  }

  if (scope === 'gateways' || scope === 'all') {
    // Rescan sofia profiles so new/updated gateways take effect
    await sshExec('/usr/local/freeswitch/bin/fs_cli -x "sofia profile external rescan"').catch(() => {});
    await sshExec('/usr/local/freeswitch/bin/fs_cli -x "sofia profile wan rescan"').catch(() => {});
  }

  if (scope === 'extensions' || scope === 'all') {
    await sshExec('/usr/local/freeswitch/bin/fs_cli -x "reloadxml"').catch(() => {});
  }
}

// ============================================================================
// IVR ACTION CONVERSION  (frontend <-> FreeSWITCH)
// ============================================================================

function actionToFs(type: string, param: string, domain: string): { action: string; param: string } {
  const ctx = `XML ${domain}`;
  // Accept both 'extension' and 'Extension' (frontend uses lowercase, old code used capitalized)
  switch (type.toLowerCase()) {
    case 'extension':
      return { action: 'menu-exec-app', param: `transfer ${param} ${ctx}` };
    case 'queue': {
      const queueName = param.includes('@') ? param : `${param}@${domain}`;
      return { action: 'menu-exec-app', param: `callcenter ${queueName}` };
    }
    case 'ivr':
      return { action: 'menu-sub', param };
    case 'voicemail':
      return { action: 'menu-exec-app', param: `transfer *99${param} ${ctx}` };
    case 'hangup':
    case 'none':
      return { action: 'menu-exec-app', param: 'hangup' };
    case 'playsound':
    case 'playback':
    case 'announcement':
      return { action: 'menu-play-sound', param };
    case 'repeat':
      return { action: 'menu-exec-app', param: 'repeat' };
    case 'external':
      return { action: 'menu-exec-app', param: `transfer ${param} ${ctx}` };
    case 'directory':
      return { action: 'menu-exec-app', param: 'transfer 411 XML default' };
    default:
      return { action: 'menu-exec-app', param: param || 'hangup' };
  }
}

function actionFromFs(fsAction: string, fsParam: string): { type: string; param: string } {
  if (!fsAction || !fsParam) return { type: 'none', param: '' };
  if (fsAction === 'menu-sub') return { type: 'ivr', param: fsParam };
  if (fsAction === 'menu-play-sound') return { type: 'playback', param: fsParam };

  const p = (fsParam || '').trim();
  if (p === 'hangup' || p === 'hangup NORMAL_CLEARING' || p === 'repeat') {
    return { type: p === 'repeat' ? 'repeat' : 'hangup', param: '' };
  }

  const transferMatch = p.match(/^transfer\s+(\S+)(?:\s+XML\s+\S+)?$/);
  if (transferMatch) {
    const dest = transferMatch[1];
    if (dest.startsWith('*99')) return { type: 'voicemail', param: dest.replace(/^\*99/, '') };
    return { type: 'extension', param: dest };
  }

  const ccMatch = p.match(/^callcenter\s+(\S+)/);
  if (ccMatch) return { type: 'queue', param: ccMatch[1] };

  return { type: 'extension', param: p };
}

function greetingToFilename(path: string): string {
  if (!path) return '';
  return path.split('/').pop() || path;
}

async function resolveGreetingPath(greetingValue: string): Promise<string> {
  if (!greetingValue) return '';
  if (greetingValue.startsWith('/') || greetingValue.startsWith('$') || greetingValue.includes('://')) return greetingValue;
  const rec = await queryPbxDbOne(
    `SELECT filename FROM recordings WHERE filename = $1 OR name = $1 LIMIT 1`,
    [greetingValue],
  );
  if (rec) {
    const domain = await getDefaultDomain();
    return `/var/lib/freeswitch/recordings/${domain.name}/${rec.filename}`;
  }
  return greetingValue;
}

function audioMime(filename: string): string {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg') return 'audio/ogg';
  return 'audio/wav';
}

function secondsToClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchRecordingBuffer(filePath: string): Promise<Buffer> {
  const sshCmd = `sshpass -p '${PBX_SSH_PASSWORD}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${PBX_SSH_USER}@${PBX_HOST} "echo '${PBX_SSH_PASSWORD}' | sudo -S cat '${filePath.replace(/'/g, "\\'")}' 2>/dev/null | base64"`;
  const { stdout } = await execAsync(sshCmd, { maxBuffer: 50 * 1024 * 1024, timeout: 30000 });
  const cleaned = stdout.replace(/\[sudo\] password for \S+:\s*/g, '').trim();
  return Buffer.from(cleaned, 'base64');
}

// ============================================================================
// AUTH ROUTE
// ============================================================================

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
      const token = generateToken(username);
      res.json({ success: true, token, user: { username: ADMIN_USER } });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SYSTEM
// ============================================================================

router.get('/system/status', requireAdmin, async (_req: Request, res: Response) => {
  try {
    let version = 'FreeSWITCH';
    let statusOutput = '';
    let channelCountOutput = '';
    let registrations = '';
    let connected = false;

    try { version = await fsCli('version'); connected = true; } catch {}
    try { statusOutput = await fsCli('status'); } catch {}
    try { channelCountOutput = await fsCli('show channels count'); } catch {}
    try { registrations = await fsCli('sofia status profile internal reg'); } catch {}

    let activeCalls = 0;
    const channelMatch = channelCountOutput.match(/(\d+)\s+total/);
    if (channelMatch) activeCalls = parseInt(channelMatch[1]) || 0;

    let uptime = connected ? 'Connected' : 'Offline';
    const uptimeMatch = statusOutput.match(/UP\s+(.+?)(?:,\s*\d+\s*m(?:illi|icro)second|$)/i);
    if (uptimeMatch) {
      const raw = uptimeMatch[1];
      const parts: string[] = [];
      const y = raw.match(/(\d+)\s+year/)?.[1];
      const d = raw.match(/(\d+)\s+day/)?.[1];
      const h = raw.match(/(\d+)\s+hour/)?.[1];
      const m = raw.match(/(\d+)\s+minute/)?.[1];
      const s = raw.match(/(\d+)\s+second/)?.[1];
      if (y && y !== '0') parts.push(`${y}y`);
      if (d && d !== '0') parts.push(`${d}d`);
      if (h) parts.push(`${h}h`);
      if (m) parts.push(`${m}m`);
      if (s) parts.push(`${s}s`);
      uptime = parts.join(' ') || 'Just started';
    }

    const regCount = registrations.split('\n').filter((l: string) =>
      l.includes('Registered') && !l.includes('Total'),
    ).length;

    let peakSessions = 0;
    const peakMatch = statusOutput.match(/(\d+)\s+session\(s\)\s*-\s*peak\s+(\d+)/);
    if (peakMatch) peakSessions = parseInt(peakMatch[2]) || 0;

    let maxSessions = 0;
    const maxMatch = statusOutput.match(/(\d+)\s+session\(s\)\s+max/);
    if (maxMatch) maxSessions = parseInt(maxMatch[1]) || 0;

    res.json({
      success: connected || version !== 'FreeSWITCH',
      status: {
        host: PBX_HOST,
        version: version.split('\n')[0] || 'FreeSWITCH',
        uptime,
        activeCalls,
        peakSessions,
        maxSessions,
        registeredEndpoints: regCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/system/reload', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await syncXmlToFs('all');
    res.json({ success: true, message: 'Configuration reloaded' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// One-time (idempotent) cutover: write ALL XML from DB and stop Lua from
// handling the directory section. After this FreeSWITCH is driven solely
// by pbx_admin DB + generated XML files.
router.post('/system/cutover', requireAdmin, async (_req: Request, res: Response) => {
  try {
    // 1. Write everything from DB
    await syncXmlToFs('all');

    // 2. Strip `directory` from Lua xml-handler-bindings if still there
    const luaPath = '/etc/freeswitch/autoload_configs/lua.conf.xml';
    const currentLua = await readFsFile(luaPath);
    const updatedLua = currentLua.replace(
      /xml-handler-bindings"\s*value="([^"]*)"/,
      (_m, bindings) => {
        const parts = bindings
          .split(/[,|]/)
          .map((s: string) => s.trim())
          .filter((s: string) => s && s !== 'directory');
        return `xml-handler-bindings" value="${parts.join(',')}"`;
      },
    );
    if (updatedLua !== currentLua) {
      await writeFsFile(luaPath, updatedLua);
    }

    // 3. Reload so SIP profiles refresh against static directory
    await fsCli('reloadxml');
    await fsCli('reload mod_sofia').catch(() => {});

    res.json({
      success: true,
      message:
        'Cutover complete. FreeSWITCH is now driven by pbx_admin DB + static XML (FusionPBX Lua bypassed for directory).',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/system/restart', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await fsCli('fsctl restart graceful');
    res.json({ success: true, message: 'FreeSWITCH restart initiated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/system/modules', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const output = await fsCli('module_exists mod_callcenter');
    const coreModules = [
      'mod_sofia', 'mod_callcenter', 'mod_conference', 'mod_voicemail',
      'mod_dptools', 'mod_dialplan_xml', 'mod_commands', 'mod_event_socket',
      'mod_local_stream', 'mod_native_file', 'mod_sndfile', 'mod_tone_stream',
    ];
    const modules = coreModules.map(name => ({ name, enabled: true }));
    res.json({ success: true, modules });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/system/logs', requireAdmin, async (req: Request, res: Response) => {
  try {
    const lines = parseInt(req.query.lines as string) || 100;
    const logOutput = await fsCli(`log ${lines}`).catch(() => '');
    res.json({ success: true, logs: logOutput.split('\n').filter((l: string) => l.trim()) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// EXTENSIONS
// ============================================================================

function mapExtRow(r: any, regInfo?: { registered: boolean; contact?: string }) {
  const isRegistered = regInfo?.registered || false;
  return {
    id: r.id,
    extension: r.extension,
    password: r.password || '',
    name: r.caller_id_name || `Extension ${r.extension}`,
    callerIdName: r.caller_id_name || r.extension,
    callerIdNumber: r.caller_id_number || r.extension,
    email: r.email || '',
    description: r.description || '',
    enabled: r.enabled ?? true,
    voicemailEnabled: r.voicemail_enabled ?? false,
    voicemailPassword: r.voicemail_password || '1234',
    ringDuration: r.call_timeout ?? 30,
    dnd: r.dnd ?? false,
    callForwardEnabled: r.call_forward_enabled ?? false,
    callForwardDest: r.call_forward_dest || '',
    callRecording: r.call_recording || 'all',
    transport: r.transport || 'udp',
    codecs: r.codecs || ['PCMU', 'PCMA'],
    maxContacts: r.max_contacts ?? 1,
    dtmfMode: r.dtmf_mode || 'rfc2833',
    natEnabled: r.nat_enabled ?? false,
    context: 'default',
    status: isRegistered ? 'registered' : 'unavailable',
    registered: isRegistered,
    contact: regInfo?.contact || '',
  };
}

router.get('/extensions', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(
      `SELECT * FROM extensions WHERE domain_id = $1 ORDER BY extension`,
      [domainId],
    );
    let regMap = new Map<string, { registered: boolean; contact?: string }>();
    try { regMap = await eslConnection.getAllRegisteredContacts(); } catch {}
    res.json({ success: true, extensions: rows.map((r: any) => mapExtRow(r, regMap.get(r.extension))) });
  } catch (error: any) {
    console.error('GET /extensions error:', error.message);
    res.json({ success: false, extensions: [], error: error.message });
  }
});

router.get('/extensions/:ext', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const row = await queryPbxDbOne(
      `SELECT * FROM extensions WHERE domain_id = $1 AND extension = $2`,
      [domainId, req.params.ext],
    );
    if (!row) return res.status(404).json({ success: false, error: 'Extension not found' });
    let regInfo: { registered: boolean; contact?: string } = { registered: false };
    try {
      const regMap = await eslConnection.getAllRegisteredContacts();
      regInfo = regMap.get(row.extension) || { registered: false };
    } catch {}
    res.json({ success: true, extension: mapExtRow(row, regInfo) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/extensions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    await queryPbxDb(
      `INSERT INTO extensions
         (id, domain_id, extension, password, caller_id_name, caller_id_number,
          enabled, description, voicemail_enabled, voicemail_password, call_timeout,
          email, dnd, call_forward_enabled, call_forward_dest, call_recording,
          transport, codecs, max_contacts, dtmf_mode, nat_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        randomUUID(), domainId, b.extension || b.number,
        b.password,
        b.callerIdName || b.name || `Extension ${b.extension || b.number}`,
        b.callerIdNumber || b.extension || b.number,
        b.description || '',
        b.voicemailEnabled ?? false, b.voicemailPassword || '1234',
        b.ringDuration ?? b.callTimeout ?? 30,
        b.email || null,
        b.dnd ?? false,
        b.callForwardEnabled ?? false, b.callForwardDest || null,
        b.callRecording || 'all',
        b.transport || 'udp',
        b.codecs || ['PCMU', 'PCMA'],
        b.maxContacts ?? 1,
        b.dtmfMode || 'rfc2833',
        b.natEnabled ?? false,
      ],
    );
    await syncXmlToFs('extensions');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/extensions/:ext', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const push = (col: string, val: any) => { sets.push(`${col} = $${idx++}`); params.push(val); };

    if (b.password !== undefined)                             push('password', b.password);
    if (b.callerIdName !== undefined || b.name !== undefined) push('caller_id_name', b.callerIdName ?? b.name);
    if (b.callerIdNumber !== undefined)                       push('caller_id_number', b.callerIdNumber);
    if (b.enabled !== undefined)                              push('enabled', b.enabled);
    if (b.description !== undefined)                          push('description', b.description);
    if (b.voicemailEnabled !== undefined)                     push('voicemail_enabled', b.voicemailEnabled);
    if (b.voicemailPassword !== undefined)                    push('voicemail_password', b.voicemailPassword);
    if (b.ringDuration !== undefined || b.callTimeout !== undefined) push('call_timeout', b.ringDuration ?? b.callTimeout);
    if (b.email !== undefined)                                push('email', b.email || null);
    if (b.dnd !== undefined)                                  push('dnd', b.dnd);
    if (b.callForwardEnabled !== undefined)                   push('call_forward_enabled', b.callForwardEnabled);
    if (b.callForwardDest !== undefined)                      push('call_forward_dest', b.callForwardDest || null);
    if (b.callRecording !== undefined)                        push('call_recording', b.callRecording);
    if (b.transport !== undefined)                            push('transport', b.transport);
    if (b.codecs !== undefined)                               push('codecs', b.codecs);
    if (b.maxContacts !== undefined)                          push('max_contacts', b.maxContacts);
    if (b.dtmfMode !== undefined)                             push('dtmf_mode', b.dtmfMode);
    if (b.natEnabled !== undefined)                           push('nat_enabled', b.natEnabled);

    if (sets.length > 0) {
      params.push(domainId, req.params.ext);
      await queryPbxDb(
        `UPDATE extensions SET ${sets.join(', ')}, updated_at = now() WHERE domain_id = $${idx} AND extension = $${idx + 1}`,
        params,
      );
    }
    await syncXmlToFs('extensions');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/extensions/:ext', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(`DELETE FROM extensions WHERE domain_id = $1 AND extension = $2`, [domainId, req.params.ext]);
    await syncXmlToFs('extensions');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/extensions/bulk-import', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    let imported = 0;
    const failed: any[] = [];
    for (const ext of req.body.extensions || []) {
      try {
        await queryPbxDb(
          `INSERT INTO extensions (id, domain_id, extension, password, caller_id_name, caller_id_number, enabled, call_timeout)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
          [randomUUID(), domainId, ext.extension || ext.number, ext.password || '1234',
           ext.callerIdName || ext.name || ext.extension, ext.callerIdNumber || ext.extension,
           ext.callTimeout || 30],
        );
        imported++;
      } catch (err: any) {
        failed.push({ extension: ext.extension || ext.number, error: err.message });
      }
    }
    await syncXmlToFs('extensions');
    res.json({ success: true, imported, failed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// TRUNKS / GATEWAYS
// ============================================================================

router.get('/trunks', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(`SELECT * FROM gateways WHERE domain_id = $1 ORDER BY name`, [domainId]);

    // Pull full gateway roster from FreeSWITCH once so we can match by
    // proxy/realm when the gateway is loaded under a legacy name (e.g. UUID)
    let fsGateways: Array<{ name: string; proxy: string; realm: string; state: string; status: string; callsIn: number; callsOut: number }> = [];
    try {
      const raw = await fsCli('sofia xmlstatus gateway');
      const gwBlocks = raw.match(/<gateway>[\s\S]*?<\/gateway>/g) || [];
      fsGateways = gwBlocks.map((block) => {
        const pick = (tag: string): string => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] || '').trim();
        const proxyRaw = pick('proxy').replace(/^sip:/i, '').replace(/;.*$/, '');
        return {
          name: pick('name'),
          proxy: proxyRaw,
          realm: pick('realm'),
          state: pick('state'),
          status: pick('status'),
          callsIn: parseInt(pick('calls-in') || '0'),
          callsOut: parseInt(pick('calls-out') || '0'),
        };
      });
    } catch {}

    const trunks = [];
    for (const r of rows) {
      let fsState = r.enabled ? 'NOT LOADED' : 'DISABLED';
      let callsIn = 0;
      let callsOut = 0;

      // Match by name first, then by proxy/realm (handles UUID-named legacy gateways)
      const proxyHost = (r.proxy || '').replace(/:\d+$/, '');
      const match = fsGateways.find((g) => g.name === r.name)
        || fsGateways.find((g) => g.proxy === proxyHost || g.realm === (r.realm || proxyHost));

      if (match) {
        const state = match.state.toUpperCase();
        const status = match.status.toUpperCase();
        fsState = status === 'UP' ? (state === 'REGED' ? 'REGED' : `UP (${state})`) : state;
        callsIn = match.callsIn;
        callsOut = match.callsOut;
      }

      trunks.push({
        id: r.id,
        name: r.name,
        proxy: r.proxy,
        port: r.port || 5060,
        username: r.username || '',
        password: r.password || '',
        register: r.register ?? false,
        callerIdName: r.caller_id_in_from ? r.from_user : '',
        callerIdNumber: r.from_user || '',
        context: r.context || 'public',
        enabled: r.enabled ?? true,
        profile: r.profile || 'external',
        description: r.description || '',
        fsState,
        callsIn,
        callsOut,
      });
    }

    res.json({ success: true, trunks });
  } catch (error: any) {
    console.error('GET /trunks error:', error.message);
    res.json({ success: false, trunks: [], error: error.message });
  }
});

router.post('/trunks', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    let proxy = b.proxy || '';
    if (b.port && b.port !== 5060 && !proxy.includes(':')) proxy = `${proxy}:${b.port}`;
    await queryPbxDb(
      `INSERT INTO gateways (id, domain_id, name, proxy, port, username, password, realm, from_user, from_domain, register, register_transport, expire_seconds, retry_seconds, caller_id_in_from, ping, context, profile, enabled, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        randomUUID(), domainId, b.name, proxy, b.port || 5060,
        b.username || '', b.password || '', b.realm || '', b.fromUser || '',
        b.fromDomain || '', b.register ?? false, b.registerTransport || 'udp',
        b.expireSeconds || 3600, b.retrySeconds || 30,
        b.callerIdInFrom ?? false, b.ping || '', b.context || 'public',
        b.profile || 'external', b.enabled ?? true, b.description || '',
      ],
    );
    await syncXmlToFs('gateways');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/trunks/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const prior = await queryPbxDbOne(`SELECT profile FROM gateways WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    const oldProfile = prior?.profile || 'external';

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (b.proxy !== undefined) { let p = b.proxy; if (b.port && b.port !== 5060 && !p.includes(':')) p = `${p}:${b.port}`; sets.push(`proxy = $${idx++}`); params.push(p); }
    if (b.port !== undefined) { sets.push(`port = $${idx++}`); params.push(b.port); }
    if (b.username !== undefined) { sets.push(`username = $${idx++}`); params.push(b.username); }
    if (b.password !== undefined && b.password !== '') { sets.push(`password = $${idx++}`); params.push(b.password); }
    if (b.register !== undefined) { sets.push(`register = $${idx++}`); params.push(b.register); }
    if (b.enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(b.enabled); }
    if (b.profile !== undefined) { sets.push(`profile = $${idx++}`); params.push(b.profile); }
    if (b.callerIdInFrom !== undefined) { sets.push(`caller_id_in_from = $${idx++}`); params.push(b.callerIdInFrom); }
    if (b.context !== undefined) { sets.push(`context = $${idx++}`); params.push(b.context); }
    if (b.description !== undefined) { sets.push(`description = $${idx++}`); params.push(b.description); }
    if (b.fromUser !== undefined) { sets.push(`from_user = $${idx++}`); params.push(b.fromUser); }
    if (b.fromDomain !== undefined) { sets.push(`from_domain = $${idx++}`); params.push(b.fromDomain); }

    if (sets.length > 0) {
      params.push(domainId, req.params.name);
      await queryPbxDb(`UPDATE gateways SET ${sets.join(', ')} WHERE domain_id = $${idx} AND name = $${idx + 1}`, params);
    }

    try { await fsCli(`sofia profile ${oldProfile} killgw ${req.params.name}`); } catch {}
    await syncXmlToFs('gateways');

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/trunks/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const gw = await queryPbxDbOne(`SELECT profile FROM gateways WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    const profile = gw?.profile || 'external';
    await queryPbxDb(`DELETE FROM gateways WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    try { await fsCli(`sofia profile ${profile} killgw ${req.params.name}`); } catch {}
    await syncXmlToFs('gateways');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// QUEUES
// ============================================================================

async function buildQueuesResponse(): Promise<any[]> {
  const domainId = await getDefaultDomainId();
  const domain = await getDefaultDomain();
  const rows = await queryPbxDb(`SELECT * FROM queues WHERE domain_id = $1 ORDER BY name`, [domainId]);

  let fsStatus: any = { success: false, members: [], callers: [] };
  try { fsStatus = await eslConnection.queueStatus(); } catch {}

  const result = [];
  for (const q of rows) {
    const agents = await queryPbxDb(
      `SELECT qa.*, qt.tier_level, qt.tier_position FROM queue_agents qa
       LEFT JOIN queue_tiers qt ON qt.agent_id = qa.id AND qt.queue_id = $1
       WHERE qa.domain_id = $2 AND qt.queue_id = $1
       ORDER BY qa.extension`,
      [q.id, domainId],
    );

    const membersDetail = agents.map((a: any) => {
      const ext = a.extension;
      const fsAgent = (fsStatus.members || []).find((m: any) => {
        const mExt = (m.interface || '').match(/user\/(\d+)@/)?.[1] || '';
        return mExt === ext || m.name === `Agent-${ext}`;
      });
      return {
        extension: ext,
        name: a.agent_name || `Agent ${ext}`,
        status: fsAgent?.statusLabel || a.status || 'Unknown',
        callsTaken: fsAgent?.callsTaken || 0,
      };
    });

    const fsQueueName = `${q.name}@${domain.name}`;
    const waiting = (fsStatus.callers || []).filter((c: any) => c.queue === q.name || c.queue === fsQueueName).length;

    const mohRaw = q.moh_sound || 'local_stream://moh';
    const mohClass = mohRaw.replace(/^local_stream:\/\//, '');
    result.push({
      id: q.id,
      name: q.name,
      extension: q.extension || '',
      strategy: q.strategy || 'longest-idle-agent',
      mohSound: mohRaw,
      announceSound: q.announce_sound || '',
      announceFrequency: q.announce_frequency || 0,
      maxWaitTime: q.max_wait_time || 0,
      waiting,
      agents: membersDetail.length,
      memberCount: membersDetail.length,
      description: q.description || '',
      membersDetail,
      // QueuesPage-compatible shape
      params: {
        strategy: q.strategy || 'longest-idle-agent',
        musicclass: mohClass,
        timeout: String(q.max_wait_time || 0),
        retry: '5',
        wrapuptime: '0',
        maxlen: '0',
        joinempty: 'yes',
        leavewhenempty: 'no',
        'announce-frequency': String(q.announce_frequency || 30),
        'announce-holdtime': 'once',
        'announce-position': 'yes',
        'announce-position-limit': '5',
        'announce-round-seconds': '10',
        'periodic-announce': q.announce_sound || '',
        'periodic-announce-frequency': '45',
        'announce-to-first-user': 'yes',
        'relative-periodic-announce': 'yes',
        'min-announce-frequency': '15',
      },
      members: membersDetail.map((m: any) => `PJSIP/${m.extension}`),
      calls: waiting,
    });
  }
  return result;
}

// Sync queue config changes to the FusionPBX database (the actual FS config source via Lua XML handler)
// and clear its file cache so the next queue load picks up the new values.
async function syncQueueToFusionPbx(queueExtension: string, params: {
  moh_sound?: string;
  announce_sound?: string;
  announce_frequency?: number;
  announce_position?: string;
  strategy?: string;
}): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (params.moh_sound !== undefined) { sets.push(`queue_moh_sound = $${i++}`); vals.push(params.moh_sound); }
  if (params.announce_sound !== undefined) { sets.push(`queue_announce_sound = $${i++}`); vals.push(params.announce_sound); }
  if (params.announce_frequency !== undefined) { sets.push(`queue_announce_frequency = $${i++}`); vals.push(params.announce_frequency); }
  if (params.announce_position !== undefined) { sets.push(`queue_announce_position = $${i++}`); vals.push(params.announce_position); }
  if (params.strategy !== undefined) { sets.push(`queue_strategy = $${i++}`); vals.push(params.strategy); }
  if (sets.length > 0) {
    vals.push(queueExtension);
    await queryFusionPbx(`UPDATE v_call_center_queues SET ${sets.join(', ')} WHERE queue_extension = $${i}`, vals);
  }
  // Clear FusionPBX file cache so FS re-reads on next queue reload
  try { await sshExec(`rm -f /var/cache/fusionpbx/$(hostname).configuration.callcenter.conf 2>/dev/null || true`); } catch {}
  // Reload the specific queue in the running callcenter module
  try {
    const domain = await getDefaultDomain();
    const qFsName = `${queueExtension}@${domain.name}`;
    await sshExec(`/usr/local/freeswitch/bin/fs_cli -x "callcenter_config queue unload ${qFsName}" 2>/dev/null || true`);
    await sshExec(`/usr/local/freeswitch/bin/fs_cli -x "callcenter_config queue load ${qFsName}" 2>/dev/null || true`);
  } catch {}
}

router.get('/queues', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const queues = await buildQueuesResponse();
    res.json({ success: true, queues });
  } catch (error: any) {
    console.error('GET /queues error:', error.message);
    res.json({ success: false, queues: [], error: error.message });
  }
});

router.post('/queues', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const b = req.body;
    const queueId = randomUUID();

    const rawMohPost = b.mohSound ?? b.moh_sound ?? (b.musicclass !== undefined ? b.musicclass : 'queue_greeting');
    const mohPost = rawMohPost.includes('://') ? rawMohPost : `local_stream://${rawMohPost}`;
    const announceSoundPost = b.announceSound ?? b.periodic_announce ?? '';
    const announceFreqPost = Number(b.announceFrequency ?? b.announce_frequency ?? 0) || 0;

    await queryPbxDb(
      `INSERT INTO queues (id, domain_id, name, extension, strategy, moh_sound, announce_sound, announce_frequency, record_template, time_base_score, max_wait_time, max_wait_time_no_agent, max_wait_time_no_agent_reached, tier_rules_apply, tier_rule_wait_second, tier_rule_wait_multiply, tier_rule_no_agent_no_wait, discard_abandoned_after, abandoned_resume_allowed, enabled, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,15,false,false,60,false,true,$14)`,
      [
        queueId, domainId, b.name, b.extension || '',
        b.strategy || 'longest-idle-agent',
        mohPost, announceSoundPost, announceFreqPost,
        b.recordTemplate || '', b.timeBaseScore || 'system',
        b.maxWaitTime || 0, b.maxWaitTimeWithNoAgent || 120, b.maxWaitTimeNoAgentReached || 5,
        b.description || b.name,
      ],
    );

    for (const member of b.members || []) {
      const ext = typeof member === 'string' ? member.replace(/^(PJSIP|SIP)\//i, '') : member.extension;
      const agentId = randomUUID();
      await queryPbxDb(
        `INSERT INTO queue_agents (id, domain_id, queue_id, extension, agent_name, agent_type, call_timeout, status, max_no_answer, wrap_up_time, reject_delay_time, busy_delay_time, no_answer_delay_time)
         VALUES ($1,$2,$3,$4,$5,'callback',20,'Available',3,5,10,60,0)`,
        [agentId, domainId, queueId, ext, `${ext}@${domain.name}`],
      );
      await queryPbxDb(
        `INSERT INTO queue_tiers (id, queue_id, agent_id, tier_level, tier_position) VALUES ($1,$2,$3,1,1)`,
        [randomUUID(), queueId, agentId],
      );
    }

    try {
      await syncQueueToFusionPbx(b.name, {
        moh_sound: mohPost,
        announce_sound: announceSoundPost || '',
        announce_frequency: announceFreqPost,
        announce_position: announceFreqPost > 0 ? 'yes' : 'no',
        strategy: b.strategy || 'longest-idle-agent',
      });
    } catch (syncErr: any) {
      console.warn('syncQueueToFusionPbx failed (non-fatal):', syncErr.message);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/queues/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const b = req.body;

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.strategy !== undefined) { sets.push(`strategy = $${idx++}`); params.push(b.strategy); }

    // Accept mohSound (camelCase), musicclass (from QueuesPage formData), or moh_sound (snake_case)
    const rawMoh = b.mohSound ?? b.moh_sound ?? (b.musicclass !== undefined ? b.musicclass : undefined);
    if (rawMoh !== undefined) {
      // Normalize: bare stream names become local_stream://name; full URIs pass through
      const normalized = rawMoh.includes('://') ? rawMoh : `local_stream://${rawMoh}`;
      sets.push(`moh_sound = $${idx++}`); params.push(normalized);
    }

    // Accept camelCase (announceSound/announceFrequency) OR snake_case (periodic_announce/announce_frequency)
    // from QueuesPage formData
    const announceSound = b.announceSound ?? b.periodic_announce ?? undefined;
    if (announceSound !== undefined) { sets.push(`announce_sound = $${idx++}`); params.push(announceSound); }
    const announceFreq = b.announceFrequency ?? b.announce_frequency ?? undefined;
    if (announceFreq !== undefined) { sets.push(`announce_frequency = $${idx++}`); params.push(Number(announceFreq) || 0); }

    if (b.maxWaitTime !== undefined) { sets.push(`max_wait_time = $${idx++}`); params.push(b.maxWaitTime); }
    else if (b.timeout !== undefined) { sets.push(`max_wait_time = $${idx++}`); params.push(Number(b.timeout) || 0); }
    if (b.description !== undefined) { sets.push(`description = $${idx++}`); params.push(b.description); }
    if (b.extension !== undefined) { sets.push(`extension = $${idx++}`); params.push(b.extension); }

    if (sets.length > 0) {
      params.push(domainId, req.params.name);
      await queryPbxDb(`UPDATE queues SET ${sets.join(', ')} WHERE domain_id = $${idx} AND name = $${idx + 1}`, params);
    }

    if (b.members !== undefined) {
      const queue = await queryPbxDbOne(`SELECT id FROM queues WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
      if (queue) {
        await queryPbxDb(`DELETE FROM queue_tiers WHERE queue_id = $1`, [queue.id]);
        await queryPbxDb(`DELETE FROM queue_agents WHERE queue_id = $1`, [queue.id]);

        for (const member of b.members || []) {
          const ext = typeof member === 'string' ? member.replace(/^(PJSIP|SIP)\//i, '') : member.extension;
          const agentId = randomUUID();
          await queryPbxDb(
            `INSERT INTO queue_agents (id, domain_id, queue_id, extension, agent_name, agent_type, call_timeout, status, max_no_answer, wrap_up_time, reject_delay_time, busy_delay_time, no_answer_delay_time)
             VALUES ($1,$2,$3,$4,$5,'callback',20,'Available',3,5,10,60,0)`,
            [agentId, domainId, queue.id, ext, `${ext}@${domain.name}`],
          );
          await queryPbxDb(
            `INSERT INTO queue_tiers (id, queue_id, agent_id, tier_level, tier_position) VALUES ($1,$2,$3,1,1)`,
            [randomUUID(), queue.id, agentId],
          );
        }
      }
    }

    // Sync to FusionPBX DB (the actual FS config source via Lua XML handler)
    const savedQ = await queryPbxDbOne(`SELECT * FROM queues WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    if (savedQ) {
      const mohFinal = savedQ.moh_sound?.includes('://') ? savedQ.moh_sound : `local_stream://${savedQ.moh_sound}`;
      try {
        await syncQueueToFusionPbx(req.params.name, {
          moh_sound: mohFinal,
          announce_sound: savedQ.announce_sound || '',
          announce_frequency: savedQ.announce_frequency || 0,
          announce_position: (savedQ.announce_frequency || 0) > 0 ? 'yes' : 'no',
          strategy: savedQ.strategy || 'round-robin',
        });
      } catch (syncErr: any) {
        console.warn('syncQueueToFusionPbx failed (non-fatal):', syncErr.message);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/queues/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const queue = await queryPbxDbOne(`SELECT id FROM queues WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    if (queue) {
      await queryPbxDb(`DELETE FROM queue_tiers WHERE queue_id = $1`, [queue.id]);
      await queryPbxDb(`DELETE FROM queue_agents WHERE queue_id = $1`, [queue.id]);
      await queryPbxDb(`DELETE FROM queues WHERE id = $1`, [queue.id]);
    }
    await syncXmlToFs();
    try { await fsCli('callcenter_config reload'); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// QUEUE MONITOR
// ============================================================================

router.get('/queue-monitor', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const dbQueues = await queryPbxDb(`SELECT * FROM queues WHERE domain_id = $1 ORDER BY name`, [domainId]);

    let sipRegistrations = new Map<string, { registered: boolean; contact?: string }>();
    try { sipRegistrations = await eslConnection.getAllRegisteredContacts(); } catch {}

    const result = [];
    for (const q of dbQueues) {
      const fsQueueName = `${q.name}@${domain.name}`;
      let members: any[] = [];
      let callers: any[] = [];

      const dbAgents = await queryPbxDb(
        `SELECT qa.extension FROM queue_agents qa
         JOIN queue_tiers qt ON qt.agent_id = qa.id
         WHERE qt.queue_id = $1`,
        [q.id],
      );
      const queueExtensions = new Set(dbAgents.map((a: any) => a.extension));

      try {
        const agentOutput = await eslConnection.sendCommand('callcenter_config agent list');
        if (agentOutput.success && agentOutput.output) {
          // columns: name|instance_id|uuid|type|contact|status|state|max_no_answer|wrap_up_time|
          //          reject_delay_time|busy_delay_time|no_answer_delay_time|last_bridge_start|
          //          last_bridge_end|last_offered_call|last_status_change|no_answer_count|
          //          calls_answered|talk_time|ready_time|external_calls_count
          const lines = agentOutput.output.split('\n').filter((l: string) => l.includes('|'));
          const seenExtensions = new Set<string>();
          for (const line of lines) {
            const parts = line.split('|').map((s: string) => s.trim());
            if (parts.length < 17) continue;
            const agentName = parts[0];
            const contact = parts[4] || '';
            const ccStatus = parts[5] || '';   // Available | On Break | Logged Out
            const ccState = parts[6] || '';    // Waiting | Receiving | In a queue call
            const lastBridgeEnd = parseInt(parts[13] || '0', 10);
            const callsAnswered = parseInt(parts[17] || '0', 10) || 0;
            const talkTime = parseInt(parts[18] || '0', 10) || 0;

            const extMatch = agentName.match(/^(\d+)@/);
            const contactExtMatch = contact.match(/user\/(\d+)@/);
            const extension = extMatch ? extMatch[1] : contactExtMatch ? contactExtMatch[1] : agentName;

            if (!/^\d+$/.test(extension)) continue;
            if (seenExtensions.has(extension)) continue;
            if (!queueExtensions.has(extension)) continue;
            seenExtensions.add(extension);

            const sipReg = sipRegistrations.get(extension);
            const isRegistered = sipReg?.registered ?? false;

            let displayStatus: string;
            if (!isRegistered) {
              displayStatus = 'Offline';
            } else if (ccState.toLowerCase() === 'in a queue call' || ccState.toLowerCase() === 'receiving') {
              displayStatus = 'On Call';
            } else if (ccStatus === 'On Break') {
              displayStatus = 'On Break';
            } else {
              displayStatus = 'Available';
            }

            const lastCall = lastBridgeEnd > 0
              ? new Date(lastBridgeEnd * 1000).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
              : undefined;

            members.push({
              extension,
              name: `Agent ${extension}`,
              status: displayStatus,
              state: ccState,
              ccStatus,
              callsTaken: callsAnswered,
              talkTime,
              lastCall,
              interface: contact,
            });
          }
        }

        const queueOutput = await eslConnection.sendCommand(`callcenter_config queue list members ${fsQueueName}`);
        if (queueOutput.success && queueOutput.output) {
          const lines = queueOutput.output
            .split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.includes('|') && !l.startsWith('+OK') && !l.startsWith('queue|'));
          let position = 1;
          for (const line of lines) {
            const parts = line.split('|').map((s: string) => s.trim());
            // callcenter_config queue list members columns:
            // queue|instance_id|uuid|session_uuid|cid_number|cid_name|system_epoch|joined_epoch|...|state|score
            if (parts.length < 16) continue;
            const memberState = (parts[15] || '').toLowerCase();
            if (memberState === 'answered' || memberState === 'abandoned') continue;
            const joinedEpoch = parseInt(parts[7] || '0', 10);
            const waitSeconds = joinedEpoch > 0 ? Math.floor(Date.now() / 1000) - joinedEpoch : 0;
            callers.push({
              position: position++,
              callerId: parts[4] || 'Unknown',
              callerIdName: parts[5] || '',
              channel: parts[3] || '',
              waitTime: secondsToClock(waitSeconds),
            });
          }
        }
      } catch {}

      result.push({ name: q.name, waiting: callers.length, agents: members, calls: callers });
    }

    res.json({ success: true, queues: result });
  } catch (error: any) {
    console.error('Queue monitor error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set agent status (Available / On Break)
router.post('/queue-monitor/agent/:extension/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { extension } = req.params;
    const { status } = req.body as { status: string };
    if (!['Available', 'On Break'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be Available or On Break' });
    }
    const domain = await getDefaultDomain();

    // Try ESL first, fall back to SSH fs_cli
    const cmd = `callcenter_config agent set status ${extension}@${domain.name} ${status}`;
    let ok = false;
    try {
      const r = await eslConnection.sendCommand(cmd);
      ok = r.success;
    } catch {}
    if (!ok) {
      await sshExec(`/usr/local/freeswitch/bin/fs_cli -x "${cmd}" 2>/dev/null || true`);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// IVR
// ============================================================================

router.get('/ivr', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const menus = await queryPbxDb(`SELECT * FROM ivr_menus WHERE domain_id = $1 ORDER BY name`, [domainId]);

    const ivrs: any[] = [];
    for (const m of menus) {
      const optRows = await queryPbxDb(
        `SELECT * FROM ivr_options WHERE ivr_menu_id = $1 ORDER BY option_order`, [m.id],
      );

      let timeoutDestType = 'Hangup';
      let timeoutDest = '';
      let invalidDestType = 'Hangup';
      let invalidDest = '';
      const options: any[] = [];

      for (const o of optRows) {
        const digit = (o.digits || '').trim();
        const parsed = actionFromFs(o.action, o.param);
        if (digit === 'timeout') { timeoutDestType = parsed.type; timeoutDest = parsed.param; continue; }
        if (digit === 'invalid') { invalidDestType = parsed.type; invalidDest = parsed.param; continue; }
        options.push({ digit, action: parsed.type, param: parsed.param, description: o.description || '' });
      }

      // Build entries in the format IvrPage expects: {digit, destination:{type,target}, label}
      const entries = options.map((o: any) => ({
        digit: o.digit,
        label: o.description || '',
        destination: { type: o.action, target: o.param },
      }));

      ivrs.push({
        id: m.id,
        name: m.name,
        description: m.description || '',
        greeting: m.greet_long || '',
        greetingLong: greetingToFilename(m.greet_long),
        timeout: Math.round((m.timeout || 10000) / 1000),
        maxRetries: m.max_failures || 3,
        maxFailures: m.max_failures || 3,
        directDial: m.direct_dial ?? false,
        enabled: m.enabled ?? true,
        timeoutDestination: { type: timeoutDestType, target: timeoutDest },
        invalidDestination: { type: invalidDestType, target: invalidDest },
        entries,
      });
    }

    const queues = await queryPbxDb(`SELECT name FROM queues WHERE domain_id = $1`, [domainId]);
    const exts = await queryPbxDb(`SELECT extension, caller_id_name FROM extensions WHERE domain_id = $1 AND enabled = true`, [domainId]);

    const destinations = {
      queues: queues.map((q: any) => q.name.includes('@') ? q.name : `${q.name}@${domain.name}`),
      extensions: exts.map((e: any) => ({ extension: e.extension, name: e.caller_id_name || e.extension })),
      ivrs: ivrs.map((i: any) => i.name),
    };

    res.json({ success: true, ivrs, destinations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/ivr', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const b = req.body;
    const ivrId = randomUUID();

    const greetingPath = await resolveGreetingPath(b.greeting || b.greetingLong || '');
    // timeout from frontend is in seconds; DB stores milliseconds
    const timeoutMs = b.timeout ? (b.timeout > 100 ? b.timeout : b.timeout * 1000) : 10000;

    await queryPbxDb(
      `INSERT INTO ivr_menus (id, domain_id, name, extension, greet_long, greet_short, invalid_sound, exit_sound, timeout, inter_digit_timeout, max_failures, max_timeouts, digit_len, direct_dial, enabled, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15)`,
      [
        ivrId, domainId, b.name, b.name, greetingPath, greetingPath,
        b.invalidSound || 'ivr/ivr-that_was_an_invalid_entry.wav',
        b.exitSound || 'voicemail/vm-goodbye.wav',
        timeoutMs, b.digitTimeout || 2000,
        b.maxRetries || b.maxFailures || 3, b.maxTimeouts || b.maxRetries || 3, b.digitLen || 1,
        b.directDial ?? false, b.description || b.name,
      ],
    );

    // Accept both old format (entry.action/param) and new frontend format (entry.destination.type/target)
    for (const entry of b.entries || b.options || []) {
      const actionType = entry.action || entry.destination?.type;
      const actionParam = entry.param ?? entry.destination?.target ?? '';
      if (!actionType || actionType === 'None' || actionType === 'none') continue;
      const fsOpt = actionToFs(actionType, actionParam, domain.name);
      await queryPbxDb(
        `INSERT INTO ivr_options (id, ivr_menu_id, digits, action, param, option_order, description, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [randomUUID(), ivrId, entry.digit, fsOpt.action, fsOpt.param, parseInt(entry.digit) || 0, entry.label || entry.description || ''],
      );
    }

    // Accept both old format (timeoutDestType/timeoutDest) and new frontend format (timeoutDestination.type/target)
    const tType = b.timeoutDestType || b.timeoutDestination?.type || 'hangup';
    const tDest = b.timeoutDest ?? b.timeoutDestination?.target ?? '';
    if (tType && tType.toLowerCase() !== 'hangup') {
      const tFs = actionToFs(tType, tDest, domain.name);
      await queryPbxDb(
        `INSERT INTO ivr_options (id, ivr_menu_id, digits, action, param, option_order, description, enabled) VALUES ($1,$2,'timeout',$3,$4,999,'Timeout action',true)`,
        [randomUUID(), ivrId, tFs.action, tFs.param],
      );
    }
    const iType = b.invalidDestType || b.invalidDestination?.type || 'hangup';
    const iDest = b.invalidDest ?? b.invalidDestination?.target ?? '';
    if (iType && iType.toLowerCase() !== 'hangup' && iType.toLowerCase() !== 'repeat') {
      const iFs = actionToFs(iType, iDest, domain.name);
      await queryPbxDb(
        `INSERT INTO ivr_options (id, ivr_menu_id, digits, action, param, option_order, description, enabled) VALUES ($1,$2,'invalid',$3,$4,998,'Invalid input action',true)`,
        [randomUUID(), ivrId, iFs.action, iFs.param],
      );
    }

    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/ivr/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const b = req.body;
    const menu = await queryPbxDbOne(`SELECT id FROM ivr_menus WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    if (!menu) return res.status(404).json({ success: false, error: 'IVR not found' });

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (b.greeting !== undefined || b.greetingLong !== undefined) {
      const gp = await resolveGreetingPath(b.greeting || b.greetingLong || '');
      sets.push(`greet_long = $${idx++}, greet_short = $${idx++}`);
      params.push(gp, gp);
    }
    if (b.timeout !== undefined) {
      const tMs = b.timeout > 100 ? b.timeout : b.timeout * 1000;
      sets.push(`timeout = $${idx++}`); params.push(tMs);
    }
    const maxRetries = b.maxRetries ?? b.maxFailures;
    if (maxRetries !== undefined) { sets.push(`max_failures = $${idx++}`); params.push(maxRetries); }
    if (b.maxTimeouts !== undefined) { sets.push(`max_timeouts = $${idx++}`); params.push(b.maxTimeouts); }
    if (b.description !== undefined) { sets.push(`description = $${idx++}`); params.push(b.description); }
    if (b.directDial !== undefined) { sets.push(`direct_dial = $${idx++}`); params.push(b.directDial); }
    if (b.name !== undefined && b.name !== req.params.name) { sets.push(`name = $${idx++}, extension = $${idx++}`); params.push(b.name, b.name); }

    if (sets.length > 0) {
      params.push(menu.id);
      await queryPbxDb(`UPDATE ivr_menus SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    }

    if (b.entries !== undefined || b.options !== undefined) {
      await queryPbxDb(`DELETE FROM ivr_options WHERE ivr_menu_id = $1`, [menu.id]);
      for (const entry of b.entries || b.options || []) {
        const actionType = entry.action || entry.destination?.type;
        const actionParam = entry.param ?? entry.destination?.target ?? '';
        if (!actionType || actionType === 'None' || actionType === 'none') continue;
        const fsOpt = actionToFs(actionType, actionParam, domain.name);
        await queryPbxDb(
          `INSERT INTO ivr_options (id, ivr_menu_id, digits, action, param, option_order, description, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
          [randomUUID(), menu.id, entry.digit, fsOpt.action, fsOpt.param, parseInt(entry.digit) || 0, entry.label || entry.description || ''],
        );
      }
      const tType = b.timeoutDestType || b.timeoutDestination?.type || 'hangup';
      const tDest = b.timeoutDest ?? b.timeoutDestination?.target ?? '';
      if (tType && tType.toLowerCase() !== 'hangup') {
        const tFs = actionToFs(tType, tDest, domain.name);
        await queryPbxDb(
          `INSERT INTO ivr_options (id, ivr_menu_id, digits, action, param, option_order, description, enabled) VALUES ($1,$2,'timeout',$3,$4,999,'Timeout action',true)`,
          [randomUUID(), menu.id, tFs.action, tFs.param],
        );
      }
      const iType = b.invalidDestType || b.invalidDestination?.type || 'hangup';
      const iDest = b.invalidDest ?? b.invalidDestination?.target ?? '';
      if (iType && iType.toLowerCase() !== 'hangup' && iType.toLowerCase() !== 'repeat') {
        const iFs = actionToFs(iType, iDest, domain.name);
        await queryPbxDb(
          `INSERT INTO ivr_options (id, ivr_menu_id, digits, action, param, option_order, description, enabled) VALUES ($1,$2,'invalid',$3,$4,998,'Invalid input action',true)`,
          [randomUUID(), menu.id, iFs.action, iFs.param],
        );
      }
    }

    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/ivr/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const menu = await queryPbxDbOne(`SELECT id FROM ivr_menus WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    if (menu) {
      await queryPbxDb(`DELETE FROM ivr_options WHERE ivr_menu_id = $1`, [menu.id]);
      await queryPbxDb(`DELETE FROM ivr_menus WHERE id = $1`, [menu.id]);
    }
    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/ivr/:name/toggle', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const { enabled } = req.body;
    await queryPbxDb(`UPDATE ivr_menus SET enabled = $1 WHERE domain_id = $2 AND name = $3`, [enabled, domainId, req.params.name]);
    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// RING GROUPS
// ============================================================================

router.get('/ringgroups', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(`SELECT * FROM ring_groups WHERE domain_id = $1 ORDER BY name`, [domainId]);

    const ringGroups = [];
    for (const rg of rows) {
      const members = await queryPbxDb(
        `SELECT rgm.*, e.caller_id_name FROM ring_group_members rgm
         LEFT JOIN extensions e ON e.extension = rgm.extension AND e.domain_id = $2
         WHERE rgm.ring_group_id = $1`,
        [rg.id, domainId],
      );
      ringGroups.push({
        id: rg.id,
        name: rg.name,
        extension: rg.extension,
        strategy: rg.strategy || 'simultaneous',
        timeout: rg.timeout || 30,
        cidPrefix: rg.cid_prefix || '',
        description: rg.description || '',
        noAnswerDest: rg.no_answer_dest || '',
        noAnswerDestType: rg.no_answer_dest_type || '',
        members: members.map((m: any) => ({
          extension: m.extension,
          name: m.caller_id_name || m.extension,
          delay: m.delay_seconds || 0,
          timeout: m.timeout_seconds || 30,
        })),
      });
    }
    res.json({ success: true, ringGroups });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/ringgroups', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const rgId = randomUUID();
    await queryPbxDb(
      `INSERT INTO ring_groups (id, domain_id, name, extension, strategy, timeout, no_answer_dest, no_answer_dest_type, cid_prefix, enabled, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
      [rgId, domainId, b.name, b.extension, b.strategy || 'simultaneous', b.timeout || 30, b.noAnswerDest || '', b.noAnswerDestType || '', b.cidPrefix || '', b.description || ''],
    );
    for (const m of b.members || []) {
      await queryPbxDb(
        `INSERT INTO ring_group_members (id, ring_group_id, extension, delay_seconds, timeout_seconds) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), rgId, m.extension, m.delay || 0, m.timeout || 30],
      );
    }
    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/ringgroups/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const rg = await queryPbxDbOne(`SELECT id FROM ring_groups WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    if (!rg) return res.status(404).json({ success: false, error: 'Ring group not found' });

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (b.extension !== undefined) { sets.push(`extension = $${idx++}`); params.push(b.extension); }
    if (b.strategy !== undefined) { sets.push(`strategy = $${idx++}`); params.push(b.strategy); }
    if (b.timeout !== undefined) { sets.push(`timeout = $${idx++}`); params.push(b.timeout); }
    if (b.description !== undefined) { sets.push(`description = $${idx++}`); params.push(b.description); }
    if (b.cidPrefix !== undefined) { sets.push(`cid_prefix = $${idx++}`); params.push(b.cidPrefix); }
    if (b.noAnswerDest !== undefined) { sets.push(`no_answer_dest = $${idx++}`); params.push(b.noAnswerDest); }
    if (b.noAnswerDestType !== undefined) { sets.push(`no_answer_dest_type = $${idx++}`); params.push(b.noAnswerDestType); }

    if (sets.length > 0) {
      params.push(rg.id);
      await queryPbxDb(`UPDATE ring_groups SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    }

    if (b.members !== undefined) {
      await queryPbxDb(`DELETE FROM ring_group_members WHERE ring_group_id = $1`, [rg.id]);
      for (const m of b.members || []) {
        await queryPbxDb(
          `INSERT INTO ring_group_members (id, ring_group_id, extension, delay_seconds, timeout_seconds) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), rg.id, m.extension, m.delay || 0, m.timeout || 30],
        );
      }
    }
    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/ringgroups/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rg = await queryPbxDbOne(`SELECT id FROM ring_groups WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    if (rg) {
      await queryPbxDb(`DELETE FROM ring_group_members WHERE ring_group_id = $1`, [rg.id]);
      await queryPbxDb(`DELETE FROM ring_groups WHERE id = $1`, [rg.id]);
    }
    await syncXmlToFs();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// ROUTING
// ============================================================================

router.get('/routing/config', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();

    const inRows = await queryPbxDb(`SELECT * FROM inbound_routes WHERE domain_id = $1 ORDER BY route_order, name`, [domainId]);
    const inboundRoutes = inRows.map((r: any) => ({
      id: r.id,
      name: r.name,
      did: r.did || r.name,
      destination: r.destination_type || 'extension',
      destinationTarget: r.destination_target || '',
      enabled: r.enabled ?? true,
    }));

    const outRows = await queryPbxDb(
      `SELECT r.*, g.name as gateway_name FROM outbound_routes r LEFT JOIN gateways g ON r.gateway_id = g.id WHERE r.domain_id = $1 ORDER BY r.route_order`,
      [domainId],
    );
    const outboundRoutes = outRows.map((r: any) => ({
      id: r.id,
      name: r.name,
      pattern: r.pattern || '',
      trunkName: r.gateway_name || '',
      callerIdName: r.caller_id_name || '',
      callerIdNumber: r.caller_id_number || '',
      enabled: r.enabled ?? true,
    }));

    const trunks = (await queryPbxDb(`SELECT name, proxy FROM gateways WHERE domain_id = $1 AND enabled = true`, [domainId]))
      .map((t: any) => ({ name: t.name, host: t.proxy }));
    const queues = (await queryPbxDb(`SELECT name FROM queues WHERE domain_id = $1`, [domainId]))
      .map((q: any) => q.name);

    res.json({ success: true, config: { inboundRoutes, outboundRoutes }, trunks, queues });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/routing/config', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const { inboundRoutes, outboundRoutes } = req.body;

    if (inboundRoutes) {
      const existing = await queryPbxDb(`SELECT id FROM inbound_routes WHERE domain_id = $1`, [domainId]);
      const existingIds = new Set(existing.map((r: any) => r.id));
      const incomingIds = new Set(inboundRoutes.map((r: any) => r.id).filter(Boolean));

      for (const e of existing) {
        if (!incomingIds.has(e.id)) await queryPbxDb(`DELETE FROM inbound_routes WHERE id = $1`, [e.id]);
      }

      for (const route of inboundRoutes) {
        const isNew = !route.id || !existingIds.has(route.id);
        const did = route.did || route.name;
        const regex = route.didRegex || `^\\+?(?:92)?0?(${did})$`;
        if (isNew) {
          await queryPbxDb(
            `INSERT INTO inbound_routes (id, domain_id, name, did, did_regex, destination_type, destination_target, context, route_order, enabled, description)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'public',100,$8,$9)`,
            [randomUUID(), domainId, route.name || did, did, regex, route.destination || 'extension', route.destinationTarget || '', route.enabled ?? true, route.description || ''],
          );
        } else {
          await queryPbxDb(
            `UPDATE inbound_routes SET name=$1, did=$2, did_regex=$3, destination_type=$4, destination_target=$5, enabled=$6 WHERE id=$7`,
            [route.name || did, did, regex, route.destination || 'extension', route.destinationTarget || '', route.enabled ?? true, route.id],
          );
        }
      }
    }

    if (outboundRoutes) {
      for (const route of outboundRoutes) {
        if (!route.id) continue;
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (route.pattern !== undefined) { sets.push(`pattern = $${idx++}`); params.push(route.pattern); }
        if (route.callerIdName !== undefined) { sets.push(`caller_id_name = $${idx++}`); params.push(route.callerIdName); }
        if (route.callerIdNumber !== undefined) { sets.push(`caller_id_number = $${idx++}`); params.push(route.callerIdNumber); }
        if (route.enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(route.enabled); }
        if (route.trunkName) {
          const gw = await queryPbxDbOne(`SELECT id FROM gateways WHERE name = $1`, [route.trunkName]);
          if (gw) { sets.push(`gateway_id = $${idx++}`); params.push(gw.id); }
        }
        if (sets.length > 0) {
          params.push(route.id);
          await queryPbxDb(`UPDATE outbound_routes SET ${sets.join(', ')} WHERE id = $${idx}`, params);
        }
      }
    }

    await syncXmlToFs();
    res.json({ success: true, message: 'Routing applied to phone system' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// BLACKLIST
// ============================================================================

router.get('/blacklist', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(`SELECT * FROM blacklist WHERE domain_id = $1 ORDER BY number`, [domainId]);
    res.json({
      success: true,
      entries: rows.map((r: any) => ({ id: r.id, number: r.number, reason: r.reason || 'Blocked', createdAt: '' })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/blacklist', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const { number, reason } = req.body;
    await queryPbxDb(
      `INSERT INTO blacklist (id, domain_id, number, reason) VALUES ($1,$2,$3,$4)`,
      [randomUUID(), domainId, number, reason || 'Blocked'],
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/blacklist/:number', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(`DELETE FROM blacklist WHERE domain_id = $1 AND number = $2`, [domainId, req.params.number]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/blacklist/bulk', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    for (const number of req.body.numbers || []) {
      await queryPbxDb(
        `INSERT INTO blacklist (id, domain_id, number, reason) VALUES ($1,$2,$3,'Bulk blocked') ON CONFLICT DO NOTHING`,
        [randomUUID(), domainId, number],
      );
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// MOH
// ============================================================================

const MOH_DIRS = [
  '/usr/share/freeswitch/sounds/music',
  '/usr/local/freeswitch/sounds/music',
  '/var/lib/freeswitch/sounds/music',
];

const FS_SOUNDS_DIR = '/usr/local/freeswitch/sounds';

function resolveFsPath(p: string): string {
  return p.replace(/\$\$?\{sounds_dir\}/g, FS_SOUNDS_DIR);
}

async function findMohDir(): Promise<string> {
  for (const dir of MOH_DIRS) {
    try {
      const { stdout } = await sshExec(`test -d ${dir} && echo EXISTS || echo MISSING`);
      if (stdout.trim().includes('EXISTS')) return dir;
    } catch {}
  }
  return MOH_DIRS[0];
}

router.get('/moh', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(`SELECT * FROM moh_classes WHERE domain_id = $1`, [domainId]);
    const mohDir = await findMohDir();

    const classes = [];
    for (const r of rows) {
      const dir = resolveFsPath(r.path || `${mohDir}/${r.name}/${r.rate || 8000}`);
      let files: any[] = [];
      try {
        const { stdout } = await sshExec(`ls -la ${dir} 2>/dev/null || echo ""`);
        const lines = stdout.split('\n').filter((l: string) => l.match(/\.(wav|mp3|ogg)$/i));
        files = lines.map((l: string) => {
          const parts = l.trim().split(/\s+/);
          const fname = parts[parts.length - 1];
          // ls -la date fields: col 5=size, col 6=month, 7=day, 8=time/year
          const dateStr = parts.length >= 9 ? `${parts[5]} ${parts[6]} ${parts[7]}` : '';
          return { name: fname, size: parseInt(parts[4]) || 0, modified: dateStr };
        });
      } catch {}
      classes.push({
        id: r.id,
        name: r.name,
        mode: 'files',
        directory: dir,
        sort: r.shuffle ? 'random' : '',
        rate: r.rate || 8000,
        fileCount: files.length,
        files,
      });
    }

    if (classes.length === 0) {
      try {
        const { stdout } = await sshExec(`ls -d ${mohDir}/*/ 2>/dev/null || echo ""`);
        const dirs = stdout.split('\n').map((l: string) => l.trim().replace(/\/$/, '')).filter(Boolean);
        for (const d of dirs) {
          const className = d.split('/').pop() || '';
          if (!className || className === '.' || className === '..') continue;
          let files: any[] = [];
          try {
            const { stdout: ls } = await sshExec(`find ${d} -maxdepth 2 -type f \\( -name '*.wav' -o -name '*.mp3' -o -name '*.ogg' \\) 2>/dev/null || echo ""`);
            files = ls.split('\n').filter(Boolean).map((f: string) => ({ name: f.split('/').pop() || '', size: 0, modified: '' }));
          } catch {}
          classes.push({ id: '', name: className, mode: 'files', directory: d, sort: '', rate: 8000, fileCount: files.length, files });
        }
      } catch {}
    }

    res.json({ success: true, classes });
  } catch (error: any) {
    res.json({ success: true, classes: [] });
  }
});

router.post('/moh', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const { name, rate = 8000, shuffle = false, channels = 1 } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const mohDir = await findMohDir();
    const mohPath = `${mohDir}/${name}/${rate}`;
    await queryPbxDb(
      `INSERT INTO moh_classes (id, domain_id, name, rate, path, shuffle, channels) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), domainId, name, rate, mohPath, shuffle, channels],
    );
    try { await sshExec(`mkdir -p ${mohPath} && chown -R freeswitch:freeswitch ${mohDir}/${name}`); } catch {}
    await syncXmlToFs('moh');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/moh/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(`DELETE FROM moh_classes WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    await syncXmlToFs('moh');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/moh/:name/upload', requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const domainId = await getDefaultDomainId();
    const moh = await queryPbxDbOne(`SELECT path, rate FROM moh_classes WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    const mohDir = await findMohDir();
    const mohPath = resolveFsPath(moh?.path || `${mohDir}/${req.params.name}/${moh?.rate || 8000}`);
    const originalPath = req.file.path;
    const targetFilename = `${Date.now()}_${req.file.originalname.replace(/\.[^.]+$/, '.wav')}`;

    const { converted } = await uploadAudioToFs(originalPath, `${mohPath}/${targetFilename}`);
    try { fs.unlinkSync(originalPath); } catch {}
    // Reload local_stream so FS picks up the new file immediately
    try {
      await sshExec('/usr/local/freeswitch/bin/fs_cli -x "reload mod_local_stream" 2>/dev/null || true');
    } catch {}
    res.json({ success: true, filename: targetFilename, converted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/moh/:name/files/:filename', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const moh = await queryPbxDbOne(`SELECT path, rate FROM moh_classes WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    const mohDir = await findMohDir();
    const mohPath = resolveFsPath(moh?.path || `${mohDir}/${req.params.name}/${moh?.rate || 8000}`);
    try { await sshExec(`rm -f "${mohPath}/${req.params.filename}"`); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function serveMohFile(req: Request, res: Response): Promise<void> {
  try {
    const domainId = await getDefaultDomainId();
    const { name: className, filename } = req.params;
    const moh = await queryPbxDbOne(`SELECT path, rate FROM moh_classes WHERE domain_id = $1 AND name = $2`, [domainId, className]);
    const mohDir = await findMohDir();
    const rate = moh?.rate || '8000';
    const resolvedMohPath = moh?.path ? resolveFsPath(moh.path) : null;
    const candidates = [
      resolvedMohPath ? `${resolvedMohPath}/${filename}` : null,
      `${mohDir}/${className}/${rate}/${filename}`,
      `${mohDir}/${className}/${filename}`,
    ].filter(Boolean) as string[];

    let buffer: Buffer | null = null;
    for (const remotePath of candidates) {
      try {
        const buf = await fetchRecordingBuffer(remotePath);
        if (buf.length > 44) { buffer = buf; break; }
      } catch { continue; }
    }
    if (!buffer) { res.status(404).json({ success: false, error: 'MOH file not found' }); return; }
    res.set('Content-Type', audioMime(filename));
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch {
    res.status(404).json({ success: false, error: 'MOH file not accessible' });
  }
}

router.get('/moh/:name/files/:filename/play', requireAdmin, serveMohFile);
router.get('/moh/:name/files/:filename/stream', requireAdmin, serveMohFile);

// ============================================================================
// RECORDINGS
// ============================================================================

router.get('/recordings', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const rows = await queryPbxDb(`SELECT * FROM recordings WHERE domain_id = $1 ORDER BY name`, [domainId]);
    const basePath = `/var/lib/freeswitch/recordings/${domain.name}`;

    // Try to get file sizes from FS via a single SSH ls command
    let fileSizes: Record<string, number> = {};
    try {
      const filenames = rows.map((r: any) => `"${basePath}/${r.filename}"`).join(' ');
      if (rows.length > 0) {
        const { stdout } = await sshExec(`ls -la ${filenames} 2>/dev/null || true`);
        for (const line of stdout.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 9) fileSizes[parts[parts.length - 1]] = parseInt(parts[4]) || 0;
        }
      }
    } catch {}

    res.json({
      success: true,
      recordings: rows.map((r: any) => {
        const fsPath = `${basePath}/${r.filename}`;
        const ext = (r.filename || '').split('.').pop()?.toLowerCase() || 'wav';
        const isWav = ext === 'wav';
        return {
          id: r.id,
          name: r.name,
          filename: r.filename,
          path: fsPath,
          format: ext.toUpperCase(),
          freeswitchReady: isWav,
          size: fileSizes[fsPath] || 0,
        };
      }),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/recordings/upload', requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const domainId = await getDefaultDomainId();
    const domain = await getDefaultDomain();
    const originalPath = req.file.path;
    const targetFilename = `${Date.now()}_${req.file.originalname.replace(/\.[^.]+$/, '.wav')}`;
    const recordingsPath = `/var/lib/freeswitch/recordings/${domain.name}`;

    const { converted } = await uploadAudioToFs(originalPath, `${recordingsPath}/${targetFilename}`);

    await queryPbxDb(
      `INSERT INTO recordings (id, domain_id, name, filename, description) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), domainId, req.file.originalname.replace(/\.[^.]+$/, ''), targetFilename, 'Uploaded via PBX Admin'],
    );
    try { fs.unlinkSync(originalPath); } catch {}
    res.json({
      success: true,
      converted,
      conversionNote: converted ? 'Audio converted to 8kHz mono WAV for FreeSWITCH compatibility' : undefined,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/recordings/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(`DELETE FROM recordings WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function serveRecording(req: Request, res: Response): Promise<void> {
  try {
    const domain = await getDefaultDomain();
    const domainId = await getDefaultDomainId();
    const { filename } = req.params;
    const rec = await queryPbxDbOne(
      `SELECT filename FROM recordings WHERE domain_id = $1 AND (filename = $2 OR name = $2)`,
      [domainId, filename],
    );
    const actualFile = rec?.filename || filename;
    const remotePath = `/var/lib/freeswitch/recordings/${domain.name}/${actualFile}`;
    const buffer = await fetchRecordingBuffer(remotePath);
    if (buffer.length < 44) { res.status(404).json({ success: false, error: 'Recording not found or empty' }); return; }
    res.set('Content-Type', audioMime(actualFile));
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch {
    res.status(404).json({ success: false, error: 'Recording not accessible' });
  }
}

router.get('/recordings/:filename/play', requireAdmin, serveRecording);
router.get('/recordings/:filename/stream', requireAdmin, serveRecording);

// ============================================================================
// CDR (uses FusionPBX database — CDR data lives there)
// ============================================================================

router.get('/cdr', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, limit = 100, offset = 0, src, dst, disposition, minDuration } = req.query;
    let sql = `SELECT c.xml_cdr_uuid, c.caller_id_name, c.caller_id_number,
                      c.destination_number, c.direction, c.context, c.start_stamp,
                      c.answer_stamp, c.end_stamp, c.duration, c.billsec,
                      c.hangup_cause, c.record_name, c.record_path
               FROM v_xml_cdr c`;
    const params: any[] = [];
    const conditions: string[] = ["c.destination_number NOT LIKE 'autocall_%'"];

    if (startDate) { conditions.push(`c.start_stamp >= $${params.length + 1}`); params.push(startDate); }
    if (endDate) { conditions.push(`c.start_stamp <= ($${params.length + 1}::date + interval '1 day')`); params.push(endDate); }
    if (src) { conditions.push(`c.caller_id_number LIKE $${params.length + 1}`); params.push(`%${src}%`); }
    if (dst) { conditions.push(`c.destination_number LIKE $${params.length + 1}`); params.push(`%${dst}%`); }
    if (disposition) {
      if (disposition === 'ANSWERED') conditions.push(`c.hangup_cause = 'NORMAL_CLEARING'`);
      else if (disposition === 'NO ANSWER') conditions.push(`(c.hangup_cause = 'NO_ANSWER' OR c.hangup_cause = 'ALLOTTED_TIMEOUT')`);
      else if (disposition === 'BUSY') conditions.push(`c.hangup_cause = 'USER_BUSY'`);
      else if (disposition === 'FAILED') conditions.push(`(c.hangup_cause = 'CALL_REJECTED' OR c.hangup_cause = 'DESTINATION_OUT_OF_ORDER' OR c.hangup_cause = 'UNALLOCATED_NUMBER')`);
      else { conditions.push(`c.hangup_cause = $${params.length + 1}`); params.push(disposition); }
    }
    if (minDuration) { conditions.push(`c.duration >= $${params.length + 1}`); params.push(parseInt(minDuration as string) || 0); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

    let countSql = `SELECT COUNT(*) as total FROM v_xml_cdr c`;
    if (conditions.length > 0) countSql += ' WHERE ' + conditions.join(' AND ');
    const [countRow] = await queryFusionPbx(countSql, [...params]);
    const total = parseInt(countRow?.total || '0');

    sql += ` ORDER BY c.start_stamp DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string) || 100);
    if (offset) { sql += ` OFFSET $${params.length + 1}`; params.push(parseInt(offset as string) || 0); }

    const rows = await queryFusionPbx(sql, params);
    const records = rows.map((r: any) => {
      let disp = r.hangup_cause || '';
      if (disp === 'NORMAL_CLEARING') disp = 'ANSWERED';
      else if (disp === 'NO_ANSWER' || disp === 'ALLOTTED_TIMEOUT') disp = 'NO ANSWER';
      else if (disp === 'USER_BUSY') disp = 'BUSY';
      else if (disp === 'CALL_REJECTED' || disp === 'DESTINATION_OUT_OF_ORDER' || disp === 'UNALLOCATED_NUMBER') disp = 'FAILED';
      return {
        uuid: r.xml_cdr_uuid, callDate: r.start_stamp, src: r.caller_id_number,
        dst: r.destination_number, duration: parseInt(r.duration) || 0,
        billsec: parseInt(r.billsec) || 0, disposition: disp,
        direction: r.direction || '', callerIdName: r.caller_id_name || '',
        hasRecording: !!r.record_name || r.hangup_cause === 'NORMAL_CLEARING',
      };
    });
    res.json({ success: true, records, total });
  } catch (error: any) {
    console.error('CDR query error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/cdr/summary', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, days = 7 } = req.query;
    let tc: string;
    if (startDate && endDate) tc = `start_stamp >= '${startDate}'::date AND start_stamp < ('${endDate}'::date + interval '1 day')`;
    else if (startDate) tc = `start_stamp >= '${startDate}'::date`;
    else { const d = parseInt(String(days)) || 7; tc = `start_stamp >= NOW() - INTERVAL '${d} days'`; }

    const [totalRow] = await queryFusionPbx(`SELECT COUNT(*) as total FROM v_xml_cdr WHERE ${tc}`);
    const [answeredRow] = await queryFusionPbx(`SELECT COUNT(*) as answered FROM v_xml_cdr WHERE ${tc} AND hangup_cause = 'NORMAL_CLEARING'`);
    const [missedRow] = await queryFusionPbx(`SELECT COUNT(*) as missed FROM v_xml_cdr WHERE ${tc} AND (hangup_cause = 'NO_ANSWER' OR hangup_cause = 'ALLOTTED_TIMEOUT')`);
    const [durationRow] = await queryFusionPbx(`SELECT AVG(duration) as avg_duration FROM v_xml_cdr WHERE ${tc} AND duration IS NOT NULL`);

    const total = parseInt(totalRow?.total || '0');
    const answered = parseInt(answeredRow?.answered || '0');

    res.json({
      success: true,
      summary: {
        totalCalls: total,
        answeredCalls: answered,
        missedCalls: parseInt(missedRow?.missed || '0'),
        avgDuration: Math.round(parseFloat(durationRow?.avg_duration || '0')),
        answerRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/cdr/top-callers', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, days = 7, limit = 10 } = req.query;
    let tc: string;
    if (startDate && endDate) tc = `start_stamp >= '${startDate}'::date AND start_stamp < ('${endDate}'::date + interval '1 day')`;
    else if (startDate) tc = `start_stamp >= '${startDate}'::date`;
    else { const d = parseInt(String(days)) || 7; tc = `start_stamp >= NOW() - INTERVAL '${d} days'`; }

    const rows = await queryFusionPbx(
      `SELECT caller_id_number, COUNT(*) as call_count, SUM(duration) as total_duration
       FROM v_xml_cdr WHERE ${tc} AND (direction = 'inbound' OR direction IS NULL) AND caller_id_number IS NOT NULL
       GROUP BY caller_id_number ORDER BY call_count DESC LIMIT ${limit}`,
    );
    res.json({
      success: true,
      topCallers: rows.map((r: any) => ({ number: r.caller_id_number, count: parseInt(r.call_count), totalDuration: parseInt(r.total_duration || '0') })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Shared helper: find the recording file path for a given CDR UUID.
// Checks CDR record_path/record_name first, then falls back to a
// filesystem find on the FreeSWITCH server (handles legacy calls where
// dialplan didn't set the channel vars).
async function resolveRecordingPath(uuid: string): Promise<string | null> {
  const safeUuid = uuid.replace(/[^a-f0-9\-]/gi, '');
  if (!safeUuid) return null;

  const [row] = await queryFusionPbx(
    `SELECT record_path, record_name FROM v_xml_cdr WHERE xml_cdr_uuid = $1 LIMIT 1`,
    [safeUuid],
  );

  if (row?.record_name) {
    return row.record_path ? `${row.record_path}/${row.record_name}` : row.record_name;
  }

  // Fallback: search FS filesystem by UUID filename
  const findCmd = `find /usr/local/freeswitch/recordings -name "${safeUuid}.wav" -o -name "${safeUuid}.mp3" 2>/dev/null | head -1`;
  const sshCmd = `sshpass -p '${PBX_SSH_PASSWORD}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${PBX_SSH_USER}@${PBX_HOST} "${findCmd}"`;
  try {
    const { stdout } = await execAsync(sshCmd, { timeout: 10000 });
    const found = stdout.trim();
    return found || null;
  } catch {
    return null;
  }
}

// GET /cdr/recording/:uuid — stream recording audio
router.get('/cdr/recording/:uuid', requireAdmin, async (req: Request, res: Response) => {
  try {
    const filePath = await resolveRecordingPath(req.params.uuid);
    if (!filePath) return res.status(404).json({ success: false, error: 'Recording not found' });

    const buffer = await fetchRecordingBuffer(filePath);
    if (buffer.length < 44) return res.status(404).json({ success: false, error: 'Recording file not accessible' });

    res.set('Content-Type', audioMime(filePath));
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /cdr/recording/:uuid/download — download recording as attachment
router.get('/cdr/recording/:uuid/download', requireAdmin, async (req: Request, res: Response) => {
  try {
    const filePath = await resolveRecordingPath(req.params.uuid);
    if (!filePath) return res.status(404).json({ success: false, error: 'Recording not found' });

    const buffer = await fetchRecordingBuffer(filePath);
    if (buffer.length < 44) return res.status(404).json({ success: false, error: 'Recording file not accessible' });

    const filename = filePath.split('/').pop() || `recording-${req.params.uuid}.wav`;
    res.set('Content-Type', audioMime(filePath));
    res.set('Content-Length', String(buffer.length));
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy route kept for backward compatibility with any direct links
router.get('/cdr/:uuid/recording', requireAdmin, async (req: Request, res: Response) => {
  try {
    const filePath = await resolveRecordingPath(req.params.uuid);
    if (!filePath) return res.status(404).json({ success: false, error: 'Recording not found' });

    const buffer = await fetchRecordingBuffer(filePath);
    if (buffer.length < 44) return res.status(404).json({ success: false, error: 'Recording file not accessible' });

    res.set('Content-Type', audioMime(filePath));
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SIP PROFILES (read-only via ESL)
// ============================================================================

router.get('/sip-profiles', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const profiles: any[] = [];
    try {
      const output = await eslConnection.sendCommand('sofia status');
      if (output.success && output.output) {
        for (const line of output.output.split('\n')) {
          const match = line.match(/^(\w+)\s+(running|stopped)/);
          if (match) {
            let registrations = 0;
            try {
              const regOutput = await eslConnection.sendCommand(`sofia status profile ${match[1]} reg`);
              if (regOutput.success && regOutput.output) registrations = regOutput.output.split('\n').filter((l: string) => l.includes('Registered')).length;
            } catch {}
            profiles.push({
              name: match[1],
              state: match[2],
              registrations,
              calls: 0,
            });
          }
        }
      }
    } catch {}

    if (profiles.length === 0) {
      profiles.push(
        { name: 'internal', state: 'running', registrations: 0, calls: 0 },
        { name: 'external', state: 'running', registrations: 0, calls: 0 },
      );
    }
    res.json({ success: true, profiles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CONFERENCES (via ESL)
// ============================================================================

router.get('/conferences', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const conferences: any[] = [];
    try {
      const output = await eslConnection.sendCommand('conference list');
      if (output.success && output.output) {
        let currentConf: any = null;
        for (const line of output.output.split('\n')) {
          const confMatch = line.match(/Conference\s+(\S+)\s+\((\d+)\s+members?\)/);
          if (confMatch) {
            if (currentConf) conferences.push(currentConf);
            currentConf = { name: confMatch[1], extension: confMatch[1], memberCount: parseInt(confMatch[2]), members: [], maxMembers: 32 };
          }
          if (currentConf && line.includes(';')) {
            const parts = line.split(';');
            if (parts.length >= 4) {
              currentConf.members.push({
                id: parts[0], channel: parts[1], callerId: parts[3] || 'Unknown',
                muted: parts[4]?.includes('mute') || false, isAdmin: parts[4]?.includes('moderator') || false,
              });
            }
          }
        }
        if (currentConf) conferences.push(currentConf);
      }
    } catch {}
    res.json({ success: true, conferences });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/conferences', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    await eslConnection.sendCommand(`conference ${name} create`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/conferences/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    await eslConnection.sendCommand(`conference ${req.params.name} destroy`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/conferences/:name/members/:id/kick', requireAdmin, async (req: Request, res: Response) => {
  try {
    await eslConnection.sendCommand(`conference ${req.params.name} kick ${req.params.id}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/conferences/:name/members/:id/mute', requireAdmin, async (req: Request, res: Response) => {
  try {
    await eslConnection.sendCommand(`conference ${req.params.name} mute ${req.params.id}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/conferences/:name/members/:id/unmute', requireAdmin, async (req: Request, res: Response) => {
  try {
    await eslConnection.sendCommand(`conference ${req.params.name} unmute ${req.params.id}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// TIME CONDITIONS
// ============================================================================

router.get('/time-conditions', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(
      `SELECT tc.*, COALESCE(json_agg(tcr ORDER BY tcr.id) FILTER (WHERE tcr.id IS NOT NULL), '[]') AS ranges
       FROM time_conditions tc
       LEFT JOIN time_condition_ranges tcr ON tcr.condition_id = tc.id
       WHERE tc.domain_id = $1
       GROUP BY tc.id
       ORDER BY tc.name`,
      [domainId],
    );
    const conditions = rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      extension: r.extension || '',
      description: r.description || '',
      enabled: r.enabled ?? true,
      destinationMatch: r.destination_match || '',
      destinationMismatch: r.destination_mismatch || '',
      conditions: (r.ranges || []).map((rng: any) => ({
        type: rng.type,
        days: rng.days || [],
        startTime: rng.start_time || '',
        endTime: rng.end_time || '',
        startDate: rng.start_date || '',
        endDate: rng.end_date || '',
      })),
    }));
    res.json({ success: true, conditions });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/time-conditions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const id = randomUUID();
    await queryPbxDb(
      `INSERT INTO time_conditions (id, domain_id, name, extension, description, enabled, destination_match, destination_mismatch)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, domainId, b.name, b.extension || null, b.description || null,
       b.enabled ?? true, b.destinationMatch || null, b.destinationMismatch || null],
    );
    for (const rng of b.conditions || []) {
      await queryPbxDb(
        `INSERT INTO time_condition_ranges (id, condition_id, type, days, start_time, end_time, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), id, rng.type, rng.days || null,
         rng.startTime || null, rng.endTime || null,
         rng.startDate || null, rng.endDate || null],
      );
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/time-conditions/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const row = await queryPbxDbOne(
      `SELECT id FROM time_conditions WHERE domain_id = $1 AND name = $2`,
      [domainId, req.params.name],
    );
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    await queryPbxDb(
      `UPDATE time_conditions SET name=$1, extension=$2, description=$3, enabled=$4,
       destination_match=$5, destination_mismatch=$6, updated_at=now()
       WHERE id=$7`,
      [b.name ?? req.params.name, b.extension || null, b.description || null,
       b.enabled ?? true, b.destinationMatch || null, b.destinationMismatch || null, row.id],
    );
    if (b.conditions !== undefined) {
      await queryPbxDb(`DELETE FROM time_condition_ranges WHERE condition_id = $1`, [row.id]);
      for (const rng of b.conditions || []) {
        await queryPbxDb(
          `INSERT INTO time_condition_ranges (id, condition_id, type, days, start_time, end_time, start_date, end_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), row.id, rng.type, rng.days || null,
           rng.startTime || null, rng.endTime || null,
           rng.startDate || null, rng.endDate || null],
        );
      }
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/time-conditions/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(`DELETE FROM time_conditions WHERE domain_id = $1 AND name = $2`, [domainId, req.params.name]);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================================
// VOICEMAIL — backed by extensions.voicemail_enabled
// ============================================================================

const VM_STORAGE = (domain: string) => `/usr/local/freeswitch/storage/voicemail/default/${domain}`;

router.get('/voicemail', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(
      `SELECT * FROM extensions WHERE domain_id = $1 AND voicemail_enabled = true ORDER BY extension`,
      [domainId],
    );
    res.json({
      success: true,
      mailboxes: rows.map((r: any) => ({
        id: r.id,
        extension: r.extension,
        password: r.voicemail_password || '1234',
        email: r.email || '',
        description: r.description || '',
        enabled: r.enabled ?? true,
        attachFile: false,
        deleteAfterEmail: false,
        messageCount: 0,
      })),
    });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/voicemail', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    const existing = await queryPbxDbOne(
      `SELECT id FROM extensions WHERE domain_id = $1 AND extension = $2`,
      [domainId, b.extension],
    );
    if (existing) {
      await queryPbxDb(
        `UPDATE extensions SET voicemail_enabled=true, voicemail_password=$1, email=$2, updated_at=now()
         WHERE domain_id=$3 AND extension=$4`,
        [b.password || '1234', b.email || null, domainId, b.extension],
      );
    } else {
      await queryPbxDb(
        `INSERT INTO extensions (id, domain_id, extension, password, caller_id_name, caller_id_number, enabled, voicemail_enabled, voicemail_password, email, call_timeout)
         VALUES ($1,$2,$3,$4,$5,$6,true,true,$7,$8,30)`,
        [randomUUID(), domainId, b.extension, b.password || '1234',
         b.description || `Extension ${b.extension}`, b.extension, b.password || '1234', b.email || null],
      );
    }
    await syncXmlToFs('extensions');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/voicemail/:extension', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    await queryPbxDb(
      `UPDATE extensions SET voicemail_password=$1, email=$2, updated_at=now()
       WHERE domain_id=$3 AND extension=$4`,
      [b.password || '1234', b.email || null, domainId, req.params.extension],
    );
    await syncXmlToFs('extensions');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/voicemail/:extension', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(
      `UPDATE extensions SET voicemail_enabled=false, updated_at=now() WHERE domain_id=$1 AND extension=$2`,
      [domainId, req.params.extension],
    );
    await syncXmlToFs('extensions');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/voicemail/:extension/messages', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name: domainName } = await getDefaultDomain();
    const msgDir = `${VM_STORAGE(domainName)}/${req.params.extension}/msgs`;
    const messages: any[] = [];
    try {
      const { stdout } = await sshExec(`ls "${msgDir}"/*.wav 2>/dev/null || true`);
      for (const line of stdout.split('\n').filter(Boolean)) {
        const filename = line.trim().split('/').pop() || '';
        const uuid = filename.replace('.wav', '');
        let duration = 0;
        try {
          const { stdout: dur } = await sshExec(`soxi -D "${line.trim()}" 2>/dev/null || echo 0`);
          duration = Math.round(parseFloat(dur.trim()) || 0);
        } catch {}
        messages.push({ uuid, duration, date: '', from: '', folder: 'inbox', read: false });
      }
    } catch {}
    res.json({ success: true, messages });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/voicemail/messages/:uuid', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name: domainName } = await getDefaultDomain();
    const { ext } = req.query as { ext: string };
    if (ext) {
      try { await sshExec(`rm -f "${VM_STORAGE(domainName)}/${ext}/msgs/${req.params.uuid}.wav"`); } catch {}
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/voicemail/:extension/greeting', requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { name: domainName } = await getDefaultDomain();
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const greetDir = `${VM_STORAGE(domainName)}/${req.params.extension}`;
    await sshExec(`mkdir -p "${greetDir}"`);
    await uploadText(file.buffer.toString('binary'), `${greetDir}/greeting.wav`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================================
// FAX CONFIGURATIONS
// ============================================================================

router.get('/fax', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const rows = await queryPbxDb(
      `SELECT * FROM fax_configs WHERE domain_id = $1 ORDER BY extension`,
      [domainId],
    );
    res.json({
      success: true,
      fax: rows.map((r: any) => ({
        id: r.id,
        extension: r.extension,
        name: r.name || '',
        email: r.email || '',
        callerIdNumber: r.caller_id_number || '',
        callerIdName: r.caller_id_name || '',
        description: r.description || '',
        enabled: r.enabled ?? true,
        inboxCount: 0,
        outboxCount: 0,
      })),
    });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/fax', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    await queryPbxDb(
      `INSERT INTO fax_configs (id, domain_id, extension, name, email, caller_id_number, caller_id_name, description, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), domainId, b.extension, b.name || null, b.email || null,
       b.callerIdNumber || null, b.callerIdName || null, b.description || null, b.enabled ?? true],
    );
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/fax/:extension', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    const b = req.body;
    await queryPbxDb(
      `UPDATE fax_configs SET name=$1, email=$2, caller_id_number=$3, caller_id_name=$4,
       description=$5, enabled=$6, updated_at=now()
       WHERE domain_id=$7 AND extension=$8`,
      [b.name || null, b.email || null, b.callerIdNumber || null, b.callerIdName || null,
       b.description || null, b.enabled ?? true, domainId, req.params.extension],
    );
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/fax/:extension', requireAdmin, async (req: Request, res: Response) => {
  try {
    const domainId = await getDefaultDomainId();
    await queryPbxDb(`DELETE FROM fax_configs WHERE domain_id=$1 AND extension=$2`, [domainId, req.params.extension]);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/fax/:extension/:type', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name: domainName } = await getDefaultDomain();
    const faxDir = `/usr/local/freeswitch/storage/fax/${domainName}/${req.params.extension}/${req.params.type}`;
    const files: any[] = [];
    try {
      const { stdout } = await sshExec(`ls -la "${faxDir}" 2>/dev/null || true`);
      for (const line of stdout.split('\n').filter((l: string) => l.trim() && !l.startsWith('total') && !l.startsWith('d'))) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          files.push({ filename: parts[8], size: parseInt(parts[4]) || 0, date: `${parts[5]} ${parts[6]} ${parts[7]}` });
        }
      }
    } catch {}
    res.json({ success: true, files });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/fax/:extension/files/:filename', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name: domainName } = await getDefaultDomain();
    const { type } = req.query as { type: string };
    const faxDir = `/usr/local/freeswitch/storage/fax/${domainName}/${req.params.extension}/${type || 'inbox'}`;
    try { await sshExec(`rm -f "${faxDir}/${req.params.filename}"`); } catch {}
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/fax/:extension/send', requireAdmin, async (req: Request, res: Response) => {
  try {
    res.json({ success: false, error: 'Fax sending requires additional configuration' });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

const SCRIPTS_DIR = '/usr/share/freeswitch/scripts';

router.get('/scripts', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const scripts: any[] = [];
    try {
      const { stdout } = await sshExec(`ls -la ${SCRIPTS_DIR}/`);
      const lines = stdout.split('\n').filter((l: string) => l.trim() && !l.startsWith('total') && !l.startsWith('d'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const filename = parts[8];
          const ext = filename.split('.').pop()?.toLowerCase();
          if (['lua', 'js', 'py', 'pl'].includes(ext || '')) {
            let content = '';
            try { content = await readFsFile(`${SCRIPTS_DIR}/${filename}`); } catch {}
            scripts.push({ name: filename.replace(/\.[^.]+$/, ''), type: ext, description: '', enabled: true, content, lastModified: `${parts[5]} ${parts[6]} ${parts[7]}`, size: parseInt(parts[4]) || 0 });
          }
        }
      }
    } catch {}
    res.json({ success: true, scripts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/scripts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, type, content } = req.body;
    if (content) await writeFsFile(`${SCRIPTS_DIR}/${name}.${type || 'lua'}`, content, 'freeswitch:freeswitch');
    res.json({ success: true, message: 'Script created' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/scripts/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { content, type } = req.body;
    if (content !== undefined) await writeFsFile(`${SCRIPTS_DIR}/${req.params.name}.${type || 'lua'}`, content, 'freeswitch:freeswitch');
    res.json({ success: true, message: 'Script saved' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/scripts/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    try { await sshExec(`rm -f ${SCRIPTS_DIR}/${req.params.name}.*`); } catch {}
    res.json({ success: true, message: 'Script deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const BACKUP_DIR = '/var/lib/freeswitch/backups';

router.get('/backups', requireAdmin, async (_req: Request, res: Response) => {
  try {
    let backups: any[] = [];
    try {
      const { stdout } = await sshExec(`ls -la ${BACKUP_DIR}/ 2>/dev/null || echo 'DIR_NOT_FOUND'`);
      if (!stdout.includes('DIR_NOT_FOUND')) {
        const lines = stdout.split('\n').filter((l: string) => l.trim() && !l.startsWith('total') && !l.startsWith('d') && l.includes('.tar'));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 9) {
            backups.push({ id: parts[8].replace(/\.tar\.gz$/, ''), filename: parts[8], size: parseInt(parts[4]) || 0, created: `${parts[5]} ${parts[6]} ${parts[7]}`, status: 'complete' });
          }
        }
      }
    } catch {}
    res.json({ success: true, backups });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/backups', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const backupId = `backup-${Date.now()}`;
    await sshExec(`mkdir -p ${BACKUP_DIR}`);
    const backupCmd = `cd /tmp && mkdir -p ${backupId} && cp -r /etc/freeswitch/* ${backupId}/ 2>/dev/null || true && tar -czf ${BACKUP_DIR}/${backupId}.tar.gz ${backupId} && rm -rf ${backupId}`;
    try { await sshExec(backupCmd); } catch {}
    res.json({ success: true, message: 'Backup created', backupId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/backups/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    try { await sshExec(`rm -f ${BACKUP_DIR}/${req.params.id}.tar.gz`); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dialplan', requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      contexts: [
        { name: 'public', extensionCount: 0 },
        { name: 'default', extensionCount: 0 },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dialplan/:context', requireAdmin, async (req: Request, res: Response) => {
  try {
    const ctx = req.params.context;
    // Read from 00-iteck-public.xml (our managed file) for the public context.
    // public.xml is locked immutable and FusionPBX may have stale content in it.
    const contextFile = `/etc/freeswitch/dialplan/${ctx === 'public' ? '00-iteck-public' : 'default'}.xml`;
    let rawContent = '';
    try { rawContent = await readFsFile(contextFile); } catch { rawContent = '<!-- File not found -->'; }
    res.json({ success: true, entries: [], rawContent });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy aliases
router.get('/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const version = await fsCli('version').catch(() => 'FreeSWITCH');
    const status = await fsCli('status').catch(() => '');
    const registrations = await fsCli('sofia status profile internal reg').catch(() => '');
    const regCount = registrations.split('\n').filter((l: string) => l.includes('Registered')).length;
    res.json({
      success: true,
      version: version.split('\n')[0] || 'FreeSWITCH',
      uptime: status.match(/Uptime:\s*(.+)/)?.[1] || 'Unknown',
      activeCalls: status.match(/session\(s\)\s*-\s*(\d+)/)?.[1] || '0',
      registeredEndpoints: regCount,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/reload', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await syncXmlToFs('all');
    res.json({ success: true, message: 'Configuration reloaded' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
