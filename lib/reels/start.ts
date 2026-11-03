import { readFile } from "node:fs/promises";
import path from "node:path";
import { saveFakeReelProgress, saveFakeSceneStep } from "@/lib/db/reels";
import { deriveReelStatus } from "@/lib/reel-status";
import type { SceneKey, SceneStatus } from "@/lib/types";
import { reelObjectStore } from "@/lib/reels/store";

const MARKS_MS = [0, 2_000, 8_000, 14_000, 20_000];

function fakeStep(elapsedMs: number): { sceneStatus: SceneStatus; still: boolean; video: boolean } {
  if (elapsedMs < 2_000) return { sceneStatus: "pending", still: false, video: false };
  if (elapsedMs < 8_000) return { sceneStatus: "editing", still: false, video: false };
  if (elapsedMs < 14_000) return { sceneStatus: "still_ready", still: true, video: false };
  if (elapsedMs < 20_000) return { sceneStatus: "animating", still: true, video: false };
  return { sceneStatus: "complete", still: true, video: true };
}

function fixturePath(name: string): string {
  return path.join(process.cwd(), "public", "fixtures", name);
}

async function advanceFakeReel(reelId: string, startedMs: number): Promise<void> {
  const step = fakeStep(Date.now() - startedMs);
  const store = reelObjectStore();
  const paths: Record<"kickflip" | "flyover", { stillPath?: string; videoPath?: string }> = {
    kickflip: {},
    flyover: {},
  };
  if (step.still) {
    for (const key of ["kickflip", "flyover"] as const) {
      const stillPath = `results/${reelId}/${key}.svg`;
      await store.put(stillPath, await readFile(fixturePath(`${key}.svg`)), "image/svg+xml");
      paths[key].stillPath = stillPath;
    }
  }
  if (step.video) {
    const bytes = await readFile(fixturePath("sample.mp4"));
    for (const key of ["kickflip", "flyover"] as const) {
      const videoPath = `results/${reelId}/${key}.mp4`;
      await store.put(videoPath, bytes, "video/mp4");
      paths[key].videoPath = videoPath;
    }
  }
  const reelStatus = deriveReelStatus([{ status: step.sceneStatus }, { status: step.sceneStatus }]);
  await saveFakeReelProgress(reelId, step.sceneStatus, reelStatus, paths);
}

function scheduleFakeReel(reelId: string): void {
  const startedMs = Date.now();
  for (const mark of MARKS_MS) {
    const timer = setTimeout(() => {
      void advanceFakeReel(reelId, startedMs).catch(() => {
        console.error(JSON.stringify({ level: "error", operation: "fake_reel", reel_id: reelId }));
      });
    }, mark);
    timer.unref();
  }
}

async function startLive(reelId: string): Promise<void> {
  // Literal dynamic imports stay off the fake-driver load path and stay visible to workflow discovery.
  const { start } = await import("workflow/api");
  const { reelWorkflow } = await import("@/workflows/reel");
  await start(reelWorkflow, [reelId]);
}

const fakeSceneGeneration = new Map<string, number>();

function retryFakeStep(elapsedMs: number, phase: "image" | "video"): { status: SceneStatus; still: boolean; video: boolean } {
  if (phase === "video") {
    if (elapsedMs < 6_000) return { status: "still_ready", still: false, video: false };
    if (elapsedMs < 11_000) return { status: "animating", still: false, video: false };
    return { status: "complete", still: false, video: true };
  }
  if (elapsedMs < 6_000) return { status: "editing", still: false, video: false };
  if (elapsedMs < 12_000) return { status: "still_ready", still: true, video: false };
  if (elapsedMs < 17_000) return { status: "animating", still: true, video: false };
  return { status: "complete", still: true, video: true };
}

async function advanceFakeScene(
  reelId: string,
  sceneKey: SceneKey,
  phase: "image" | "video",
  startedMs: number,
  tokenKey: string,
  token: number,
  expected: { userRetries: number; attempt: number },
): Promise<void> {
  if (fakeSceneGeneration.get(tokenKey) !== token) return;
  const step = retryFakeStep(Date.now() - startedMs, phase);
  const store = reelObjectStore();
  const files: { stillPath?: string; videoPath?: string } = {};
  if (step.still) {
    const stillPath = `results/${reelId}/${sceneKey}.svg`;
    await store.put(stillPath, await readFile(fixturePath(`${sceneKey}.svg`)), "image/svg+xml");
    files.stillPath = stillPath;
  }
  if (step.video) {
    const videoPath = `results/${reelId}/${sceneKey}.mp4`;
    await store.put(videoPath, await readFile(fixturePath("sample.mp4")), "video/mp4");
    files.videoPath = videoPath;
  }
  if (fakeSceneGeneration.get(tokenKey) !== token) return;
  await saveFakeSceneStep(reelId, sceneKey, step.status, files, expected);
}

export function scheduleFakeScene(
  reelId: string,
  sceneKey: SceneKey,
  phase: "image" | "video",
  expected: { userRetries: number; attempt: number },
): void {
  const tokenKey = `${reelId}:${sceneKey}`;
  const token = (fakeSceneGeneration.get(tokenKey) ?? 0) + 1;
  fakeSceneGeneration.set(tokenKey, token);
  const startedMs = Date.now();
  const marks = phase === "video" ? [0, 6_000, 12_000] : [0, 6_000, 12_000, 18_000];
  for (const mark of marks) {
    const timer = setTimeout(() => {
      void advanceFakeScene(reelId, sceneKey, phase, startedMs, tokenKey, token, expected).catch(() => {
        console.error(JSON.stringify({ level: "error", operation: "fake_scene", reel_id: reelId, scene_key: sceneKey }));
      });
    }, mark);
    timer.unref();
  }
}

export async function startReel(reelId: string): Promise<void> {
  const driver = process.env.REEL_DRIVER?.trim() || "fake";
  if (driver === "live") {
    await startLive(reelId);
    return;
  }
  scheduleFakeReel(reelId);
}
