CREATE TABLE "rider_photos" (
	"rider_id" uuid PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"source" text DEFAULT 'kyc_face_front' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rider_photos" ADD CONSTRAINT "rider_photos_rider_id_riders_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("user_id") ON DELETE cascade ON UPDATE no action;