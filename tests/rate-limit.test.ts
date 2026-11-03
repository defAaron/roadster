import { expect, test } from "vitest";
import { windowStart } from "@/lib/rate-limit";

test("central standard midnight is 06:00 UTC", () => {
  const start = windowStart(new Date("2026-11-03T05:59:00.000Z"), -360);
  expect(start.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  const next = windowStart(new Date("2026-11-03T06:00:00.000Z"), -360);
  expect(next.toISOString()).toBe("2026-11-03T06:00:00.000Z");
});
