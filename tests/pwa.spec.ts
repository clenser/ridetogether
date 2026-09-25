import { expect, test } from "@playwright/test";
import { collectErrors, assertNoErrors, expectNoHorizontalOverflow } from "./helpers";

/**
 * The service worker, install prompt and push permissions are the parts of a
 * PWA that regress silently. Headless Chromium cannot grant notifications or
 * prompt for install, so those tests assert the code path and failure handling
 * rather than pretending the prompt appeared.
 */

test.describe("PWA wiring", () => {
  test("the service worker registers on a secure origin", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");

    const registered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const registration = await navigator.serviceWorker.getRegistration();
      return registration ? "registered" : "absent";
    });

    // 127.0.0.1 counts as a secure context, so registration should succeed.
    expect(registered).toBe("registered");
    assertNoErrors(errors);
  });

  test("the service worker returns a response for the offline shell", async ({ request }) => {
    for (const path of ["/sw.js", "/offline.html", "/manifest.webmanifest"]) {
      const response = await request.get(path);
      expect(response.status(), `${path} must be served`).toBe(200);
    }
  });

  test("the offline page is a real document, not the app shell", async ({ request }) => {
    const response = await request.get("/offline.html");
    const body = await response.text();
    expect(body).toMatch(/<title>/i);
    expect(body).toMatch(/offline/i);
  });

  test("the manifest declares a theme colour, icons and a display mode", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = JSON.parse(await response.text()) as {
      name?: string;
      icons?: Array<{ src: string; sizes?: string }>;
      display?: string;
      theme_color?: string;
      background_color?: string;
      start_url?: string;
    };
    expect(manifest.name).toBeTruthy();
    expect(manifest.display).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy();
    // Every declared icon must actually be served.
    for (const icon of manifest.icons ?? []) {
      const iconResponse = await request.get(`/${icon.src.replace(/^\//, "")}`);
      expect(iconResponse.status(), `icon ${icon.src}`).toBe(200);
    }
  });
});

test.describe("push and install prompts degrade safely", () => {
  test("requesting notifications is rejected gracefully in headless Chromium", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");

    const result = await page.evaluate(async () => {
      if (!("Notification" in window)) return "unsupported";
      try {
        return await Notification.requestPermission();
      } catch {
        return "threw";
      }
    });

    // The app must not crash whether the prompt is granted, denied or missing.
    expect(["granted", "denied", "default", "unsupported", "threw"]).toContain(result);
    await expect(page.getByTestId("login-submit")).toBeVisible();
    assertNoErrors(errors);
  });

  test("no unhandled beforeinstallprompt rejection is logged", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    await page.waitForTimeout(1500);
    expect(errors.pageErrors.filter((text) => /beforeinstallprompt/i.test(text))).toEqual([]);
  });
});

test.describe("layout integrity at every supported width", () => {
  const widths = [320, 375, 768, 1024, 1440];

  for (const width of widths) {
    test(`login renders without overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await expect(page.getByTestId("login-submit")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("the unknown-route redirect renders without overflow at every width", async ({ page }) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/no-such-page");
      await expect(page).toHaveURL(/\/login/);
      await expectNoHorizontalOverflow(page);
    }
  });
});
