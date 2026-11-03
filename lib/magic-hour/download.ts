export function assertDownloadUrl(url: string, hosts: string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Download URL is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Download URL must use https");
  }
  if (!hosts.includes(parsed.hostname)) {
    throw new Error("Download URL host is not allowed");
  }
  return parsed;
}

export async function downloadAllowed(
  url: string,
  hosts: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  assertDownloadUrl(url, hosts);
  const response = await fetchImpl(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
