# TAVL Lite v2 — Complete System Architecture

> **Purpose:** This document is the single source of truth for the entire application.
> An AI or developer reading this file should be able to fully understand every layer,
> every data flow, and every design decision without reading the source code.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Server Startup Lifecycle](#4-server-startup-lifecycle)
5. [Database Architecture](#5-database-architecture)
6. [ID Mapping Problem](#6-id-mapping-problem)
7. [Cache Sync System](#7-cache-sync-system)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [WebSocket Protocol](#9-websocket-protocol)
10. [Alert Distribution System](#10-alert-distribution-system)
11. [Analytics Engine](#11-analytics-engine)
12. [Stolen Vehicle Tracking](#12-stolen-vehicle-tracking)
13. [Asterisk AMI / Softphone](#13-asterisk-ami--softphone)
14. [Frontend Architecture](#14-frontend-architecture)
15. [API Reference](#15-api-reference)
16. [Environment Variables](#16-environment-variables)
17. [Known Constraints & Gotchas](#17-known-constraints--gotchas)

---

## 1. Overview

**TAVL Lite v2** (branded as **iCC — iTeck Command Center**) is a real-time vehicle tracking
and alert management system used by a command center with agents and supervisors. It provides:

- **Vehicle search & tracking** — Search 124k+ vehicles by plate/IMEI, view live GPS, play back track history
- **Real-time alert distribution** — Alerts from `eventlog` (PostgreSQL) are auto-distributed to agents via WebSocket
- **Supervisor dashboard** — Manage agents, escalated alerts, routing rules, and resolution history
- **Analytics video wall** — NASA-style command center display with 24h alert trends, fleet status, geofence breakdowns
- **Stolen vehicle tracking wall** — Real-time GPS polling for marked stolen vehicles with SMS alerts
- **Softphone integration** — Click-to-call via Asterisk AMI, inbound screen-pop with CRM lookup
- **CRM integration** — Customer info, vehicle logs, installation history from ERP system

**Users:**
- **Agents** (`operator`/`agent` role) — Handle alerts in their inbox, track vehicles
- **Supervisors** (`supervisor`/`admin` role) — Manage agents, routing rules, escalated alerts
- **Video walls** (no auth) — Analytics wall and tracking wall are public displays

---

## 2. Tech Stack

### Backend
| Component | Technology |
|-----------|-----------|
| Runtime | Node.js with TypeScript (via `tsx watch` in dev) |
| Framework | Express.js |
| WebSocket | `ws` (WebSocketServer) |
| PostgreSQL | `pg` (Pool, 30 connections) |
| SQL Server | `mssql` (multiple connection pools) |
| PBX | `asterisk-manager` (AMI protocol) |
| Process | `concurrently` runs server + Vite in parallel |

### Frontend
| Component | Technology |
|-----------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite 5 (with HTTPS via `@vitejs/plugin-basic-ssl`) |
| State | Zustand (7 stores) |
| Routing | react-router-dom v6 |
| Styling | Tailwind CSS + custom glass morphism |
| Maps | Leaflet + leaflet.markercluster |
| Animations | framer-motion |
| Icons | lucide-react |
| Data | @tanstack/react-query, @tanstack/react-table |
| Softphone | sip.js (WebRTC) |

### Databases (6 total)
| Name | Engine | Host | Database | Purpose |
|------|--------|------|----------|---------|
| PostgreSQL | PostgreSQL 14+ | 192.168.20.186 | Tracking | Primary DB — eventlog, FDW to vehiclelastlocation, all app tables |
| TAVL | SQL Server | 192.168.20.253 | tavl2 | Source of truth for vehicles, devices, users |
| Tracking MSSQL | SQL Server | 192.168.20.1 | Tracking | ConsoleWarning alerts, HourlyCalculation, vehiclelastlocation |
| CRM | SQL Server | 192.168.21.33 | ERP_Tracking | Customer, vehicle, installation, security data |
| Command | SQL Server | 192.168.21.33 | tavl2 | GPRS/SMS commands to devices |
| AutoCalls | SQL Server | 192.168.20.1 | AutoCalls | Robocall status (CallDetails table) |

---

## 3. Project Structure

```
tavl-lite-v2/
├── server/                      # Backend (Express + WebSocket)
│   ├── index.ts                 # Entry point — startup, WebSocket, exports
│   ├── asterisk/
│   │   └── ami.ts               # Asterisk AMI connection + call management
│   ├── db/
│   │   ├── postgres.ts          # PostgreSQL pool (primary)
│   │   ├── tavl.ts              # MSSQL: TAVL + Tracking databases
│   │   ├── crm.ts               # MSSQL: CRM database
│   │   ├── command.ts           # MSSQL: Command database
│   │   ├── autoCalls.ts         # MSSQL: AutoCalls database
│   │   ├── mobileApp.ts         # MSSQL: MobileApp database
│   │   ├── cacheSync.ts         # MSSQL → PostgreSQL cache sync
│   │   └── alertDistribution.ts # Alert tables, agent sessions, rules
│   ├── routes/
│   │   ├── auth.ts              # Login/auth
│   │   ├── vehicles.ts          # Vehicle search, GPS, batch GPS
│   │   ├── alerts.ts            # Alert queries (ConsoleWarning)
│   │   ├── analytics.ts         # Analytics cache + background refresh
│   │   ├── distribution.ts      # Alert distribution CRUD
│   │   ├── supervisor.ts        # Supervisor agent management
│   │   ├── calls.ts             # Asterisk call management
│   │   ├── crm.ts               # CRM lookup, vehicle logs
│   │   ├── track.ts             # Track history + OSRM proxy
│   │   ├── commands.ts          # Device GPRS/SMS commands
│   │   ├── robocall.ts          # Robocall status lookup
│   │   ├── stolenTracking.ts    # Stolen vehicle CRUD
│   │   └── customerApp.ts       # Customer app info
│   ├── services/
│   │   ├── distributionEngine.ts # Alert scoring + assignment logic
│   │   ├── timeoutMonitor.ts    # Ack/resolution timeout checker
│   │   └── stolenTrackingUpdater.ts # GPS poller for stolen vehicles
│   └── websocket/
│       └── alerts.ts            # eventlog poller + alert broadcaster
├── src/                         # Frontend (React)
│   ├── App.tsx                  # Router, auth guards
│   ├── main.tsx                 # Entry point
│   ├── store/                   # Zustand stores (7)
│   ├── hooks/                   # Custom hooks (10)
│   ├── services/
│   │   └── api.ts               # HTTP + WebSocket client
│   ├── features/
│   │   ├── auth/                # Login screen
│   │   ├── dashboard/           # Agent dashboard + map
│   │   ├── supervisor/          # Supervisor dashboard
│   │   ├── alerts/              # Agent inbox, supervisor alerts
│   │   ├── analytics-wall/      # Video wall analytics
│   │   ├── tracking-wall/       # Stolen vehicle tracking wall
│   │   └── softphone/           # SIP/AMI softphone
│   └── types/                   # TypeScript interfaces
├── .env                         # Environment variables (not in git)
├── .env.example                 # Template
├── vite.config.ts               # Vite config with proxy + aliases
└── package.json                 # Dependencies
```

---

## 4. Server Startup Lifecycle

The server uses a **phased startup** to be production-ready:

```
Phase 1: HTTP listener starts IMMEDIATELY (~3 seconds)
   └── server.listen(3001, '0.0.0.0')
   └── Health endpoint returns { status: 'warming_up' }
   └── Analytics endpoints return 503

Phase 2: Database connections WITH RETRY (~5 seconds)
   └── PostgreSQL: 5 retries, 3s delay between
   └── MSSQL (TAVL, CRM): Non-fatal — server runs on PG cache if MSSQL is down

Phase 3: Essential schema (~1 second)
   └── initAlertDistributionTables()
   └── initStolenTrackingTable()
   └── markAllAgentsOffline()

Phase 4: Background warm-up (30-90 seconds, NON-BLOCKING)
   └── Cache sync (MSSQL → PG): 30-50s
   └── Analytics refresh: ~21s (runs in parallel with cache sync)
   └── Asterisk AMI connection
   └── Alert broadcaster start
   └── Timeout monitor start
   └── Stolen tracking updater start
   └── serverReady = true → Health returns { status: 'ready' }
```

**Why this matters:** Vite starts in 200ms and immediately proxies requests to `:3001`.
If the backend isn't listening, all requests fail with `ECONNREFUSED`. The phased approach
ensures the HTTP listener is up in ~3 seconds, while heavy initialization runs in the background.

---

## 5. Database Architecture

### 5.1 PostgreSQL (Primary — `192.168.20.186/Tracking`)

This is the **primary database**. All app tables live here. It also has:

- **`eventlog`** — The main alert/event table. Contains all vehicle events (geofence crossings, battery alerts, movement, etc.). Columns: `eventlogid`, `servertime`, `objectid`, `vehicleid`, `name`, `lat`, `lng`, `speed`, etc.
- **`vehiclelastlocation`** — FDW (Foreign Data Wrapper) pointing to Tracking MSSQL. Columns: `v_id`, `lat`, `lng`, `speed`, `angle`, `gps_time`, etc. Uses `v_id` (NOT `object_id`).
- **Cache tables** — Synced from MSSQL (see Section 7)
- **App tables** — Created by the application (see below)

**Pool config:** 30 connections, 15s connection timeout, timezone `Asia/Karachi` (UTC+5)

**Indexes created on startup:**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventlog_servertime ON eventlog (servertime DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventlog_name_trgm ON eventlog USING GIN (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventlog_servertime_objectid ON eventlog (servertime DESC, objectid);
```

### 5.2 App Tables (PostgreSQL)

#### `agent_sessions`
```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'agent',
  status VARCHAR(20) DEFAULT 'online',       -- online | offline | on_break | break_requested
  logged_in_at TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP DEFAULT NOW(),
  current_alert_count INT DEFAULT 0,
  max_alerts INT DEFAULT 10,
  ws_connection_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `alert_assignments`
```sql
CREATE TABLE IF NOT EXISTS alert_assignments (
  id SERIAL PRIMARY KEY,
  alert_id VARCHAR(50) NOT NULL UNIQUE,      -- eventlogid from eventlog
  alert_type VARCHAR(50) NOT NULL,
  vehicle_reg VARCHAR(50),
  customer_name VARCHAR(200),
  alert_message TEXT,
  alert_data JSONB,                          -- { customerPhone, customerAddress, customerEmail, lat, lng, ... }
  assigned_to VARCHAR(50),                   -- agent user_id
  assigned_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution VARCHAR(50),                    -- customer_contacted | false_alarm | field_team_dispatched | ...
  resolution_notes TEXT,
  escalated_to VARCHAR(50),
  escalated_at TIMESTAMP,
  escalation_reason VARCHAR(200),
  assignment_count INT DEFAULT 1,
  priority INT DEFAULT 5,                    -- 1=highest, 5=lowest
  status VARCHAR(20) DEFAULT 'pending',      -- pending | assigned | acknowledged | resolved | escalated | expired
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `alert_history`
```sql
CREATE TABLE IF NOT EXISTS alert_history (
  id SERIAL PRIMARY KEY,
  alert_id VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,               -- created | assigned | acknowledged | resolved | escalated | reassigned | timeout
  performed_by VARCHAR(50),
  performed_at TIMESTAMP DEFAULT NOW(),
  details JSONB,
  handling_time_seconds INT,
  previous_status VARCHAR(20),
  new_status VARCHAR(20)
);
```

#### `distribution_rules`
```sql
CREATE TABLE IF NOT EXISTS distribution_rules (
  id SERIAL PRIMARY KEY,
  rule_type VARCHAR(50) NOT NULL,            -- alert_type_routing | fleet_routing
  rule_name VARCHAR(100),
  description TEXT,
  config JSONB NOT NULL,                     -- { alertType: 'Panic', agents: ['10023', '10019'] } or { fleetPattern: 'DHL%', agents: [...] }
  is_active BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 10,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `alert_type_config`
```sql
CREATE TABLE IF NOT EXISTS alert_type_config (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,                  -- e.g. 'Battery Status', 'Chaman', 'FMB Battery'
  category TEXT NOT NULL,                    -- e.g. 'Battery', 'Geofence'
  severity TEXT DEFAULT 'medium',            -- critical | high | medium | low
  match_mode TEXT DEFAULT 'exact',           -- exact | contains
  enabled BOOLEAN DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `agent_performance`, `shift_schedules`, `alert_comments`
Track daily agent metrics, shift schedules, and per-alert comments.

#### `stolen_vehicle_tracking` + `stolen_tracking_sms_log`
Track stolen vehicles with GPS polling and SMS alerts (see Section 12).

#### `object_vehicle_mapping`
Caches the `object_id → vehicle_id` mapping (see Section 6).

### 5.3 MSSQL Databases

| Database | Host | Purpose | Key Tables |
|----------|------|---------|------------|
| TAVL (`tavl2`) | 192.168.20.253 | Vehicle/device/user source of truth | `[tavl].[Object]`, `[tavl].[Login]`, `[tavl].[Module]`, `[tavl].[SimCard]` |
| Tracking | 192.168.20.1 | Historical GPS, alerts | `ConsoleWarning`, `HourlyCalculation`, `vehiclelastlocation` (FDW source) |
| CRM (`ERP_Tracking`) | 192.168.21.33 | Customer/vehicle/installation data | `CUSTOMER`, `VEHICLES`, `INSTALLATION`, `SECURITYS`, `USERS` |
| Command (`tavl2`) | 192.168.21.33 | Device commands | `GprsCommandQueue`, `GprsCommandSent`, `control_room_sms` |
| AutoCalls | 192.168.20.1 | Robocall results | `CallDetails` |
| MobileApp | 192.168.20.1 | Customer mobile app | `AppLogin`, `Notifications` |

---

## 6. ID Mapping Problem

**This is the most critical cross-system complexity in the application.**

Three different ID systems exist across databases:

| System | ID Field | Example | Used In |
|--------|----------|---------|---------|
| TAVL PostgreSQL | `object_id` | `122543` | `eventlog.objectid`, `tavl_objects.object_id`, frontend vehicle IDs |
| Tracking MSSQL | `ObjectId` | `122543` (sometimes same) | `ConsoleWarning.ObjectId` |
| vehiclelastlocation FDW | `v_id` | `89201` (often DIFFERENT) | `vehiclelastlocation.v_id` — the GPS lookup table |

**The problem:** When the frontend sends `object_id=122543` to get GPS, we need to look up
`vehiclelastlocation` which uses `v_id=89201`. These IDs are NOT the same in most cases.

**Solution:** Multi-phase resolution in `/api/vehicles/gps/batch`:

```
Phase 1: Check object_vehicle_mapping cache table
   └── SELECT vehicle_id FROM object_vehicle_mapping WHERE object_id = ?
   └── Hit rate: ~95% after warm-up

Phase 2: Try object_id directly as v_id
   └── SELECT * FROM vehiclelastlocation WHERE v_id = ?
   └── Works for ~30% of vehicles where IDs happen to match

Phase 3: Resolve via eventlog lateral join
   └── SELECT objectid, vehicleid FROM eventlog
       WHERE objectid = ? AND vehicleid IS NOT NULL
       ORDER BY eventlogid DESC LIMIT 1
   └── eventlog stores BOTH object_id and vehicle_id

Phase 4: Fallback via plate number → HourlyCalculation (MSSQL)
   └── SELECT VehicleId FROM HourlyCalculation
       WHERE VehicleRegistration = ? (plate number from tavl_objects)

Persist: New mappings are saved to object_vehicle_mapping for future lookups
```

---

## 7. Cache Sync System

MSSQL tables are synced to PostgreSQL cache tables periodically so the app
can query all data from a single database (PostgreSQL).

### Sync Sources → Targets

| Source (MSSQL) | Target (PostgreSQL) | Rows | Interval |
|----------------|---------------------|------|----------|
| `[tavl].[Object]` | `tavl_objects` | 124k | 10 min |
| `[tavl].[Object]+Module+SimCard` | `tavl_devices` | 124k | 10 min |
| `[tavl].[Login]` | `tavl_logins` | 544 | 30 min |
| `CUSTOMER` | `crm_customers` | 162k | 15 min |
| `VEHICLES+MAKE+MODEL+...` | `crm_vehicles` | 185k | 15 min |
| `INSTALLATION` | `crm_installations` | 189k | 15 min |
| `SECURITYS` | `crm_security` | 188k | 15 min |
| `USERS` | `crm_users` | 414 | 15 min |
| `VehiclesDetails_Table` | `crm_vehicle_details` | 10k | 15 min |

### Sync Method

1. Query entire MSSQL source table
2. `DELETE FROM` PostgreSQL cache table
3. Batch `INSERT ... ON CONFLICT DO UPDATE` (500 rows per batch)
4. Full sync runs on startup, then scheduled intervals

---

## 8. Authentication & Authorization

### Login Flow

1. Frontend POSTs `{ username, password }` to `/api/auth/login`
2. Backend queries `crm_users` table: `SELECT * FROM crm_users WHERE u_name = $1 AND pass = $2`
3. Determines role from `role_type` field (maps `CR Agent` → `operator`, `CR Supervisor` → `supervisor`)
4. Returns user object with `loginIds` (from `tavl_logins` matching username)
5. Frontend stores in `authStore` (persisted to localStorage)
6. Frontend auto-registers with distribution system: `POST /api/distribution/login`

### Role-Based Access

| Role | Routes | Capabilities |
|------|--------|-------------|
| `operator` / `agent` | `/agent` | Alert inbox, vehicle search, track history, softphone |
| `supervisor` / `admin` | `/supervisor` | All agent capabilities + agent management, routing rules, bulk actions |
| None (public) | `/analytics-wall`, `/tracking-wall` | View-only video wall displays |

### Middleware

- `requireRole(...roles)` — Express middleware on distribution/supervisor routes
- Validates `x-user-id` and `x-user-role` headers (set by frontend)

---

## 9. WebSocket Protocol

### Connection

- URL: `ws://localhost:3001/ws` (proxied through Vite in dev)
- No authentication required to connect (identification happens after)

### Client → Server Messages

```typescript
// Identify (required after connection to receive alerts)
{ type: 'identify', agentId: '10023', role: 'agent' }

// Heartbeat (sent every 30s by client)
{ type: 'heartbeat' }
```

### Server → Client Messages

```typescript
// Alert assigned to agent
{ type: 'alert:assigned', data: AlertAssignment, timestamp: string }

// Alert acknowledged
{ type: 'alert:acknowledged', data: { alertId, userId }, timestamp: string }

// Alert resolved
{ type: 'alert:resolved', data: { alertId, userId, resolution }, timestamp: string }

// Alert escalated
{ type: 'alert:escalated', data: { alertId, userId, reason }, timestamp: string }

// Alert timeout (reassigned or escalated)
{ type: 'alert:timeout', data: { alertId, action }, timestamp: string }

// Agent status change (to supervisors)
{ type: 'agent:login' | 'agent:logout', data: { userId, status }, timestamp: string }

// Break approved
{ type: 'break:approved', data: { userId }, timestamp: string }

// Inbox refresh needed
{ type: 'inbox:refresh', data: {}, timestamp: string }

// Screen pop (inbound call)
{ type: 'screenPop', data: { call, customer?, vehicles? }, timestamp: string }

// Call events
{ type: 'callEvent', data: CallEvent, timestamp: string }
{ type: 'callBridged', data: CallEvent, timestamp: string }

// Stolen vehicle events
{ type: 'stolen:added' | 'stolen:removed' | 'stolen:updated' | 'stolen:location' | 'stolen:alert', data: ..., timestamp: string }

// Server pong (response to heartbeat)
{ type: 'pong' }

// Identify rejected
{ type: 'identify:rejected', reason: string }
```

### Connection Lifecycle

1. Client connects → server adds to `wsClients` Map
2. Client sends `identify` → server validates against `agent_sessions`
3. If agent has existing WS connections, old ones are closed (prevents duplicates)
4. Server pings every 30s → client responds with pong → if no pong, connection terminated
5. On disconnect → if no other connections for this agent → mark agent offline

---

## 10. Alert Distribution System

This is the **core business logic** of the application.

### 10.1 Alert Source Pipeline

```
eventlog table (PostgreSQL)
  │
  ▼ (polled every 15s by server/websocket/alerts.ts)
  │
  Filter by alert_type_config (dynamic, reloaded every 60s)
  │
  ▼
  Enrich with vehicle name (tavl_objects) + customer info (crm_vehicles → crm_installations → crm_customers)
  │
  ▼
  distributeAlert() — server/services/distributionEngine.ts
  │
  ├── Check deduplication (same vehicle+type within 5 min → skip)
  ├── Check distribution_rules for routing (alert_type_routing, fleet_routing)
  ├── findBestAgent() using scoring algorithm
  │     ├── Load score (40%) — lower current_alert_count / max_alerts = better
  │     ├── Performance score (30%) — higher resolve rate = better
  │     ├── Escalation penalty (20%) — fewer escalations = better
  │     └── Random jitter (10%) — prevent deterministic assignment
  ├── assignAlertToAgent() → creates alert_assignments row
  ├── Send via WebSocket: sendToAgent(agentId, 'alert:assigned', alert)
  └── Notify supervisors: sendToSupervisors('alert:distributed', alert)
```

### 10.2 Alert State Machine

```
                     ┌─────────────────────────────────────────┐
                     │                                         │
                     ▼                                         │
  ┌─────────┐   assign   ┌──────────┐   ack    ┌──────────────┐
  │ PENDING ├────────────►│ ASSIGNED ├─────────►│ ACKNOWLEDGED │
  └────┬────┘            └────┬─────┘          └──────┬───────┘
       │                      │                        │
       │ dismiss/expire       │ timeout (12min)        │ resolve
       │                      │ escalate               │
       ▼                      ▼                        ▼
  ┌─────────┐          ┌───────────┐           ┌──────────┐
  │ EXPIRED │          │ ESCALATED ├──────────►│ RESOLVED │
  └─────────┘          └───────────┘  resolve  └──────────┘
```

**Valid statuses:** `pending`, `assigned`, `acknowledged`, `resolved`, `escalated`, `expired`

**Resolution types:** `customer_contacted`, `false_alarm`, `field_team_dispatched`,
`monitoring_completed`, `vehicle_recovered`, `no_action_required`, `auto_resolved`,
`other`, `dismissed`, `auto_expired`, `escalated`

### 10.3 Timeouts (server/services/timeoutMonitor.ts)

| Timeout | Duration | Action |
|---------|----------|--------|
| Acknowledgment | 12 minutes | Reassign to another agent (up to 3 times, then escalate) |
| Resolution | 30 minutes | Auto-escalate to supervisor |
| Check interval | 60 seconds | Monitor runs every 60s |

### 10.4 Distribution Rules

Supervisors can create routing rules that override the scoring algorithm:

- **alert_type_routing** — Route specific alert types (e.g., "Panic") to specific agents
- **fleet_routing** — Route vehicles matching a pattern (e.g., "DHL%") to specific agents

Rules are stored in `distribution_rules` and checked before the general scoring algorithm.

### 10.5 Polling Intervals (server/websocket/alerts.ts)

| Task | Interval | Description |
|------|----------|-------------|
| Alert polling | 15s | Poll `eventlog` for new alerts |
| Pending distribution | 30s | Retry distributing unassigned pending alerts |
| Config refresh | 60s | Reload `alert_type_config` from DB |
| Expiry job | 5 min | Expire stale alerts |
| Cleanup job | 24 hours | Archive old alert_history/alert_assignments |

---

## 11. Analytics Engine

### Architecture

The analytics system uses a **background refresh + in-memory cache** pattern:

```
                      ┌──────────────┐
                      │   eventlog   │
                      │  (24h scan)  │
                      └──────┬───────┘
                             │
                     refreshAllData()
                     (runs every 30s)
                             │
                    ┌────────┴────────┐
                    │  In-Memory Cache │
                    │  (6 cache slots) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         GET /summary   GET /hourly   GET /fleet  ...
         (instant)      (instant)     (instant)
```

### Cache Slots

| Key | Data | Source Query |
|-----|------|-------------|
| `summary` | Alert counts (last hour, today), breakdown by type | Derived from `hourlyRaw` |
| `hourly` | 24 hourly buckets with critical/warning/geofence counts | `eventlog` GROUP BY hour, name |
| `fleet` | Total vehicles, moving, parked, offline | `tavl_objects` count + `eventlog` last 30 min |
| `geofence` | Top 15 geofence zones by event count | Derived from `hourlyRaw` |
| `realtime` | Alert count and active vehicles in last 5 min | `eventlog` last 5 min |
| `topAlerting` | Top 10 vehicles by alert count (24h) | `eventlog` GROUP BY objectid |

### Alert Categories

Events from `eventlog.name` are classified:
- **Critical:** Contains `panic`, `overspeed`, `over speed`, `sos`, `emergency`
- **Warning:** Contains `battery`, `power`, `volt`, `dout`, `movement`
- **Geofence:** Contains `roaming`, `geofence`, or any city name (Rawalpindi, Islamabad, Lahore, Karachi, Faisalabad, Multan, Peshawar, Quetta, Sialkot, Gujranwala, Hyderabad, Sukkur, Bahawalpur, Sargodha, Abbottabad)
- **Info:** Everything else (excluded from analytics)

### Frontend Behavior

- Polls full data every 60 seconds, realtime every 10 seconds
- On 503 (warming up): auto-retries every 3 seconds, up to 20 times
- Shows "INITIALIZING SYSTEMS..." spinner until first successful data load
- Wake lock enabled to prevent screen sleep (video wall mode)

---

## 12. Stolen Vehicle Tracking

### Tables

```sql
stolen_vehicle_tracking (
  id, vehicle_id, object_id, vehicle_reg, vehicle_desc,
  customer_name, customer_phone, marked_by, marked_at,
  priority, case_number, notes, status,
  last_lat, last_lon, last_speed, last_heading, last_address, last_update,
  total_distance_km, sms_alerts_enabled, sms_phone_number,
  sms_interval_km, last_sms_distance, last_sms_sent
);

stolen_tracking_sms_log (
  id, tracking_id, phone_number, message, trigger_type, lat, lon, sent_at, status
);
```

### Flow

1. Supervisor marks vehicle as stolen via `/api/stolen-tracking/mark`
2. `stolenTrackingUpdater` service polls GPS every **5 seconds** for all active tracked vehicles
3. Updates `last_lat`, `last_lon`, `last_speed`, calculates `total_distance_km`
4. If SMS enabled and distance threshold reached → sends SMS alert
5. Broadcasts `stolen:location` via WebSocket to tracking wall
6. Tracking wall displays real-time vehicle positions on a full-screen map
7. Max 10 vehicles tracked simultaneously

---

## 13. Asterisk AMI / Softphone

### AMI Connection

- Connects to Asterisk PBX at `192.168.21.32:5038` via AMI protocol
- Auto-reconnects on disconnect
- Tracks all active calls in memory

### Inbound Screen Pop Flow

```
Inbound call detected (AMI Newchannel event)
  │
  ▼
Normalize phone number (strip country code, leading zero)
  │
  ▼
Query crm_customers by cont1/cont2 ILIKE pattern
  │
  ▼
If found: Query crm_installations + crm_vehicles for customer's vehicles
  │
  ▼
Broadcast 'screenPop' to all agents via WebSocket
  │
  ▼
Frontend shows popup with customer name, address, vehicles
```

### Click-to-Call (AMI mode)

1. Agent clicks phone icon → `POST /api/calls/originate`
2. Backend sends AMI `Originate` action: rings agent's extension first
3. When agent picks up → Asterisk dials the customer number
4. Call events streamed via WebSocket

### Softphone (WebRTC mode)

- Uses `sip.js` library for WebRTC SIP registration
- Connects to Asterisk SIP over WSS
- Supports DTMF, hold, transfer, mute

---

## 14. Frontend Architecture

### 14.1 Routes

| Path | Component | Auth Required | Roles |
|------|-----------|--------------|-------|
| `/login` | LoginScreen | No | — |
| `/` | Redirect | — | Redirects to role-based home |
| `/agent` | Dashboard | Yes | `operator`, `agent` |
| `/supervisor` | SupervisorDashboard | Yes | `supervisor`, `admin` |
| `/analytics-wall` | AnalyticsWall | No | Public video wall |
| `/tracking-wall` | TrackingWall | No | Public video wall |

### 14.2 Zustand Stores (7)

| Store | File | Purpose |
|-------|------|---------|
| `useAuthStore` | `authStore.ts` | User session, login/logout, persisted to localStorage |
| `useAlertDistributionStore` | `alertDistributionStore.ts` | Agent inbox, supervisor alerts, rules, stats |
| `useVehicleStore` | `vehicleStore.ts` | Vehicle data, pinned vehicles, filters, trails |
| `useTrackStore` | `trackStore.ts` | Track history playback state |
| `useCallStore` | `callStore.ts` | Softphone state, call management |
| `useAlarmStore` | `alarmStore.ts` | ConsoleWarning alarms |
| `useSupervisorStore` | `supervisorStore.ts` | Supervisor-specific agent/alert management |

### 14.3 Key Hooks

| Hook | Purpose | Polling |
|------|---------|---------|
| `useDistributionWebSocket` | Real-time alerts via WebSocket with HTTP fallback | 15s fallback |
| `usePinnedVehicleRefresh` | GPS updates for pinned vehicles | 10s |
| `useRobocallStatus` | Robocall status for alerts in inbox | 45s |
| `useAlarms` | ConsoleWarning alert monitoring | 30s |
| `useVehicleSearch` | Vehicle search by plate/IMEI/description | On-demand |
| `useTrackHistory` | Track history fetch and processing | On-demand |
| `useSupervisorEvents` | Supervisor WebSocket event subscription | Real-time |
| `useWeather` | Weather data for vehicle location | 10 min cache |
| `useVehicleAlerts` | Vehicle-specific alerts | On-demand |

### 14.4 Vite Configuration

```typescript
// Proxy (dev mode)
'/api' → http://localhost:3001
'/ws'  → ws://localhost:3001

// Path aliases
'@'           → ./src
'@components' → ./src/components
'@features'   → ./src/features
'@services'   → ./src/services
'@hooks'      → ./src/hooks
'@store'      → ./src/store
'@apptypes'   → ./src/types
'@utils'      → ./src/utils
'@data'       → ./src/data

// HTTPS enabled (required for WebRTC media device access)
// Electron support conditional on ELECTRON=true env var
```

---

## 15. API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with username/password |

### Vehicles
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/vehicles/search?term=...` | Search vehicles (plate, IMEI, desc, engine, phone) |
| GET | `/api/vehicles/:objectId` | Get vehicle details + GPS |
| GET | `/api/vehicles/:objectId/gps` | Real-time GPS only |
| POST | `/api/vehicles/gps/batch` | Batch GPS for up to 50 vehicles |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts/recent` | Recent alerts (category filter) |
| GET | `/api/alerts/vehicle/:objectId` | Alerts for specific vehicle |
| GET | `/api/alerts/warnings` | ConsoleWarning alerts (geofence + robocall data) |
| GET | `/api/alerts/stats` | Alert statistics |

### Distribution (Agent)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/distribution/login` | Register agent session |
| POST | `/api/distribution/logout` | Mark agent offline |
| GET | `/api/distribution/inbox` | Get agent's assigned alerts |
| POST | `/api/distribution/acknowledge/:alertId` | Acknowledge alert |
| POST | `/api/distribution/resolve/:alertId` | Resolve alert |
| POST | `/api/distribution/escalate/:alertId` | Escalate to supervisor |
| POST | `/api/distribution/request-break` | Request break |

### Distribution (Supervisor)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/distribution/agents` | Get all agents |
| GET | `/api/distribution/escalated` | Get escalated alerts |
| GET | `/api/distribution/pending` | Get pending alerts |
| POST | `/api/distribution/assign` | Manually assign alert (optional force) |
| POST | `/api/distribution/supervisor-resolve/:alertId` | Resolve from any state |
| POST | `/api/distribution/dismiss` | Bulk dismiss alerts |
| PUT | `/api/distribution/agent/:userId/max-alerts` | Update agent capacity |
| POST | `/api/distribution/distribute-pending` | Trigger manual distribution |
| GET | `/api/distribution/stats` | Distribution statistics |
| GET | `/api/distribution/resolved` | Resolved alert history |
| GET/POST/PUT/DELETE | `/api/distribution/rules` | CRUD distribution rules |
| GET/POST/PUT/DELETE | `/api/distribution/alert-types` | CRUD alert type configs |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/summary` | Alert summary (last hour + today) |
| GET | `/api/analytics/hourly` | 24-hour hourly breakdown |
| GET | `/api/analytics/fleet` | Fleet status (moving/parked/offline) |
| GET | `/api/analytics/geofence` | Geofence zone breakdown |
| GET | `/api/analytics/realtime` | Real-time stats (5 min) |
| GET | `/api/analytics/top-alerting` | Top alerting vehicles |

### CRM
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crm/:identifier` | CRM lookup (objectId, plate, or V_ID) |
| GET | `/api/crm/groups/list` | Fleet groups |
| GET | `/api/crm/groups/:customerName/vehicles` | Vehicles for customer |
| GET | `/api/crm/logs/:vehicleId/:logType` | Vehicle logs by type |

### Calls
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/calls/originate` | Click-to-call |
| POST | `/api/calls/hangup` | Hangup call |
| POST | `/api/calls/transfer` | Transfer call |
| GET | `/api/calls/active` | Active calls |
| GET | `/api/calls/config` | SIP/PBX config |

### Stolen Tracking
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stolen-tracking/active` | Active tracked vehicles |
| POST | `/api/stolen-tracking/mark` | Mark vehicle as stolen |
| PUT | `/api/stolen-tracking/:id` | Update tracking settings |
| DELETE | `/api/stolen-tracking/:id` | Remove from tracking |

### Track History
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/track/:objectId` | Track history (date range) |
| POST | `/api/track/osrm-match` | OSRM route matching proxy |

### Device Commands
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/commands/device/:objectId` | Device info + available commands |
| POST | `/api/commands/send` | Send GPRS/SMS command to device |
| GET | `/api/commands/history/:objectId` | Command history |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server readiness (200=ready, 503=warming_up) |

---

## 16. Environment Variables

See `.env.example` for the complete template. Key groups:

| Group | Variables | Purpose |
|-------|-----------|---------|
| PostgreSQL | `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` | Primary database |
| TAVL MSSQL | `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Vehicle/device source |
| Tracking MSSQL | `TRACKING_SERVER`, `TRACKING_NAME`, `TRACKING_USER`, `TRACKING_PASSWORD` | ConsoleWarning, GPS |
| CRM MSSQL | `CRM_SERVER`, `CRM_NAME`, `CRM_USER`, `CRM_PASSWORD` | Customer/vehicle data |
| Command MSSQL | `CMD_SERVER`, `CMD_NAME`, `CMD_USER`, `CMD_PASSWORD` | Device commands |
| AutoCalls MSSQL | `AUTOCALLS_SERVER`, `AUTOCALLS_NAME`, `AUTOCALLS_USER`, `AUTOCALLS_PASSWORD` | Robocall status |
| Asterisk | `ASTERISK_HOST`, `ASTERISK_AMI_PORT`, `ASTERISK_AMI_USER`, `ASTERISK_AMI_PASSWORD` | PBX integration |
| SIP | `ASTERISK_SIP_PORT`, `ASTERISK_SIP_TRANSPORT`, `DEFAULT_SIP_EXTENSION`, `DEFAULT_SIP_PASSWORD` | Softphone |
| App | `NODE_ENV`, `VITE_APP_NAME`, `VITE_APP_VERSION`, `PORT` | Application config |

---

## 17. Known Constraints & Gotchas

### Critical

1. **ID Mapping** — `object_id` ≠ `v_id` in most cases. Always resolve via `object_vehicle_mapping` before querying `vehiclelastlocation`. See Section 6.

2. **PostgreSQL Timezone** — All timestamps are in `Asia/Karachi` (UTC+5). The pool sets `SET timezone = 'Asia/Karachi'` on every connection. JavaScript `Date` objects from `pg` are timezone-aware. When using `Date` objects as Map keys, convert to ISO string first (reference equality, not value equality).

3. **eventlog is append-only and large** — Millions of rows. All queries MUST use the `servertime` index and limit scan windows (24h for analytics, 5min for realtime). Never do `SELECT *` without a time filter.

4. **Cache sync is destructive** — `DELETE FROM` + `INSERT` (not upsert). During sync, cache tables may be briefly empty. Queries should handle empty results gracefully.

### Performance

5. **Analytics refresh takes ~21s** — Runs in background every 30s. API endpoints serve from cache, never blocking on queries.

6. **Pool size is 30** — Shared across analytics, alert polling, API routes, and cache sync. Under heavy load, connection starvation is possible. The `connectionTimeoutMillis: 15000` setting prevents indefinite hangs.

7. **ILIKE queries need trigram index** — Positive-match `ILIKE '%pattern%'` can use the GIN trigram index on `eventlog.name`. Negative-match `NOT ILIKE` forces full table scans — avoid it.

### WebSocket

8. **Agent deduplication** — When an agent reconnects, old WS connections are closed. The `identify` message validates against `agent_sessions` — if the session is offline, identification is rejected.

9. **Stale session cleanup** — Every 2 minutes, agents with no heartbeat for 2+ minutes AND no active WS connection are marked offline.

### Frontend

10. **Video walls have no auth** — `/analytics-wall` and `/tracking-wall` are public. They should only be exposed on the internal network.

11. **localStorage persistence** — Auth state is persisted to `localStorage('tavl-auth-storage')`. Clearing localStorage forces re-login.

12. **Electron support** — The app was originally an Electron desktop app. Most Electron-specific code paths still exist but are dormant in web mode. The `window.electron` global is checked at runtime.
