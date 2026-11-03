import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { handleMagicHourRequest, type WebhookDeps } from "@/app/api/webhooks/magic-hour/route";
import { parseMagicHourEvent, verifyMagicHourSignature } from "@/lib/magic-hour/webhook";

const secret = "test-secret";
const timestamp = "1729314984";
const rawBody = '{"type":"image.completed","payload":{"id":"proj_1","status":"complete"}}';
const signature = "d24c6e56f23acb272ab86852f7aef660bfe378417155a00a6fd3e2bf24608ef4";
const nowMs = 1729314984 * 1000;

test("the known Magic Hour vector verifies at the signature timestamp", () => {
  expect(
    verifyMagicHourSignature({ secret, signature, timestamp, rawBody, nowMs }),
  ).toBe(true);
});

test("a space in the body breaks the signature", () => {
  expect(
    verifyMagicHourSignature({
      secret,
      signature,
      timestamp,
      rawBody: rawBody.replace("{", "{ "),
      nowMs,
    }),
  ).toBe(false);
});

test("an API key is not a valid signature", () => {
  expect(
    verifyMagicHourSignature({
      secret,
      signature: "mh_live_test_key",
      timestamp,
      rawBody,
      nowMs,
    }),
  ).toBe(false);
});

test("a timestamp 301 seconds old is rejected", () => {
  expect(
    verifyMagicHourSignature({
      secret,
      signature,
      timestamp,
      rawBody,
      nowMs: (1729314984 + 301) * 1000,
    }),
  ).toBe(false);
});

test("a signature that is not 64 hex characters is rejected", () => {
  expect(
    verifyMagicHourSignature({ secret, signature: "abcd", timestamp, rawBody, nowMs }),
  ).toBe(false);
  expect(
    verifyMagicHourSignature({ secret, signature: "g".repeat(64), timestamp, rawBody, nowMs }),
  ).toBe(false);
  expect(
    verifyMagicHourSignature({ secret, signature: "a".repeat(63), timestamp, rawBody, nowMs }),
  ).toBe(false);
});

test("a missing signature or timestamp header is rejected", () => {
  expect(
    verifyMagicHourSignature({ secret, signature: null, timestamp, rawBody, nowMs }),
  ).toBe(false);
  expect(
    verifyMagicHourSignature({ secret, signature, timestamp: null, rawBody, nowMs }),
  ).toBe(false);
});

test("parseMagicHourEvent returns null for an ignored event type", () => {
  expect(parseMagicHourEvent('{"type":"audio.completed","payload":{}}')).toBeNull();
});

function sign(body: string, stamp = timestamp, key = secret): string {
  return createHmac("sha256", key).update(`${stamp}.${body}`).digest("hex");
}

function request(body: string, headers: Record<string, string> = { signature: sign(body), timestamp }): Request {
  const head = new Headers();
  if (headers.signature) head.set("magic-hour-event-signature", headers.signature);
  if (headers.timestamp) head.set("magic-hour-event-timestamp", headers.timestamp);
  return new Request("http://localhost/api/webhooks/magic-hour", { method: "POST", body, headers: head });
}

function harness(overrides: Partial<WebhookDeps> = {}): { deps: WebhookDeps; downloadUrls: string[]; resumed: string[]; marks: unknown[] } {
  const downloadUrls: string[] = [];
  const resumed: string[] = [];
  const marks: unknown[] = [];
  const deps: WebhookDeps = {
    nowMs: () => nowMs,
    secret: () => secret,
    insertEvent: async () => "inserted",
    loadScene: async () => ({ id: "scene-1", reelId: "reel-1", sceneKey: "kickflip", status: "editing" }),
    markScene: async (_scene, patch) => {
      marks.push(patch);
    },
    downloadResult: async (_scene, url) => {
      downloadUrls.push(url);
      return "results/reel-1/kickflip.jpg";
    },
    resume: async (projectId, status) => {
      resumed.push(`${projectId}:${status}`);
    },
    ...overrides,
  };
  return { deps, downloadUrls, resumed, marks };
}

test("a body over 1_000_000 bytes is rejected before the signature is trusted", async () => {
  const { deps, downloadUrls } = harness();
  let inserted = false;
  deps.insertEvent = async () => {
    inserted = true;
    return "inserted";
  };
  const response = await handleMagicHourRequest(request(`${"a".repeat(1_000_001)}`), deps);
  expect(response.status).toBe(413);
  expect(inserted).toBe(false);
  expect(downloadUrls).toEqual([]);
});

test("a missing webhook secret is 401 and the body does not echo it", async () => {
  const { deps } = harness({ secret: () => undefined });
  const response = await handleMagicHourRequest(request(rawBody), deps);
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("");
});

test("a bad signature is 401 with an empty body and does not insert", async () => {
  const { deps } = harness();
  let inserted = false;
  deps.insertEvent = async () => {
    inserted = true;
    return "inserted";
  };
  const response = await handleMagicHourRequest(request(rawBody, { signature: "mh_live_test_key", timestamp }), deps);
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("");
  expect(inserted).toBe(false);
});

