import { expect, test } from "vitest";
import { normalizeKey, parseVehicleQuery } from "@/lib/vehicles/query";

test("parseVehicleQuery returns null when the trimmed query is shorter than 2 characters", () => {
  expect(parseVehicleQuery("c")).toBeNull();
  expect(parseVehicleQuery(" ")).toBeNull();
});

test("parseVehicleQuery extracts a leading model year and lowercases the remainder", () => {
  expect(parseVehicleQuery("2018 Honda Civic")).toEqual({
    year: 2018,
    needle: "honda civic",
  });
});

test("parseVehicleQuery keeps a query without a leading year as the needle", () => {
  expect(parseVehicleQuery("Civic")).toEqual({ year: null, needle: "civic" });
});

test("a year alone still returns that year with an empty needle", () => {
  expect(parseVehicleQuery("2018")).toEqual({ year: 2018, needle: "" });
});

test("normalizeKey lowercases and strips characters outside letters, digits, and spaces", () => {
  expect(normalizeKey("F-150")).toBe("f150");
});
