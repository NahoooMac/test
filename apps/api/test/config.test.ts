import { describe, expect, it } from 'vitest';
import { loadConfig, trustProxySetting } from '../src/config/env.ts';

describe('config', () => {
  it('uses safe local defaults', () => {
    const c = loadConfig({});
    expect(c.NODE_ENV).toBe('development');
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.ALLOW_REMOTE_MIGRATIONS).toBe(false);
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db.example/x',
        SMS_PROVIDER: 'console',
        APP_ORIGIN: 'https://app.example',
      }),
    ).toThrow(/SMS_PROVIDER/);
  });

  it('trusts one proxy hop in production unless told otherwise, and never "true"', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db.example/x',
      SMS_PROVIDER: 'afromessage',
      AFROMESSAGE_TOKEN: 't',
      APP_ORIGIN: 'https://app.example',
      OTP_HMAC_SECRET: 'x'.repeat(40),
      KYC_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    };
    expect(trustProxySetting(loadConfig(prod))).toBe(1);
    expect(trustProxySetting(loadConfig({ ...prod, TRUST_PROXY: '2' }))).toBe(2);
    expect(trustProxySetting(loadConfig({ ...prod, TRUST_PROXY: 'false' }))).toBe(false);
    expect(trustProxySetting(loadConfig({ ...prod, TRUST_PROXY: '10.0.0.0/8' }))).toBe(
      '10.0.0.0/8',
    );
    expect(trustProxySetting(loadConfig({}))).toBe(false);
    expect(() => loadConfig({ ...prod, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('never echoes secret values in errors', () => {
    try {
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://user:SuperSecret@h/db' });
    } catch (e) {
      expect(String(e)).not.toContain('SuperSecret');
    }
  });
});
