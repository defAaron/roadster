import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createReelFromSource, loadSource } from "@/lib/db/reels";
import { isUuid } from "@/lib/http/session";
import { jsonWithSession, openContext } from "@/lib/http/route";
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

  const record = body as { sourceId?: unknown; vehicleId?: unknown };
  if ("vehicleId" in record && record.vehicleId != null) {
    return jsonWithSession({ error_code: "provider_error" }, 501, ctx);
  }
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
