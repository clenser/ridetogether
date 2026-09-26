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

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) => readFileSync(join(ROOT, relativePath), "utf8");

/** Every rendered source file, so banned copy cannot reappear unnoticed. */
const collectTsx = (dir) =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return collectTsx(path);
    return entry.name.endsWith(".tsx") ? [read(path)] : [];
  });

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

// 7. The full-page loader is copy-free, so no technical wording can reach the
//    screen, and the session-restore copy is gone entirely.
const loadingScreen = read("src/components/LoadingScreen.tsx");
const layout = read("src/components/Layout.tsx");
const completeProfile = read("src/pages/auth/CompleteProfilePage.tsx");

check(
  "AuthLoadingScreen delegates to the shared branded loader",
  /export function AuthLoadingScreen\(\) \{\s*return <AppLoadingScreen /.test(authGuards),
);
check("the shared loader exists", /export function AppLoadingScreen/.test(loadingScreen));
check(
  "the shared loader renders only a logo, a spinner and screen-reader text",
  /CarFront/.test(loadingScreen)
    && /app-loading__spinner/.test(loadingScreen)
    && /className="sr-only"/.test(loadingScreen),
);
check(
  "the shared loader accepts no visible message prop",
  !/AppLoadingScreen\([^)]*message/.test(loadingScreen),
);
check(
  "a non-blocking refresh indicator exists",
  /export function InlineRefreshIndicator/.test(loadingScreen),
);
check(
  "the shell shows the refresh indicator while a profile refresh is in flight",
  /<InlineRefreshIndicator active=\{profileStatus === "refreshing"\}/.test(layout),
);
check(
  "the profile form keeps using the branded loader for a first load",
  /<AppLoadingScreen label="Loading your profile" \/>/.test(completeProfile),
);

// 9. No implementation vocabulary may be rendered to a member. These strings
//    are the ones that were previously visible on a loading or error screen.
const BANNED_COPY = [
  "Restoring your session",
  "Loading your account",
  "Fetching your saved",
  "from Supabase",
  "to Supabase yet",
  "Supabase is not connected",
  "Supabase Auth",
  "Supabase Storage",
  "Supabase database",
  "by Supabase",
  "Fetching your saved vehicles",
  "from the cloud",
  "in the cloud",
  "cloud storage",
  "cloud data",
  "cloud-synced",
  "by the database",
  "Checking the details we already have",
  // Browser-storage internals are implementation detail, not product language.
  "IndexedDB",
  "localStorage",
  "sessionStorage",
];
/** Removes block and line comments so prose in JSDoc is not treated as copy. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");

/**
 * Removes whole `console.*(...)` statements, including multi-line ones. A
 * development log may name the backend; a member never sees it.
 */
const stripConsoleCalls = (text) => {
  const out = [];
  let index = 0;
  while (index < text.length) {
    const match = /\bconsole\.(?:info|warn|error|debug|log)\s*\(/.exec(text.slice(index));
    if (!match) {
      out.push(text.slice(index));
      break;
    }
    out.push(text.slice(index, index + match.index));
    let depth = 1;
    let cursor = index + match.index + match[0].length;
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === "(") depth += 1;
      else if (text[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    index = cursor;
  }
  return out.join("");
};

/**
 * Blanks out storage API *calls* so a phrase like `localStorage` is only
 * rejected when it appears in something a member reads. Calling the API is
 * legitimate code; telling someone their profile "is kept in localStorage" is
 * not.
 */
const stripStorageApiUsage = (text) =>
  text
    .replace(/\bwindow\.(?:local|session)Storage\b/g, " ")
    .replace(/\b(?:local|session)Storage\s*\.\s*[A-Za-z]+/g, " ")
    .replace(/\b(?:local|session)Storage\s*\[[^\]]*\]/g, " ");

const renderedCopy = [...collectTsx("src")]
  .map((text) => stripStorageApiUsage(stripConsoleCalls(stripComments(text))))
  .join("\n");
for (const phrase of BANNED_COPY) {
  check(`no rendered copy contains ${JSON.stringify(phrase)}`, !renderedCopy.includes(phrase));
}

check(
  "no page reload is used as a workaround",
  !/location\.reload\(/.test(authContext + authGuards + main + layout),
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

// 10. A post-sign-in redirect can never leave the app. `navigate` reads "//host"
//     and "/\host" as absolute, so the value that reaches it is constrained to a
//     single leading slash. Exercised against the real module, not a copy.
const { safeInternalPath } = await import("../src/services/internalPath.ts");

for (const hostile of [
  "//evil.com",
  "///evil.com",
  "/\\evil.com",
  "/\\/evil.com",
  "https://evil.com",
  "http://evil.com",
  "javascript:alert(1)",
  "evil.com",
  "",
  "  /find",
]) {
  check(
    `a redirect target of ${JSON.stringify(hostile)} is rejected`,
    safeInternalPath(hostile) === "/",
  );
}

for (const [input, expected] of [
  ["/", "/"],
  ["/find", "/find"],
  ["/rides/abc-123", "/rides/abc-123"],
  ["/profile?tab=vehicles", "/profile?tab=vehicles"],
]) {
  check(
    `a redirect target of ${JSON.stringify(input)} is preserved`,
    safeInternalPath(input) === expected,
  );
}

check("a non-string redirect target falls back to the app root", safeInternalPath(undefined) === "/");
check(
  "a missing redirect target falls back to the app root",
  safeInternalPath(null, "/") === "/",
);

const loginPage = read("src/pages/auth/LoginPage.tsx");
check(
  "the sign-in redirect is filtered before it is used",
  /safeInternalPath\(\s*state\?\.from\s*\)/.test(loginPage),
);
check(
  "the sign-in page never navigates to a raw state value",
  !/navigate\(\s*state\?\.from/.test(loginPage),
);
check(
  "the auth guard filters the path it hands to the sign-in screen",
  /state=\{\{\s*from:\s*safeInternalPath\(location\.pathname\)\s*\}\}/.test(authGuards),
);
check(
  "no raw location.pathname is passed into a Navigate state",
  !/from:\s*location\.pathname\s*\}\s*\/>/.test(authGuards),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} session-continuity check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.info("\nall session-continuity checks passed");
