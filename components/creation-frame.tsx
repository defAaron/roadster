"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Slot = "photo";

type BeginSource = {
  ready: boolean;
  pending: boolean;
  start: () => void;
};

const BeginContext = createContext<((slot: Slot, source: BeginSource) => void) | null>(null);

export function useBeginSource(slot: Slot, source: BeginSource) {
  const bind = useContext(BeginContext);
  const startRef = useRef(source.start);
  startRef.current = source.start;

  useEffect(() => {
    bind?.(slot, {
      ready: source.ready,
      pending: source.pending,
      start: () => startRef.current(),
    });
  }, [bind, slot, source.ready, source.pending]);
}

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

export function CreationFrame({ children }: { children: ReactNode }) {
  const starts = useRef<Record<Slot, () => void>>({
    photo: () => {},
  });
  const [ready, setReady] = useState<Record<Slot, boolean>>({ photo: false });
  const [pending, setPending] = useState<Record<Slot, boolean>>({ photo: false });
  const [active, setActive] = useState<Slot | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const bind = useCallback((slot: Slot, source: BeginSource) => {
    starts.current[slot] = source.start;
    setReady((current) => (current[slot] === source.ready ? current : { ...current, [slot]: source.ready }));
    setPending((current) => (current[slot] === source.pending ? current : { ...current, [slot]: source.pending }));
    if (source.ready) {
      setActive(slot);
      setHint(null);
    }
  }, []);

  const slot: Slot | null = active && ready[active] ? active : ready.photo ? "photo" : null;
  const busy = slot ? pending[slot] : false;

  function onBegin() {
    if (!slot) {
      setHint("Upload a photo.");
      return;
    }
    setHint(null);
    starts.current[slot]();
  }

  return (
    <BeginContext.Provider value={bind}>
      {children}
      <div className="form-footer">
        <p className="form-message" aria-live="polite">
          {hint ?? "Your data stays private and is never stored."}
        </p>
        <button
          className="primary-button"
          type="button"
          onClick={onBegin}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          <span>{busy ? "Starting…" : "BEGIN CREATION"}</span>
          <ArrowIcon />
        </button>
      </div>
    </BeginContext.Provider>
  );
}
