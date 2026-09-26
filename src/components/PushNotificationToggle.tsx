import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BellRing, CheckCircle2, LoaderCircle, RotateCw, ShieldAlert, Smartphone } from "lucide-react";
import {
  getPushState,
  isPushConfigured,
  isPushServiceWorkerControlling,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from "../repositories/pushRepository";
import {
  getPushServiceStatus,
  isPushDeliveryWired,
  type PushServiceStatus,
} from "../repositories/pushStatusRepository";

interface PushNotificationToggleProps {
  /** Mirrored into the local preferences object so Settings stays the one source. */
  checked: boolean;
  onChange: (value: boolean) => void;
}

/** The one sentence shown under the switch, per state. */
const describe = (state: PushSupport, supported: boolean, configured: boolean, busy: boolean) => {
  if (busy) return "Working…";
  if (!supported) return "This browser cannot show notifications. In-app updates still work.";
  if (state === "unconfigured" || !configured) {
    return "Push is not available in this deployment yet. In-app updates still work.";
  }
  if (state === "denied") {
    return "Blocked in your browser settings. Re-allow notifications for this site, then press Enable notifications again.";
  }
  if (state === "subscribed") {
    return "This device will receive ride and booking alerts even when the app is closed.";
  }
  if (state === "granted") {
    return "Your browser allows notifications, but this device is not registered yet. Press Enable notifications to finish.";
  }
  if (state === "unknown") {
    return "RideTogether's notification service has not started on this device yet. Reload the app, then try again.";
  }
  return "Get a device alert for booking requests, confirmations and new messages.";
};

/**
 * Real Web Push opt-in.
 *
 * The browser's permission prompt may only be raised from a user gesture, so
 * nothing here runs on mount: the state is read, never requested, until the
 * member presses the switch or the Enable button. Turning it off removes both
 * the service-worker subscription and its `push_subscriptions` row, so a member
 * who opted out stops being a delivery target everywhere rather than only on
 * this screen.
 *
 * There is a separate button as well as the switch, and that is the point. A
 * switch that is greyed out tells a member nothing about *why*, and the states
 * that actually need fixing - permission granted with no subscription, worker
 * not started, subscription no longer deliverable - are exactly the ones where a
 * disabled switch left them with no way forward. The status lines below say which
 * of those they are in, and the button always offers the next action.
 *
 * What it deliberately does *not* do is claim push works. A subscription row
 * proves the browser was willing, not that anything is listening, so the copy
 * below is driven by both halves: this device's state and the server's.
 */
export function PushNotificationToggle({ checked, onChange }: PushNotificationToggleProps) {
  const [state, setState] = useState<PushSupport>("unknown");
  const [service, setService] = useState<PushServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await getPushState());
    setService(await getPushServiceStatus());
  }, []);

  useEffect(() => {
    // Read-only: getPushState never asks for permission.
    void refresh();
  }, [refresh]);

  const supported = isPushSupported();
  const configured = isPushConfigured();
  const delivered = isPushDeliveryWired(service);
  const controlling = isPushServiceWorkerControlling();

  const run = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (next) {
        await subscribeToPush();
      } else {
        await unsubscribeFromPush();
      }
      onChange(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not update push notifications.");
      // The stored preference follows reality, not the other way round.
      onChange(state === "subscribed");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  // The browser is the source of truth, not the local preference: a member can
  // revoke permission in browser settings while this page is open. A stored "on"
  // with no subscription behind it is not enabled, so it never renders as on.
  const subscribed = state === "subscribed";
  const active = subscribed || (checked && state !== "denied" && state !== "unsupported");

  const disabled = busy || !supported || !configured;

  // `unsupported`/`unconfigured` need nothing from the member; `denied` and
  // `unknown` are exactly the states where a re-read is the useful next step.
  const showEnable = supported && configured && !subscribed;
  const showRecheck = supported && configured && (state === "denied" || state === "unknown");

  return (
    <div className="rt-setting-toggle-group">
      <label className="rt-setting-toggle" htmlFor="rt-push-notifications">
        <span className="rt-setting-toggle-icon"><Smartphone size={17} /></span>
        <span className="rt-setting-toggle-copy">
          <strong>Push updates</strong>
          <span>{describe(state, supported, configured, busy)}</span>
        </span>
        <span className="rt-switch">
          <input
            id="rt-push-notifications"
            type="checkbox"
            checked={active}
            disabled={disabled}
            onChange={(event) => void run(event.target.checked)}
          />
          <span className="rt-switch-track" />
        </span>
      </label>

      {/*
        The four facts a member needs to tell a working setup from a broken one.
        Each is read from the browser or the database, never assumed.
      */}
      <ul className="rt-push-status" data-testid="push-status">
        <li>
          <span>Browser</span>
          <strong>{supported ? "Notifications supported" : "Not supported"}</strong>
        </li>
        <li>
          <span>Permission</span>
          <strong>
            {state === "denied"
              ? "Blocked"
              : state === "unknown"
                ? "Checking…"
                : typeof Notification !== "undefined" && Notification.permission === "granted"
                  ? "Allowed"
                  : "Not set"}
          </strong>
        </li>
        <li>
          <span>This device</span>
          <strong>
            {subscribed ? "Subscribed" : state === "granted" ? "Not registered yet" : "Not subscribed"}
          </strong>
        </li>
        <li>
          <span>Delivery</span>
          <strong>
            {controlling ? (delivered ? "Wired up" : "Not switched on for this deployment") : "Service not started"}
          </strong>
        </li>
      </ul>

      <div className="rt-push-actions">
        {showEnable ? (
          <button
            className="rt-settings-secondary"
            type="button"
            onClick={() => void run(true)}
            disabled={busy}
            data-testid="push-enable"
          >
            <BellRing size={14} />
            {state === "granted" ? "Finish enabling" : busy ? "Enabling…" : "Enable notifications"}
          </button>
        ) : null}
        {subscribed ? (
          <button
            className="rt-settings-secondary"
            type="button"
            onClick={() => void run(false)}
            disabled={busy}
          >
            Turn off notifications
          </button>
        ) : null}
        {showRecheck ? (
          <button
            className="rt-settings-secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RotateCw size={14} /> Check again
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rt-setting-toggle-note rt-setting-toggle-note--error" role="alert" data-testid="push-error">
          <AlertCircle size={13} /> {error}
        </p>
      ) : null}
      {!error && state === "denied" ? (
        // Deliberately an instruction rather than a retry: once an origin is
        // blocked the browser never shows the prompt again, so only the member's
        // own site settings can change this.
        <p className="rt-setting-toggle-note rt-setting-toggle-note--error" role="status">
          <ShieldAlert size={13} /> Open your browser's site settings for RideTogether, turn notifications on, then press Check again.
        </p>
      ) : null}
      {!error && subscribed && !delivered ? (
        // Not a confirmation: the subscription is saved, but nothing is being
        // sent, so this must not read as "enabled".
        <p className="rt-setting-toggle-note rt-setting-toggle-note--error" role="status">
          <LoaderCircle size={13} /> This device is registered, but push delivery is not switched on for this deployment yet.
        </p>
      ) : null}
      {!error && subscribed && delivered ? (
        <p className="rt-setting-toggle-note">
          <CheckCircle2 size={13} /> Push is on for this device.
        </p>
      ) : null}
    </div>
  );
}

export default PushNotificationToggle;
