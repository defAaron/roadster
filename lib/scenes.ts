const SHARED =
  "Keep this car's body, proportions, paint, headlights, grille, badges, and wheels recognizable. Do not redesign it as a Tesla Roadster. Do not add Tesla badging. Add cold-gas thrusters only: white vapor from the rear main thrusters and from small attitude nozzles. No fire. No people. No readable license plates. No text. Daylight, paved surface, wide cinematic frame, the entire car visible.";

const STILL = {
  kickflip:
    "The car itself is tilted in mid-air, wheels clear of the ground. A dense white steam plume shoots from the underside of the car. The air under the car is empty.",
  flyover:
    "The car is level, a few meters up, passing over the roofs of a row of ordinary parked cars (a sedan, an SUV, a pickup, and a van), cold-gas plume visible.",
} as const;

const MOTION = {
  kickflip:
    "The car drives forward, lifts off the ground, tilts through one full rotation about its long axis. A dense white steam plume shoots from the underside during the rotation. It lands on its wheels and keeps moving. The camera tracks from the side. One maneuver, no jump cut. The air under the car stays empty during the rotation.",
  flyover:
    "The car drives toward a row of ordinary parked cars, lifts, stays roughly level, clears their roofs, and sets down on the far side. The camera tracks from the side. One maneuver, no jump cut. The parked cars are a sedan, an SUV, a pickup, and a van, not a Tesla lineup.",
} as const;

export function identityLine(
  input: { kind: "upload" } | { kind: "catalog"; year: number; make: string; model: string },
): string {
  if (input.kind === "upload") return "The car in the source photo.";
  return `A ${input.year} ${input.make} ${input.model}.`;
}

export function scenePrompts(
  key: "kickflip" | "flyover",
  identity: string,
): { stillPrompt: string; motionPrompt: string } {
  return {
    stillPrompt: `${identity} ${SHARED} ${STILL[key]}`,
    motionPrompt: `${identity} ${SHARED} ${MOTION[key]}`,
  };
}
