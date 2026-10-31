CREATE TYPE "public"."contact_outcome" AS ENUM('no_answer', 'busy', 'unreachable', 'answered');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('offered', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TABLE "contact_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"outcome" "contact_outcome" NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'offered' NOT NULL,
	"to_pickup_km" numeric(6, 2) NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_attempts_delivery_idx" ON "contact_attempts" USING btree ("delivery_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_offers_one_open_per_delivery" ON "delivery_offers" USING btree ("delivery_id") WHERE "delivery_offers"."status" = 'offered';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_offers_one_open_per_rider" ON "delivery_offers" USING btree ("rider_id") WHERE "delivery_offers"."status" = 'offered';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_offers_once_per_rider" ON "delivery_offers" USING btree ("delivery_id","rider_id");--> statement-breakpoint
CREATE INDEX "delivery_offers_open_expiry_idx" ON "delivery_offers" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;