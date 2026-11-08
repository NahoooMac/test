-- Adds the scooter vehicle type and its first price rule.
--
-- `ALTER TYPE ... ADD VALUE` would leave the new value unusable until the transaction commits, and
-- all pending migrations run in one transaction, so the type is rebuilt instead: a type created in
-- this transaction is usable immediately. Existing values and data are unchanged. The plate rule
-- compares the column to a literal, so it is dropped around the swap and re-added, now also
-- covering scooters (they need a plate, like motorcycles).
ALTER TABLE "riders" DROP CONSTRAINT "riders_motorcycle_needs_plate";--> statement-breakpoint
ALTER TYPE "public"."vehicle_type" RENAME TO "vehicle_type_old";--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('motorcycle', 'bicycle', 'scooter');--> statement-breakpoint
ALTER TABLE "riders" ALTER COLUMN "vehicle_type" TYPE "public"."vehicle_type" USING "vehicle_type"::text::"public"."vehicle_type";--> statement-breakpoint
ALTER TABLE "pricing_rules" ALTER COLUMN "vehicle_type" TYPE "public"."vehicle_type" USING "vehicle_type"::text::"public"."vehicle_type";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "vehicle_type" TYPE "public"."vehicle_type" USING "vehicle_type"::text::"public"."vehicle_type";--> statement-breakpoint
DROP TYPE "public"."vehicle_type_old";--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_motorcycle_needs_plate" CHECK ("riders"."vehicle_type" not in ('motorcycle', 'scooter') or "riders"."plate_number" is not null);--> statement-breakpoint
-- Scooter prices start as a copy of the bicycle rule in force (owner's decision, 2026-11-08);
-- admins can change them on the Pricing page like any other rule.
INSERT INTO "pricing_rules" ("vehicle_type", "base_fare", "per_km", "minimum_fare", "max_distance_km", "commission_rate", "cancellation_fee_after_arrival", "per_minute")
SELECT 'scooter', "base_fare", "per_km", "minimum_fare", "max_distance_km", "commission_rate", "cancellation_fee_after_arrival", "per_minute"
FROM "pricing_rules"
WHERE "vehicle_type" = 'bicycle' AND "effective_to" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "pricing_rules" WHERE "vehicle_type" = 'scooter' AND "effective_to" IS NULL);
