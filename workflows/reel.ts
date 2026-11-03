import { createHook, sleep } from "workflow";
import type { SceneKey } from "@/lib/types";
import {
  alertReelFailureRate,
  closeReel,
  createImageIfNeeded,
  createVideoIfNeeded,
  finishReel,
  getProject,
  markReel,
  markScene,
  projectAgeSec,
  readTerminalEvent,
  reelProviderLock,
  saveStill,
  saveVideo,
  sceneSnapshot,
} from "./steps";

const TERMINAL_PROVIDER = new Set(["complete", "error", "canceled"]);

type AttemptResult = "ready" | "retry" | "stop";
type WaitResult = { kind: "event"; status: string } | { kind: "timeout" };

export async function reelWorkflow(reelId: string): Promise<void> {
  "use workflow";
  try {
    await markReel(reelId, "editing");
    const stills = await Promise.all([produceStill(reelId, "kickflip"), produceStill(reelId, "flyover")]);
    const lock = await reelProviderLock(reelId);
    if (stills.some((status) => status === "ready") && !lock) {
      await markReel(reelId, "animating");
      await Promise.all([produceVideo(reelId, "kickflip"), produceVideo(reelId, "flyover")]);
    }
    await finishReel(reelId);
    await alertReelFailureRate();
  } catch (error) {
    // A thrown step would otherwise leave the reel in editing and hold the active cap.
    await closeReel(reelId);
    throw error;
  }
}

async function produceStill(reelId: string, key: SceneKey): Promise<"ready" | "failed"> {
  try {
    const first = await runImageAttempt(reelId, key, false);
    if (first === "ready") return "ready";
    if (first === "retry") {
      const second = await runImageAttempt(reelId, key, true);
      if (second === "ready") return "ready";
    }
    return "failed";
  } catch {
    try {
      await markScene(reelId, key, { status: "failed", errorCode: "provider_error" });
    } catch {
      // Returning failed keeps Promise.all from rejecting the sibling scene.
    }
    return "failed";
  }
}

async function produceVideo(reelId: string, key: SceneKey): Promise<"ready" | "failed"> {
  try {
    const progress = await sceneSnapshot(reelId, key);
    if (progress.status !== "still_ready") {
      return progress.status === "complete" || progress.hasVideo ? "ready" : "failed";
    }
    const first = await runVideoAttempt(reelId, key, false);
    if (first === "ready") return "ready";
    if (first === "retry") {
      const second = await runVideoAttempt(reelId, key, true);
      if (second === "ready") return "ready";
    }
    return "failed";
  } catch {
    try {
      await markScene(reelId, key, { status: "failed", errorCode: "provider_error" });
    } catch {
      // Returning failed keeps Promise.all from rejecting the sibling scene.
    }
    return "failed";
  }
}

async function runImageAttempt(reelId: string, key: SceneKey, forceNew: boolean): Promise<AttemptResult> {
  const created = await createImageIfNeeded(reelId, key, { forceNew });
  if (!created.ok) return "stop";
  const project = await waitForProject(created.projectId, created.requestedAt);
  if (await stillAlreadySaved(reelId, key, project)) return "ready";
  if (project.kind === "timeout") {
    await markScene(reelId, key, { status: "failed", errorCode: "timeout" });
    return "stop";
  }

  let status = project.status;
  let downloads: { url: string }[] = [];
  if (status === "complete") {
    const snapshot = await getProject(reelId, key, created.projectId, "image");
    if (await stillAlreadySaved(reelId, key, project)) return "ready";
    status = snapshot.status;
    downloads = snapshot.downloads;
    if (status === "complete" && downloads.length > 0) {
      const saved = await saveStill(reelId, key, downloads[0].url);
      if (!saved.ok) return "stop";
      return "ready";
    }
  }
  return settleAttempt(reelId, key, forceNew, status, downloads);
}

async function runVideoAttempt(reelId: string, key: SceneKey, forceNew: boolean): Promise<AttemptResult> {
  const created = await createVideoIfNeeded(reelId, key, { forceNew });
  if (!created.ok) return "stop";
  const project = await waitForProject(created.projectId, created.requestedAt);
  if (await videoAlreadySaved(reelId, key, project)) return "ready";
  if (project.kind === "timeout") {
    await markScene(reelId, key, { status: "failed", errorCode: "timeout" });
    return "stop";
  }

  let status = project.status;
  let downloads: { url: string }[] = [];
  if (status === "complete") {
    const snapshot = await getProject(reelId, key, created.projectId, "video");
    if (await videoAlreadySaved(reelId, key, project)) return "ready";
    status = snapshot.status;
    downloads = snapshot.downloads;
    if (status === "complete" && downloads.length > 0) {
      const saved = await saveVideo(reelId, key, downloads[0].url);
      if (!saved.ok) return "stop";
      return "ready";
    }
  }
  return settleAttempt(reelId, key, forceNew, status, downloads);
}

async function stillAlreadySaved(reelId: string, key: SceneKey, project: WaitResult): Promise<boolean> {
  if (project.kind === "timeout") {
    const progress = await sceneSnapshot(reelId, key);
    return progress.status === "still_ready" || progress.status === "complete" || progress.hasStill;
  }
  const progress = await sceneSnapshot(reelId, key);
  return progress.status === "still_ready" || progress.status === "complete" || progress.hasStill;
}

async function videoAlreadySaved(reelId: string, key: SceneKey, project: WaitResult): Promise<boolean> {
  if (project.kind === "timeout") {
    const progress = await sceneSnapshot(reelId, key);
    return progress.status === "complete" || progress.hasVideo;
  }
  const progress = await sceneSnapshot(reelId, key);
  return progress.status === "complete" || progress.hasVideo;
}

async function settleAttempt(
  reelId: string,
  key: SceneKey,
  forceNew: boolean,
  status: string,
  downloads: { url: string }[],
): Promise<AttemptResult> {
  if (status === "canceled" || status === "rejected") {
    await markScene(reelId, key, { status: "failed", errorCode: "provider_error" });
    return "stop";
  }
  if (!forceNew && (status === "error" || downloads.length === 0)) {
    return "retry";
  }
  await markScene(reelId, key, {
    status: "failed",
    errorCode: downloads.length === 0 ? "download_failed" : "provider_error",
  });
  return "stop";
}

export async function waitForProject(projectId: string, requestedAtIso: string): Promise<WaitResult> {
  "use workflow";
  const hook = createHook<{ status: string }>({ token: `mh:${projectId}` });
  for (;;) {
    const existing = await readTerminalEvent(projectId);
    if (existing?.status === "timeout") return { kind: "timeout" };
    if (existing && TERMINAL_PROVIDER.has(existing.status)) return { kind: "event", status: existing.status };
    const raced = await Promise.race([
      hook.then((event) => ({ kind: "hook" as const, status: event.status })),
      sleep("30s").then(() => ({ kind: "tick" as const })),
    ]);
    if (raced.kind === "hook") {
      if (raced.status === "timeout") return { kind: "timeout" };
      if (TERMINAL_PROVIDER.has(raced.status)) return { kind: "event", status: raced.status };
    }
    const ageSec = await projectAgeSec(projectId, requestedAtIso);
    if (ageSec > 15 * 60) return { kind: "timeout" };
  }
}
