import { and, eq } from "drizzle-orm";
import { downloadAllowed } from "@/lib/magic-hour/download";
import { parseMagicHourEvent, verifyMagicHourSignature, type MagicHourEvent } from "@/lib/magic-hour/webhook";
import { reelObjectStore } from "@/lib/reels/store";
import type { SceneKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

export type WebhookScene = {
  id: string;
  reelId: string;
  sceneKey: SceneKey;
  status: string;
};

export type ScenePatch = {
  status?: "editing" | "still_ready" | "animating" | "complete";
  errorDetail?: string | null;
  errorCode?: string | null;
  stillPath?: string;
  videoPath?: string;
};

export type WebhookDeps = {
  nowMs: () => number;
  secret: () => string | undefined;
  insertEvent: (event: MagicHourEvent) => Promise<"inserted" | "duplicate">;
  loadScene: (event: MagicHourEvent) => Promise<WebhookScene | null>;
  markScene: (scene: WebhookScene, patch: ScenePatch) => Promise<void>;
  downloadResult: (scene: WebhookScene, url: string, kind: "image" | "video") => Promise<string | null>;
  resume: (projectId: string, status: string) => Promise<void>;
};

function empty(status: number): Response {
  return new Response(null, { status });
}

function downloadHosts(): string[] {
  const value = process.env.MAGIC_HOUR_DOWNLOAD_HOSTS?.trim();
  if (!value) return ["videos.magichour.ai"];
  const parsed = value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return parsed.length > 0 ? parsed : ["videos.magichour.ai"];
}

function asSceneKey(value: string): SceneKey | null {
  if (value === "kickflip" || value === "flyover") return value;
  return null;
}

function storedError(error: MagicHourEvent["payload"]["error"]): string | null {
  if (!error) return null;
  const stored: { code?: string; message?: string } = {};
  if (typeof error.code === "string") stored.code = error.code;
  if (typeof error.message === "string") stored.message = error.message;
  return JSON.stringify(stored).slice(0, 500);
}

async function applyEvent(event: MagicHourEvent, deps: WebhookDeps): Promise<void> {
  const scene = await deps.loadScene(event);
  if (!scene) return;

  if (event.type === "image.started") {
    if (scene.status === "pending") await deps.markScene(scene, { status: "editing" });
    return;
  }
  if (event.type === "video.started") {
    if (scene.status !== "complete" && scene.status !== "failed") await deps.markScene(scene, { status: "animating" });
    return;
  }
  if (event.type === "image.errored" || event.type === "video.errored") {
    await deps.markScene(scene, { errorDetail: storedError(event.payload.error) });
    return;
  }

  const kind = event.type === "image.completed" ? "image" : "video";
  const url = event.payload.downloads?.[0]?.url;
  if (!url) return;
  const path = await deps.downloadResult(scene, url, kind);
  if (!path) return;
  if (kind === "image") {
    await deps.markScene(scene, { status: "still_ready", stillPath: path, errorCode: null, errorDetail: null });
    return;
  }
  await deps.markScene(scene, { status: "complete", videoPath: path, errorCode: null, errorDetail: null });
}

export async function handleMagicHourRequest(req: Request, deps: WebhookDeps): Promise<Response> {
  const declared = req.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) return empty(413);

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return empty(413);

  const secret = deps.secret()?.trim() ?? "";
  if (!secret) return empty(401);

  const verified = verifyMagicHourSignature({
    secret,
    signature: req.headers.get("magic-hour-event-signature"),
    timestamp: req.headers.get("magic-hour-event-timestamp"),
    rawBody,
    nowMs: deps.nowMs(),
  });
  if (!verified) return empty(401);

  const event = parseMagicHourEvent(rawBody);
  if (!event) return empty(200);

  let outcome: "inserted" | "duplicate";
  try {
    outcome = await deps.insertEvent(event);
  } catch {
    return empty(500);
  }

  if (outcome === "inserted") {
    try {
      await applyEvent(event, deps);
    } catch {
      // The event row is already stored. The workflow can finish from that row.
    }
  }

  try {
    await deps.resume(event.payload.id, event.payload.status);
  } catch {
    // The hook is registered when the workflow suspends. A miss is retried by the cron.
  }
  return empty(200);
}

function productionDeps(): WebhookDeps {
  return {
    nowMs: () => Date.now(),
    secret: () => process.env.MAGIC_HOUR_WEBHOOK_SECRET,
    async insertEvent(event) {
      const { db } = await import("@/lib/db/client");
      const { providerEvents } = await import("@/lib/db/schema");
      const rows = await db
        .insert(providerEvents)
        .values({
          projectId: event.payload.id,
          eventType: event.type,
          status: event.payload.status,
          payload: event.payload,
        })
        .onConflictDoNothing()
        .returning({ id: providerEvents.id });
      return rows.length > 0 ? "inserted" : "duplicate";
    },
    async loadScene(event) {
      const { db } = await import("@/lib/db/client");
      const { reelScenes } = await import("@/lib/db/schema");
      const column = event.type.startsWith("image.") ? reelScenes.imageProjectId : reelScenes.videoProjectId;
      const [scene] = await db.select().from(reelScenes).where(eq(column, event.payload.id)).limit(1);
      if (!scene) return null;
      const sceneKey = asSceneKey(scene.sceneKey);
      if (!sceneKey) return null;
      return { id: scene.id, reelId: scene.reelId, sceneKey, status: scene.status };
    },
    async markScene(scene, patch) {
      const { db } = await import("@/lib/db/client");
      const { reelScenes } = await import("@/lib/db/schema");
      await db.update(reelScenes).set(patch).where(and(eq(reelScenes.id, scene.id), eq(reelScenes.reelId, scene.reelId)));
    },
    async downloadResult(scene, url, kind) {
      try {
        const bytes = await downloadAllowed(url, downloadHosts());
        if (bytes.length === 0) return null;
        const ext = kind === "image" ? "jpg" : "mp4";
        const contentType = kind === "image" ? "image/jpeg" : "video/mp4";
        const path = `results/${scene.reelId}/${scene.sceneKey}.${ext}`;
        if (path.includes("..")) return null;
        await reelObjectStore().put(path, bytes, contentType);
        return path;
      } catch {
        return null;
      }
    },
    async resume(projectId, status) {
      const { resumeHook } = await import("workflow/api");
      await resumeHook(`mh:${projectId}`, { status });
    },
  };
}

export async function POST(req: Request): Promise<Response> {
  return handleMagicHourRequest(req, productionDeps());
}
