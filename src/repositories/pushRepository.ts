import { ensureActiveServiceWorker, isPageControlled } from "../services/pwa";
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
 *
 * Nothing in here asks the browser for permission on its own. `getPushState` is
 * read-only and safe to call on mount; the single permission request lives in
 * `subscribeToPush`, which is only ever reached from a member's tap.
 */

const PUSH_TABLE = "push_subscriptions";

/** Raw subscription keys, as returned by `PushSubscription.toJSON()`. */
interface PushSubscriptionKeys {
  p256dh?: string;
  auth?: string;
}

/**
 * Everything this screen needs to describe, truthfully, what will and will not
 * deliver. The states are distinct on purpose: "your browser said no" and
 * "your browser said yes but this device has no subscription" are different
 * problems with different fixes, and collapsing them into one "off" is what
 * left members with no way to repair a broken setup.
 */
export type PushSupport =
  /** No service worker, PushManager or Notification in this browser. */
  | "unsupported"
  /** The browser is fine, but this build shipped without a VAPID public key. */
  | "unconfigured"
  /** Blocked in browser settings. Only the browser can undo this. */
  | "denied"
  /** Askable: permission has not been decided yet. */
  | "prompt"
  /** Permission granted, but this device has no usable subscription yet. */
  | "granted"
  /** Permission granted and a usable subscription is stored. */
  | "subscribed"
  /** The state could not be read at all (no active worker, for example). */
  | "unknown";

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

/**
 * The registration push actually runs on.
 *
 * `PushManager` only exists on an *active* worker, so a registration that is
 * still installing cannot deliver anything. This registers or repairs as needed
 * and returns `null` - rather than waiting forever on `serviceWorker.ready`,
 * which never rejects - so the opt-in flow can report a real failure.
 */
const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return ensureActiveServiceWorker();
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
 * True when this page is controlled by a worker.
 *
 * A registered worker does not mean a controlling one: on the very first visit
 * the page is uncontrolled until `skipWaiting()` + `clients.claim()` land, and a
 * controlled page is what a push subscription is actually attached to.
 */
export const isPushServiceWorkerControlling = (): boolean => isPushSupported() && isPageControlled();

/** `PushSubscriptionOptions.applicationServerKey` is a `BufferSource`; normalise it. */
const toKeyBytes = (value: BufferSource | null | undefined): Uint8Array | null => {
  if (!value) return null;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(value as ArrayBuffer);
};

/**
 * Whether a stored subscription can still be delivered to.
 *
 * Two things make a subscription useless while still looking healthy: missing
 * keys, and a VAPID key that is not the one this deployment signs with. The
 * second is the nastier one - `subscribe()` happily hands back the old
 * subscription, the row is stored, the UI reports push is on, and then *every*
 * send is rejected by the push service for an unknown `k=` value. Nothing ever
 * appears on the phone and nothing anywhere reports an error, which is exactly
 * the failure this replaces.
 */
const isUsableSubscription = (subscription: PushSubscription, expectedKey: Uint8Array): boolean => {
  try {
    toPayload(subscription);
  } catch {
    return false;
  }

  const storedKey = toKeyBytes(subscription.options?.applicationServerKey);
  // `null` means this browser does not expose the key at all, which is not
  // evidence of a mismatch. Only a definite difference counts as a mismatch.
  if (!storedKey) return true;
  if (storedKey.byteLength !== expectedKey.byteLength) return false;
  for (let index = 0; index < expectedKey.byteLength; index += 1) {
    if (storedKey[index] !== expectedKey[index]) return false;
  }
  return true;
};

/** Turns a `pushManager.subscribe()` rejection into something a member can act on. */
const subscribeFailure = (error: unknown): DataError => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return new DataError(
      "Notifications are blocked for RideTogether. Turn them on in your browser's site settings for this site, then try again.",
      "forbidden",
      error,
    );
  }
  if (name === "InvalidAccessError") {
    return new DataError(
      "This browser rejected RideTogether's push key, so push cannot be set up here.",
      "invalid",
      error,
    );
  }
  if (import.meta.env?.DEV) console.warn("[push] subscribe failed", error);
  return new DataError(
    "This device could not start receiving push notifications. Please try again.",
    "invalid",
    error,
  );
};

