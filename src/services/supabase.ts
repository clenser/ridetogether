import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseConfigIssue =
  | "missing-url"
  | "missing-key"
  | "placeholder-url"
  | "placeholder-key"
  | "invalid-url"
  | "unsafe-key";

export type SupabaseConfigStatus =
  | { configured: true }
  | { configured: false; issue: SupabaseConfigIssue };

const PLACEHOLDER_URL = /^https:\/\/your-project-ref\.supabase\.co\/?$/i;
const PLACEHOLDER_KEY = /^your-publishable-key$/i;
const PROJECT_URL = /^https:\/\/[a-z0-9][a-z0-9-]*\.supabase\.co$/i;
const SECRET_KEY_MARKERS = /(service[_-]?role|secret|sbp_|sb_secret)/i;
const JWT_LIKE_KEY = /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

const readConfigStatus = (): SupabaseConfigStatus => {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

  if (!url) {
    return { configured: false, issue: "missing-url" };
  }
  if (!key) {
    return { configured: false, issue: "missing-key" };
  }
  if (PLACEHOLDER_URL.test(url)) {
    return { configured: false, issue: "placeholder-url" };
  }
  if (!PROJECT_URL.test(url)) {
    return { configured: false, issue: "invalid-url" };
  }
  if (PLACEHOLDER_KEY.test(key)) {
    return { configured: false, issue: "placeholder-key" };
  }
  if (SECRET_KEY_MARKERS.test(key) || JWT_LIKE_KEY.test(key)) {
    return { configured: false, issue: "unsafe-key" };
  }
  return { configured: true };
};

let status: SupabaseConfigStatus | null = null;
let client: SupabaseClient | null = null;

export const getSupabaseConfigStatus = (): SupabaseConfigStatus => {
  status ??= readConfigStatus();
  return status;
};

export const isSupabaseConfigured = (): boolean => getSupabaseConfigStatus().configured;

export const getSupabaseClient = (): SupabaseClient => {
  if (client) {
    return client;
  }

  const config = getSupabaseConfigStatus();
  if (!config.configured) {
    throw new Error(
      `Supabase is not configured (${config.issue}). Copy .env.example to .env and set ` +
        "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY with public project values. " +
        "Never use a service-role or secret key in frontend code.",
    );
  }

  client = createClient(
    import.meta.env.VITE_SUPABASE_URL.trim(),
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
  return client;
};
