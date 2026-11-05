import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { FatalError } from "workflow";
import { readConfig } from "@/lib/config";
import { db } from "@/lib/db/client";
import { providerEvents, reelScenes, reels, vehicles } from "@/lib/db/schema";
import { alert } from "@/lib/log";
import { isUuid } from "@/lib/http/session";
import { downloadAllowed } from "@/lib/magic-hour/download";
import { createMagicHourClient, MagicHourHttpError, type MagicHourProject } from "@/lib/magic-hour/client";
import { deriveReelStatus } from "@/lib/reel-status";
import { reelObjectStore } from "@/lib/reels/store";
import { identityLine, scenePrompts } from "@/lib/scenes";
import type { ReelStatus, SceneKey, SceneStatus } from "@/lib/types";

const LOCKED_REEL_ERRORS = new Set(["provider_auth", "provider_billing"]);

export type CreatedProject =
  | { ok: true; projectId: string; requestedAt: string }
  | { ok: false };

export type ProjectSnapshot = {
  status: MagicHourProject["status"] | "rejected";
  downloads: { url: string }[];
  now: string;
};

type ScenePatch = {
  status: SceneStatus;
  errorCode?: string | null;
  errorDetail?: string | null;
};

export async function markReel(reelId: string, status: ReelStatus): Promise<void> {
  "use step";
  const now = await postgresNow();
  await db.update(reels).set({ status, updatedAt: now }).where(eq(reels.id, reelId));
}

export async function markScene(reelId: string, key: SceneKey, patch: ScenePatch): Promise<void> {
  "use step";
  const scene = await loadScene(reelId, key);
  const keepError = scene?.errorCode != null && LOCKED_REEL_ERRORS.has(scene.errorCode);
  await db
    .update(reelScenes)
    .set({
      status: patch.status,
      ...(patch.errorCode !== undefined && !keepError ? { errorCode: patch.errorCode } : {}),
      ...(patch.errorDetail !== undefined ? { errorDetail: clip(patch.errorDetail) } : {}),
    })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
}

export async function finishStatus(reelId: string): Promise<ReelStatus> {
  "use step";
  const rows = await db
    .select({ status: reelScenes.status })
    .from(reelScenes)
    .where(eq(reelScenes.reelId, reelId));
  return deriveReelStatus(rows.map((row) => ({ status: row.status as SceneStatus })));
}

export async function finishReel(reelId: string): Promise<void> {
  "use step";
  const [reel] = await db
    .select({ errorCode: reels.errorCode })
    .from(reels)
    .where(eq(reels.id, reelId))
    .limit(1);
  const locked = reel?.errorCode === "provider_auth" || reel?.errorCode === "provider_billing";
  if (locked) {
    const scenes = await db.select().from(reelScenes).where(eq(reelScenes.reelId, reelId));
    for (const scene of scenes) {
      if (scene.status === "complete" || scene.status === "failed") continue;
      await db
        .update(reelScenes)
        .set({ status: "failed", errorCode: scene.errorCode && LOCKED_REEL_ERRORS.has(scene.errorCode) ? scene.errorCode : reel.errorCode })
        .where(eq(reelScenes.id, scene.id));
    }
  }
  const rows = await db
    .select({ status: reelScenes.status })
    .from(reelScenes)
    .where(eq(reelScenes.reelId, reelId));
  const derived = deriveReelStatus(rows.map((row) => ({ status: row.status as SceneStatus })));
  const now = await postgresNow();
  await db
    .update(reels)
    .set({ status: locked ? "failed" : derived, updatedAt: now })
    .where(eq(reels.id, reelId));
}

export async function alertReelFailureRate(): Promise<void> {
  "use step";
  const rows = await db
    .select({ status: reels.status })
    .from(reels)
    .where(inArray(reels.status, ["complete", "partial", "failed"]))
    .orderBy(desc(reels.updatedAt))
    .limit(20);
  if (rows.length < 20) return;
  const failed = rows.filter((row) => row.status === "failed").length;
  if (failed / 20 > 0.5) alert("reel_failure_rate", { failed, total: 20 });
}

export async function reelProviderLock(reelId: string): Promise<"provider_auth" | "provider_billing" | null> {
  "use step";
  const [reel] = await db.select({ errorCode: reels.errorCode }).from(reels).where(eq(reels.id, reelId)).limit(1);
  if (reel?.errorCode === "provider_auth" || reel?.errorCode === "provider_billing") return reel.errorCode;
  return null;
}

