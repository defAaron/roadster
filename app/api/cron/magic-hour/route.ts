import { timingSafeEqual } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { readConfig } from "@/lib/config";
import { MagicHourHttpError } from "@/lib/magic-hour/client";
import { magicHourClientFromCiphertext } from "@/lib/magic-hour/stored-key";
import type { SceneKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["complete", "error", "canceled"]);
const FIFTEEN_MINUTES_SEC = 15 * 60;

type StaleProject = {
  scene_id: string;
  reel_id: string;
  scene_key: string;
  project_id: string;
  requested_at: Date | string | null;
  key_ciphertext: string | null;
};

function authorized(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization ?? "");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export async function handleCron(req: Request, run: () => Promise<void>): Promise<Response> {
  if (!authorized(req.headers.get("authorization"))) return new Response(null, { status: 401 });
  try {
    await run();
  } catch {
    return new Response(null, { status: 500 });
  }
  return Response.json({ ok: true });
}

function sceneKey(value: string): SceneKey | null {
  if (value === "kickflip" || value === "flyover") return value;
  return null;
}

function ageSec(requested: Date | string | null, now: Date): number {
  if (!requested) return 0;
  const ms = requested instanceof Date ? requested.getTime() : Date.parse(requested);
  if (!Number.isFinite(ms)) return 0;
  return (now.getTime() - ms) / 1000;
}

function eventType(kind: "image" | "video", status: string): string {
  if (status === "complete") return `${kind}.completed`;
  if (status === "error") return `${kind}.errored`;
  return `${kind}.canceled`;
}

async function postgresNow(db: { execute: (query: ReturnType<typeof sql>) => Promise<{ now: Date | string }[]> }): Promise<Date> {
  const rows = await db.execute(sql`select now() as now`);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length > 0) return new Date(value);
  throw new Error("Postgres now() returned nothing");
}

async function resume(projectId: string, status: string): Promise<void> {
  try {
    const { resumeHook } = await import("workflow/api");
    await resumeHook(`mh:${projectId}`, { status });
  } catch {
    // The workflow registers the hook when it suspends. The next minute retries.
  }
}

export async function pollMagicHour(): Promise<void> {
  const { db } = await import("@/lib/db/client");
  const { providerEvents, rateBuckets, reelScenes } = await import("@/lib/db/schema");
  const now = await postgresNow(db);
  await db.delete(rateBuckets).where(lt(rateBuckets.windowStart, sql`now() - interval '2 days'`));

  const config = readConfig(process.env);

  const images = await db.execute<StaleProject>(sql`
    select s.id as scene_id, s.reel_id, s.scene_key, s.image_project_id as project_id, s.image_requested_at as requested_at,
      r.magic_hour_key_ciphertext as key_ciphertext
    from reel_scenes s
    inner join reels r on r.id = s.reel_id
    where s.status = 'editing'
      and s.image_project_id is not null
      and coalesce(
        (select max(e.received_at) from provider_events e where e.project_id = s.image_project_id),
        s.image_requested_at
      ) < now() - interval '90 seconds'
  `);
  const videos = await db.execute<StaleProject>(sql`
    select s.id as scene_id, s.reel_id, s.scene_key, s.video_project_id as project_id, s.video_requested_at as requested_at,
      r.magic_hour_key_ciphertext as key_ciphertext
    from reel_scenes s
    inner join reels r on r.id = s.reel_id
    where s.status = 'animating'
      and s.video_project_id is not null
      and coalesce(
        (select max(e.received_at) from provider_events e where e.project_id = s.video_project_id),
        s.video_requested_at
      ) < now() - interval '90 seconds'
  `);

  const jobs: { kind: "image" | "video"; row: StaleProject }[] = [
    ...images.map((row) => ({ kind: "image" as const, row })),
    ...videos.map((row) => ({ kind: "video" as const, row })),
  ];

  for (const job of jobs) {
    const key = sceneKey(job.row.scene_key);
    if (!key || !job.row.project_id) continue;
    const client = magicHourClientFromCiphertext(job.row.key_ciphertext, config);
    let terminal = false;
    if (client) {
      try {
        const project =
          job.kind === "image"
            ? await client.getImage(job.row.project_id, { reelId: job.row.reel_id, sceneKey: key })
            : await client.getVideo(job.row.project_id, { reelId: job.row.reel_id, sceneKey: key });
        if (TERMINAL.has(project.status)) {
          terminal = true;
          await db
            .insert(providerEvents)
            .values({
              projectId: project.id,
              eventType: eventType(job.kind, project.status),
              status: project.status,
              payload: {
                id: project.id,
                status: project.status,
                credits_charged: project.creditsCharged,
                downloads: project.downloads.map((item) => ({
                  url: item.url,
                  expires_at: item.expiresAt,
                })),
                error: project.error,
              },
            })
            .onConflictDoNothing();
          await resume(project.id, project.status);
        }
      } catch (error) {
        const httpStatus = error instanceof MagicHourHttpError ? error.status : null;
        console.error(
          JSON.stringify({
            level: "error",
            operation: "magic_hour_poll",
            reel_id: job.row.reel_id,
            scene_key: key,
            project_id: job.row.project_id,
            http_status: httpStatus,
          }),
        );
      }
    }
    if (terminal || ageSec(job.row.requested_at, now) <= FIFTEEN_MINUTES_SEC) continue;
    await db
      .update(reelScenes)
      .set({ status: "failed", errorCode: "timeout" })
      .where(
        and(
          eq(reelScenes.id, job.row.scene_id),
          eq(reelScenes.status, job.kind === "image" ? "editing" : "animating"),
        ),
      );
    await resume(job.row.project_id, "timeout");
  }
}

export async function GET(req: Request): Promise<Response> {
  return handleCron(req, pollMagicHour);
}
