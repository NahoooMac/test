CREATE TYPE "public"."actor_role" AS ENUM('customer', 'rider', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('requested', 'assigned', 'arrived_pickup', 'picked_up', 'arrived_dropoff', 'delivered', 'cancelled', 'failed', 'returning', 'returned');--> statement-breakpoint
CREATE TYPE "public"."parcel_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TYPE "public"."payer" AS ENUM('sender', 'receiver');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'telebirr', 'cbe_birr');--> statement-breakpoint
CREATE TYPE "public"."rider_approval" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('motorcycle', 'bicycle');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"rider_id" uuid,
	"vehicle_type" "vehicle_type" NOT NULL,
	"status" "delivery_status" DEFAULT 'requested' NOT NULL,
	"payer" "payer" NOT NULL,
	"preferred_payment_method" "payment_method" NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_lat" numeric(9, 6) NOT NULL,
	"pickup_lng" numeric(9, 6) NOT NULL,
	"pickup_sub_city" text,
	"pickup_contact_name" text NOT NULL,
	"pickup_contact_phone" text NOT NULL,
	"pickup_notes" text DEFAULT '' NOT NULL,
	"dropoff_address" text NOT NULL,
	"dropoff_lat" numeric(9, 6) NOT NULL,
	"dropoff_lng" numeric(9, 6) NOT NULL,
	"dropoff_sub_city" text,
	"dropoff_contact_name" text NOT NULL,
	"dropoff_contact_phone" text NOT NULL,
	"dropoff_notes" text DEFAULT '' NOT NULL,
	"parcel_description" text NOT NULL,
	"parcel_size" "parcel_size" NOT NULL,
	"distance_km" numeric(8, 2) NOT NULL,
	"distance_source" text NOT NULL,
	"eta_min" integer NOT NULL,
	"pricing_rule_id" uuid NOT NULL,
	"fare_amount" numeric(12, 2) NOT NULL,
	"commission_rate" numeric(5, 4) NOT NULL,
	"commission_amount" numeric(12, 2) NOT NULL,
	"rider_earning" numeric(12, 2) NOT NULL,
	"cancellation_fee" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"cancelled_by" "actor_role",
	"cancel_reason" text,
	"assigned_at" timestamp with time zone,
	"arrived_pickup_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"arrived_dropoff_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_fare_positive" CHECK ("deliveries"."fare_amount" > 0),
	CONSTRAINT "deliveries_split_adds_up" CHECK ("deliveries"."commission_amount" + "deliveries"."rider_earning" = "deliveries"."fare_amount" and "deliveries"."commission_amount" >= 0),
	CONSTRAINT "deliveries_cancellation_fee_non_negative" CHECK ("deliveries"."cancellation_fee" >= 0),
	CONSTRAINT "deliveries_rider_when_active" CHECK ("deliveries"."status" not in ('assigned', 'arrived_pickup', 'picked_up', 'arrived_dropoff', 'returning', 'delivered', 'failed', 'returned') or "deliveries"."rider_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"from_status" "delivery_status",
	"to_status" "delivery_status" NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "actor_role" NOT NULL,
	"note" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"base_fare" numeric(12, 2) NOT NULL,
	"per_km" numeric(12, 2) NOT NULL,
	"minimum_fare" numeric(12, 2) NOT NULL,
	"max_distance_km" numeric(6, 2),
	"commission_rate" numeric(5, 4) NOT NULL,
	"cancellation_fee_after_arrival" numeric(12, 2) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_commission_range" CHECK ("pricing_rules"."commission_rate" >= 0 and "pricing_rules"."commission_rate" < 1),
	CONSTRAINT "pricing_rules_non_negative" CHECK ("pricing_rules"."base_fare" >= 0 and "pricing_rules"."per_km" >= 0 and "pricing_rules"."minimum_fare" > 0 and "pricing_rules"."cancellation_fee_after_arrival" >= 0)
);
--> statement-breakpoint
CREATE TABLE "riders" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"plate_number" text,
	"approval_status" "rider_approval" DEFAULT 'pending' NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"current_lat" numeric(9, 6),
	"current_lng" numeric(9, 6),
	"location_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riders_motorcycle_needs_plate" CHECK ("riders"."vehicle_type" <> 'motorcycle' or "riders"."plate_number" is not null)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_public_code_key" ON "deliveries" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_customer_idempotency_key" ON "deliveries" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_one_active_per_rider" ON "deliveries" USING btree ("rider_id") WHERE "deliveries"."status" in ('assigned', 'arrived_pickup', 'picked_up', 'arrived_dropoff', 'returning');--> statement-breakpoint
CREATE INDEX "deliveries_customer_created_idx" ON "deliveries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_status_created_idx" ON "deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "delivery_events_delivery_idx" ON "delivery_events" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_one_current_per_vehicle" ON "pricing_rules" USING btree ("vehicle_type") WHERE "pricing_rules"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "riders_dispatch_idx" ON "riders" USING btree ("approval_status","is_online","vehicle_type");