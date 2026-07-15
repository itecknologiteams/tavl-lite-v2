# TAVL Lite v2 / ICC — Codebase Assessment

**Date:** 2026-05-29
**Scope:** Read-only deep audit of three areas — (1) Production readiness, (2) SIP phone robustness, (3) Alert distribution mechanism.
**Method:** End-to-end trace of the implementation files; every finding cites `file:line`. Headline CRITICAL findings were independently verified against source.

> Severity key: **CRITICAL** = exploitable/safety-impacting or data-loss in normal operation · **HIGH** = serious correctness/security risk · **MEDIUM** = real bug under load or edge cases · **LOW** = hardening / quality.

---

## Executive Summary

| Area | Verdict | Headline issues |
|---|---|---|
| **Production readiness** | ❌ **Not production-ready as-is** | All business API routes are unauthenticated; hardcoded prod SSH/DB secrets in source; command injection in CDR recording endpoint. |
| **SIP phone robustness** | ⚠️ **Functional but fragile** | Call failures vanish silently (no UI feedback); hold/transfer state can desync; attended-transfer leg detection is heuristic. Conference/transfer happy-paths are solid. |
| **Alert distribution** | ⚠️ **Correct core, dangerous gaps** | Single-alert assignment is provably race-safe, BUT unacked alerts are orphaned for ≥12 min when an agent disconnects (safety-critical for SOS/panic alerts). |

**Single most urgent fix per area:**
1. **Production:** Add authentication middleware to every `/api/*` business route. They are currently wide open on port 3001.
2. **SIP:** Surface SIP `error` events to the UI — failed outbound calls currently disappear with no feedback.
3. **Distribution:** On agent disconnect, return unacknowledged alerts to `pending` immediately instead of waiting 12 minutes for the ack-timeout.

---

## 1. Production Readiness

### 🔴 CRITICAL

**P-C1 — All 15 business API route files are completely unauthenticated.**
`server/routes/{calls,distribution,supervisor,vehicles,crm,alerts,track,commands,robocall,autocall,cdr,closure,stolenTracking,analytics,customerApp}.ts`
- Verified: `calls.ts` has **zero** auth references; routes mount in `server/index.ts:427-439` with no auth middleware in the chain. Login (`auth.ts`) returns a plain user object — no token/session — and `GET /api/auth/me` is a hardcoded stub that always 401s. "Auth" lives only in browser `sessionStorage`.
- **Impact:** Anyone with network access to port 3001 can originate/hang up live calls, eavesdrop (spy/whisper/barge via `/api/supervisor`), read all CRM customer & vehicle data, pull CDRs and call recordings, fire robocall campaigns, and reassign alerts — **with no credential**. Only `/api/pbx-admin` is protected.
- **Fix:** Issue a signed JWT (or server session) on login; add auth middleware on every `/api/*` router except `/api/auth/login` and the intentionally-public walls. Enforce role checks on supervisor-only endpoints.

**P-C2 — Hardcoded production SSH password in source.**
`server/routes/pbx-admin.ts:38` — `const PBX_SSH_PASSWORD = process.env.FREESWITCH_SSH_PASSWORD || 'Developer&*^18';` (verified)
- Used in `sshExec` to run `sudo` commands on the FreeSWITCH host. This is a real root-capable credential committed to the repo (and present in git history).
- **Fix:** Remove the literal (fail closed if env missing), **rotate the password**, scrub git history.

**P-C3 — Command injection in the CDR recording endpoint.**
`server/routes/cdr.ts:301-302` (verified) — `uniqueid` from `req.params` is interpolated into a remote shell command (`ls "..."` → `sshpass ssh "(...)"` via `execSync`) **before** the sanitizer at line 315 (which only cleans the *local temp filename*, too late).
- **Impact:** A crafted `uniqueid` containing `"`, `;`, or `$()` executes arbitrary commands as `iteckadmin`/sudo on the FreeSWITCH server. Combined with the unauthenticated `/api/cdr` route (P-C1), this is **remotely exploitable**.
- **Fix:** Validate `uniqueid` against a strict UUID regex up front; use `execFile` with an argument array instead of string interpolation.

### 🟠 HIGH

