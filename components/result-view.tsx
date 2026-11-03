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
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-4xl">Your reel</h1>
      <ReelProgress reel={props.reel} />
      {props.reel.scenes.map((scene) => {
        const title = scene.key === "kickflip" ? "Kickflip" : "Flyover";
        const retryable = scene.status === "failed" || scene.status === "complete";
        const notice =
          props.retryNotice && props.retryNotice.sceneKey === scene.key ? props.retryNotice.message : null;
        return (
          <section key={scene.key} className="mt-8">
            <h2 className="text-2xl">{title}</h2>
            {scene.stillUrl ? <img src={scene.stillUrl} alt={`${title} still`} /> : null}
            {scene.videoUrl ? (
              <video src={scene.videoUrl} controls poster={scene.stillUrl ?? undefined} />
            ) : null}
            {scene.stillUrl ? (
              <a href={scene.stillUrl} download={`${scene.key}.jpg`}>
                Download still
              </a>
            ) : null}
            {scene.videoUrl ? (
              <a href={scene.videoUrl} download={`${scene.key}.mp4`}>
                Download video
              </a>
            ) : null}
            {scene.errorCode ? <p>{userError(scene.errorCode)}</p> : null}
            {notice ? <p>{notice}</p> : null}
            {retryable ? (
              props.onRetry ? (
                <button type="button" onClick={() => props.onRetry?.(scene.key)}>
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
      <div className="mt-10">
        <Disclaimer />
      </div>
    </main>
  );
}
