/**
 * Pure, DB-free helpers for the customer Call History feature.
 * Kept separate from cdr.ts so they can be unit-tested without importing
 * the FusionPBX connection, fs, child_process, etc.
 */

/**
 * Normalize a list of raw phone numbers (as stored in CRM) into match keys.
 * - strips all non-digits
 * - drops anything shorter than 7 digits (extensions, junk)
 * - reduces to the last 10 digits (handles +92 / 92 / 0 prefix variance
 *   between CRM-stored numbers and the dialed strings recorded in CDR)
 * - de-duplicates, preserving order
 */
export function normalizeNumbers(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (!r) continue;
    const digits = String(r).replace(/\D/g, '');
    if (digits.length < 7) continue;
    const key = digits.length > 10 ? digits.slice(-10) : digits;
    if (key.length < 7) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

const DISPOSITION_CASE = `
  CASE
    WHEN hangup_cause = 'NORMAL_CLEARING' AND billsec > 0 THEN 'ANSWERED'
    WHEN hangup_cause IN ('NO_ANSWER','NO_USER_RESPONSE','ORIGINATOR_CANCEL') THEN 'NO ANSWER'
    WHEN hangup_cause = 'USER_BUSY' THEN 'BUSY'
    ELSE 'FAILED'
  END`;

/**
 * Build the parameterized query that fetches CDR where ANY of the given
 * (already-normalized) numbers appears as EITHER caller or destination.
 *
 * Param order: $1=from, $2=to, $3..$(2+N)=numbers, $(3+N)=limit.
 * Caller must guarantee `numbers` is non-empty.
 */
export function buildCustomerCdrQuery(
  numbers: string[],
  from: string,
  to: string,
  limit: number
): { text: string; values: any[] } {
  const values: any[] = [from, to];

  const orGroups = numbers.map((n) => {
    values.push(n);
    const idx = values.length; // $idx
    return `(caller_id_number LIKE '%' || $${idx} OR destination_number LIKE '%' || $${idx})`;
  });

  values.push(limit);
  const limitIdx = values.length;

  const text = `
    SELECT
      xml_cdr_uuid as id,
      start_stamp as calldate,
      caller_id_name as clid,
      caller_id_number as src,
      destination_number as dst,
      caller_destination,
      source_number,
      direction,
      context,
      cc_side,
      cc_queue,
      cc_agent,
      cc_agent_type,
      duration::int as duration,
      billsec::int as billsec,
      hangup_cause,
      ${DISPOSITION_CASE} as disposition,
      missed_call,
      direction as userfield,
      xml_cdr_uuid as uniqueid,
      record_name,
      record_path
    FROM v_xml_cdr
    WHERE start_stamp >= $1 AND start_stamp <= $2
      AND (${orGroups.join(' OR ')})
      AND destination_number NOT LIKE 'autocall_%'
    ORDER BY start_stamp DESC
    LIMIT $${limitIdx}
  `;

  return { text, values };
}

// ---------------------------------------------------------------------------
// Call classification / enrichment (pure)
// ---------------------------------------------------------------------------

const AUTOCALL_CALLERID = '02138658849';
const AUTOCALL_NAME = 'iTecknologi';

export interface CdrRowRaw {
  src?: string | null;            // caller_id_number
  clid?: string | null;          // caller_id_name
  dst?: string | null;           // destination_number (may be a leg UUID)
  caller_destination?: string | null;
  source_number?: string | null;
  direction?: string | null;
  cc_side?: string | null;
  cc_agent?: string | null;
  cc_queue?: string | null;
  hangup_cause?: string | null;
  billsec?: number | null;
  [key: string]: any;
}

export interface CallEnrichment {
  callType: 'autocall' | 'inbound' | 'outbound' | 'internal' | 'failed';
  outcome: 'answered' | 'no_answer' | 'busy' | 'abandoned' | 'cancelled' | 'failed';
  fromLabel: string;
  fromSub: string;
  toLabel: string;
  toSub: string;
  agentName: string;   // resolved internal party name, if any
  queue: string;       // short queue name, if any
}

const stripDomain = (v?: string | null): string => (v ? String(v).split('@')[0].trim() : '');
const isUuid = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);

/** Resolve an extension/agent token to {ext, name}, or null if not internal. */
function resolveParty(
  value: string | null | undefined,
  extMap: Record<string, string>,
  agentMap: Record<string, string>
): { ext: string; name: string } | null {
  if (!value) return null;
  const v = stripDomain(value);
  if (!v) return null;
  if (isUuid(v)) {
    const name = agentMap[v];
    return name != null ? { ext: '', name } : null;
  }
  if (Object.prototype.hasOwnProperty.call(extMap, v)) {
    return { ext: v, name: extMap[v] || '' };
  }
  // short numeric tokens that aren't external phone numbers → treat as extension
  if (/^\d{2,5}$/.test(v)) return { ext: v, name: '' };
  return null;
}

