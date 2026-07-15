# Feature Inventory & Status

Last reviewed: 2026-04-29

## Core Features

### 1. Fleet Tracking Map
- **Status**: Active
- **Files**: `src/features/dashboard/Dashboard.tsx`, `src/features/tracking-wall/`, `src/hooks/useVehicles.ts`
- **Backend**: `/api/vehicles`, PostgreSQL cache (synced from MSSQL)
- **GPS data**: Leaflet + MapLibre, real-time positions via polling
- **Sub-features**: Vehicle search, vehicle detail panel, track history, geofences, alerts on map

### 2. Alert Distribution Engine
- **Status**: Active (complex system)
- **Files**: `server/routes/distribution.ts`, `server/db/alertDistribution.ts`, `server/services/distributionEngine.ts`
- **Backend**: `/api/distribution/*`
- **Sub-features**:
  - Agent inbox (assigned alerts)
  - Acknowledge / resolve / escalate alerts
  - Distribution rules (configurable)
  - Alert type configuration (dynamic filter)
  - Supervisor bulk-dismiss
  - Agent performance metrics
  - Shift scheduling
  - Alert comments
  - Vehicle context lookup (CRM special instructions)
  - CRM log insert (writes back to MSSQL ERP_Tracking)
  - Global alert search
  - Alert history / audit trail

### 3. Softphone (WebRTC / Click-to-Call)
- **Status**: Active (two modes)
- **Files**: `src/services/sip.ts`, `src/store/callStore.ts`, `src/features/softphone/Softphone.tsx`
- **Mode 1 (WebRTC)**: SIP.js → /ws/sip proxy → FreeSWITCH WSS:7443 (internal.xml profile, wss-binding :7443)
- **Mode 2 (AMI)**: Click-to-call via `/api/calls/originate`, ESL originates call to agent's extension then dials outbound
- **FS SIP profile for agents**: `internal.xml` — port 5060, ws :5066, wss :7443, auth-calls=true, context=default, codecs OPUS/PCMU/PCMA/G722
- **Sub-features**: Dial, answer, reject, hangup, mute, hold (server-side MOH via `tavl_moh` stream), transfer, DTMF, call history (localStorage)

### 4. 3-Way Conference
- **Status**: Active
- **Flow**: Agent on call → POST /api/calls/conference/start → FS moves both legs into ConfBridge room → ESL originates 3rd party
- **Participant polling**: Frontend polls `/api/calls/conference/:room/participants` every 2s

### 5. Screen Pop
- **Status**: Active
- **Trigger 1 (ESL)**: FreeSWITCH CHANNEL_CREATE inbound → ESL emits `inboundCall` → server CRM lookup → WS broadcast `screenPop`
- **Trigger 2 (SIP.js)**: Incoming INVITE on browser → `callStore` calls `screenPopByPhone()` → searches vehicle → opens detail panel on map
- **CRM lookup**: Normalizes Pakistani numbers (strips +92/92/leading 0), searches CUSTOMER table on CONT1/CONT2
- **Inbound DID flow (FS)**: DID 2138650302 via trunk-itsp → public.xml → answer → record → play `r2_session.wav` (queue greeting MOH stream) → callcenter `tavl-agents`

### 6. CDR (Call Detail Records)
- **Status**: Active
- **Source**: FusionPBX PostgreSQL `v_xml_cdr` table on 192.168.20.140/fusionpbx (158 records as of 2026-04-29)
- **Files**: `server/routes/cdr.ts`
- **Recordings path on FS**: `/usr/local/freeswitch/recordings/archive/` (141 .wav files at survey time)
- **Recording playback**: SSH + SCP from FS to `/tmp/` on TAVL server, then stream to browser. Deletes tmp file after stream.
- **Sub-features**: Paginated CDR list, stats, hourly breakdown, recording playback (SSH/SCP), CSV export, wallboard, queue stats, call monitoring

### 7. Call Monitoring (Spy/Whisper/Barge)
- **Status**: Active
- **Backend**: `/api/cdr/monitor` → ESL `originateCall` with `&eavesdrop()` application
- **Modes**: spy (silent), whisper (agent-only), barge (both)

### 8. Queue Management
- **Status**: Active
- **Queues on FS**: Only `tavl-agents` queue confirmed on FreeSWITCH (round-robin, max-wait 0, agent-no-answer → On Break)
- **Note**: `uan-queue` is referenced in code but not found in FS callcenter.conf.xml at survey time — may be a planned queue or removed
- **Auto-join on login**: Agents auto-join queues when logging into distribution system
- **Auto-leave on logout**: Removed from queues on logout/WS close
- **Static agents in FS config**: extensions 111, 222, 999 (dynamic agents also added at runtime)

