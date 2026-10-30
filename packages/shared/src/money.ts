// Money is NUMERIC(12,2) in the database and travels as a decimal string ("185.00") over the API.
// Arithmetic is done in integer santim (1 ETB = 100 santim) to avoid floating-point drift.

export function toSantim(amount: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw new Error(`Invalid money amount: ${amount}`);
  const negative = amount.startsWith('-');
  const [whole = '0', frac = ''] = amount.replace('-', '').split('.');
  const santim = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -santim : santim;
}

export function fromSantim(santim: number): string {
  if (!Number.isInteger(santim)) throw new Error(`Santim must be an integer: ${santim}`);
  const negative = santim < 0;
  const abs = Math.abs(santim);
  const value = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${value}` : value;
}

/** "1234.5" → "1,234.50 ETB" */
export function formatEtb(amount: string, locale = 'en'): string {
  const n = toSantim(amount) / 100;
  const formatted = new Intl.NumberFormat(locale === 'am' ? 'am-ET' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `${formatted} ETB`;
}
