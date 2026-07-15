import axios, { AxiosError } from 'axios';
import { useAdminAuthStore } from '@features/pbx-admin';
import type {
  Extension, Trunk, Queue, QueueMember, IvrMenu, RingGroup, TimeCondition,
  VoicemailBox, Conference, FaxConfig, MohClass, Recording,
  CdrRecord, CdrSummary, BlacklistEntry, SipProfile, Script,
  Backup, SystemStatus, RoutingConfig, InboundRoute, OutboundRoute,
} from './types';

export const api = axios.create({
  baseURL: '/api/pbx-admin',
});

// Attach bearer token to every request
api.interceptors.request.use((config) => {
  const token = useAdminAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, log out and redirect
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      useAdminAuthStore.getState().logout();
      window.location.href = '/pbx-admin-v2';
    }
    return Promise.reject(err);
  }
);

// Helper: extract a user-friendly error message from any thrown error
export function extractError(err: unknown): string {
  if (err instanceof AxiosError) {
    const msg = (err.response?.data as any)?.error;
    if (msg) return msg;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

// ─── System ──────────────────────────────────────────────────────────────────

export const getSystemStatus = (): Promise<SystemStatus> =>
  api.get('/system/status').then(r => r.data.status);

export const getSystemModules = (): Promise<{ name: string; enabled: boolean }[]> =>
  api.get('/system/modules').then(r => r.data.modules);

export const getSystemLogs = (lines = 200): Promise<string[]> =>
  api.get('/system/logs', { params: { lines } }).then(r => r.data.logs);

export const reloadSystem = (): Promise<{ success: boolean; message: string }> =>
  api.post('/system/reload').then(r => r.data);

export const restartSystem = (): Promise<{ success: boolean; message: string }> =>
  api.post('/system/restart').then(r => r.data);

// ─── Extensions ──────────────────────────────────────────────────────────────

function mapExtension(e: any): Extension {
  return {
    id: e.id || e.extension_uuid || '',
    extension: e.extension || '',
    password: e.auth?.password || e.password || '',
    context: e.context || 'default',
    callerIdName: e.name || e.callerIdName || e.effective_caller_id_name || '',
    callerIdNumber: e.callerIdNumber || e.effective_caller_id_number || e.extension || '',
    status: e.status === 'registered' ? 'online' : 'offline',
    registered: e.status === 'registered' || e.registered === true,
    contact: e.contact,
    codecs: e.codecs || [],
    webRtcEnabled: e.template === 'WebRTC' || e.webRtcEnabled,
    callRecording: e.callRecording || 'disabled',
    dnd: e.dnd ?? false,
    callForwardEnabled: e.callForwardEnabled ?? false,
    callForwardDest: e.callForwardDest || '',
    ringDuration: e.ringDuration ?? 30,
  };
}

function extToBackend(data: Partial<Extension>): any {
  const out: any = { ...data };
  if (data.extension !== undefined) out.number = data.extension;
  if (data.callRecording !== undefined) out.callRecording = data.callRecording;
  return out;
}

export const getExtensions = (): Promise<Extension[]> =>
  api.get('/extensions').then(r => (r.data.extensions || []).map(mapExtension));

export const getExtension = (ext: string): Promise<Extension> =>
  api.get(`/extensions/${ext}`).then(r => mapExtension(r.data.extension || r.data));

export const createExtension = (data: Partial<Extension>): Promise<{ success: boolean }> =>
  api.post('/extensions', extToBackend(data)).then(r => r.data);

export const updateExtension = (ext: string, data: Partial<Extension>): Promise<{ success: boolean }> =>
  api.put(`/extensions/${ext}`, extToBackend(data)).then(r => r.data);

export const deleteExtension = (ext: string): Promise<{ success: boolean }> =>
  api.delete(`/extensions/${ext}`).then(r => r.data);

export const bulkImportExtensions = (extensions: Partial<Extension>[]): Promise<any> =>
  api.post('/extensions/bulk-import', { extensions: extensions.map(extToBackend) }).then(r => r.data);

// ─── Trunks ──────────────────────────────────────────────────────────────────

function mapTrunk(t: any): Trunk {
  return {
    ...t,
    state: t.fsState || t.state || '',
    callsIn: t.callsIn ?? 0,
    callsOut: t.callsOut ?? 0,
    totalCalls: (t.callsIn ?? 0) + (t.callsOut ?? 0),
  };
}

export const getTrunks = (): Promise<Trunk[]> =>
  api.get('/trunks').then(r => (r.data.trunks || []).map(mapTrunk));

export const getTrunk = (name: string): Promise<Trunk> =>
  api.get(`/trunks/${name}`).then(r => mapTrunk(r.data.trunk || r.data));

export const createTrunk = (data: Partial<Trunk>): Promise<{ success: boolean }> =>
  api.post('/trunks', data).then(r => r.data);

export const updateTrunk = (name: string, data: Partial<Trunk>): Promise<{ success: boolean }> =>
  api.put(`/trunks/${name}`, data).then(r => r.data);

export const deleteTrunk = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/trunks/${name}`).then(r => r.data);

// ─── Queues ───────────────────────────────────────────────────────────────────

function mapQueue(q: any): Queue {
  const membersDetail: QueueMember[] = (q.membersDetail || []).map((m: any) => ({
    extension: m.extension || m.name || '',
    name: m.name || m.extension || '',
    status: m.status,
    callsTaken: m.callsTaken ?? 0,
  }));
  return {
    id: q.id,
    name: q.name,
    extension: q.extension,
    strategy: q.strategy || q.params?.strategy || '',
    mohSound: q.mohSound || q.params?.moh || '',
    announceSound: q.announceSound || '',
    announceFrequency: q.announceFrequency ?? (q.params?.announce_frequency ? parseInt(q.params.announce_frequency) : 0),
    timeout: q.params?.timeout ? parseInt(q.params.timeout) : q.timeout,
    maxWaitTime: q.maxWaitTime,
    waiting: q.calls ?? q.waiting ?? 0,
    agents: q.memberCount ?? q.agents ?? membersDetail.length,
    members: membersDetail.length > 0 ? membersDetail : (q.members || []).map((m: any) =>
      typeof m === 'string' ? { extension: m, name: m } : m
    ),
    description: q.description,
  };
}

export const getQueues = (): Promise<Queue[]> =>
  api.get('/queues').then(r => (r.data.queues || []).map(mapQueue));

export const createQueue = (data: Partial<Queue>): Promise<{ success: boolean }> =>
  api.post('/queues', data).then(r => r.data);

export const updateQueue = (name: string, data: Partial<Queue>): Promise<{ success: boolean }> =>
  api.put(`/queues/${name}`, data).then(r => r.data);

export const deleteQueue = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/queues/${name}`).then(r => r.data);

export const getQueueMonitor = (): Promise<any[]> =>
  api.get('/queue-monitor').then(r => r.data.queues || []);

// ─── IVR ─────────────────────────────────────────────────────────────────────

function mapIvr(ivr: any): IvrMenu {
  const options = (ivr.options || ivr.entries || []).map((e: any) => ({
    digit: e.digit,
    action: e.action || 'None',
    param: e.param || '',
    description: e.description || '',
  }));
  return {
    id: ivr.id,
    name: ivr.name,
    description: ivr.description,
    greetingShort: ivr.greetingShort || ivr.greeting || '',
    greetingLong: ivr.greetingLong || ivr.greeting || '',
    timeout: ivr.timeout,
    maxFailures: ivr.maxFailures,
    maxTimeouts: ivr.maxTimeouts,
    digitTimeout: ivr.digitTimeout,
    directDial: ivr.directDial,
    timeoutDestType: ivr.timeoutDestType || 'Hangup',
    timeoutDest: ivr.timeoutDest || '',
    invalidDestType: ivr.invalidDestType || 'Hangup',
    invalidDest: ivr.invalidDest || '',
    options,
    enabled: ivr.enabled,
  };
}

function ivrToBackend(data: Partial<IvrMenu>): any {
  const out: any = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.description !== undefined) out.description = data.description;
  if (data.greetingLong || data.greetingShort) {
    out.greeting = data.greetingLong || data.greetingShort;
  }
  if (data.timeout !== undefined) out.timeout = data.timeout;
  if (data.maxFailures !== undefined) out.maxFailures = data.maxFailures;
  if (data.maxTimeouts !== undefined) out.maxTimeouts = data.maxTimeouts;
  if (data.directDial !== undefined) out.directDial = data.directDial;
  if (data.timeoutDestType !== undefined) out.timeoutDestType = data.timeoutDestType;
  if (data.timeoutDest !== undefined) out.timeoutDest = data.timeoutDest;
  if (data.invalidDestType !== undefined) out.invalidDestType = data.invalidDestType;
  if (data.invalidDest !== undefined) out.invalidDest = data.invalidDest;
  if (data.options) {
    out.entries = data.options.map((o) => ({
      digit: o.digit,
      action: o.action,
      param: o.param,
      description: o.description,
    }));
  }
  return out;
}

