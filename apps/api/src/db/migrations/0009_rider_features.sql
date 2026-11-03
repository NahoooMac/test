CREATE TYPE "public"."points_type" AS ENUM('initial', 'completion', 'rider_cancellation', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."rating_status" AS ENUM('active', 'reported', 'removed');--> statement-breakpoint
CREATE TYPE "public"."route_stage" AS ENUM('to_pickup', 'to_dropoff', 'returning');--> statement-breakpoint
CREATE TYPE "public"."topup_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "delivery_ratings" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"rider_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"status" "rating_status" DEFAULT 'active' NOT NULL,
	"report_reason" text,
	"reported_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_ratings_stars" CHECK ("delivery_ratings"."stars" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "delivery_route_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"stage" "route_stage" NOT NULL,
	"accuracy_m" integer,
	"source" text DEFAULT 'gps' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_route_points_coords" CHECK ("delivery_route_points"."lat" between -90 and 90 and "delivery_route_points"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rider_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"delivery_id" uuid,
	"type" "points_type" NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_points_rules" CHECK (("rider_points"."type" = 'initial' and "rider_points"."delta" = 50) or ("rider_points"."type" = 'completion' and "rider_points"."delta" = 1 and "rider_points"."delivery_id" is not null) or ("rider_points"."type" = 'rider_cancellation' and "rider_points"."delta" = -3 and "rider_points"."delivery_id" is not null) or ("rider_points"."type" = 'adjustment' and "rider_points"."delta" <> 0 and "rider_points"."created_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "rider_service_areas" (
	"rider_id" uuid NOT NULL,
	"sub_city" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_service_areas_rider_id_sub_city_pk" PRIMARY KEY("rider_id","sub_city")
);
--> statement-breakpoint
CREATE TABLE "wallet_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text NOT NULL,
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_topups_amount" CHECK ("wallet_topups"."amount" > 0 and "wallet_topups"."amount" <= 100000),
	CONSTRAINT "wallet_topups_method" CHECK ("wallet_topups"."method" in ('telebirr', 'cbe_birr'))
);
--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD COLUMN "score" jsonb;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "home_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "home_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "home_radius_km" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_route_points" ADD CONSTRAINT "delivery_route_points_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_route_points" ADD CONSTRAINT "delivery_route_points_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_points" ADD CONSTRAINT "rider_points_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_points" ADD CONSTRAINT "rider_points_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_points" ADD CONSTRAINT "rider_points_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_service_areas" ADD CONSTRAINT "rider_service_areas_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_service_areas" ADD CONSTRAINT "rider_service_areas_sub_city_service_areas_slug_fk" FOREIGN KEY ("sub_city") REFERENCES "public"."service_areas"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_ratings_rider_idx" ON "delivery_ratings" USING btree ("rider_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_ratings_status_idx" ON "delivery_ratings" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_route_points_once" ON "delivery_route_points" USING btree ("delivery_id","recorded_at");--> statement-breakpoint
CREATE INDEX "delivery_route_points_received_idx" ON "delivery_route_points" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rider_points_one_initial" ON "rider_points" USING btree ("rider_id") WHERE "rider_points"."type" = 'initial';--> statement-breakpoint
CREATE UNIQUE INDEX "rider_points_once_per_delivery" ON "rider_points" USING btree ("delivery_id","rider_id","type") WHERE "rider_points"."type" in ('completion', 'rider_cancellation');--> statement-breakpoint
CREATE INDEX "rider_points_rider_idx" ON "rider_points" USING btree ("rider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_topups_unique_reference" ON "wallet_topups" USING btree ("method",upper("reference")) WHERE "wallet_topups"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "wallet_topups_status_idx" ON "wallet_topups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "wallet_topups_rider_idx" ON "wallet_topups" USING btree ("rider_id","created_at");--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_home_complete" CHECK (("riders"."home_lat" is null) = ("riders"."home_lng" is null) and ("riders"."home_radius_km" is null or ("riders"."home_lat" is not null and "riders"."home_radius_km" > 0 and "riders"."home_radius_km" <= 30)));--> statement-breakpoint
-- Every existing rider starts with the initial 50 points (new riders get theirs on applying).
INSERT INTO "rider_points" ("rider_id", "type", "delta", "reason") SELECT "user_id", 'initial', 50, 'Starting points' FROM "riders" ON CONFLICT DO NOTHING;
