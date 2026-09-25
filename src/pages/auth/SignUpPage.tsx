import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, MailCheck, UserPlus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { MIN_PASSWORD_LENGTH, validateEmail, validateFullName, validatePassword } from "../../services/auth";
import { AuthShell } from "./AuthShell";

type FieldName = "fullName" | "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

export function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const clearFieldError = (key: FieldName) => {
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(null);
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const nameError = validateFullName(fullName);
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    if (nameError) next.fullName = nameError;
    if (emailError) next.email = emailError;
    if (passwordError) next.password = passwordError;
    if (confirmPassword !== password) next.confirmPassword = "Passwords do not match.";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !validate()) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await signUp({ fullName, email, password });
      if (result.needsEmailConfirmation) {
        setAwaitingConfirmation(true);
        return;
      }
      navigate("/complete-profile", { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not create your account.");
    } finally {
      setSubmitting(false);
    }
  };

  if (awaitingConfirmation) {
    return (
      <AuthShell
        eyebrow="Almost there"
        title="Confirm your email"
        subtitle="We sent a confirmation link to your inbox. Open it, then log in."
      >
        <div className="rt-auth__done">
          <span className="rt-auth__done-icon" aria-hidden="true">
            <MailCheck size={30} />
          </span>
          <p className="rt-auth__done-title">Check your inbox</p>
          <p className="rt-auth__done-copy">
            Your account was created. Confirm <strong>{email}</strong> to activate it, then sign in to
            finish your profile.
          </p>
          <Link className="rt-auth__submit" to="/login">
            Go to log in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Join the community"
      title="Create your account"
      subtitle="One account lets you offer rides, request seats, and stay in touch with your co-riders."
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="rt-auth__body" style={{ padding: 0, gap: 16 }}>
          {formError ? (
            <p className="rt-auth__notice rt-auth__notice--error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              {formError}
            </p>
          ) : null}

          <label className="rt-auth__field">
            <span className="rt-auth__label">Full name</span>
            <input
              className="rt-auth__input"
              type="text"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                clearFieldError("fullName");
              }}
              autoComplete="name"
              autoFocus
              placeholder="Your full name"
              aria-invalid={Boolean(errors.fullName)}
            />
            {errors.fullName ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.fullName}
              </span>
            ) : null}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label">Email address</span>
            <input
              className="rt-auth__input"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearFieldError("email");
              }}
              autoComplete="email"
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
            <span className="rt-auth__label">Password</span>
            <input
              className="rt-auth__input"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearFieldError("password");
              }}
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.password}
              </span>
            ) : (
              <span className="rt-auth__hint">Use at least {MIN_PASSWORD_LENGTH} characters with one letter and one number.</span>
            )}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label">Confirm password</span>
            <input
              className="rt-auth__input"
              type="password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                clearFieldError("confirmPassword");
              }}
              autoComplete="new-password"
              placeholder="Repeat your password"
              aria-invalid={Boolean(errors.confirmPassword)}
            />
            {errors.confirmPassword ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.confirmPassword}
              </span>
            ) : null}
          </label>

          <button className="rt-auth__submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" /> Creating account…
              </>
            ) : (
              <>
                <UserPlus size={17} aria-hidden="true" /> Create account
              </>
            )}
          </button>
        </div>
      </form>

      <p className="rt-auth__notice">
        <Info size={16} aria-hidden="true" />
        Your profile record is created automatically by the database when your account is created.
      </p>

      <p className="rt-auth__foot">
        Already have an account?{" "}
        <Link className="rt-auth__link" to="/login">
          Log in
        </Link>
      </p>
      <p className="rt-auth__legal">
        <CheckCircle2 size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Passwords are handled by Supabase Auth and are never stored by this app.
      </p>
    </AuthShell>
  );
}

export default SignUpPage;