export const getIvr = (): Promise<{ ivrs: IvrMenu[]; destinations: { queues: any[]; extensions: any[]; ivrs: any[] } }> =>
  api.get('/ivr').then(r => ({
    ...r.data,
    ivrs: (r.data.ivrs || []).map(mapIvr),
  }));

export const createIvr = (data: Partial<IvrMenu>): Promise<{ success: boolean }> =>
  api.post('/ivr', ivrToBackend(data)).then(r => r.data);

export const updateIvr = (name: string, data: Partial<IvrMenu>): Promise<{ success: boolean }> =>
  api.put(`/ivr/${name}`, ivrToBackend(data)).then(r => r.data);

export const deleteIvr = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/ivr/${name}`).then(r => r.data);

export const toggleIvr = (name: string, enabled: boolean): Promise<{ success: boolean }> =>
  api.put(`/ivr/${name}/toggle`, { enabled }).then(r => r.data);

// ─── Ring Groups ──────────────────────────────────────────────────────────────

export const getRingGroups = (): Promise<RingGroup[]> =>
  api.get('/ringgroups').then(r => r.data.ringGroups || []);

export const createRingGroup = (data: Partial<RingGroup>): Promise<{ success: boolean }> =>
  api.post('/ringgroups', data).then(r => r.data);

export const updateRingGroup = (name: string, data: Partial<RingGroup>): Promise<{ success: boolean }> =>
  api.put(`/ringgroups/${name}`, data).then(r => r.data);

export const deleteRingGroup = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/ringgroups/${name}`).then(r => r.data);

