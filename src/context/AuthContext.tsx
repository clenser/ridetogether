import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  signOut as supabaseSignOut,
  signUp as supabaseSignUp,
  type SignInInput,
  type SignUpInput,
  type SignUpResult,
} from "../services/auth";
import { getSupabaseConfigStatus, type SupabaseConfigIssue } from "../services/supabase";
import type { User } from "../types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

/**
 * - "idle"     signed out, or a user just became known and the load is queued
 * - "loading"  the profile row is being fetched from Supabase
 * - "ready"    a row was fetched from Supabase
 * - "missing"  Supabase answered and there is no row for this user
 * - "error"    the fetch failed; the row may still exist
 */
export type ProfileStatus = "idle" | "loading" | "ready" | "missing" | "error";

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
   * True only once Supabase has definitively answered for the current user.
   * Route guards must wait for this before deciding to show profile completion,
   * otherwise a returning user is bounced to the completion screen while their
   * profile is still being fetched.
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
  const [status, setStatus] = useState<AuthStatus>(() =>
    CONFIG.configured ? "loading" : "unavailable",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const authUserId = authUser?.id ?? null;

  /**
   * Marks the profile as in-flight and clears any previous row. Called in the
   * same React batch that sets a new auth user, so there is never a render in
   * which a signed-in user still shows the previous "idle" profile state.
   */
  const beginProfileLoad = useCallback((nextUserId: string | null) => {
    if (!nextUserId) {
      setProfile(null);
      setProfileStatus("idle");
      setProfileError(null);
      return;
    }
    setProfile(null);
    setProfileStatus("loading");
    setProfileError(null);
  }, []);

  useEffect(() => {
    if (!CONFIG.configured) return undefined;

    let cancelled = false;
    const restore = async () => {
      try {
        const restored = await getCurrentSession();
        if (cancelled) return;
        beginProfileLoad(restored?.user?.id ?? null);
        setSession(restored);
        setAuthUser(restored?.user ?? null);
        setStatus(restored ? "authenticated" : "unauthenticated");
        if (restored) logAuth("restored session", restored.user.id);
      } catch (error) {
        if (cancelled) return;
        beginProfileLoad(null);
        setSessionNotice(describeAuthError(error, "session"));
        setStatus("unauthenticated");
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [beginProfileLoad]);

  useEffect(() => {
    if (!CONFIG.configured) return undefined;

    return onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null;
      beginProfileLoad(nextUserId);

      if (event === "SIGNED_OUT") {
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
      }
      if (event === "TOKEN_REFRESHED" && nextUserId) {
        logAuth("token refreshed", nextUserId);
      }
      setSession(nextSession);
      setAuthUser(nextSession?.user ?? null);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
    });
  }, [beginProfileLoad]);

  // Supabase `profiles` is the single source of truth for the current user.
  useEffect(() => {
    if (!authUserId) {
      setProfile(null);
      setProfileStatus("idle");
      setProfileError(null);
      return;
    }

    let cancelled = false;
    // Guard against a stale fetch resolving after a sign-out or user switch.
    const requestedUserId = authUserId;
    setProfileStatus("loading");
    setProfileError(null);

    void (async () => {
      try {
        const row = await fetchProfile(requestedUserId);
        if (cancelled) return;
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
        setProfileError(describeProfileFailure(error));
        setProfileStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  const signIn = useCallback(
    async (input: SignInInput): Promise<void> => {
      const nextSession = await supabaseSignIn(input);
      setSessionNotice(null);
      // Same batch as the auth user, so the guard never sees a stale "idle"
      // profile and bounces a returning user to profile completion.
      beginProfileLoad(nextSession.user.id);
      setSession(nextSession);
      setAuthUser(nextSession.user);
      setStatus("authenticated");
      logAuth("signed in", nextSession.user.id);
    },
    [beginProfileLoad],
  );

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    setSessionNotice(null);
    // The redirect navigates away, so no state is set here. Supabase posts back
    // to the redirect URL and the session is picked up by onAuthStateChange.
    await supabaseSignInWithGoogle();
  }, []);

  const signUp = useCallback(
    async (input: SignUpInput): Promise<SignUpResult> => {
      const result = await supabaseSignUp(input);
      setSessionNotice(null);
      const newUser = result.user;
      if (result.session && newUser) {
        beginProfileLoad(newUser.id);
        setSession(result.session);
        setAuthUser(newUser);
        setStatus("authenticated");
        logAuth("signed up", newUser.id);
      } else if (newUser) {
        logAuth("signed up (awaiting email confirmation)", newUser.id);
      }
      return result;
    },
    [beginProfileLoad],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await supabaseSignOut();
    // Clears local state only. The Supabase profile row is untouched, so
    // signing back in restores the exact same profile.
    setSession(null);
    setAuthUser(null);
    setProfile(null);
    setProfileStatus("idle");
    setProfileError(null);
    setStatus("unauthenticated");
    if (import.meta.env.DEV) console.info("[auth] signed out, profile left intact in Supabase");
  }, []);

  const updateProfile = useCallback(
    async (changes: ProfileChanges): Promise<ProfileRow> => {
      if (!authUserId) {
        throw new Error("You are not signed in.");
      }
      const row = await saveProfileRow(authUserId, changes);
      // Adopt the saved row immediately so the guard sees a complete profile
      // without waiting for a refetch, then confirm against Supabase.
      setProfile(row);
      setProfileStatus("ready");
      setProfileError(null);
      if (import.meta.env.DEV) logProfileCompleteness(row, "updated");

      const confirmed = await fetchProfile(authUserId).catch(() => row);
      if (confirmed) {
        setProfile(confirmed);
        setProfileStatus("ready");
        if (import.meta.env.DEV) logProfileCompleteness(confirmed, "confirmed in Supabase");
      }
      return confirmed ?? row;
    },
    [authUserId],
  );

  const reloadProfile = useCallback(async (): Promise<void> => {
    if (!authUserId) return;
    setProfileStatus("loading");
    try {
      const row = await fetchProfile(authUserId);
      setProfile(row);
      setProfileStatus(row ? "ready" : "missing");
      setProfileError(null);
      if (import.meta.env.DEV) logProfileCompleteness(row, "reloaded");
    } catch (error) {
      setProfileError(describeProfileFailure(error));
      setProfileStatus("error");
    }
  }, [authUserId]);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const profileUser = useMemo(() => toAppUser(profile, authUser), [profile, authUser]);
  const profileComplete = useMemo(() => isProfileComplete(profile), [profile]);
  // Only a definitive "ready" or "missing" answer counts as settled. "idle",
  // "loading" and "error" must never trigger the completion redirect.
  const profileSettled = profileStatus === "ready" || profileStatus === "missing";

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isLoading: status === "loading",
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
