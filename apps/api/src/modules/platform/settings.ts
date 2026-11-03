// Admin-configurable platform values (wallet limits, matching weights, route retention).
// Stored as one JSON value per key; anything not stored falls back to the documented default.
import { inArray } from 'drizzle-orm';
import { DEFAULT_SETTINGS, type PlatformSettings, type settingsUpdateSchema } from '@dp/shared';
import type { z } from 'zod';
import type { Tx } from '../../db/client.ts';
import { platformSettings } from '../../db/schema.ts';
import { audit } from '../admin/audit.ts';

const KEYS = ['walletMinBalance', 'walletDebtLimit', 'matching', 'routeRetentionDays'] as const;

// A JSON string like "20.00" can come back from jsonb as the number 20; always return "20.00".
const etb = (v: string | number) => Number(v).toFixed(2);

export async function getSettings(db: Tx): Promise<PlatformSettings> {
  const rows = await db
    .select()
    .from(platformSettings)
    .where(inArray(platformSettings.key, [...KEYS]));
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<PlatformSettings>;
  return {
    walletMinBalance: etb(stored.walletMinBalance ?? DEFAULT_SETTINGS.walletMinBalance),
    walletDebtLimit: etb(stored.walletDebtLimit ?? DEFAULT_SETTINGS.walletDebtLimit),
    matching: { ...DEFAULT_SETTINGS.matching, ...(stored.matching ?? {}) },
    routeRetentionDays: stored.routeRetentionDays ?? DEFAULT_SETTINGS.routeRetentionDays,
  };
}

/** Saves the changed values and records who changed what, from what, and why. */
export async function updateSettings(
  db: Tx,
  adminId: string,
  input: z.output<typeof settingsUpdateSchema>,
  now: Date,
): Promise<PlatformSettings> {
  const before = await getSettings(db);
  const { reason, ...changes } = input;
  const next: Record<string, unknown> = {};
  if (changes.walletMinBalance !== undefined)
    next.walletMinBalance = Number(changes.walletMinBalance).toFixed(2);
  if (changes.walletDebtLimit !== undefined)
    next.walletDebtLimit = Number(changes.walletDebtLimit).toFixed(2);
  if (changes.matching) next.matching = { ...before.matching, ...changes.matching };
  if (changes.routeRetentionDays !== undefined) next.routeRetentionDays = changes.routeRetentionDays;

  for (const [key, value] of Object.entries(next)) {
    await db
      .insert(platformSettings)
      .values({ key, value, updatedBy: adminId, updatedAt: now })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedBy: adminId, updatedAt: now },
      });
  }
  await audit(db, adminId, 'settings.update', { type: 'settings', id: 'platform' }, {
    reason,
    before: Object.fromEntries(Object.keys(next).map((k) => [k, before[k as keyof PlatformSettings]])),
    after: next,
  });
  return getSettings(db);
}
