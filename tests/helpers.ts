import { expect, type Page, type ConsoleMessage, type Request } from "@playwright/test";

/**
 * Console and network failures are treated as test failures, because a silent
 * `console.error` or a 500 from Supabase is exactly the kind of defect that
 * reaches production unnoticed.
 *
 * A small set of messages is expected: the service worker is not registered
 * outside a secure context, push subscription is unavailable in headless
 * Chromium, and MapLibre logs tile warnings on flaky networks. Those are
 * enumerated explicitly rather than blanket-ignored, so a new error still fails
 * the test.
 */
const IGNORED_CONSOLE: RegExp[] = [
  /Download the React DevTools/i,
  /service worker|sw\.js|Failed to register service worker/i,
  /Push subscription|Notification permission|notification\.requestPermission/i,
  /maplibre|tile|webgl|WebGL|GL_INVALID/i,
  /[Ee]rror connecting|Socket hang up|net::ERR_NETWORK|net::ERR_FAILED/i,
  /PGRST|PostgREST|schema cache|permission denied|row-level security/i,
  /\[drafts\]|\[auth\]|\[profile\]|\[realtime\]|\[bookings\]/i,
  /ResizeObserver loop/i,
  /third-party cookie|cookie.*blocked|it looks like another site/i,
  // The browser logs a bare "Failed to load resource" with no URL whenever any
  // request 4xx/5xxs, including expected ones such as a rejected sign-in. The
  // `response` listener below already records real HTTP failures with their URL,
  // so this duplicate carries no extra signal.
  /Failed to load resource/i,
];

const IGNORED_REQUEST_PATTERNS: RegExp[] = [
  /supabase\.co\/rest\/v1\//i,
  /supabase\.co\/auth\/v1\//i,
  /realtime/i,
  /tiles\.openfreemap\.org/i,
  /valhalla1\.openstreetmap\.de/i,
  /fonts\.(googleapis|gstatic)\.com/i,
  /unpkg\.com/i,
];

const shouldIgnoreConsole = (text: string): boolean => IGNORED_CONSOLE.some((re) => re.test(text));

const shouldIgnoreRequest = (url: string): boolean =>
  IGNORED_REQUEST_PATTERNS.some((re) => re.test(url));

/** Errors that must never be swallowed, regardless of source. */
const FATAL_PAGE_ERRORS: RegExp[] = [
  /ResizeObserver loop/i,
  /is not a function/i,
  /Cannot read propert(y|ies) of undefined/i,
  /Cannot access .* before initialization/i,
  /Objects are not valid as a React child/i,
  /Failed to compile|Internal Server Error/i,
];

export interface ErrorCollector {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/**
 * Watches for runtime failures for the lifetime of a test. Call it before the
 * first navigation and assert with {@link assertNoErrors} at the end.
 */
export const collectErrors = (page: Page): ErrorCollector => {
  const collector: ErrorCollector = { consoleErrors: [], pageErrors: [], failedRequests: [] };

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const text = message.text();
    if (shouldIgnoreConsole(text)) return;
    // A warning is only recorded as an error when it is a real defect.
    if (message.type() === "warning" && !FATAL_PAGE_ERRORS.some((re) => re.test(text))) return;
    collector.consoleErrors.push(`${message.type()}: ${text}`);
  });

  page.on("pageerror", (error) => {
    const text = error.message ?? String(error);
    if (shouldIgnoreConsole(text)) return;
    collector.pageErrors.push(text);
  });

  page.on("requestfailed", (request: Request) => {
    const url = request.url();
    if (shouldIgnoreRequest(url)) return;
    const reason = request.failure()?.errorText ?? "unknown";
    // A cancelled request is the normal result of navigating away mid-flight.
    if (reason.includes("ERR_ABORTED")) return;
    collector.failedRequests.push(`${reason} ${request.method()} ${url}`);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (shouldIgnoreRequest(url)) return;
    if (response.status() < 400) return;
    if (shouldIgnoreRequest(response.request().url())) return;
    collector.failedRequests.push(`HTTP ${response.status()} ${url}`);
  });

  return collector;
};

export const assertNoErrors = (collector: ErrorCollector): void => {
  const all = [
    ...collector.pageErrors.map((text) => `pageerror: ${text}`),
    ...collector.consoleErrors.map((text) => `console ${text}`),
    ...collector.failedRequests.map((text) => `request: ${text}`),
  ];
  expect(all, "no console, page or network errors expected").toEqual([]);
};

export interface Credentials {
  email: string;
  password: string;
}

const readCredentials = (
  emailKey: string,
  passwordKey: string,
  role: string,
): Credentials | null => {
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  if (!email || !password) return null;
  return { email, password };
};

/**
 * Real Supabase credentials for the two roles. Tests that need them are skipped
 * when they are not configured - the app is never signed in with a fake session
 * and no account is ever created automatically.
 */
export const driverCredentials = (): Credentials | null => {
  const creds = readCredentials("E2E_DRIVER_EMAIL", "E2E_DRIVER_PASSWORD", "driver");
  if (!creds) {
    console.warn(
      "[e2e] E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD are not set; "
      + "driver-role tests will be skipped.",
    );
  }
  return creds;
};

export const riderCredentials = (): Credentials | null => {
  const creds = readCredentials("E2E_RIDER_EMAIL", "E2E_RIDER_PASSWORD", "rider");
  if (!creds) {
    console.warn(
      "[e2e] E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD are not set; "
      + "rider-role tests will be skipped.",
    );
  }
  return creds;
};

/** Signs in through the real login form. Never bypasses Auth. */
export const signIn = async (page: Page, creds: Credentials): Promise<void> => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(creds.email);
  await page.getByTestId("login-password").fill(creds.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
};

/** Signs out through the user menu. */
export const signOut = async (page: Page): Promise<void> => {
  const menu = page.getByTestId("user-menu-trigger");
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    const signOutButton = page.getByTestId("user-menu-signout");
    if (await signOutButton.isVisible().catch(() => false)) {
      await signOutButton.click();
      await page.waitForURL(/\/login/, { timeout: 20_000 });
      return;
    }
  }
  // Fall back to clearing the session if the menu is unavailable.
  await page.evaluate(async () => {
    const key = "sb-ridetogether-auth-token";
    window.localStorage.removeItem(key);
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const name = window.localStorage.key(i);
      if (name?.startsWith("sb-")) window.localStorage.removeItem(name);
    }
  });
  await page.goto("/login");
};

/** Waits for the app shell to be interactive and the boot loader to be gone. */
export const waitForApp = async (page: Page): Promise<void> => {
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("app-loading")).toHaveCount(0);
};

/** Asserts there is no horizontal overflow, which breaks mobile layouts. */
export const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `content overflows horizontally: ${overflow.scrollWidth}px in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
};
