import { expect, test, type Page } from "@playwright/test";
import { assertNoErrors, collectErrors, driverCredentials, signIn, signOut, waitForApp } from "./helpers";

/**
 * Regression coverage for the "stuck on Restoring your session..." report.
 *
 * The defect: the Supabase auth listener reset the *profile* state to "loading"
 * on every auth event, including `TOKEN_REFRESHED`. Browsers throttle timers in
 * background tabs, so the auto-refresh fires on tab resume, the profile was
 * wiped, and the route guard replaced the whole page with the session loader.
 *
 * These tests assert the contract that must hold after the fix:
 *   - the boot loader is startup-only,
 *   - a hidden/visible cycle changes nothing on screen,
 *   - the route and form state survive a tab switch,
 *   - a real reload still restores the session,
 *   - a real sign-out still logs out.
 */

const creds = driverCredentials();

/**
 * Simulates a genuine tab switch.
 *
 * `bringToFront()` is real: Chromium backgrounds the other page, which sets
 * `document.visibilityState` to "hidden" and fires `visibilitychange`. The
 * visibility override additionally guarantees the cycle runs in headless mode,
 * where occlusion can otherwise be faked.
 */
const simulateTabSwitch = async (page: Page, other: Page): Promise<void> => {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await other.bringToFront();
  // Long enough for any throttled timer to be considered overdue, matching a
  // member who reads another tab for a minute.
  await other.waitForTimeout(1_500);
  await other.close();

  await page.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

/** Fails if the boot loader is present at any point during `action`. */
const expectNoBootLoader = async (page: Page, action: () => Promise<void>): Promise<void> => {
  const appeared = page
    .waitForSelector('[data-testid="app-loading"]', { state: "attached", timeout: 250 })
    .then(() => true)
    .catch(() => false);
  await action();
  expect(await appeared, '"Restoring your session..." must not reappear').toBe(false);
};

test.describe("session continuity across tab switches", () => {
  test.skip(creds === null, "E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD are not set");

  test("Home stays on screen when a tab is switched and returned to", async ({ page, context }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    const homePath = new URL(page.url()).pathname;
    expect(homePath).not.toBe("/login");

    const other = await context.newPage();
    await expectNoBootLoader(page, () => simulateTabSwitch(page, other));

    await expect(page.getByTestId("app-shell")).toBeVisible();
    expect(new URL(page.url()).pathname, "the route must not change").toBe(homePath);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    assertNoErrors(errors);
  });

  for (const route of ["/find", "/offer"]) {
    test(`${route} survives a tab switch without a loader or a redirect`, async ({ page, context }) => {
      const errors = collectErrors(page);
      await signIn(page, creds!);
      await page.goto(route);
      await waitForApp(page);
      expect(new URL(page.url()).pathname).toBe(route);

      const other = await context.newPage();
      await expectNoBootLoader(page, () => simulateTabSwitch(page, other));

      expect(new URL(page.url()).pathname, "the route must not change").toBe(route);
      await expect(page.getByTestId("app-shell")).toBeVisible();
      assertNoErrors(errors);
    });
  }

  test("ride details stay on screen when a tab is switched and returned to", async ({ page, context }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await page.goto("/rides");
    await waitForApp(page);

    const firstRide = page.locator('[data-testid^="ride-card-"], a[href^="/rides/"]').first();
    await expect(firstRide).toBeVisible();
    await firstRide.click();
    await page.waitForURL(/\/rides\/[^/]+$/, { timeout: 20_000 });
    const detailsPath = new URL(page.url()).pathname;
    await waitForApp(page);

    const other = await context.newPage();
    await expectNoBootLoader(page, () => simulateTabSwitch(page, other));

    expect(new URL(page.url()).pathname, "the ride must still be open").toBe(detailsPath);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    assertNoErrors(errors);
  });

  test("offer form state is preserved when a tab is switched and returned to", async ({ page, context }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await page.goto("/offer");
    await waitForApp(page);

    // A date/time is inert, requires no routing and no geocoding, so the
    // assertion is about React state surviving, not about the network.
    await page.getByTestId("offer-date").fill("2099-04-17");
    await page.getByTestId("offer-time").fill("08:45");
    await page.getByTestId("offer-seats").selectOption("2");

    const other = await context.newPage();
    await expectNoBootLoader(page, () => simulateTabSwitch(page, other));

    await expect(page.getByTestId("offer-date")).toHaveValue("2099-04-17");
    await expect(page.getByTestId("offer-time")).toHaveValue("08:45");
    await expect(page.getByTestId("offer-seats")).toHaveValue("2");
    assertNoErrors(errors);
  });

  test("a manual reload restores the session and opens the app", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await page.goto("/find");
    await waitForApp(page);

    await page.reload();
    // The loader is allowed here: this is the startup bootstrap.
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("app-loading")).toHaveCount(0);

    const path = new URL(page.url()).pathname;
    expect(path, "a reload must not bounce to login or complete-profile").toBe("/find");
    assertNoErrors(errors);
  });

  test("a real sign-out still returns to the login screen", async ({ page }) => {
    await signIn(page, creds!);
    await waitForApp(page);

    await signOut(page);
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });

  test("a background refresh uses the subtle indicator, never a full-page loader", async ({ page, context }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await page.goto("/find");
    await waitForApp(page);

    // The non-blocking indicator exists but is idle on a settled page.
    const indicator = page.getByTestId("app-refresh");
    await expect(indicator).toHaveAttribute("data-active", "false");
    await expect(page.getByTestId("app-loading")).toHaveCount(0);

    const other = await context.newPage();
    await expectNoBootLoader(page, () => simulateTabSwitch(page, other));

    // Whatever happened underneath, the page is still the current route and the
    // full-page loader is not in the document.
    expect(new URL(page.url()).pathname).toBe("/find");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("app-loading")).toHaveCount(0);
    assertNoErrors(errors);
  });

  test("client-side navigation across primary routes never shows a full-page loader", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);

    // Links, not `goto`, so this exercises the SPA router rather than a document
    // load: the case where a route change could blank the app.
    const routes: Array<[string, string]> = [
      ["Find a ride", "/find"],
      ["Offer a ride", "/offer"],
      ["My rides", "/rides"],
      ["My bookings", "/bookings"],
      ["Profile", "/profile"],
      ["Home", "/"],
    ];

    for (const [label, path] of routes) {
      const link = page.getByRole("link", { name: label, exact: true }).first();
      await expect(link).toBeVisible();
      await link.click();

      await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
      await expect(page.getByTestId("app-shell")).toBeVisible();
      // The guard is the point of the test: a settled authenticated route must
      // never be replaced by the bootstrap loader.
      await expect(page.getByTestId("app-loading")).toHaveCount(0);
      await expect(page.getByTestId("app-refresh")).toHaveAttribute("data-active", "false");
    }
    assertNoErrors(errors);
  });
});
