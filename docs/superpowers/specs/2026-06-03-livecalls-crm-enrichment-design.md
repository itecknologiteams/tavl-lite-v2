# Live Calls — CRM Enrichment Design

**Date:** 2026-06-03
**Status:** Approved

## Problem

The supervisor Live Calls page (`LiveCallsPanel`) shows raw phone numbers in three
lists: abandoned call-backs, queue-waiting callers, and active inbound calls. A
supervisor can't tell *who* a number belongs to, which is needed both for situational
awareness and as the foundation for a later "assign abandoned call-back to an agent"
feature.

The app already resolves a number → customer in the screen-pop flow (an inline CRM SQL
query in `server/index.ts`). We will reuse that capability to label numbers on the Live
Calls page with the customer name and their vehicle.

## Scope

- Enrich **all three lists**: abandoned, queue-waiting, active inbound.
- Display **customer name (primary) + vehicle plate and make/model (subtext)**.
- Fall back to the raw number (or trunk-provided caller-id name) when unmatched.
- Non-goals: the callback-assignment feature (separate spec), UI layout overhaul.

## Design

### 1. Shared, cached CRM lookup module — `server/services/crmLookup.ts`

Extract the screen-pop query into a reusable module:

```
interface CrmVehicle  { plate: string; make?: string; model?: string }
interface CrmCustomer { id: number; name: string; address?: string; phone1?: string; phone2?: string }
interface CrmLookupResult { found: boolean; customer?: CrmCustomer; vehicles?: CrmVehicle[] }

normalizePhone(raw): string                                  // strip +92/92/leading-0/non-digits -> core
lookupCustomerByPhone(number): Promise<CrmLookupResult>      // single (screen-pop)
lookupCustomersByPhones(numbers[]): Promise<Map<core, CrmLookupResult>>  // batched (call-stats)
```

- **TTL cache** keyed by core number: positive ~30 min, negative ("not found") ~5 min.
  This is what keeps the 3-second call-stats poll from hammering the CRM MSSQL box.
- `lookupCustomersByPhones` splits requested numbers into cache hits and misses; for the
  misses it runs **one batched `CUSTOMER` query** (OR of normalized `CONT1`/`CONT2` LIKEs)
  plus **one batched `VEHICLES` query** (`CUST_ID IN (...)`), maps results back to cores in
  JS, and caches every requested core (found or not).
- Rich result shape (customer + all vehicles) so it is a drop-in for the screen-pop, which
  is refactored to call `lookupCustomerByPhone`. Both consumers project what they need.

### 2. Enrich `GET /api/supervisor/call-stats` (`server/routes/supervisor.ts`)

After building queue callers, inbound calls, and abandoned callbacks, collect all distinct
numbers, call `lookupCustomersByPhones`, and attach `{ customerName, vehicleReg, vehicleInfo }`
to each item. Wrapped in try/catch with a bounded timeout so a slow/unreachable CRM **never
blocks or 500s** the response — uncached numbers show raw until a later poll fills the cache.

### 3. Frontend `LiveCallsPanel.tsx`

Extend `QueueCaller`, inbound `ActiveCall`, and `AbandonedCallback` with optional
`customerName`, `vehicleReg`, `vehicleInfo`. Render customer name as the primary line, plate +
make/model as subtext, raw number as secondary. Precedence: **CRM name → callerIdName → raw number.**

## Performance & failure

- Distinct numbers/poll ≈ ≤35 (abandoned ≤25 + a few queue + a few inbound). First poll = ~2
  batched queries; subsequent polls within TTL = 0 CRM queries.
- CRM down → rows fall back to raw numbers; page keeps working.

## Verification

- Unit-test `normalizePhone` across `+92` / `92` / leading-`0` / spaced / dashed variants.
- Unit-test the core→customer matching/grouping helper with fixture rows (no live DB).
- On dev: confirm call-stats returns customer fields for a known abandoned number and falls
  back cleanly when CRM is unavailable; confirm the 3s poll only hits CRM on cache misses.
