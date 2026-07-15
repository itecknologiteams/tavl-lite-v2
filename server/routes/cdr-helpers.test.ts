import { describe, it, expect } from 'vitest';
import { normalizeNumbers, buildCustomerCdrQuery, classifyCall, isAutocallRow } from './cdr-helpers';

describe('normalizeNumbers', () => {
  it('strips non-digits and reduces to last 10 digits', () => {
    expect(normalizeNumbers(['0300-123 4567'])).toEqual(['3001234567']);
    expect(normalizeNumbers(['+923001234567'])).toEqual(['3001234567']);
    expect(normalizeNumbers(['923001234567'])).toEqual(['3001234567']);
  });

  it('treats +92 / 92 / 0 prefixed variants of one number as the same key', () => {
    expect(normalizeNumbers(['03001234567', '+923001234567', '923001234567']))
      .toEqual(['3001234567']);
  });

  it('keeps numbers of 7-10 digits as-is', () => {
    expect(normalizeNumbers(['2138650302'])).toEqual(['2138650302']); // 10-digit landline
    expect(normalizeNumbers(['1234567'])).toEqual(['1234567']);       // 7-digit
  });

  it('drops entries shorter than 7 digits and empty/nullish values', () => {
    expect(normalizeNumbers(['123', '', null, undefined, '  ', '111'])).toEqual([]);
  });

  it('de-duplicates while preserving order', () => {
    expect(normalizeNumbers(['03001234567', '02138650302', '03001234567']))
      .toEqual(['3001234567', '2138650302']);
  });
});

describe('buildCustomerCdrQuery', () => {
  it('orders params as from, to, ...numbers, limit', () => {
    const { values } = buildCustomerCdrQuery(['3001234567', '2138650302'], 'FROM', 'TO', 300);
    expect(values).toEqual(['FROM', 'TO', '3001234567', '2138650302', 300]);
  });

  it('emits one (caller OR destination) group per number, OR-joined', () => {
    const { text } = buildCustomerCdrQuery(['3001234567', '2138650302'], 'FROM', 'TO', 300);
    expect(text).toContain("caller_id_number LIKE '%' || $3 OR destination_number LIKE '%' || $3");
    expect(text).toContain("caller_id_number LIKE '%' || $4 OR destination_number LIKE '%' || $4");
    // two groups joined by OR
    expect(text.match(/\) OR \(/g)?.length).toBe(1);
  });

  it('excludes autocall destinations and orders newest first', () => {
    const { text } = buildCustomerCdrQuery(['3001234567'], 'FROM', 'TO', 50);
    expect(text).toContain("destination_number NOT LIKE 'autocall_%'");
    expect(text).toContain('ORDER BY start_stamp DESC');
  });

  it('references the limit param last', () => {
    const { text, values } = buildCustomerCdrQuery(['3001234567'], 'FROM', 'TO', 50);
    // from=$1,to=$2,number=$3,limit=$4
    expect(text).toContain('LIMIT $4');
    expect(values[values.length - 1]).toBe(50);
  });

  it('selects caller_destination and the cc_* enrichment columns', () => {
    const { text } = buildCustomerCdrQuery(['3001234567'], 'FROM', 'TO', 50);
    expect(text).toContain('caller_destination');
    expect(text).toContain('cc_agent');
    expect(text).toContain('hangup_cause');
  });
});

describe('isAutocallRow', () => {
  it('detects autocall by caller id, caller name, or autocall_ destination', () => {
    expect(isAutocallRow({ src: '02138658849', dst: '03216158906' })).toBe(true);
    expect(isAutocallRow({ clid: 'iTecknologi', dst: '03001234567' })).toBe(true);
    expect(isAutocallRow({ dst: 'autocall_ivr' })).toBe(true);
    expect(isAutocallRow({ src: '03001234567', dst: '2138650302' })).toBe(false);
  });
});

describe('classifyCall', () => {
  const extMap = { '467': 'Bilal Khan', '222': 'Aamir Lodhi' };
  const agentMap = { '7323adfd-bb1c-42f9-87e2-4f2864f7c8b8': 'Night Desk' };

  it('classifies an autocall to a customer', () => {
    const r = classifyCall({ src: '02138658849', clid: 'iTecknologi', dst: '03216158906', hangup_cause: 'NO_USER_RESPONSE', billsec: 0 });
    expect(r.callType).toBe('autocall');
    expect(r.toLabel).toBe('03216158906');
    expect(r.outcome).toBe('no_answer');
  });

  it('classifies an inbound queue call, resolving the agent ext (UUID leg in dst)', () => {
    const r = classifyCall(
      { src: '03004299401', dst: 'otje1uib', caller_destination: '467', cc_side: 'agent', cc_agent: '467@192.168.20.140', cc_queue: 'tavl-agents@192.168.20.140', direction: 'inbound', hangup_cause: 'NO_USER_RESPONSE', billsec: 0 },
      extMap, agentMap
    );
    expect(r.callType).toBe('inbound');
    expect(r.fromLabel).toBe('03004299401');
    expect(r.toLabel).toBe('Ext 467');
    expect(r.toSub).toBe('Bilal Khan');
    expect(r.agentName).toBe('Bilal Khan');
    expect(r.queue).toBe('tavl-agents');
    expect(r.outcome).toBe('no_answer');
  });

  it('resolves a UUID-style cc_agent via agentMap and marks answered', () => {
    const r = classifyCall(
      { src: '03004395642', dst: '999', caller_destination: '999', cc_side: 'agent', cc_agent: '7323adfd-bb1c-42f9-87e2-4f2864f7c8b8', cc_queue: 'tavl-agents@192.168.20.140', direction: 'inbound', hangup_cause: 'NORMAL_CLEARING', billsec: 30 },
      extMap, agentMap
    );
    expect(r.callType).toBe('inbound');
    expect(r.agentName).toBe('Night Desk');
    expect(r.outcome).toBe('answered');
  });

  it('classifies an agent outbound call to a customer number', () => {
    const r = classifyCall({ src: '222', dst: '03001234567', direction: 'outbound', hangup_cause: 'NORMAL_CLEARING', billsec: 42 }, extMap, agentMap);
    expect(r.callType).toBe('outbound');
    expect(r.fromLabel).toBe('Ext 222');
    expect(r.fromSub).toBe('Aamir Lodhi');
    expect(r.toLabel).toBe('03001234567');
    expect(r.outcome).toBe('answered');
  });

  it('flags NO_ROUTE_DESTINATION misdials as failed', () => {
    const r = classifyCall({ src: '999', dst: '3007027057', hangup_cause: 'NO_ROUTE_DESTINATION', billsec: 0 }, extMap, agentMap);
    expect(r.callType).toBe('failed');
    expect(r.outcome).toBe('failed');
  });

  it('marks a queue caller hangup before answer as abandoned', () => {
    const r = classifyCall(
      { src: '03242442469', dst: '999', caller_destination: '999', cc_side: 'agent', cc_agent: '467@192.168.20.140', cc_queue: 'tavl-agents@192.168.20.140', direction: 'inbound', hangup_cause: 'ORIGINATOR_CANCEL', billsec: 0 },
      extMap, agentMap
    );
    expect(r.outcome).toBe('abandoned');
  });
});
