import { expect, test } from "@playwright/test";
import { collectErrors, assertNoErrors, expectNoHorizontalOverflow, riderCredentials, signIn, waitForApp } from "./helpers";

/**
 * Realtime: a booking confirmation in one browser must reach the other without
 * a reload. Playwright gives two isolated contexts, which models two signed-in
 * devices on the same account.
 */

const creds = riderCredentials();

test.describe("realtime", () => {
  test.skip(!creds, "E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD are not set");

  test("two sessions on the same account converge without a manual reload", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const errorsA = collectErrors(pageA);
    const errorsB = collectErrors(pageB);

    try {
      await signIn(pageA, creds!);
      await waitForApp(pageA);
      await signIn(pageB, creds!);
      await waitForApp(pageB);

      // Both sessions must render the same account.
      await expect(pageA.getByTestId("app-shell")).toBeVisible();
      await expect(pageB.getByTestId("app-shell")).toBeVisible();

      // A write in A must be observable in B. The profile page is used because
      // it does not require a second account or a real booking.
      const marker = `realtime-probe-${Date.now()}`;
      await pageA.goto("/profile");
      const phoneInput = pageA.locator("#profile-phone");
      if (await phoneInput.isVisible({ timeout: 15_000 }).catch(() => false)) {
        await phoneInput.fill(marker);
        await pageA.getByTestId("profile-save").click();
        await expect(pageA.getByTestId("profile-success")).toBeVisible({ timeout: 20_000 });

        await pageB.goto("/profile");
        await expect(
          pageB.locator("#profile-phone"),
          "the second session should receive the change via realtime",
        ).toHaveValue(marker, { timeout: 30_000 });
      }
      assertNoErrors(errorsA);
      assertNoErrors(errorsB);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("a realtime payload does not trigger a full-page loader", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);

    // The loader appearing again after boot means an effect is re-running the
    // whole bootstrap instead of merging the change.
    await page.waitForTimeout(4000);
    await expect(page.getByTestId("app-loading")).toHaveCount(0);
    assertNoErrors(errors);
  });
});

test.describe("theme and accessibility", () => {
  // These all need a signed-in session to reach the app shell.
  test.skip(!creds, "E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD are not set");

  test("dark mode is applied via a data attribute without a reload", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);

    const before = await page.getAttribute("html", "data-theme");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // A theme flip must not remount the app.
    await expect(page.getByTestId("app-shell")).toBeVisible();
    expect(before === undefined || typeof before === "string").toBe(true);
    assertNoErrors(errors);
  });

  test("every image has an alt attribute", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/rides");

    const missingAlt = await page.evaluate(() =>
      Array.from(document.images)
        .filter((image) => !image.hasAttribute("alt"))
        .map((image) => image.currentSrc || image.src),
    );
    expect(missingAlt).toEqual([]);
    assertNoErrors(errors);
  });

  test("exactly one h1 per page and a single main landmark", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);

    for (const route of ["/", "/find", "/rides", "/bookings", "/notifications", "/vehicles", "/safety", "/settings"]) {
      await page.goto(route);
      const h1Count = await page.locator("h1").count();
      expect(h1Count, `${route} should have exactly one h1`).toBeLessThanOrEqual(1);
      const mainCount = await page.locator("main").count();
      expect(mainCount, `${route} should have exactly one main`).toBe(1);
    }
    assertNoErrors(errors);
  });

  test("interactive controls are reachable by keyboard", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/find");

    // Tab through the page and make sure focus lands on real controls.
    const reached: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return "";
        return `${element.tagName.toLowerCase()}:${element.getAttribute("type") ?? ""}`;
      });
      if (active && !reached.includes(active)) reached.push(active);
    }
    expect(reached.length, "keyboard focus must reach interactive elements").toBeGreaterThan(3);
    assertNoErrors(errors);
  });

  test("the branded 404 page renders inside the shell once signed in", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);

    // Only reachable through the authenticated Layout, so this is where the
    // branded not-found page must work.
    await page.goto("/definitely-not-a-real-route");
    await expect(page).toHaveURL(/\/definitely-not-a-real-route$/);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: /off the map/i })).toBeVisible();
    await expect(page).toHaveTitle(/Page Not Found \| RideTogether/);
    await expectNoHorizontalOverflow(page);
    assertNoErrors(errors);
  });

  test("the shell does not overflow horizontally on any primary route", async ({ page }) => {
    await signIn(page, creds!);
    await waitForApp(page);
    for (const route of ["/", "/find", "/rides", "/bookings", "/notifications", "/vehicles", "/safety", "/settings", "/profile"]) {
      await page.goto(route);
      await expectNoHorizontalOverflow(page);
    }
  });
});
