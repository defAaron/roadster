import { memoryStore, supabaseStore, type ObjectStore } from "@/lib/storage";

let memory: ObjectStore | null = null;

export function reelObjectStore(): ObjectStore {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return supabaseStore();
  memory ??= memoryStore();
  return memory;
}
