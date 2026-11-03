import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reelScenes, reels, sources } from "@/lib/db/schema";
import { assertCanCreateReel, lockIp, windowStart } from "@/lib/rate-limit";

export async function insertPendingSource(input: {
  id: string;
  storagePath: string;
  ipHash: string;
  width: number;
  height: number;
  warnings: Array<"dark" | "cropped">;
  now: Date;
  uploadDailyCap: number;
  capOffsetMinutes: number;
}): Promise<{ ok: true } | { ok: false; errorCode: "daily_cap" }> {
  return db.transaction(async (tx) => {
    await lockIp(tx, input.ipHash);
    const start = windowStart(input.now, input.capOffsetMinutes);
    const [row] = await tx
      .select({ value: count() })
      .from(sources)
      .where(and(eq(sources.ipHash, input.ipHash), gte(sources.createdAt, start)));
    if (Number(row?.value ?? 0) >= input.uploadDailyCap) return { ok: false, errorCode: "daily_cap" };
    await tx.insert(sources).values({
      id: input.id,
      storagePath: input.storagePath,
      ipHash: input.ipHash,
      width: input.width,
      height: input.height,
      warnings: input.warnings,
      createdAt: input.now,
    });
    return { ok: true };
  });
}

export async function deleteSource(id: string): Promise<void> {
  await db.delete(sources).where(eq(sources.id, id));
}

export async function loadSource(id: string) {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ?? null;
}

export async function createReelFromSource(input: {
  reelId: string;
  sourceId: string;
  sourcePath: string;
  ipHash: string;
  sessionId: string;
  now: Date;
}): Promise<{ ok: true } | { ok: false; errorCode: "daily_cap" | "reel_in_progress" | "not_found" }> {
  return db.transaction(async (tx) => {
    const gate = await assertCanCreateReel(
      { ipHash: input.ipHash, sessionId: input.sessionId, now: input.now },
      tx,
    );
    if (!gate.ok) return gate;

    const consumed = await tx
      .update(sources)
      .set({ consumedAt: input.now })
      .where(and(eq(sources.id, input.sourceId), isNull(sources.consumedAt)))
      .returning({ id: sources.id });
    if (consumed.length === 0) return { ok: false, errorCode: "not_found" };

    await tx.insert(reels).values({
      id: input.reelId,
      status: "queued",
      sourceKind: "upload",
      sourcePath: input.sourcePath,
      ipHash: input.ipHash,
      sessionId: input.sessionId,
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(reelScenes).values({
      reelId: input.reelId,
      sceneKey: "kickflip",
      status: "pending",
      attempt: 1,
    });
    return { ok: true };
  });
}

export type LoadedScene = {
  sceneKey: string;
  status: string;
  stillPath: string | null;
  videoPath: string | null;
  errorCode: string | null;
};

export type LoadedReel = {
  id: string;
  errorCode: string | null;
  scenes: LoadedScene[];
};

export async function loadReel(id: string): Promise<LoadedReel | null> {
  const [reel] = await db
    .select({ id: reels.id, errorCode: reels.errorCode })
    .from(reels)
    .where(eq(reels.id, id))
    .limit(1);
  if (!reel) return null;
  const scenes = await db
    .select({
      sceneKey: reelScenes.sceneKey,
      status: reelScenes.status,
      stillPath: reelScenes.stillPath,
      videoPath: reelScenes.videoPath,
      errorCode: reelScenes.errorCode,
    })
    .from(reelScenes)
    .where(eq(reelScenes.reelId, id));
  return { id: reel.id, errorCode: reel.errorCode, scenes };
}

export async function saveKickflipProgress(
  reelId: string,
  sceneStatus: "pending" | "editing" | "still_ready" | "animating" | "complete" | "failed",
  reelStatus: "queued" | "editing" | "animating" | "complete" | "partial" | "failed",
  paths: { stillPath?: string; videoPath?: string },
): Promise<void> {
  await db
    .update(reelScenes)
    .set({
      status: sceneStatus,
      ...(paths.stillPath ? { stillPath: paths.stillPath } : {}),
      ...(paths.videoPath ? { videoPath: paths.videoPath } : {}),
    })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, "kickflip")));
  await db.update(reels).set({ status: reelStatus, updatedAt: new Date() }).where(eq(reels.id, reelId));
}

export async function incrementRateBucket(ipHash: string, route: string, bucketStart: Date): Promise<number> {
  const rows = await db.execute<{ count: number | string }>(sql`
    insert into rate_buckets (ip_hash, route, window_start, count)
    values (${ipHash}, ${route}, ${bucketStart}, 1)
    on conflict (ip_hash, route, window_start)
    do update set count = rate_buckets.count + 1
    returning count
  `);
  const first = rows[0];
  return Number(first?.count ?? 0);
}
