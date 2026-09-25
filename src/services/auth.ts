import type { AuthChangeEvent, Session, User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";

export type AuthAction = "sign-in" | "sign-up" | "sign-out" | "session" | "profile";

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
}

export interface SignUpResult {
  user: SupabaseUser | null;
  session: Session | null;
  needsEmailConfirmation: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FRIENDLY_MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password combination is incorrect.",
  email_exists: "An account already exists for this email. Try logging in instead.",
  user_already_exists: "An account already exists for this email. Try logging in instead.",
  email_not_confirmed: "Confirm your email address first, then log in.",
  weak_password: "Please choose a stronger password.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  over_email_send_rate_limit: "Too many attempts. Wait a minute and try again.",
  failed_to_fetch: "We could not reach the server. Check your connection and try again.",
  network_request_failed: "We could not reach the server. Check your connection and try again.",
  "401": "Your session has expired. Please sign in again.",
  "403": "You do not have permission to do that.",
  "42501": "You do not have permission to do that.",
  "500": "Something went wrong on our side. Please try again.",
};

const MESSAGE_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/invalid format/i, "Enter a valid email address."],
  [/unable to validate email/i, "Enter a valid email address."],
  [/password should be at least/i, "Please choose a longer password."],
  [/password should contain/i, "Please choose a stronger password."],
  [/email not confirmed/i, "Confirm your email address first, then log in."],
  [/already registered|already been registered|already exists/i, "An account already exists for this email. Try logging in instead."],
  [/invalid login credentials/i, "That email and password combination is incorrect."],
  [/failed to fetch|networkerror|network request failed/i, "We could not reach the server. Check your connection and try again."],
  [/jwt expired|token expired|session expired/i, "Your session has expired. Please sign in again."],
  [/row-level security|violates row level security/i, "You do not have permission to do that."],
  [/rate limit/i, "Too many attempts. Wait a minute and try again."],
];

const GENERIC_MESSAGES: Record<AuthAction, string> = {
  "sign-in": "We could not log you in. Please try again.",
  "sign-up": "We could not create your account. Please try again.",
  "sign-out": "We could not sign you out. Please try again.",
  session: "We could not restore your session. Please sign in again.",
  profile: "We could not load your profile. Please try again.",
};

const readError = (
  error: unknown,
): { code: string; message: string; name: string; status: string } => {
  if (typeof error !== "object" || error === null) {
    return { code: "", message: "", name: "", status: "" };
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    status?: unknown;
  };
  const asString = (value: unknown): string =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  return {
    code: asString(candidate.code),
    message: asString(candidate.message),
    name: asString(candidate.name),
    status: asString(candidate.status),
  };
};

/**
 * Converts any Supabase / network failure into a short, user-facing sentence.
 * Raw database messages are never shown to the user.
 */
export const describeAuthError = (error: unknown, action: AuthAction): string => {
  if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
    return "RideTogether is not connected to Supabase yet. Add the public project URL and publishable key to your .env file.";
  }

  const { code, message, name, status } = readError(error);
  if (code && FRIENDLY_MESSAGES[code]) {
    return FRIENDLY_MESSAGES[code];
  }
  if (status && FRIENDLY_MESSAGES[status]) {
    return FRIENDLY_MESSAGES[status];
  }
  if (name === "AuthRetryableFetchError") {
    return FRIENDLY_MESSAGES["failed_to_fetch"];
  }
  for (const [pattern, friendly] of MESSAGE_HINTS) {
    if (message && pattern.test(message)) {
      return friendly;
    }
  }

  if (import.meta.env.DEV) {
    console.warn(`[auth:${action}] unmapped error`, { code, name, status, message });
  }
  return GENERIC_MESSAGES[action];
};

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const validateEmail = (value: string): string | null => {
  const email = normalizeEmail(value);
  if (!email) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
};

