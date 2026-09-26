import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Smartphone } from "lucide-react";
import {
  getPushState,
  isPushConfigured,
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

/**
 * Real Web Push opt-in.
 *
 * The browser's permission prompt may only be raised from a user gesture, so
 * nothing here runs on mount: the state is read, never requested, until this
 * toggle is switched on. Turning it off removes both the service-worker
 * subscription and its `push_subscriptions` row, so a member who opted out
 * stops being a delivery target everywhere rather than only on this screen.
 *
 * What it deliberately does *not* do is claim push works. A subscription row
 * proves the browser was willing, not that anything is listening, so the copy
 * below is driven by both halves: this device's state and the server's. Until the
 * server is wired, the honest sentence is that alerts are queued but not
 * delivered - anything stronger would be a promise the deployment cannot keep.
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

  const handleChange = async (next: boolean) => {
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
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not update push notifications.");
      // The stored preference follows reality, not the other way round.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // The browser is the source of truth, not the local preference: a member can
  // revoke permission in browser settings while this page is open.
  const active = state === "subscribed" ? true : state === "denied" ? false : checked;
  const subscribed = state === "subscribed";

  // Three distinct claims, so the screen never states more than it knows.
  let description = "Get a device alert for booking requests, confirmations and new messages.";
  let note: "on" | "queued" | null = null;

  if (!supported) {
    description = "This browser does not support push notifications. In-app updates still work.";
  } else if (state === "denied") {
    description = "Blocked in your browser settings. Re-allow notifications for this site, then switch this on again.";
  } else if (!configured) {
    description = "Push is not available in this deployment yet. In-app updates still work.";
  } else if (subscribed && !delivered) {
    description = "This device is subscribed, but push delivery is not switched on for this deployment yet.";
    note = "queued";
  } else if (subscribed) {
    description = "This device will receive ride and booking alerts even when the app is closed.";
    note = "on";
  }

  const disabled = busy || !supported || !configured || state === "denied";

  return (
    <div className="rt-setting-toggle-group">
      <label className="rt-setting-toggle" htmlFor="rt-push-notifications">
        <span className="rt-setting-toggle-icon"><Smartphone size={17} /></span>
        <span className="rt-setting-toggle-copy">
          <strong>Push updates</strong>
          <span>{busy ? "Working…" : description}</span>
        </span>
        <span className="rt-switch">
          <input
            id="rt-push-notifications"
            type="checkbox"
            checked={active}
            disabled={disabled}
            onChange={(event) => void handleChange(event.target.checked)}
          />
          <span className="rt-switch-track" />
        </span>
      </label>
      {error ? (
        <p className="rt-setting-toggle-note rt-setting-toggle-note--error" role="alert">
          <AlertCircle size={13} /> {error}
        </p>
      ) : null}
      {!error && note === "on" ? (
        <p className="rt-setting-toggle-note">
          <CheckCircle2 size={13} /> Push is on for this device.
        </p>
      ) : null}
      {!error && note === "queued" ? (
        // Deliberately not a confirmation: the subscription is saved, but nothing
        // is being sent, so this must not read as "enabled".
        <p className="rt-setting-toggle-note rt-setting-toggle-note--error" role="status">
          <LoaderCircle size={13} /> Subscribed on this device, but delivery is unavailable. Alerts will arrive once the server is set up.
        </p>
      ) : null}
    </div>
  );
}

export default PushNotificationToggle;
