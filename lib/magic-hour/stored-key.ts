import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ReelDriver } from "@/lib/config";
import { createMagicHourClient } from "@/lib/magic-hour/client";

const IV_BYTES = 12;
const TAG_BYTES = 16;
export const MAGIC_HOUR_KEY_MAX_LENGTH = 256;

type MagicHourClientConfig = {
  ipHashSalt: string;
  imageModel: string;
  videoModel: string;
  downloadHosts: string[];
};

type MagicHourClient = ReturnType<typeof createMagicHourClient>;

export type StoredMagicHourKey =
  | { ok: true; ciphertext: string | null }
  | { ok: false; errorCode: "missing_api_key" | "provider_error" };

function aesKey(salt: string): Buffer {
  if (salt.trim() === "") throw new Error("Missing IP_HASH_SALT");
  return createHash("sha256").update(salt, "utf8").digest();
}

// iv (12) || auth tag (16) || ciphertext. The AES-256 key is SHA-256(IP_HASH_SALT).
export function encryptMagicHourKey(plaintext: string, salt: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", aesKey(salt), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptMagicHourKey(payload: string, salt: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) throw new Error("Invalid Magic Hour key ciphertext");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", aesKey(salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function storedMagicHourKey(input: {
  driver: ReelDriver;
  magicHourApiKey: unknown;
  salt: string;
}): StoredMagicHourKey {
  if (input.driver !== "live") return { ok: true, ciphertext: null };
  if (typeof input.magicHourApiKey !== "string") return { ok: false, errorCode: "missing_api_key" };
  const key = input.magicHourApiKey.trim();
  if (key.length === 0 || key.length > MAGIC_HOUR_KEY_MAX_LENGTH) {
    return { ok: false, errorCode: "missing_api_key" };
  }
  if (input.salt.trim() === "") return { ok: false, errorCode: "provider_error" };
  return { ok: true, ciphertext: encryptMagicHourKey(key, input.salt) };
}

export function magicHourClientFromCiphertext(
  ciphertext: string | null | undefined,
  config: MagicHourClientConfig,
  createClient: typeof createMagicHourClient = createMagicHourClient,
): MagicHourClient | null {
  if (ciphertext == null || ciphertext.trim() === "") return null;
  let apiKey: string;
  try {
    apiKey = decryptMagicHourKey(ciphertext, config.ipHashSalt);
  } catch {
    return null;
  }
  if (apiKey.length === 0) return null;
  return createClient({
    apiKey,
    imageModel: config.imageModel,
    videoModel: config.videoModel,
    downloadHosts: config.downloadHosts,
  });
}
