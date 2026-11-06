import { Disclaimer } from "@/components/disclaimer";

const GUIDANCE =
  "A good photo is one car, fully in frame, from the side or a front three-quarter, in daylight, with the background unobstructed.";

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
      <path
        d="M5 12h14m-5-5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    <section>
      {previewUrl ? (
        // Local object URLs are not compatible with next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="Your car" className="confirm-photo" />
      ) : null}
      <div className="form-footer">
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
        <button
          type="button"
          className="primary-button"
          onClick={onStart}
          disabled={pending || previewUrl.length === 0}
          aria-busy={pending || undefined}
        >
          <span>{pending ? "Starting…" : "BEGIN CREATION"}</span>
          <ArrowIcon />
        </button>
      </div>
    </section>
  );
}