function callOutcome(cause: string, billsec: number, isQueue: boolean): CallEnrichment['outcome'] {
  if (billsec > 0) return 'answered';
  switch (cause) {
    case 'USER_BUSY':
      return 'busy';
    case 'ORIGINATOR_CANCEL':
      return isQueue ? 'abandoned' : 'cancelled';
    case 'NO_ANSWER':
    case 'NO_USER_RESPONSE':
    case 'NORMAL_CLEARING':
      return 'no_answer';
    case 'NO_ROUTE_DESTINATION':
    case 'UNALLOCATED_NUMBER':
    case 'CALL_REJECTED':
    case 'SUBSCRIBER_ABSENT':
      return 'failed';
    default:
      return 'failed';
  }
}

export function isAutocallRow(row: CdrRowRaw): boolean {
  return (
    row.src === AUTOCALL_CALLERID ||
    (row.clid || '').toLowerCase() === AUTOCALL_NAME.toLowerCase() ||
    /^autocall/i.test(row.dst || '')
  );
}

/**
 * Classify a CDR row into a human-readable call: type, outcome, from/to labels
 * with resolved agent names. Pure — extMap (ext -> name) and agentMap
 * (agent_uuid -> name) are provided by the caller.
 */
export function classifyCall(
  row: CdrRowRaw,
  extMap: Record<string, string> = {},
  agentMap: Record<string, string> = {}
): CdrRowRaw & CallEnrichment {
  const src = (row.src || '').trim();
  const dst = (row.dst || '').trim();
  const callerDest = (row.caller_destination || '').trim();
  const cause = (row.hangup_cause || '').trim();
  const billsec = Number(row.billsec || 0);
  const isQueue = !!row.cc_side || !!row.cc_queue;
  const queue = stripDomain(row.cc_queue).replace(/@.*/, '') || '';
  const outcome = callOutcome(cause, billsec, isQueue);

  let enrichment: CallEnrichment;

  if (isAutocallRow(row)) {
    enrichment = {
      callType: 'autocall',
      outcome,
      fromLabel: 'Autocall',
      fromSub: AUTOCALL_NAME,
      toLabel: dst || callerDest || '—',
      toSub: 'Customer',
      agentName: '',
      queue,
    };
  } else if (cause === 'NO_ROUTE_DESTINATION') {
    enrichment = {
      callType: 'failed',
      outcome: 'failed',
      fromLabel: src || '—',
      fromSub: '',
      toLabel: dst || callerDest || '—',
      toSub: '',
      agentName: '',
      queue,
    };
  } else {
    const srcParty = resolveParty(src, extMap, agentMap);
    const dstParty =
      resolveParty(row.cc_agent, extMap, agentMap) ||
      resolveParty(callerDest, extMap, agentMap) ||
      resolveParty(dst, extMap, agentMap);

    if (isQueue || (row.direction === 'inbound' && dstParty && !srcParty)) {
      // Inbound call routed to an agent via the queue
      const agent = dstParty;
      enrichment = {
        callType: 'inbound',
        outcome,
        fromLabel: src || '—',
        fromSub: 'Customer',
        toLabel: agent ? (agent.ext ? `Ext ${agent.ext}` : agent.name || 'Agent') : callerDest || 'Queue',
        toSub: agent?.name || (queue ? 'Queue' : ''),
        agentName: agent?.name || '',
        queue,
      };
    } else if (srcParty && !dstParty) {
      // Internal extension dialing an external number
      enrichment = {
        callType: 'outbound',
        outcome,
        fromLabel: srcParty.ext ? `Ext ${srcParty.ext}` : srcParty.name || 'Agent',
        fromSub: srcParty.name,
        toLabel: dst || callerDest || '—',
        toSub: 'Customer',
        agentName: srcParty.name,
        queue,
      };
    } else if (!srcParty && dstParty) {
      // External number reaching an internal extension directly
      enrichment = {
        callType: 'inbound',
        outcome,
        fromLabel: src || '—',
        fromSub: 'Customer',
        toLabel: dstParty.ext ? `Ext ${dstParty.ext}` : dstParty.name || 'Agent',
        toSub: dstParty.name,
        agentName: dstParty.name,
        queue,
      };
    } else if (srcParty && dstParty) {
      enrichment = {
        callType: 'internal',
        outcome,
        fromLabel: srcParty.ext ? `Ext ${srcParty.ext}` : srcParty.name,
        fromSub: srcParty.name,
        toLabel: dstParty.ext ? `Ext ${dstParty.ext}` : dstParty.name,
        toSub: dstParty.name,
        agentName: dstParty.name || srcParty.name,
        queue,
      };
    } else {
      // Fall back to raw direction
      const inbound = row.direction === 'inbound';
      enrichment = {
        callType: inbound ? 'inbound' : 'outbound',
        outcome,
        fromLabel: src || '—',
        fromSub: inbound ? 'Customer' : '',
        toLabel: dst || callerDest || '—',
        toSub: inbound ? '' : 'Customer',
        agentName: '',
        queue,
      };
    }
  }

  return { ...row, ...enrichment };
}
