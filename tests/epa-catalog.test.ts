import { expect, test } from "vitest";
import { rowsFromEpaCsv } from "@/lib/vehicles/epa-catalog";

test("a Honda Accord CSV row maps to a vehicle insert", () => {
  const rows = rowsFromEpaCsv("year,make,model\n1993,Honda,Accord\n");
  expect(rows).toEqual([
    {
      year: 1993,
      make: "Honda",
      model: "Accord",
      makeKey: "honda",
      modelKey: "accord",
      query: "1993 Honda Accord",
    },
  ]);
});

test("a row with a blank model is skipped", () => {
  expect(rowsFromEpaCsv("year,make,model\n1993,Honda,\n")).toEqual([]);
});

test("two rows with the same year, make, and model collapse to one", () => {
  const rows = rowsFromEpaCsv("year,make,model\n1993,Honda,Accord\n1993,Honda,Accord\n");
  expect(rows).toEqual([
    {
      year: 1993,
      make: "Honda",
      model: "Accord",
      makeKey: "honda",
      modelKey: "accord",
      query: "1993 Honda Accord",
    },
  ]);
});
