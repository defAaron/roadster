import { readFile } from "node:fs/promises";
import path from "node:path";
import { saveFakeReelProgress } from "@/lib/db/reels";
import { deriveReelStatus } from "@/lib/reel-status";
import type { SceneStatus } from "@/lib/types";
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

export async function startReel(reelId: string): Promise<void> {
  const driver = process.env.REEL_DRIVER?.trim() || "fake";
  if (driver === "live") {
    await startLive(reelId);
    return;
  }
  scheduleFakeReel(reelId);
}
