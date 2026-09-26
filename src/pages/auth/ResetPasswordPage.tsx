import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Info, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { MIN_PASSWORD_LENGTH, updatePassword, validatePassword } from "../../services/auth";
import { AuthShell } from "./AuthShell";

type FieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

/**
 * Step two of password recovery: set a new password using the session that the
 * emailed link established.
 *
 * Supabase JS exchanges the single-use token in the link's URL fragment during
 * client startup, so "is there a session" is the whole validity check. An
 * expired or already-used link simply has no session, which is reported as an
 * expired link with a way to request a new one.
 *
 * The new password is passed straight to Supabase and then dropped. It is never
 * written to storage, a query string, a log line or any repository.
 */
export function ResetPasswordPage() {
  const { isAvailable, isLoading, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const passwordError = validatePassword(password);
    const confirmError = password === confirmPassword ? null : "Passwords do not match.";
    if (passwordError) next.password = passwordError;
    if (confirmError) next.confirmPassword = confirmError;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !validate()) return;

    setSubmitting(true);
    setFormError(null);
    try {
      await updatePassword(password);
      // Sign out so the new password is what proves the account still works,
      // which is the last step of the recovery journey. A failure here is not a
      // failed reset: the password is already changed.
      try {
        await signOut();
      } catch {
        setSaved(true);
        setSubmitting(false);
        return;
      }
      setPassword("");
      setConfirmPassword("");
      navigate("/login", {
        replace: true,
        state: { notice: "Your password has been updated. Log in with your new password." },
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not update your password.");
      setSubmitting(false);
    }
  };

  if (!isAvailable) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="Password recovery unavailable"
        subtitle="RideTogether cannot reach its sign-in service."
      >
        <div className="rt-auth__done">
          <span className="rt-auth__done-icon" aria-hidden="true">
            <AlertCircle size={30} />
          </span>
          <p className="rt-auth__done-title">Sign-in service unavailable</p>
          <p className="rt-auth__done-copy">
            We could not verify your reset link. Please request a new one and try again.
          </p>
          <Link className="rt-auth__submit" to="/forgot-password">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  // Still exchanging the token from the link for a session.
  if (isLoading) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="Checking your reset link"
        subtitle="One moment while we confirm the link is still valid."
      >
        <div className="rt-auth__done">
          <span className="rt-auth__done-icon" aria-hidden="true">
            <LoaderCircle className="spin" size={30} />
          </span>
          <p className="rt-auth__done-title" role="status">
            Opening your reset link…
          </p>
        </div>
      </AuthShell>
    );
  }

  // The link is expired, already used, or was opened on a different device.
  if (!isAuthenticated) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="This link is no longer valid"
        subtitle="Reset links work once and expire after a short while."
      >
        <div className="rt-auth__done">
          <span className="rt-auth__done-icon" aria-hidden="true">
            <AlertCircle size={30} />
          </span>
          <p className="rt-auth__done-title">Link expired or already used</p>
          <p className="rt-auth__done-copy">
            Request a fresh link and open it from the same browser you used to request it.
          </p>
          <Link className="rt-auth__submit" data-testid="reset-password-request-new" to="/forgot-password">
            Send me a new link
          </Link>
          <Link className="rt-auth__submit" to="/login">
            Back to log in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (saved) {
    return (
      <AuthShell
        eyebrow="All set"
        title="Password updated"
        subtitle="We could not sign you out automatically."
      >
        <div className="rt-auth__done">
          <span className="rt-auth__done-icon" aria-hidden="true">
            <ShieldCheck size={30} />
          </span>
          <p className="rt-auth__done-title">Your new password is active</p>
          <p className="rt-auth__done-copy">
            You are still signed in on this device. Sign out, then log in with your new password.
          </p>
          <Link className="rt-auth__submit" to="/">
            Go to your account
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Choose a new password"
      subtitle="Pick something you have not used here before. You will sign in with it straight after."
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="rt-auth__body" style={{ padding: 0, gap: 16 }}>
          {formError ? (
            <p
              className="rt-auth__notice rt-auth__notice--error"
              role="alert"
              data-testid="reset-password-error"
            >
              <AlertCircle size={16} aria-hidden="true" />
              {formError}
            </p>
          ) : null}

          <label className="rt-auth__field">
            <span className="rt-auth__label">New password</span>
            <input
              className="rt-auth__input"
              data-testid="reset-password-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setErrors((current) => ({ ...current, password: undefined }));
                setFormError(null);
              }}
              autoComplete="new-password"
              autoFocus
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              aria-invalid={Boolean(errors.password)}
              disabled={submitting}
            />
            {errors.password ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.password}
              </span>
            ) : (
              <span className="rt-auth__hint">
                Use at least {MIN_PASSWORD_LENGTH} characters with one letter and one number.
              </span>
            )}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label">Confirm new password</span>
            <input
              className="rt-auth__input"
              data-testid="reset-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setErrors((current) => ({ ...current, confirmPassword: undefined }));
                setFormError(null);
              }}
              autoComplete="new-password"
              placeholder="Repeat your new password"
              aria-invalid={Boolean(errors.confirmPassword)}
              disabled={submitting}
            />
            {errors.confirmPassword ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.confirmPassword}
              </span>
            ) : null}
          </label>

          <button
            className="rt-auth__submit"
            data-testid="reset-password-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" /> Updating password…
              </>
            ) : (
              <>
                <KeyRound size={17} aria-hidden="true" /> Update password
              </>
            )}
          </button>

          <p className="rt-auth__notice">
            <Info size={16} aria-hidden="true" />
            Your new password is sent straight to our sign-in service. This app never stores it.
          </p>
        </div>
      </form>

      <p className="rt-auth__legal">
        <CheckCircle2 size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
        After updating, you will be returned to the login screen to confirm your new password.
      </p>
    </AuthShell>
  );
}

export default ResetPasswordPage;
