import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, MailCheck, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { sendPasswordResetEmail, validateEmail } from "../../services/auth";
import { AuthShell } from "./AuthShell";

type FieldErrors = Partial<Record<"email", string>>;

/**
 * Step one of password recovery: ask for the account's email address.
 *
 * The address lives in this component's state for exactly as long as the form is
 * on screen. No password, token or reset link is ever held here - Supabase sends
 * the email and keeps the single-use token.
 */
export function ForgotPasswordPage() {
  const { isAvailable } = useAuth();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const emailError = validateEmail(email);
    if (emailError) {
      setErrors({ email: emailError });
      return;
    }

    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(email);
      setSentTo(email.trim().toLowerCase());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not send that reset email.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        eyebrow="Almost there"
        title="Check your inbox"
        subtitle="We sent you a link to choose a new password."
      >
        <div className="rt-auth__done">
          <span className="rt-auth__done-icon" aria-hidden="true">
            <MailCheck size={30} />
          </span>
          <p className="rt-auth__done-title">Reset link sent</p>
          <p className="rt-auth__done-copy">
            Open the link we sent to <strong>{sentTo}</strong> and you will be able to set a new
            password. The link works once and expires after a short while.
          </p>
          <p className="rt-auth__notice">
            <Info size={16} aria-hidden="true" />
            Nothing arrived? Check your spam folder, or send the link again.
          </p>
          <button
            className="rt-auth__submit"
            type="button"
            disabled={submitting}
            onClick={() => {
              setSentTo(null);
            }}
          >
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" /> Sending…
              </>
            ) : (
              <>
                <Send size={17} aria-hidden="true" /> Use a different email
              </>
            )}
          </button>
          <Link className="rt-auth__submit" to="/login">
            Back to log in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Forgot your password?"
      subtitle="Enter the email you signed up with and we will send you a link to set a new one."
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="rt-auth__body" style={{ padding: 0, gap: 16 }}>
          {!isAvailable ? (
            <p className="rt-auth__notice rt-auth__notice--error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              RideTogether is not connected to Supabase yet, so password recovery is unavailable.
            </p>
          ) : null}

          {formError ? (
            <p
              className="rt-auth__notice rt-auth__notice--error"
              role="alert"
              data-testid="forgot-password-error"
            >
              <AlertCircle size={16} aria-hidden="true" />
              {formError}
            </p>
          ) : null}

          <label className="rt-auth__field">
            <span className="rt-auth__label">Email address</span>
            <input
              className="rt-auth__input"
              data-testid="forgot-password-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setErrors({});
                setFormError(null);
              }}
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              disabled={submitting}
            />
            {errors.email ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.email}
              </span>
            ) : null}
          </label>

          <button
            className="rt-auth__submit"
            data-testid="forgot-password-submit"
            type="submit"
            disabled={submitting || !isAvailable}
          >
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" /> Sending reset link…
              </>
            ) : (
              <>
                <Send size={17} aria-hidden="true" /> Email me a reset link
              </>
            )}
          </button>
        </div>
      </form>

      <p className="rt-auth__foot">
        Remembered it?{" "}
        <Link className="rt-auth__link" to="/login">
          Back to log in
        </Link>
      </p>
      <p className="rt-auth__legal">
        <CheckCircle2 size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Passwords are handled by Supabase Auth and are never stored by this app.
      </p>
    </AuthShell>
  );
}

export default ForgotPasswordPage;