export async function sceneSnapshot(
  reelId: string,
  key: SceneKey,
): Promise<{ status: SceneStatus; hasStill: boolean; hasVideo: boolean }> {
  "use step";
  const scene = await loadScene(reelId, key);
  return {
    status: (scene?.status ?? "failed") as SceneStatus,
    hasStill: Boolean(scene?.stillPath),
    hasVideo: Boolean(scene?.videoPath),
  };
}

export type SceneRetryPhase =
  | { kind: "redownload-image"; projectId: string }
  | { kind: "redownload-video"; projectId: string }
  | { kind: "new-image" }
  | { kind: "new-video" }
  | { kind: "idle" };

export async function sceneRetryPhase(reelId: string, key: SceneKey): Promise<SceneRetryPhase> {
  "use step";
  const scene = await loadScene(reelId, key);
  if (!scene) return { kind: "idle" };
  const hasStill = scene.stillPath != null;
  const hasVideo = scene.videoPath != null;
  if (scene.imageProjectId && !hasStill) return { kind: "redownload-image", projectId: scene.imageProjectId };
  if (scene.videoProjectId && hasStill && !hasVideo) return { kind: "redownload-video", projectId: scene.videoProjectId };
  if (!scene.imageProjectId) return { kind: "new-image" };
  if (hasStill && !scene.videoProjectId) return { kind: "new-video" };
  return { kind: "idle" };
}

const TERMINAL_PROVIDER_STATUSES = new Set(["complete", "error", "canceled"]);

export async function readTerminalEvent(projectId: string): Promise<{ status: string } | null> {
  "use step";
  const rows = await db
    .select({ status: providerEvents.status })
    .from(providerEvents)
    .where(eq(providerEvents.projectId, projectId))
    .orderBy(desc(providerEvents.receivedAt));
  const found = rows.find((row) => TERMINAL_PROVIDER_STATUSES.has(row.status) || row.status === "timeout");
  if (!found) return null;
  return { status: found.status };
}

export async function projectAgeSec(projectId: string, requestedAtIso: string): Promise<number> {
  "use step";
  const now = await postgresNow();
  const [scene] = await db
    .select({
      imageProjectId: reelScenes.imageProjectId,
      videoProjectId: reelScenes.videoProjectId,
      imageRequestedAt: reelScenes.imageRequestedAt,
      videoRequestedAt: reelScenes.videoRequestedAt,
    })
    .from(reelScenes)
    .where(or(eq(reelScenes.imageProjectId, projectId), eq(reelScenes.videoProjectId, projectId)))
    .limit(1);
  const stored = scene?.imageProjectId === projectId ? scene.imageRequestedAt : scene?.videoRequestedAt;
  const requestedMs = stored ? stored.getTime() : Date.parse(requestedAtIso);
  if (!Number.isFinite(requestedMs)) return 0;
  return (now.getTime() - requestedMs) / 1000;
}

export async function createImageIfNeeded(
  reelId: string,
  key: SceneKey,
  options: { forceNew: boolean },
): Promise<CreatedProject> {
  "use step";
  const scene = await loadScene(reelId, key);
  if (!scene) return failMissingScene(reelId);
  if (scene.imageProjectId && scene.imageRequestedAt && !options.forceNew) {
    return { ok: true, projectId: scene.imageProjectId, requestedAt: scene.imageRequestedAt.toISOString() };
  }

  const reel = await loadReel(reelId);
  if (!reel) return failMissingScene(reelId);
  if (isProviderLock(reel.errorCode)) {
    await failScene(reelId, key, reel.errorCode);
    return { ok: false };
  }
  if (!reel.sourcePath || !isSourcePath(reel.sourcePath)) {
    await failScene(reelId, key, "provider_error");
    return { ok: false };
  }
  const identity = reelPromptIdentity(reel);
  if (!identity) {
    await failScene(reelId, key, "provider_error");
    return { ok: false };
  }

  const attempt = options.forceNew ? scene.attempt + 1 : scene.attempt;
  const client = magicClient();
  let filePath: string;
  try {
    const jpeg = await reelObjectStore().get(reel.sourcePath);
    filePath = await client.uploadImage(jpeg, { reelId, sceneKey: key, attempt });
  } catch (error) {
    const settled = await settleHttpFailure(error, reelId, key);
    if (settled) return settled;
    throw error;
  }

  const beforePost = await loadReel(reelId);
  if (beforePost && isProviderLock(beforePost.errorCode)) {
    await failScene(reelId, key, beforePost.errorCode);
    return { ok: false };
  }

  try {
    const { stillPrompt } = scenePrompts(key, identity);
    const created = await client.createImage({
      name: `reel_${reelId}_${key}_still`,
      prompt: stillPrompt,
      filePath,
      reelId,
      sceneKey: key,
      attempt,
    });
    return await storeImageProject(reelId, key, created, attempt, options.forceNew);
  } catch (error) {
    const recovered = error instanceof MagicHourHttpError ? chargedId(error) : null;
    if (recovered) return storeImageProject(reelId, key, recovered, attempt, options.forceNew);
    const settled = await settleHttpFailure(error, reelId, key);
    if (settled) return settled;
    throw error;
  }
}

