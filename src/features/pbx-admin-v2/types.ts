// Shared TypeScript interfaces for PBX Admin V2
// All types match the v1 backend API response shapes at /api/pbx-admin/*

export interface Extension {
  id: string;          // extension_uuid
  extension: string;   // e.g. "1001"
  password: string;
  context: string;
  callerIdName: string;
  callerIdNumber: string;
  email?: string;
  status: 'online' | 'offline' | 'busy' | 'away';
  registered: boolean;
  contact?: string;
  webRtcEnabled?: boolean;
  voicemailEnabled?: boolean;
  ringDuration?: number;
  callForwardEnabled?: boolean;
  callForwardDest?: string;
  dnd?: boolean;
  transport?: string;
  codecs?: string[];
  maxContacts?: number;
  dtmfMode?: string;
  natEnabled?: boolean;
  callRecording?: 'all' | 'inbound' | 'outbound' | 'local' | 'disabled';
}

export interface Trunk {
  id?: string;
  name: string;
  proxy: string;
  port?: number;
  username?: string;
  password?: string;
  register: boolean;
  callerIdName?: string;
  callerIdNumber?: string;
  context?: string;
  enabled?: boolean;
  profile?: string;
  description?: string;
  state?: string;
  callsIn?: number;
  callsOut?: number;
  totalCalls?: number;
}

export interface Queue {
  id?: string;
  name: string;
  extension?: string;
  strategy: string;
  mohSound?: string;
  announceSound?: string;
  announceFrequency?: number;
  timeout?: number;
  maxWaitTime?: number;
  announcePosition?: boolean;
  leaveWhenEmpty?: string;
  joinWhenEmpty?: boolean;
  members?: QueueMember[];
  description?: string;
  waiting?: number;
  agents?: number;
  activeCalls?: number;
  greeting?: string;
}

export interface QueueMember {
  extension: string;
  name?: string;
  status?: string;
  online?: boolean;
  callsTaken?: number;
}

export interface IvrMenu {
  id?: string;
  name: string;
  description?: string;
  greetingShort?: string;
  greetingLong?: string;
  timeout?: number;
  maxFailures?: number;
  maxTimeouts?: number;
  digitTimeout?: number;
  directDial?: boolean;
  timeoutDest?: string;
  timeoutDestType?: string;
  invalidDest?: string;
  invalidDestType?: string;
  options?: IvrOption[];
  enabled?: boolean;
}

export interface IvrOption {
  digit: string;
  description?: string;
  action: string;
  param: string;
}

export interface RingGroup {
  id?: string;
  name: string;
  extension?: string;
  strategy?: string;
  timeout?: number;
  description?: string;
  members?: RingGroupMember[];
  noAnswerDest?: string;
  noAnswerDestType?: string;
  cidPrefix?: string;
}

export interface RingGroupMember {
  extension: string;
  delay?: number;
  timeout?: number;
}

export interface TimeCondition {
  id?: string;
  name: string;
  extension?: string;
  description?: string;
  enabled?: boolean;
  conditions?: TimeRange[];
  destinationMatch?: string;
  destinationMismatch?: string;
}

export interface TimeRange {
  type: 'weekday' | 'time' | 'date';
  days?: string[];
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
}

export interface VoicemailBox {
  id?: string;
  extension: string;
  password?: string;
  email?: string;
  description?: string;
  enabled?: boolean;
  attachFile?: boolean;
  deleteAfterEmail?: boolean;
  messageCount?: number;
}

export interface VoicemailMessage {
  uuid: string;
  duration?: number;
  date?: string;
  from?: string;
  folder?: string;
  read?: boolean;
}

export interface Conference {
  id?: string;
  name: string;
  extension?: string;
  pin?: string;
  adminPin?: string;
  maxMembers?: number;
  record?: boolean;
  waitMod?: boolean;
  members?: ConferenceMember[];
}

export interface ConferenceMember {
  id: string;
  name?: string;
  number?: string;
  muted?: boolean;
  floor?: boolean;
  hear?: boolean;
  speak?: boolean;
  energy?: number;
}

export interface FaxConfig {
  id?: string;
  extension: string;
  name?: string;
  email?: string;
  callerIdNumber?: string;
  callerIdName?: string;
  description?: string;
  enabled?: boolean;
  inboxCount?: number;
  outboxCount?: number;
}

export interface MohClass {
  id?: string;
  name: string;
  mode?: string;
  shuffle?: boolean;
  channels?: number;
  rate?: number;
  directory?: string;
  files?: MohFile[];
}

export interface MohFile {
  name: string;
  size?: number;
  path?: string;
}

export interface Recording {
  id?: string;
  name: string;
  filename: string;
  url?: string;
}

export interface CdrRecord {
  uuid: string;
  callDate?: string;
  src?: string;
  dst?: string;
  duration?: number;
  billsec?: number;
  disposition?: string;
  direction?: string;
  hasRecording?: boolean;
  callerIdName?: string;
  destCallerIdName?: string;
  answeredAt?: string;
}

export interface CdrSummary {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  busyCalls: number;
  failedCalls: number;
  totalDuration: number;
  avgDuration: number;
  answerRate: number;
}

export interface BlacklistEntry {
  id?: string;
  number: string;
  reason?: string;
  createdAt?: string;
}

export interface SipProfile {
  name: string;
  enabled?: boolean;
  state?: string;
  registrations?: number;
  calls?: number;
  settings?: Record<string, string>;
}

export interface Script {
  name: string;
  type: string;
  description?: string;
  enabled?: boolean;
  content?: string;
  lastModified?: string;
  size?: number;
}

export interface Backup {
  id: string;
  filename: string;
  size?: number;
  created?: string;
  status?: string;
  files?: string[];
}

export interface SystemStatus {
  host?: string;
  version?: string;
  uptime?: string;
  activeCalls?: number;
  peakSessions?: number;
  maxSessions?: number;
  registeredEndpoints?: number;
  lastReload?: string;
}

export interface RoutingConfig {
  inboundRoutes: InboundRoute[];
  outboundRoutes: OutboundRoute[];
  internalPatterns?: any[];
  featureCodes?: any[];
}

export interface InboundRoute {
  id?: string;
  name: string;
  did?: string;
  destination: string;
  destinationType: 'queue' | 'extension' | 'ivr' | 'ringgroup';
  enabled?: boolean;
  description?: string;
}

export interface OutboundRoute {
  id?: string;
  name: string;
  pattern: string;
  trunkName?: string;
  callerIdName?: string;
  callerIdNumber?: string;
  enabled?: boolean;
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}
