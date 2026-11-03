CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_events_project_event_status_unique" UNIQUE("project_id","event_type","status")
);
--> statement-breakpoint
CREATE TABLE "rate_buckets" (
	"ip_hash" text NOT NULL,
	"route" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_buckets_ip_hash_route_window_start_pk" PRIMARY KEY("ip_hash","route","window_start")
);
--> statement-breakpoint
CREATE TABLE "reel_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reel_id" uuid NOT NULL,
	"scene_key" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"image_project_id" text,
	"video_project_id" text,
	"still_path" text,
	"video_path" text,
	"credits_charged" integer,
	"error_code" text,
	"error_detail" text,
	"image_requested_at" timestamp with time zone,
	"video_requested_at" timestamp with time zone,
	"image_credits" integer,
	"video_credits" integer,
	"still_auto_retried" boolean DEFAULT false NOT NULL,
	"video_auto_retried" boolean DEFAULT false NOT NULL,
	"user_retries" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reel_scenes_reel_id_scene_key_unique" UNIQUE("reel_id","scene_key")
);
--> statement-breakpoint
CREATE TABLE "reels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"source_kind" text NOT NULL,
	"vehicle_id" uuid,
	"source_path" text,
	"error_code" text,
	"ip_hash" text NOT NULL,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_path" text NOT NULL,
	"ip_hash" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"warnings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reel_scenes" ADD CONSTRAINT "reel_scenes_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE no action ON UPDATE no action;