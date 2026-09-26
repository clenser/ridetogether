import type { ReactNode } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AppLoadingScreen } from "./LoadingScreen";

/**
 * Shared by every full-screen auth state (loading, unavailable, profile error,
 * OAuth callback failure) so they look identical instead of each page inventing
 * its own card.
 */
export const guardStyles = `
.rt-guard {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px 18px;
  color: #17231c;
  background:
    radial-gradient(circle at 50% 8%, rgba(185, 235, 202, .58), transparent 34%),
    linear-gradient(145deg, #f7fbf8, #eef8f1);
}
.rt-guard__card {
  width: min(520px, 100%);
  padding: 30px 26px;
  border: 1px solid #d5e6da;
  border-radius: 24px;
  background: rgba(255, 255, 255, .95);
  box-shadow: 0 24px 64px rgba(24, 77, 43, .12);
  text-align: center;
}
.rt-guard__icon {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
  border-radius: 19px;
  color: #fff;
  background: linear-gradient(145deg, #159447, #0c7436);
  box-shadow: 0 14px 30px rgba(5, 70, 31, .22);
}
.rt-guard__icon--warning { background: linear-gradient(145deg, #d98a25, #a9630d); }
.rt-guard__title { margin: 0 0 10px; color: #183c25; font-size: 1.4rem; letter-spacing: -.03em; }
.rt-guard__copy { margin: 0 0 20px; color: #63736a; font-size: .9rem; line-height: 1.65; }
.rt-guard__code {
  display: block;
  margin: 0 0 18px;
  padding: 11px 13px;
  border: 1px solid #dce8df;
  border-radius: 12px;
  color: #345343;
  background: #f5f9f6;
  font-size: .74rem;
  text-align: left;
  overflow-wrap: anywhere;
}
.rt-guard__code code { font-family: inherit; font-weight: 750; }
.rt-guard__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.rt-guard__button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  font: inherit;
  font-size: .82rem;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  transition: background .18s ease, border-color .18s ease, transform .18s ease;
}
.rt-guard__button--primary { color: #fff; background: #159447; box-shadow: 0 9px 20px rgba(21, 148, 71, .2); }
.rt-guard__button--primary:hover { background: #10813b; transform: translateY(-1px); }
.rt-guard__button--secondary { border-color: #cfe0d5; color: #345343; background: #fff; }
.rt-guard__button--secondary:hover { border-color: #a8cfb5; background: #f1f9f3; }
[data-theme="dark"] .rt-guard {
  color: #eef7f1;
  background: radial-gradient(circle at 50% 8%, rgba(39, 102, 62, .4), transparent 34%), linear-gradient(145deg, #101712, #142219);
}
[data-theme="dark"] .rt-guard__card { border-color: #2b3a30; background: rgba(23, 33, 26, .96); box-shadow: 0 24px 64px rgba(0, 0, 0, .25); }
[data-theme="dark"] .rt-guard__title { color: #eef7f1; }
[data-theme="dark"] .rt-guard__copy { color: #a6b5ac; }
[data-theme="dark"] .rt-guard__code { border-color: #34463a; color: #a6b5ac; background: #1b271f; }
[data-theme="dark"] .rt-guard__button--secondary { border-color: #3b4e41; color: #eef7f1; background: #1a251e; }
`;

/**
 * Copy for a misconfigured deployment, deliberately free of environment
 * variable names, file paths and vendor names. This screen is shown to whoever
 * opens the app, which may not be the person who deployed it, so the actionable
 * detail lives in the server logs and the deployment checklist instead.
 */
const UNAVAILABLE_COPY: Record<string, string> = {
  "missing-url": "The service address is missing.",
  "missing-key": "The public access key is missing.",
  "placeholder-url": "The service address is still the example value.",
  "placeholder-key": "The public access key is still the example value.",
  "invalid-url": "The service address is not valid.",
  "unsafe-key": "The configured key is not a public key.",
};

/**
 * Shown only while the app knows nothing yet: the initial session bootstrap, or
 * a first profile load for a user with no prior answer. Branded logo + spinner,
 * no copy. Never rendered for a token refresh, tab resume, profile refetch,
 * realtime update or route change.
 */
export function AuthLoadingScreen() {
  return <AppLoadingScreen label="Loading RideTogether" />;
}

export function SupabaseUnavailableScreen() {
  const { configIssue } = useAuth();
  const detail = configIssue
    ? UNAVAILABLE_COPY[configIssue]
    : "RideTogether could not reach its sign-in service.";

  return (
    <section className="rt-guard" aria-labelledby="rt-guard-unavailable">
      <style>{guardStyles}</style>
      <div className="rt-guard__card">
        <span className="rt-guard__icon rt-guard__icon--warning" aria-hidden="true">
          <ShieldAlert size={30} />
        </span>
        <h1 className="rt-guard__title" id="rt-guard-unavailable">We could not start RideTogether</h1>
        <p className="rt-guard__copy">
          The sign-in service is not available right now, so there is no way to confirm who you are. This
          usually clears on its own, so please try again in a moment.
        </p>
        <p className="rt-guard__copy">{detail}</p>
        <div className="rt-guard__actions">
          <Link className="rt-guard__button rt-guard__button--secondary" to="/login">
            Go to sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

export function RequireAuth() {
  const { isLoading, isAuthenticated, isAvailable } = useAuth();
  const location = useLocation();

  if (!isAvailable) return <SupabaseUnavailableScreen />;
  // Only the startup bootstrap shows this. A background token refresh keeps
  // `isAuthenticated` true, so the current route stays mounted.
  if (isLoading) return <AuthLoadingScreen />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequireCompleteProfile() {
  const {
    isLoading,
    isAuthenticated,
    isAvailable,
    profileStatus,
    profileSettled,
    profileComplete,
    profileError,
    reloadProfile,
  } = useAuth();

  if (!isAvailable) return <SupabaseUnavailableScreen />;
  if (isLoading) return <AuthLoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // A *first* profile load blocks, because there is genuinely nothing to show
  // yet. A background `refreshing` keeps the previous answer on screen and stays
  // settled, so neither a tab resume nor a token refresh replaces the page.
  if (!profileSettled && profileStatus === "loading") {
    return <AuthLoadingScreen />;
  }

  // Reachable only when there is no previous answer to fall back on, so this
  // is a genuine startup failure rather than a background blip. The stored
  // profile is never discarded because of it.
  if (profileStatus === "error" && !profileComplete) {
    return (
      <section className="rt-guard" aria-labelledby="rt-guard-profile-error">
        <style>{guardStyles}</style>
        <div className="rt-guard__card">
          <span className="rt-guard__icon rt-guard__icon--warning" aria-hidden="true">
            <ShieldAlert size={30} />
          </span>
          <h1 className="rt-guard__title" id="rt-guard-profile-error">We could not load your profile</h1>
          <p className="rt-guard__copy">
            Your details are safe, we just could not fetch them right now. Check your connection and try
            again.
          </p>
          {profileError ? <p className="rt-guard__copy">{profileError}</p> : null}
          <div className="rt-guard__actions">
            <button className="rt-guard__button rt-guard__button--primary" type="button" onClick={() => void reloadProfile()}>
              <RefreshCw size={16} /> Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Only a confirmed-incomplete profile sends the user to the completion form.
  if (!profileComplete) {
    return <Navigate to="/complete-profile" replace />;
  }
  return <Outlet />;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isAvailable } = useAuth();

  if (!isAvailable) return <SupabaseUnavailableScreen />;
  if (isLoading) return <AuthLoadingScreen />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}
