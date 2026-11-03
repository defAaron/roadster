import { expect, test, vi } from "vitest";
import { MagicHourHttpError, createMagicHourClient } from "@/lib/magic-hour/client";
import { alert } from "@/lib/log";

type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: string | Uint8Array | null;
};

function recordedFetch(handler: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: string | Uint8Array | null = null;
    if (typeof init?.body === "string") body = init.body;
    else if (init?.body instanceof Uint8Array) body = init.body;
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(fetchImpl: typeof fetch, overrides: { imageModel?: string; videoModel?: string; log?: (line: Record<string, unknown>) => void } = {}) {
  return createMagicHourClient({
    apiKey: "test-key",
    fetchImpl,
    imageModel: overrides.imageModel ?? "seedream-v4.5",
    videoModel: overrides.videoModel ?? "kling-3.0",
    downloadHosts: ["videos.magichour.ai"],
    log: overrides.log,
  });
}

test("uploadImage posts upload-urls, puts the bytes, and returns file_path", async () => {
  const jpeg = Buffer.from([1, 2, 3, 4]);
  const { fetchImpl, calls } = recordedFetch((call) => {
    if (call.url === "https://api.magichour.ai/v1/files/upload-urls") {
      expect(call.method).toBe("POST");
      expect(call.headers.get("authorization")).toBe("Bearer test-key");
      expect(JSON.parse(call.body as string)).toEqual({ items: [{ type: "image", extension: "jpg" }] });
      return jsonResponse({ items: [{ upload_url: "https://uploads.example/put", file_path: "api-assets/source.jpg" }] });
    }
    expect(call.url).toBe("https://uploads.example/put");
    expect(call.method).toBe("PUT");
    expect(Buffer.from(call.body as Uint8Array)).toEqual(jpeg);
    return new Response(null, { status: 200 });
  });

  const filePath = await client(fetchImpl).uploadImage(jpeg);
  expect(filePath).toBe("api-assets/source.jpg");
  expect(calls).toHaveLength(2);
});

test("createImage posts the pinned editor body", async () => {
  const { fetchImpl, calls } = recordedFetch((call) => {
    expect(call.url).toBe("https://api.magichour.ai/v1/ai-image-editor");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(call.body as string)).toMatchObject({
      model: "seedream-v4.5",
      image_count: 1,
      aspect_ratio: "16:9",
      resolution: "2k",
      style: { prompt: "still prompt" },
      assets: { image_file_paths: ["api-assets/source.jpg"] },
    });
    return jsonResponse({ id: "img_1", credits_charged: 4 });
  });

  const created = await client(fetchImpl).createImage({
    name: "reel_1_kickflip_still",
    prompt: "still prompt",
    filePath: "api-assets/source.jpg",
  });
  expect(created).toEqual({ id: "img_1", creditsCharged: 4 });
  expect(calls).toHaveLength(1);
});

test("createVideo omits end_image_file_path when the end path is omitted", async () => {
  const { fetchImpl } = recordedFetch((call) => {
    expect(call.url).toBe("https://api.magichour.ai/v1/image-to-video");
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(call.body as string);
    expect(body).toMatchObject({
      end_seconds: 8,
      resolution: "1080p",
      audio: false,
      model: "kling-3.0",
      style: { prompt: "motion prompt" },
      assets: { image_file_path: "https://magichour.ai/my-library?imageId=img_1" },
    });
    expect(body.assets).not.toHaveProperty("end_image_file_path");
    expect(JSON.stringify(body)).not.toContain("end_image_file_path");
    return jsonResponse({ id: "vid_1", credits_charged: 9 });
  });

  const created = await client(fetchImpl).createVideo({
    name: "reel_1_kickflip",
    prompt: "motion prompt",
    imageFilePath: "https://magichour.ai/my-library?imageId=img_1",
  });
  expect(created).toEqual({ id: "vid_1", creditsCharged: 9 });
});

test("kling includes end_image_file_path when an end path is passed", async () => {
  const { fetchImpl } = recordedFetch((call) => {
    const body = JSON.parse(call.body as string);
    expect(body.assets.end_image_file_path).toBe("api-assets/end.jpg");
    return jsonResponse({ id: "vid_end", credits_charged: 9 });
  });

  await client(fetchImpl).createVideo({
    name: "reel_1_kickflip",
    prompt: "motion prompt",
    imageFilePath: "api-assets/start.jpg",
    endImageFilePath: "api-assets/end.jpg",
  });
});

test("wan-2.2 omits end_image_file_path even when an end path is passed", async () => {
  const { fetchImpl } = recordedFetch((call) => {
    const body = JSON.parse(call.body as string);
    expect(body.model).toBe("wan-2.2");
    expect(body.assets).not.toHaveProperty("end_image_file_path");
    expect(JSON.stringify(body)).not.toContain("end_image_file_path");
    return jsonResponse({ id: "vid_wan", credits_charged: 2 });
  });

  await client(fetchImpl, { videoModel: "wan-2.2" }).createVideo({
    name: "reel_1_kickflip",
    prompt: "motion prompt",
    imageFilePath: "api-assets/start.jpg",
    endImageFilePath: "api-assets/end.jpg",
  });
});

