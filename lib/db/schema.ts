import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  storagePath: text("storage_path").notNull(),
  ipHash: text("ip_hash").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  warnings: jsonb("warnings").$type<Array<"dark" | "cropped">>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    makeKey: text("make_key").notNull(),
    modelKey: text("model_key").notNull(),
    query: text("query").notNull(),
  },
  (table) => [unique("vehicles_year_make_key_model_key_unique").on(table.year, table.makeKey, table.modelKey)],
);

export const vehicleImages = pgTable(
  "vehicle_images",
  {
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    angle: text("angle").notNull(),
    storagePath: text("storage_path").notNull(),
    source: text("source").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
  },
  (table) => [primaryKey({ columns: [table.vehicleId, table.angle] })],
);

export const reels = pgTable("reels", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull(),
  sourceKind: text("source_kind").notNull(),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  sourcePath: text("source_path"),
  errorCode: text("error_code"),
  ipHash: text("ip_hash").notNull(),
  sessionId: text("session_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reelScenes = pgTable(
  "reel_scenes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    reelId: uuid("reel_id")
      .notNull()
      .references(() => reels.id),
    sceneKey: text("scene_key").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    imageProjectId: text("image_project_id"),
    videoProjectId: text("video_project_id"),
    stillPath: text("still_path"),
    videoPath: text("video_path"),
    creditsCharged: integer("credits_charged"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    imageRequestedAt: timestamp("image_requested_at", { withTimezone: true }),
    videoRequestedAt: timestamp("video_requested_at", { withTimezone: true }),
    imageCredits: integer("image_credits"),
    videoCredits: integer("video_credits"),
    stillAutoRetried: boolean("still_auto_retried").notNull().default(false),
    videoAutoRetried: boolean("video_auto_retried").notNull().default(false),
    userRetries: integer("user_retries").notNull().default(0),
  },
  (table) => [unique("reel_scenes_reel_id_scene_key_unique").on(table.reelId, table.sceneKey)],
);

export const providerEvents = pgTable(
  "provider_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: text("project_id").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("provider_events_project_event_status_unique").on(table.projectId, table.eventType, table.status)],
);

export const rateBuckets = pgTable(
  "rate_buckets",
  {
    ipHash: text("ip_hash").notNull(),
    route: text("route").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ipHash, table.route, table.windowStart] })],
);
