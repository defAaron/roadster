import { expect, test } from "vitest";
import { GET, handleCron } from "@/app/api/cron/magic-hour/route";

const original = process.env.CRON_SECRET;

function restoreSecret(): void {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
}

test("cron is 401 when CRON_SECRET is missing", async () => {
  delete process.env.CRON_SECRET;
  try {
    let ran = false;
    const response = await handleCron(
      new Request("http://localhost/api/cron/magic-hour", { headers: { authorization: "Bearer secret" } }),
      async () => {
        ran = true;
      },
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(ran).toBe(false);
  } finally {
    restoreSecret();
  }
});

test("cron is 401 when the bearer token does not match", async () => {
  process.env.CRON_SECRET = "cron-secret";
  try {
    let ran = false;
    const mismatch = await handleCron(
      new Request("http://localhost/api/cron/magic-hour", { headers: { authorization: "Bearer cron-secreX" } }),
      async () => {
        ran = true;
      },
    );
    const shorter = await GET(new Request("http://localhost/api/cron/magic-hour", { headers: { authorization: "Bearer no" } }));
    expect(mismatch.status).toBe(401);
    expect(shorter.status).toBe(401);
    expect(await mismatch.text()).toBe("");
    expect(await shorter.text()).not.toContain("cron-secret");
    expect(ran).toBe(false);
  } finally {
    restoreSecret();
  }
});

test("cron runs the poll and returns ok when the bearer matches", async () => {
  process.env.CRON_SECRET = "cron-secret";
  try {
    let ran = false;
    const response = await handleCron(
      new Request("http://localhost/api/cron/magic-hour", { headers: { authorization: "Bearer cron-secret" } }),
      async () => {
        ran = true;
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(ran).toBe(true);
  } finally {
    restoreSecret();
  }
});
