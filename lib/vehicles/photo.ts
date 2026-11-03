import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vehicleImages, vehicles } from "@/lib/db/schema";
import { isUuid } from "@/lib/http/session";
import { normalizeUpload } from "@/lib/images/normalize";
import { reelObjectStore } from "@/lib/reels/store";
import { fetchFrontThreeQuarter } from "@/lib/vehicles/imagery";

const FRONT_THREE_QUARTER = "front_three_quarter";

export type CatalogPhoto = { storagePath: string } | { error: "not_found" | "model_not_found" };

export async function resolveCatalogPhoto(vehicleId: string): Promise<CatalogPhoto> {
  if (!isUuid(vehicleId)) return { error: "not_found" };

  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return { error: "not_found" };

  const existing = await readFrontImage(vehicle.id);
  if (existing) return acceptStoredPath(vehicle.id, existing.storagePath);

  const bytes = await fetchFrontThreeQuarter({
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
  });
  if (!bytes) return { error: "model_not_found" };

  let normalized: Awaited<ReturnType<typeof normalizeUpload>>;
  try {
    normalized = await normalizeUpload(bytes, "image/jpeg");
  } catch {
    return { error: "model_not_found" };
  }

  const storagePath = catalogObjectPath(vehicle.id);
  if (!storagePath) return { error: "model_not_found" };

  const stored = await insertCatalogImageIfAbsent({
    vehicleId: vehicle.id,
    storagePath,
    width: normalized.width,
    height: normalized.height,
  });
  if (!stored) return { error: "model_not_found" };
  if (!stored.inserted) return acceptStoredPath(vehicle.id, stored.storagePath);

  try {
    await reelObjectStore().put(stored.storagePath, normalized.jpeg, "image/jpeg");
  } catch {
    await deleteInsertedCatalogImage(vehicle.id, stored.storagePath);
    return { error: "model_not_found" };
  }
  return acceptStoredPath(vehicle.id, stored.storagePath);
}

function catalogObjectPath(vehicleId: string): string | null {
  const storagePath = `catalog/${vehicleId}/front_three_quarter.jpg`;
  return isStoredCatalogPath(vehicleId, storagePath) ? storagePath : null;
}

function isStoredCatalogPath(vehicleId: string, storagePath: string): boolean {
  return storagePath === `catalog/${vehicleId}/front_three_quarter.jpg` && !storagePath.includes("..");
}

function acceptStoredPath(vehicleId: string, storagePath: string): CatalogPhoto {
  if (!isStoredCatalogPath(vehicleId, storagePath)) return { error: "model_not_found" };
  return { storagePath };
}

async function readFrontImage(vehicleId: string): Promise<{ storagePath: string } | null> {
  const [row] = await db
    .select({ storagePath: vehicleImages.storagePath })
    .from(vehicleImages)
    .where(and(eq(vehicleImages.vehicleId, vehicleId), eq(vehicleImages.angle, FRONT_THREE_QUARTER)))
    .limit(1);
  return row ?? null;
}

async function insertCatalogImageIfAbsent(input: {
  vehicleId: string;
  storagePath: string;
  width: number;
  height: number;
}): Promise<{ storagePath: string; inserted: boolean } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ storagePath: vehicleImages.storagePath })
      .from(vehicleImages)
      .where(and(eq(vehicleImages.vehicleId, input.vehicleId), eq(vehicleImages.angle, FRONT_THREE_QUARTER)))
      .limit(1)
      .for("update");
    if (current) return { storagePath: current.storagePath, inserted: false };

    const inserted = await tx
      .insert(vehicleImages)
      .values({
        vehicleId: input.vehicleId,
        angle: FRONT_THREE_QUARTER,
        storagePath: input.storagePath,
        source: "imagery_api",
        width: input.width,
        height: input.height,
      })
      .onConflictDoNothing({ target: [vehicleImages.vehicleId, vehicleImages.angle] })
      .returning({ storagePath: vehicleImages.storagePath });
    if (inserted[0]) return { storagePath: inserted[0].storagePath, inserted: true };

    const [winner] = await tx
      .select({ storagePath: vehicleImages.storagePath })
      .from(vehicleImages)
      .where(and(eq(vehicleImages.vehicleId, input.vehicleId), eq(vehicleImages.angle, FRONT_THREE_QUARTER)))
      .limit(1);
    return winner ? { storagePath: winner.storagePath, inserted: false } : null;
  });
}

async function deleteInsertedCatalogImage(vehicleId: string, storagePath: string): Promise<void> {
  await db
    .delete(vehicleImages)
    .where(
      and(
        eq(vehicleImages.vehicleId, vehicleId),
        eq(vehicleImages.angle, FRONT_THREE_QUARTER),
        eq(vehicleImages.source, "imagery_api"),
        eq(vehicleImages.storagePath, storagePath),
      ),
    );
}
