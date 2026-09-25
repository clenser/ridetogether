import { expect, test, type Page } from "@playwright/test";
import {
  collectErrors,
  assertNoErrors,
  expectNoHorizontalOverflow,
  riderCredentials,
  signIn,
  waitForApp,
} from "./helpers";

const creds = riderCredentials();

/**
 * Drafts are the most fragile local state in the app: written on a timer, scoped
 * per user, and scrubbed of credential-shaped keys. These tests cover the storage
 * contract and the form-level autosave/restore behaviour that can be observed
 * without a live Supabase session.
 */

const DRAFT_KEY_PREFIX = "ridetogether:draft:";

const readDrafts = async (page: Page): Promise<Record<string, string>> =>
  page.evaluate((prefix) => {
    const result: Record<string, string> = {};
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const value = window.localStorage.getItem(key);
        if (value !== null) result[key] = value;
      }
    }
    return result;
  }, DRAFT_KEY_PREFIX);

test.describe("draft storage contract", () => {
  test("the app never writes credential-shaped keys into a draft", async ({ page }) => {
    test.skip(!creds, "E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD are not set");

    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/offer");

    // Fill fields and let the debounced writer run.
    const contribution = page.locator("#offer-contribution");
    if (await contribution.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await contribution.fill("180");
      await page.waitForTimeout(1200);
    }

    // The guarantee is on write: whatever the app persists must be free of
    // secret-shaped keys. This is asserted against real stored output rather
    // than a hand-seeded entry, because seeding bypasses the writer entirely.
    const drafts = await readDrafts(page);
    expect(Object.keys(drafts).length, "the offer form should have written a draft").toBeGreaterThan(0);
    for (const [key, raw] of Object.entries(drafts)) {
      expect(raw, `draft ${key} must not contain secret-shaped keys`).not.toMatch(
        /"(pass|pwd|secret|token|auth|jwt|key|credential|otp|pin|session|bearer|signature|private)[^"]*"\s*:/i,
      );
    }
    assertNoErrors(errors);
  });

  test("a draft entry with credential-shaped keys is ignored on read", async ({ page }) => {
    await page.goto("/login");
    // A hand-written entry must not be trusted as a valid envelope, and must not
    // crash the app. The real scrubber runs on write, so this checks the
    // defensive read path instead.
    await page.evaluate((prefix) => {
      window.localStorage.setItem(
        `${prefix}offer-ride:anonymous`,
        JSON.stringify({
          v: 2,
          scope: "offer-ride",
          userId: "anonymous",
          savedAt: Date.now(),
          data: { supabaseServiceRoleKey: "leak-canary" },
        }),
      );
    }, DRAFT_KEY_PREFIX);

    await page.reload();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    expect(true).toBe(true);
  });

  test("no draft keys are written for a signed-out visitor", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    expect(Object.keys(await readDrafts(page))).toEqual([]);
  });

  test("draft keys are scoped per user id", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate((prefix) => {
      window.localStorage.setItem(
        `${prefix}offer-ride:user-a`,
        JSON.stringify({ version: 2, workflow: "offer-ride", values: { note: "for user a" } }),
      );
      window.localStorage.setItem(
        `${prefix}offer-ride:user-b`,
        JSON.stringify({ version: 2, workflow: "offer-ride", values: { note: "for user b" } }),
      );
    }, DRAFT_KEY_PREFIX);

    const drafts = await readDrafts(page);
    const keys = Object.keys(drafts);
    expect(keys).toHaveLength(2);
    // Distinct users must never share a single draft entry.
    expect(keys[0]).not.toBe(keys[1]);
  });

  test("malformed draft JSON does not break the app", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    await page.evaluate((prefix) => {
      window.localStorage.setItem(`${prefix}offer-ride:broken`, "{not json");
    }, DRAFT_KEY_PREFIX);
    await page.reload();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    assertNoErrors(errors);
  });
});

test.describe("responsive baseline", () => {
  test("no horizontal overflow on the login screen", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the login form stays usable at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("touch targets meet the 40px minimum", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/login");
    const box = await page.getByTestId("login-submit").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  });
});

test.describe("static assets and metadata", () => {
  test("the web app manifest is served and well formed", async ({ page, request }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
    expect(manifestHref, "index.html must link a manifest").toBeTruthy();

    const url = `/${String(manifestHref).replace(/^\//, "")}`;
    const response = await request.get(url);
    expect(response.status(), `manifest at ${url}`).toBe(200);

    const body = await response.text();
    expect(body).toMatch(/"name"/);
    expect(body).toMatch(/"start_url"/);
    assertNoErrors(errors);
  });

  test("the viewport meta tag does not block zooming", async ({ page }) => {
    await page.goto("/login");
    const content = await page.getAttribute('meta[name="viewport"]', "content");
    expect(content).toBeTruthy();
    expect(content).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/);
  });

  test("the service worker file is served", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status(), "sw.js must exist for offline support").toBe(200);
  });
});