**P-H1 — Hardcoded DB / admin / JWT secret fallbacks.**
`postgres.ts:23` (`|| 'admin123'`), `fusionpbx.ts:16`, `pbx-admin-db.ts:16`, and `pbx-admin.ts:40-42` (`ADMIN_USER||'admin'`, `ADMIN_PASSWORD||'admin'`, `ADMIN_JWT_SECRET||'fallback-secret-key-...'`). If any env var is unset in prod, the app silently uses known-public credentials and tokens become forgeable.
- **Fix:** No fallbacks for secrets — throw on startup if absent.

**P-H2 — `uncaughtException` handler swallows the error and keeps running.**
`server/index.ts:12-14` logs and continues. After an uncaught exception the process is in an undefined state; a telephony/alert server that "keeps running" can silently corrupt call/alert state or leak handles, and PM2 never restarts it because it never exits.
- **Fix:** Log → attempt fast graceful shutdown → `process.exit(1)`, let PM2 restart clean.

### 🟡 MEDIUM

- **P-M1 — Prod runs uncompiled via `tsx server/index.ts`** (`package.json`); the server is never type-checked before deploy. A type/syntax regression only surfaces at runtime. → Gate deploy on `tsc --noEmit`; run compiled JS under `node`.
- **P-M2 — `warmUpInBackground` sets `serverReady = true` even on failure** (`index.ts:584-589`), and the health check (`index.ts:459-465`) only reports `serverReady` + WS count. An instance with ESL or MSSQL down still advertises "ready," so the LB routes traffic to a half-broken node. → Make warm-up failures affect readiness; report per-dependency health.
- **P-M3 — Graceful shutdown closes DB pools before `server.close()`** (`index.ts:768-785`), so in-flight requests can hit a closed pool. → Stop accepting connections first, drain, then close pools.
- **P-M4 — `console.log`-only logging, with PII** (caller numbers, customer names at `index.ts:675/729`; usernames at `auth.ts:11`). No levels, redaction, correlation IDs, or rotation. → Adopt pino/winston with redaction.
- **P-M5 — V1 PBX-admin writes FreeSWITCH config as root over SSH via string-built `echo > file` commands** (`asterisk-config.ts:34-46`). Fragile on special chars and a config/command-injection surface. → Complete the V2 (DB-backed) migration.
- **P-M6 — 97 silent `.catch(() => {})` / `.catch(() => [])` blocks across `server/`**, including the forbidden `.catch(() => [])` at `analytics.ts:175/183`. Failed agent-status / alert writes vanish undebuggably. *(Note: `timeoutMonitor.ts:39-46` correctly follows the CLAUDE.md rule and returns `null`.)* → At minimum log inside the catch.

### 🟢 LOW

- **P-L1 — CORS `origin: true` with `credentials: true`** (`index.ts:411-414`). Harmless today (no cookies) but becomes a CSRF vector the moment cookie/session auth lands. → Allow-list known origins.
- **P-L2 — `any`-typed FreeSWITCH layer** parses `show channels` output by positional index (`esl.ts:746-816`). A FS version upgrade that changes column order silently produces wrong agent stats. → Prefer JSON API forms + interfaces.

