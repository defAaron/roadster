import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });

// drizzle-orm replaces these with `(value) => value`. postgres.js 4 then calls
// Buffer.byteLength on the Date. Array, numeric, and json serializers stay as drizzle left them.
const scalarDateTimeOids = [1082, 1083, 1114, 1184] as const;

for (const oid of scalarDateTimeOids) {
  client.options.serializers[oid] = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
}
