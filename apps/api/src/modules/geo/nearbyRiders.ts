// Nearby riders for the customer's booking map: "there are riders around you".
//
// Privacy: riders' live positions are personal data, so customers only get an approximate dot per
// rider. No ids, names or phones; each position is shifted by up to ~120 m in a direction that is
// stable for the rider for an hour (so dots don't jump about), then rounded. Only online, approved,
// free riders with a fresh location within 3 km are shown, at most 8.
import { createHash } from 'node:crypto';
import { and, eq, gt, isNotNull, notExists, sql } from 'drizzle-orm';
import { ACTIVE_RIDER_STATUSES, haversineKm, type NearbyRider } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveries, riders } from '../../db/schema.ts';

const RADIUS_KM = 3;
const MAX_RIDERS = 8;
const FRESH_MS = 5 * 60_000;
const FUZZ_M = 120;

/** Hour-stable pseudo-random numbers for one rider (not reversible to the rider id). */
function noise(riderId: string, now: Date) {
  const hour = Math.floor(now.getTime() / 3_600_000);
  const h = createHash('sha256').update(`${riderId}:${hour}`).digest();
  return { a: h.readUInt16BE(0) / 65535, b: h.readUInt16BE(2) / 65535, c: h.readUInt16BE(4) / 65535, key: h.subarray(6, 12).toString('hex') };
}

export async function nearbyRiders(db: Db, at: { lat: number; lng: number }, now: Date): Promise<NearbyRider[]> {
  const dLat = RADIUS_KM / 111;
  const dLng = RADIUS_KM / (111 * Math.cos((at.lat * Math.PI) / 180));
  const rows = await db
    .select({ id: riders.userId, vehicleType: riders.vehicleType, lat: riders.currentLat, lng: riders.currentLng })
    .from(riders)
    .where(
      and(
        eq(riders.approvalStatus, 'approved'),
        eq(riders.isOnline, true),
        isNotNull(riders.currentLat),
        gt(riders.locationUpdatedAt, new Date(now.getTime() - FRESH_MS)),
        sql`${riders.currentLat} between ${at.lat - dLat} and ${at.lat + dLat}`,
        sql`${riders.currentLng} between ${at.lng - dLng} and ${at.lng + dLng}`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(deliveries)
            .where(
              and(
                sql`${deliveries.riderId} = "riders"."user_id"`,
                sql`${deliveries.status}::text in (${sql.join(ACTIVE_RIDER_STATUSES.map((s) => sql`${s}`), sql`, `)})`,
              ),
            ),
        ),
      ),
    )
    .limit(50);

  return rows
    .map((r) => ({ r, km: haversineKm(at, { lat: r.lat!, lng: r.lng! }) }))
    .filter((x) => x.km <= RADIUS_KM)
    .sort((x, y) => x.km - y.km)
    .slice(0, MAX_RIDERS)
    .map(({ r }) => {
      const n = noise(r.id, now);
      const dist = n.a * FUZZ_M;
      const angle = n.b * 2 * Math.PI;
      const lat = r.lat! + (dist * Math.cos(angle)) / 111_000;
      const lng = r.lng! + (dist * Math.sin(angle)) / (111_000 * Math.cos((r.lat! * Math.PI) / 180));
      return {
        key: n.key,
        vehicleType: r.vehicleType,
        lat: Math.round(lat * 10_000) / 10_000,
        lng: Math.round(lng * 10_000) / 10_000,
        heading: Math.round(n.c * 16) * (Math.PI / 8),
      };
    });
}
