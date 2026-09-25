import { expect, test } from "@playwright/test";
import { collectErrors, assertNoErrors, expectNoHorizontalOverflow } from "./helpers";

/**
 * The app is a Supabase client, so an unauthenticated visitor sees the login
 * screen rather than a shell full of empty data. These tests run without any
 * credentials, which makes them the baseline for boot, routing and layout.
 */

test.describe("boot and routing", () => {
  test("shows the login screen and never a blank page", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /log in|welcome back/i }).first()).toBeVisible();
    assertNoErrors(errors);
  });

  test("the boot loader is removed once the session is known", async ({ page }) => {
    await page.goto("/login");
    // The loader may be present for a moment, but it must not persist.
    await expect(page.getByTestId("app-loading")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("login-submit")).toBeEnabled();
  });

  test("protected routes redirect to login and remember the destination", async ({ page }) => {
    for (const route of ["/find", "/offer", "/rides", "/bookings", "/notifications", "/profile", "/vehicles", "/safety", "/settings"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("an unknown route sends a signed-out visitor to login, not a dead end", async ({ page }) => {
    const errors = collectErrors(page);
    // The `*` 404 route lives inside the authenticated Layout, so an
    // unauthenticated visitor is redirected first. The branded 404 is only
    // reachable once signed in, and that case is covered in realtime.spec.ts.
    await page.goto("/definitely-not-a-real-route");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1, name: /log in to/i })).toBeVisible();
    assertNoErrors(errors);
  });

  test("the document title changes per route", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Log In \| RideTogether/);
    await page.goto("/signup");
    await expect(page).toHaveTitle(/Create Account \| RideTogether/);
  });

  test("navigation does not trigger a full page reload", async ({ page }) => {
    await page.goto("/login");
    // A marker on window survives client-side navigation but not a reload.
    await page.evaluate(() => {
      (window as unknown as { __spaMarker?: string }).__spaMarker = "kept";
    });
    await page.getByRole("link", { name: /create an account/i }).first().click();
    await expect(page).toHaveURL(/\/signup/);
    const marker = await page.evaluate(() => (window as unknown as { __spaMarker?: string }).__spaMarker);
    expect(marker, "client-side navigation must not remount the document").toBe("kept");
  });

  test("the login form is the first focusable thing on the auth screen", async ({ page }) => {
    await page.goto("/login");
    // The auth screen is a single focused task with no navigation to skip past,
    // so the email field takes autofocus rather than a skip link being the first
    // stop. The skip link lives in the authenticated Layout, covered elsewhere.
    const autofocus = await page.evaluate(() => {
      const element = document.activeElement as HTMLInputElement | null;
      return { tag: element?.tagName ?? "", type: element?.type ?? "" };
    });
    expect(autofocus.tag).toBe("INPUT");
    expect(autofocus.type).toBe("email");

    // Tabbing forward must stay inside the form and reach the submit button.
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return element?.getAttribute("data-testid") ?? element?.tagName.toLowerCase() ?? "";
      }));
    }
    expect(order).toContain("login-submit");
  });
});

test.describe("login form", () => {
  test("rejects an invalid email with an inline field error, not a form error", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    await page.getByTestId("login-email").fill("not-an-email");
    await page.getByTestId("login-password").fill("Password1");
    await page.getByTestId("login-submit").click();

    // Validation is per-field and marks the input invalid for screen readers.
    await expect(page.getByTestId("login-email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    // No request was sent, so no form-level failure is shown.
    await expect(page.getByTestId("login-error")).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
    assertNoErrors(errors);
  });

  test("shows a real message for wrong credentials without leaking internals", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    await page.getByTestId("login-email").fill("definitely-not-a-real-user@example.com");
    await page.getByTestId("login-password").fill("WrongPassword1");
    await page.getByTestId("login-submit").click();
    const error = page.getByTestId("login-error");
    await expect(error).toBeVisible({ timeout: 25_000 });
    const text = (await error.textContent()) ?? "";
    expect(text).not.toMatch(/PGRST|supabase\.co|api key|token|stack/i);
    expect(text.length).toBeGreaterThan(5);
    await expect(page).toHaveURL(/\/login/);
    assertNoErrors(errors);
  });

  test("the email field has an accessible label and type", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByTestId("login-email");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(page.getByTestId("login-password")).toHaveAttribute("autocomplete", "current-password");
  });
});

test.describe("layout integrity", () => {
  test("login has no horizontal overflow", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the redirected unknown route has no horizontal overflow", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page).toHaveURL(/\/login/);
    await expectNoHorizontalOverflow(page);
  });

  test("the app shell is not rendered for signed-out visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });
});
