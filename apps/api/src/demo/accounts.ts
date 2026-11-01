export const DEMO_PHONES = {
  rider: '+251900000001',
  customer: '+251900000002',
  admin: '+251900000003',
} as const;

export const DEMO_OTP: Record<string, string> = {
  [DEMO_PHONES.rider]: '123456',
  [DEMO_PHONES.customer]: '654321',
  [DEMO_PHONES.admin]: '000000',
};

export function isDemoPhone(phone: string): boolean {
  return phone in DEMO_OTP;
}
