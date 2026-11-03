import { createHash } from "node:crypto";

export function clientIp(headers: Headers): string {
  if (process.env.VERCEL) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "127.0.0.1";
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
