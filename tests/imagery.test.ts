import { afterEach, expect, test, vi } from "vitest";
import { fetchFrontThreeQuarter } from "@/lib/vehicles/imagery";

const vehicle = { year: 2024, make: "Porsche", model: "911" };
const customerKey = "test-customer-key";
const originalKey = process.env.IMAGIN_CUSTOMER_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.IMAGIN_CUSTOMER_KEY;
  else process.env.IMAGIN_CUSTOMER_KEY = originalKey;
});

function recordedFetch(response: Response | (() => Response | Promise<Response>)) {
  const calls: { input: Parameters<typeof fetch>[0]; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return typeof response === "function" ? response() : response;
  };
  return { fetchImpl, calls };
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function jpeg(bytes: number, contentType = "image/jpeg"): Response {
  return new Response(Buffer.alloc(bytes, 7), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

test("requests the front three-quarter still with the pinned query", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const { fetchImpl, calls } = recordedFetch(jpeg(5001, "image/jpeg; charset=binary"));

  const body = await fetchFrontThreeQuarter(vehicle, fetchImpl);

  expect(calls).toHaveLength(1);
  const url = requestUrl(calls[0].input);
  expect(`${url.origin}${url.pathname}`).toBe("https://cdn.imagin.studio/getImage");
  expect(url.searchParams.get("angle")).toBe("23");
  expect(url.searchParams.get("fileType")).toBe("jpg");
  expect(url.searchParams.get("width")).toBe("1600");
  expect(url.searchParams.get("zoomType")).toBe("fullscreen");
  expect(url.searchParams.get("make")).toBe(vehicle.make);
  expect(url.searchParams.get("modelFamily")).toBe(vehicle.model);
  expect(url.searchParams.get("customer")).toBe(customerKey);
  expect(url.searchParams.has("year")).toBe(false);
  expect(calls[0].init?.redirect).toBe("error");
  expect(body).toBeInstanceOf(Buffer);
  expect(body?.length).toBe(5001);
});

test("404 returns null", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const { fetchImpl } = recordedFetch(new Response("missing", { status: 404 }));
  await expect(fetchFrontThreeQuarter(vehicle, fetchImpl)).resolves.toBeNull();
});

test("200 image/jpeg under 5000 bytes returns null", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const { fetchImpl } = recordedFetch(jpeg(4999));
  await expect(fetchFrontThreeQuarter(vehicle, fetchImpl)).resolves.toBeNull();
});

test("200 text/html returns null", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const html = new Response("<html>blocked</html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const { fetchImpl } = recordedFetch(html);
  await expect(fetchFrontThreeQuarter(vehicle, fetchImpl)).resolves.toBeNull();
});

test("200 JPEG over 5000 bytes returns the buffer", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const { fetchImpl } = recordedFetch(jpeg(5001));
  const body = await fetchFrontThreeQuarter(vehicle, fetchImpl);
  expect(Buffer.isBuffer(body)).toBe(true);
  expect(body).toEqual(Buffer.alloc(5001, 7));
});

test("missing IMAGIN_CUSTOMER_KEY returns null without calling fetch", async () => {
  const previous = process.env.IMAGIN_CUSTOMER_KEY;
  delete process.env.IMAGIN_CUSTOMER_KEY;
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return jpeg(5001);
  };
  try {
    await expect(fetchFrontThreeQuarter(vehicle, fetchImpl)).resolves.toBeNull();
    expect(called).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.IMAGIN_CUSTOMER_KEY;
    else process.env.IMAGIN_CUSTOMER_KEY = previous;
  }
});

test("a blank customer key returns null without calling fetch", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = "   ";
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return jpeg(5001);
  };
  await expect(fetchFrontThreeQuarter(vehicle, fetchImpl)).resolves.toBeNull();
  expect(called).toBe(false);
});

test("other statuses and a thrown fetch return null", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const { fetchImpl: serverError } = recordedFetch(new Response("nope", { status: 500 }));
  await expect(fetchFrontThreeQuarter(vehicle, serverError)).resolves.toBeNull();

  const { fetchImpl: redirect } = recordedFetch(new Response(null, { status: 302 }));
  await expect(fetchFrontThreeQuarter(vehicle, redirect)).resolves.toBeNull();

  const fetchImpl: typeof fetch = async () => {
    throw new Error("network down");
  };
  await expect(fetchFrontThreeQuarter(vehicle, fetchImpl)).resolves.toBeNull();
});

test("does not log the customer key or the request URL", async () => {
  process.env.IMAGIN_CUSTOMER_KEY = customerKey;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { fetchImpl } = recordedFetch(() => {
    throw new Error("network down");
  });

  await fetchFrontThreeQuarter(vehicle, fetchImpl);

  const dumped = [log, info, warn, error].flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
  expect(dumped).not.toContain(customerKey);
  expect(dumped).not.toContain("cdn.imagin.studio");
});
