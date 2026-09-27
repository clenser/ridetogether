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

/**
 * How long a caller will wait for a worker to become active.
 *
 * `navigator.serviceWorker.ready` is the obvious way to get a registration, but
 * it does not reject: if the worker never installs - a 404 on `sw.js`, a wrong
 * MIME type, a blocked script, an insecure origin - the promise simply never
 * settles. Anything awaiting it (which used to be the whole push opt-in flow)
 * waits forever with no error and no way for the member to recover. Every wait
 * on `ready` therefore races this deadline.
 */
const WORKER_READY_TIMEOUT_MS = 10_000;

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** Resolves `promise`, or `fallback` once `ms` have passed. Never rejects. */
const settleWithin = async <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

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
        // Without this the browser is allowed to satisfy the worker-script request
        // from its own HTTP cache, and a CDN or host that serves `sw.js` with a
        // long `max-age` will keep an old worker alive indefinitely. That is how an
        // installed PWA ends up running a worker that has no working `push`
        // handler while the deployed file clearly has one. `"none"` makes the
        // update check always go to the network, so `skipWaiting()` below can
        // actually install a new worker.
        updateViaCache: "none",
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

/** True when this page is actually controlled by an active service worker. */
export const isPageControlled = (): boolean =>
  isServiceWorkerSupported() && navigator.serviceWorker.controller !== null;

/**
 * A registration whose worker is active, without ever blocking forever.
 *
 * `ready` resolves only once a worker is active, and a page that is merely
 * *registered* is not enough: `PushManager` lives on the active worker, so a
 * registration still installing cannot deliver anything. Returns `null` rather
 * than hanging, so callers can report a real failure.
 */
export const getActiveServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!isServiceWorkerSupported()) return null;

  const ready = await settleWithin<ServiceWorkerRegistration | null>(
    navigator.serviceWorker.ready,
    WORKER_READY_TIMEOUT_MS,
    null,
  );
  if (ready) return ready;

  // `ready` timed out, so nothing is active. A registration may still be
  // installing or waiting; report nothing rather than a half-usable worker.
  const existing = await settleWithin<ServiceWorkerRegistration | null>(
    navigator.serviceWorker
      .getRegistration("/")
      .then((found) => found ?? null)
      .catch(() => null),
    2_000,
    null,
  );
  return existing?.active ? existing : null;
};

/**
 * Registers the worker if it is not registered yet, then waits - with a
 * deadline - for one to become active.
 *
 * This is the path a member takes when they press "Enable notifications", so it
 * must both repair a missing worker and give up loudly rather than spin.
 */
export const ensureActiveServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!isServiceWorkerSupported()) return null;

  const existing = await getActiveServiceWorkerRegistration();
  if (existing) return existing;

  // Boot may never have run (the app was already open when the worker was
  // broken, or the member landed straight here), so register explicitly. This
  // reuses the module-level promise, so a worker is never installed twice.
  await registerServiceWorker();

  return settleWithin<ServiceWorkerRegistration | null>(
    navigator.serviceWorker.ready,
    WORKER_READY_TIMEOUT_MS,
    null,
  );
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
 * Shows a notification if permission is granted.
 *
 * On Android (PWA/standalone mode), this triggers a native-looking notification.
 * On web, it uses the standard Notification API. Permission is requested if not
 * already granted.
 */
export const showNotification = async (
  title: string,
  options: NotificationOptions & { rideId?: string }
): Promise<boolean> => {
  if (!("Notification" in window)) {
    if (import.meta.env.DEV) console.info("[notification] not supported");
    return false;
  }

  // Check current permission status
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    if (import.meta.env.DEV) console.info("[notification] permission denied");
    return false;
  }

  try {
    const notification = new Notification(title, {
      ...options,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: `ride-${options.data?.rideId || "default"}`,
    });

    // Auto-close after 5 seconds if not user-interacted
    setTimeout(() => notification.close(), 5000);

return true;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[notification] failed", error);
    return false;
  }
};

/**
 * Shows the browser's install prompt.
 *
 * Returns the outcome, or `"unavailable"` when the browser is not offering one -
 * which is normal on iOS Safari and in an already-installed window.
 */
export const requestInstall = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DISMISS_KEY, "1");
  }
  deferredPrompt = null;
  emit();
  return "unavailable";
};

/**
 * Remembers that the member said no, so the prompt is not shown again.
 */
export const dismissInstallPrompt = (): void => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DISMISS_KEY, "1");
  }
  deferredPrompt = null;
  emit();
};
