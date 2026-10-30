CREATE TYPE "public"."lockout_scope" AS ENUM('phone', 'ip');--> statement-breakpoint
CREATE TYPE "public"."otp_close_reason" AS ENUM('consumed', 'expired', 'max_attempts', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'failed', 'delivered', 'undelivered');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'rider', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "auth_lockouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "lockout_scope" NOT NULL,
	"subject" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"purpose" "otp_purpose" DEFAULT 'login' NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"send_count" smallint DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" "otp_close_reason",
	"request_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_attempts_range" CHECK ("otp_challenges"."attempts" >= 0 and "otp_challenges"."attempts" <= "otp_challenges"."max_attempts"),
	CONSTRAINT "otp_challenges_close_consistency" CHECK (("otp_challenges"."closed_at" is null) = ("otp_challenges"."close_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"slug" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_am" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"user_agent" text,
	"ip" text,
	CONSTRAINT "sessions_expiry_order" CHECK ("sessions"."expires_at" <= "sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"phone_e164" text NOT NULL,
	"purpose" text NOT NULL,
	"challenge_id" uuid,
	"provider_message_id" text,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"error_message" text,
	"cost_amount" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"full_name" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164_format" CHECK ("users"."phone_e164" ~ '^\+251[79][0-9]{8}$'),
	CONSTRAINT "users_preferred_language_check" CHECK ("users"."preferred_language" in ('en', 'am'))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_lockouts_lookup_idx" ON "auth_lockouts" USING btree ("scope","subject","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_challenges_one_open_per_phone" ON "otp_challenges" USING btree ("phone_e164","purpose") WHERE "otp_challenges"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_created_idx" ON "otp_challenges" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_idx" ON "rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sms_messages_phone_created_idx" ON "sms_messages" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE INDEX "sms_messages_created_idx" ON "sms_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_messages_provider_message_key" ON "sms_messages" USING btree ("provider","provider_message_id") WHERE "sms_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users" USING btree ("phone_e164");