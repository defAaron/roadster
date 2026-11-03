import { expect, test } from "vitest";
import { deriveReelStatus, stageDot } from "@/lib/reel-status";
import type { ReelView } from "@/lib/types";

const scene = (key: "kickflip" | "flyover", status: ReelView["scenes"][number]["status"], still: string | null = null, video: string | null = null) =>
  ({ key, status, stillUrl: still, videoUrl: video, errorCode: status === "failed" ? "provider_error" : null });

test("both scenes complete rolls up to complete", () => {
  expect(deriveReelStatus([{ status: "complete" }, { status: "complete" }])).toBe("complete");
});

test("one success and one failure is partial", () => {
  expect(deriveReelStatus([{ status: "complete" }, { status: "failed" }])).toBe("partial");
});

test("both failed is failed", () => {
  expect(deriveReelStatus([{ status: "failed" }, { status: "failed" }])).toBe("failed");
});

test("a still in flight keeps the reel in editing", () => {
  expect(deriveReelStatus([{ status: "editing" }, { status: "still_ready" }])).toBe("editing");
});

test("videos in flight are animating only after both stills are past editing", () => {
  expect(deriveReelStatus([{ status: "animating" }, { status: "still_ready" }])).toBe("animating");
});

test("a missing flyover scene is waiting, not failed", () => {
  const reel: ReelView = {
    id: "r",
    status: "editing",
    errorCode: null,
    scenes: [scene("kickflip", "editing")],
  };
  expect(stageDot(reel, 2)).toBe("waiting");
});

test("kickflip still is done once a still url exists", () => {
  const reel: ReelView = {
    id: "r",
    status: "editing",
    errorCode: null,
    scenes: [scene("kickflip", "still_ready", "/a.jpg"), scene("flyover", "editing")],
  };
  expect(stageDot(reel, 1)).toBe("done");
  expect(stageDot(reel, 2)).toBe("active");
});
