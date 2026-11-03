import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isUuid, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/http/session";

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const response = NextResponse.next();
  if (existing && isUuid(existing)) return response;
  response.cookies.set(
    SESSION_COOKIE_NAME,
    randomUUID(),
    sessionCookieOptions(process.env.NODE_ENV === "production"),
  );
  return response;
}

export const config = {
  matcher: ["/((?!_next|\\.well-known/workflow|.*\\..*).*)"],
};
