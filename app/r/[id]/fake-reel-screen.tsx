"use client";

import { useEffect, useState } from "react";
import { ResultView } from "@/components/result-view";
import type { ReelView } from "@/lib/types";

function isTerminal(status: string) {
  return status === "complete" || status === "partial" || status === "failed";
}

function isReelView(value: unknown): value is ReelView {
  if (!value || typeof value !== "object") return false;
  const row = value as { id?: unknown; status?: unknown; scenes?: unknown; errorCode?: unknown };
  return typeof row.id === "string" && typeof row.status === "string" && Array.isArray(row.scenes);
}

export function ReelScreen({ id }: { id: string }) {
  const [reel, setReel] = useState<ReelView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stopped = false;
    const timer = window.setInterval(() => {
      void load();
    }, 2000);

    async function load() {
      if (stopped) return;
      let response: Response;
      try {
        response = await fetch(`/api/reels/${encodeURIComponent(id)}`);
      } catch {
        return;
      }
      if (stopped) return;
      if (response.status === 404) {
        stopped = true;
        window.clearInterval(timer);
        setMissing(true);
        return;
      }
      if (!response.ok) return;
      const payload: unknown = await response.json().catch(() => null);
      if (stopped || !isReelView(payload)) return;
      setReel(payload);
      if (isTerminal(payload.status)) {
        stopped = true;
        window.clearInterval(timer);
      }
    }

    void load();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [id]);

  if (missing) {
    return <h1>This reel does not exist.</h1>;
  }

  if (!reel) return null;

  return <ResultView reel={reel} />;
}