export const validatePassword = (value: string): string | null => {
  if (!value) return "Enter your password.";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return "Add at least one letter and one number.";
  }
  return null;
};

export const validateFullName = (value: string): string | null => {
  const name = value.trim();
  if (!name) return "Enter your full name.";
  if (name.length < 2) return "Enter at least 2 characters.";
  if (name.length > 80) return "Keep your name to 80 characters or fewer.";
  return null;
};

export const validatePhone = (value: string): string | null => {
  const phone = value.trim();
  if (!phone) return "Enter your phone number.";
  if (!/^[+\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
    return "Enter a valid phone number.";
  }
  if (phone.replace(/\D/g, "").length > 15) {
    return "Enter a valid phone number.";
  }
  return null;
};

export const signUp = async (input: SignUpInput): Promise<SignUpResult> => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: normalizeEmail(input.email),
    password: input.password,
    options: {
      // Read by the handle_new_user() trigger to seed public.profiles.
      data: { full_name: input.fullName.trim() },
    },
  });

  if (error) {
    throw new Error(describeAuthError(error, "sign-up"));
  }

  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: Boolean(data.user) && !data.session,
  };
};

export const signIn = async (input: SignInInput): Promise<Session> => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizeEmail(input.email),
    password: input.password,
  });

  if (error) {
    throw new Error(describeAuthError(error, "sign-in"));
  }
  if (!data.session) {
    throw new Error(GENERIC_MESSAGES["sign-in"]);
  }
  return data.session;
};

export const signOut = async (): Promise<void> => {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(describeAuthError(error, "sign-out"));
  }
};

/**
 * Where Google should send the browser back to.
 *
 * Derived from the current origin instead of a hard-coded deployment URL so the
 * same build works on localhost, a preview branch and production. An explicit
 * `VITE_AUTH_REDIRECT_URL` wins when set, which is what you need when the app is
 * served from a different origin than the one the user started the flow on.
 */
const resolveRedirectTo = (): string => {
  const explicit = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();
  if (explicit) return explicit;

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  if (!origin) {
    throw new Error(
      "RideTogether could not work out where to return you from Google. Set VITE_AUTH_REDIRECT_URL and try again.",
    );
  }
  return origin;
};

/**
 * Starts the Google sign-in flow.
 *
 * This does not return a session: the browser leaves the page and Supabase's
 * callback completes the exchange, which arrives back through
 * `onAuthStateChange`. Callers must not treat this as a completed sign-in.
 */
export const signInWithGoogle = async (): Promise<void> => {
  const client = getSupabaseClient();
  const redirectTo = resolveRedirectTo();

  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // Keep the callback on our own origin so the session is not written to
      // third-party storage.
      skipBrowserRedirect: false,
      scopes: "openid email profile",
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });

  if (error) {
    throw new Error(describeAuthError(error, "sign-in"));
  }
};

/**
 * Whether Google sign-in is likely to be usable. Provider enablement lives in
 * the Supabase dashboard, so the button is offered optimistically and a failure
 * is reported with a real message rather than hidden.
 */
export const isGoogleSignInAvailable = (): boolean => isSupabaseConfigured();

export const getCurrentSession = async (): Promise<Session | null> => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(describeAuthError(error, "session"));
  }
  return data.session ?? null;
};

export const getCurrentUser = async (): Promise<SupabaseUser | null> => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error) {
    throw new Error(describeAuthError(error, "session"));
  }
  return data.user ?? null;
};

export type AuthStateListener = (event: AuthChangeEvent, session: Session | null) => void;

/**
 * Subscribes to Supabase Auth state changes. Returns an unsubscribe function.
 * The callback must stay synchronous - do not await inside it.
 */
export const onAuthStateChange = (listener: AuthStateListener): (() => void) => {
  if (!isSupabaseConfigured()) {
    return () => undefined;
  }

  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    listener(event, session);
  });

  return () => {
    data.subscription.unsubscribe();
  };
};
