/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /**
   * Where OAuth providers return the browser. Optional: when it is absent the
   * app uses `<current origin>/auth/callback`, which is correct for localhost and
   * for a single deployed origin. When it IS set it is used verbatim, so it must
   * be the full callback URL including `/auth/callback`. Password recovery does
   * not use this variable; it always resolves `<current origin>/reset-password`.
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
