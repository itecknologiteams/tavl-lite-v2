# CLAUDE.md — iTecknologi Command Center (ICC) / TAVL Lite v2

## What This App Does
Full-stack command center for a fleet GPS tracking + call center company (iTecknologi, Pakistan).
Agents monitor vehicle alerts on a map, receive inbound calls with automatic CRM screen pops, and manage customer issues. Supervisors monitor agents, listen in on calls, and manage alert distribution.

---

## Tech Stack
| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Zustand, TanStack Query, SIP.js, Leaflet/MapLibre |
| Backend | Node.js, Express.js, TypeScript (`tsx watch`) |
| Real-time | WebSocket (`ws` library, noServer mode), FreeSWITCH ESL (`modesl`) |
| Databases | PostgreSQL (primary), MSSQL (CRM + Tracking source), FusionPBX PG, PBX Admin PG |
| Telephony | FreeSWITCH @ 192.168.20.140 (replaced Asterisk) |
| Build | Vite (frontend), `tsx` (server dev), `tsc + vite build` (prod) |

---

## Dev Commands
```bash
npm run dev          # Both frontend (5173 HTTPS) + backend (3001) concurrently
npm run server:dev   # Backend only (tsx watch server/index.ts)
npm run web:dev      # Frontend only (vite)
npm run build        # tsc + vite build → dist/
npm start            # Production server (tsx server/index.ts)
```

---

## Key Environment Variables (see .env)
```
FREESWITCH_HOST=192.168.20.140        # FreeSWITCH server
FREESWITCH_ESL_PORT=8021              # ESL socket
FREESWITCH_ESL_PASSWORD=ClueCon
FREESWITCH_WSS_PORT=7443              # SIP WebSocket (TLS)
FREESWITCH_SSH_USER=iteckadmin

PG_HOST=192.168.20.186 / PG_DATABASE=Tracking   # Primary tracking PG
FUSIONPBX_PG_DATABASE=fusionpbx                 # CDR data
PBX_ADMIN_PG_DATABASE=pbx_admin                 # Custom PBX admin DB

DB_SERVER=192.168.20.253 / DB_NAME=tavl2        # MSSQL vehicle source
CRM_SERVER=192.168.21.33 / CRM_NAME=ERP_Tracking # CRM (customers, vehicles)

AUTOCALL_QUEUE=tavl-agents
AUTOCALL_CALLERID=02138658849
FREESWITCH_TRUNK=trunk-robocall
```

---

## Frontend Routes
| Path | Component | Auth |
|---|---|---|
| `/login` | LoginScreen | Public |
| `/agent` | Dashboard | agent / operator only |
| `/supervisor` | SupervisorDashboard | supervisor / admin only |
| `/tracking-wall` | TrackingWall | **Public** (video wall) |
| `/analytics-wall` | AnalyticsWall | **Public** (video wall) |
| `/pbx-admin/*` | PBX Admin (V1) | Separate auth |
| `/pbx-admin-v2/*` | PBX Admin (V2) | Separate auth |

---

## Backend API Routes (`server/routes/`)
| Mount | File | Purpose |
|---|---|---|
| `/api/auth` | auth.ts | CRM-backed login |
| `/api/vehicles` | vehicles.ts | GPS + vehicle search |
| `/api/alerts` | alerts.ts | Vehicle alerts |
| `/api/crm` | crm.ts | Customer/CRM data |
| `/api/track` | track.ts | Historical track |
| `/api/calls` | calls.ts | Call management (ESL: originate, hangup, hold, transfer, conference, queue) |
| `/api/supervisor` | supervisor.ts | Supervisor actions |
| `/api/commands` | commands.ts | GPRS commands |
| `/api/robocall` | robocall.ts | Robocall campaigns |
| `/api/customer-app` | customerApp.ts | Mobile customer API |
| `/api/distribution` | distribution.ts | Alert distribution engine (LARGE: agent sessions, alert assign/ack/resolve/escalate, rules, perf, shifts) |
| `/api/closure` | closure.ts | Vehicle closure ops |
| `/api/stolen-tracking` | stolenTracking.ts | Stolen vehicle tracking |
| `/api/analytics` | analytics.ts | System analytics |
| `/api/autocall` | autocall.ts | Automated call campaigns |
| `/api/cdr` | cdr.ts | CDR records, wallboard, recording playback via SSH/SCP |
| `/api/pbx-admin` | pbx-admin.ts | Full PBX admin (LARGE: extensions, trunks, queues, IVR, MOH, routing, etc.) |
| `/api/geocode/reverse` | inline | Nominatim proxy at 192.168.20.186:8090 |
| `/api/health` | inline | Readiness check |

