import { CarFront, LoaderCircle } from "lucide-react";

/**
 * Loading UI, in exactly two shapes.
 *
 * `AppLoadingScreen` replaces the whole page and exists only for the initial
 * bootstrap, when neither the session nor the profile is known yet. It is
 * deliberately copy-free: a member does not need to be told about sessions,
 * profiles, tokens or the backend, so nothing technical is rendered. The
 * optional `label` is applied to the live region for assistive technology only
 * and is never shown on screen.
 *
 * `InlineRefreshIndicator` is the non-blocking form, for work that happens
 * behind an already-rendered page: a background profile refresh or a tab-resume
 * session refresh. It must never be used to gate a route.
 */

/**
 * Full-page branded loader: logo + spinner, no technical explanation.
 *
 * Only correct where the app genuinely knows nothing yet, i.e. initial startup
 * or a first profile load for a user with no prior answer.
 */
export function AppLoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="app-loading" role="status" aria-live="polite" data-testid="app-loading">
      <span className="app-loading__logo" aria-hidden="true">
        <CarFront size={32} />
      </span>
      <strong>RideTogether</strong>
      <span className="app-loading__spinner" aria-hidden="true" />
      {/* Screen-reader copy only. Kept out of the visual layout on purpose. */}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Subtle, non-blocking progress indicator for background work.
 *
 * A 2px bar pinned to the top of the viewport plus a screen-reader status. It
 * takes no layout space, so the current page stays visible and interactive
 * underneath it.
 */
export function InlineRefreshIndicator({ active, label = "Updating" }: { active: boolean; label?: string }) {
  return (
    <div className="app-refresh" data-testid="app-refresh" data-active={active ? "true" : "false"}>
      {active ? (
        <>
          <div className="app-refresh__bar" role="progressbar" aria-label={label} />
          <span className="app-refresh__dot" aria-hidden="true">
            <LoaderCircle className="spin" size={13} />
          </span>
          <span className="sr-only" role="status" aria-live="polite">
            {label}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Small inline spinner for a specific pending action. Use this instead of
 * blocking the page when one control is waiting on the network.
 */
export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-spinner" role={label ? "status" : undefined}>
      <LoaderCircle className="spin" size={16} aria-hidden="true" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
