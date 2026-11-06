import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;

const envKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IP_HASH_SALT",
  "REEL_DRIVER",
  "ACTIVE_REEL_CAP",
] as const;

const previousEnv = new Map<string, string | undefined>();

function pinCapEnv(): void {
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role";
  process.env.IP_HASH_SALT ||= "salt";
  process.env.REEL_DRIVER ||= "fake";
  process.env.ACTIVE_REEL_CAP = "1";
}

afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

test.skipIf(!databaseUrl)("completed reels inside the window still allow another reel", async () => {
  pinCapEnv();
  const { db } = await import("@/lib/db/client");
  const { reels } = await import("@/lib/db/schema");
  const { assertCanCreateReel } = await import("@/lib/rate-limit");

  const ipHash = `cap-${randomUUID()}`;
  const now = new Date();
  const sessionIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  try {
    await db.insert(reels).values(
      sessionIds.map((sessionId) => ({
        status: "complete",
        sourceKind: "upload",
        ipHash,
        sessionId,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const result = await assertCanCreateReel({ ipHash, sessionId: randomUUID(), now });
    expect(result).toEqual({ ok: true });
  } finally {
    await db.delete(reels).where(eq(reels.ipHash, ipHash));
  }
});

test.skipIf(!databaseUrl)("one queued reel for a session returns reel_in_progress", async () => {
  pinCapEnv();
  const { db } = await import("@/lib/db/client");
  const { reels } = await import("@/lib/db/schema");
  const { assertCanCreateReel } = await import("@/lib/rate-limit");

  const sessionId = randomUUID();
  const existingHash = `busy-${randomUUID()}`;
  const requesterHash = `fresh-${randomUUID()}`;
  const now = new Date();
  try {
    await db.insert(reels).values({
      status: "queued",
      sourceKind: "upload",
      ipHash: existingHash,
      sessionId,
      createdAt: now,
      updatedAt: now,
    });

    const result = await assertCanCreateReel({ ipHash: requesterHash, sessionId, now });
    expect(result).toEqual({ ok: false, errorCode: "reel_in_progress" });
  } finally {
    await db.delete(reels).where(eq(reels.sessionId, sessionId));
  }
});
