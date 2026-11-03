import type { SceneStatus } from "@/lib/types";

const IN_FLIGHT: ReadonlySet<SceneStatus> = new Set(["pending", "editing", "still_ready", "animating"]);

export function retryDecision(input: {
  status: SceneStatus;
  userRetries: number;
  cap: number;
  hasFile: boolean;
  errorCode: string | null;
}): { action: "reject-in-flight" } | { action: "reject-cap" } | { action: "redownload" } | { action: "new-job" } {
  if (IN_FLIGHT.has(input.status)) return { action: "reject-in-flight" };
  if (input.userRetries >= input.cap) return { action: "reject-cap" };
  if (input.status === "failed" && input.errorCode === "download_failed" && !input.hasFile) {
    return { action: "redownload" };
  }
  return { action: "new-job" };
}
