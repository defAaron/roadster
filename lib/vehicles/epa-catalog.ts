import { normalizeKey } from "@/lib/vehicles/query";

export type EpaCatalogRow = {
  year: number;
  make: string;
  model: string;
  makeKey: string;
  modelKey: string;
  query: string;
};

export function rowsFromEpaCsv(csv: string): EpaCatalogRow[] {
  const records = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (records.length === 0) return [];

  const header = records[0]?.map((cell) => cell.trim()) ?? [];
  const yearIndex = header.indexOf("year");
  const makeIndex = header.indexOf("make");
  const modelIndex = header.indexOf("model");
  if (yearIndex < 0 || makeIndex < 0 || modelIndex < 0) return [];

  const byKey = new Map<string, EpaCatalogRow>();
  for (const record of records.slice(1)) {
    const row = catalogRow(record, yearIndex, makeIndex, modelIndex);
    if (!row) continue;
    const key = `${row.year}\0${row.makeKey}\0${row.modelKey}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function catalogRow(
  record: readonly string[],
  yearIndex: number,
  makeIndex: number,
  modelIndex: number,
): EpaCatalogRow | null {
  const yearText = (record[yearIndex] ?? "").trim();
  if (!/^\d+$/.test(yearText)) return null;
  const year = Number(yearText);
  if (!Number.isInteger(year)) return null;

  const make = (record[makeIndex] ?? "").trim();
  const model = (record[modelIndex] ?? "").trim();
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.length > 1 || field.length > 0 || row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
