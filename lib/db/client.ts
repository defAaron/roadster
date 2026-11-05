import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(databaseUrl(process.env.DATABASE_URL));

function databaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error("Missing DATABASE_URL");
  if (/sslmode=/i.test(raw)) return raw;
  let host = "";
  try {
    host = new URL(raw.replace(/^postgres(ql)?:/, "http:")).hostname;
  } catch {
    return raw;
  }
  if (host === "localhost" || host === "127.0.0.1") return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}sslmode=require`;
}

export const db = drizzle(client, { schema });

// drizzle-orm replaces these with `(value) => value`. postgres.js 4 then calls
// Buffer.byteLength on the Date. Array, numeric, and json serializers stay as drizzle left them.
const scalarDateTimeOids = [1082, 1083, 1114, 1184] as const;

for (const oid of scalarDateTimeOids) {
  client.options.serializers[oid] = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
}
