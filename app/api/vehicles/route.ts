import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { incrementRateBucket } from "@/lib/db/reels";
import { jsonWithSession, openContext } from "@/lib/http/route";
import { minuteWindowStart } from "@/lib/rate-limit";
import { normalizeKey, parseVehicleQuery } from "@/lib/vehicles/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VEHICLE_SEARCH_ROUTE = "vehicle_search";
const MAX_QUERY_LENGTH = 80;

type VehicleSuggestionRow = {
  id: string;
  year: number;
  make: string;
  model: string;
};

function likeNeedle(needle: string): string {
  return normalizeKey(needle).replace(/[%_\\]/g, "");
}

export async function GET(request: NextRequest) {
  const opened = openContext(request);
  if (!opened.ok) return opened.response;
  const { ctx } = opened;

  try {
    const hits = await incrementRateBucket(ctx.ipHash, VEHICLE_SEARCH_ROUTE, minuteWindowStart(new Date()));
    if (hits > ctx.config.vehicleSearchPerMinute) return jsonWithSession({ error_code: "rate_limited" }, 429, ctx);

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length > MAX_QUERY_LENGTH) return jsonWithSession({ suggestions: [] }, 200, ctx);

    const parsed = parseVehicleQuery(q);
    if (!parsed) return jsonWithSession({ suggestions: [] }, 200, ctx);

    const year: number | null = parsed.year;
    const needle = likeNeedle(parsed.needle);
    const rows = await db.execute<VehicleSuggestionRow>(sql`
      select id, year, make, model
      from vehicles
      where (${year}::int is null or year = ${year})
        and (
          ${needle} = ''
          or make_key ilike ${needle} || '%'
          or model_key ilike ${needle} || '%'
          or (make_key || ' ' || model_key) ilike '%' || ${needle} || '%'
        )
      order by make, model
      limit 8
    `);

    const suggestions = Array.from(rows)
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        year: row.year,
        make: row.make,
        model: row.model,
        label: `${row.year} ${row.make} ${row.model}`,
      }));

    return jsonWithSession({ suggestions }, 200, ctx);
  } catch {
    return jsonWithSession({ error_code: "provider_error" }, 500, ctx);
  }
}
