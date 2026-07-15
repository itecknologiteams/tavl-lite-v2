# Vehicle Call History — Design Spec

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan
**Area:** Agent Dashboard → Vehicle History panel

## Goal

Add a **"Calls"** tab to the agent Vehicle History slide-out panel that shows
call detail records (CDR) from FreeSWITCH/FusionPBX for the selected customer's
phone numbers. Agents can see when calls happened, their direction, source and
destination, duration, and outcome — without leaving the vehicle panel.

## Background

The Vehicle History panel (`src/features/dashboard/components/VehicleDetailPanel.tsx`,
slide-out at line ~1751) currently has two tabs:

- **Technical** → `VehicleLogsPanel` (ERP_Tracking service logs)
- **Closure** → `VehicleClosurePanel` (Tracking EventLog + Warning Console)

Most of the data plumbing for call history already exists:

- CDR is queryable from `v_xml_cdr` (FusionPBX PG) via `server/routes/cdr.ts`,
  backed by `server/db/fusionpbx.ts`. Available columns include
  `start_stamp`, `caller_id_name`, `caller_id_number`, `destination_number`,
  `direction`, `duration`, `billsec`, `hangup_cause`, `record_path`,
  `record_name`, `bridge_uuid`, `xml_cdr_uuid`.
- The customer's phone numbers are already loaded on the frontend in `crmData`
  when a vehicle is selected (`VehicleDetailPanel.tsx`). Fields: `CellNo`
  (primary, CONT1), `TelephoneNo` (secondary, CONT2), `AlternateContact`
  (CONT3), `SecondaryContact`, `SecondaryContact2`, `EmergencyContactNumber`,
  `EmergencyContactNumber2`.
- Phone normalization (strip `+92`/`92` prefix, ensure leading `0`) already
  exists in `VehicleDetailPanel`.

The FusionPBX PG connection is configured with `timezone = 'Asia/Karachi'`, so
CDR timestamps arrive in PKT and need no timezone correction (unlike the CRM
logs, which require the `parseCrmDateTime` workaround).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Which numbers to match | **All** contact numbers (primary, secondary, alternate, security, emergency) |
| Match logic | Number appears as **either** caller **or** callee (OR across all numbers + both directions) |
| Recordings | **Not in this cut** (metadata only); rows carry `xml_cdr_uuid` so a play button is a drop-in later |
| Default time window | **30 days**, with presets **7d / 30d / 90d / All** |
| Layout | **Flat reverse-chronological list** (newest first) |

## Non-goals

- No recording playback in this iteration.
- No changes to the existing `GET /api/cdr` endpoint (wallboard/admin use it).
- No search/filter box inside the Calls tab in this cut (presets + flat list only).
- No pagination UI; a single capped query (limit ~300) is sufficient for the
  default windows. If "All" returns more than the cap, the panel notes that the
  list is truncated rather than silently dropping records.

## Architecture

### Backend — new isolated endpoint

Add `GET /api/cdr/customer` to `server/routes/cdr.ts`, kept separate from the
existing `/api/cdr` route so existing behavior is untouched.

**Query params:**

- `numbers` — comma-separated phone numbers (raw; server normalizes)
- `dateFrom`, `dateTo` — `YYYY-MM-DD HH:mm:ss`
- `limit` — optional, default 300, hard cap 300

**Behavior:**

1. Split `numbers`, strip non-digits, reduce each to its **last 10 digits**,
   drop entries shorter than 7 digits, dedupe. (Last-10-digit suffix matching
   handles `+92`/`92`/`0` prefix variance between CRM-stored numbers and the
   dialed strings recorded in CDR.)
2. If no usable numbers remain, return `{ success: true, data: [] }` without
   querying.
3. Build a parameterized query:

   ```sql
   SELECT <same column mapping as existing /api/cdr>
   FROM v_xml_cdr
   WHERE start_stamp BETWEEN $from AND $to
     AND ( <for each number d:>  caller_id_number LIKE '%' || $d
           OR destination_number LIKE '%' || $d )   -- groups OR'd together
     AND destination_number NOT LIKE 'autocall_%'    -- existing exclusion
   ORDER BY start_stamp DESC
   LIMIT $limit
   ```

   Each number contributes one `(caller LIKE … OR dst LIKE …)` group; the groups
   are OR'd. All values parameterized (`$1`, `$2`, …).
4. Map rows to the same normalized shape the existing CDR endpoint produces and
   return `{ success: true, data: rows, truncated: rows.length >= limit }`.

