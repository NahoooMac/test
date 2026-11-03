// Rider service areas and optional home location. Areas are validated against the seeded list
// (schema + FK); the client can only send the rider's own preferences, never another rider's.
import { and, eq, sql } from 'drizzle-orm';
import type { RiderPreferences, RiderStanding, riderPreferencesSchema } from '@dp/shared';
import type { z } from 'zod';
import type { Db } from '../../db/client.ts';
import { deliveryRatings, riderServiceAreas, riders } from '../../db/schema.ts';
import { AppError } from '../../shared/errors.ts';
import { riderAreas } from './eligibility.ts';
import { pointsBalance, pointsHistory } from './points.ts';

export async function getPreferences(db: Db, riderId: string): Promise<RiderPreferences> {
  const [r] = await db
    .select({ lat: riders.homeLat, lng: riders.homeLng, radius: riders.homeRadiusKm })
    .from(riders)
    .where(eq(riders.userId, riderId));
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Apply to ride first.');
  return {
    serviceAreas: await riderAreas(db, riderId),
    home: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng, radiusKm: r.radius ?? 3 } : null,
  };
}

export async function setPreferences(
  db: Db,
  riderId: string,
  input: z.output<typeof riderPreferencesSchema>,
  now: Date,
): Promise<RiderPreferences> {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .update(riders)
      .set({
        homeLat: input.home?.lat ?? null,
        homeLng: input.home?.lng ?? null,
        homeRadiusKm: input.home?.radiusKm ?? null,
        updatedAt: now,
      })
      .where(eq(riders.userId, riderId))
      .returning({ id: riders.userId });
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Apply to ride first.');
    await tx.delete(riderServiceAreas).where(eq(riderServiceAreas.riderId, riderId));
    if (input.serviceAreas.length) {
      await tx
        .insert(riderServiceAreas)
        .values(input.serviceAreas.map((subCity) => ({ riderId, subCity, createdAt: now })));
    }
  });
  return getPreferences(db, riderId);
}

export async function ratingSummary(db: Db, riderId: string) {
  const [row] = await db
    .select({
      avg: sql<string | null>`avg(${deliveryRatings.stars})::numeric(3,2)::text`,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(deliveryRatings)
    .where(and(eq(deliveryRatings.riderId, riderId), eq(deliveryRatings.status, 'active')));
  return { average: row?.avg != null ? Number(row.avg) : null, count: row?.n ?? 0 };
}

export async function riderStanding(db: Db, riderId: string): Promise<RiderStanding> {
  const [points, history, rating] = await Promise.all([
    pointsBalance(db, riderId),
    pointsHistory(db, riderId),
    ratingSummary(db, riderId),
  ]);
  return { points, pointsHistory: history, rating };
}
