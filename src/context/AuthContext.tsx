import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import {
  describeProfileFailure,
  describeProfileGaps,
  fetchProfile,
  isProfileComplete,
  saveProfile as saveProfileRow,
  toAppUser,
  type ProfileChanges,
  type ProfileRow,
} from "../repositories/profileRepository";
import {
  describeAuthError,
  getCurrentSession,
  isGoogleSignInAvailable,
  onAuthStateChange,
  signIn as supabaseSignIn,
  signInWithGoogle as supabaseSignInWithGoogle,
  settleNativeAuthRedirect,
  signOut as supabaseSignOut,
  signUp as supabaseSignUp,
  type SignInInput,
  type SignUpInput,
  type SignUpResult,
} from "../services/auth";
import { consumeLaunchUrl, listenForAuthDeepLink } from "../services/nativeAuth";
import { getSupabaseConfigStatus, type SupabaseConfigIssue } from "../services/supabase";
import type { User } from "../types";

/**
 * Coarse authentication phase.
 *
 * `initializing` is a startup-only value: the first `getSession()` resolves
 * exactly once, during application bootstrap. Every later transition goes
 * straight to `authenticated` or `unauthenticated`, and nothing ever returns
 * to `initializing`. That is what keeps a background token refresh or a tab
 * resume from re-rendering the "Restoring your session..." screen.
 */
export type AuthStatus = "initializing" | "authenticated" | "unauthenticated" | "unavailable";

/**
 * Profile phase, tracked separately from the auth phase so that refetching a
 * profile can never blank the application.
 *
 * - "idle"       signed out, no user to load
 * - "loading"    first fetch for this user; there is nothing to show yet
 * - "refreshing" re-fetch for a user we already have an answer for; the
 *                previous answer stays on screen
 * - "ready"      a row was fetched from Supabase
 * - "missing"    Supabase answered and there is no row for this user
 * - "error"      the fetch failed and no previous answer is available
 */
export type ProfileStatus = "idle" | "loading" | "refreshing" | "ready" | "missing" | "error";

