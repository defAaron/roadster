import { expect, test } from "vitest";
import { projectFakeReel } from "@/lib/fake-reel";

const id = "00000000-0000-4000-8000-000000000001";

test("the fake reel walks prepare, stills, videos, then both downloads", () => {
  const start = 1_000_000;
  const preparing = projectFakeReel(id, start, start + 500);
  expect(preparing.status).toBe("queued");
  expect(preparing.scenes.every((s) => s.stillUrl === null)).toBe(true);

  const editing = projectFakeReel(id, start, start + 3_000);
  expect(editing.status).toBe("editing");
  expect(editing.scenes.map((s) => s.status)).toEqual(["editing", "editing"]);

  const stills = projectFakeReel(id, start, start + 9_000);
  expect(stills.scenes.every((s) => s.stillUrl)).toBe(true);
  expect(stills.scenes.every((s) => s.videoUrl === null)).toBe(true);

  const filming = projectFakeReel(id, start, start + 15_000);
  expect(filming.status).toBe("animating");

  const done = projectFakeReel(id, start, start + 21_000);
  expect(done.status).toBe("complete");
  expect(done.scenes.map((s) => s.videoUrl)).toEqual([
    "/fixtures/sample.mp4",
    "/fixtures/sample.mp4",
  ]);
});
