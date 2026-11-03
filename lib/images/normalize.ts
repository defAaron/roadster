import convert from "heic-convert";
import sharp from "sharp";
import { meanLuma, photoWarnings } from "@/lib/photo";

const MAX_BYTES = 20 * 1024 * 1024;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

type ImageKind = "jpeg" | "png" | "webp" | "heic";

export class NormalizeError extends Error {
  constructor(readonly code: "file_too_large" | "unsupported_type" | "not_an_image" | "image_too_small") {
    super(code);
    this.name = "NormalizeError";
  }
}

export async function normalizeUpload(
  bytes: Buffer,
  declaredMime: string,
): Promise<{
  jpeg: Buffer;
  width: number;
  height: number;
  warnings: Array<"dark" | "cropped">;
}> {
  if (bytes.length > MAX_BYTES) throw new NormalizeError("file_too_large");

  const kind = trustedKind(bytes, declaredMime);
  const input = kind === "heic" ? await heicToJpeg(bytes) : bytes;
  let jpeg: Buffer;
  try {
    jpeg = await sharp(input, { failOn: "error" }).rotate().jpeg({ quality: 90 }).toBuffer();
  } catch (error) {
    if (error instanceof NormalizeError) throw error;
    throw new NormalizeError("not_an_image");
  }

  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1) throw new NormalizeError("not_an_image");
  if (Math.min(width, height) < 720) throw new NormalizeError("image_too_small");

  const raw = await sharp(jpeg).resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const warnings = photoWarnings({
    width,
    height,
    meanLuma: meanLuma(new Uint8ClampedArray(raw)),
  });
  return { jpeg, width, height, warnings };
}

function trustedKind(bytes: Buffer, declaredMime: string): ImageKind {
  const sniffed = sniff(bytes);
  if (!sniffed) throw new NormalizeError("not_an_image");
  const hint = hintKind(declaredMime);
  if (hint && hint !== sniffed) return sniffed;
  return sniffed;
}

function hintKind(declaredMime: string): ImageKind | null {
  const mime = declaredMime.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpeg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic") || mime.includes("heif")) return "heic";
  return null;
}

function sniff(bytes: Buffer): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && hasHeicBrand(bytes)) return "heic";
  return null;
}

function hasHeicBrand(bytes: Buffer): boolean {
  const major = bytes.toString("ascii", 8, 12).toLowerCase();
  if (HEIC_BRANDS.has(major)) return true;
  const end = Math.min(bytes.length, 64);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEIC_BRANDS.has(bytes.toString("ascii", offset, offset + 4).toLowerCase())) return true;
  }
  return false;
}

async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  try {
    const jpeg = await convert({ buffer: bytes, format: "JPEG", quality: 1 });
    return Buffer.from(jpeg);
  } catch {
    throw new NormalizeError("not_an_image");
  }
}
