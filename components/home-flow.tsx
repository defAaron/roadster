"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmPanel } from "@/components/confirm-panel";
import { useMagicHourKey } from "@/components/magic-hour-key";
import { userError } from "@/lib/copy";

const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function isAllowedPhoto(file: File): boolean {
  const type = file.type.toLowerCase().split(";")[0].trim();
  if (ALLOWED_TYPES.has(type)) return true;
  if (type !== "") return false;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

function errorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error_code" in payload)) return "provider_error";
  const code = (payload as { error_code?: unknown }).error_code;
  return typeof code === "string" && code.length > 0 ? code : "provider_error";
}

function warningsFrom(payload: unknown): Array<"dark" | "cropped"> {
  if (!payload || typeof payload !== "object" || !("warnings" in payload)) return [];
  const warnings = (payload as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((item): item is "dark" | "cropped" => item === "dark" || item === "cropped");
}

function uploadPayload(payload: unknown): { sourceId: string; previewUrl: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { sourceId?: unknown; previewUrl?: unknown };
  if (typeof row.sourceId !== "string" || typeof row.previewUrl !== "string") return null;
  return { sourceId: row.sourceId, previewUrl: row.previewUrl };
}

export function HomeFlow() {
  const router = useRouter();
  const readMagicHourKey = useMagicHourKey();
  const generation = useRef(0);
  const starting = useRef(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [warnings, setWarnings] = useState<Array<"dark" | "cropped">>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);

  function clearPreview() {
    setPreviewUrl("");
    setWarnings([]);
    setSourceId(null);
  }

  async function acceptFile(file: File | undefined) {
    if (!file) return;
    const ticket = ++generation.current;
    starting.current = false;
    setPending(false);

    if (file.size > MAX_BYTES) {
      setFileError(userError("file_too_large"));
      clearPreview();
      setUploading(false);
      return;
    }
    if (!isAllowedPhoto(file)) {
      setFileError(userError("unsupported_type"));
      clearPreview();
      setUploading(false);
      return;
    }

    setFileError(null);
    clearPreview();
    setUploading(true);
    const body = new FormData();
    body.set("file", file);
    let response: Response;
    try {
      response = await fetch("/api/uploads", { method: "POST", body });
    } catch {
      if (ticket !== generation.current) return;
      setUploading(false);
      setFileError(userError("provider_error"));
      return;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (ticket !== generation.current) return;
    setUploading(false);
    const uploaded = uploadPayload(payload);
    if (!response.ok || !uploaded) {
      setFileError(userError(errorCode(payload)));
      clearPreview();
      return;
    }
    setWarnings(warningsFrom(payload));
    setPreviewUrl(uploaded.previewUrl);
    setSourceId(uploaded.sourceId);
  }

  async function startReel() {
    if (!sourceId || starting.current) return;
    const magicHourApiKey = readMagicHourKey();
    if (magicHourApiKey == null) return;
    starting.current = true;
    setPending(true);
    setFileError(null);
    let response: Response;
    try {
      response = await fetch("/api/reels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId, magicHourApiKey }),
      });
    } catch {
      starting.current = false;
      setPending(false);
      setFileError(userError("provider_error"));
      return;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
      starting.current = false;
      setPending(false);
      setFileError(userError(errorCode(payload)));
      return;
    }
    router.push(`/r/${(payload as { id: string }).id}`);
  }

  return (
    <div className="mt-8">
      {fileError ? (
        <p className="mb-3 text-sm text-[var(--copper)]" role="alert">
          {fileError}
        </p>
      ) : null}
      <label
        htmlFor="car-photo"
        className="relative flex w-full cursor-pointer items-center justify-between gap-4 border border-[var(--line)] bg-white px-3 py-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid focus-within:[outline-color:var(--copper)]"
      >
        <span>{uploading ? "Reading the photo…" : "Choose a photo"}</span>
        <span className="shrink-0 text-sm text-[var(--quiet)]">JPEG, PNG, WebP, HEIC</span>
        <input
          id="car-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          aria-label="Car photo"
          className="sr-only"
          onChange={(event) => {
            const input = event.currentTarget;
            const selected = input.files?.[0];
            input.value = "";
            void acceptFile(selected);
          }}
        />
      </label>
      {previewUrl ? (
        <ConfirmPanel
          previewUrl={previewUrl}
          warnings={warnings}
          pending={pending}
          onStart={() => void startReel()}
        />
      ) : null}
    </div>
  );
}
