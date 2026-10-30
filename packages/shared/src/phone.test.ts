import { describe, expect, it } from 'vitest';
import { formatPhone, maskPhone, normalizeEthiopianPhone } from './phone.ts';

describe('normalizeEthiopianPhone', () => {
  it.each([
    ['0911234567', '+251911234567'],
    ['911234567', '+251911234567'],
    ['+251911234567', '+251911234567'],
    ['251911234567', '+251911234567'],
    ['00251911234567', '+251911234567'],
    ['+251 0911 234 567', '+251911234567'],
    ['+251 91 123 4567', '+251911234567'],
    ['091-123-4567', '+251911234567'],
    ['(091) 123 4567', '+251911234567'],
    ['0711234567', '+251711234567'],
    ['+251 71 123 4567', '+251711234567'],
    ['  0911234567  ', '+251911234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toEqual({ ok: true, e164: expected });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['09112345ab', 'invalid_characters'],
    ['+1 202 555 0100', 'invalid_format'],
    ['+44 7911 123456', 'invalid_format'],
    ['09112345', 'invalid_format'],
    ['091123456789', 'invalid_format'],
    ['0111234567', 'not_mobile'], // Addis landline
    ['+251111234567', 'not_mobile'],
    ['0811234567', 'not_mobile'],
  ])('rejects %j (%s)', (input, reason) => {
    expect(normalizeEthiopianPhone(input)).toEqual({ ok: false, reason });
  });
});

describe('formatting', () => {
  it('masks all but the last two digits', () => {
    expect(maskPhone('+251911234567')).toBe('+251 9•• ••• •67');
  });

  it('formats for display', () => {
    expect(formatPhone('+251911234567')).toBe('+251 91 123 4567');
  });
});
