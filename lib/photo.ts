export function meanLuma(rgb: Uint8ClampedArray): number {
  const channels = 3;
  const pixels = Math.floor(rgb.length / channels);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * channels;
    sum += 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2];
  }
  return sum / pixels;
}

export function photoWarnings(input: { width: number; height: number; meanLuma: number }): Array<"dark" | "cropped"> {
  const warnings: Array<"dark" | "cropped"> = [];
  const short = Math.min(input.width, input.height);
  const long = Math.max(input.width, input.height);
  if (input.meanLuma < 40) warnings.push("dark");
  if (short < 1080 || long / short > 2.2) warnings.push("cropped");
  return warnings;
}
