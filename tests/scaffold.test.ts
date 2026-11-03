import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the disclaimer constant is the legal sentence", async () => {
  const { DISCLAIMER } = await import("../lib/copy");
  expect(DISCLAIMER).toBe(
    "This is a generated scene. Your car cannot do this. Roadster is not affiliated with Tesla.",
  );
});

test("gitignore covers env and build output", () => {
  const gitignore = readFileSync(".gitignore", "utf8");
  for (const line of ["node_modules", ".next", ".env", ".vercel"]) {
    expect(gitignore).toContain(line);
  }
  expect(gitignore).not.toContain(".env.example");
});
