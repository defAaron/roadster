"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { userError } from "@/lib/copy";

const MagicHourKeyContext = createContext<(() => string | null) | null>(null);

export function useMagicHourKey(): () => string | null {
  const read = useContext(MagicHourKeyContext);
  if (!read) throw new Error("Magic Hour API key field is missing");
  return read;
}

function KeyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
      <circle cx="8.5" cy="15.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12 12 7.25-7.25M16 8l2 2M18 6l2 2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path
        d="M2.75 12s3.25-5.5 9.25-5.5 9.25 5.5 9.25 5.5-3.25 5.5-9.25 5.5S2.75 12 2.75 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      {hidden ? <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.5" /> : null}
    </svg>
  );
}

export function MagicHourKeyField({ children }: { children: ReactNode }) {
  const [magicHourApiKey, setMagicHourApiKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  function readMagicHourKey(): string | null {
    const trimmed = magicHourApiKey.trim();
    if (trimmed.length === 0) {
      setNotice(userError("missing_api_key"));
      return null;
    }
    setNotice(null);
    return trimmed;
  }

  return (
    <MagicHourKeyContext.Provider value={readMagicHourKey}>
      <section className="key-section" aria-labelledby="api-key-label">
        <div className="section-heading">
          <div>
            <a
              id="api-key-label"
              href="https://magichour.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Connect your Magic Hour API key
            </a>
            <p>Stored only for this session</p>
          </div>
        </div>
        <div className={magicHourApiKey ? "key-input has-value" : "key-input"}>
          <span className="input-icon">
            <KeyIcon />
          </span>
          <input
            id="magic-hour-api-key"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            aria-label="Magic Hour API key"
            value={magicHourApiKey}
            placeholder="mhk_live_••••••••••••••••"
            onChange={(event) => {
              setMagicHourApiKey(event.target.value);
              if (event.target.value.trim().length > 0) setNotice(null);
            }}
          />
          {magicHourApiKey ? <span className="connected-dot" title="Key added" /> : null}
          <button
            className="icon-button"
            type="button"
            onClick={() => setShowKey((current) => !current)}
            aria-label={showKey ? "Hide API key" : "Show API key"}
          >
            <EyeIcon hidden={showKey} />
          </button>
        </div>
        {notice ? (
          <p className="key-notice catalog-note alert" role="alert">
            {notice}
          </p>
        ) : null}
      </section>
      {children}
      <p className="magic-hour-credit">Built using Magic Hour AI's API</p>
    </MagicHourKeyContext.Provider>
  );
}
