/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /**
   * Where OAuth providers should return the browser to. Optional: when it is
   * absent the app uses the origin it is served from, which is correct for
   * localhost and for a single deployed origin.
   */
  readonly VITE_AUTH_REDIRECT_URL?: string;
  /**
   * VAPID public key for Web Push. Public by design - the matching private key
   * only ever exists as a Supabase secret read by the send-push function.
   */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
