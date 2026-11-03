const IMAGE_ENDPOINT = "https://cdn.imagin.studio/getImage";
const MIN_JPEG_BYTES = 5000;

function isJpeg(contentType: string | null): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "image/jpeg";
}

export async function fetchFrontThreeQuarter(
  vehicle: { year: number; make: string; model: string },
  fetchImpl?: typeof fetch,
): Promise<Buffer | null> {
  const customer = process.env.IMAGIN_CUSTOMER_KEY;
  if (!customer || customer.trim() === "") return null;

  const url = new URL(IMAGE_ENDPOINT);
  url.searchParams.set("customer", customer);
  url.searchParams.set("make", vehicle.make);
  url.searchParams.set("modelFamily", vehicle.model);
  url.searchParams.set("angle", "23");
  url.searchParams.set("fileType", "jpg");
  url.searchParams.set("width", "1600");
  url.searchParams.set("zoomType", "fullscreen");

  const request = fetchImpl ?? fetch;
  try {
    const response = await request(url, { redirect: "error" });
    if (response.status !== 200 || !isJpeg(response.headers.get("content-type"))) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length <= MIN_JPEG_BYTES) return null;
    return body;
  } catch {
    return null;
  }
}
