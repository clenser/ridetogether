import { expect, test, type Page } from "@playwright/test";
import { collectErrors, assertNoErrors } from "./helpers";

/**
 * Loading-UX contract.
 *
 * Two rules, and they are enforced at different levels:
 *
 * 1. The full-page loader is copy-free. It shows the logo and a spinner, never
 *    a technical explanation. Asserted with a MutationObserver installed before
 *    any app code runs, so even a loader that is visible for a single frame is
 *    captured and inspected.
 * 2. Once the app has booted, the full-page loader never returns. Background
 *    work is signalled by a non-blocking indicator instead.
 *
 * These run signed out, so they need no credentials. Authenticated equivalents
 * live in `session-resume.spec.ts`.
 */

const BANNED = /supabase|session|restor|profile fetch|database|authenticat|token|\.env|VITE_/i;

/**
 * Records the text of every full-page loader that is ever inserted, before the
 * app boots. The boot loader can appear for a single frame, so polling from the
 * test would race it; an observer cannot.
 */
const trackLoaderText = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __loaderTexts: string[] }).__loaderTexts = store;
    const observer = new MutationObserver(() => {
      for (const el of document.querySelectorAll('[data-testid="app-loading"]')) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text && !store.includes(text)) store.push(text);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
};

const loaderTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __loaderTexts: string[] }).__loaderTexts ?? []);

/**
 * The loader may only ever contain the wordmark plus a short screen-reader
 * label. Anything sentence-shaped is a technical explanation leaking to the UI.
 */
const expectBrandedLoaderCopy = (texts: string[]): void => {
  expect(texts.length, "the boot loader should have been observed at least once").toBeGreaterThan(0);
  for (const text of texts) {
    expect(text, `loader copy must be brand-only, saw: ${text}`).toMatch(/^RideTogether[A-Za-z ]*$/);
    expect(text, `loader copy must be free of technical wording, saw: ${text}`).not.toMatch(BANNED);
  }
};

test.describe("loading presentation", () => {
  test("the boot loader is branded and never explains itself", async ({ page }) => {
    const errors = collectErrors(page);
    await trackLoaderText(page);

    await page.goto("/");
    await expect(page.getByTestId("login-submit")).toBeVisible();

    expectBrandedLoaderCopy(await loaderTexts(page));
    assertNoErrors(errors);
  });

  test("the boot loader is copy-free on a protected route too", async ({ page }) => {
    const errors = collectErrors(page);
    await trackLoaderText(page);

    await page.goto("/vehicles");
    await expect(page.getByTestId("login-submit")).toBeVisible();

    expectBrandedLoaderCopy(await loaderTexts(page));
    assertNoErrors(errors);
  });

  test("the loader is gone once a route has settled, and never survives it", async ({ page }) => {
    const errors = collectErrors(page);
    await trackLoaderText(page);

    for (const route of ["/login", "/signup", "/forgot-password", "/no-such-route", "/login"]) {
      await page.goto(route);
      // A settled page never has the full-page loader in the document.
      await expect(page.getByTestId("app-loading")).toHaveCount(0);
      // Each `goto` is a fresh document, so the init script restarts the record.
      // Anything recorded for the document we just left must still be brand-only.
      expectBrandedLoaderCopy(await loaderTexts(page));
    }
    assertNoErrors(errors);
  });

  test("no technical wording is rendered on the signed-out screens", async ({ page }) => {
    for (const route of ["/login", "/signup", "/forgot-password"]) {
      await page.goto(route);
      await expect(page.getByTestId("app-loading")).toHaveCount(0);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      expect(body, `${route} must not mention implementation details`).not.toMatch(BANNED);
    }
  });
});
