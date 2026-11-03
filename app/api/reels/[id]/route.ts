import type { NextRequest } from "next/server";
import { incrementRateBucket, loadReel } from "@/lib/db/reels";
import { isUuid } from "@/lib/http/session";
import { jsonWithSession, openContext } from "@/lib/http/route";
import { minuteWindowStart } from "@/lib/rate-limit";
import { deriveReelStatus } from "@/lib/reel-status";
import { reelObjectStore } from "@/lib/reels/store";
import type { ReelView, SceneKey, SceneStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GET_REEL_ROUTE = "get_reel";
const SCENE_STATUSES = new Set<SceneStatus>(["pending", "editing", "still_ready", "animating", "complete", "failed"]);

function sceneKey(value: string): SceneKey | null {
  if (value === "kickflip" || value === "flyover") return value;
  return null;
}

function safeResultPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("results/") || value.includes("..")) return null;
  return value;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const opened = openContext(request);
  if (!opened.ok) return opened.response;
  const { ctx } = opened;

  try {
    const hits = await incrementRateBucket(ctx.ipHash, GET_REEL_ROUTE, minuteWindowStart(new Date()));
    if (hits > ctx.config.getReelPerMinute) return jsonWithSession({ error_code: "rate_limited" }, 429, ctx);

    const { id } = await context.params;
    if (!isUuid(id)) return jsonWithSession({ error_code: "not_found" }, 404, ctx);

    const reel = await loadReel(id);
    if (!reel) return jsonWithSession({ error_code: "not_found" }, 404, ctx);

    const store = reelObjectStore();
    const scenes: ReelView["scenes"] = [];
    for (const row of reel.scenes) {
      const key = sceneKey(row.sceneKey);
      if (!key) continue;
      const status: SceneStatus = SCENE_STATUSES.has(row.status as SceneStatus) ? (row.status as SceneStatus) : "failed";
      const stillPath = safeResultPath(row.stillPath);
      const videoPath = safeResultPath(row.videoPath);
      scenes.push({
        key,
        status,
        stillUrl: stillPath ? await store.signedUrl(stillPath, 600, `${key}.jpg`) : null,
        videoUrl: videoPath ? await store.signedUrl(videoPath, 600, `${key}.mp4`) : null,
        errorCode: row.errorCode,
      });
    }
    scenes.sort((a, b) => Number(a.key === "flyover") - Number(b.key === "flyover"));

    const view: ReelView = {
      id: reel.id,
      status: deriveReelStatus(scenes),
      errorCode: reel.errorCode,
      scenes,
    };
    return jsonWithSession(view, 200, ctx);
  } catch {
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }
}
