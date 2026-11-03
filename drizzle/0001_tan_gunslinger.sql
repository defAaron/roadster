CREATE TABLE "vehicle_images" (
	"vehicle_id" uuid NOT NULL,
	"angle" text NOT NULL,
	"storage_path" text NOT NULL,
	"source" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	CONSTRAINT "vehicle_images_vehicle_id_angle_pk" PRIMARY KEY("vehicle_id","angle")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"make_key" text NOT NULL,
	"model_key" text NOT NULL,
	"query" text NOT NULL,
	CONSTRAINT "vehicles_year_make_key_model_key_unique" UNIQUE("year","make_key","model_key")
);
--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;