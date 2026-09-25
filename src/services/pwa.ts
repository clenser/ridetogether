/**
 * Service worker registration and install-prompt plumbing.
 *
 * Kept out of the React tree so registration happens once on boot and survives
 * navigation, and so the install prompt is a module-level singleton rather than
 * something each page re-implements.
 *
 * Registration is intentionally best-effort: the app is fully usable without a
 * service worker, so a failure is logged in development and otherwise ignored.
 */

const SW_URL = "/sw.js";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export const isServiceWorkerSupported = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!isServiceWorkerSupported()) return null;
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    try {
      // Only meaningful over a secure origin. Localhost counts as secure, so
      // this works in development without any TLS setup.
      if (!window.isSecureContext) {
        if (import.meta.env.DEV) {
          console.info("[pwa] skipped: not a secure context");
        }
        return null;
      }

      const registration = await navigator.serviceWorker.register(SW_URL, {
        scope: "/",
      });

      if (import.meta.env.DEV) {
        console.info("[pwa] service worker registered", registration.scope);
      }

      // A new worker waits until every tab is closed by default, which on a
      // single-tab app looks like the update simply never applies.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            installing.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      return registration ?? null;
    } catch (error) {
      if (import.meta.env.DEV) console.warn("[pwa] registration failed", error);
      return null;
    }
  })();

  return registrationPromise;
};

export const getServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!isServiceWorkerSupported()) return null;
  try {
    const pending = await registrationPromise;
    if (pending) return pending;
    return (await navigator.serviceWorker.getRegistration("/")) ?? null;
  } catch {
    return null;
  }
};

/* ---------------------------------------------------------------------------
 * Install prompt
 * ------------------------------------------------------------------------- */

export interface InstallPromptState {
  /** True when the browser offered an install prompt we have not used yet. */
  canInstall: boolean;
  /** True once the app is running as an installed app. */
  isInstalled: boolean;
  /** True when the user previously dismissed the prompt; do not nag again. */
  dismissed: boolean;
}

const DISMISS_KEY = "ridetogether.install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(state: InstallPromptState) => void>();

const isStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  // `display-mode` is the standard check; the iOS prefix is the only way there.
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

const readDismissed = (): boolean => {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(DISMISS_KEY) === "1";
};

const snapshot = (): InstallPromptState => ({
  canInstall: deferredPrompt !== null,
  isInstalled: isStandalone(),
  dismissed: readDismissed(),
});

const emit = () => {
  const state = snapshot();
  for (const listener of listeners) listener(state);
};

/**
 * Listens for the browser's install prompt.
 *
 * Must be called once during boot: `beforeinstallprompt` fires early and is
 * missed entirely if the listener attaches after it.
 */
export const watchInstallPrompt = (): (() => void) => {
  const onPrompt = (event: Event) => {
    // Suppress the browser's own mini-infobar so the app can offer the install
    // in its own settings screen instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  };

  const onInstalled = () => {
    deferredPrompt = null;
    emit();
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);

  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
};

export const subscribeToInstallState = (
  listener: (state: InstallPromptState) => void,
): (() => void) => {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
};

export const getInstallState = (): InstallPromptState => snapshot();

/**
 * Shows the browser's install prompt.
 *
 * Returns the outcome, or `"unavailable"` when the browser is not offering one -
 * which is normal on iOS Safari and in an already-installed window.
 */
export const requestInstall = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";

  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // The event is single-use; drop it either way so a second tap is a no-op
    // rather than a promise that never resolves.
    deferredPrompt = null;
    emit();
    return outcome;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[pwa] install prompt failed", error);
    deferredPrompt = null;
    emit();
    return "unavailable";
  }
};

/** Remembers that the member said no, so the prompt is not shown again. */
export const dismissInstallPrompt = (): void => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DISMISS_KEY, "1");
  }
  deferredPrompt = null;
  emit();
};
