import { expect, test } from "vitest";
import { meanLuma, photoWarnings } from "@/lib/photo";

test("a dark frame warns", () => {
  expect(photoWarnings({ width: 1600, height: 1200, meanLuma: 20 })).toContain("dark");
});

test("a short-but-legal frame warns cropped and a 720 edge is not a warning by itself", () => {
  expect(photoWarnings({ width: 800, height: 720, meanLuma: 128 })).toContain("cropped");
});

test("a wide frame warns cropped", () => {
  expect(photoWarnings({ width: 3000, height: 1000, meanLuma: 128 })).toContain("cropped");
});

test("a normal daylight frame has no warnings", () => {
  expect(photoWarnings({ width: 1600, height: 1200, meanLuma: 128 })).toEqual([]);
});

test("mean luma weights the green channel highest", () => {
  const rgb = new Uint8ClampedArray([0, 255, 0]);
  expect(meanLuma(rgb)).toBeGreaterThan(150);
});
