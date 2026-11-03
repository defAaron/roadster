/**
 * Offline NHTSA vPIC seed for `vehicles`.
 * Importing this module does not crawl. Run with `npx tsx scripts/seed-vehicles.ts`.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vehicles } from "@/lib/db/schema";
import { normalizeKey } from "@/lib/vehicles/query";

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const VEHICLE_TYPES = ["car", "truck", "multipurpose passenger vehicle"] as const;
const FIRST_YEAR = 1990;
const LAST_YEAR = 2026;
const CONCURRENCY = 4;

type MakeRow = {
  MakeId?: unknown;
  MakeName?: unknown;
};

type ModelRow = {
  Make_Name?: unknown;
  Model_Name?: unknown;
};

type VpicResponse<T> = {
  Results?: T[];
};

type VehicleRow = {
  year: number;
  make: string;
  model: string;
  makeKey: string;
  modelKey: string;
  query: string;
};

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryPath = realpathSync(path.resolve(entry));
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return entryPath === modulePath;
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  }
}

function failureText(error: unknown): string {
  if (!(error instanceof Error)) return "Vehicle seed failed";
  if (/DATABASE_URL|postgres(?:ql)?:\/\//i.test(error.message)) return "Vehicle seed failed";
  return error.message;
}

function resultRows<T>(payload: VpicResponse<T>): T[] {
  return Array.isArray(payload.Results) ? payload.Results : [];
}

async function fetchVpic<T>(url: string): Promise<VpicResponse<T>> {
  const response = await fetch(url);
  const urlPath = new URL(url).pathname;
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`vPIC ${urlPath} returned ${response.status}`);
  }
  try {
    return (await response.json()) as VpicResponse<T>;
  } catch {
    throw new Error(`vPIC ${urlPath} returned ${response.status} with unreadable JSON`);
  }
}

async function fetchMakeIds(type: string): Promise<number[]> {
  const url = `${VPIC_BASE}/GetMakesForVehicleType/${encodeURIComponent(type)}?format=json`;
  const payload = await fetchVpic<MakeRow>(url);
  const ids: number[] = [];
  for (const row of resultRows(payload)) {
    const name = typeof row.MakeName === "string" ? row.MakeName.trim() : "";
    if (name.length === 0) continue;
    if (typeof row.MakeId !== "number" || !Number.isInteger(row.MakeId)) continue;
    ids.push(row.MakeId);
  }
  return ids;
}

function vehicleRow(year: number, row: ModelRow): VehicleRow | null {
  const make = typeof row.Make_Name === "string" ? row.Make_Name.trim() : "";
  const model = typeof row.Model_Name === "string" ? row.Model_Name.trim() : "";
  if (make.length === 0 || model.length === 0) return null;
  const makeKey = normalizeKey(make);
  const modelKey = normalizeKey(model);
  if (makeKey.length === 0 || modelKey.length === 0) return null;
  return {
    year,
    make,
    model,
    makeKey,
    modelKey,
    query: `${year} ${make} ${model}`,
  };
}

async function upsertMakeYear(makeId: number, year: number): Promise<void> {
  const url = `${VPIC_BASE}/GetModelsForMakeIdYear/makeId/${makeId}/modelyear/${year}?format=json`;
  const payload = await fetchVpic<ModelRow>(url);
  const byKey = new Map<string, VehicleRow>();
  for (const row of resultRows(payload)) {
    const vehicle = vehicleRow(year, row);
    if (!vehicle) continue;
    byKey.set(`${vehicle.makeKey}\0${vehicle.modelKey}`, vehicle);
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return;

  await db
    .insert(vehicles)
    .values(rows)
    .onConflictDoUpdate({
      target: [vehicles.year, vehicles.makeKey, vehicles.modelKey],
      set: {
        make: sql`excluded.make`,
        model: sql`excluded.model`,
        query: sql`excluded.query`,
      },
    });
}

async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  let firstError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      try {
        await worker(item);
      } catch (error) {
        firstError ??= error;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
}

async function main(): Promise<void> {
  const makeIds = new Set<number>();
  await runPool(VEHICLE_TYPES, CONCURRENCY, async (type) => {
    for (const id of await fetchMakeIds(type)) makeIds.add(id);
  });

  const modelYears: number[] = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) modelYears.push(year);

  const jobs: Array<{ makeId: number; year: number }> = [];
  for (const makeId of makeIds) {
    for (const year of modelYears) jobs.push({ makeId, year });
  }

  await runPool(jobs, CONCURRENCY, async (job) => {
    await upsertMakeYear(job.makeId, job.year);
  });
}

if (isDirectRun()) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(failureText(error));
      process.exit(1);
    });
}
