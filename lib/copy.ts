export const DISCLAIMER =
  "This is a generated scene. Your car cannot do this. Roadster is not affiliated with Tesla.";

export const STAGE_LABELS = [
  "Preparing the photo",
  "Building the kickflip still",
  "Building the flyover still",
  "Filming the kickflip",
  "Filming the flyover",
] as const;

export type StageId = 0 | 1 | 2 | 3 | 4;

export const USER_ERRORS: Record<string, string> = {
  file_too_large: "That file is larger than 20 MB.",
  unsupported_type: "Use a JPEG, PNG, WebP, or HEIC photo.",
  not_an_image: "That file is not a photo we can read.",
  image_too_small: "Use a larger photo. The short side needs to be at least 720 pixels.",
  model_not_found: "We don't have a photo of that model. Upload one instead.",
  daily_cap: "Today's limit is 3 reels. Try again tomorrow.",
  reel_in_progress: "A reel is already running.",
  scene_in_flight: "That scene is still running.",
  retry_cap: "This scene has no retries left.",
  timeout: "This scene failed. You can try it again.",
  provider_error: "This scene failed. You can try it again.",
  provider_rejected: "This scene failed. You can try it again.",
  provider_auth: "This reel failed. You can try again later.",
  provider_billing: "This reel failed. You can try again later.",
  download_failed: "This scene failed. You can try it again.",
  not_found: "This reel does not exist.",
  rate_limited: "Too many requests. Wait a moment and try again.",
};

export function userError(code: string | null): string {
  if (!code) return "This scene failed. You can try it again.";
  return USER_ERRORS[code] ?? "This scene failed. You can try it again.";
}
