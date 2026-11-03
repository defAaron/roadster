import { createHmac, timingSafeEqual } from "node:crypto";

const EVENT_TYPES = new Set([
  "image.started",
  "image.completed",
  "image.errored",
  "video.started",
  "video.completed",
  "video.errored",
]);

const HEX_64 = /^[0-9a-f]{64}$/i;

export type MagicHourEvent = {
  type: "image.started" | "image.completed" | "image.errored" | "video.started" | "video.completed" | "video.errored";
  payload: {
    id: string;
    status: string;
    credits_charged?: number;
    downloads?: { url: string; expires_at?: string }[];
    error?: { code?: string; message?: string } | null;
  };
};

export function verifyMagicHourSignature(input: {
  secret: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  nowMs: number;
  toleranceSec?: number;
}): boolean {
  const { secret, signature, timestamp, rawBody, nowMs } = input;
  const toleranceSec = input.toleranceSec ?? 300;
  if (signature == null || timestamp == null) return false;
  if (!HEX_64.test(signature)) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  const ageSec = Math.abs(nowMs / 1000 - Number(timestamp));
  if (ageSec > toleranceSec) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  if (!HEX_64.test(expected)) return false;

  const provided = Buffer.from(signature, "hex");
  const computed = Buffer.from(expected, "hex");
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}

export function parseMagicHourEvent(rawBody: string): MagicHourEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const row = json as { type?: unknown; payload?: unknown };
  if (typeof row.type !== "string" || !EVENT_TYPES.has(row.type)) return null;
  if (!row.payload || typeof row.payload !== "object") return null;

  const payload = row.payload as {
    id?: unknown;
    status?: unknown;
    credits_charged?: unknown;
    downloads?: unknown;
    error?: unknown;
  };
  if (typeof payload.id !== "string" || payload.id.length === 0) return null;
  if (typeof payload.status !== "string" || payload.status.length === 0) return null;

  const event: MagicHourEvent = {
    type: row.type as MagicHourEvent["type"],
    payload: { id: payload.id, status: payload.status },
  };
  if (typeof payload.credits_charged === "number") event.payload.credits_charged = payload.credits_charged;

  if (Array.isArray(payload.downloads)) {
    const downloads = payload.downloads.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const url = (item as { url?: unknown }).url;
      if (typeof url !== "string" || url.length === 0) return [];
      const expires = (item as { expires_at?: unknown }).expires_at;
      return [{ url, ...(typeof expires === "string" ? { expires_at: expires } : {}) }];
    });
    if (downloads.length > 0) event.payload.downloads = downloads;
  }

  if (payload.error === null) event.payload.error = null;
  else if (payload.error && typeof payload.error === "object") {
    const error = payload.error as { code?: unknown; message?: unknown };
    const stored: { code?: string; message?: string } = {};
    if (typeof error.code === "string") stored.code = error.code;
    if (typeof error.message === "string") stored.message = error.message;
    event.payload.error = stored;
  }

  return event;
}
