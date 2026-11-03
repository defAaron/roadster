import { STAGE_LABELS, userError, type StageId } from "@/lib/copy";
import { stageDot } from "@/lib/reel-status";
import type { ReelView, SceneKey } from "@/lib/types";

function sceneKey(stage: 1 | 2 | 3 | 4): SceneKey {
  return stage === 1 || stage === 3 ? "kickflip" : "flyover";
}

export function ReelProgress({ reel }: { reel: ReelView }) {
  return (
    <ol>
      {STAGE_LABELS.map((label, index) => {
        const stage = index as StageId;
        const state = stageDot(reel, stage);
        const error =
          state === "failed" && stage !== 0
            ? userError(reel.scenes.find((scene) => scene.key === sceneKey(stage))?.errorCode ?? null)
            : null;
        return (
          <li key={stage} data-state={state}>
            {label}
            {error ? ` ${error}` : null}
          </li>
        );
      })}
    </ol>
  );
}
