import { describe, expect, it } from 'vitest';
import { formatEtb, fromSantim, toSantim } from './money.ts';

describe('money', () => {
  it('round-trips decimal strings through santim', () => {
    for (const v of ['0.00', '0.05', '1.10', '185.00', '9999999999.99', '-40.00']) {
      expect(fromSantim(toSantim(v))).toBe(v);
    }
  });

  it('accepts one or zero decimal places', () => {
    expect(toSantim('25')).toBe(2500);
    expect(toSantim('25.5')).toBe(2550);
  });

  it('rejects malformed amounts', () => {
    expect(() => toSantim('1.234')).toThrow();
    expect(() => toSantim('abc')).toThrow();
    expect(() => fromSantim(1.5)).toThrow();
  });

  it('formats ETB', () => {
    expect(formatEtb('1234.5')).toBe('1,234.50 ETB');
  });
});
