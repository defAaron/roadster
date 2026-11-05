"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { userError } from "@/lib/copy";

const MagicHourKeyContext = createContext<(() => string | null) | null>(null);

export function useMagicHourKey(): () => string | null {
  const read = useContext(MagicHourKeyContext);
  if (!read) throw new Error("Magic Hour API key field is missing");
  return read;
}

export function MagicHourKeyField({ children }: { children: ReactNode }) {
  const [magicHourApiKey, setMagicHourApiKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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
      <div className="mt-8">
        <label htmlFor="magic-hour-api-key" className="block text-sm">
          Magic Hour API key
        </label>
        <input
          id="magic-hour-api-key"
          type="password"
          autoComplete="off"
          value={magicHourApiKey}
          onChange={(event) => {
            setMagicHourApiKey(event.target.value);
            if (event.target.value.trim().length > 0) setNotice(null);
          }}
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-2.5"
        />
        {notice ? (
          <p className="mt-3 text-sm text-[var(--copper)]" role="alert">
            {notice}
          </p>
        ) : null}
      </div>
      {children}
    </MagicHourKeyContext.Provider>
  );
}