export async function createVideoIfNeeded(
  reelId: string,
  key: SceneKey,
  options: { forceNew: boolean },
): Promise<CreatedProject> {
  "use step";
  const scene = await loadScene(reelId, key);
  if (!scene) return failMissingScene(reelId);
  if (scene.videoProjectId && scene.videoRequestedAt && !options.forceNew) {
    return { ok: true, projectId: scene.videoProjectId, requestedAt: scene.videoRequestedAt.toISOString() };
  }
  const reel = await loadReel(reelId);
  if (!reel) return failMissingScene(reelId);
  if (isProviderLock(reel.errorCode)) {
    await failScene(reelId, key, reel.errorCode);
    return { ok: false };
  }
  if (!scene.imageProjectId) {
    await failScene(reelId, key, "provider_error");
    return { ok: false };
  }
  const identity = reelPromptIdentity(reel);
  if (!identity) {
    await failScene(reelId, key, "provider_error");
    return { ok: false };
  }

  const attempt = options.forceNew ? scene.attempt + 1 : scene.attempt;
  const stillPath = `results/${reelId}/${key}.jpg`;
  if (scene.stillPath !== stillPath) {
    await failScene(reelId, key, "provider_error");
    return { ok: false };
  }

  const client = magicClient();
  let imageFilePath: string;
  try {
    const jpeg = await reelObjectStore().get(stillPath);
    imageFilePath = await client.uploadImage(jpeg, { reelId, sceneKey: key, attempt });
  } catch (error) {
    const settled = await settleHttpFailure(error, reelId, key);
    if (settled) return settled;
    throw error;
  }

  try {
    const { motionPrompt } = scenePrompts(key, identity);
    const created = await client.createVideo({
      name: `reel_${reelId}_${key}`,
      prompt: motionPrompt,
      imageFilePath,
      reelId,
      sceneKey: key,
      attempt,
    });
    return await storeVideoProject(reelId, key, created, scene.imageCredits ?? 0, attempt, options.forceNew);
  } catch (error) {
    const recovered = error instanceof MagicHourHttpError ? chargedId(error) : null;
    if (recovered) {
      return storeVideoProject(reelId, key, recovered, scene.imageCredits ?? 0, attempt, options.forceNew);
    }
    const settled = await settleHttpFailure(error, reelId, key);
    if (settled) return settled;
    throw error;
  }
}

export async function getProject(
  reelId: string,
  key: SceneKey,
  projectId: string,
  kind: "image" | "video",
): Promise<ProjectSnapshot> {
  "use step";
  const client = magicClient();
  const context = { reelId, sceneKey: key };
  try {
    const project =
      kind === "image" ? await client.getImage(projectId, context) : await client.getVideo(projectId, context);
    return {
      status: project.status,
      downloads: project.downloads.map((item) => ({ url: item.url })),
      now: (await postgresNow()).toISOString(),
    };
  } catch (error) {
    if (error instanceof MagicHourHttpError && (error.status === 401 || error.status === 402)) {
      await settleHttpFailure(error, reelId, key);
      throw new FatalError(error.status === 401 ? "provider_auth" : "provider_billing");
    }
    if (error instanceof MagicHourHttpError && (error.status === 404 || error.status === 400 || error.status === 422)) {
      await failScene(reelId, key, error.status === 404 ? "provider_error" : "provider_rejected", error.body);
      throw new FatalError("provider_rejected");
    }
    throw error;
  }
}

export async function saveStill(reelId: string, key: SceneKey, url: string): Promise<{ ok: boolean }> {
  "use step";
  const bytes = await loadResultBytes(reelId, key, url, "image");
  if (!bytes) return { ok: false };
  const path = `results/${reelId}/${key}.jpg`;
  await reelObjectStore().put(path, bytes, "image/jpeg");
  await db
    .update(reelScenes)
    .set({ status: "still_ready", stillPath: path, errorCode: null, errorDetail: null })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
  return { ok: true };
}

