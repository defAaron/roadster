import { expect, test } from "vitest";
import { readConfig } from "@/lib/config";

const fakeEnv = {
  REEL_DRIVER: "fake",
  DATABASE_URL: "postgres://local/roadster",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  IP_HASH_SALT: "salt",
};

test("defaults match the PRD caps and pinned models", () => {
  const config = readConfig({ ...fakeEnv });
  expect(config.dailyReelCap).toBe(3);
  expect(config.activeReelCap).toBe(1);
  expect(config.uploadDailyCap).toBe(20);
  expect(config.sceneUserRetryCap).toBe(5);
  expect(config.capOffsetMinutes).toBe(-360);
  expect(config.imageModel).toBe("seedream-v4.5");
  expect(config.videoModel).toBe("kling-3.0");
  expect(config.getReelPerMinute).toBe(60);
  expect(config.vehicleSearchPerMinute).toBe(60);
  expect(config.retryPerHour).toBe(10);
  expect(config.downloadHosts).toEqual(["videos.magichour.ai"]);
  expect(config.reelDriver).toBe("fake");
  expect(config.magicHourApiKey).toBe("");
  expect(config.magicHourWebhookSecret).toBe("");
  expect(config.cronSecret).toBe("");
  expect(config.imaginCustomerKey).toBe("");
});

test("refuses the magic hour default model", () => {
  expect(() =>
    readConfig({
      ...fakeEnv,
      MAGIC_HOUR_IMAGE_MODEL: "default",
    }),
  ).toThrow(/default/);
  expect(() =>
    readConfig({
      ...fakeEnv,
      MAGIC_HOUR_VIDEO_MODEL: "default",
    }),
  ).toThrow(/default/);
});

test("an unset reel driver defaults to fake and still requires storage", () => {
  const config = readConfig({
    DATABASE_URL: fakeEnv.DATABASE_URL,
    SUPABASE_URL: fakeEnv.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: fakeEnv.SUPABASE_SERVICE_ROLE_KEY,
    IP_HASH_SALT: fakeEnv.IP_HASH_SALT,
  });
  expect(config.reelDriver).toBe("fake");
  expect(() =>
    readConfig({
      SUPABASE_URL: fakeEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: fakeEnv.SUPABASE_SERVICE_ROLE_KEY,
      IP_HASH_SALT: fakeEnv.IP_HASH_SALT,
    }),
  ).toThrow(/DATABASE_URL/);
});

test("live driver requires the magic hour key and fake does not", () => {
  expect(() => readConfig({ ...fakeEnv, REEL_DRIVER: "live" })).toThrow(/MAGIC_HOUR_API_KEY/);
  const live = readConfig({ ...fakeEnv, REEL_DRIVER: "live", MAGIC_HOUR_API_KEY: "mh-key" });
  expect(live.magicHourApiKey).toBe("mh-key");
  expect(live.reelDriver).toBe("live");
});

test("parses integer overrides and splits download hosts", () => {
  const config = readConfig({
    ...fakeEnv,
    DAILY_REEL_CAP: "4",
    CAP_UTC_OFFSET_MINUTES: "-300",
    MAGIC_HOUR_DOWNLOAD_HOSTS: "videos.magichour.ai, cdn.example.com",
    MAGIC_HOUR_WEBHOOK_SECRET: "whsec",
    CRON_SECRET: "cron",
    IMAGIN_CUSTOMER_KEY: "imagin",
  });
  expect(config.dailyReelCap).toBe(4);
  expect(config.capOffsetMinutes).toBe(-300);
  expect(config.downloadHosts).toEqual(["videos.magichour.ai", "cdn.example.com"]);
  expect(config.magicHourWebhookSecret).toBe("whsec");
  expect(config.cronSecret).toBe("cron");
  expect(config.imaginCustomerKey).toBe("imagin");
});
