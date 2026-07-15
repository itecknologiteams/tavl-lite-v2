/**
 * Reusable, cached CRM "phone number → customer + vehicles" lookup.
 *
 * Extracted from the screen-pop flow (server/index.ts) so both the screen pop
 * and the supervisor Live Calls page resolve numbers the same way. A short TTL
 * cache keyed by the normalized core number keeps the 3-second call-stats poll
 * from hammering the CRM MSSQL box.
 */
import { queryCrm } from '../db/crm';

export interface CrmVehicle { plate: string; make?: string; model?: string }
export interface CrmCustomer { id: number; name: string; address?: string; phone1?: string; phone2?: string }
export interface CrmLookupResult { found: boolean; customer?: CrmCustomer; vehicles?: CrmVehicle[] }

interface CustomerRow { customerId: number; customerName: string; address?: string; phone1?: string; phone2?: string }

const POS_TTL_MS = 30 * 60 * 1000; // matched customers change rarely
const NEG_TTL_MS = 5 * 60 * 1000;  // re-check "unknown" numbers sooner

const cache = new Map<string, { result: CrmLookupResult; expiresAt: number }>();

/**
 * Reduce any phone format to its core national number:
 * strip non-digits, then a +92/92 country code, then a leading 0.
 * Mirrors the normalization used by the screen-pop handler.
 */
export function normalizePhone(raw: string): string {
  let n = (raw || '').replace(/\D/g, '');
  if (n.startsWith('92') && n.length > 10) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  return n;
}

// Remove the same characters the CRM SQL strips before a LIKE match.
function cleanContact(c?: string): string {
  return (c || '').replace(/[\s\-()+]/g, '');
}

/**
 * Map each requested core number to the customer row whose CONT1/CONT2
 * contains it (mirrors the SQL `LIKE %core%`). Cores with no match are omitted.
 */
export function matchCustomersToCores(
  rows: CustomerRow[],
  cores: string[],
): Map<string, CustomerRow> {
  const out = new Map<string, CustomerRow>();
  for (const core of cores) {
    if (out.has(core)) continue;
    const hit = rows.find((r) => {
      const c1 = cleanContact(r.phone1);
      const c2 = cleanContact(r.phone2);
      return (c1 && c1.includes(core)) || (c2 && c2.includes(core));
    });
    if (hit) out.set(core, hit);
  }
  return out;
}

interface VehicleRow { customerId: number | string; plate?: string; make?: string; model?: string }

/**
 * Group vehicle rows by customer id. CRM returns ids as strings, so we coerce
 * to Number to key consistently with the numeric ids used elsewhere. Rows with
 * no plate are skipped (but the customer key is still created, empty).
 */
export function groupVehiclesByCustomer(vrows: VehicleRow[]): Map<number, CrmVehicle[]> {
  const out = new Map<number, CrmVehicle[]>();
  for (const vr of vrows) {
    const id = Number(vr.customerId);
    if (!Number.isFinite(id)) continue;
    const list = out.get(id) || [];
    if (vr.plate) list.push({ plate: vr.plate, make: vr.make, model: vr.model });
    out.set(id, list);
  }
  return out;
}

const C1 = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.CONT1,' ',''),'-',''),'(',''),')',''),'+','')";
const C2 = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.CONT2,' ',''),'-',''),'(',''),')',''),'+','')";

