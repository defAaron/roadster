import { and, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reelScenes, reels, sources } from "@/lib/db/schema";
import { assertCanCreateReel, lockIp, windowStart, type DbTx } from "@/lib/rate-limit";
import { deriveReelStatus } from "@/lib/reel-status";
import { retryDecision } from "@/lib/retry";
import type { SceneKey, SceneStatus } from "@/lib/types";

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
    await tx.insert(reelScenes).values([
      {
        reelId: input.reelId,
        sceneKey: "kickflip",
        status: "pending",
        attempt: 1,
      },
      {
        reelId: input.reelId,
        sceneKey: "flyover",
        status: "pending",
        attempt: 1,
      },
    ]);
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

export async function saveFakeReelProgress(
  reelId: string,
  sceneStatus: "pending" | "editing" | "still_ready" | "animating" | "complete" | "failed",
  reelStatus: "queued" | "editing" | "animating" | "complete" | "partial" | "failed",
  paths: Record<"kickflip" | "flyover", { stillPath?: string; videoPath?: string }>,
): Promise<void> {
  for (const key of ["kickflip", "flyover"] as const) {
    const files = paths[key];
    await db
      .update(reelScenes)
      .set({
        status: sceneStatus,
        ...(files.stillPath ? { stillPath: files.stillPath } : {}),
        ...(files.videoPath ? { videoPath: files.videoPath } : {}),
      })
      .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
  }
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

const SCENE_STATUSES = new Set<SceneStatus>(["pending", "editing", "still_ready", "animating", "complete", "failed"]);
const CLAIMABLE_STATUSES = ["failed", "complete"] as const;
const OPEN_STATUSES = ["editing", "still_ready", "animating"] as const;

function asSceneStatus(value: string): SceneStatus {
  if (!SCENE_STATUSES.has(value as SceneStatus)) throw new Error(`Unexpected scene status ${value}`);
  return value as SceneStatus;
}

export type SceneRetryRow = {
  status: SceneStatus;
  userRetries: number;
  attempt: number;
  errorCode: string | null;
  stillPath: string | null;
  videoPath: string | null;
  imageProjectId: string | null;
  videoProjectId: string | null;
};

export async function loadSceneForRetry(reelId: string, sceneKey: SceneKey): Promise<SceneRetryRow | null> {
  const [row] = await db
    .select({
      status: reelScenes.status,
      userRetries: reelScenes.userRetries,
      attempt: reelScenes.attempt,
      errorCode: reelScenes.errorCode,
      stillPath: reelScenes.stillPath,
      videoPath: reelScenes.videoPath,
      imageProjectId: reelScenes.imageProjectId,
      videoProjectId: reelScenes.videoProjectId,
    })
    .from(reelScenes)
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, sceneKey)))
    .limit(1);
  if (!row) return null;
  return { ...row, status: asSceneStatus(row.status) };
}

export type SceneClaimResult =
  | { ok: true; phase: "image" | "video"; userRetries: number; attempt: number }
  | { ok: false; errorCode: "not_found" | "scene_in_flight" | "retry_cap" };

