// Domain vocabulary shared by the API and the web app. Keep in sync with DB enums/checks.

export const USER_ROLES = ['customer', 'rider', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LANGUAGES = ['en', 'am'] as const;
export type Language = (typeof LANGUAGES)[number];

export const VEHICLE_TYPES = ['motorcycle', 'bicycle'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const PAYERS = ['sender', 'receiver'] as const;
export type Payer = (typeof PAYERS)[number];

export const PAYMENT_METHODS = ['cash', 'telebirr', 'cbe_birr'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DELIVERY_STATUSES = [
  'requested',
  'assigned',
  'arrived_pickup',
  'picked_up',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returning',
  'returned',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Statuses in which a rider is considered busy. Enforced by a partial unique index.
 * `returning` is included by default (plan Q5): a rider bringing a parcel back cannot take a new job.
 */
export const ACTIVE_RIDER_STATUSES = [
  'assigned',
  'arrived_pickup',
  'picked_up',
  'arrived_dropoff',
  'returning',
] as const satisfies readonly DeliveryStatus[];

/** Delivery is still in progress from the customer's point of view. */
export const OPEN_DELIVERY_STATUSES = [
  'requested',
  ...ACTIVE_RIDER_STATUSES,
] as const satisfies readonly DeliveryStatus[];

export const PARCEL_SIZES = ['small', 'medium', 'large'] as const;
export type ParcelSize = (typeof PARCEL_SIZES)[number];

export const RIDER_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type RiderApprovalStatus = (typeof RIDER_APPROVAL_STATUSES)[number];

export const ACTOR_ROLES = ['customer', 'rider', 'admin', 'system'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface SubCity {
  slug: string;
  nameEn: string;
  nameAm: string;
}

/** Initial service area — Addis Ababa sub-cities. Mirrors the `service_areas` seed migration. */
export const SUB_CITIES: readonly SubCity[] = [
  { slug: 'bole', nameEn: 'Bole', nameAm: 'ቦሌ' },
  { slug: 'kirkos', nameEn: 'Kirkos', nameAm: 'ቂርቆስ' },
  { slug: 'yeka', nameEn: 'Yeka', nameAm: 'የካ' },
  { slug: 'nifas-silk-lafto', nameEn: 'Nifas Silk-Lafto', nameAm: 'ንፋስ ስልክ ላፍቶ' },
  { slug: 'arada', nameEn: 'Arada', nameAm: 'አራዳ' },
  { slug: 'addis-ketema', nameEn: 'Addis Ketema', nameAm: 'አዲስ ከተማ' },
  { slug: 'lideta', nameEn: 'Lideta', nameAm: 'ልደታ' },
  { slug: 'kolfe-keranio', nameEn: 'Kolfe Keranio', nameAm: 'ኮልፌ ቀራኒዮ' },
  { slug: 'gullele', nameEn: 'Gullele', nameAm: 'ጉለሌ' },
  { slug: 'akaki-kality', nameEn: 'Akaki Kality', nameAm: 'አቃቂ ቃሊቲ' },
  { slug: 'lemi-kura', nameEn: 'Lemi Kura', nameAm: 'ለሚ ኩራ' },
];
