export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVehicleQuery(q: string): { year: number | null; needle: string } | null {
  const trimmed = q.trim();
  if (trimmed.length < 2) return null;

  const match = /^(?:19|20)\d{2}/.exec(trimmed);
  const year = match ? Number(match[0]) : null;
  const rest = match ? trimmed.slice(match[0].length) : trimmed;
  const needle = rest.toLowerCase().replace(/\s+/g, " ").trim();

  return { year, needle };
}
