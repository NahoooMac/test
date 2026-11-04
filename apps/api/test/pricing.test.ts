import { describe, expect, it } from 'vitest';
import { toSantim } from '@dp/shared';
import {
  computeFare,
  estimateRoadKm,
  etaMinutes,
  unavailableReason,
  type PricingRule,
} from '../src/modules/pricing/pricing.ts';
import {
  canTransition,
  customerCancellationFee,
  nextStatuses,
} from '../src/modules/deliveries/state-machine.ts';
import { matchSubCity } from '../src/integrations/maps/sub-city.ts';

const moto: PricingRule = {
  id: 'm',
  vehicleType: 'motorcycle',
  baseFare: '60.00',
  perKm: '18.00',
  minimumFare: '80.00',
  maxDistanceKm: null,
  commissionRate: '0.1500',
  cancellationFeeAfterArrival: '40.00',
  perMinute: '0.00',
};
const bike: PricingRule = {
  ...moto,
  id: 'b',
  vehicleType: 'bicycle',
  baseFare: '40.00',
  perKm: '12.00',
  minimumFare: '50.00',
  maxDistanceKm: 8,
  commissionRate: '0.1000',
  cancellationFeeAfterArrival: '25.00',
  perMinute: '0.00',
};

describe('fare', () => {
  it('applies base + per-km, rounded up to 5 ETB', () => {
    // 60 + 18 × 6.2 = 171.60 → 175.00
    expect(computeFare(moto, 6.2).fare).toBe('175.00');
  });

  it('never goes below the minimum fare', () => {
    expect(computeFare(moto, 0.3).fare).toBe('80.00');
    expect(computeFare(bike, 0.3).fare).toBe('50.00');
  });

  it('splits commission at the configured rate and the parts always add up', () => {
    const m = computeFare(moto, 6.2);
    expect(m).toMatchObject({
      commissionAmount: '26.25',
      riderEarning: '148.75',
      commissionRate: '0.1500',
    });
    const b = computeFare(bike, 3.7); // 40 + 44.40 = 84.40 → 85.00
    expect(b).toMatchObject({ fare: '85.00', commissionAmount: '8.50', riderEarning: '76.50' });
    for (let km = 0.3; km < 30; km += 0.37) {
      for (const rule of [moto, bike]) {
        const f = computeFare(rule, km);
        expect(toSantim(f.commissionAmount) + toSantim(f.riderEarning)).toBe(toSantim(f.fare));
        expect(toSantim(f.fare) % 500).toBe(0);
      }
    }
  });

  it('limits bicycle distance', () => {
    expect(unavailableReason(bike, 7.9)).toBeNull();
    expect(unavailableReason(bike, 8.1)).toMatch(/8 km/);
    expect(unavailableReason(moto, 40)).toBeNull();
  });

  it('estimates road distance and ETA', () => {
    const meskel = { lat: 9.0105, lng: 38.7614 };
    const piassa = { lat: 9.0326, lng: 38.7541 };
    const km = estimateRoadKm(meskel, piassa);
    expect(km).toBeGreaterThan(2.5);
    expect(km).toBeLessThan(4);
    expect(etaMinutes(km, 'bicycle')).toBeGreaterThan(etaMinutes(km, 'motorcycle'));
    expect(estimateRoadKm(meskel, meskel)).toBe(0.3);
  });
});

describe('state machine', () => {
  it('only lets the right actor make each move', () => {
    expect(canTransition('requested', 'assigned', 'system')).toBe(true);
    expect(canTransition('requested', 'assigned', 'customer')).toBe(false);
    expect(canTransition('assigned', 'arrived_pickup', 'rider')).toBe(true);
    expect(canTransition('assigned', 'arrived_pickup', 'customer')).toBe(false);
    expect(canTransition('picked_up', 'cancelled', 'customer')).toBe(false);
    expect(canTransition('arrived_dropoff', 'failed', 'rider')).toBe(true);
    expect(canTransition('failed', 'returning', 'system')).toBe(true);
    expect(canTransition('returning', 'returned', 'rider')).toBe(true);
  });

  it('has no way out of terminal states, and no skipping', () => {
    for (const actor of ['customer', 'rider', 'admin', 'system'] as const) {
      expect(nextStatuses('delivered', actor)).toEqual([]);
      expect(nextStatuses('cancelled', actor)).toEqual([]);
      expect(nextStatuses('returned', actor)).toEqual([]);
    }
    expect(canTransition('assigned', 'delivered', 'rider')).toBe(false);
    expect(canTransition('requested', 'picked_up', 'admin')).toBe(false);
  });

  it('charges the cancellation fee only after the rider arrives, and blocks it after pickup', () => {
    expect(customerCancellationFee('requested', '40.00')).toBe('0.00');
    expect(customerCancellationFee('assigned', '40.00')).toBe('0.00');
    expect(customerCancellationFee('arrived_pickup', '40.00')).toBe('40.00');
    expect(customerCancellationFee('arrived_pickup', '25.00')).toBe('25.00');
    expect(customerCancellationFee('picked_up', '40.00')).toBeNull();
    expect(customerCancellationFee('delivered', '40.00')).toBeNull();
  });
});

describe('sub-city matching', () => {
  it('recognises common spellings', () => {
    expect(matchSubCity(['Addis Ababa', 'Kirkos', 'Woreda 9'])).toBe('kirkos');
    expect(matchSubCity(['Addis Ababa', 'Nefas Silk Lafto Sub City'])).toBe('nifas-silk-lafto');
    expect(matchSubCity(['Akaky Kaliti'])).toBe('akaki-kality');
    expect(matchSubCity(['Gulele'])).toBe('gullele');
    expect(matchSubCity(['Addis Ababa'])).toBeNull();
  });
});
