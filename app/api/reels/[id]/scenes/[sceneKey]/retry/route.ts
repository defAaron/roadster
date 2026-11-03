import type { NextRequest } from "next/server";
import { claimSceneRetry, failClaimedScene, incrementRateBucket, loadSceneForRetry } from "@/lib/db/reels";
import { jsonWithSession, openContext } from "@/lib/http/route";
import { isUuid } from "@/lib/http/session";
import { hourWindowStart } from "@/lib/rate-limit";
import { scheduleFakeScene } from "@/lib/reels/start";
import { retryDecision } from "@/lib/retry";
import type { SceneKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETRY_ROUTE = "retry_scene";

function sceneKey(value: string): SceneKey | null {
  if (value === "kickflip" || value === "flyover") return value;
  return null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; sceneKey: string }> }) {
  const opened = openContext(request);
  if (!opened.ok) return opened.response;
  const { ctx } = opened;

  try {
    try {
      await request.json();
    } catch {
      // Empty and invalid bodies are ignored. Retry never reads a prompt, model, or URL.
    }

    const hits = await incrementRateBucket(ctx.ipHash, RETRY_ROUTE, hourWindowStart(new Date()));
    if (hits > ctx.config.retryPerHour) return jsonWithSession({ error_code: "rate_limited" }, 429, ctx);

    const { id, sceneKey: rawKey } = await context.params;
    const key = sceneKey(rawKey);
    if (!isUuid(id) || !key) return jsonWithSession({ error_code: "not_found" }, 404, ctx);

    const scene = await loadSceneForRetry(id, key);
    if (!scene) return jsonWithSession({ error_code: "not_found" }, 404, ctx);

    const hasFile = scene.stillPath != null || scene.videoPath != null;
    const decision = retryDecision({
      status: scene.status,
      userRetries: scene.userRetries,
      cap: ctx.config.sceneUserRetryCap,
      hasFile,
      errorCode: scene.errorCode,
    });
    if (decision.action === "reject-in-flight") return jsonWithSession({ error_code: "scene_in_flight" }, 409, ctx);
    if (decision.action === "reject-cap") return jsonWithSession({ error_code: "retry_cap" }, 429, ctx);

    const claimed = await claimSceneRetry({ reelId: id, sceneKey: key, cap: ctx.config.sceneUserRetryCap });
    if (!claimed.ok) {
      const status = claimed.errorCode === "not_found" ? 404 : claimed.errorCode === "retry_cap" ? 429 : 409;
      return jsonWithSession({ error_code: claimed.errorCode }, status, ctx);
    }

    const driver = process.env.REEL_DRIVER?.trim() || "fake";
    if (driver === "live") {
      try {
        const { start } = await import("workflow/api");
        const { sceneWorkflow } = await import("@/workflows/reel");
        await start(sceneWorkflow, [id, key]);
      } catch {
        await failClaimedScene(id, key);
        return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
      }
    } else {
      scheduleFakeScene(id, key, claimed.phase, { userRetries: claimed.userRetries, attempt: claimed.attempt });
    }

    return jsonWithSession({ id }, 200, ctx);
  } catch {
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }
}
