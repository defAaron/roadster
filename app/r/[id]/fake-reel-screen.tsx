"use client";

import { useEffect, useRef, useState } from "react";
import { ResultView } from "@/components/result-view";
import { userError } from "@/lib/copy";
import type { ReelView, SceneKey } from "@/lib/types";

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNotice, setRetryNotice] = useState<{ sceneKey: SceneKey; message: string } | null>(null);
  const [pollGeneration, setPollGeneration] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        if (!stopped) setLoadFailed(true);
        return;
      }
      if (stopped) return;
      if (response.status === 404) {
        stopped = true;
        window.clearInterval(timer);
        setLoadFailed(false);
        setMissing(true);
        return;
      }
      if (!response.ok) {
        setLoadFailed(true);
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      if (stopped || !isReelView(payload)) return;
      setLoadFailed(false);
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
  }, [id, pollGeneration]);

  async function onRetry(sceneKey: SceneKey) {
    let response: Response;
    try {
      response = await fetch(
        `/api/reels/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneKey)}/retry`,
        { method: "POST" },
      );
    } catch {
      if (!mounted.current) return;
      setRetryNotice({ sceneKey, message: userError("provider_error") });
      return;
    }
    if (!mounted.current) return;
    if (response.status === 200) {
      setRetryNotice(null);
      setPollGeneration((generation) => generation + 1);
      return;
    }
    if (response.status === 409) {
      setRetryNotice({ sceneKey, message: userError("scene_in_flight") });
      return;
    }
    if (response.status === 429) {
      const payload: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      const code =
        payload &&
        typeof payload === "object" &&
        "error_code" in payload &&
        typeof payload.error_code === "string"
          ? payload.error_code
          : "retry_cap";
      setRetryNotice({ sceneKey, message: userError(code) });
      return;
    }
    if (response.status === 404) {
      setRetryNotice({ sceneKey, message: userError("not_found") });
      return;
    }
    setRetryNotice({ sceneKey, message: userError("provider_error") });
  }

  if (missing) {
    return (
      <main className="mx-auto max-w-xl px-5 py-14">
        <a href="/" className="text-sm text-[var(--quiet)] underline decoration-[var(--line)] underline-offset-4">
          Roadster
        </a>
        <h1 className="mt-6 text-4xl">This reel does not exist.</h1>
      </main>
    );
  }

  if (!reel) {
    return (
      <main className="mx-auto max-w-xl px-5 py-14">
        <a href="/" className="text-sm text-[var(--quiet)] underline decoration-[var(--line)] underline-offset-4">
          Roadster
        </a>
        {loadFailed ? (
          <p className="mt-6 text-sm text-[var(--copper)]">This reel failed. You can try again later.</p>
        ) : (
          <p className="mt-6 text-sm text-[var(--quiet)]">Opening the reel…</p>
        )}
      </main>
    );
  }

  return (
    <ResultView
      reel={reel}
      onRetry={(sceneKey) => {
        void onRetry(sceneKey);
      }}
      retryNotice={retryNotice}
    />
  );
}