---

## Database Layer (`server/db/`)
| File | Database | Purpose |
|---|---|---|
| `postgres.ts` | PG @ 192.168.20.186 / Tracking | PRIMARY: GPS cache, alert_assignments, agent_sessions |
| `fusionpbx.ts` | PG @ 192.168.20.140 / fusionpbx | CDR (v_xml_cdr table) |
| `pbx-admin-db.ts` | PG @ 192.168.20.140 / pbx_admin | Custom PBX admin (extensions, trunks, etc.) |
| `tavl.ts` | MSSQL @ 192.168.20.253 / tavl2 | Vehicle tracking source |
| `crm.ts` | MSSQL @ 192.168.21.33 / ERP_Tracking | Customers, vehicles, CRM |
| `command.ts` | MSSQL @ 192.168.21.33 / tavl2 | GPRS command DB |
| `alertDistribution.ts` | PG (via postgres.ts) | Alert assignment tables, agent sessions, performance |
| `cacheSync.ts` | MSSQL→PG | Syncs MSSQL vehicle data to PG cache |
| `mobileApp.ts` | PG | Mobile app data |
| `tracking.ts` | PG | GPS tracking records |

**IMPORTANT**: All PG connections set `timezone = 'Asia/Karachi'` (PKT, UTC+5) because source MSSQL stores local PKT timestamps.

---

## Telephony / SIP Architecture

```
Browser (SIP.js WebRTC)
  ↕ WSS /ws/sip
TAVL Server (proxy)
  ↕ WSS :7443
FreeSWITCH @ 192.168.20.140
```

- **ESL Connection** (`server/freeswitch/esl.ts`): Singleton `EslConnection extends EventEmitter`. Connects to FS ESL on port 8021. Auto-reconnects every 10s on drop.
- **Events emitted**: `inboundCall`, `callEvent`, `callBridged`
- **Screen Pop flow**: `CHANNEL_CREATE` → filter inbound from-trunk → emit `inboundCall` → `server/index.ts` handler → CRM SQL lookup → `broadcast('screenPop', data)`
- **Dedup key**: Last 10 digits of caller number, 2-minute TTL

---

## FreeSWITCH Server Ground Truth (surveyed 2026-04-29)

**Version**: FreeSWITCH 1.10.12 (git 46f8a2e6 2024-06-01), UP ~11 days at time of survey

### SIP Profiles
| Profile file | Port | Binding | Context | Auth | Purpose |
|---|---|---|---|---|---|
| `internal.xml` | 5060 | ws :5066, wss :7443 | default | Yes | Internal extensions (WebRTC agents) |
| `wan.xml` | 5060 | 172.25.99.34 | public | No | Inbound/outbound PSTN (trunk-itsp) |

Codecs (vars.xml): G7221, G722, PCMU, PCMA, OPUS

### SIP Trunks
| Name | Profile | Gateway IP | Registration | Caller ID / Notes |
|---|---|---|---|---|
| `trunk-itsp` | wan (external) | 10.200.173.116 | NOREG | from-user=02138650302 (main DID) |
| `trunk-robocall` | external | 10.200.174.222:5060 | No | Robocall outbound |
| `trunk-uan` | external | 10.200.174.223:5060 | No | UAN outbound |

### Dialplan Contexts
**`default` context** (verified 2026-05-11 via `xml_locate dialplan context name default`):
- Currently contains **only one extension**: `autocall_outbound_mobile` matching `^(0\d{10})$` → robocall outbound flow.
- **NO `conf_*` rule, NO `conference_admin` rule, NO simple extension-bridge rule.** Earlier docs claiming these existed were stale.
- ⚠️ Implication: any feature that does `uuid_transfer <uuid> <some_ext> XML default` will hang up the channel because nothing matches. Use `inline` dialplan with the application syntax instead (e.g. `uuid_transfer <uuid> conference:room@default inline`).

**`public` context** (inbound from PSTN via wan profile):
- DID `2138650302` → answer → record session → play `r2_session.wav` IVR greeting → callcenter `tavl-agents@192.168.20.140`

**`tavl-autocall` context** (robocall callback IVR):
- play `iteck-greeting.wav` → get DTMF (1 digit, 30s timeout) → DTMF `0` → callcenter `tavl-agents`

