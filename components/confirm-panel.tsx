import { Disclaimer } from "@/components/disclaimer";

const GUIDANCE =
  "A good photo is one car, fully in frame, from the side or a front three-quarter, in daylight, with the background unobstructed.";

export function ConfirmPanel({
  previewUrl,
  warnings,
}: {
  previewUrl: string;
  warnings: Array<"dark" | "cropped">;
}) {
  return (
    <section>
      {previewUrl ? (
        // Local object URLs are not compatible with next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="Your car" className="confirm-photo" />
      ) : null}
      <div className="confirm-copy">
        <p>{GUIDANCE}</p>
        {warnings.includes("dark") ? (
          <p>This photo looks dark. Daylight works better. You can still continue.</p>
        ) : null}
        {warnings.includes("cropped") ? (
          <p>This photo may be cropped or very wide. You can still continue.</p>
        ) : null}
        <Disclaimer />
      </div>
    </section>
  );
}
