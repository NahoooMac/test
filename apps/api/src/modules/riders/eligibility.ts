// The mandatory rules for giving a rider a job, in one place: claim from the pool, accepting an
// offer, and admin assignment all call this inside their transaction. Scores (matching.ts) only
// rank riders who already pass these rules; they can never override them.
import { eq } from 'drizzle-orm';
import { pickupArea } from '@dp/shared';
import type { Tx } from '../../db/client.ts';
import type { deliveries} from '../../db/schema.ts';
import { riderServiceAreas, riders } from '../../db/schema.ts';
import { AppError } from '../../shared/errors.ts';
import { assertWalletAllowsJob, lockRider } from '../wallet/wallet.ts';

type DeliveryRow = typeof deliveries.$inferSelect;

export async function riderAreas(db: Tx, riderId: string): Promise<string[]> {
  const rows = await db
    .select({ s: riderServiceAreas.subCity })
    .from(riderServiceAreas)
    .where(eq(riderServiceAreas.riderId, riderId));
  return rows.map((r) => r.s);
}

/** No areas chosen yet = every area, so existing riders keep receiving work until they choose. */
export function coversArea(areas: string[], area: string) {
  return areas.length === 0 || areas.includes(area);
}

export const deliveryArea = (d: Pick<DeliveryRow, 'pickupSubCity' | 'pickupLat' | 'pickupLng'>) =>
  pickupArea(d.pickupSubCity, { lat: d.pickupLat, lng: d.pickupLng });

export async function assertRiderCanTakeJob(
  tx: Tx,
  riderId: string,
  d: DeliveryRow,
  opts: { overrideArea?: boolean } = {},
) {
  await lockRider(tx, riderId);
  const [r] = await tx.select().from(riders).where(eq(riders.userId, riderId));
  if (!r || r.approvalStatus !== 'approved') {
    throw new AppError(403, 'RIDER_NOT_APPROVED', 'Your rider account is not approved for jobs.');
  }
  if (r.vehicleType !== d.vehicleType) {
    throw new AppError(409, 'WRONG_VEHICLE', `This job needs a ${d.vehicleType}.`);
  }
  if (d.customerId === riderId) {
    throw new AppError(409, 'OWN_DELIVERY', 'You cannot deliver your own parcel.');
  }
  if (!opts.overrideArea && !coversArea(await riderAreas(tx, riderId), deliveryArea(d))) {
    throw new AppError(409, 'OUTSIDE_AREA', 'This pickup is outside your service areas.');
  }
  await assertWalletAllowsJob(tx, riderId, d.commissionAmount);
}
