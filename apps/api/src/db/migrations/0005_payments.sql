CREATE TYPE "public"."ledger_type" AS ENUM('commission', 'settlement', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('fare', 'cancellation_fee');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('due', 'collected', 'waived');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method",
	"payer" "payer" NOT NULL,
	"reference" text,
	"collected_by" uuid,
	"recorded_by" uuid,
	"collected_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_collected_has_method" CHECK ("payments"."status" <> 'collected' or ("payments"."method" is not null and "payments"."collected_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "rider_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"type" "ledger_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"delivery_id" uuid,
	"method" "payment_method",
	"reference" text,
	"note" text,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_ledger_sign" CHECK (("rider_ledger"."type" = 'commission' and "rider_ledger"."amount" >= 0) or ("rider_ledger"."type" = 'settlement' and "rider_ledger"."amount" < 0) or "rider_ledger"."type" = 'adjustment')
);
--> statement-breakpoint
DROP INDEX "delivery_offers_once_per_rider";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "dispatch_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD COLUMN "round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_riders_user_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."riders"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_ledger" ADD CONSTRAINT "rider_ledger_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_ledger" ADD CONSTRAINT "rider_ledger_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_ledger" ADD CONSTRAINT "rider_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_per_delivery_kind" ON "payments" USING btree ("delivery_id","kind");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rider_ledger_one_commission_per_delivery" ON "rider_ledger" USING btree ("delivery_id") WHERE "rider_ledger"."type" = 'commission';--> statement-breakpoint
CREATE UNIQUE INDEX "rider_ledger_idempotency_key" ON "rider_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "rider_ledger_rider_idx" ON "rider_ledger" USING btree ("rider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_offers_once_per_rider_round" ON "delivery_offers" USING btree ("delivery_id","rider_id","round");