/** Look up many numbers at once; returns a Map keyed by core number. Cached. */
export async function lookupCustomersByPhones(numbers: string[]): Promise<Map<string, CrmLookupResult>> {
  const result = new Map<string, CrmLookupResult>();
  const now = Date.now();

  // Distinct, valid cores.
  const cores = [...new Set(numbers.map(normalizePhone).filter((c) => c.length >= 6))];
  const toFetch: string[] = [];
  for (const core of cores) {
    const c = cache.get(core);
    if (c && c.expiresAt > now) result.set(core, c.result);
    else toFetch.push(core);
  }
  if (toFetch.length === 0) return result;

  try {
    const where = toFetch.map((_, i) => `(${C1} LIKE @p${i} OR ${C2} LIKE @p${i})`).join(' OR ');
    const params: Record<string, string> = {};
    toFetch.forEach((core, i) => { params[`p${i}`] = `%${core}%`; });

    const rows: CustomerRow[] = await queryCrm(
      `SELECT c.CUST_ID as customerId, c.FNAME as customerName, c.ADRESS as address,
              c.CONT1 as phone1, c.CONT2 as phone2
       FROM CUSTOMER c WITH (NOLOCK)
       WHERE ${where}`,
      params,
    );

    const matched = matchCustomersToCores(rows, toFetch);

    // Batch-fetch vehicles for all matched customers.
    const custIds = [...new Set([...matched.values()].map((r) => Number(r.customerId)).filter(Number.isFinite))];
    let vehiclesByCust = new Map<number, CrmVehicle[]>();
    if (custIds.length > 0) {
      const vrows: VehicleRow[] = await queryCrm(
        `SELECT i.CUST_ID as customerId, v.VEH_REG as plate, mk.MK_NAME as make, m.M_NAME as model
         FROM INSTALLATION i WITH (NOLOCK)
         INNER JOIN VEHICLES v WITH (NOLOCK) ON i.V_ID = v.V_ID
         LEFT JOIN MAKE mk WITH (NOLOCK) ON v.MK_ID = mk.MK_ID
         LEFT JOIN MODEL m WITH (NOLOCK) ON v.M_ID = m.M_ID
         WHERE i.CUST_ID IN (${custIds.join(',')})`,
        {},
      );
      vehiclesByCust = groupVehiclesByCustomer(vrows);
    }

    for (const core of toFetch) {
      const row = matched.get(core);
      let res: CrmLookupResult;
      if (row) {
        res = {
          found: true,
          customer: { id: row.customerId, name: row.customerName, address: row.address, phone1: row.phone1, phone2: row.phone2 },
          vehicles: vehiclesByCust.get(Number(row.customerId)) || [],
        };
      } else {
        res = { found: false };
      }
      cache.set(core, { result: res, expiresAt: now + (res.found ? POS_TTL_MS : NEG_TTL_MS) });
      result.set(core, res);
    }
  } catch (err: any) {
    // CRM slow/unreachable: return what we have (cache hits) and do NOT cache
    // failures, so the next poll retries. Callers fall back to raw numbers.
    console.error('CRM lookup error:', err.message);
  }

  return result;
}

// Cores currently being fetched, so repeated polls don't stack duplicate
// queries (or exhaust the small CRM connection pool) for the same number.
const inFlight = new Set<string>();

/**
 * Synchronous, cache-only read — returns just the cores that are already cached
 * and unexpired. Never touches the DB, so it can sit on a hot request path (the
 * 3-second call-stats poll) without ever blocking on CRM latency.
 */
export function getCachedCustomers(numbers: string[]): Map<string, CrmLookupResult> {
  const out = new Map<string, CrmLookupResult>();
  const now = Date.now();
  for (const raw of numbers) {
    const core = normalizePhone(raw);
    if (core.length < 6) continue;
    const c = cache.get(core);
    if (c && c.expiresAt > now) out.set(core, c.result);
  }
  return out;
}

/**
 * Fire-and-forget cache warmer. Queries CRM only for cores that are missing or
 * expired AND not already in flight, then lets lookupCustomersByPhones populate
 * the cache. Callers do NOT await this — the freshly cached values are picked up
 * by the next getCachedCustomers() read (e.g. the next poll ~3s later).
 */
export function refreshCustomersByPhones(numbers: string[]): void {
  const now = Date.now();
  const stale = [...new Set(numbers.map(normalizePhone).filter((c) => c.length >= 6))]
    .filter((core) => {
      const c = cache.get(core);
      return (!c || c.expiresAt <= now) && !inFlight.has(core);
    });
  if (stale.length === 0) return;
  stale.forEach((c) => inFlight.add(c));
  void lookupCustomersByPhones(stale).finally(() => stale.forEach((c) => inFlight.delete(c)));
}

/** Single-number lookup (used by the screen-pop handler). Cached. */
export async function lookupCustomerByPhone(number: string): Promise<CrmLookupResult> {
  const core = normalizePhone(number);
  if (core.length < 6) return { found: false };
  const map = await lookupCustomersByPhones([number]);
  return map.get(core) || { found: false };
}
