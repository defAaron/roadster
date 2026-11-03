import { expect, test } from "vitest";
import sharp from "sharp";
import { NormalizeError, normalizeUpload } from "@/lib/images/normalize";
import { memoryStore } from "@/lib/storage";

const MAX_BYTES = 20 * 1024 * 1024;

async function jpeg(width: number, height: number, withExif = false): Promise<Buffer> {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  });
  if (withExif) image = image.withExif({ IFD0: { Copyright: "secret" } });
  return image.jpeg().toBuffer();
}

test("a legal cropped jpeg returns dimensions, jpeg bytes, a cropped warning, and no exif", async () => {
  const result = await normalizeUpload(await jpeg(1280, 800, true), "image/jpeg");
  expect(result.width).toBe(1280);
  expect(result.height).toBe(800);
  expect(result.jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
  expect(result.warnings).toContain("cropped");
  const meta = await sharp(result.jpeg).metadata();
  expect(meta.exif).toBeUndefined();
});

test("800x600 throws image_too_small because the short edge is under 720", async () => {
  try {
    await normalizeUpload(await jpeg(800, 600), "image/jpeg");
    expect.fail("expected image_too_small");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalizeError);
    expect((error as NormalizeError).code).toBe("image_too_small");
  }
});

test("400x400 throws image_too_small", async () => {
  try {
    await normalizeUpload(await jpeg(400, 400), "image/jpeg");
    expect.fail("expected image_too_small");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalizeError);
    expect((error as NormalizeError).code).toBe("image_too_small");
  }
});

test("random bytes throw not_an_image", async () => {
  try {
    await normalizeUpload(Buffer.from("this is not an image"), "application/octet-stream");
    expect.fail("expected not_an_image");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalizeError);
    expect((error as NormalizeError).code).toBe("not_an_image");
  }
});

test("20MB + 1 throws file_too_large", async () => {
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  try {
    await normalizeUpload(bytes, "image/jpeg");
    expect.fail("expected file_too_large");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalizeError);
    expect((error as NormalizeError).code).toBe("file_too_large");
  }
});

test("a png with exif orientation is accepted and re-encoded as jpeg", async () => {
  const png = await sharp({
    create: { width: 900, height: 1600, channels: 3, background: { r: 10, g: 20, b: 200 } },
  })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();

  const result = await normalizeUpload(png, "image/png");
  expect(result.jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
  expect(result.width).toBe(1600);
  expect(result.height).toBe(900);
  const meta = await sharp(result.jpeg).metadata();
  expect(meta.format).toBe("jpeg");
  expect(meta.exif).toBeUndefined();
});

test("declared mime is ignored when the sniff is a different image", async () => {
  const result = await normalizeUpload(await jpeg(800, 720), "image/png");
  expect(result.width).toBe(800);
  expect(result.height).toBe(720);
  expect(result.jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
});

test("memory store keeps bytes and returns a memory url", async () => {
  const store = memoryStore();
  const body = Buffer.from([1, 2, 3, 4]);
  await store.put("originals/pending/a/source.jpg", body, "image/jpeg");
  expect(Buffer.compare(await store.get("originals/pending/a/source.jpg"), body)).toBe(0);
  expect(await store.signedUrl("originals/pending/a/source.jpg", 600, "kickflip.jpg")).toBe(
    "memory://originals/pending/a/source.jpg",
  );
});