### ✅ What's already solid
- Global `uncaughtException`/`unhandledRejection` handlers exist (don't crash on stray rejections).
- PG connect retries 5×3s and exits if the hard dependency is unreachable; non-fatal DBs degrade gracefully.
- Every Express handler is individually `try/catch`-wrapped + a final error middleware (`index.ts:481-487`) — a thrown handler returns 500, doesn't crash.
- WS ping/pong dead-connection reaping; all service intervals tracked & cleared on shutdown.
- `postgres.ts` handles the "pool ended" race with reinit+retry; `withTransaction` does proper BEGIN/COMMIT/ROLLBACK with `release()` in `finally`.

---

## 2. SIP Phone Robustness

### 🔴 CRITICAL

**S-C1 — Outbound call failures vanish silently; UI sticks on "Calling…".**
`src/services/sip.ts:611` nulls `_currentCall` and emits `error` on a synchronous INVITE failure, but the store's `error` handler only `console.error`s (`callStore.ts:406-408`). The agent already saw the optimistic "calling" CallInfo (`sip.ts:589`), which now disappears with no toast.
- **Scenario:** PBX briefly unreachable → agent clicks call → spinner vanishes, no feedback, agent waits indefinitely.
- **Fix:** Route `error` events to `toastStore` and/or a `callError` field the UI renders.

**S-C2 — Consult/transfer hard-failure relies on a Terminated event that may never arrive.**
`sip.ts:863-869`: if `inviter.invite()` throws during a consult, the code returns `false` and depends on a later "Terminated" event to emit `consultFailed`. If SIP.js leaves the Inviter stuck in `Establishing` (ICE never completes), no `consultFailed` fires and the only escape is the 20s no-answer timer — during which **the customer sits silently on hold**.
- **Fix:** Emit `consultFailed` immediately in the `catch` at `sip.ts:864` rather than waiting for Terminated.

### 🟠 HIGH

**S-H1 — Hold success/failure desync: server holds, UI thinks it didn't.**
`sip.ts:729-767` (`toggleHold`): on a thrown fetch it returns the *old* `held` value without changing state — but FreeSWITCH may have already run `uuid_hold`. Customer hears MOH (held server-side) while the UI shows "not held" and the agent's mic is live.
- **Scenario:** Agent toggles hold, request times out, agent keeps talking believing they're connected; customer hears nothing.
- **Fix:** Only flip local audio-track state after confirmed server success; surface hold failures.

**S-H2 — `attendedTransfer` leg detection is heuristic — can bridge the wrong parties.**
`server/freeswitch/esl.ts:487-521` picks the consult leg via `agentChannels.find(ch => ch.bridgeId && ch.bridgeId !== partnerAUuid)` with a fallback. If the agent has a third/stale leg (prior call not yet torn down, or a queue B-leg), it can select the wrong `bridgeId` and `uuid_bridge` the customer to an unintended extension.
- **Fix:** Capture the consult destination's UUID explicitly when Call B establishes (via `callBridged`/`Other-Leg`) and pass it from the client instead of re-deriving server-side.

**S-H3 — AMI click-to-call fallback records a false "answered: true".**
`src/store/callStore.ts:685-715`: when `api.calls.originate` throws, the catch only logs and falls through to the `tel:` clipboard fallback, writing a history entry with `answered: true` (`callStore.ts:700`). Agent gets no error and a wrong CDR/history record.
- **Fix:** Distinguish hard failure from intentional click-to-call; don't mark `answered: true` for an unconfirmed call.

### 🟡 MEDIUM

- **S-M1 — Inbound screen-pop is coupled to context-string matching** (`esl.ts:161-163`). A future routing change that delivers callers via a different context silently kills screen pop. → Drive screen-pop off the `callcenter::info` member-offering event (already subscribed).
- **S-M2 — Answer-retry loop can auto-answer the *wrong* call.** The popup retry loop (`Softphone.tsx:1577-1605`) retries ~6× over 18s; if caller A hangs up and caller B rings within that window, the in-flight retry can answer B. → Capture the call `id` at loop start; bail if `currentCall.id` changes.
- **S-M3 — Local media tracks not explicitly stopped on hangup** (`sip.ts:1139-1156`). If `bye()`/`cancel()` threw, peerConnection senders retain live tracks → mic LED stays on, leaks accumulate over a long shift. → Iterate `peerConnection.getSenders()` and `sender.track?.stop()` in `cleanupCall`.
- **S-M4 — `_resumeHeldCall` failure is silent** (`sip.ts:955-978`); after a failed consult, "Resume call" resets `transferPhase:'idle'` even if the unhold failed (`callStore.ts:792-796`) → customer stranded on MOH. → Return success; don't reset UI on failure.
- **S-M5 — `toggleMute` computes mute state twice** (store + sipService independently, `callStore.ts:739-759`) — two sources of truth that can diverge. → Consume the boolean returned by `sipService.toggleMute()`.

### 🟢 LOW

- **S-L1 — `isRegistered` can report true when transport flaps** (`sip.ts:214-229`); mitigated by the 20s health monitor.
- **S-L2 — `getActiveChannels` logs a misleading parse error every idle poll** — FreeSWITCH returns `+OK 0 total.` (non-JSON) when no channels exist; `JSON.parse` throws and is caught (`esl.ts:602-620`). Correct outcome, noisy logs. → Guard the empty sentinel.
- **S-L3 — Initial reconnect give-up has no user-facing retry prompt** (`sip.ts:513-518`); only recovery is manual reconnect.
- **S-L4 — `cancelConsult` depends on `_resumeHeldCall` to re-enable Call A audio** (`sip.ts:914-937`); a race can leave the agent muted to the customer after cancel. → Re-enable tracks unconditionally in `cancelConsult`.

### ✅ What's already solid
- **No EventEmitter listener leak on ESL reconnect** — app-level listeners wired once in `initEslAndWire` (`index.ts:656-742`); reconnect only rebinds the fresh inner `modesl.Connection`.
- **Conference matches the documented inline-dialplan approach exactly** — `park_after_bridge=true`+`hangup_after_bridge=false` set before transfer, partner moved first, third party via `originate ... &conference(...)`, alphanumeric room names (`esl.ts:933-982`). Conference mute does mute+deaf for true isolation.
- ESL `scheduleReconnect` is idempotent (no stacked reconnect timers).
- Optimistic conference-mute with revert-on-failure is correct (`callStore.ts:917-961`).

---

## 3. Alert Distribution Mechanism

### 🔴 CRITICAL

**D-C1 — Unacknowledged alerts are orphaned for ≥12 minutes when an agent disconnects.**
`server/db/alertDistribution.ts:300-306` (`setAgentOffline`) sets `status='offline'` and zeroes `current_alert_count` but does **nothing** to the agent's `alert_assignments` rows (verified at line 303). Those alerts stay `status='assigned'` owned by an offline agent — invisible to `getPendingAlerts` (which is `status='pending'` only), so the 30s pending distributor never sees them. The **only** recovery is the ack-timeout monitor, which requires `assigned_at < NOW() - 12min`.
- Same gap in `markStaleAgentsOffline` (every 2 min) and `markAllAgentsOffline` on restart.
- **Scenario:** Agent assigned 5 alerts, acks none, closes the browser → all 5 are dead for ≥12 minutes even if other agents are idle. **For a panic/SOS alert this is a safety-critical delay.**
- **Fix:** On offline (WS close, stale sweep, restart), call `resetAlertToPending` (ungated by rules) for each `status='assigned' AND acknowledged_at IS NULL` row owned by that agent, then trigger `distributePendingAlerts()`.

**D-C2 — `current_alert_count` not recomputed on WS reconnect → over-assignment.**
`setAgentOffline` zeroes the count but leaves *acknowledged* (in-progress) alerts assigned. On WS reconnect, `index.ts:132-136` calls `updateAgentStatus(...,'online')` (status only) — it does **not** recompute the count the way login (`upsertAgentSession`) does. The agent is now `online, count=0` while actually holding N acked alerts, so `findBestAgent` treats them as idle and over-assigns up to `max_alerts` on top of real load. `reconcileAlertCounts` (every 5 min) eventually corrects it — multi-minute over-assignment window.
- **Fix:** In the WS identify reconnect path, recompute `current_alert_count` from active assignments (reuse the `upsertAgentSession` count query).

### 🟠 HIGH

**D-H1 — Supervisor manual `assign` can resurrect terminal alerts.**
`distribution.ts:746` → `reassignAlert` (`alertDistribution.ts:619-661`) has **no status guard** (`WHERE alert_id=$1` only). It will re-open a `resolved`/`expired`/`escalated` alert back to `assigned` and increment the new agent's count.
- **Scenario:** Supervisor assigns from a stale UI list → a resolved alert reappears in an agent's inbox, with stale `resolved_at`/`resolution` left on the row. → Add `AND status IN ('pending','assigned','acknowledged','escalated')` to the UPDATE.

**D-H2 — Resolution-timeout escalation has the same missing status guard.**
`timeoutMonitor.ts:215-245` → `escalateAlert` (`alertDistribution.ts:587-617`) guards on `assigned_to` but not status. If the alert was resolved in the gap between the timed-out query and the UPDATE, it overwrites a `resolved` alert to `escalated` and wrongly decrements the agent's count. → Add `AND status IN ('assigned','acknowledged')`.

**D-H3 — `reassignAlert` count interactions contribute to drift.**
`alertDistribution.ts:638-647` decrements old / increments new unconditionally, including when the old agent's count was already zeroed by `setAgentOffline`. `GREATEST(0, …)` prevents negatives and `reconcileAlertCounts` self-heals, but it's a transient under-count. → Guard the same-agent case; acceptable to lean on reconciliation otherwise.

### 🟡 MEDIUM

- **D-M1 — Two-phase `distributeAlert` is not atomic, and dedup is marked too early** (`distributionEngine.ts:355-401`). `createAlertAssignment` (pending) and `assignAlertToAgent` (→assigned) are separate transactions; `markSeen` runs *before* assignment. If assignment throws, the alert survives as pending (recoverable) but a re-fire of the same vehicle+type within 5 min is suppressed. → Mark dedup only after successful assignment.
- **D-M2 — Capacity can be exceeded under concurrent jobs; no DB-level cap.** `findBestAgent` checks `current_alert_count < max` against a *read snapshot* (`distributionEngine.ts:230-234`); `assignAlertToAgent` increments unconditionally with no `max_alerts` backstop. The pending distributor (30s), live poll (15s), and timeout monitor (60s) run independently and can each assign against the same stale snapshot, pushing an agent a few alerts past `max_alerts`. Bounded and self-healing, but real. → Enforce capacity in the assignment UPDATE itself.
- **D-M3 — `enforceRuleIsolation` is fired fire-and-forget on every WS identify + login** (`index.ts:152`, `distribution.ts:125`); concurrent invocations are safe (the second's `WHERE status='assigned'` no-ops) but noisy. Logic is otherwise **correct** — only touches unacked assigned alerts, won't wrongly reset valid ones. No fix required.
- **D-M4 — `break_requested` agents keep their alerts** until ack-timeout (related to D-C1); they're correctly excluded from *new* assignments but nothing reassigns their existing unacked alerts. Minor.

### 🟢 LOW

- **D-L1 — Authz gap: ack/resolve/escalate trust a self-asserted `userId`.** The DB guard is `WHERE assigned_to=$2`, but `requireRole` only checks the caller is *a* valid agent — it does **not** verify `req.body.userId` == authenticated user (`distribution.ts:93,154`). A buggy/malicious agent could ack/resolve another agent's alert by passing the victim's id. (`agent-history` *does* cross-check at `distribution.ts:1332` — pattern was known but not applied here.) LOW because it's LAN-scoped + CRM-login. → Derive the acting user from the authenticated session, not the body.
- **D-L2 — Performance metric inflation:** `updateAgentPerformance({alertsReceived:1})` increments on both initial assign and re-distribution from pending (`distributionEngine.ts:395,449`), so a re-distributed alert inflates `alerts_received` across multiple agents, skewing the score. Cosmetic.

### ✅ What's already solid (verified correct)
- **Single-alert double-assignment is provably prevented.** `assignAlertToAgent` (`alertDistribution.ts:416-438`) uses `UPDATE … WHERE alert_id=$1 AND status='pending'` inside a transaction with the count increment in the same transaction; two concurrent callers — only one UPDATE matches, the other gets no row and handles it.
- **Failure invariants hold exactly as documented.** `findBestAgent` returns `null` on rule-load error (`distributionEngine.ts:250-255`); `findAlternateAgent` returns `null` on error (`timeoutMonitor.ts:40-45`); `enforceRuleIsolation` returns `0` (no resets) on rule error. **No `.catch(() => [])` on the agents/rules loaders.** Never falls back to empty rules.
- Rule-priority evaluation, `dedicatedAgentIds` fallback exclusion, and "rule matched but all at capacity → null (stay pending)" all match the documented design and are consistent between `findBestAgent` and `findAlternateAgent`.

---

## Prioritized Remediation Plan

**Before any production exposure (CRITICAL):**
1. Add auth middleware to all `/api/*` business routes (P-C1).
2. Remove + rotate the hardcoded SSH password; scrub git history (P-C2).
3. Fix CDR command injection — validate `uniqueid`, use `execFile` (P-C3).
4. Return unacked alerts to `pending` on agent disconnect + kick the distributor (D-C1).

**Next (HIGH):**
5. Remove all DB/admin/JWT secret fallbacks (P-H1).
6. Make `uncaughtException` exit so PM2 restarts cleanly (P-H2).
7. Surface SIP call/hold/transfer failures to the UI (S-C1, S-C2, S-H1).
8. Recompute agent alert count on WS reconnect (D-C2).
9. Add status guards to `reassignAlert` / `escalateAlert` (D-H1, D-H2).
10. Track consult destination UUID explicitly for attended transfer (S-H2).

**Then (MEDIUM):** type-check/compile before deploy, real readiness/health signals, structured logging, complete V2 PBX-admin migration, stop media tracks on hangup, DB-level capacity cap, dedup-after-assign.

---
*Generated from a read-only audit. No source files were modified. Line references reflect the working tree at 2026-05-29.*
