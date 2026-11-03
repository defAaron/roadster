export type SceneKey = "kickflip" | "flyover";
export type ReelStatus = "queued" | "editing" | "animating" | "complete" | "partial" | "failed";
export type SceneStatus = "pending" | "editing" | "still_ready" | "animating" | "complete" | "failed";
export type SceneView = {
  key: SceneKey;
  status: SceneStatus;
  stillUrl: string | null;
  videoUrl: string | null;
  errorCode: string | null;
};
export type ReelView = { id: string; status: ReelStatus; errorCode: string | null; scenes: SceneView[] };
export type StageDot = "waiting" | "active" | "done" | "failed";
