import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;

test.skipIf(!databaseUrl)("incrementRateBucket accepts a Date window and returns a positive count", async () => {
  const { db } = await import("@/lib/db/client");
  const { rateBuckets } = await import("@/lib/db/schema");
  const { incrementRateBucket } = await import("@/lib/db/reels");
  const { minuteWindowStart } = await import("@/lib/rate-limit");

  const ipHash = `rate-${randomUUID()}`;
  try {
    const count = await incrementRateBucket(ipHash, "vehicle_search", minuteWindowStart(new Date()));
    expect(count).toBeGreaterThan(0);
  } finally {
    await db.delete(rateBuckets).where(eq(rateBuckets.ipHash, ipHash));
  }
});
