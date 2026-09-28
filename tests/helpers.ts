import { expect, type Page, type ConsoleMessage, type Request } from "@playwright/test";

/**
 * Runtime failures are treated as test failures, because a silent
 * `console.error` or a 500 from Supabase is exactly the kind of defect that
 * reaches production unnoticed.
 *
 * The previous version of this file blanket-ignored every Supabase REST call,
 * every Supabase auth call and anything containing `realtime`, and additionally
 * dropped every `console.warn` that did not match one of six hard-coded
 * patterns. That meant a Supabase 500, an RLS `42501`, a `PGRST205` schema-cache
 * miss or a permanently failing token refresh failed *zero* tests, and the suite
 * reported green in an environment where every credentialed test had been
 * skipped.
 *
 * The contract now is the opposite:
 *
 *   - a request is only excused if the test that provoked it said so, by
 *     matching it against an allowance registered with {@link allowFailure};
 *   - anything else from Supabase - including a 4xx - fails the test;
 *   - a console warning is a failure by default, not a silent no-op.
 *
 * The remaining allowlist is limited to noise the *browser* generates, never to
 * text the application logs to report a failure.
 */
const IGNORED_CONSOLE: RegExp[] = [
  /Download the React DevTools/i,
  /ResizeObserver loop/i,
  // Chromium logs this whenever a request 4xx/5xxs, with no URL attached. The
  // `response` listener below records the same failure *with* its URL, so this
  // duplicate carries no extra signal.
  /Failed to load resource/i,
];

/**
 * Third-party endpoints whose failure is outside the application's control and
 * which are not part of the product contract under test.
 *
 * Supabase deliberately does NOT appear here. Nor does realtime: a dropped
 * websocket is a real defect, and the live-location spec asserts on it
 * explicitly instead of muting it.
 */
const IGNORED_REQUEST_PATTERNS: RegExp[] = [
  /tiles\.openfreemap\.org/i,
  /fonts\.(googleapis|gstatic)\.com/i,
  /unpkg\.com/i,
];

const shouldIgnoreConsole = (text: string): boolean => IGNORED_CONSOLE.some((re) => re.test(text));

const shouldIgnoreRequest = (url: string): boolean =>
  IGNORED_REQUEST_PATTERNS.some((re) => re.test(url));

export interface FailureAllowance {
  match: RegExp;
  why: string;
}

export interface ErrorCollector extends ErrorCollectorControls {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

export interface ErrorCollectorControls {
  /**
   * Registers one expected failure. Call this from inside the test that
   * deliberately provokes the error, with a reason. An empty list is the
   * default, which is what makes an unexpected Supabase failure fatal.
   */
  allowFailure: (match: RegExp, why: string) => void;
}

const describeResponse = (url: string, method: string, status: number | string): string =>
  `HTTP ${status} ${method} ${url}`;

export const collectErrors = (page: Page): ErrorCollector => {
  const collector: ErrorCollector = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    allowFailure: (match, why) => {
      allowances.push({ match, why });
    },
  };

  const allowances: FailureAllowance[] = [];

  /** Drops the failure only if a test explicitly declared it expected. */
  const isAllowed = (line: string): boolean => allowances.some((allowance) => allowance.match.test(line));

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const text = message.text();
    if (shouldIgnoreConsole(text)) return;
    const line = `${message.type()}: ${text}`;
    if (isAllowed(line)) return;
    collector.consoleErrors.push(line);
  });

  page.on("pageerror", (error) => {
    const text = error.message ?? String(error);
    if (shouldIgnoreConsole(text)) return;
    if (isAllowed(text)) return;
    collector.pageErrors.push(text);
  });

  page.on("requestfailed", (request: Request) => {
    const url = request.url();
    if (shouldIgnoreRequest(url)) return;
    const reason = request.failure()?.errorText ?? "unknown";
    // A cancelled request is the normal result of navigating away mid-flight.
    if (reason.includes("ERR_ABORTED")) return;
    const line = `${reason} ${request.method()} ${url}`;
    if (isAllowed(line)) return;
    collector.failedRequests.push(line);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (shouldIgnoreRequest(url)) return;
    if (response.status() < 400) return;
    const line = describeResponse(url, response.request().method(), response.status());
    if (isAllowed(line)) return;
    // Recorded whether or not it is from Supabase. The point of the change is
    // that a 4xx/5xx from any origin, Supabase included, is a test failure
    // unless a test asked for it.
    collector.failedRequests.push(line);
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

const OFFER_STEP_TESTIDS = ["offer-step-route", "offer-step-schedule", "offer-step-review"] as const;

/**
 * Moves the Offer Ride wizard to a step.
 *
 * The form is a three step flow, so a test that wants a field on a later step
 * has to walk there the way a host would. Forward movement is deliberately not
 * forced: `Continue` stays disabled until the current step is genuinely valid,
 * and that per-step gate is itself worth asserting. Callers that need to reach
 * a later step must therefore fill in the earlier ones first - or pass
 * `force` to click through regardless, for tests that are about something else.
 */
export const gotoOfferStep = async (page: Page, step: 0 | 1 | 2, options: { force?: boolean } = {}): Promise<void> => {
  for (let current = 0; current < step; current += 1) {
    const continueButton = page.getByTestId("offer-continue");
    if (options.force) {
      await continueButton.click({ force: true, timeout: 10_000 });
    } else {
      await expect(continueButton).toBeEnabled({ timeout: 15_000 });
      await continueButton.click();
    }
    await expect(page.getByTestId(OFFER_STEP_TESTIDS[current + 1])).toBeVisible();
  }
  await expect(page.getByTestId(OFFER_STEP_TESTIDS[step])).toBeVisible();
};

