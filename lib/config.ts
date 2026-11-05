export type ReelDriver = "fake" | "live";

export type AppConfig = {
  reelDriver: ReelDriver;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  magicHourWebhookSecret: string;
  imaginCustomerKey: string;
  ipHashSalt: string;
  cronSecret: string;
  dailyReelCap: number;
  activeReelCap: number;
  uploadDailyCap: number;
  sceneUserRetryCap: number;
  capOffsetMinutes: number;
  getReelPerMinute: number;
  vehicleSearchPerMinute: number;
  retryPerHour: number;
  imageModel: string;
  videoModel: string;
  downloadHosts: string[];
};

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Invalid integer ${trimmed}`);
  }
  return Number(trimmed);
}

function hosts(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return ["videos.magichour.ai"];
  const parsed = value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return parsed.length > 0 ? parsed : ["videos.magichour.ai"];
}

function optional(env: Env, key: string): string {
  return env[key] ?? "";
}

export function readConfig(env: Env): AppConfig {
  const imageModel = env.MAGIC_HOUR_IMAGE_MODEL?.trim() || "seedream-v4.5";
  const videoModel = env.MAGIC_HOUR_VIDEO_MODEL?.trim() || "kling-3.0";
  if (imageModel === "default" || videoModel === "default") {
    throw new Error('Refusing Magic Hour model "default"');
  }

  const driverRaw = env.REEL_DRIVER?.trim() || "fake";
  if (driverRaw !== "fake" && driverRaw !== "live") {
    throw new Error(`Invalid REEL_DRIVER ${driverRaw}`);
  }

  return {
    reelDriver: driverRaw,
    databaseUrl: required(env, "DATABASE_URL"),
    supabaseUrl: required(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    magicHourWebhookSecret: optional(env, "MAGIC_HOUR_WEBHOOK_SECRET"),
    imaginCustomerKey: optional(env, "IMAGIN_CUSTOMER_KEY"),
    ipHashSalt: required(env, "IP_HASH_SALT"),
    cronSecret: optional(env, "CRON_SECRET"),
    dailyReelCap: integer(env.DAILY_REEL_CAP, 3),
    activeReelCap: integer(env.ACTIVE_REEL_CAP, 1),
    uploadDailyCap: integer(env.UPLOAD_DAILY_CAP, 20),
    sceneUserRetryCap: integer(env.SCENE_USER_RETRY_CAP, 5),
    capOffsetMinutes: integer(env.CAP_UTC_OFFSET_MINUTES, -360),
    getReelPerMinute: integer(env.GET_REEL_PER_MINUTE, 60),
    vehicleSearchPerMinute: integer(env.VEHICLE_SEARCH_PER_MINUTE, 60),
    retryPerHour: integer(env.RETRY_PER_HOUR, 10),
    imageModel,
    videoModel,
    downloadHosts: hosts(env.MAGIC_HOUR_DOWNLOAD_HOSTS),
  };
}
