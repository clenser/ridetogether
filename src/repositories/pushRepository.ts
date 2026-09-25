import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Client half of Web Push: turns a browser subscription into a row the
 * `send-push` Edge Function can deliver to.
 *
 * The browser only ever writes its own row. The VAPID private key never reaches
 * this module - delivery happens server-side, which is what stops any member
 * (or anyone who unpacks the JS bundle) from sending arbitrary notifications.
 */

const PUSH_TABLE = "push_subscriptions";

/** Raw subscription keys, as returned by `PushSubscription.toJSON()`. */
interface PushSubscriptionKeys {
  p256dh?: string;
  auth?: string;
}

export type PushSupport = "unsupported" | "denied" | "prompt" | "subscribed" | "unknown";

/** Turns a browser subscription into flat values, plus the key we match on. */
const toPayload = (subscription: PushSubscription) => {
  const json = subscription.toJSON() as { endpoint?: string; keys?: PushSubscriptionKeys };
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh ?? "";
  const auth = json.keys?.auth ?? "";

  if (!endpoint || !p256dh || !auth) {
    throw new DataError(
      "This browser returned an incomplete push subscription. Please try turning notifications off and on again.",
      "invalid",
    );
  }
  return { endpoint, p256dh, auth };
};

const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
};

export const isPushSupported = (): boolean =>
  typeof window !== "undefined"
  && "serviceWorker" in navigator
  && "PushManager" in window
  && "Notification" in window;

/** The VAPID public key is public and safe to ship; the private key is not. */
export const getVapidPublicKey = (): string =>
  (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();

export const isPushConfigured = (): boolean => isPushSupported() && getVapidPublicKey() !== "";

/**
 * Reports the current push state so the UI can label its toggle honestly
 * without prompting the browser for permission on page load.
 */
export const getPushState = async (): Promise<PushSupport> => {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "subscribed" : "prompt";
};

/**
 * Asks for permission and stores the subscription.
 *
 * The permission prompt only ever appears because a member tapped the toggle -
 * this is never called during render, on load, or after a background event.
 */
export const subscribeToPush = async (): Promise<void> => {
  if (!isPushSupported()) {
    throw new DataError("This browser cannot receive push notifications.", "invalid");
  }
  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    throw new DataError("Push notifications are not configured for this deployment yet.", "invalid");
  }

  const registration = await getRegistration();
  if (!registration) {
    throw new DataError("RideTogether is still loading. Please try again in a moment.", "invalid");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new DataError(
      "Notification permission was not granted. You can allow it in your browser settings.",
      "forbidden",
    );
  }

  const userId = await getAuthenticatedUserId();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const { endpoint, p256dh, auth } = toPayload(subscription);
  const client = getSupabaseClient();

  // `endpoint` is globally unique: the same browser is one subscription, so
  // re-enabling the toggle updates the existing row rather than piling up
  // duplicates. The WITH CHECK policy still requires user_id to be ours.
  const { error } = await client
    .from(PUSH_TABLE)
    .upsert(
      {
        user_id: userId,
        endpoint,
        p256dh_key: p256dh,
        auth_key: auth,
        user_agent: navigator.userAgent.slice(0, 500),
      },
      { onConflict: "endpoint" },
    );

  if (error) throw toDataError(error, "create");
};

/** Removes this browser's subscription and its stored row. */
export const unsubscribeFromPush = async (): Promise<void> => {
  const userId = await getAuthenticatedUserId();
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint ?? "";

  if (endpoint) {
    const client = getSupabaseClient();
    const { error } = await client
      .from(PUSH_TABLE)
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", endpoint);
    if (error) throw toDataError(error, "delete");
  }

  // Always clear locally too, so a failed row delete cannot leave the browser
  // believing it is still subscribed.
  await subscription?.unsubscribe().catch(() => undefined);
};

/**
 * VAPID keys are handed out as base64url; the Push API wants raw bytes.
 * Implemented by hand because `atob` is not dependable across every browser and
 * service worker context this may run in.
 */
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof atob === "function" ? atob(base64) : "";
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
};

export { PUSH_TABLE, toPayload, urlBase64ToUint8Array };