**`robocall-service` context** (internal robocall bridge):
- Internal bridge + outbound via UUID gateway `8229b757`

### Callcenter Queue (membership reconciled 2026-06-01)
- **Queue name**: `tavl-agents` (only one queue)
- **Strategy**: round-robin
- **max-wait-time**: 240; `max-wait-time-with-no-agent` 120; `…-time-reached` 5
- **agent-no-answer-status**: "On Break"
- **skip-agents-with-external-calls**: true
- **Legitimate agents**: extensions **449–468 EXCEPT 453 & 456** answer inbound queue calls; **999** kept as-is (robocall identity / not an answering agent in the app code — autocall originates via `trunk-robocall`, not ext 999). **453 & 456 are SUPERVISOR extensions — excluded from the queue (2026-06-04) so inbound calls are never offered to them.** This set is the single source of truth: `QUEUE_AGENT_EXTENSIONS` in `server/routes/distribution.ts` (449–468 minus 453/456, + 999).
- **Static agents in `callcenter.conf.xml`**: 449–468 + 999 minus 453/456 (each tiered to `tavl-agents`). Backups: `…/callcenter.conf.xml.bak-20260601`, and `…/callcenter.conf.xml.bak-20260604-supext` (before removing 453/456).
- **⚠️ Past bug (fixed 2026-06-01)**: orphaned runtime agents **111, 222** (FusionPBX-style UUID names; FusionPBX `v_call_center_agents` is empty) and static **400** were tiered to `tavl-agents` and rang on every inbound call. Removed via `callcenter_config tier del` + `agent del`, and `400` stripped from the XML. Executive extensions (e.g. 111/222/400) must never be queue agents.
- **Recurrence guard**: on ESL connect, `eslConnection.reconcileQueueAgents('tavl-agents', QUEUE_AGENT_EXTENSIONS)` (`server/freeswitch/esl.ts`, called from `server/index.ts`) removes any tier whose extension isn't allowlisted. `POST /api/calls/queue/login` (calls.ts) also rejects non-allowlisted extensions. Note: `queueRemoveMember` still only sets status `Logged Out` (keeps legit agents visible on the wallboard); it does **not** del the tier/agent — reconciliation handles strays.

### Directory
- **Domain**: `192.168.20.140` (UUID: `537fb643-...`)
- **Extension count**: 118 (each has its own XML file in `/usr/local/freeswitch/conf/directory/192.168.20.140/`)
- Sample extension 100: password=ad100da, name=Reception

### ESL Config
- **Listen**: `0.0.0.0:8021`, password `ClueCon`
- **ACL**: `rfc1918` (allows 192.168.x, 10.x, 172.16.x — all internal ranges)
- `disable_system_api_commands=true` (in vars.xml — blocks dangerous FS API commands)

### Recordings & MOH
- **Recordings archive**: `/usr/local/freeswitch/recordings/archive/` (141 .wav files at survey time)
- **Custom IVR sounds**: `/usr/local/freeswitch/sounds/custom/iteck-greeting.wav`
- **MOH streams** (local_stream.conf.xml):
  - `queue_greeting`: plays `moh.wav`, `r2_session.wav` (used while callers wait in queue)
  - `tavl_moh`: plays `tavl_moh.wav` (on-hold music for bridged calls)

### pbx_admin Database (at survey time)
- **Tables**: 15 (extensions, trunks, queues, ring_groups, ivr_menus, dialplan_routes, etc.)
- **Extensions**: 118 rows
- **Gateways**: 3 rows (trunk-itsp, trunk-robocall, trunk-uan)
- **Domains**: 1 row (UUID: 537fb643)

---

## Frontend State Management (`src/store/`)
| Store | Purpose |
|---|---|
| `authStore.ts` | User session (persisted to sessionStorage). On login: registers with distribution system |
| `callStore.ts` | Softphone state (WebRTC or AMI click-to-call), call history (localStorage), conference |
| `vehicleStore.ts` | Selected vehicle, vehicle list |
| `alertDistributionStore.ts` | Agent inbox, distribution session |
| `supervisorStore.ts` | Supervisor view state |
| `alarmStore.ts` | Alarm list |
| `trackStore.ts` | Track history |
| `layoutStore.ts` | UI layout |
| `toastStore.ts` | Toast notifications |

---

