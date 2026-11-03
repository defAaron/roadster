import { expect, test } from "vitest";
import { assertDownloadUrl } from "@/lib/magic-hour/download";

const hosts = ["videos.magichour.ai"];

test("assertDownloadUrl accepts an exact https host", () => {
  expect(assertDownloadUrl("https://videos.magichour.ai/id/output.mp4", hosts).hostname).toBe("videos.magichour.ai");
});

test("assertDownloadUrl rejects http, a foreign host, and a suffix trick", () => {
  expect(() => assertDownloadUrl("http://videos.magichour.ai/a.mp4", hosts)).toThrow();
  expect(() => assertDownloadUrl("https://evil.example/a.mp4", hosts)).toThrow();
  expect(() => assertDownloadUrl("https://videos.magichour.ai.evil.example/a.mp4", hosts)).toThrow();
});