const NO_ACTIVE_WORKER =
  "RideTogether's notification service could not start on this device. Reload the app, then try again.";

/**
 * Reports the current push state so the UI can label its control honestly
 * without prompting the browser for permission on page load.
 *
 * Read-only by construction: it inspects, it never asks.
 */
export const getPushState = async (): Promise<PushSupport> => {
  if (!isPushSupported()) return "unsupported";
  if (!getVapidPublicKey()) return "unconfigured";
  if (Notification.permission === "denied") return "denied";

  const registration = await getRegistration();
  if (!registration) return "unknown";

  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      const expectedKey = urlBase64ToUint8Array(getVapidPublicKey());
      return isUsableSubscription(existing, expectedKey) ? "subscribed" : "granted";
    }
  } catch (error) {
    if (import.meta.env?.DEV) console.warn("[push] state read failed", error);
    return "unknown";
  }

  // Permission is granted but nothing is subscribed: a real, recoverable state
  // rather than a reason to describe the feature as "off".
  return Notification.permission === "granted" ? "granted" : "prompt";
};

/**
 * Asks for permission and stores the subscription.
 *
 * The permission prompt only ever appears because a member pressed the enable
 * control - this is never called during render, on load, or after a background
 * event. It repairs rather than assumes: a missing worker is registered, a
 * worker that is not controlling yet is waited for, and an existing subscription
 * that cannot be delivered to is discarded and rebuilt.
 */
export const subscribeToPush = async (): Promise<void> => {
  if (!isPushSupported()) {
    throw new DataError("This browser cannot receive push notifications.", "invalid");
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new DataError(
      "Push notifications need a secure (https) connection to this app.",
      "invalid",
    );
  }
  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    throw new DataError("Push notifications are not configured for this deployment yet.", "invalid");
  }

  const registration = await getRegistration();
  if (!registration) throw new DataError(NO_ACTIVE_WORKER, "invalid");
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    // The browser will not prompt again for this origin, so the only way forward
    // is site settings. Say that rather than inviting another tap.
    throw new DataError(
      "Notifications are blocked for RideTogether. Turn them on in your browser's site settings for this site, then press Enable notifications again.",
      "forbidden",
    );
  }
  if (permission !== "granted") {
    throw new DataError(
      "Notification permission was not granted. Press Enable notifications again to allow it.",
      "forbidden",
    );
  }

  const expectedKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription().catch(() => null);

  // Only reuse what can still be delivered to; otherwise throw it away so the
  // next `subscribe()` mints a fresh endpoint and fresh keys.
  if (subscription && !isUsableSubscription(subscription, expectedKey)) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKey,
      });
    } catch (error) {
      throw subscribeFailure(error);
    }
  }

  const { endpoint, p256dh, auth } = toPayload(subscription);
  const userId = await getAuthenticatedUserId();
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

  // Proof, not hope. A write returning no error is not the same as a row the
  // delivery path can find, and RLS, a missing table or a dropped response all
  // look like success from here. Reading it back is what makes "push is on" a
  // statement about the database rather than about an intention.
  const { data: stored, error: readError } = await client
    .from(PUSH_TABLE)
    .select("endpoint")
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .maybeSingle();

  if (readError) throw toDataError(readError, "load");
  if (!stored) {
    throw new DataError(
      "We could not save your notification subscription, so alerts will not reach this device. Please try again.",
      "invalid",
    );
  }
};

/** Removes this browser's subscription and its stored row. */
export const unsubscribeFromPush = async (): Promise<void> => {
  const userId = await getAuthenticatedUserId();
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null) ?? null;
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
