import { expect, test } from "vitest";
import { retryDecision } from "@/lib/retry";
import type { SceneStatus } from "@/lib/types";

const cap = 5;

function decide(
  status: SceneStatus,
  extras: { userRetries?: number; hasFile?: boolean; errorCode?: string | null } = {},
) {
  return retryDecision({
    status,
    userRetries: extras.userRetries ?? 0,
    cap,
    hasFile: extras.hasFile ?? false,
    errorCode: extras.errorCode ?? null,
  });
}

test("in-flight scenes are rejected even when retries are already at the cap", () => {
  const statuses = ["pending", "editing", "still_ready", "animating"] as const;
  for (const status of statuses) {
    expect(decide(status, { userRetries: cap })).toEqual({ action: "reject-in-flight" });
  }
});

test("a failed provider error starts a new job", () => {
  expect(decide("failed", { errorCode: "provider_error" })).toEqual({ action: "new-job" });
});

test("a complete scene with a file starts a new job", () => {
  expect(decide("complete", { hasFile: true })).toEqual({ action: "new-job" });
});

test("a failed download with no file is a redownload", () => {
  expect(decide("failed", { errorCode: "download_failed", hasFile: false })).toEqual({ action: "redownload" });
});

test("retries at the cap are rejected when the scene is not in flight", () => {
  expect(decide("failed", { userRetries: cap, errorCode: "provider_error" })).toEqual({ action: "reject-cap" });
});
