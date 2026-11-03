import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { deleteSource, insertPendingSource } from "@/lib/db/reels";
import { jsonWithSession, openContext } from "@/lib/http/route";
import { NormalizeError, normalizeUpload } from "@/lib/images/normalize";
import { reelObjectStore } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const opened = openContext(request);
  if (!opened.ok) return opened.response;
  const { ctx } = opened;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonWithSession({ error_code: "not_an_image" }, 400, ctx);
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) return jsonWithSession({ error_code: "not_an_image" }, 400, ctx);
  if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES) {
    return jsonWithSession({ error_code: "file_too_large" }, 400, ctx);
  }

  let normalized: Awaited<ReturnType<typeof normalizeUpload>>;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    normalized = await normalizeUpload(bytes, file.type || "application/octet-stream");
  } catch (error) {
    if (error instanceof NormalizeError) return jsonWithSession({ error_code: error.code }, 400, ctx);
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }

  const sourceId = randomUUID();
  const storagePath = `originals/pending/${sourceId}/source.jpg`;
  try {
    const reserved = await insertPendingSource({
      id: sourceId,
      storagePath,
      ipHash: ctx.ipHash,
      width: normalized.width,
      height: normalized.height,
      warnings: normalized.warnings,
      now: new Date(),
      uploadDailyCap: ctx.config.uploadDailyCap,
      capOffsetMinutes: ctx.config.capOffsetMinutes,
    });
    if (!reserved.ok) return jsonWithSession({ error_code: reserved.errorCode }, 429, ctx);

    const store = reelObjectStore();
    await store.put(storagePath, normalized.jpeg, "image/jpeg");
    const previewUrl = await store.signedUrl(storagePath, 600);
    return jsonWithSession({ sourceId, previewUrl, warnings: normalized.warnings }, 201, ctx);
  } catch {
    await deleteSource(sourceId).catch(() => undefined);
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }
}