test("a verified body that is not a handled event inserts nothing", async () => {
  const { deps } = harness();
  let inserted = false;
  deps.insertEvent = async () => {
    inserted = true;
    return "inserted";
  };
  const ignored = '{"type":"audio.completed","payload":{}}';
  const broken = "{";
  expect((await handleMagicHourRequest(request(ignored), deps)).status).toBe(200);
  expect((await handleMagicHourRequest(request(broken), deps)).status).toBe(200);
  expect(inserted).toBe(false);
});

test("a new completion downloads once, stores our object, and resumes the hook", async () => {
  const body = JSON.stringify({
    type: "image.completed",
    payload: {
      id: "proj_1",
      status: "complete",
      downloads: [{ url: "https://videos.magichour.ai/id/output.jpg" }],
    },
  });
  const { deps, downloadUrls, resumed, marks } = harness();
  const response = await handleMagicHourRequest(request(body), deps);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("videos.magichour.ai");
  expect(downloadUrls).toEqual(["https://videos.magichour.ai/id/output.jpg"]);
  expect(marks).toEqual([
    { status: "still_ready", stillPath: "results/reel-1/kickflip.jpg", errorCode: null, errorDetail: null },
  ]);
  expect(resumed).toEqual(["proj_1:complete"]);
});

test("a duplicate completion does not download again", async () => {
  const body = JSON.stringify({
    type: "video.completed",
    payload: { id: "vid_1", status: "complete", downloads: [{ url: "https://videos.magichour.ai/id/output.mp4" }] },
  });
  const { deps, downloadUrls, resumed } = harness({ insertEvent: async () => "duplicate" });
  const response = await handleMagicHourRequest(request(body), deps);
  expect(response.status).toBe(200);
  expect(downloadUrls).toEqual([]);
  expect(resumed).toEqual(["vid_1:complete"]);
  expect(await response.text()).not.toContain("videos.magichour.ai");
});

test("a resume failure still returns 200", async () => {
  const { deps } = harness({
    resume: async () => {
      throw new Error("hook missing");
    },
  });
  const response = await handleMagicHourRequest(request(rawBody), deps);
  expect(response.status).toBe(200);
});

test("image.started moves a pending scene to editing and leaves later statuses alone", async () => {
  const body = JSON.stringify({ type: "image.started", payload: { id: "proj_1", status: "rendering" } });
  const pending = harness({
    loadScene: async () => ({ id: "scene-1", reelId: "reel-1", sceneKey: "kickflip", status: "pending" }),
  });
  await handleMagicHourRequest(request(body), pending.deps);
  expect(pending.marks).toEqual([{ status: "editing" }]);
  expect(pending.downloadUrls).toEqual([]);

  const editing = harness();
  await handleMagicHourRequest(request(body), editing.deps);
  expect(editing.marks).toEqual([]);
});

test("errored events store the error payload and leave the scene status for the workflow", async () => {
  const body = JSON.stringify({
    type: "image.errored",
    payload: { id: "proj_1", status: "error", error: { code: "nsfw", message: "blocked" } },
  });
  const { deps, marks, downloadUrls } = harness();
  const response = await handleMagicHourRequest(request(body), deps);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("blocked");
  expect(downloadUrls).toEqual([]);
  expect(marks).toEqual([{ errorDetail: JSON.stringify({ code: "nsfw", message: "blocked" }) }]);
});

test("video.started sets animating and video.completed stores an mp4", async () => {
  const started = JSON.stringify({ type: "video.started", payload: { id: "vid_1", status: "rendering" } });
  const starting = harness({
    loadScene: async () => ({ id: "scene-1", reelId: "reel-1", sceneKey: "flyover", status: "still_ready" }),
    downloadResult: async () => "results/reel-1/flyover.mp4",
  });
  await handleMagicHourRequest(request(started), starting.deps);
  expect(starting.marks).toEqual([{ status: "animating" }]);

  const done = JSON.stringify({
    type: "video.completed",
    payload: { id: "vid_1", status: "complete", downloads: [{ url: "https://videos.magichour.ai/id/output.mp4" }] },
  });
  const saved: string[] = [];
  const finishing = harness({
    loadScene: async () => ({ id: "scene-1", reelId: "reel-1", sceneKey: "flyover", status: "animating" }),
    downloadResult: async (_scene, url) => {
      saved.push(url);
      return "results/reel-1/flyover.mp4";
    },
  });
  await handleMagicHourRequest(request(done), finishing.deps);
  expect(saved).toEqual(["https://videos.magichour.ai/id/output.mp4"]);
  expect(finishing.marks).toEqual([
    { status: "complete", videoPath: "results/reel-1/flyover.mp4", errorCode: null, errorDetail: null },
  ]);
});
