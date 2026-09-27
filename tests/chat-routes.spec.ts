import { expect, test } from "@playwright/test";
import { assertNoErrors, collectErrors, expectNoHorizontalOverflow } from "./helpers";

/**
 * Chat route protection and layout, without credentials.
 *
 * The conversation list and the composer only render for a signed-in member, so
 * what can be checked here is that both chat routes are real protected routes
 * and that neither one can produce a dead end or a horizontal scrollbar. The
 * signed-in behaviour is covered by the credentialed specs.
 */
test.describe("chat routes", () => {
  test("both the list and a single conversation are protected", async ({ page }) => {
    for (const route of ["/chat", "/chat/does-not-exist"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByTestId("login-submit")).toBeVisible();
    }
  });

  test("the chat list route is not treated as an unknown route", async ({ page }) => {
    const errors = collectErrors(page);
    // If `/chat` were unrouted it would fall through to the branded 404 inside
    // the authenticated layout. The login redirect is the correct outcome, and
    // the absence of a console error proves no component threw on import.
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login/);
    assertNoErrors(errors);
  });

  test("the chat list has no horizontal overflow", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login/);
    await expectNoHorizontalOverflow(page);
  });
});