## Key Frontend Services (`src/services/`)
- `sip.ts` — `SipService` singleton. SIP.js WebRTC: register, call, answer, reject, hangup, mute, hold (via server), transfer, DTMF, conference. Auto-reconnect with exponential backoff (max 5 attempts).
- `api.ts` — Axios wrapper for REST API calls

---

## PBX Admin
**Two parallel systems exist**:
- **V1** (`/pbx-admin`): SSH-based, reads/writes FreeSWITCH config files directly, uses `sshpass`. Pages: Extensions, Trunks, Queues, Queue Monitor, Ring Groups, Conferences, Routing, IVR, MOH, Time Conditions, Voicemail, Fax, CDR, Blacklist, SIP Profiles, Scripts, Backup, System.
- **V2** (`/pbx-admin-v2`): Modern, uses `pbx_admin` PostgreSQL DB as source of truth.

V1 and V2 co-exist. V2 is the intended direction (DB-backed, no SSH for config). The SSH approach in V1 is fragile.

---

## Server Startup Sequence
1. HTTP listener binds immediately (eliminates ECONNREFUSED during warm-up)
2. PostgreSQL connects (5 retries, 3s delay) — fatal if unavailable
3. PBX Admin DB connects — non-fatal
4. FusionPBX DB connects — non-fatal
5. MSSQL (TAVL + CRM) connects — non-fatal (falls back to PG cache)
6. Schema init: `alert_assignments`, `stolen_tracking`, `autocall` tables
7. Clear stale agent sessions
8. **Background warm-up** (non-blocking):
   - FreeSWITCH ESL connect
   - Alert broadcaster start
   - Analytics refresh start
   - Cache sync (MSSQL → PG, can take 30–120s for 100K+ records)
9. `serverReady = true` → health endpoint returns 200

---

## WebSocket Events
Server broadcasts on `ws://host/ws`:

| Event | Direction | Payload |
|---|---|---|
| `identify` | client→server | `{ agentId }` — registers the WS connection |
| `heartbeat` | client→server | Keepalive; server replies `pong` |
| `screenPop` | server→all | Inbound call + CRM customer + vehicles |
| `callEvent` | server→all | FS channel state change |
| `callBridged` | server→all | FS bridge event |
| `agent:login/logout/status` | server→supervisors | Agent presence |
| `break:requested/approved/ended` | server→agent/supervisors | Break workflow |
| `alert:comment` | server→supervisors | New alert comment |
| `alertConfig:changed` | server→all | Alert type config updated |
| `agent:logout` | server→supervisors | WS closed → agent marked offline |

---

## Alert Distribution System
Located in `server/db/alertDistribution.ts` + `server/services/distributionEngine.ts` + `server/routes/distribution.ts`.

**Tables (in PG `Tracking` DB)**:
- `agent_sessions` — userId, username, role, status (online/offline/on_break/break_requested), current_alert_count, max_alerts
- `alert_assignments` — alert_id, alert_type, vehicle_reg, customer_name, assigned_to, status (pending/assigned/acknowledged/resolved/escalated/dismissed), timestamps, priority
- `alert_history` — audit trail of every alert action
- `agent_performance` — daily stats per agent
- `distribution_rules` — configurable routing rules
- `alert_type_configs` — which event names to create alerts for
- `shift_schedules` — agent shift windows
- `alert_comments` — per-alert comments

**Agent statuses**: `online`, `offline`, `on_break`, `break_requested`
**Alert resolution types** defined in `RESOLUTION_TYPES` constant.

**Routing logic** (`distributionEngine.ts → findBestAgent`):
1. Rules evaluated in priority order: `alert_type_routing` → `bank_routing` → `corporate_routing`
2. All agents referenced in ANY active rule are added to `dedicatedAgentIds`
3. If no rule matches, score-based fallback picks from agents NOT in `dedicatedAgentIds`
4. If rules fail to load (PG error), `findBestAgent` returns `null` — no assignment. Never fall back to empty rules.

**`enforceRuleIsolation`**: runs on server warm-up and on every agent WS reconnect. Scans each dedicated agent's unacked alerts, returns non-matching ones to `status='pending'` via `resetAlertToPending` (no history entry written — by design).

**`server/services/timeoutMonitor.ts`**: if `getOnlineAgents()` or `getActiveDistributionRules()` throws, `findAlternateAgent` returns `null` (skip reassignment). Never swallow these errors with `.catch(() => [])`.

---

