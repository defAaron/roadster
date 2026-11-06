import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createReelFromSource, loadSource } from "@/lib/db/reels";
import { type RequestContext, jsonWithSession, openContext } from "@/lib/http/route";
import { isUuid } from "@/lib/http/session";
import { storedMagicHourKey } from "@/lib/magic-hour/stored-key";
import { reelObjectStore } from "@/lib/reels/store";
import { startReel } from "@/lib/reels/start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const opened = openContext(request);
  if (!opened.ok) return opened.response;
  const { ctx } = opened;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithSession({ error_code: "not_found" }, 400, ctx);
  }
  if (!body || typeof body !== "object") return jsonWithSession({ error_code: "not_found" }, 400, ctx);

  const record = body as { sourceId?: unknown; magicHourApiKey?: unknown };
  const accepted = acceptMagicHourKey(ctx, record.magicHourApiKey);
  if (!accepted.ok) return accepted.response;

  if (typeof record.sourceId !== "string" || !isUuid(record.sourceId)) {
    return jsonWithSession({ error_code: "not_found" }, 404, ctx);
  }

  const source = await loadSource(record.sourceId).catch(() => null);
  if (!source || source.consumedAt || !source.storagePath.startsWith("originals/") || source.storagePath.includes("..")) {
    return jsonWithSession({ error_code: "not_found" }, 404, ctx);
  }

  const reelId = randomUUID();
  const sourcePath = `originals/${reelId}/source.jpg`;
  try {
    const store = reelObjectStore();
    const bytes = await store.get(source.storagePath);
    await store.put(sourcePath, bytes, "image/jpeg");
    const created = await createReelFromSource({
      reelId,
      sourceId: source.id,
      sourcePath,
      ipHash: ctx.ipHash,
      sessionId: ctx.sessionId,
      now: new Date(),
      magicHourKeyCiphertext: accepted.ciphertext,
    });
    if (!created.ok) {
      const status = created.errorCode === "not_found" ? 404 : 429;
      return jsonWithSession({ error_code: created.errorCode }, status, ctx);
    }
    await startReel(reelId);
    return jsonWithSession({ id: reelId }, 201, ctx);
  } catch {
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }
}

function acceptMagicHourKey(
  ctx: RequestContext,
  magicHourApiKey: unknown,
): { ok: true; ciphertext: string | null } | { ok: false; response: NextResponse } {
  try {
    const stored = storedMagicHourKey({
      driver: ctx.config.reelDriver,
      magicHourApiKey,
      salt: ctx.config.ipHashSalt,
    });
    if (!stored.ok) {
      const status = stored.errorCode === "missing_api_key" ? 400 : 500;
      return { ok: false, response: jsonWithSession({ error_code: stored.errorCode }, status, ctx) };
    }
    return { ok: true, ciphertext: stored.ciphertext };
  } catch {
    return { ok: false, response: jsonWithSession({ error_code: "provider_error" }, 500, ctx) };
  }
}
