// Ethiopian mobile number normalization.
// Mobile national significant numbers are 9 digits starting with 9 (Ethio Telecom) or 7 (Safaricom Ethiopia).

export type PhoneNormalization =
  | { ok: true; e164: string }
  | { ok: false; reason: 'empty' | 'invalid_characters' | 'invalid_format' | 'not_mobile' };

const E164_ET_MOBILE = /^\+251[79]\d{8}$/;

export function isEthiopianMobileE164(value: string): boolean {
  return E164_ET_MOBILE.test(value);
}

export function normalizeEthiopianPhone(input: string): PhoneNormalization {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  // Allow common visual separators only.
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return { ok: false, reason: 'invalid_characters' };

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  if (digits.startsWith('00251')) digits = digits.slice(5);
  else if (digits.startsWith('251')) digits = digits.slice(3);
  else if (hasPlus) return { ok: false, reason: 'invalid_format' }; // a different country code

  // Tolerate a trunk "0" after the country code (+251 09…) and the local form (09…).
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);

  if (digits.length !== 9) return { ok: false, reason: 'invalid_format' };
  if (digits[0] !== '9' && digits[0] !== '7') return { ok: false, reason: 'not_mobile' };

  return { ok: true, e164: `+251${digits}` };
}

/** For logs and UI confirmations: +251 9•• ••• •34 */
export function maskPhone(e164: string): string {
  if (!isEthiopianMobileE164(e164)) return '•••';
  return `+251 ${e164[4]}•• ••• •${e164.slice(-2)}`;
}

/** Display format: +251 91 123 4567 */
export function formatPhone(e164: string): string {
  if (!isEthiopianMobileE164(e164)) return e164;
  const n = e164.slice(4);
  return `+251 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}
