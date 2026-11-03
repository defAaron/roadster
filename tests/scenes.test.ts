import { expect, test } from "vitest";
import { identityLine, scenePrompts } from "@/lib/scenes";

const rules = [
  "Do not redesign it as a Tesla Roadster",
  "Do not add Tesla badging",
  "No fire",
  "No people",
  "No readable license plates",
];

test("upload identity does not invent a model", () => {
  expect(identityLine({ kind: "upload" })).toBe("The car in the source photo.");
});

test("catalog identity has year make and model and no color word", () => {
  expect(identityLine({ kind: "catalog", year: 2018, make: "Honda", model: "Civic" })).toBe("A 2018 Honda Civic.");
});

test("kickflip prompts name one flip and a landing", () => {
  const { stillPrompt, motionPrompt } = scenePrompts("kickflip", "The car in the source photo.");
  expect(stillPrompt).toContain("apex of a single skateboard-style kickflip");
  expect(motionPrompt).toContain("one kickflip about its long axis");
  expect(motionPrompt).toContain("lands on its wheels");
  for (const rule of rules) {
    expect(stillPrompt).toContain(rule);
    expect(motionPrompt).toContain(rule);
  }
});

test("flyover prompts clear ordinary cars and reject a Tesla lineup", () => {
  const { stillPrompt, motionPrompt } = scenePrompts("flyover", "A 2019 Ford F-150.");
  expect(stillPrompt).toContain("A 2019 Ford F-150.");
  expect(motionPrompt).toContain("sets down on the far side");
  expect(motionPrompt).toContain("not a Tesla lineup");
  expect(motionPrompt).toContain("sedan");
  expect(motionPrompt).toContain("van");
});