export async function claimSceneRetry(input: { reelId: string; sceneKey: SceneKey; cap: number }): Promise<SceneClaimResult> {
  return db.transaction(async (tx) => {
    const [scene] = await tx
      .select()
      .from(reelScenes)
      .where(and(eq(reelScenes.reelId, input.reelId), eq(reelScenes.sceneKey, input.sceneKey)))
      .limit(1)
      .for("update");
    if (!scene) return { ok: false, errorCode: "not_found" };

    const status = asSceneStatus(scene.status);
    const decision = retryDecision({
      status,
      userRetries: scene.userRetries,
      cap: input.cap,
      hasFile: scene.stillPath != null || scene.videoPath != null,
      errorCode: scene.errorCode,
    });
    if (decision.action === "reject-in-flight") return { ok: false, errorCode: "scene_in_flight" };
    if (decision.action === "reject-cap") return { ok: false, errorCode: "retry_cap" };

    const hasStill = scene.stillPath != null;
    const nextRetries = decision.action === "new-job" ? scene.userRetries + 1 : scene.userRetries;
    const nextAttempt = decision.action === "new-job" ? scene.attempt + 1 : scene.attempt;
    const claimable = and(eq(reelScenes.id, scene.id), inArray(reelScenes.status, [...CLAIMABLE_STATUSES]));
    const updated =
      decision.action === "redownload"
        ? await tx
            .update(reelScenes)
            .set({
              status: hasStill ? "still_ready" : "editing",
              errorCode: null,
              errorDetail: null,
            })
            .where(claimable)
            .returning({ id: reelScenes.id })
        : hasStill
          ? await tx
              .update(reelScenes)
              .set({
                status: "still_ready",
                userRetries: nextRetries,
                attempt: nextAttempt,
                videoProjectId: null,
                videoRequestedAt: null,
                videoPath: null,
                errorCode: null,
                errorDetail: null,
              })
              .where(claimable)
              .returning({ id: reelScenes.id })
          : await tx
              .update(reelScenes)
              .set({
                status: "editing",
                userRetries: nextRetries,
                attempt: nextAttempt,
                imageProjectId: null,
                imageRequestedAt: null,
                stillPath: null,
                videoProjectId: null,
                videoRequestedAt: null,
                videoPath: null,
                errorCode: null,
                errorDetail: null,
              })
              .where(claimable)
              .returning({ id: reelScenes.id });

    if (updated.length === 0) {
      const [fresh] = await tx
        .select({
          status: reelScenes.status,
          userRetries: reelScenes.userRetries,
          errorCode: reelScenes.errorCode,
          stillPath: reelScenes.stillPath,
          videoPath: reelScenes.videoPath,
        })
        .from(reelScenes)
        .where(eq(reelScenes.id, scene.id))
        .limit(1);
      if (!fresh) return { ok: false, errorCode: "not_found" };
      const again = retryDecision({
        status: asSceneStatus(fresh.status),
        userRetries: fresh.userRetries,
        cap: input.cap,
        hasFile: fresh.stillPath != null || fresh.videoPath != null,
        errorCode: fresh.errorCode,
      });
      return again.action === "reject-cap"
        ? { ok: false, errorCode: "retry_cap" }
        : { ok: false, errorCode: "scene_in_flight" };
    }

    await refreshReelStatus(tx, input.reelId);
    return { ok: true, phase: hasStill ? "video" : "image", userRetries: nextRetries, attempt: nextAttempt };
  });
}

export async function failClaimedScene(reelId: string, sceneKey: SceneKey): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(reelScenes)
      .set({ status: "failed", errorCode: "provider_error" })
      .where(
        and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, sceneKey), inArray(reelScenes.status, [...OPEN_STATUSES])),
      )
      .returning({ id: reelScenes.id });
    if (updated.length === 0) return;
    await refreshReelStatus(tx, reelId);
  });
}

export async function saveFakeSceneStep(
  reelId: string,
  sceneKey: SceneKey,
  status: SceneStatus,
  files: { stillPath?: string; videoPath?: string },
  expected: { userRetries: number; attempt: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(reelScenes)
      .set({
        status,
        ...(files.stillPath ? { stillPath: files.stillPath } : {}),
        ...(files.videoPath ? { videoPath: files.videoPath } : {}),
      })
      .where(
        and(
          eq(reelScenes.reelId, reelId),
          eq(reelScenes.sceneKey, sceneKey),
          eq(reelScenes.userRetries, expected.userRetries),
          eq(reelScenes.attempt, expected.attempt),
          inArray(reelScenes.status, [...OPEN_STATUSES]),
        ),
      )
      .returning({ id: reelScenes.id });
    if (updated.length === 0) return;
    await refreshReelStatus(tx, reelId);
  });
}

async function refreshReelStatus(tx: DbTx, reelId: string): Promise<void> {
  const rows = await tx
    .select({ status: reelScenes.status })
    .from(reelScenes)
    .where(eq(reelScenes.reelId, reelId));
  const derived = deriveReelStatus(rows.map((row) => ({ status: asSceneStatus(row.status) })));
  await tx.update(reels).set({ status: derived, updatedAt: new Date() }).where(eq(reels.id, reelId));
}