### 9. PBX Admin (V1 - SSH-based)
- **Status**: Active but fragile (depends on SSH + sshpass)
- **Files**: `src/features/pbx-admin/`, `server/routes/pbx-admin.ts`, `server/services/asterisk-config.ts`
- **Pages**: Dashboard, Extensions, Trunks, Queues, Queue Monitor, Ring Groups, Conferences, Routing, IVR, MOH, Time Conditions, Voicemail, Fax, CDR, Blacklist, SIP Profiles, Scripts, Backup, System
- **Auth**: Separate login (not shared with main app)
- **Data source**: `pbx_admin` PostgreSQL DB on 192.168.20.140 (15 tables: 118 extensions, 3 gateways, 1 domain)
- **Config changes**: Writes via SSH to `/usr/local/freeswitch/conf/` then reloads via `fs_cli reloadxml`
- **SSH target**: 192.168.20.140, user iteckadmin, `sshpass` with password from env, `sudo` for file writes
- **FS config paths managed**: `conf/directory/192.168.20.140/*.xml`, `conf/dialplan/`, `conf/sip_profiles/`, `conf/autoload_configs/`

### 10. PBX Admin V2
- **Status**: In development
- **Files**: `src/features/pbx-admin-v2/`
- **Difference from V1**: Modern DB-backed (no SSH for config reads), cleaner API

### 11. Supervisor Dashboard
- **Status**: Active
- **Files**: `src/features/supervisor/`
- **Sub-features**: Agent list + status, alert escalation view, pending alerts, distribution stats, call monitoring

### 12. Robocall / Auto-Call
- **Status**: Active
- **Files**: `server/routes/robocall.ts`, `server/routes/autocall.ts`
- **Backend**: ESL `originateAutoCall()` → FreeSWITCH via trunk `trunk-robocall` → context `tavl-autocall`
- **Caller ID**: `AUTOCALL_CALLERID` env var (02138658849)
- **IVR flow (tavl-autocall context)**: plays `/usr/local/freeswitch/sounds/custom/iteck-greeting.wav` → waits 1 DTMF digit (30s) → DTMF 0 → callcenter `tavl-agents`
- **Trunk**: `trunk-robocall` via external profile → gateway 10.200.174.222:5060 (no registration)

### 13. Tracking Wall & Analytics Wall
- **Status**: Active
- **Auth**: NONE (public endpoints for video wall displays)
- **Files**: `src/features/tracking-wall/`, `src/features/analytics-wall/`

### 14. Stolen Vehicle Tracking
- **Status**: Active
- **Files**: `server/routes/stolenTracking.ts`, `server/services/stolenTrackingUpdater.ts`
- **Table**: Custom table in PostgreSQL (Tracking DB)

### 15. Closure (Vehicle Closure Operations)
- **Status**: Active
- **Files**: `server/routes/closure.ts`

### 16. Customer App API
- **Status**: Active
- **Files**: `server/routes/customerApp.ts`
- **Purpose**: API endpoints for the mobile customer app

### 17. Analytics
- **Status**: Active
- **Files**: `server/routes/analytics.ts`
- **Background refresh**: Runs on schedule, caches results

### 18. Reverse Geocoding
- **Status**: Active
- **Internal Nominatim server**: 192.168.20.186:8090
- **Proxy**: `/api/geocode/reverse` (avoids browser CORS)

---

## Infrastructure Features

### Cache Sync (MSSQL → PostgreSQL)
- **File**: `server/db/cacheSync.ts`
- **Purpose**: Keeps PG cache warm so frontend queries are fast even if MSSQL is slow
- **Schedule**: Runs on startup + periodic sync
- **Volume**: 100K+ records possible (takes 30–120s on cold start)

### Stale Agent Monitor
- Runs every 120s, marks agents offline if no heartbeat for 2+ minutes AND no active WS connection

### Timeout Monitor
- **File**: `server/services/timeoutMonitor.ts`
- **Purpose**: Auto-escalates alerts that exceed time limits

### WebSocket Ping/Pong
- Server pings all WS clients every 30s; disconnects if no pong (handles laptop sleep / network drops)

---

## Known Gaps & Issues (as of 2026-04-29)
See `docs/KNOWN_ISSUES.md` for detailed tracking.

1. **PBX Admin V1 is SSH-dependent** — fragile, sshpass is a security concern
2. **CDR recording playback uses SSH/SCP** — slow, requires sshpass installed on server
3. **No authentication on most API routes** — distribution routes use header-based userId, not JWT
4. **Race condition: double screen pop** — both ESL event and SIP.js `incomingCall` can both trigger screen pop
5. **Conference polling** — currently polls every 2s (manual), should be WS-pushed
6. **`callStore.ts` uses `alert()`** — blocks UI for errors, should use toast system
7. **MSSQL vehicle IDs in SQL strings** — `vehicleIds.join(',')` in calls.ts (potential injection if ids not integers)
8. **`sshExec` escaping** — `asterisk-config.ts` sshExec has unsafe content escaping (`echo "${escapedContent}"`)
9. **Many debug `.ts` files in root** — 50+ check_*.ts, fix_*.ts, test_*.ts files should be cleaned up
10. **Two PBX admin systems** — V1 and V2 are both active, creating maintenance confusion
