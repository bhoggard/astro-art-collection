CREATE TYPE "public"."artwork_artist_role" AS ENUM('primary', 'additional');--> statement-breakpoint
CREATE TABLE "artwork_artists" (
	"artwork_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"role" "artwork_artist_role" NOT NULL,
	"sort_order" integer,
	CONSTRAINT "artwork_artists_artwork_id_contact_id_pk" PRIMARY KEY("artwork_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "artwork_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"artwork_id" integer NOT NULL,
	"r2_key" text,
	"caption" text,
	"sort_order" integer,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"artwork_id" integer NOT NULL,
	"name" text,
	"notes" text,
	"r2_key" text,
	"sort_order" integer
);
--> statement-breakpoint
ALTER TABLE "artwork_artists" ADD CONSTRAINT "artwork_artists_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_artists" ADD CONSTRAINT "artwork_artists_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_images" ADD CONSTRAINT "artwork_images_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_files" ADD CONSTRAINT "artwork_files_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE no action ON UPDATE no action;