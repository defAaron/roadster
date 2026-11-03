import { createClient } from "@supabase/supabase-js";

export type ObjectStore = {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  signedUrl(path: string, ttlSec: number, downloadName?: string): Promise<string>;
};

const BUCKET = "roadster";

export function supabaseStore(): ObjectStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
  return {
    async put(path, body, contentType) {
      const { error } = await bucket.upload(path, body, { contentType, upsert: true });
      if (error) throw error;
    },
    async get(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw error ?? new Error(`Missing object ${path}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async signedUrl(path, ttlSec, downloadName) {
      const { data, error } = await bucket.createSignedUrl(
        path,
        ttlSec,
        downloadName ? { download: downloadName } : undefined,
      );
      if (error || !data) throw error ?? new Error(`Could not sign ${path}`);
      return data.signedUrl;
    },
  };
}

export function memoryStore(): ObjectStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(path, body) {
      objects.set(path, Buffer.from(body));
    },
    async get(path) {
      const found = objects.get(path);
      if (!found) throw new Error(`Missing object ${path}`);
      return Buffer.from(found);
    },
    async signedUrl(path) {
      return `memory://${path}`;
    },
  };
}
