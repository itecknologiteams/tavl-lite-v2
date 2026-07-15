import { describe, it, expect } from 'vitest';
import { normalizePhone, matchCustomersToCores, groupVehiclesByCustomer } from './crmLookup';

describe('normalizePhone', () => {
  it('strips a leading 0 to the 10-digit core', () => {
    expect(normalizePhone('03317104480')).toBe('3317104480');
  });

  it('strips +92 country code', () => {
    expect(normalizePhone('+923317104480')).toBe('3317104480');
  });

  it('strips a bare 92 country code', () => {
    expect(normalizePhone('923317104480')).toBe('3317104480');
  });

  it('strips spaces, dashes and parens', () => {
    expect(normalizePhone(' 0331-710 (4480) ')).toBe('3317104480');
  });

  it('leaves an already-core number unchanged', () => {
    expect(normalizePhone('3317104480')).toBe('3317104480');
  });

  it('returns empty string for non-numeric input', () => {
    expect(normalizePhone('Unknown')).toBe('');
  });
});

describe('matchCustomersToCores', () => {
  const rows = [
    { customerId: 1, customerName: 'Ali Raza', phone1: '0331-710-4480', phone2: '' },
    { customerId: 2, customerName: 'Sara Khan', phone1: '', phone2: '+92 300 5550036' },
  ];

  it('matches a core against a cleaned CONT1', () => {
    const map = matchCustomersToCores(rows, ['3317104480']);
    expect(map.get('3317104480')?.customerId).toBe(1);
  });

  it('matches a core against a cleaned CONT2', () => {
    const map = matchCustomersToCores(rows, ['3005550036']);
    expect(map.get('3005550036')?.customerId).toBe(2);
  });

  it('omits cores with no matching customer', () => {
    const map = matchCustomersToCores(rows, ['9999999999']);
    expect(map.has('9999999999')).toBe(false);
  });
});

describe('groupVehiclesByCustomer', () => {
  it('groups vehicles under a numeric customer id even when rows use string ids', () => {
    const vrows = [
      { customerId: '319544', plate: 'ISL141202612', make: 'HAVAL', model: 'H6' },
      { customerId: '319544', plate: 'ABC-123' },
    ];
    const m = groupVehiclesByCustomer(vrows);
    expect(m.get(319544)?.length).toBe(2);
    expect(m.get(319544)?.[0]).toEqual({ plate: 'ISL141202612', make: 'HAVAL', model: 'H6' });
  });

  it('skips rows with no plate', () => {
    const m = groupVehiclesByCustomer([{ customerId: '1', plate: '' }]);
    expect(m.get(1)).toEqual([]);
  });
});
