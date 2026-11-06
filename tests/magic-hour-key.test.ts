import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";
import { MagicHourKeyField } from "@/components/magic-hour-key";
import { userError } from "@/lib/copy";
import {
  decryptMagicHourKey,
  encryptMagicHourKey,
  magicHourClientFromCiphertext,
  storedMagicHourKey,
} from "@/lib/magic-hour/stored-key";

const mocks = vi.hoisted(() => ({
  loadReel: vi.fn(),
  incrementRateBucket: vi.fn(async () => 1),
  createReelFromSource: vi.fn(),
  loadSource: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

vi.mock("@/lib/db/reels", () => ({
  loadReel: mocks.loadReel,
  incrementRateBucket: mocks.incrementRateBucket,
  createReelFromSource: mocks.createReelFromSource,
  loadSource: mocks.loadSource,
}));

const REEL_ID = "11111111-1111-4111-8111-111111111111";
const PLAINTEXT = "stored-plaintext-sentinel!";
const CIPHERTEXT = "stored-ciphertext-sentinel";
const ENV_KEY = "server-env-key-do-not-use";
const LONG_KEY = `visitor-secret-key!${"a".repeat(240)}`;

const ENV_NAMES = [
  "REEL_DRIVER",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IP_HASH_SALT",
  "MAGIC_HOUR_API_KEY",
] as const;

const liveEnv = {
  REEL_DRIVER: "live",
  DATABASE_URL: "postgres://local/roadster",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  IP_HASH_SALT: "salt",
  MAGIC_HOUR_API_KEY: undefined,
} as const;

function withEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_NAMES) previous.set(key, process.env[key]);
  for (const key of ENV_NAMES) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function postReels(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function silence(): () => string {
  const lines: string[] = [];
  const write =
    (spy: "log" | "info" | "error" | "warn") =>
    (...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
  const log = vi.spyOn(console, "log").mockImplementation(write("log"));
  const info = vi.spyOn(console, "info").mockImplementation(write("info"));
  const error = vi.spyOn(console, "error").mockImplementation(write("error"));
  const warn = vi.spyOn(console, "warn").mockImplementation(write("warn"));
  return () => {
    log.mockRestore();
    info.mockRestore();
    error.mockRestore();
    warn.mockRestore();
    return lines.join("\n");
  };
}

beforeEach(() => {
  mocks.loadReel.mockReset();
  mocks.incrementRateBucket.mockReset();
  mocks.incrementRateBucket.mockResolvedValue(1);
  mocks.createReelFromSource.mockReset();
  mocks.loadSource.mockReset();
});

test("live create rejects a missing, blank, or overlong magic hour key", async () => {
  const restore = withEnv(liveEnv);
  const done = silence();
  try {
    const { POST } = await import("@/app/api/reels/route");
    const cases = [
      {},
      { magicHourApiKey: "   " },
      { magicHourApiKey: LONG_KEY },
      { magicHourApiKey: 12 },
    ];
    for (const body of cases) {
      const response = await POST(postReels(body));
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(JSON.parse(text)).toEqual({ error_code: "missing_api_key" });
      expect(text).not.toContain(LONG_KEY);
      expect(text).not.toContain("visitor-secret-key!");
    }
    expect(mocks.createReelFromSource).not.toHaveBeenCalled();
    expect(mocks.loadSource).not.toHaveBeenCalled();
    expect(done()).not.toContain(LONG_KEY);
    expect(done()).not.toContain("visitor-secret-key!");
  } finally {
    done();
    restore();
  }
});

test("a missing hash salt fails the reel request and stores nothing", async () => {
  const restore = withEnv({ ...liveEnv, IP_HASH_SALT: undefined });
  const done = silence();
  try {
    const { POST } = await import("@/app/api/reels/route");
    const response = await POST(postReels({ sourceId: REEL_ID, magicHourApiKey: PLAINTEXT }));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error_code: "provider_error" });
    expect(text).not.toContain(PLAINTEXT);
    expect(mocks.createReelFromSource).not.toHaveBeenCalled();
    expect(done()).not.toContain(PLAINTEXT);
  } finally {
    done();
    restore();
  }
});

test("a reel json response does not contain the visitor key or its ciphertext", async () => {
  const restore = withEnv({ ...liveEnv, MAGIC_HOUR_API_KEY: ENV_KEY });
  const done = silence();
  try {
    mocks.loadReel.mockResolvedValue({
      id: REEL_ID,
      errorCode: null,
      magicHourApiKey: PLAINTEXT,
      magicHourKeyCiphertext: CIPHERTEXT,
      scenes: [
        {
          sceneKey: "kickflip",
          status: "pending",
          stillPath: null,
          videoPath: null,
          errorCode: null,
          magicHourApiKey: PLAINTEXT,
          magicHourKeyCiphertext: CIPHERTEXT,
        },
      ],
    });
    const { GET } = await import("@/app/api/reels/[id]/route");
    const response = await GET(new NextRequest(`http://localhost/api/reels/${REEL_ID}`), {
      params: Promise.resolve({ id: REEL_ID }),
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      id: REEL_ID,
      status: "queued",
      errorCode: null,
      scenes: [{ key: "kickflip", status: "pending", stillUrl: null, videoUrl: null, errorCode: null }],
    });
    expect(text).not.toContain(PLAINTEXT);
    expect(text).not.toContain(CIPHERTEXT);
    expect(text).not.toContain(ENV_KEY);
    expect(done()).not.toContain(PLAINTEXT);
    expect(done()).not.toContain(CIPHERTEXT);
    expect(done()).not.toContain(ENV_KEY);
  } finally {
    done();
    restore();
  }
});

test("the cron uses the key stored on the reel", () => {
  const cron = readFileSync("app/api/cron/magic-hour/route.ts", "utf8");
  const steps = readFileSync("workflows/steps.ts", "utf8");
  expect(cron).toContain("magicHourClientFromCiphertext(job.row.key_ciphertext, config)");
  expect(cron).toContain("r.magic_hour_key_ciphertext as key_ciphertext");
  expect(cron).not.toContain("MAGIC_HOUR_API_KEY");
  expect(cron).not.toContain("magicHourApiKey");
  expect(steps).toContain("loadMagicHourKeyCiphertext");
  expect(steps).toContain("magicHourClientFromCiphertext");
  expect(steps).not.toContain("magicHourApiKey");
  expect(steps).not.toContain("MAGIC_HOUR_API_KEY");

  const previous = process.env.MAGIC_HOUR_API_KEY;
  process.env.MAGIC_HOUR_API_KEY = ENV_KEY;
  try {
    const salt = "ip-hash-salt";
    const stored = "visitor-key-for-this-reel!";
    const ciphertext = encryptMagicHourKey(stored, salt);
    const config = {
      ipHashSalt: salt,
      imageModel: "seedream-v4.5",
      videoModel: "kling-3.0",
      downloadHosts: ["videos.magichour.ai"],
    };
    let seen = "";
    const client = magicHourClientFromCiphertext(ciphertext, config, (opts) => {
      seen = opts.apiKey;
      return {
        uploadImage: async () => "file",
        createImage: async () => ({ id: "image", creditsCharged: 0 }),
        createVideo: async () => ({ id: "video", creditsCharged: 0 }),
        getImage: async () => ({ id: "image", status: "queued" as const, creditsCharged: null, downloads: [], error: null }),
        getVideo: async () => ({ id: "video", status: "queued" as const, creditsCharged: null, downloads: [], error: null }),
      };
    });
    expect(client).not.toBeNull();
    expect(seen).toBe(stored);
    expect(seen).not.toBe(ENV_KEY);
    expect(ciphertext).not.toContain(stored);
    expect(
      magicHourClientFromCiphertext(null, config, () => {
        throw new Error("env key must not be used");
      }),
    ).toBeNull();
    expect(
      magicHourClientFromCiphertext("  ", config, () => {
        throw new Error("env key must not be used");
      }),
    ).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.MAGIC_HOUR_API_KEY;
    else process.env.MAGIC_HOUR_API_KEY = previous;
  }
});

test("the visitor key is encrypted with the hash salt and omitted from errors", () => {
  const key = "visitor-key-for-this-reel!";
  const salt = "ip-hash-salt";
  const stored = storedMagicHourKey({ driver: "live", magicHourApiKey: `  ${key}  `, salt });
  expect(stored.ok).toBe(true);
  if (!stored.ok) return;
  expect(stored.ciphertext).not.toBeNull();
  expect(stored.ciphertext).not.toContain(key);
  expect(decryptMagicHourKey(stored.ciphertext ?? "", salt)).toBe(key);
  expect(() => decryptMagicHourKey(stored.ciphertext ?? "", "other-salt")).toThrow();
  try {
    decryptMagicHourKey(stored.ciphertext ?? "", "other-salt");
  } catch (error) {
    expect(error instanceof Error ? error.message : "").not.toContain(key);
  }

  const tooLong = storedMagicHourKey({ driver: "live", magicHourApiKey: "b".repeat(257), salt });
  expect(tooLong).toEqual({ ok: false, errorCode: "missing_api_key" });
  expect(JSON.stringify(tooLong)).not.toContain("b".repeat(20));
  const max = storedMagicHourKey({ driver: "live", magicHourApiKey: "c".repeat(256), salt });
  expect(max.ok).toBe(true);

  const missingSalt = storedMagicHourKey({ driver: "live", magicHourApiKey: key, salt: "  " });
  expect(missingSalt).toEqual({ ok: false, errorCode: "provider_error" });
  expect(JSON.stringify(missingSalt)).not.toContain(key);

  const ignored = storedMagicHourKey({ driver: "fake", magicHourApiKey: key, salt });
  expect(ignored).toEqual({ ok: true, ciphertext: null });
  expect(JSON.stringify(ignored)).not.toContain(key);
  expect(userError("missing_api_key")).toBe("Add your Magic Hour API key.");
});

test("the home page shows an empty magic hour key field", () => {
  const html = renderToStaticMarkup(createElement(MagicHourKeyField, null, createElement("p", null, "flows")));
  expect(html).toContain("Connect your Magic Hour API key");
  expect(html).toContain('href="https://magichour.ai"');
  expect(html.replaceAll("&#x27;", "'")).toContain("Built using Magic Hour AI's API");
  expect(html).toContain('type="password"');
  expect(html.toLowerCase()).toContain('autocomplete="off"');
  expect(html).toContain('value=""');
  expect(html).toContain("flows");
  expect(html).not.toContain(ENV_KEY);
  expect(html).not.toContain(PLAINTEXT);
});
