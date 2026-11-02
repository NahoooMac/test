CREATE TYPE "public"."kyc_document_kind" AS ENUM('license', 'plate', 'id_front', 'id_back', 'face_front', 'face_left', 'face_right');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('not_submitted', 'pending_review', 'approved', 'rejected', 'resubmission_required');--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"rider_id" uuid NOT NULL,
	"kind" "kyc_document_kind" NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_documents_rider_id_kind_pk" PRIMARY KEY("rider_id","kind")
);
--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "kyc_status" "kyc_status" DEFAULT 'not_submitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "kyc_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "kyc_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "kyc_reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "kyc_reason" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "kyc_retake" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_kyc_reviewed_by_users_id_fk" FOREIGN KEY ("kyc_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Riders approved before identity checks existed must verify too: back to pending and offline
-- (withdraw their open offers) until an admin approves their KYC.
UPDATE "delivery_offers" SET "status" = 'withdrawn', "responded_at" = now() WHERE "status" = 'offered' AND "rider_id" IN (SELECT "user_id" FROM "riders" WHERE "approval_status" = 'approved');--> statement-breakpoint
UPDATE "riders" SET "approval_status" = 'pending', "is_online" = false, "updated_at" = now() WHERE "approval_status" = 'approved';--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_approved_needs_kyc" CHECK ("riders"."approval_status" <> 'approved' or "riders"."kyc_status" = 'approved');