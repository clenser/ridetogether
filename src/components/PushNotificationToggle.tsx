import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Smartphone } from "lucide-react";
import {
  getPushState,
  isPushConfigured,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from "../repositories/pushRepository";

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
 */
export function PushNotificationToggle({ checked, onChange }: PushNotificationToggleProps) {
  const [state, setState] = useState<PushSupport>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await getPushState());
  }, []);

  useEffect(() => {
    // Read-only: getPushState never asks for permission.
    void refresh();
  }, [refresh]);

  const supported = isPushSupported();
  const configured = isPushConfigured();

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

  let description = "Get a device alert for booking requests, confirmations and new messages.";
  if (!supported) {
    description = "This browser does not support push notifications. In-app updates still work.";
  } else if (state === "denied") {
    description = "Blocked in your browser settings. Re-allow notifications for this site, then switch this on again.";
  } else if (!configured) {
    description = "Not configured for this deployment yet. Add VITE_VAPID_PUBLIC_KEY to enable.";
  } else if (state === "subscribed") {
    description = "This device will receive ride and booking alerts even when the app is closed.";
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
      {!error && state === "subscribed" ? (
        <p className="rt-setting-toggle-note">
          <CheckCircle2 size={13} /> Push is on for this device.
        </p>
      ) : null}
    </div>
  );
}

export default PushNotificationToggle;
