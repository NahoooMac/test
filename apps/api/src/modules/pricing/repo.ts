import { isNull } from 'drizzle-orm';
import type { VehicleType } from '@dp/shared';
import type { Tx } from '../../db/client.ts';
import { pricingRules } from '../../db/schema.ts';
import { AppError } from '../../shared/errors.ts';
import type { PricingRule } from './pricing.ts';

export async function currentRules(db: Tx): Promise<Map<VehicleType, PricingRule>> {
  const rows = await db.select().from(pricingRules).where(isNull(pricingRules.effectiveTo));
  const map = new Map<VehicleType, PricingRule>();
  for (const r of rows) map.set(r.vehicleType, r);
  return map;
}

export async function currentRule(db: Tx, vehicle: VehicleType): Promise<PricingRule> {
  const rule = (await currentRules(db)).get(vehicle);
  if (!rule) {
    throw new AppError(
      503,
      'PRICING_UNAVAILABLE',
      'Pricing is not configured for this vehicle yet.',
    );
  }
  return rule;
}
