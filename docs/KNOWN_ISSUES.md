# Known Issues & Technical Debt

Last reviewed: 2026-04-29

---

## Security Issues

### S1 — SSH Password in Shell Commands (HIGH)
**File**: `server/services/asterisk-config.ts:18`
```ts
const sshCmd = `sshpass -p '${PBX_SSH_PASSWORD}' ssh ... "${command}"`;
```
- Password visible in `/proc`, shell history, process lists
- Content escaping with `echo "${escapedContent}"` is incomplete — single quotes not properly handled
- **Recommendation**: Replace with ssh key auth or a proper SSH2 library (node-ssh)

### S2 — SQL injection risk in calls.ts (MEDIUM)
**File**: `server/routes/calls.ts:138`
```ts
WHERE ld.VEH_ID IN (${vehicleIds.join(',')})
```
vehicleIds come from a CRM query result (integers), but the pattern is dangerous. Should use parameterized arrays.

### S3 — No JWT/session auth on distribution routes (MEDIUM)
Distribution routes authenticate via `x-user-id` header or body `userId` field, checked against the `agent_sessions` table. Any caller who knows a userId can impersonate that agent. Should use signed tokens.

### S4 — CORS: `origin: true` (LOW)
**File**: `server/index.ts:351`
Allows all origins. Fine for internal network deployment, but should be locked to known origins in production.

---

## Architecture / Design Issues

### A1 — Two parallel PBX Admin systems
- V1 (`/pbx-admin`) uses SSH to read/write FreeSWITCH config files
- V2 (`/pbx-admin-v2`) uses `pbx_admin` PostgreSQL DB as source of truth
- Both are active, no clear migration plan. **V2 is the correct direction** but V1 still has more complete page coverage.

### A2 — Double Screen Pop trigger
When a SIP.js inbound call arrives:
1. FreeSWITCH ESL fires `CHANNEL_CREATE` → server CRM lookup → WS broadcast `screenPop`
2. SIP.js `Invitation` triggers `incomingCall` event → `callStore.screenPopByPhone()` → separate vehicle lookup
Both can fire for the same call. The ESL path covers agents not using WebRTC; the SIP.js path covers the browser.
**Impact**: Two screen pops may open simultaneously. Needs deduplication.

### A3 — Conference uses polling instead of push
`callStore.pollConferenceParticipants()` polls every 2s when conference is active.
Should push participant changes via WS when ESL fires `CONFERENCE` events.

### A4 — Many root-level debug scripts (~50 files)
All the `check_*.ts`, `fix_*.ts`, `test_*.ts`, `originate_test*.ts` etc. files in the root are debugging artifacts. They connect directly to FreeSWITCH/databases and should be moved to a `scripts/debug/` folder or deleted.

---

## UX Issues

### U1 — `alert()` used in callStore for errors
**File**: `src/store/callStore.ts` (multiple locations)
```ts
alert('⚠️ Please configure your extension...');
```
Blocks the browser UI thread. Should use the existing toast system.

### U2 — Conference failure shows `alert()` too
Same issue as U1 for conference error messages.

---

## Performance Issues

### P1 — CDR recording playback is slow
**File**: `server/routes/cdr.ts:261`
Uses SSH + SCP to copy recording from FreeSWITCH to `/tmp/` then stream to browser.
- SCP over LAN is acceptable (~1–2s) but not ideal
- The tmp file is deleted after streaming but could pile up if many concurrent requests
- **Recommendation**: Mount FS recordings via NFS/SAMBA, or stream directly via SSH pipe

### P2 — Cache sync blocks startup warmup
`runFullSync()` can take 30–120s for large datasets. During this time, vehicle data may be stale.

---

## Resolved Issues (recent)
- ✅ Replaced Asterisk AMI with FreeSWITCH ESL (esl.ts)
- ✅ SIP WS proxy — eliminated self-signed cert problem in browser
- ✅ Added WS upgrade handler (noServer mode) to fix path conflicts between SIP proxy and app WS
- ✅ Fixed env vars not loading in calls.ts (dotenv import + lazy read)
- ✅ Server starts HTTP immediately before databases connect (eliminates ECONNREFUSED)
- ✅ ESL reconnects automatically after FreeSWITCH restart
