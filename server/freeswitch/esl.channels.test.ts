import { describe, it, expect } from 'vitest';
import { isAgentChannel, findBridgePartnerUuid } from './esl';

// Shapes mirror real `show channels as json` rows observed on the live FreeSWITCH:
// WebRTC agent legs have a random contact name and the CUSTOMER's cid; the ext is
// only in accountcode. Bridged legs share a call_uuid (no b_uuid column exists).
const webrtcAgentA = {
  uniqueId: 'agentA-uuid', name: 'sofia/internal/07gtsjeh@5uh2q3itmlf9.invalid',
  accountcode: '451', callerId: '03103480076', callUuid: 'callX', state: 'ACTIVE', bridgeId: '',
};
const customer = {
  uniqueId: 'callX', name: 'sofia/wan/03103480076@10.200.173.209',
  accountcode: '', callerId: '03103480076', callUuid: 'callX', state: 'ACTIVE', bridgeId: '',
};
const webrtcAgentBconsult = {
  uniqueId: 'agentB-uuid', name: 'sofia/internal/zz9q0f8r@66sabg3pfvuo.invalid',
  accountcode: '451', callerId: '451', callUuid: 'callY', state: 'ACTIVE', bridgeId: '',
};
const dest453 = {
  uniqueId: 'callY', name: 'sofia/internal/453@192.168.20.140',
  accountcode: '453', callerId: '451', callUuid: 'callY', state: 'ACTIVE', bridgeId: '',
};
const deskphone455 = {
  uniqueId: 'desk-uuid', name: 'sofia/internal/455@192.168.20.140',
  accountcode: '455', callerId: '455', callUuid: 'callZ', state: 'ACTIVE', bridgeId: '',
};

describe('isAgentChannel', () => {
  it('matches a WebRTC agent leg by accountcode (name & cid do NOT contain the ext)', () => {
    expect(isAgentChannel(webrtcAgentA, '451')).toBe(true);
    expect(webrtcAgentA.name.includes('/451')).toBe(false); // proves name-match would fail
    expect(webrtcAgentA.callerId).toBe('03103480076');      // proves cid-match would fail
  });
  it('matches a deskphone by name', () => {
    expect(isAgentChannel(deskphone455, '455')).toBe(true);
  });
  it('does not match an unrelated extension or the customer leg', () => {
    expect(isAgentChannel(webrtcAgentA, '452')).toBe(false);
    expect(isAgentChannel(customer, '451')).toBe(false);
  });
});

describe('findBridgePartnerUuid (call_uuid pairing, no b_uuid)', () => {
  const channels = [webrtcAgentA, customer, webrtcAgentBconsult, dest453];
  it('pairs the agent leg to its customer via shared call_uuid', () => {
    expect(findBridgePartnerUuid(webrtcAgentA, channels)).toBe('callX');
  });
  it('pairs the consult leg to the destination', () => {
    expect(findBridgePartnerUuid(webrtcAgentBconsult, channels)).toBe('callY');
  });
  it('returns null for an unbridged channel', () => {
    expect(findBridgePartnerUuid({ uniqueId: 'lonely', callUuid: '' }, channels)).toBeNull();
  });
});

describe('attended-transfer leg selection (the consult-vs-held decision)', () => {
  // Agent 451 mid-transfer: Call A held (partner=customer callX), Call B consult (partner=453 callY).
  const channels = [webrtcAgentA, customer, webrtcAgentBconsult, dest453];
  const partnerAUuid = 'callX'; // the customer (held leg's partner)

  it('selects the consult leg (partner != customer) and yields the destination uuid', () => {
    const agentLegs = channels
      .filter((ch) => isAgentChannel(ch, '451'))
      .map((ch) => ({ ch, partner: findBridgePartnerUuid(ch, channels) }));
    const consult = agentLegs.find((l) => l.partner && l.partner !== partnerAUuid);
    const held = agentLegs.find((l) => l.partner === partnerAUuid);

    expect(agentLegs).toHaveLength(2);
    expect(consult?.partner).toBe('callY');           // bridge target = destination
    expect(held?.ch.uniqueId).toBe('agentA-uuid');    // the leg to unhold
  });
});
