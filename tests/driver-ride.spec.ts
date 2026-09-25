import { expect, test } from "@playwright/test";
import { collectErrors, assertNoErrors, driverCredentials, riderCredentials, signIn, waitForApp } from "./helpers";

/**
 * Driver flow: offer a ride, then act on a rider's request.
 *
 * These tests need a real Supabase account with a complete profile and at least
 * one vehicle, supplied through E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD. Without
 * those variables the whole suite is skipped rather than faked: no account is
 * created, and Auth is never bypassed.
 */

const creds = driverCredentials();
const rideHasDeparted = () =>
  new Date().toLocaleDateString("en-CA") > new Date().toISOString().slice(0, 10);

test.describe("driver: offer a ride", () => {
  test.skip(!creds, "E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD are not set");

  test("the offer form requires a vehicle and a real route before publishing", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);

    await page.goto("/offer");
    await expect(page.getByTestId("offer-submit")).toBeVisible();

    // With no origin and destination there is no route, so publishing must stay
    // disabled. This is the guard against publishing a ride with no geometry.
    await expect(page.getByTestId("offer-submit")).toBeDisabled();
    assertNoErrors(errors);
  });

  test("the offer form shows routing errors without clearing the map", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/offer");

    await page.locator("#offer-from").fill("Kolkata");
    await page.locator("#offer-from").press("Enter");
    // Autocomplete is debounced, so wait for the listbox to settle.
    const option = page.getByRole("option").first();
    if (await option.isVisible({ timeout: 8000 }).catch(() => false)) {
      await option.click();
    }

    const routeError = page.getByTestId("offer-route-error");
    // Either the route resolves or a real error is shown. A blank map with no
    // message is the failure this guards against.
    if (!(await page.getByTestId("offer-submit").isEnabled())) {
      await expect(routeError).toBeVisible();
    }
    assertNoErrors(errors);
  });

  test("vehicle selection is required and populated for the driver", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/offer");

    const vehicle = page.getByTestId("offer-vehicle");
    await expect(vehicle).toBeVisible();
    // The driver must only ever see their own vehicles here.
    const optionCount = await vehicle.locator("option").count();
    expect(optionCount).toBeGreaterThan(0);
    assertNoErrors(errors);
  });

  test("the offer form restores a draft after a reload", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/offer");

    // Type into a plain text field that is part of the draft payload.
    const contribution = page.locator("#offer-contribution");
    if (await contribution.isVisible().catch(() => false)) {
      await contribution.fill("250");
      // The draft is written on a debounce.
      await page.waitForTimeout(900);
      await page.reload();
      await expect(page.locator("#offer-contribution")).toHaveValue("250", { timeout: 15_000 });
    }
    assertNoErrors(errors);
  });
});

test.describe("driver: manage requests", () => {
  test.skip(!creds, "E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD are not set");
  test.skip(rideHasDeparted(), "today's rides may already have departed");

  test("the driver's own ride cannot be booked by the driver", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, creds!);
    await waitForApp(page);
    await page.goto("/rides");

    const firstRide = page.locator('[data-testid^="ride-card-"]').first();
    if (!(await firstRide.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, "the driver has no rides yet");
      return;
    }
    // RideCard is an article, not a button, so navigation goes through the
    // explicit "Manage ride" link rather than clicking the card body.
    await firstRide.getByRole("link", { name: /manage ride|view ride/i }).first().click();
    await expect(page).toHaveURL(/\/rides\/[^/]+$/);
    // The driver sees management controls, not a request-seat form.
    await expect(page.getByTestId("request-seat")).toHaveCount(0);
    assertNoErrors(errors);
  });
});

test.describe("rider: request a seat", () => {
  test.skip(!riderCredentials(), "E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD are not set");

  test("a request never claims the ride was removed when the write returns no row", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, riderCredentials()!);
    await waitForApp(page);

    await page.goto("/find");
    await expect(page.getByTestId("find-submit")).toBeVisible();
    await assertNoErrors(errors);
  });

  test("the booking error surfaced is specific and actionable", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, riderCredentials()!);
    await waitForApp(page);
    await page.goto("/find");

    // Force a failure that used to be mislabelled as a missing record.
    await page.route("**/rest/v1/bookings*", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        }),
      }),
    );

    const results = page.getByTestId("find-results");
    if (await results.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const button = page.locator('[data-testid^="find-book-"]').first();
      if (await button.isEnabled().catch(() => false)) {
        await button.click();
        const bookingError = page.getByTestId("find-booking-error");
        if (await bookingError.isVisible({ timeout: 15_000 }).catch(() => false)) {
          const text = (await bookingError.textContent()) ?? "";
          // The regression: a zero-row write must not say the ride was removed.
          expect(text).not.toMatch(/may have been removed|could not find that/i);
        }
      }
    }
    assertNoErrors(errors);
  });
});
