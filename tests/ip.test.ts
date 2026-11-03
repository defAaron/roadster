import { afterEach, expect, test } from "vitest";
import { clientIp, hashIp } from "@/lib/http/ip";

const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

test("hashIp is a stable 64-char sha256 hex and changes with the address", () => {
  const first = hashIp("203.0.113.5", "salt");
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(hashIp("203.0.113.5", "salt")).toBe(first);
  expect(hashIp("203.0.113.6", "salt")).not.toBe(first);
});

test("clientIp reads the first hop of x-forwarded-for on Vercel", () => {
  process.env.VERCEL = "1";
  const headers = new Headers({
    "x-forwarded-for": " 203.0.113.5 , 198.51.100.1",
    "x-real-ip": "198.51.100.9",
  });
  expect(clientIp(headers)).toBe("203.0.113.5");
});

test("clientIp falls back to x-real-ip on Vercel when forwarded is missing", () => {
  process.env.VERCEL = "1";
  expect(clientIp(new Headers({ "x-real-ip": " 198.51.100.9 " }))).toBe("198.51.100.9");
});

test("clientIp ignores spoofed forwarding headers outside Vercel", () => {
  delete process.env.VERCEL;
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.5",
    "x-real-ip": "198.51.100.9",
  });
  expect(clientIp(headers)).toBe("127.0.0.1");
});
