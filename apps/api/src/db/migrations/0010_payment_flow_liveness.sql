CREATE TYPE "public"."liveness_status" AS ENUM('active', 'passed', 'failed', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."payment_verification" AS ENUM('not_required', 'pending', 'verified', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'disputed';--> statement-breakpoint
CREATE TABLE "kyc_liveness_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"status" "liveness_status" DEFAULT 'active' NOT NULL,
	"sequence" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"client" jsonb,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_non_negative";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "estimated_fare" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "actual_distance_km" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "actual_duration_min" integer;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "fare_basis" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "fare_finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "payer_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "liveness_session_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verification" "payment_verification";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "per_minute" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_liveness_sessions" ADD CONSTRAINT "kyc_liveness_sessions_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_liveness_rider_idx" ON "kyc_liveness_sessions" USING btree ("rider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_liveness_one_active" ON "kyc_liveness_sessions" USING btree ("rider_id") WHERE "kyc_liveness_sessions"."status" = 'active';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fare_basis" CHECK ("deliveries"."fare_basis" is null or "deliveries"."fare_basis" in ('gps', 'estimate'));--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_non_negative" CHECK ("pricing_rules"."base_fare" >= 0 and "pricing_rules"."per_km" >= 0 and "pricing_rules"."minimum_fare" > 0 and "pricing_rules"."cancellation_fee_after_arrival" >= 0 and "pricing_rules"."per_minute" >= 0);--> statement-breakpoint
-- Existing recorded fares: cash needs no independent check; mobile transfers await one.
UPDATE "payments" SET "verification" = CASE WHEN "method" = 'cash' THEN 'not_required'::payment_verification ELSE 'pending'::payment_verification END WHERE "status" = 'collected' AND "verification" IS NULL;
