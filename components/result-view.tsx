import { Disclaimer } from "@/components/disclaimer";
import { ReelProgress } from "@/components/reel-progress";
import { userError } from "@/lib/copy";
import type { ReelView, SceneKey } from "@/lib/types";

export function ResultView(props: {
  reel: ReelView;
  onRetry?: (sceneKey: SceneKey) => void;
  retryNotice?: { sceneKey: SceneKey; message: string } | null;
}) {
  return (
    <main className="mx-auto max-w-xl px-5 py-14">
      <a href="/" className="text-sm text-[var(--quiet)] underline decoration-[var(--line)] underline-offset-4">
        Roadster
      </a>
      <h1 className="mt-6 text-4xl">Your reel</h1>
      <ReelProgress reel={props.reel} />
      {props.reel.scenes.map((scene) => {
        const title = scene.key === "kickflip" ? "Kickflip" : "Flyover";
        const retryable = scene.status === "failed" || scene.status === "complete";
        const notice =
          props.retryNotice && props.retryNotice.sceneKey === scene.key ? props.retryNotice.message : null;
        const downloads = scene.stillUrl || scene.videoUrl;
        return (
          <section key={scene.key}>
            <h2 className="mt-10 text-2xl">{title}</h2>
            {scene.stillUrl ? (
              <img
                src={scene.stillUrl}
                alt={`${title} still`}
                className="mt-4 w-full border border-[var(--line)] bg-white"
              />
            ) : null}
            {scene.videoUrl ? (
              <video
                src={scene.videoUrl}
                controls
                poster={scene.stillUrl ?? undefined}
                className="mt-4 w-full bg-black"
              />
            ) : null}
            {downloads ? (
              <div className="mt-3 flex gap-4 text-sm">
                {scene.stillUrl ? (
                  <a
                    href={scene.stillUrl}
                    download={`${scene.key}.jpg`}
                    className="underline decoration-[var(--line)] underline-offset-4"
                  >
                    Download still
                  </a>
                ) : null}
                {scene.videoUrl ? (
                  <a
                    href={scene.videoUrl}
                    download={`${scene.key}.mp4`}
                    className="underline decoration-[var(--line)] underline-offset-4"
                  >
                    Download video
                  </a>
                ) : null}
              </div>
            ) : null}
            {scene.errorCode ? <p className="text-sm text-[var(--copper)]">{userError(scene.errorCode)}</p> : null}
            {notice ? <p className="text-sm">{notice}</p> : null}
            {retryable ? (
              props.onRetry ? (
                <button
                  type="button"
                  onClick={() => props.onRetry?.(scene.key)}
                  className="mt-3 cursor-pointer text-sm text-[var(--copper)] underline decoration-[var(--line)] underline-offset-4"
                >
                  Try this scene again
                </button>
              ) : (
                <button type="button" disabled aria-disabled="true">
                  Try this scene again
                </button>
              )
            ) : null}
          </section>
        );
      })}
      <div className="mt-12">
        <Disclaimer />
      </div>
    </main>
  );
}
