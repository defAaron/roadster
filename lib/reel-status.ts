import type { ReelView, SceneKey, SceneStatus, SceneView } from "@/lib/types";

export function deriveReelStatus(scenes: { status: SceneStatus }[]): ReelView["status"] {
  const statuses = scenes.map((s) => s.status);
  const terminal = (s: SceneStatus) => s === "complete" || s === "failed";
  if (statuses.length > 0 && statuses.every((s) => s === "complete")) return "complete";
  if (statuses.length > 0 && statuses.every((s) => s === "failed")) return "failed";
  if (statuses.length > 0 && statuses.every(terminal)) return "partial";
  const stillOpen = statuses.some((s) => s === "pending" || s === "editing");
  if (!stillOpen && statuses.some((s) => s === "animating" || s === "still_ready")) return "animating";
  if (statuses.some((s) => s !== "pending")) return "editing";
  return "queued";
}

function scene(reel: ReelView, key: SceneKey): SceneView {
  return (
    reel.scenes.find((s) => s.key === key) ?? {
      key,
      status: "pending",
      stillUrl: null,
      videoUrl: null,
      errorCode: null,
    }
  );
}

export function stageDot(reel: ReelView, stage: 0 | 1 | 2 | 3 | 4): "waiting" | "active" | "done" | "failed" {
  if (stage === 0) {
    if (reel.status === "queued") return "active";
    return "done";
  }
  const key: SceneKey = stage === 1 || stage === 3 ? "kickflip" : "flyover";
  const row = scene(reel, key);
  const stillPhase = stage === 1 || stage === 2;
  if (stillPhase) {
    if (row.stillUrl || row.status === "still_ready" || row.status === "animating" || row.status === "complete") return "done";
    if (row.status === "failed" && !row.stillUrl) return "failed";
    if (row.status === "editing") return "active";
    return "waiting";
  }
  if (row.videoUrl || row.status === "complete") return "done";
  if (row.status === "failed" && row.stillUrl) return "failed";
  if (row.status === "animating") return "active";
  return "waiting";
}