export async function saveVideo(reelId: string, key: SceneKey, url: string): Promise<{ ok: boolean }> {
  "use step";
  const bytes = await loadResultBytes(reelId, key, url, "video");
  if (!bytes) return { ok: false };
  const path = `results/${reelId}/${key}.mp4`;
  await reelObjectStore().put(path, bytes, "video/mp4");
  await db
    .update(reelScenes)
    .set({ status: "complete", videoPath: path, errorCode: null, errorDetail: null })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
  return { ok: true };
}

async function loadResultBytes(
  reelId: string,
  key: SceneKey,
  url: string,
  kind: "image" | "video",
): Promise<Buffer | null> {
  const hosts = readConfig(process.env).downloadHosts;
  const first = await readDownload(url, hosts);
  if (first) return first;

  const scene = await loadScene(reelId, key);
  const projectId = kind === "image" ? scene?.imageProjectId : scene?.videoProjectId;
  if (!projectId) {
    await failScene(reelId, key, "download_failed");
    return null;
  }
  try {
    const client = magicClient();
    const context = { reelId, sceneKey: key, attempt: scene?.attempt };
    const project =
      kind === "image" ? await client.getImage(projectId, context) : await client.getVideo(projectId, context);
    const fresh = project.downloads[0]?.url;
    const second = fresh ? await readDownload(fresh, hosts) : null;
    if (second) return second;
  } catch {
    // The fresh project read failed. One refresh is the whole retry.
  }
  await failScene(reelId, key, "download_failed");
  return null;
}

async function readDownload(url: string, hosts: string[]): Promise<Buffer | null> {
  try {
    const bytes = await downloadAllowed(url, hosts);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function storeImageProject(
  reelId: string,
  key: SceneKey,
  created: { id: string; creditsCharged: number },
  attempt: number,
  forceNew: boolean,
): Promise<CreatedProject> {
  const requestedAt = await postgresNow();
  await db
    .update(reelScenes)
    .set({
      imageProjectId: created.id,
      imageCredits: created.creditsCharged,
      creditsCharged: created.creditsCharged,
      imageRequestedAt: requestedAt,
      status: "editing",
      attempt,
      errorCode: null,
      errorDetail: null,
      stillPath: null,
      ...(forceNew ? { stillAutoRetried: true } : {}),
    })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
  return { ok: true, projectId: created.id, requestedAt: requestedAt.toISOString() };
}

async function storeVideoProject(
  reelId: string,
  key: SceneKey,
  created: { id: string; creditsCharged: number },
  imageCredits: number,
  attempt: number,
  forceNew: boolean,
): Promise<CreatedProject> {
  const requestedAt = await postgresNow();
  await db
    .update(reelScenes)
    .set({
      videoProjectId: created.id,
      videoCredits: created.creditsCharged,
      creditsCharged: imageCredits + created.creditsCharged,
      videoRequestedAt: requestedAt,
      status: "animating",
      attempt,
      errorCode: null,
      errorDetail: null,
      videoPath: null,
      ...(forceNew ? { videoAutoRetried: true } : {}),
    })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
  return { ok: true, projectId: created.id, requestedAt: requestedAt.toISOString() };
}

function chargedId(error: MagicHourHttpError): { id: string; creditsCharged: number } | null {
  if (error.status !== 500 || error.body.length === 0) return null;
  try {
    const json = JSON.parse(error.body) as { id?: unknown; credits_charged?: unknown };
    if (typeof json.id !== "string" || json.id.length === 0) return null;
    return { id: json.id, creditsCharged: typeof json.credits_charged === "number" ? json.credits_charged : 0 };
  } catch {
    return null;
  }
}

async function settleHttpFailure(error: unknown, reelId: string, key: SceneKey): Promise<CreatedProject | null> {
  if (!(error instanceof MagicHourHttpError)) return null;
  if (error.status === 401 || error.status === 402) {
    const code = error.status === 401 ? "provider_auth" : "provider_billing";
    alert(error.status === 401 ? "magic_hour_auth" : "magic_hour_billing", {
      reel_id: reelId,
      scene_key: key,
      http_status: error.status,
      provider_code: error.providerCode ?? null,
    });
    await failReel(reelId, code);
    await failScene(reelId, key, code, error.body);
    return { ok: false };
  }
  if (error.status === 400 || error.status === 422) {
    console.error(
      JSON.stringify({
        level: "error",
        operation: "magic_hour_rejected",
        reel_id: reelId,
        scene_key: key,
        http_status: error.status,
        provider_code: error.providerCode ?? null,
        provider_body: error.body.slice(0, 500),
      }),
    );
    await failScene(reelId, key, "provider_rejected", error.body);
    return { ok: false };
  }
  if (error.status === 404) {
    await failScene(reelId, key, "provider_error", error.body);
    return { ok: false };
  }
  await failScene(reelId, key, "provider_error", error.body);
  return { ok: false };
}

async function failMissingScene(reelId: string): Promise<CreatedProject> {
  await failReel(reelId, "provider_error");
  return { ok: false };
}

async function failReel(reelId: string, errorCode: "provider_auth" | "provider_billing" | "provider_error"): Promise<void> {
  const now = await postgresNow();
  await db.update(reels).set({ status: "failed", errorCode, updatedAt: now }).where(eq(reels.id, reelId));
}

async function failScene(reelId: string, key: SceneKey, errorCode: string, detail?: string): Promise<void> {
  const scene = await loadScene(reelId, key);
  const keepError = scene?.errorCode != null && LOCKED_REEL_ERRORS.has(scene.errorCode);
  await db
    .update(reelScenes)
    .set({
      status: "failed",
      ...(keepError ? {} : { errorCode }),
      errorDetail: clip(detail ?? null),
    })
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)));
}

