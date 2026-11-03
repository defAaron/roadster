import { sleep } from "workflow";
import type { SceneKey } from "@/lib/types";
import {
  closeReel,
  createImageIfNeeded,
  createVideoIfNeeded,
  finishStatus,
  getProject,
  markReel,
  markScene,
  saveStill,
  saveVideo,
  type ProjectSnapshot,
} from "./steps";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

type AttemptResult = "ready" | "retry" | "stop";

export async function reelWorkflow(reelId: string): Promise<void> {
  "use workflow";
  try {
    await markReel(reelId, "editing");
    const still = await produceStill(reelId, "kickflip");
    if (still === "ready") {
      await markReel(reelId, "animating");
      await produceVideo(reelId, "kickflip");
    }
    await markReel(reelId, await finishStatus(reelId));
  } catch (error) {
    // A thrown step would otherwise leave the reel in editing and hold the active cap.
    await closeReel(reelId);
    throw error;
  }
}

async function produceStill(reelId: string, key: SceneKey) {
  const first = await runImageAttempt(reelId, key, false);
  if (first === "ready") return "ready" as const;
  if (first === "retry") {
    const second = await runImageAttempt(reelId, key, true);
    if (second === "ready") return "ready" as const;
  }
  return "failed" as const;
}

async function produceVideo(reelId: string, key: SceneKey) {
  const first = await runVideoAttempt(reelId, key, false);
  if (first === "ready") return "ready" as const;
  if (first === "retry") {
    const second = await runVideoAttempt(reelId, key, true);
    if (second === "ready") return "ready" as const;
  }
  return "failed" as const;
}

async function runImageAttempt(reelId: string, key: SceneKey, forceNew: boolean): Promise<AttemptResult> {
  const created = await createImageIfNeeded(reelId, key, { forceNew });
  if (!created.ok) return "stop";
  const project = await pollProject(reelId, key, created.projectId, "image", created.requestedAt);
  if (project.status === "complete" && project.downloads.length > 0) {
    const saved = await saveStill(reelId, key, project.downloads[0].url);
    if (!saved.ok) return "stop";
    return "ready";
  }
  if (project.status === "timeout") {
    await markScene(reelId, key, { status: "failed", errorCode: "timeout" });
    return "stop";
  }
  if (project.status === "canceled" || project.status === "rejected") {
    await markScene(reelId, key, { status: "failed", errorCode: "provider_error" });
    return "stop";
  }
  if (!forceNew && (project.status === "error" || project.downloads.length === 0)) {
    return "retry";
  }
  await markScene(reelId, key, {
    status: "failed",
    errorCode: project.downloads.length === 0 ? "download_failed" : "provider_error",
  });
  return "stop";
}

async function runVideoAttempt(reelId: string, key: SceneKey, forceNew: boolean): Promise<AttemptResult> {
  const created = await createVideoIfNeeded(reelId, key, { forceNew });
  if (!created.ok) return "stop";
  const project = await pollProject(reelId, key, created.projectId, "video", created.requestedAt);
  if (project.status === "complete" && project.downloads.length > 0) {
    const saved = await saveVideo(reelId, key, project.downloads[0].url);
    if (!saved.ok) return "stop";
    return "ready";
  }
  if (project.status === "timeout") {
    await markScene(reelId, key, { status: "failed", errorCode: "timeout" });
    return "stop";
  }
  if (project.status === "canceled" || project.status === "rejected") {
    await markScene(reelId, key, { status: "failed", errorCode: "provider_error" });
    return "stop";
  }
  if (!forceNew && (project.status === "error" || project.downloads.length === 0)) {
    return "retry";
  }
  await markScene(reelId, key, {
    status: "failed",
    errorCode: project.downloads.length === 0 ? "download_failed" : "provider_error",
  });
  return "stop";
}

async function pollProject(
  reelId: string,
  key: SceneKey,
  projectId: string,
  kind: "image" | "video",
  requestedAt: string,
): Promise<{ status: "complete" | "error" | "canceled" | "rejected" | "timeout"; downloads: { url: string }[] }> {
  for (;;) {
    const snapshot = await getProject(reelId, key, projectId, kind);
    if (isTerminal(snapshot.status)) {
      return { status: snapshot.status, downloads: snapshot.downloads };
    }
    if (Date.parse(snapshot.now) - Date.parse(requestedAt) >= FIFTEEN_MINUTES_MS) {
      return { status: "timeout", downloads: snapshot.downloads };
    }
    await sleep("15s");
  }
}

function isTerminal(status: ProjectSnapshot["status"]): status is "complete" | "error" | "canceled" | "rejected" {
  return status === "complete" || status === "error" || status === "canceled" || status === "rejected";
}
