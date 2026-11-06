"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ConfirmPanel } from "@/components/confirm-panel";
import { useBeginSource } from "@/components/creation-frame";
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

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
      <path
        d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  const [dragging, setDragging] = useState(false);

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

  useBeginSource("photo", {
    ready: Boolean(sourceId),
    pending,
    start: () => {
      void startReel();
    },
  });

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void acceptFile(event.dataTransfer.files?.[0]);
  }

  return (
    <>
      <div
        className={dragging ? "upload-side dragging" : "upload-side"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {fileError ? (
          <p className="upload-error" role="alert">
            {fileError}
          </p>
        ) : null}
        <label htmlFor="car-photo" className="upload-prompt">
          <span className="upload-icon">
            <UploadIcon />
          </span>
          <strong>{uploading ? "Reading the photo…" : "Upload a reference"}</strong>
          <span>
            Drop an image here or <u>browse</u>
          </span>
          <small>JPEG, PNG, WEBP, HEIC · MAX 20 MB</small>
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
      </div>
      {previewUrl ? (
        <div className="confirm-span">
          <ConfirmPanel previewUrl={previewUrl} warnings={warnings} />
        </div>
      ) : null}
    </>
  );
}