## Softphone Modes
1. **WebRTC** (`callMode: 'webrtc'`): SIP.js in-browser, register via `/ws/sip` proxy
2. **AMI/ESL** (`callMode: 'ami'`): Click-to-call via `/api/calls/originate`, agent's physical phone rings first

Extension credentials stored in `localStorage` key `tavl_softphone_settings`.

### Attended Transfer (working, 2026-05-11)
Three-phase UI: enter destination → consult call → complete / cancel.
- `src/services/sip.ts`: `startConsultCall(dest)` — server-side holds Call A and stores partnerA UUID returned from `/api/calls/hold`, then opens Call B as new `Inviter`. `completeAttendedTransfer()` POSTs `/api/calls/attended-transfer` with `{ extension, partnerAUuid }`. `cancelConsult()` hangs up Call B and unholds Call A.
- `server/freeswitch/esl.ts` → `attendedTransfer(extension, partnerAUuid)`: finds the agent's *non-held* leg (Call B) via channel filtering, gets its partner UUID, then `uuid_bridge partnerAUuid partnerBUuid`. Customer ↔ destination bridge; agent's two legs drop.
- `holdCall` returns `partnerUuid` so the client can pass it back during completion.

### Conference (working, 2026-05-11)
**The XML default context has no conference rule**, so XML dialplan transfers hang up channels. The working implementation uses **inline dialplan** to run the conference app directly:
- `uuid_transfer <uuid> conference:<room>@default inline` — joins channel to conference room
- For the third-party dial-out: `originate {...,ignore_early_media=true}<channel> &conference(<room>@default)` (here the `&app(...)` syntax is correct because `originate` parses its target as a dial-string, not a dialplan extension)
- Before transferring either leg, set `park_after_bridge=true` + `hangup_after_bridge=false` on both legs so the partner doesn't tear down when its peer leaves the bridge
- Move partner first (parks in conference alone), then agent, then originate the third party
- Conference room naming: `tavlconf${extension}${ts}` (pure alphanumeric, no regex collision risk)

---

## Important Files to Know
```
server/index.ts           — Main server, WS hub, SIP proxy, startup sequence
server/freeswitch/esl.ts  — FreeSWITCH ESL singleton (calls, queue, conference, events)
server/routes/calls.ts    — Call API (lookup, originate, hold, transfer, conference, queue)
server/routes/distribution.ts — Alert distribution (very large, ~1700 lines)
server/routes/pbx-admin.ts    — PBX Admin REST API (SSH-based, very large)
server/db/alertDistribution.ts — Alert DB layer
server/db/postgres.ts     — Primary PG connection
server/services/asterisk-config.ts — SSH helpers for reading/writing FS config files

src/App.tsx               — Route definitions, role-based guards
src/services/sip.ts       — SIP.js service singleton
src/store/callStore.ts    — Softphone + conference state
src/store/authStore.ts    — Auth + distribution auto-login
src/features/pbx-admin/   — PBX Admin V1 pages
src/features/pbx-admin-v2/ — PBX Admin V2 pages
```

---

## Alias Map (vite.config.ts + tsconfig.json)
```
@            → src/
@components  → src/components/
@features    → src/features/
@services    → src/services/
@hooks       → src/hooks/
@store       → src/store/
@apptypes    → src/types/
@utils       → src/utils/
@data        → src/data/
```

---

## Electron Support
The app can also build as an Electron desktop app (`npm run electron:build`). Electron files in `electron/` directory. Not the primary deployment target — web server mode is primary.

---

## Deployment
- Production: `npm run build` then `npm start` (Express serves `dist/` as static + API on same port 3001)
- Dev: `npm run dev` (Vite HTTPS :5173 + Express :3001, WS proxy via custom Vite plugin)
- The Vite dev server uses HTTPS (basicSsl plugin) because WebRTC requires secure context

**Production server**: `iteckadmin@192.168.20.156`
- Path: `/home/iteckadmin/icc_lite_v1/tavl-lite-v2/`
- PM2 process: `icc-lite-backend` (id=4)
- Deploy a file: `sshpass -p 'Developer@#$81' scp -o StrictHostKeyChecking=no <local> iteckadmin@192.168.20.156:<remote>`
- Restart: `sshpass -p 'Developer@#$81' ssh -o StrictHostKeyChecking=no iteckadmin@192.168.20.156 "pm2 restart icc-lite-backend"`
- Logs: `pm2 logs icc-lite-backend --lines 50 --nostream`

---

## Coding Guidelines (Karpathy Skills)

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
