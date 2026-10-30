// Verifies that the database itself enforces the invariants, independent of application code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { SUB_CITIES } from '@dp/shared';
import { otpChallenges, serviceAreas, users } from '../src/db/schema.ts';
import type { Database } from '../src/db/client.ts';
import { createTestDatabase } from './helpers.ts';

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

const inFiveMinutes = () => new Date(Date.now() + 5 * 60_000);

describe('users', () => {
  it('rejects a second account for the same normalized phone', async () => {
    await database.db.insert(users).values({ phoneE164: '+251911000001' });
    await expect(database.db.insert(users).values({ phoneE164: '+251911000001' })).rejects.toThrow();
  });

  it('rejects phone numbers that are not normalized Ethiopian mobiles', async () => {
    for (const phone of ['0911000002', '+251111000002', '+25191100000', '+1 202 555 0100']) {
      await expect(database.db.insert(users).values({ phoneE164: phone })).rejects.toThrow();
    }
  });
});

describe('otp_challenges', () => {
  it('allows only one open challenge per phone', async () => {
    const base = { phoneE164: '+251911000003', codeHash: 'x', expiresAt: inFiveMinutes() };
    const [first] = await database.db.insert(otpChallenges).values(base).returning();
    await expect(database.db.insert(otpChallenges).values(base)).rejects.toThrow();

    // Once closed, a new challenge can be opened.
    await database.db
      .update(otpChallenges)
      .set({ closedAt: new Date(), closeReason: 'superseded' })
      .where(eq(otpChallenges.id, first!.id));
    await expect(database.db.insert(otpChallenges).values(base)).resolves.toBeDefined();
  });

  it('requires closed_at and close_reason together', async () => {
    await expect(
      database.db.insert(otpChallenges).values({
        phoneE164: '+251911000004',
        codeHash: 'x',
        expiresAt: inFiveMinutes(),
        closedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe('service_areas seed', () => {
  it('contains exactly the initial Addis Ababa sub-cities', async () => {
    const rows = await database.db.select().from(serviceAreas).orderBy(asc(serviceAreas.sortOrder));
    expect(rows.map((r) => ({ slug: r.slug, nameEn: r.nameEn, nameAm: r.nameAm }))).toEqual(
      SUB_CITIES.map((s) => ({ slug: s.slug, nameEn: s.nameEn, nameAm: s.nameAm })),
    );
  });
});