// ─── Routing ──────────────────────────────────────────────────────────────────

function mapInboundRoute(r: any): InboundRoute {
  const hasBackendShape = r.destinationTarget !== undefined;
  return {
    id: r.id,
    name: r.name,
    did: r.did,
    destinationType: hasBackendShape ? (r.destination || 'extension') : (r.destinationType || 'extension'),
    destination: hasBackendShape ? (r.destinationTarget || '') : (r.destination || ''),
    enabled: r.enabled,
    description: r.description,
  };
}

function mapOutboundRoute(r: any): OutboundRoute {
  return {
    id: r.id,
    name: r.name,
    pattern: r.pattern,
    trunkName: r.trunkName,
    callerIdName: r.callerIdName,
    callerIdNumber: r.callerIdNumber,
    enabled: r.enabled,
  };
}

function routingToBackend(data: Partial<RoutingConfig>): any {
  const out: any = { ...data };
  if (data.inboundRoutes) {
    out.inboundRoutes = data.inboundRoutes.map((r) => ({
      ...r,
      destination: r.destinationType,
      destinationTarget: r.destination,
    }));
  }
  return out;
}

export const getRoutingConfig = (): Promise<{ config: RoutingConfig; trunks: Trunk[]; queues: Queue[] }> =>
  api.get('/routing/config').then(r => {
    const config = r.data.config || {};
    return {
      ...r.data,
      config: {
        ...config,
        inboundRoutes: (config.inboundRoutes || []).map(mapInboundRoute),
        outboundRoutes: (config.outboundRoutes || []).map(mapOutboundRoute),
      },
    };
  });