test("retries one HTTP 500 that has no id, then returns the id", async () => {
  let posts = 0;
  const { fetchImpl } = recordedFetch(() => {
    posts += 1;
    if (posts === 1) return jsonResponse({ message: "unavailable" }, 500);
    return jsonResponse({ id: "img_retry", credits_charged: 5 }, 200);
  });

  const created = await client(fetchImpl).createImage({
    name: "n",
    prompt: "p",
    filePath: "api-assets/source.jpg",
  });
  expect(created).toEqual({ id: "img_retry", creditsCharged: 5 });
  expect(posts).toBe(2);
});

test("two HTTP 500s with no id throw MagicHourHttpError status 500", async () => {
  let posts = 0;
  const { fetchImpl } = recordedFetch(() => {
    posts += 1;
    return jsonResponse({ message: "unavailable" }, 500);
  });

  await expect(
    client(fetchImpl).createImage({ name: "n", prompt: "p", filePath: "api-assets/source.jpg" }),
  ).rejects.toMatchObject({ name: "MagicHourHttpError", status: 500 });
  expect(posts).toBe(2);
});

test("a 500 that includes an id does not post a second time", async () => {
  let posts = 0;
  const { fetchImpl } = recordedFetch(() => {
    posts += 1;
    return jsonResponse({ id: "img_charged", credits_charged: 5 }, 500);
  });

  try {
    await client(fetchImpl).createImage({ name: "n", prompt: "p", filePath: "api-assets/source.jpg" });
    expect.fail("expected MagicHourHttpError");
  } catch (error) {
    expect(error).toBeInstanceOf(MagicHourHttpError);
    expect((error as MagicHourHttpError).status).toBe(500);
    expect((error as MagicHourHttpError).body).toContain("img_charged");
  }
  expect(posts).toBe(1);
});

test("constructing the client with a default model throws", () => {
  expect(
    () =>
      createMagicHourClient({
        apiKey: "test-key",
        imageModel: "default",
        videoModel: "kling-3.0",
        downloadHosts: ["videos.magichour.ai"],
      }),
  ).toThrow(/default/);
  expect(
    () =>
      createMagicHourClient({
        apiKey: "test-key",
        imageModel: "seedream-v4.5",
        videoModel: "default",
        downloadHosts: ["videos.magichour.ai"],
      }),
  ).toThrow(/default/);
});

test("getImage and getVideo map downloads and expires_at", async () => {
  const { fetchImpl, calls } = recordedFetch((call) => {
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
    if (call.url.endsWith("/v1/image-projects/img_1")) {
      return jsonResponse({
        id: "img_1",
        status: "complete",
        credits_charged: 4,
        downloads: [{ url: "https://videos.magichour.ai/still.jpg", expires_at: "2026-11-03T00:00:00.000Z" }],
        error: null,
      });
    }
    expect(call.url).toBe("https://api.magichour.ai/v1/video-projects/vid_1");
    return jsonResponse({
      id: "vid_1",
      status: "error",
      credits_charged: null,
      downloads: [],
      error: { code: "provider_error", message: "failed" },
    });
  });

  const api = client(fetchImpl);
  const image = await api.getImage("img_1");
  expect(image).toEqual({
    id: "img_1",
    status: "complete",
    creditsCharged: 4,
    downloads: [{ url: "https://videos.magichour.ai/still.jpg", expiresAt: "2026-11-03T00:00:00.000Z" }],
    error: null,
  });
  const video = await api.getVideo("vid_1");
  expect(video.error).toEqual({ code: "provider_error", message: "failed" });
  expect(video.downloads).toEqual([]);
  expect(calls.map((call) => call.url)).toEqual([
    "https://api.magichour.ai/v1/image-projects/img_1",
    "https://api.magichour.ai/v1/video-projects/vid_1",
  ]);
});

test("logs one line per call and does not log the prompt", async () => {
  const lines: Record<string, unknown>[] = [];
  const { fetchImpl } = recordedFetch(() => jsonResponse({ id: "img_1", credits_charged: 4 }));
  await client(fetchImpl, { log: (line) => lines.push(line) }).createImage({
    name: "n",
    prompt: "SECRET PROMPT",
    filePath: "api-assets/source.jpg",
    reelId: "reel-1",
    sceneKey: "kickflip",
    attempt: 2,
  });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    reel_id: "reel-1",
    scene_key: "kickflip",
    attempt: 2,
    operation: "create_image",
    project_id: "img_1",
    http_status: 200,
    credits_charged: 4,
  });
  expect(typeof lines[0].duration_ms).toBe("number");
  expect(JSON.stringify(lines[0])).not.toContain("SECRET PROMPT");
});

test("alert writes a structured error line", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  alert("magic_hour_billing", { operation: "create_video" });
  expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({
    level: "error",
    alert: "magic_hour_billing",
    operation: "create_video",
  });
  spy.mockRestore();
});