async function loadScene(reelId: string, key: SceneKey) {
  const [scene] = await db
    .select()
    .from(reelScenes)
    .where(and(eq(reelScenes.reelId, reelId), eq(reelScenes.sceneKey, key)))
    .limit(1);
  return scene ?? null;
}

export async function closeReel(reelId: string): Promise<void> {
  "use step";
  const scenes = await db.select().from(reelScenes).where(eq(reelScenes.reelId, reelId));
  for (const scene of scenes) {
    if (scene.status === "complete" || scene.status === "failed") continue;
    await db
      .update(reelScenes)
      .set({ status: "failed", errorCode: scene.errorCode ?? "provider_error" })
      .where(eq(reelScenes.id, scene.id));
  }
  const [reel] = await db
    .select({ status: reels.status, errorCode: reels.errorCode })
    .from(reels)
    .where(eq(reels.id, reelId))
    .limit(1);
  if (!reel || reel.status === "complete" || reel.status === "partial" || reel.status === "failed") return;
  const now = await postgresNow();
  await db
    .update(reels)
    .set({ status: "failed", errorCode: reel.errorCode ?? "provider_error", updatedAt: now })
    .where(eq(reels.id, reelId));
}

function isProviderLock(code: string | null | undefined): code is "provider_auth" | "provider_billing" {
  return code === "provider_auth" || code === "provider_billing";
}

async function loadReel(reelId: string) {
  const [reel] = await db
    .select({
      sourcePath: reels.sourcePath,
      errorCode: reels.errorCode,
      sourceKind: reels.sourceKind,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(reels)
    .leftJoin(vehicles, eq(reels.vehicleId, vehicles.id))
    .where(eq(reels.id, reelId))
    .limit(1);
  return reel ?? null;
}

function reelPromptIdentity(reel: {
  sourceKind: string;
  year: number | null;
  make: string | null;
  model: string | null;
}): string | null {
  if (reel.sourceKind !== "catalog") return identityLine({ kind: "upload" });
  if (reel.year == null || reel.make == null || reel.model == null) return null;
  if (reel.make.trim() === "" || reel.model.trim() === "") return null;
  return identityLine({ kind: "catalog", year: reel.year, make: reel.make, model: reel.model });
}

async function postgresNow(): Promise<Date> {
  const rows = await db.execute<{ now: Date | string }>(sql`select now() as now`);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length > 0) return new Date(value);
  throw new Error("Postgres now() returned nothing");
}

function isSourcePath(path: string): boolean {
  if (path.includes("..")) return false;
  if (path.startsWith("originals/")) return true;
  const match = /^catalog\/([^/]+)\/front_three_quarter\.jpg$/.exec(path);
  const vehicleId = match?.[1];
  return vehicleId != null && isUuid(vehicleId);
}

function clip(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 500);
}

function magicClient() {
  const config = readConfig(process.env);
  return createMagicHourClient({
    apiKey: config.magicHourApiKey,
    imageModel: config.imageModel,
    videoModel: config.videoModel,
    downloadHosts: config.downloadHosts,
  });
}