export const saveRoutingConfig = (data: Partial<RoutingConfig>): Promise<{ success: boolean }> =>
  api.put('/routing/config', routingToBackend(data)).then(r => r.data);

// ─── Time Conditions ─────────────────────────────────────────────────────────

export const getTimeConditions = (): Promise<TimeCondition[]> =>
  api.get('/time-conditions').then(r => r.data.conditions || []);

export const createTimeCondition = (data: Partial<TimeCondition>): Promise<{ success: boolean }> =>
  api.post('/time-conditions', data).then(r => r.data);

export const updateTimeCondition = (name: string, data: Partial<TimeCondition>): Promise<{ success: boolean }> =>
  api.put(`/time-conditions/${name}`, data).then(r => r.data);

export const deleteTimeCondition = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/time-conditions/${name}`).then(r => r.data);

// ─── Voicemail ────────────────────────────────────────────────────────────────

function mapVoicemail(v: any): VoicemailBox {
  const mc = v.messageCount;
  return {
    id: v.id || v.uuid || '',
    extension: v.extension,
    password: v.password,
    email: v.email,
    description: v.description,
    enabled: v.enabled,
    attachFile: v.attachFile,
    deleteAfterEmail: v.deleteAfterEmail,
    messageCount: typeof mc === 'number' ? mc : ((mc?.new ?? 0) + (mc?.saved ?? 0)),
  };
}

export const getVoicemail = (): Promise<VoicemailBox[]> =>
  api.get('/voicemail').then(r => (r.data.mailboxes || []).map(mapVoicemail));

export const createVoicemail = (data: Partial<VoicemailBox>): Promise<{ success: boolean; uuid?: string }> =>
  api.post('/voicemail', data).then(r => r.data);

export const updateVoicemail = (ext: string, data: Partial<VoicemailBox>): Promise<{ success: boolean }> =>
  api.put(`/voicemail/${ext}`, data).then(r => r.data);

export const deleteVoicemail = (ext: string): Promise<{ success: boolean }> =>
  api.delete(`/voicemail/${ext}`).then(r => r.data);

export const getVoicemailMessages = (ext: string): Promise<any[]> =>
  api.get(`/voicemail/${ext}/messages`).then(r => r.data.messages || []);

export const deleteVoicemailMessage = (uuid: string): Promise<{ success: boolean }> =>
  api.delete(`/voicemail/messages/${uuid}`).then(r => r.data);

export const uploadVoicemailGreeting = (ext: string, file: File, type: string): Promise<{ success: boolean }> => {
  const form = new FormData();
  form.append('file', file);
  form.append('type', type);
  return api.post(`/voicemail/${ext}/greeting`, form).then(r => r.data);
};

// ─── Conferences ─────────────────────────────────────────────────────────────

export const getConferences = (): Promise<Conference[]> =>
  api.get('/conferences').then(r => r.data.conferences || []);

export const createConference = (data: Partial<Conference>): Promise<{ success: boolean }> =>
  api.post('/conferences', data).then(r => r.data);

export const deleteConference = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/conferences/${name}`).then(r => r.data);

export const kickConferenceMember = (name: string, memberId: string): Promise<{ success: boolean }> =>
  api.post(`/conferences/${name}/members/${memberId}/kick`).then(r => r.data);

