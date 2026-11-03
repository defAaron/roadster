import { expect, test } from "vitest";
import { assertDownloadUrl, downloadAllowed } from "@/lib/magic-hour/download";

const hosts = ["videos.magichour.ai"];

test("assertDownloadUrl accepts an exact https host and rejects tricks", () => {
  expect(assertDownloadUrl("https://videos.magichour.ai/id/output.mp4", hosts).hostname).toBe("videos.magichour.ai");
  expect(() => assertDownloadUrl("http://videos.magichour.ai/a.mp4", hosts)).toThrow();
  expect(() => assertDownloadUrl("https://evil.example/a.mp4", hosts)).toThrow();
  expect(() => assertDownloadUrl("https://videos.magichour.ai.evil.example/a.mp4", hosts)).toThrow();
});

test("downloadAllowed fetches only after the host check and returns the bytes", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response(Uint8Array.from([1, 2, 3]), { status: 200 });
  };
  const bytes = await downloadAllowed("https://videos.magichour.ai/id/output.jpg", hosts, fetchImpl);
  expect(called).toBe(true);
  expect(Array.from(bytes)).toEqual([1, 2, 3]);
});

test("downloadAllowed does not fetch a rejected host and returns an empty body to the caller", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("should not fetch");
  };
  await expect(downloadAllowed("https://evil.example/a.jpg", hosts, fetchImpl)).rejects.toThrow();

  const empty = await downloadAllowed(
    "https://videos.magichour.ai/id/output.jpg",
    hosts,
    async () => new Response(new Uint8Array(), { status: 200 }),
  );
  expect(empty.length).toBe(0);
});
