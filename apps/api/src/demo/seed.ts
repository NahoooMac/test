import type { Db } from '../db/client.ts';
import { riders, users } from '../db/schema.ts';
import { DEMO_PHONES } from './accounts.ts';

export async function seedDemoAccounts(db: Db): Promise<void> {
  const now = new Date();

  // Demo rider (motorcycle, approved, online near Bole)
  const [riderUser] = await db
    .insert(users)
    .values({
      phoneE164: DEMO_PHONES.rider,
      fullName: 'Demo Rider',
      role: 'rider',
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: users.phoneE164, set: { role: 'rider', updatedAt: now } })
    .returning();

  await db
    .insert(riders)
    .values({
      userId: riderUser!.id,
      vehicleType: 'motorcycle',
      plateNumber: 'AA-12345',
      approvalStatus: 'approved',
      // Demo data only (local database): marked verified so the demo runs without photos.
      kycStatus: 'approved',
      isOnline: true,
      currentLat: 9.0127,
      currentLng: 38.7896,
      locationUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: riders.userId,
      set: {
        approvalStatus: 'approved',
        kycStatus: 'approved',
        isOnline: true,
        currentLat: 9.0127,
        currentLng: 38.7896,
        locationUpdatedAt: now,
        updatedAt: now,
      },
    });

  // Demo customer
  await db
    .insert(users)
    .values({
      phoneE164: DEMO_PHONES.customer,
      fullName: 'Demo User',
      role: 'customer',
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: users.phoneE164, set: { updatedAt: now } });

  // Demo admin
  await db
    .insert(users)
    .values({
      phoneE164: DEMO_PHONES.admin,
      fullName: 'Demo Admin',
      role: 'admin',
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: users.phoneE164, set: { role: 'admin', updatedAt: now } });
}
