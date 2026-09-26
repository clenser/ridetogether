import { Capacitor } from "@capacitor/core";

/**
 * Native (Capacitor) OAuth bridge.
 *
 * On the web the Supabase client redirects the browser itself and settles the
 * session from the URL fragment during startup (`detectSessionInUrl`). Inside the
 * Android shell there is no browser navigation to perform: the app is served from
 * `https://localhost` by the WebView, so a normal redirect would land on a real
 * web deployment (or a dead localhost page) instead of coming back to the app.
 *
 * The native flow therefore uses a custom-scheme deep link:
 *   1. Ask Supabase NOT to redirect and take the authorize URL it returns.
 *   2. Open that URL in the system browser, which is a separate app.
 *   3. Google -> Supabase -> `com.ridetogether.app:/auth/callback#...`.
 *   4. Android matches our `<intent-filter>` and hands the URL back to the app.
 *   5. We read the session out of the fragment and hand it to the Supabase client,
 *      which persists it and fires `onAuthStateChange` for AuthContext.
 *
 * The scheme must stay identical to `appId` in `capacitor.config.ts` and to the
 * `<data android:scheme>` in the Android manifest, otherwise step 4 never happens.
 */
export const NATIVE_AUTH_SCHEME = "com.ridetogether.app";

/**
 * The redirect registered in the Supabase dashboard for native builds. Note the
 * single slash: a custom scheme has no host, so this is `scheme:/path`, not
 * `scheme://host/path`.
 */
export const NATIVE_AUTH_REDIRECT_URL = `${NATIVE_AUTH_SCHEME}:/auth/callback`;

/**
 * Origins the native shell serves this bundle from. They are not a deployment:
 * the Capacitor WebView loads the local `dist` folder over a scheme it owns, so
 * nothing is listening on them for an OAuth callback to land on. Android uses
 * `https://localhost` (Capacitor's default `server.androidScheme`) and iOS uses
 * `capacitor://localhost`. Keep in step with `capacitor.config.ts`.
 */
const SHELL_ORIGINS: ReadonlySet<string> = new Set([
  "https://localhost",
  "capacitor://localhost",
]);

/** True when the page is served by the native shell rather than by a web server. */
export const isCapacitorShellOrigin = (): boolean => {
  if (typeof window === "undefined") return false;
  return SHELL_ORIGINS.has(window.location.origin.toLowerCase());
};

/**
 * True only inside the Android/iOS shell; false in any browser.
 *
 * `Capacitor.isNativePlatform()` reads a global that the native bridge injects,
 * and that global is not guaranteed to be there the first time this module runs:
 * a cold start or a process restore can reach the auth code before the bridge
 * finishes. When it is missing, the WebView's own origin is the same signal the
 * bridge itself uses, so a late injection turns into a correct answer instead of
 * a redirect to a host that cannot answer.
 */
export const isNativeApp = (): boolean => {
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    // No bridge at all; the origin check below is the fallback.
  }
  return isCapacitorShellOrigin();
};

/**
 * Opens the provider in the system browser. Only ever called on native: on the
 * web the Supabase client performs the redirect itself so the session stays in
 * this tab and the user can use the back button.
 */
export const openAuthWindow = async (url: string): Promise<void> => {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, presentationStyle: "popover" });
};

/** Closes the system browser once the deep link has returned to the app. */
export const closeAuthWindow = async (): Promise<void> => {
  if (!isNativeApp()) return;
  const { Browser } = await import("@capacitor/browser");
  try {
    await Browser.close();
  } catch {
    // Already closed, or the platform closed it for us when the app resumed.
  }
};

/**
 * Subscribes to deep links that open the app, returning an unsubscribe function.
 *
 * The listener is registered for the whole app lifetime rather than around a
 * single sign-in, because the OS can also relaunch the app with the callback URL
 * after the process was killed. `App.getLaunchUrl()` is drained separately for
 * that cold-start case.
 */
export const listenForAuthDeepLink = async (
  onUrl: (url: string) => void,
): Promise<() => void> => {
  if (!isNativeApp()) return () => {};

  const { App } = await import("@capacitor/app");
  const handle = await App.addListener("appUrlOpen", (event) => {
    onUrl(event.url);
  });

  return () => {
    void handle.remove();
  };
};

/**
 * The URL the app was launched or resumed with, if any. Only meaningful on
 * native; a cold start after OAuth lands here.
 */
export const consumeLaunchUrl = async (): Promise<string | null> => {
  if (!isNativeApp()) return null;
  const { App } = await import("@capacitor/app");
  const result = await App.getLaunchUrl();
  return result?.url ?? null;
};

export interface DeepLinkSession {
  accessToken: string;
  refreshToken: string;
}

/**
 * Pulls the session out of a custom-scheme callback URL, or reports why it could
 * not. Kept separate from the Supabase client so the parsing is testable and so
 * the web path never depends on Capacitor.
 *
 * The fragment is read first because this app uses the default implicit flow,
 * which is what the web callback (`detectSessionInUrl`) relies on too. Query
 * parameters are checked as a fallback so a provider that reports an error in
 * `?error_description=` still produces a readable message.
 */
export const readSessionFromDeepLink = (
  url: string,
): { session: DeepLinkSession } | { error: string } | null => {
  const [beforeFragment, fragment = ""] = url.split("#");
  const query = beforeFragment.slice(beforeFragment.indexOf("?") + 1);
  const params = new URLSearchParams(fragment || query);

  const failure = params.get("error_description") ?? params.get("error");
  if (failure) return { error: failure };

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    return { session: { accessToken, refreshToken } };
  }

  return null;
};

/**
 * Whether a URL is this app's own OAuth callback, as opposed to any other link
 * the scheme is registered for. Decides when the system browser was opened by
 * this sign-in attempt and should be dismissed.
 */
export const isAuthCallbackUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === `${NATIVE_AUTH_SCHEME}:` &&
      parsed.pathname === "/auth/callback"
    );
  } catch {
    return false;
  }
};
