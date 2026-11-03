"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmPanel } from "@/components/confirm-panel";
import { userError } from "@/lib/copy";

type Suggestion = { id: string; label: string };

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error_code" in payload)) return null;
  const code = (payload as { error_code?: unknown }).error_code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function readSuggestions(payload: unknown): Suggestion[] {
  if (!payload || typeof payload !== "object" || !("suggestions" in payload)) return [];
  const rows = (payload as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(rows)) return [];
  const suggestions: Suggestion[] = [];
  for (const row of rows.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const label = (row as { label?: unknown }).label;
    if (typeof id !== "string" || id.length === 0 || typeof label !== "string") continue;
    suggestions.push({ id, label });
  }
  return suggestions;
}

function readUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const url = (payload as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function readReelId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function CatalogSearch() {
  const router = useRouter();
  const generation = useRef(0);
  const starting = useRef(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    setPreviewUrl("");
    setVehicleId(null);
    starting.current = false;
    generation.current += 1;
    if (value.trim().length < 2) setSuggestions([]);
  }

  useEffect(() => {
    const trimmed = query.trim();
    const ticket = generation.current;
    if (trimmed.length < 2) return;

    const handle = setTimeout(() => {
      if (ticket !== generation.current) return;
      void (async () => {
        let response: Response;
        try {
          response = await fetch(`/api/vehicles?q=${encodeURIComponent(trimmed)}`);
        } catch {
          if (ticket !== generation.current) return;
          setSuggestions([]);
          setNotice(userError("provider_error"));
          return;
        }
        const payload: unknown = await response.json().catch(() => null);
        if (ticket !== generation.current) return;
        if (response.status === 429) {
          setSuggestions([]);
          setNotice(userError("rate_limited"));
          return;
        }
        if (!response.ok) {
          setSuggestions([]);
          setNotice(userError(readErrorCode(payload) ?? "provider_error"));
          return;
        }
        setSuggestions(readSuggestions(payload));
        setNotice(null);
      })();
    }, 200);

    return () => clearTimeout(handle);
  }, [query]);

  async function choose(id: string) {
    const ticket = ++generation.current;
    setPreviewUrl("");
    setVehicleId(null);
    starting.current = false;
    setNotice(null);

    let response: Response;
    try {
      response = await fetch(`/api/vehicles/${encodeURIComponent(id)}/photo`);
    } catch {
      if (ticket !== generation.current) return;
      setNotice(userError("provider_error"));
      return;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (ticket !== generation.current) return;
    if (response.status === 404) {
      setNotice(userError("model_not_found"));
      document.getElementById("car-photo")?.focus();
      return;
    }
    const url = readUrl(payload);
    if (!response.ok || !url) {
      setNotice(userError(readErrorCode(payload) ?? "provider_error"));
      return;
    }
    setPreviewUrl(url);
    setVehicleId(id);
  }

  async function startReel() {
    if (!vehicleId || starting.current) return;
    const confirmedId = vehicleId;
    const ticket = generation.current;
    starting.current = true;
    setNotice(null);

    let response: Response;
    try {
      response = await fetch("/api/reels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicleId: confirmedId }),
      });
    } catch {
      if (ticket !== generation.current) return;
      starting.current = false;
      setNotice(userError("provider_error"));
      return;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (ticket !== generation.current) return;
    const reelId = readReelId(payload);
    if (response.status === 201 && reelId) {
      router.push(`/r/${reelId}`);
      return;
    }
    starting.current = false;
    setNotice(userError(readErrorCode(payload) ?? "provider_error"));
  }

  return (
    <div className="mt-4">
      {notice ? <p className="mb-3">{notice}</p> : null}
      <label htmlFor="catalog-name">Name the car</label>
      <input
        id="catalog-name"
        type="text"
        value={query}
        autoComplete="off"
        onChange={(event) => onQueryChange(event.target.value)}
        className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-2"
      />
      {suggestions.length > 0 ? (
        <ul className="mt-3">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className="cursor-pointer py-1 text-left"
                onClick={() => {
                  void choose(suggestion.id);
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {previewUrl ? (
        <ConfirmPanel previewUrl={previewUrl} warnings={[]} onStart={() => void startReel()} />
      ) : null}
    </div>
  );
}
