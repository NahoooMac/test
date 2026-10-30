import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.ts';

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

  it('never echoes secret values in errors', () => {
    try {
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://user:SuperSecret@h/db' });
    } catch (e) {
      expect(String(e)).not.toContain('SuperSecret');
    }
  });
});
