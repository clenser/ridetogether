/**
 * Session-continuity regression guard.
 *
 * A full-page "Restoring your session..." loader must be a startup-only state.
 * The defect this guards against: the Supabase auth listener reset the *profile*
 * state to "loading" on every auth event, including `TOKEN_REFRESHED`. Browsers
 * throttle timers in background tabs, so the auto-refresh fires on tab resume,
 * the profile was wiped, and the route guard replaced the whole page.
 *
 * These assertions are about structure, not behaviour, so they run without
 * Supabase credentials. Behavioural coverage lives in
 * `tests/session-resume.spec.ts`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) => readFileSync(join(ROOT, relativePath), "utf8");

const failures = [];

const check = (description, condition) => {
  if (condition) {
    console.info(`  ok   ${description}`);
    return;
  }
  failures.push(description);
  console.error(`  FAIL ${description}`);
};

const authContext = read("src/context/AuthContext.tsx");
const authGuards = read("src/components/AuthGuards.tsx");
const serviceWorker = read("public/sw.js");
const main = read("src/main.tsx");

console.info("session continuity guard");

// 1. The session-restore loader must be its own, startup-only phase.
check(
  "AuthStatus declares a distinct 'initializing' phase",
  /export type AuthStatus = "initializing" \|/.test(authContext),
);
check(
  "no code path assigns the startup status after the initial state",
  // The only assignment may be the lazy useState initialiser.
  (authContext.match(/setStatus\(\s*"initializing"/g) ?? []).length === 0,
);
check(
  "isLoading is derived from 'initializing' only",
  /isLoading: status === "initializing"/.test(authContext),
);
check(
  "the legacy \"loading\" auth status is gone",
  !/status === "loading"/.test(authContext),
);

// 2. The auth listener must not touch profile or loading state.
const listenerStart = authContext.indexOf("onAuthStateChange((event, nextSession) => {");
check("the auth listener exists", listenerStart !== -1);
if (listenerStart !== -1) {
  const listenerBody = authContext.slice(listenerStart, authContext.indexOf("\n  }, [resetProfile]);", listenerStart));
  // Clearing the profile on a genuine SIGNED_OUT is required. What must never
  // appear is a profile reset on an event that keeps the session, because that
  // is what used to blank the app on every background token refresh.
  // `\b` matters: without it `setProfile(` also matches inside `resetProfile(`.
  const directMutations = [...listenerBody.matchAll(/\bsetProfile\(|\bsetProfileStatus\(|\bsetProfileError\(/g)];
  check(
    "the auth listener never sets profile state directly",
    directMutations.length === 0,
  );
  const resetCalls = [...listenerBody.matchAll(/resetProfile\(\)/g)];
  check("the auth listener resets the profile at most once", resetCalls.length === 1);
  const signOutBranch = listenerBody.slice(
    listenerBody.indexOf('event === "SIGNED_OUT"'),
    listenerBody.indexOf('event === "SIGNED_IN"'),
  );
  check(
    "the only profile reset is inside the SIGNED_OUT branch",
    resetCalls.length === 1 && /resetProfile\(\)/.test(signOutBranch),
  );
  check(
    "the auth listener does not await (would deadlock supabase-js event delivery)",
    !/\bawait\b/.test(listenerBody),
  );
}

// 3. Exactly one subscription, with exactly one cleanup.
const subscriptions = [...authContext.matchAll(/onAuthStateChange\(/g)];
check("the auth listener is registered exactly once", subscriptions.length === 1);
check(
  "the subscription effect returns the unsubscribe function",
  /return onAuthStateChange\(/.test(authContext),
);
check("the subscription effect has no volatile dependencies", /}, \[resetProfile\]\);/.test(authContext));

// 4. getSession must be called from startup only, never from render or a listener.
const getSessionCalls = [...authContext.matchAll(/getCurrentSession\(/g)];
check("getSession is called exactly once", getSessionCalls.length === 1);
check(
  "getSession is awaited inside the startup effect",
  (authContext.match(/await getCurrentSession\(\)/g) ?? []).length === 1,
);

// 5. No hidden/visible listener may re-enter the authentication bootstrap.
const listenersInAuth = [...authContext.matchAll(/addEventListener\(\s*"(visibilitychange|pageshow|pagehide|focus|blur)"/g)];
check("AuthContext registers no visibility or focus listener", listenersInAuth.length === 0);
check(
  "AuthContext does not poll for sessions",
  !/setInterval/.test(authContext),
);
check(
  "no page reload is used as a workaround",
  !/location\.reload\(/.test(authContext + authGuards + main),
);

// 6. Profile phases are separated, and a refresh cannot clear a settled answer.
check(
  "ProfileStatus has a non-blocking 'refreshing' phase",
  /export type ProfileStatus = "idle" \| "loading" \| "refreshing" \|/.test(authContext),
);
check(
  "a settled answer is retained while refreshing",
  /profileStatus === "refreshing"/.test(authContext),
);
check(
  "a failed refetch keeps the previous profile",
  /keeping the previous profile/.test(authContext),
);

// 7. The loader copy is unique to the startup branch.
check(
  "AuthLoadingScreen requires an explicit message",
  /export function AuthLoadingScreen\(\{ message \}: \{ message: string \}\)/.test(authGuards),
);
check(
  "the session-restore copy is a named startup constant",
  /const RESTORING_SESSION = "Restoring your session…"/.test(authGuards),
);
const restoreUsages = [...authGuards.matchAll(/AuthLoadingScreen message=\{RESTORING_SESSION\}/g)];
check("the session-restore loader is only rendered from the auth bootstrap branch", restoreUsages.length === 3);
check(
  "a first profile load uses its own copy, not the session-restore copy",
  /AuthLoadingScreen message="Loading your account…"/.test(authGuards),
);

// 8. The service worker must never touch Supabase traffic.
check(
  "the service worker bails out on Supabase traffic before responding",
  /if \(isSupabaseTraffic\(url\)\) return;/.test(serviceWorker),
);
check(
  "the service worker responds to nothing but same-origin GETs",
  /if \(request\.method !== "GET"\) return;/.test(serviceWorker),
);
check(
  "navigation requests are network-first, so a resume never boots a stale shell",
  /request\.mode === "navigate"[\s\S]*?fetch\(request\)/.test(serviceWorker),
);
check(
  "the service worker does not cache Supabase hosts",
  !/supabase\.co[\s\S]{0,200}cache\.put/.test(serviceWorker),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} session-continuity check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.info("\nall session-continuity checks passed");
