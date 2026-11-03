import type { NextRequest } from "next/server";
import { incrementRateBucket } from "@/lib/db/reels";
import { jsonWithSession, openContext } from "@/lib/http/route";
import { minuteWindowStart } from "@/lib/rate-limit";
import { reelObjectStore } from "@/lib/reels/store";
import { resolveCatalogPhoto } from "@/lib/vehicles/photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VEHICLE_PHOTO_ROUTE = "vehicle_photo";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const opened = openContext(request);
  if (!opened.ok) return opened.response;
  const { ctx } = opened;

  try {
    const hits = await incrementRateBucket(ctx.ipHash, VEHICLE_PHOTO_ROUTE, minuteWindowStart(new Date()));
    if (hits > ctx.config.vehicleSearchPerMinute) return jsonWithSession({ error_code: "rate_limited" }, 429, ctx);

    const { id } = await context.params;
    const photo = await resolveCatalogPhoto(id);
    if ("error" in photo) return jsonWithSession({ error_code: photo.error }, 404, ctx);

    const url = await reelObjectStore().signedUrl(photo.storagePath, 600);
    return jsonWithSession({ url }, 200, ctx);
  } catch {
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }
}
