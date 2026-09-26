import { RefreshCw, ShieldAlert } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { AuthLoadingScreen, SupabaseUnavailableScreen, guardStyles } from "../../components/AuthGuards";
import { useAuth } from "../../context/AuthContext";

/**
 * The landing route for OAuth and email-confirmation returns.
 *
 * Supabase returns the session in the URL fragment and the client exchanges it
 * during startup (`detectSessionInUrl`), which fires the auth-state listener
 * that `AuthContext` is subscribed to. So this page has nothing to parse: it
 * waits for the auth state to settle and then hands over to the normal routing.
 *
 * Handing over to `/` rather than deciding the destination here is deliberate.
 * The `RequireCompleteProfile` guard on `/` already knows the difference: a
 * member with a complete profile lands on Home, and a new or incomplete member
 * is sent to Complete Profile. Duplicating that decision here would give two
 * places to keep in sync.
 */
export function AuthCallbackPage() {
  const { isAvailable, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  if (!isAvailable) return <SupabaseUnavailableScreen />;

  // The session (or the absence of one) is still being determined.
  if (isLoading) return <AuthLoadingScreen />;

  if (isAuthenticated) return <Navigate to="/" replace />;

  // No session after the exchange: the provider sent the member back without a
  // usable grant. Surface the provider's own explanation when it sent one.
  const description = params.get("error_description")?.trim();
  const detail = description || params.get("error")?.trim() || "";

  return (
    <section className="rt-guard" aria-labelledby="rt-guard-callback">
      <style>{guardStyles}</style>
      <div className="rt-guard__card">
        <span className="rt-guard__icon rt-guard__icon--warning" aria-hidden="true">
          <ShieldAlert size={30} />
        </span>
        <h1 className="rt-guard__title" id="rt-guard-callback">We could not complete your sign-in</h1>
        <p className="rt-guard__copy">
          The link that brought you here is no longer valid. This usually means it was already used
          or the provider declined the request.
        </p>
        {detail ? <span className="rt-guard__code">{detail}</span> : null}
        <div className="rt-guard__actions">
          <Link className="rt-guard__button rt-guard__button--primary" to="/login">
            <RefreshCw size={16} /> Try signing in again
          </Link>
          <Link className="rt-guard__button rt-guard__button--secondary" to="/signup">
            Create an account
          </Link>
        </div>
      </div>
    </section>
  );
}

export default AuthCallbackPage;
