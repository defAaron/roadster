import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import type { MagicHourProject } from "@/lib/magic-hour/client";

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {},
  createHook: () => Promise.resolve({ status: "queued" }),
  sleep: () => Promise.resolve(),
}));

import { providerEventFromProject } from "@/workflows/steps";
import { waitLoopDecision } from "@/workflows/reel";

const secret = "mh_live_should_not_appear";
const ciphertext = "stored-ciphertext-value";

function project(
  status: MagicHourProject["status"],
  extras: Partial<MagicHourProject> = {},
): MagicHourProject & { apiKey: string; key_ciphertext: string; authorization: string } {
  return {
    id: extras.id ?? "proj_1",
    status,
    creditsCharged: extras.creditsCharged === undefined ? 4 : extras.creditsCharged,
    downloads: extras.downloads ?? [{ url: "https://videos.magichour.ai/still.jpg", expiresAt: "2026-11-06T00:00:00Z" }],
    error: extras.error === undefined ? null : extras.error,
    apiKey: secret,
    key_ciphertext: ciphertext,
    authorization: `Bearer ${secret}`,
  };
}

test("a non-terminal Magic Hour status produces no provider event", () => {
  for (const status of ["queued", "rendering", "draft"] as const) {
    expect(providerEventFromProject("image", project(status))).toBeNull();
    expect(providerEventFromProject("video", project(status))).toBeNull();
  }
});

test("complete, error, and canceled match the cron event type and payload for image and video", () => {
  const cases = [
    {
      kind: "image" as const,
      status: "complete" as const,
      creditsCharged: 4,
      downloads: [{ url: "https://videos.magichour.ai/still.jpg", expiresAt: "2026-11-06T00:00:00Z" }],
      error: null,
    },
    {
      kind: "image" as const,
      status: "error" as const,
      creditsCharged: null,
      downloads: [],
      error: { code: "render_failed", message: "still failed" },
    },
    {
      kind: "image" as const,
      status: "canceled" as const,
      creditsCharged: 1,
      downloads: [{ url: "https://videos.magichour.ai/partial.jpg", expiresAt: null }],
      error: null,
    },
    {
      kind: "video" as const,
      status: "complete" as const,
      creditsCharged: 9,
      downloads: [{ url: "https://videos.magichour.ai/clip.mp4", expiresAt: "2026-11-07T00:00:00Z" }],
      error: null,
    },
    {
      kind: "video" as const,
      status: "error" as const,
      creditsCharged: 2,
      downloads: [],
      error: { message: "motion failed" },
    },
    {
      kind: "video" as const,
      status: "canceled" as const,
      creditsCharged: null,
      downloads: [{ url: "https://videos.magichour.ai/clip.mp4", expiresAt: null }],
      error: { code: "canceled" },
    },
  ];

  for (const row of cases) {
    const eventType =
      row.status === "complete" ? `${row.kind}.completed` : row.status === "error" ? `${row.kind}.errored` : `${row.kind}.canceled`;
    const record = providerEventFromProject(
      row.kind,
      project(row.status, {
        id: `${row.kind}_${row.status}`,
        creditsCharged: row.creditsCharged,
        downloads: row.downloads,
        error: row.error,
      }),
    );
    expect(record).toEqual({
      projectId: `${row.kind}_${row.status}`,
      eventType,
      status: row.status,
      payload: {
        id: `${row.kind}_${row.status}`,
        status: row.status,
        credits_charged: row.creditsCharged,
        downloads: row.downloads.map((item) => ({ url: item.url, expires_at: item.expiresAt })),
        error: row.error,
      },
    });
    expect(Object.keys(record?.payload ?? {}).sort()).toEqual([
      "credits_charged",
      "downloads",
      "error",
      "id",
      "status",
    ]);
    for (const download of record?.payload.downloads ?? []) {
      expect(Object.keys(download).sort()).toEqual(["expires_at", "url"]);
    }
  }
});

test("a synced provider payload has no key material", () => {
  const record = providerEventFromProject("image", project("complete"));
  const encoded = JSON.stringify(record);
  expect(encoded).not.toContain(secret);
  expect(encoded).not.toContain(ciphertext);
  expect(encoded).not.toContain("apiKey");
  expect(encoded).not.toContain("key_ciphertext");
  expect(encoded).not.toContain("authorization");
  expect(encoded).not.toContain("Bearer");
});

test("a synced terminal status ends the wait before the fifteen minute timeout", () => {
  const pastCap = 15 * 60 + 1;
  expect(
    waitLoopDecision({ stored: null, synced: { status: "complete" }, hookStatus: null, ageSec: pastCap }),
  ).toEqual({ kind: "event", status: "complete" });
  expect(
    waitLoopDecision({ stored: null, synced: { status: "error" }, hookStatus: "timeout", ageSec: pastCap }),
  ).toEqual({ kind: "event", status: "error" });
  expect(
    waitLoopDecision({ stored: null, synced: { status: "canceled" }, hookStatus: null, ageSec: pastCap }),
  ).toEqual({ kind: "event", status: "canceled" });
  expect(waitLoopDecision({ stored: null, synced: null, hookStatus: null, ageSec: pastCap })).toEqual({ kind: "timeout" });
  expect(waitLoopDecision({ stored: null, synced: null, hookStatus: null, ageSec: 15 * 60 })).toEqual({ kind: "continue" });
  expect(
    waitLoopDecision({ stored: { status: "timeout" }, synced: { status: "complete" }, hookStatus: null, ageSec: 1 }),
  ).toEqual({ kind: "timeout" });
  expect(waitLoopDecision({ stored: null, synced: null, hookStatus: "timeout", ageSec: 1 })).toEqual({ kind: "timeout" });

  const source = readFileSync("workflows/reel.ts", "utf8");
  const decision = source.slice(source.indexOf("export function waitLoopDecision"), source.indexOf("export async function waitForProject"));
  expect(decision.indexOf("input.synced")).toBeGreaterThan(-1);
  expect(decision.indexOf("input.ageSec")).toBeGreaterThan(decision.indexOf("input.synced"));

  const wait = source.slice(source.indexOf("export async function waitForProject"));
  const readAt = wait.indexOf("readTerminalEvent(projectId)");
  const syncAt = wait.indexOf("syncProviderProject(projectId)");
  const sleepAt = wait.indexOf('sleep("30s")');
  const ageAt = wait.lastIndexOf("ageSec");
  expect(syncAt).toBeGreaterThan(readAt);
  expect(sleepAt).toBeGreaterThan(syncAt);
  expect(ageAt).toBeGreaterThan(sleepAt);
});
