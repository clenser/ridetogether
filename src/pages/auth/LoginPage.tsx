import { useState, type FormEvent } from "react";
import { AlertCircle, Info, LoaderCircle, LogIn } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { validateEmail, validatePassword } from "../../services/auth";
import { AuthShell } from "./AuthShell";
import { GoogleSignInButton } from "./GoogleSignInButton";

type FieldErrors = Partial<Record<"email" | "password", string>>;

interface LocationState {
  from?: string;
  /**
   * One-off message passed by a redirect, currently the "your password has been
   * updated" confirmation from the reset flow. It takes precedence over the
   * session notice, which would otherwise report the sign-out that the reset
   * flow performs on its way here.
   */
  notice?: string;
}

export function LoginPage() {
  const { signIn, sessionNotice, clearSessionNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const state = location.state as LocationState | null;
  const redirectTo = state?.from ?? "/";

  /**
   * A notice handed over by a redirect is copied into state on arrival, then
   * dismissed locally. Reading it straight from `location.state` would keep it on
   * screen while the member types, because clearing the session notice does not
   * touch the location.
   */
  const [stateNotice, setStateNotice] = useState<string | null>(state?.notice ?? null);
  const notice = stateNotice ?? sessionNotice;

  const updateField = (key: keyof FieldErrors, value: string) => {
    if (key === "email") setEmail(value);
    if (key === "password") setPassword(value);
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(null);
    setStateNotice(null);
    clearSessionNotice();
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const emailError = validateEmail(email);
    const passwordError = password ? validatePassword(password) : null;
    if (emailError) next.email = emailError;
    if (passwordError) next.password = passwordError;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !validate()) return;

    setSubmitting(true);
    setFormError(null);
    try {
      await signIn({ email, password });
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not log you in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to RideTogether"
      subtitle="Sign in with your email to find rides, offer seats, and manage your trips."
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="rt-auth__body" style={{ padding: 0, gap: 16 }}>
          {notice ? (
            <p className="rt-auth__notice" role="status">
              <Info size={16} aria-hidden="true" />
              {notice}
            </p>
          ) : null}

          {formError ? (
            <p className="rt-auth__notice rt-auth__notice--error" role="alert" data-testid="login-error">
              <AlertCircle size={16} aria-hidden="true" />
              {formError}
            </p>
          ) : null}

          <label className="rt-auth__field">
            <span className="rt-auth__label">Email address</span>
            <input
              className="rt-auth__input"
              data-testid="login-email"
              type="email"
              value={email}
              onChange={(event) => updateField("email", event.target.value)}
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.email}
              </span>
            ) : null}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label-row">
              <span className="rt-auth__label">Password</span>
              <Link className="rt-auth__label-link" to="/forgot-password" data-testid="login-forgot-password">
                Forgot password?
              </Link>
            </span>
            <input
              className="rt-auth__input"
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(event) => updateField("password", event.target.value)}
              autoComplete="current-password"
              placeholder="Your password"
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.password}
              </span>
            ) : null}
          </label>

          <button className="rt-auth__submit" data-testid="login-submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" /> Logging in…
              </>
            ) : (
              <>
                <LogIn size={17} aria-hidden="true" /> Log in
              </>
            )}
          </button>

          <GoogleSignInButton mode="signin" onError={setFormError} />
        </div>
      </form>

      <p className="rt-auth__foot">
        New to RideTogether?{" "}
        <Link className="rt-auth__link" to="/signup">
          Create an account
        </Link>
      </p>
      <p className="rt-auth__legal">
        Passwords are handled by Supabase Auth and are never stored by this app.
      </p>    </AuthShell>
  );
}

export default LoginPage;