export interface AuthContextValue {
  status: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAvailable: boolean;
  configIssue: SupabaseConfigIssue | null;
  session: Session | null;
  authUser: SupabaseUser | null;
  profile: ProfileRow | null;
  profileUser: User | null;
  profileStatus: ProfileStatus;
  profileLoading: boolean;
  /**
   * True once Supabase has definitively answered for the *current* user, or
   * once a previous answer is being retained. Route guards must not treat an
   * unsettled profile as "incomplete": a returning user must never be bounced
   * to the completion screen by an in-flight or failed background refetch.
   */
  profileSettled: boolean;
  profileError: string | null;
  profileComplete: boolean;
  sessionNotice: string | null;
  signIn: (input: SignInInput) => Promise<void>;
  /**
   * Hands the browser off to Google. Returns once the redirect is initiated, not
   * when the session exists - the session arrives via `onAuthStateChange`.
   */
  signInWithGoogle: () => Promise<void>;
  googleSignInAvailable: boolean;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  updateProfile: (changes: ProfileChanges) => Promise<ProfileRow>;
  reloadProfile: () => Promise<void>;
  clearSessionNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const CONFIG = getSupabaseConfigStatus();

/**
 * Development-only logging. Never logs emails, passwords, tokens or keys -
 * only the user id, which is a public row identifier.
 */
const logAuth = (event: string, userId: string | null): void => {
  if (!import.meta.env.DEV) return;
  console.info(`[auth] ${event}`, { userId: userId ?? "none" });
};

const logProfileCompleteness = (row: ProfileRow | null, stage = "loaded"): void => {
  if (!import.meta.env.DEV) return;
  const complete = isProfileComplete(row);
  console.info(
    complete
      ? `[profile] complete (${stage}) - skipping completion screen`
      : `[profile] incomplete (${stage}) - missing ${describeProfileGaps(row).join(", ") || "row"}`,
    { userId: row?.id ?? "none" },
  );
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Startup-only. The initial `getSession()` below resolves this exactly once;
  // no later code path assigns "initializing", so `isLoading` cannot flicker
  // back to true when Supabase refreshes a token in the background.
  const [status, setStatus] = useState<AuthStatus>(() =>
    CONFIG.configured ? "initializing" : "unavailable",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  /** Bumped by `reloadProfile` to re-run the profile effect for the same user. */
  const [profileReloadToken, setProfileReloadToken] = useState(0);

  const authUserId = authUser?.id ?? null;

  /**
   * The last definitive answer we obtained for a user id. Lets the profile
   * effect tell a *first* load (blocking) apart from a *re*-load (non-blocking),
   * and lets a failed refetch keep the previous row instead of discarding it.
   */
  const settledProfileRef = useRef<{ userId: string | null; status: ProfileStatus }>({
    userId: null,
    status: "idle",
  });

  const resetProfile = useCallback(() => {
    settledProfileRef.current = { userId: null, status: "idle" };
    setProfile(null);
    setProfileStatus("idle");
    setProfileError(null);
  }, []);

  /**
   * Initial session restoration. Runs once at startup, in parallel with the
   * auth listener below. The listener is registered independently so that a
   * session arriving during this call is never dropped.
   */
  useEffect(() => {
    if (!CONFIG.configured) return undefined;

    let cancelled = false;
    const restore = async () => {
      try {
        const restored = await getCurrentSession();
        if (cancelled) return;
        setSession(restored);
        setAuthUser(restored?.user ?? null);
        setStatus(restored ? "authenticated" : "unauthenticated");
        if (restored) logAuth("restored session", restored.user.id);
      } catch (error) {
        if (cancelled) return;
        setSessionNotice(describeAuthError(error, "session"));
        setStatus("unauthenticated");
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Auth state listener, registered exactly once for the lifetime of the
   * provider.
   *
   * This callback is intentionally synchronous and touches only session state.
   * Awaits inside `onAuthStateChange` can deadlock supabase-js event delivery,
   * and mutating profile state here is what previously reset the UI to a
   * full-screen loader on every `TOKEN_REFRESHED`. The profile is loaded by the
   * effect keyed on the user id, so an event that does not change the user id
   * (`TOKEN_REFRESHED`, `USER_UPDATED`, `INITIAL_SESSION`) leaves the current
   * session, profile and route untouched.
   */
  useEffect(() => {
    if (!CONFIG.configured) return undefined;

    return onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null;

      if (event === "SIGNED_OUT") {
        resetProfile();
        setSession(null);
        setAuthUser(null);
        setStatus("unauthenticated");
        setSessionNotice("You have been signed out.");
        if (import.meta.env.DEV) console.info("[auth] signed out");
        return;
      }

      if (event === "SIGNED_IN") {
        setSessionNotice(null);
        logAuth("signed in", nextUserId);
      } else if (event === "TOKEN_REFRESHED" && nextUserId) {
        // Background refresh only. The session, profile and route stay as they
        // are; nothing below returns to a loading state.
        logAuth("token refreshed", nextUserId);
      }

      setSession(nextSession);
      setAuthUser(nextSession?.user ?? null);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
    });
  }, [resetProfile]);

  /**
   * Supabase `profiles` is the single source of truth for the current user.
   *
   * Keyed on the user id, so it re-runs when the *identity* changes and stays
   * dormant for events that keep the same identity (token refresh, tab resume).
   * A re-run for a user we already have an answer for is a non-blocking
   * `refreshing` that keeps the previous row on screen; a failed re-run keeps
   * that row too, so a transient network error can neither blank the app nor
   * send the user back to Complete Profile.
   */
  useEffect(() => {
    if (!authUserId) {
      resetProfile();
      return;
    }

    let cancelled = false;
    // Guard against a stale fetch resolving after a sign-out or user switch.
    const requestedUserId = authUserId;
    const previousStatus = settledProfileRef.current.status;
    // A usable previous answer exists only if Supabase already gave us one for
    // this exact user. A previous *error* does not count.
    const hasAnswer =
      settledProfileRef.current.userId === requestedUserId &&
      (previousStatus === "ready" || previousStatus === "missing");

    if (hasAnswer) {
      setProfileStatus("refreshing");
    } else {
      // First load for this identity: nothing safe to show yet, so discard any
      // row that belonged to a previous user.
      settledProfileRef.current = { userId: requestedUserId, status: "loading" };
      setProfile(null);
      setProfileStatus("loading");
    }
    setProfileError(null);

    void (async () => {
      try {
        const row = await fetchProfile(requestedUserId);
        if (cancelled) return;
        settledProfileRef.current = {
          userId: requestedUserId,
          status: row ? "ready" : "missing",
        };
        setProfile(row);
        setProfileStatus(row ? "ready" : "missing");
        if (import.meta.env.DEV) {
          console.info(
            row ? "[profile] loaded from Supabase" : "[profile] no row in Supabase yet",
            { userId: requestedUserId },
          );
          logProfileCompleteness(row);
        }
      } catch (error) {
        if (cancelled) return;
        const message = describeProfileFailure(error);
        setProfileError(message);
        if (hasAnswer) {
          // Keep the row we already trust and stay settled. The error stays
          // available for a quiet retry, but the application keeps working.
          setProfileStatus(previousStatus === "missing" ? "missing" : "ready");
          if (import.meta.env.DEV) {
            console.warn("[profile] refetch failed, keeping the previous profile", {
              userId: requestedUserId,
              reason: message,
            });
          }
          return;
        }
        settledProfileRef.current = { userId: requestedUserId, status: "error" };
        setProfileStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUserId, profileReloadToken, resetProfile]);

  const signIn = useCallback(async (input: SignInInput): Promise<void> => {
    const nextSession = await supabaseSignIn(input);
    setSessionNotice(null);
    // The profile effect is keyed on the user id, so setting the user here is
    // what schedules the profile load. No loading state is entered by hand.
    setSession(nextSession);
    setAuthUser(nextSession.user);
    setStatus("authenticated");
    logAuth("signed in", nextSession.user.id);
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    setSessionNotice(null);
    // The redirect navigates away, so no state is set here. Supabase posts back
    // to the redirect URL and the session is picked up by onAuthStateChange.
    await supabaseSignInWithGoogle();
  }, []);

  /**
   * Native OAuth return path.
   *
   * On the web the Supabase client settles the callback itself, so there is
   * nothing to do here and the effect tears down immediately. In the Android
   * shell the system browser is a separate app, so the return arrives as a
   * `com.ridetogether.app:/auth/callback` deep link instead of a navigation. This
   * subscribes for the app's whole lifetime rather than only during a sign-in,
   * because the OS may have killed the process and restarted the app with that
   * URL, which is what `consumeLaunchUrl` covers.
   */
  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;

    const handleUrl = (url: string) => {
      void settleNativeAuthRedirect(url)
        .then((settled) => {
          // A deep link with no session in it is not ours to report on: it can be
          // any link the app is registered for, so it is ignored silently.
          if (!settled) return;
          setSessionNotice(null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message =
            error instanceof Error && error.message
              ? error.message
              : "We could not complete your Google sign-in. Please try again.";
          setSessionNotice(message);
        });
    };

    void (async () => {
      const remove = await listenForAuthDeepLink(handleUrl);
      if (cancelled) {
        remove();
        return;
      }
      teardown = remove;

      const launchUrl = await consumeLaunchUrl();
      if (launchUrl) handleUrl(launchUrl);
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  const signUp = useCallback(
    async (input: SignUpInput): Promise<SignUpResult> => {
      const result = await supabaseSignUp(input);
      setSessionNotice(null);
      const newUser = result.user;
      if (result.session && newUser) {
        setSession(result.session);
        setAuthUser(newUser);
        setStatus("authenticated");
        logAuth("signed up", newUser.id);
      } else if (newUser) {
        logAuth("signed up (awaiting email confirmation)", newUser.id);
      }
      return result;
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await supabaseSignOut();
    // Clears local state only. The Supabase profile row is untouched, so
    // signing back in restores the exact same profile.
    resetProfile();
    setSession(null);
    setAuthUser(null);
    setStatus("unauthenticated");
    if (import.meta.env.DEV) console.info("[auth] signed out, profile left intact in Supabase");
  }, [resetProfile]);

  const updateProfile = useCallback(
    async (changes: ProfileChanges): Promise<ProfileRow> => {
      if (!authUserId) {
        throw new Error("You are not signed in.");
      }
      const row = await saveProfileRow(authUserId, changes);
      // Adopt the saved row immediately so the guard sees a complete profile
      // without waiting for a refetch, then confirm against Supabase.
      settledProfileRef.current = { userId: authUserId, status: "ready" };
      setProfile(row);
      setProfileStatus("ready");
      setProfileError(null);
      if (import.meta.env.DEV) logProfileCompleteness(row, "updated");

      const confirmed = await fetchProfile(authUserId).catch(() => row);
      if (confirmed) {
        settledProfileRef.current = { userId: authUserId, status: "ready" };
        setProfile(confirmed);
        setProfileStatus("ready");
        if (import.meta.env.DEV) logProfileCompleteness(confirmed, "confirmed in Supabase");
      }
      return confirmed ?? row;
    },
    [authUserId],
  );

  /**
   * Explicit retry. Delegates to the profile effect so one code path owns every
   * first-load, refresh and failure rule. A retry after a hard failure shows the
   * blocking loader again; a retry while an answer is on screen is silent.
   */
  const reloadProfile = useCallback((): Promise<void> => {
    if (!authUserId) return Promise.resolve();
    setProfileReloadToken((token) => token + 1);
    return Promise.resolve();
  }, [authUserId]);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const profileUser = useMemo(() => toAppUser(profile, authUser), [profile, authUser]);
  const profileComplete = useMemo(() => isProfileComplete(profile), [profile]);
  // Settled means "we have an answer we trust for the current user". A
  // background `refreshing` that retains that answer is settled, so neither a
  // token refresh nor a failed refetch can trigger the completion redirect.
  // "idle", a first `loading` and a first-load `error` are not settled.
  const profileSettled = profileStatus === "ready" || profileStatus === "missing" || profileStatus === "refreshing";

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      // Startup-only. Never true again once the initial session resolved.
      isLoading: status === "initializing",
      isAuthenticated: status === "authenticated",
      isAvailable: CONFIG.configured,
      configIssue: CONFIG.configured ? null : CONFIG.issue,
      session,
      authUser,
      profile,
      profileUser,
      profileStatus,
      profileLoading: profileStatus === "loading",
      profileSettled,
      profileError,
      profileComplete,
      sessionNotice,
      signIn,
      signInWithGoogle,
      googleSignInAvailable: isGoogleSignInAvailable(),
      signUp,
      signOut,
      updateProfile,
      reloadProfile,
      clearSessionNotice,
    }),
    [
      status,
      session,
      authUser,
      profile,
      profileUser,
      profileStatus,
      profileSettled,
      profileError,
      profileComplete,
      sessionNotice,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      updateProfile,
      reloadProfile,
      clearSessionNotice,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
};

export { AuthContext };
export default AuthProvider;
