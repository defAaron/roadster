import { and, count, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { readConfig, type AppConfig } from "@/lib/config";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { reels } from "@/lib/db/schema";

const ACTIVE_REEL_STATUSES = ["queued", "editing", "animating"] as const;

export type DbTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type ReelCapResult = { ok: true } | { ok: false; errorCode: "daily_cap" | "reel_in_progress" };

export function windowStart(now: Date, offsetMinutes: number): Date {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const midnightUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnightUtc - offsetMinutes * 60_000);
}

export function minuteWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

export async function lockIp(tx: DbTx, ipHash: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
}

async function countReels(tx: DbTx, where: SQL | undefined): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(reels).where(where);
  return Number(row?.value ?? 0);
}

async function decide(tx: DbTx, input: { ipHash: string; sessionId: string; now: Date }, config: AppConfig): Promise<ReelCapResult> {
  const start = windowStart(input.now, config.capOffsetMinutes);
  const daily = await countReels(tx, and(eq(reels.ipHash, input.ipHash), gte(reels.createdAt, start)));
  const activeHash = await countReels(
    tx,
    and(eq(reels.ipHash, input.ipHash), inArray(reels.status, [...ACTIVE_REEL_STATUSES])),
  );
  const activeSession = await countReels(
    tx,
    and(eq(reels.sessionId, input.sessionId), inArray(reels.status, [...ACTIVE_REEL_STATUSES])),
  );
  if (daily >= config.dailyReelCap) return { ok: false, errorCode: "daily_cap" };
  if (activeHash >= config.activeReelCap || activeSession >= config.activeReelCap) {
    return { ok: false, errorCode: "reel_in_progress" };
  }
  return { ok: true };
}

export async function assertCanCreateReel(
  input: { ipHash: string; sessionId: string; now: Date },
  tx?: DbTx,
): Promise<ReelCapResult> {
  const config = readConfig(process.env);
  if (tx) {
    await lockIp(tx, input.ipHash);
    return decide(tx, input, config);
  }
  return db.transaction(async (trx) => {
    await lockIp(trx, input.ipHash);
    return decide(trx, input, config);
  });
}
