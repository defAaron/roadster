import { Disclaimer } from "@/components/disclaimer";

const GUIDANCE =
  "A good photo is one car, fully in frame, from the side or a front three-quarter, in daylight, with the background unobstructed.";

export function ConfirmPanel({
  previewUrl,
  warnings,
  onStart,
  pending = false,
}: {
  previewUrl: string;
  warnings: Array<"dark" | "cropped">;
  onStart: () => void;
  pending?: boolean;
}) {
  return (
    <section className="mt-6">
      {previewUrl ? (
        // Local object URLs are not compatible with next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Your car"
          className="mt-6 w-full max-h-80 border border-[var(--line)] bg-white object-contain"
        />
      ) : null}
      <p className="mt-4 text-sm text-[var(--quiet)]">{GUIDANCE}</p>
      {warnings.includes("dark") ? (
        <p className="mt-3 text-sm">This photo looks dark. Daylight works better. You can still continue.</p>
      ) : null}
      {warnings.includes("cropped") ? (
        <p className="mt-3 text-sm">This photo may be cropped or very wide. You can still continue.</p>
      ) : null}
      <div className="mt-4">
        <Disclaimer />
      </div>
      <button
        type="button"
        className="mt-6 cursor-pointer bg-[var(--copper)] px-4 py-2.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onStart}
        disabled={pending || previewUrl.length === 0}
        aria-busy={pending || undefined}
      >
        {pending ? "Starting…" : "Start the reel"}
      </button>
    </section>
  );
}
