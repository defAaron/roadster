export type ProviderLogFields = {
  reel_id?: string;
  scene_key?: string | null;
  attempt?: number | null;
  operation: string;
  project_id?: string | null;
  http_status?: number | null;
  credits_charged?: number | null;
  duration_ms?: number;
};

export function logProvider(fields: ProviderLogFields): void {
  console.log(JSON.stringify(fields));
}

export type AlertCode = "magic_hour_auth" | "magic_hour_billing" | "reel_failure_rate";

export function alert(code: AlertCode, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", alert: code, ...fields }));
}
