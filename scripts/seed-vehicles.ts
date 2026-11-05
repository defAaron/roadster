/**
 * EPA fuel-economy seed for `vehicles`.
 * Importing this module does not download or write. Run with `npx tsx scripts/seed-vehicles.ts`.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vehicles } from "@/lib/db/schema";
import { rowsFromEpaCsv } from "@/lib/vehicles/epa-catalog";

const EPA_CSV_URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv";
const BATCH_SIZE = 400;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
  if (/DATABASE_URL|postgres(?:ql)?:\/\/|fueleconomy\.gov|secret|password/i.test(error.message)) {
    return "Vehicle seed failed";
  }
  return error.message;
}

function looksLikeEpaCsv(body: string): boolean {
  const headerLine = body.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  if (headerLine.trim().startsWith("<")) return false;
  const columns = headerLine.split(",").map((column) => column.trim().replace(/^"|"$/g, ""));
  return columns.includes("year") && columns.includes("make") && columns.includes("model");
}

async function downloadEpaCsv(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(EPA_CSV_URL, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/csv,text/plain,*/*",
      },
    });
  } catch {
    throw new Error("EPA catalog download failed");
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error("EPA catalog download failed");
  }
  const body = await response.text();
  if (!looksLikeEpaCsv(body)) throw new Error("EPA catalog download was not CSV");
  return body;
}

async function main(): Promise<void> {
  const rows = rowsFromEpaCsv(await downloadEpaCsv());
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    if (batch.length === 0) continue;
    await db
      .insert(vehicles)
      .values(batch)
      .onConflictDoUpdate({
        target: [vehicles.year, vehicles.makeKey, vehicles.modelKey],
        set: {
          make: sql`excluded.make`,
          model: sql`excluded.model`,
          query: sql`excluded.query`,
        },
      });
  }
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
