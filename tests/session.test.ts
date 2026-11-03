import { expect, test } from "vitest";
import { SESSION_COOKIE_NAME, sessionCookie } from "@/lib/http/session";

test("sessionCookie is httpOnly lax for 180 days and secure only in production", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const local = sessionCookie(id, false);
  expect(local.startsWith(`${SESSION_COOKIE_NAME}=${id}`)).toBe(true);
  expect(local).toContain("HttpOnly");
  expect(local).toContain("SameSite=Lax");
  expect(local).toContain("Path=/");
  expect(local).toContain(`Max-Age=${60 * 60 * 24 * 180}`);
  expect(local).not.toContain("Secure");

  const production = sessionCookie(id, true);
  expect(production).toContain("Secure");
});