export const muteConferenceMember = (name: string, memberId: string): Promise<{ success: boolean }> =>
  api.post(`/conferences/${name}/members/${memberId}/mute`).then(r => r.data);

export const unmuteConferenceMember = (name: string, memberId: string): Promise<{ success: boolean }> =>
  api.post(`/conferences/${name}/members/${memberId}/unmute`).then(r => r.data);

// ─── Fax ─────────────────────────────────────────────────────────────────────

export const getFax = (): Promise<FaxConfig[]> =>
  api.get('/fax').then(r => r.data.fax || []);

export const createFax = (data: Partial<FaxConfig>): Promise<{ success: boolean; uuid?: string }> =>
  api.post('/fax', data).then(r => r.data);

export const updateFax = (ext: string, data: Partial<FaxConfig>): Promise<{ success: boolean }> =>
  api.put(`/fax/${ext}`, data).then(r => r.data);

export const deleteFax = (ext: string): Promise<{ success: boolean }> =>
  api.delete(`/fax/${ext}`).then(r => r.data);

export const getFaxFiles = (ext: string, type: 'inbox' | 'outbox'): Promise<any[]> =>
  api.get(`/fax/${ext}/${type}`).then(r => r.data.files || []);

export const deleteFaxFile = (ext: string, filename: string, type: 'inbox' | 'outbox'): Promise<{ success: boolean }> =>
  api.delete(`/fax/${ext}/files/${filename}`, { params: { type } }).then(r => r.data);

export const sendFax = (ext: string, destination: string, header: string, file: File): Promise<{ success: boolean }> => {
  const form = new FormData();
  form.append('file', file);
  form.append('destination', destination);
  form.append('header', header);
  return api.post(`/fax/${ext}/send`, form).then(r => r.data);
};

// ─── Music on Hold ────────────────────────────────────────────────────────────

export const getMoh = (): Promise<MohClass[]> =>
  api.get('/moh').then(r => r.data.classes || []);

export const createMoh = (data: Partial<MohClass>): Promise<{ success: boolean }> =>
  api.post('/moh', data).then(r => r.data);

export const updateMoh = (name: string, data: Partial<MohClass>): Promise<{ success: boolean }> =>
  api.put(`/moh/${name}`, data).then(r => r.data);

export const deleteMoh = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/moh/${name}`).then(r => r.data);

export const uploadMohFile = (className: string, file: File): Promise<{ success: boolean; filename?: string }> => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/moh/${className}/upload`, form).then(r => r.data);
};

export const deleteMohFile = (className: string, filename: string): Promise<{ success: boolean }> =>
  api.delete(`/moh/${className}/files/${filename}`).then(r => r.data);

// ─── Recordings ───────────────────────────────────────────────────────────────

export const getRecordings = (): Promise<Recording[]> =>
  api.get('/recordings').then(r => r.data.recordings || []);

export const uploadRecording = (file: File, name: string): Promise<{ success: boolean }> => {
  const form = new FormData();
  form.append('file', file);
  form.append('name', name);
  return api.post('/recordings/upload', form).then(r => r.data);
};

