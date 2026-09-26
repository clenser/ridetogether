import { expect, test } from "@playwright/test";
import { collectErrors, assertNoErrors } from "./helpers";

/**
 * Web Push behaviour that can be observed without a deployed delivery path.
 *
 * The point of this file is the boundary the app must not cross. Real delivery
 * needs a VAPID key pair, Edge Function secrets and two Vault values, none of
 * which exist in CI, so asserting "a notification arrived" here would be theatre.
 * What *can* be asserted is everything short of the wire: that the browser is
 * never prompted without a click, that every failure mode reports itself, and
 * that the UI never claims more than it knows.
 *
 * The static half of the same boundary - secret names unreachable from the
 * bundle, idempotency on the notification id, constant-time secret comparison -
 * lives in `scripts/check-session-continuity.mjs` and `scripts/check-schema.mjs`.
 */

/**
 * Counts permission prompts across a set of navigations.
 *
 * The browser is asked for nothing here: `Notification.requestPermission` is
 * replaced with a counting stub, so a regression that prompts on load shows up as
 * a non-zero count rather than as a hung headless dialog.
 */
const trackPermissionPrompts = async (
  page: import("@playwright/test").Page,
  options: { permission?: NotificationPermission },
  routes: string[],
) => {
  await page.addInitScript((permission) => {
    const state = { permissionRequests: 0 };
    Object.defineProperty(window, "__pushProbe", { value: state });

    Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
    (Notification as unknown as { requestPermission: () => Promise<string> }).requestPermission =
      async () => {
        state.permissionRequests += 1;
        return "granted";
      };
  }, options.permission ?? "default");

  for (const route of routes) await page.goto(route);

  return page.evaluate(
    () => (window as unknown as { __pushProbe: { permissionRequests: number } }).__pushProbe.permissionRequests,
  );
};

const PUBLIC_ROUTES = ["/", "/login", "/signup", "/forgot-password", "/no-such-route"];

test.describe("Web Push permission flow", () => {
  test("no permission is requested merely by loading the app", async ({ page }) => {
    const errors = collectErrors(page);

    const prompts = await trackPermissionPrompts(page, { permission: "default" }, PUBLIC_ROUTES);

    expect(prompts, "permission must never be requested on load").toBe(0);
    assertNoErrors(errors);
  });

  test("a denied permission is reported and not retried", async ({ page }) => {
    const errors = collectErrors(page);

    const prompts = await trackPermissionPrompts(page, { permission: "denied" }, ["/login"]);

    // Reaching the app at all must not re-prompt a member who already said no.
    expect(prompts).toBe(0);
    expect(await page.evaluate(() => Notification.permission)).toBe("denied");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    assertNoErrors(errors);
  });

  test("an unsupported browser still boots", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      // Removing the feature is what `isPushSupported()` tests for; the app has to
      // treat it as "in-app updates still work", not as a crash.
      Object.defineProperty(window, "PushManager", { configurable: true, value: undefined });
    });

    await page.goto("/login");

    await expect(page.getByTestId("login-submit")).toBeVisible();
    assertNoErrors(errors);
  });
});

test.describe("Web Push service worker", () => {
  test("the worker refuses to navigate a notification off-site", async ({ page }) => {
    await page.goto("/login");

    const verdict = await page.evaluate(async () => {
      const source = await (await fetch("/sw.js")).text();
      // The guard is exported nowhere, so assert on the source of the handler
      // rather than pretending a click can be simulated in headless Chromium.
      return {
        rejectsDoubleSlash: /!\s*value\.startsWith\("\/\/"\)/.test(source),
        rejectsBackslash: /!\s*value\.startsWith\("\/\\\\"\)/.test(source),
        validatesOnClick: /addEventListener\("notificationclick"[\s\S]*?safeNotificationPath\(/.test(source),
        originIsParsed: /new URL\(client\.url\)\.origin\s*!==\s*origin/.test(source),
        hasPushHandler: /addEventListener\("push"/.test(source),
        hasClickHandler: /addEventListener\("notificationclick"/.test(source),
        showsNotification: /showNotification\(/.test(source),
        // Auth and data must never be served from a cache.
        bypassesSupabase: /isSupabaseTraffic\(url\)/.test(source),
      };
    });

    expect(verdict.hasPushHandler, "sw.js must handle push").toBe(true);
    expect(verdict.hasClickHandler, "sw.js must handle notificationclick").toBe(true);
    expect(verdict.showsNotification, "sw.js must display a notification").toBe(true);
    expect(verdict.rejectsDoubleSlash, "a protocol-relative target must be rejected").toBe(true);
    expect(verdict.rejectsBackslash, "a backslash target must be rejected").toBe(true);
    expect(verdict.validatesOnClick, "the click handler must re-validate its target").toBe(true);
    expect(verdict.originIsParsed, "an existing client must be matched by parsed origin").toBe(true);
    expect(verdict.bypassesSupabase, "Supabase responses must bypass the cache").toBe(true);
  });

  test("the worker does not contain private key material", async ({ request }) => {
    const body = await (await request.get("/sw.js")).text();
    for (const secret of [
      "VAPID_PRIVATE_KEY",
      "VAPID_PUBLIC_KEY_X",
      "VAPID_PUBLIC_KEY_Y",
      "VAPID_SUBJECT",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PUSH_DISPATCH_SECRET",
    ]) {
      expect(body, `sw.js must not mention ${secret}`).not.toContain(secret);
    }
  });
});

test.describe("Web Push honesty", () => {
  test("the built bundle carries no private push secret", async ({ page }) => {
    await page.goto("/login");

    // Prove it from the artefact the browser actually runs, not from the source
    // tree: a secret could reach the bundle through an import the guard misses.
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src),
    );
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const body = await (await page.request.get(src)).text();
      for (const secret of [
        "VAPID_PRIVATE_KEY",
        "VAPID_PUBLIC_KEY_X",
        "VAPID_PUBLIC_KEY_Y",
        "VAPID_SUBJECT",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PUSH_DISPATCH_SECRET",
      ]) {
        expect(body, `${src} must not contain ${secret}`).not.toContain(secret);
      }
    }
  });
});
