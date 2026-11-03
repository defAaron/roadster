import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readConfig, type AppConfig } from "@/lib/config";
import { clientIp, hashIp } from "@/lib/http/ip";
import { SESSION_COOKIE_NAME, isUuid, sessionCookieOptions } from "@/lib/http/session";

export type RequestSession = { sessionId: string; freshSession: boolean };

export type RequestContext = RequestSession & {
  config: AppConfig;
  ipHash: string;
};

export function readSession(request: NextRequest): RequestSession {
  const existing = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (existing && isUuid(existing)) return { sessionId: existing, freshSession: false };
  return { sessionId: randomUUID(), freshSession: true };
}

export function jsonWithSession(body: unknown, status: number, session: RequestSession): NextResponse {
  const response = NextResponse.json(body, { status });
  if (session.freshSession) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      session.sessionId,
      sessionCookieOptions(process.env.NODE_ENV === "production"),
    );
  }
  return response;
}

export function openContext(
  request: NextRequest,
): { ok: true; ctx: RequestContext } | { ok: false; response: NextResponse } {
  const session = readSession(request);
  try {
    const config = readConfig(process.env);
    return {
      ok: true,
      ctx: {
        ...session,
        config,
        ipHash: hashIp(clientIp(request.headers), config.ipHashSalt),
      },
    };
  } catch {
    return { ok: false, response: jsonWithSession({ error_code: "provider_error" }, 500, session) };
  }
}