export const deleteRecording = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/recordings/${name}`).then(r => r.data);

// ─── CDR ──────────────────────────────────────────────────────────────────────

export interface CdrFilters {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  src?: string;
  dst?: string;
  disposition?: string;
  minDuration?: number;
}

function mapCdr(r: any): CdrRecord {
  return {
    uuid: r.uuid || r.uniqueid || '',
    callDate: r.callDate || r.calldate || '',
    src: r.src,
    dst: r.dst,
    duration: r.duration,
    billsec: r.billsec,
    disposition: r.disposition,
    callerIdName: r.callerIdName || r.clid || '',
    direction: r.direction || '',
    hasRecording: !!r.hasRecording || !!r.recording_file,
  };
}

export const getCdr = (filters: CdrFilters): Promise<{ records: CdrRecord[]; total: number }> =>
  api.get('/cdr', { params: filters }).then(r => ({
    records: (r.data.records || []).map(mapCdr),
    total: r.data.total || 0,
  }));

export const getCdrSummary = (params: { startDate?: string; endDate?: string; days?: number }): Promise<CdrSummary> =>
  api.get('/cdr/summary', { params }).then(r => r.data.summary);

export const getCdrTopCallers = (params: { startDate?: string; endDate?: string; days?: number; limit?: number }): Promise<any[]> =>
  api.get('/cdr/top-callers', { params }).then(r => r.data.topCallers || []);

// ─── Blacklist ────────────────────────────────────────────────────────────────

export const getBlacklist = (): Promise<BlacklistEntry[]> =>
  api.get('/blacklist').then(r => r.data.entries || []);

export const addBlacklist = (data: { number: string; reason?: string }): Promise<{ success: boolean }> =>
  api.post('/blacklist', data).then(r => r.data);

export const removeBlacklist = (number: string): Promise<{ success: boolean }> =>
  api.delete(`/blacklist/${number}`).then(r => r.data);

export const bulkBlacklist = (numbers: { number: string; reason?: string }[]): Promise<{ success: boolean }> =>
  api.post('/blacklist/bulk', { numbers }).then(r => r.data);

// ─── SIP Profiles ─────────────────────────────────────────────────────────────

function mapSipProfile(p: any): SipProfile {
  return {
    ...p,
    state: p.state || p.status || 'unknown',
    enabled: p.enabled ?? (p.status === 'running'),
  };
}

export const getSipProfiles = (): Promise<SipProfile[]> =>
  api.get('/sip-profiles').then(r => (r.data.profiles || []).map(mapSipProfile));

export const updateSipProfile = (name: string, data: Partial<SipProfile>): Promise<{ success: boolean }> =>
  api.put(`/sip-profiles/${name}`, data).then(r => r.data);

export const toggleSipProfile = (name: string, enabled: boolean): Promise<{ success: boolean }> =>
  api.post(`/sip-profiles/${name}/toggle`, { enabled }).then(r => r.data);

// ─── Scripts ──────────────────────────────────────────────────────────────────

export const getScripts = (): Promise<Script[]> =>
  api.get('/scripts').then(r => r.data.scripts || []);

export const createScript = (data: Partial<Script>): Promise<{ success: boolean }> =>
  api.post('/scripts', data).then(r => r.data);

export const updateScript = (name: string, data: Partial<Script>): Promise<{ success: boolean }> =>
  api.put(`/scripts/${name}`, data).then(r => r.data);

export const deleteScript = (name: string): Promise<{ success: boolean }> =>
  api.delete(`/scripts/${name}`).then(r => r.data);

export const testScript = (name: string): Promise<{ success: boolean; output?: string; error?: string }> =>
  api.post(`/scripts/${name}/test`).then(r => r.data);

// ─── Backups ──────────────────────────────────────────────────────────────────

export const getBackups = (): Promise<Backup[]> =>
  api.get('/backups').then(r => r.data.backups || []);

export const createBackup = (): Promise<{ success: boolean; backupId?: string; filename?: string }> =>
  api.post('/backups').then(r => r.data);

export const restoreBackup = (id: string): Promise<{ success: boolean }> =>
  api.post(`/backups/${id}/restore`).then(r => r.data);

export const deleteBackup = (id: string): Promise<{ success: boolean }> =>
  api.delete(`/backups/${id}`).then(r => r.data);

// ─── Dialplan ─────────────────────────────────────────────────────────────────

export const getDialplanContexts = (): Promise<{ name: string; extensionCount: number }[]> =>
  api.get('/dialplan').then(r => r.data.contexts || []);

export const getDialplanContext = (context: string): Promise<{ entries: any[]; rawContent: string }> =>
  api.get(`/dialplan/${context}`).then(r => r.data);
