import type { ReelView, SceneKey, SceneStatus } from "@/lib/types";

function row(key: SceneKey, status: SceneStatus, still: boolean, video: boolean): ReelView["scenes"][number] {
  return {
    key,
    status,
    stillUrl: still ? `/fixtures/${key}.svg` : null,
    videoUrl: video ? "/fixtures/sample.mp4" : null,
    errorCode: null,
  };
}

export function projectFakeReel(id: string, startedAtMs: number, nowMs: number): ReelView {
  const t = nowMs - startedAtMs;
  if (t < 2_000) {
    return { id, status: "queued", errorCode: null, scenes: [row("kickflip", "pending", false, false), row("flyover", "pending", false, false)] };
  }
  if (t < 8_000) {
    return { id, status: "editing", errorCode: null, scenes: [row("kickflip", "editing", false, false), row("flyover", "editing", false, false)] };
  }
  if (t < 14_000) {
    return { id, status: "editing", errorCode: null, scenes: [row("kickflip", "still_ready", true, false), row("flyover", "still_ready", true, false)] };
  }
  if (t < 20_000) {
    return { id, status: "animating", errorCode: null, scenes: [row("kickflip", "animating", true, false), row("flyover", "animating", true, false)] };
  }
  return { id, status: "complete", errorCode: null, scenes: [row("kickflip", "complete", true, true), row("flyover", "complete", true, true)] };
}
