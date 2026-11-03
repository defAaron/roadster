import { alert, logProvider, type ProviderLogFields } from "@/lib/log";

const BASE_URL = "https://api.magichour.ai";

const PROJECT_STATUSES = new Set(["queued", "rendering", "complete", "error", "canceled", "draft"]);

export class MagicHourHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly providerCode?: string,
  ) {
    super(body);
    this.name = "MagicHourHttpError";
  }
}

export type MagicHourProject = {
  id: string;
  status: "queued" | "rendering" | "complete" | "error" | "canceled" | "draft";
  creditsCharged: number | null;
  downloads: { url: string; expiresAt: string | null }[];
  error: { code?: string; message?: string } | null;
};

type CallContext = {
  reelId?: string;
  sceneKey?: string;
  attempt?: number;
};

type LogFn = (line: Record<string, unknown>) => void;

export function createMagicHourClient(opts: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  imageModel: string;
  videoModel: string;
  downloadHosts: string[];
  log?: LogFn;
}): {
  uploadImage(jpeg: Buffer, context?: CallContext): Promise<string>;
  createImage(input: {
    name: string;
    prompt: string;
    filePath: string;
    reelId?: string;
    sceneKey?: string;
    attempt?: number;
  }): Promise<{ id: string; creditsCharged: number }>;
  createVideo(input: {
    name: string;
    prompt: string;
    imageFilePath: string;
    endImageFilePath?: string;
    reelId?: string;
    sceneKey?: string;
    attempt?: number;
  }): Promise<{ id: string; creditsCharged: number }>;
  getImage(id: string, context?: CallContext): Promise<MagicHourProject>;
  getVideo(id: string, context?: CallContext): Promise<MagicHourProject>;
} {
  if (opts.imageModel === "default" || opts.videoModel === "default") {
    throw new Error('Refusing Magic Hour model "default"');
  }
  if (opts.downloadHosts.length === 0 || opts.downloadHosts.some((host) => host.trim() === "")) {
    throw new Error("downloadHosts must list at least one host");
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const emit = opts.log ?? ((line) => logProvider(line as ProviderLogFields));

  async function call(input: {
    method: "GET" | "POST" | "PUT";
    url: string;
    operation: string;
    context?: CallContext;
    jsonBody?: unknown;
    rawBody?: Uint8Array;
    authorize?: boolean;
    retryWithoutId?: boolean;
  }): Promise<{ status: number; text: string; json: unknown }> {
    let tried = false;
    while (true) {
      const headers = new Headers();
      if (input.authorize !== false) headers.set("authorization", `Bearer ${opts.apiKey}`);
      if (input.jsonBody !== undefined) headers.set("content-type", "application/json");

      const started = Date.now();
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers,
        body:
          input.jsonBody !== undefined
            ? JSON.stringify(input.jsonBody)
            : input.rawBody !== undefined
              ? (input.rawBody as BodyInit)
              : undefined,
      });
      const text = await response.text();
      const json = parseJson(text);
      const projectId = readId(json);
      const credits = readCredits(json);
      const line: ProviderLogFields = {
        scene_key: input.context?.sceneKey ?? null,
        attempt: input.context?.attempt ?? null,
        operation: input.operation,
        project_id: projectId ?? null,
        http_status: response.status,
        credits_charged: credits,
        duration_ms: Date.now() - started,
      };
      if (input.context?.reelId) line.reel_id = input.context.reelId;
      emit(line);

      if (input.retryWithoutId && response.status === 500 && !projectId && !tried) {
        tried = true;
        continue;
      }
      if (response.status === 401) alert("magic_hour_auth", { operation: input.operation, http_status: response.status });
      if (response.status === 402) {
        alert("magic_hour_billing", {
          operation: input.operation,
          http_status: response.status,
          provider_code: readProviderCode(json) ?? null,
        });
      }
      if (!response.ok) {
        throw new MagicHourHttpError(response.status, text, readProviderCode(json));
      }
      return { status: response.status, text, json };
    }
  }

  return {
    async uploadImage(jpeg, context) {
      const created = await call({
        method: "POST",
        url: `${BASE_URL}/v1/files/upload-urls`,
        operation: "upload_image",
        context,
        jsonBody: { items: [{ type: "image", extension: "jpg" }] },
      });
      const item = readUploadItem(created.json);
      await call({
        method: "PUT",
        url: item.uploadUrl,
        operation: "upload_image",
        context,
        rawBody: new Uint8Array(jpeg),
        authorize: false,
      });
      return item.filePath;
    },

    async createImage(input) {
      const created = await call({
        method: "POST",
        url: `${BASE_URL}/v1/ai-image-editor`,
        operation: "create_image",
        context: input,
        retryWithoutId: true,
        jsonBody: {
          name: input.name,
          image_count: 1,
          model: opts.imageModel,
          aspect_ratio: "16:9",
          resolution: "2k",
          style: { prompt: input.prompt },
          assets: { image_file_paths: [input.filePath] },
        },
      });
      return readCreated(created.json);
    },

    async createVideo(input) {
      const assets: { image_file_path: string; end_image_file_path?: string } = {
        image_file_path: input.imageFilePath,
      };
      if (opts.videoModel !== "wan-2.2" && input.endImageFilePath) {
        assets.end_image_file_path = input.endImageFilePath;
      }
      const created = await call({
        method: "POST",
        url: `${BASE_URL}/v1/image-to-video`,
        operation: "create_video",
        context: input,
        retryWithoutId: true,
        jsonBody: {
          name: input.name,
          end_seconds: 8,
          model: opts.videoModel,
          resolution: "1080p",
          audio: false,
          style: { prompt: input.prompt },
          assets,
        },
      });
      return readCreated(created.json);
    },

    async getImage(id, context) {
      const loaded = await call({
        method: "GET",
        url: `${BASE_URL}/v1/image-projects/${encodeURIComponent(id)}`,
        operation: "get_image",
        context,
      });
      return readProject(loaded.json);
    },

    async getVideo(id, context) {
      const loaded = await call({
        method: "GET",
        url: `${BASE_URL}/v1/video-projects/${encodeURIComponent(id)}`,
        operation: "get_video",
        context,
      });
      return readProject(loaded.json);
    },
  };
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const id = (json as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function readCredits(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const credits = (json as { credits_charged?: unknown }).credits_charged;
  return typeof credits === "number" ? credits : null;
}

function readProviderCode(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const row = json as { code?: unknown; error?: { code?: unknown } | null };
  if (typeof row.code === "string") return row.code;
  if (row.error && typeof row.error === "object" && typeof row.error.code === "string") return row.error.code;
  return undefined;
}

function readUploadItem(json: unknown): { uploadUrl: string; filePath: string } {
  const items =
    json && typeof json === "object" ? (json as { items?: { upload_url?: unknown; file_path?: unknown }[] }).items : undefined;
  const item = items?.[0];
  if (!item || typeof item.upload_url !== "string" || typeof item.file_path !== "string") {
    throw new Error("Magic Hour upload response missing file_path");
  }
  return { uploadUrl: item.upload_url, filePath: item.file_path };
}

function readCreated(json: unknown): { id: string; creditsCharged: number } {
  const id = readId(json);
  if (!id) throw new Error("Magic Hour create response missing id");
  return { id, creditsCharged: readCredits(json) ?? 0 };
}

function readProject(json: unknown): MagicHourProject {
  if (!json || typeof json !== "object") throw new Error("Magic Hour project response was empty");
  const row = json as {
    id?: unknown;
    status?: unknown;
    credits_charged?: unknown;
    downloads?: { url?: unknown; expires_at?: unknown }[] | null;
    error?: { code?: string; message?: string } | null;
  };
  if (typeof row.id !== "string" || typeof row.status !== "string" || !PROJECT_STATUSES.has(row.status)) {
    throw new Error("Magic Hour project response was invalid");
  }
  const downloads = Array.isArray(row.downloads) ? row.downloads : [];
  return {
    id: row.id,
    status: row.status as MagicHourProject["status"],
    creditsCharged: typeof row.credits_charged === "number" ? row.credits_charged : null,
    downloads: downloads.flatMap((item) => {
      if (!item || typeof item.url !== "string") return [];
      return [{ url: item.url, expiresAt: typeof item.expires_at === "string" ? item.expires_at : null }];
    }),
    error: row.error ?? null,
  };
}