**Helper (testable, pure):** a `buildCustomerCdrQuery(numbers, from, to, limit)`
function returning `{ text, values }`, plus a `normalizeNumbers(raw[])` function.
These are unit-testable without a DB.

### Frontend — API client

Add a new `cdr` surface to `src/services/api.ts` (none exists today):

```ts
api.cdr.getCustomerHistory(
  numbers: string[],
  dateFrom: string,
  dateTo: string,
): Promise<{ success: boolean; data?: CallRecord[]; truncated?: boolean; error?: string }>
```

Builds a `URLSearchParams` query (following the existing `alerts.getRecent`
pattern) and calls `apiFetch('/cdr/customer?…')`.

### Frontend — new panel component

`src/features/dashboard/components/VehicleCallHistoryPanel.tsx`

**Props:** the customer's `crmData` (or a pre-extracted `numbers: string[]`)
and `vehicleName: string`.

**Logic:**

- Derive the searchable numbers from `crmData` fields (`CellNo`, `TelephoneNo`,
  `AlternateContact`, `SecondaryContact`, `SecondaryContact2`,
  `EmergencyContactNumber`, `EmergencyContactNumber2`): normalize, drop empties
  and entries < 7 digits, dedupe by last-10-digits.
- Range preset state (`7d | 30d | 90d | all`), default `30d`. Compute
  `dateFrom`/`dateTo` from the preset (`all` sends a wide floor date).
- Fetch on mount and whenever the preset or the vehicle's numbers change.

**Render (flat reverse-chron list):** each row shows

- direction icon (inbound / outbound / local from the `direction` field),
- `src → dst`, with the customer's matched number visually highlighted,
- call date + time (PKT, formatted from `start_stamp`),
- duration as `mm:ss`,
- disposition badge, color-coded (reuse the badge style from `VehicleLogsPanel`).

**States:**

- **Loading** — spinner (matches existing panels).
- **Error** — explicit error message with a retry affordance. (Deliberately
  *not* swallowed the way `VehicleLogsPanel` swallows fetch errors.)
- **Empty (no numbers)** — "No phone numbers on file for this customer." Skips
  the fetch entirely.
- **Empty (no calls)** — "No calls found for this customer's numbers in the
  selected period."
- **Truncated** — small note when the result hit the cap.

**Header line:** shows which normalized numbers were searched and the total
count returned.

### Frontend — tab wiring

In `VehicleDetailPanel.tsx`:

- Extend the `vehicleHistoryTab` type to include `'calls'`.
- Add a "Calls" button to the tab group in the panel header (line ~1771).
- Render `<VehicleCallHistoryPanel>` when the active tab is `'calls'`.

## Data flow

1. Agent selects a vehicle → `crmData` (incl. phone numbers) loads as today.
2. Agent opens Vehicle History → switches to the **Calls** tab.
3. Panel extracts + normalizes the customer's numbers, computes the default 30d
   window, calls `api.cdr.getCustomerHistory(...)`.
4. Server normalizes numbers, runs the OR/suffix query against `v_xml_cdr`,
   returns reverse-chron rows.
5. Panel renders the flat list; changing a preset re-queries.

## Error handling

- Backend: invalid/empty `numbers` → `{ success: true, data: [] }` (not an
  error). DB failure → `{ success: false, error }` with 500, logged server-side.
- Frontend: any non-success response or network failure renders the explicit
  error state with retry. No silent failures.

## Testing / verification

- **Backend unit tests** for the pure helpers:
  - `normalizeNumbers` — prefix stripping, last-10 reduction, dedupe, dropping
    short entries.
  - `buildCustomerCdrQuery` — correct OR grouping, parameter count/order, date
    bounds, limit, autocall exclusion.
- **Manual verification:**
  - Select a vehicle with known numbers; confirm calls appear, newest first.
  - Verify direction icon, `src → dst` highlight, duration, disposition badge.
  - Toggle presets (7d/30d/90d/All) and confirm re-query.
  - Verify empty-no-numbers, empty-no-calls, and error states.
  - Confirm the existing Technical/Closure tabs and the wallboard CDR are
    unaffected.

## Files touched

| File | Change |
|---|---|
| `server/routes/cdr.ts` | New `GET /api/cdr/customer` endpoint + `normalizeNumbers` / `buildCustomerCdrQuery` helpers |
| `src/services/api.ts` | New `api.cdr.getCustomerHistory(...)` |
| `src/features/dashboard/components/VehicleCallHistoryPanel.tsx` | New panel (~200 lines) |
| `src/features/dashboard/components/VehicleDetailPanel.tsx` | Add `'calls'` tab + render new panel |
| test file for cdr helpers | New unit tests |
