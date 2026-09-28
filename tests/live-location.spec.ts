import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  assertNoErrors,
  collectErrors,
  driverCredentials,
  riderCredentials,
  signIn,
  waitForApp,
  type ErrorCollector,
} from "./helpers";

/**
 * The passenger live-location contract, end to end, against the real database.
 *
 * The defect this covers was a driver marker that was created correctly and then
 * never moved, so nothing here may be stubbed. MapLibre is real MapLibre, the
 * marker is the real marker, and the driver's position is written through the
 * real `ride_locations` table using the driver's own session - so every assertion
 * also exercises `ride_locations_insert_driver` / `ride_locations_update_driver`,
 * the `guard_ride_location` trigger (which forces `recorded_at = now()`) and
 * `ride_locations_select_participants`.
 *
 * REQUIRED ENVIRONMENT
 *
 * The spec skips, with the exact missing names in the skip reason, unless all of
 * the following are set. It deliberately does not provision them itself: getting
 * a ride to `in_progress` with a `confirmed` passenger means publish, book,
 * accept, complete the payment placeholder and start the ride, and doing that
 * from a test would require a service-role key in a test file.
 *
 *   E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD
 *       Host of the ride below, with a complete profile.
 *   E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD
 *       A passenger holding a `confirmed` booking on that ride. `pending` and
 *       `payment_pending` are excluded by `is_ride_passenger`, so an
 *       unconfirmed booking makes these tests meaningless rather than failing
 *       for a real reason.
 *   E2E_LIVE_RIDE_ID
 *       A ride in `in_progress` status, with real persisted `route_geometry`,
 *       on which the rider above is confirmed.
 *
 * Manual setup: as the driver, Offer a ride along a route that resolves, publish
 * it; as the rider request a seat; as the driver accept it; complete the payment
 * placeholder so the booking reaches `confirmed`; as the driver start the ride.
 */

/** Two fixes roughly 180 m apart, so a frozen marker is unambiguous. */
const FIRST_FIX = { lat: 12.9716, lon: 77.5946 };
const SECOND_FIX = { lat: 12.9732, lon: 77.5963 };

const MARKER = ".ride-map-live";
const REALTIME_SOCKET = "**/realtime/v1/websocket*";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const APIKEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const RIDE_ID = process.env.E2E_LIVE_RIDE_ID?.trim() ?? "";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface Role {
  page: Page;
  context: BrowserContext;
  errors: ErrorCollector;
}

const missingEnvironment = (): string[] => {
  const missing: string[] = [];
  if (!driverCredentials()) missing.push("E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD");
  if (!riderCredentials()) missing.push("E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD");
  if (!RIDE_ID) missing.push("E2E_LIVE_RIDE_ID");
  return missing;
};

/**
 * Writes the driver's position from the driver's own already-authenticated page.
 *
 * This is the same request `reportRideLocation` issues from the geolocation
 * watch, and it is not a service-role shortcut: the access token comes from the
 * driver's persisted session, so RLS and the database trigger both run. If the
 * signed-in user is not the host of this ride, the write is rejected and the
 * assertion below fails - which is the correct outcome.
 *
 * `recorded_at` is intentionally omitted: `guard_ride_location` sets it to
 * `now()` on write, so the fix cannot be backdated.
 */
const publishDriverFix = async (page: Page, lat: number, lon: number): Promise<void> => {
  const outcome = await page.evaluate(
    async ({ rideId, fixLat, fixLon, supabaseUrl, apikey }) => {
      const storageKey = Object.keys(window.localStorage).find(
        (name) => name.startsWith("sb-") && name.includes("auth-token"),
      );
      const raw = storageKey ? window.localStorage.getItem(storageKey) : null;
      if (!raw) return { ok: false, detail: "no persisted Supabase session in localStorage" };

      let accessToken = "";
      try {
        accessToken = (JSON.parse(raw) as { access_token?: string }).access_token ?? "";
      } catch {
        return { ok: false, detail: "persisted session is not readable JSON" };
      }
      if (!accessToken) return { ok: false, detail: "persisted session has no access token" };

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        apikey,
        "Content-Type": "application/json",
      };
      const base = `${supabaseUrl}/rest/v1/ride_locations`;

      // The driver may or may not have published before, so branch on what is
      // already stored rather than assuming one shape.
      const existing = await fetch(`${base}?ride_id=eq.${rideId}&select=id`, { headers, cache: "no-store" });
      if (!existing.ok) {
        return { ok: false, detail: `read existing failed: HTTP ${existing.status} ${await existing.text()}` };
      }
      const rows = (await existing.json()) as unknown[];
      const body = JSON.stringify({ lat: fixLat, lon: fixLon, heading: 90, accuracy_meters: 12 });
      const request =
        rows.length > 0
          ? fetch(`${base}?ride_id=eq.${rideId}`, {
              method: "PATCH",
              headers: { ...headers, Prefer: "return=representation" },
              body,
              cache: "no-store",
            })
          : fetch(base, {
              method: "POST",
              headers: { ...headers, Prefer: "return=representation" },
              body: JSON.stringify({ ride_id: rideId, lat: fixLat, lon: fixLon, heading: 90, accuracy_meters: 12 }),
              cache: "no-store",
            });

      const response = await request;
      const text = await response.text();
      return {
        ok: response.ok,
        detail: `${rows.length > 0 ? "update" : "insert"} returned HTTP ${response.status}: ${text.slice(0, 300)}`,
      };
    },
    { rideId: RIDE_ID, fixLat: lat, fixLon: lon, supabaseUrl: SUPABASE_URL, apikey: APIKEY },
  );

  expect(outcome.ok, `the driver must be able to publish a position for ride ${RIDE_ID}`).toBe(true);
  expect(outcome.detail).toBeTruthy();
};

/**
 * MapLibre's own idea of where the marker is, which is independent of the camera
 * and does not depend on the marker being inside the visible viewport.
 */
const readMarkerTransform = (page: Page): Promise<string | null> =>
  page.evaluate((selector) => {
    const element = document.querySelector(selector);
    return element instanceof HTMLElement ? element.style.transform : null;
  }, MARKER);

const markerCount = (page: Page): Promise<number> =>
  page.evaluate((selector) => document.querySelectorAll(selector).length, MARKER);

const expectMarkerPresent = async (page: Page): Promise<void> => {
  await expect
    .poll(() => markerCount(page), {
      timeout: 30_000,
      message: "the driver marker never appeared, so nothing downstream is meaningful",
    })
    .toBe(1);
};

/** Polls MapLibre's transform until the marker has moved off `before`. */
const expectMarkerMovedFrom = async (page: Page, before: string | null, timeout: number): Promise<void> => {
  await expect
    .poll(
      async () => {
        const after = await readMarkerTransform(page);
        return Boolean(after) && after !== before;
      },
      { timeout, message: "the driver marker never moved to the new coordinate" },
    )
    .toBe(true);
};

const openPassengerRide = async (browser: Browser): Promise<Role> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await signIn(page, riderCredentials()!);
  await waitForApp(page);
  await page.goto(`/rides/${RIDE_ID}`);
  await expect(page.getByTestId("passenger-live-map")).toBeVisible({ timeout: 30_000 });
  return { page, context, errors };
};

const openDriverRide = async (browser: Browser): Promise<Role> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await signIn(page, driverCredentials()!);
  await waitForApp(page);
  await page.goto(`/rides/${RIDE_ID}`);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
  return { page, context, errors };
};

const closeAll = async (...roles: Role[]): Promise<void> => {
  await Promise.all(roles.map((role) => role.context.close()));
};

test.describe("passenger live driver location", () => {
  const missing = missingEnvironment();

  test.skip(
    missing.length > 0,
    `live-location E2E needs a prepared fixture; missing ${missing.join(", ")}. `
    + "See the header comment in tests/live-location.spec.ts for how to build the in_progress ride.",
  );

  test("realtime moves the driver marker without reloading the passenger", async ({ browser }) => {
    const driver = await openDriverRide(browser);
    const passenger = await openPassengerRide(browser);

    try {
      await publishDriverFix(driver.page, FIRST_FIX.lat, FIRST_FIX.lon);
      await expectMarkerPresent(passenger.page);

      const before = await readMarkerTransform(passenger.page);
      expect(before, "the marker must already have a MapLibre transform").toBeTruthy();

      // Prove the passenger page survives the update: a value on its window has
      // to still be there afterwards and the URL must not change.
      await passenger.page.evaluate(() => {
        (window as unknown as { __sentinel?: string }).__sentinel = "kept";
      });
      const urlBefore = passenger.page.url();

      await publishDriverFix(driver.page, SECOND_FIX.lat, SECOND_FIX.lon);
      await expectMarkerMovedFrom(passenger.page, before, 30_000);

      expect(passenger.page.url()).toBe(urlBefore);
      const sentinel = await passenger.page.evaluate(
        () => (window as unknown as { __sentinel?: string }).__sentinel,
      );
      expect(sentinel, "the passenger page reloaded while the driver was moving").toBe("kept");

      // Exactly one marker: a second update path would leave a duplicate behind.
      expect(await markerCount(passenger.page)).toBe(1);

      assertNoErrors(driver.errors);
      assertNoErrors(passenger.errors);
    } finally {
      await closeAll(driver, passenger);
    }
  });

  test("the REST fallback moves the marker when realtime is closed", async ({ browser }) => {
    const driver = await openDriverRide(browser);
    const passenger = await openPassengerRide(browser);

    try {
      // Close realtime on the passenger, after the page is loaded, so the marker
      // can only move via the 3 second fallback read.
      await passenger.page.routeWebSocket(REALTIME_SOCKET, (socket) => {
        socket.close({ code: 1006, reason: "realtime disabled for the fallback test" });
      });
      passenger.errors.allowFailure(
        /realtime|WebSocket|websocket|1006/i,
        "the realtime socket is closed deliberately to force the REST fallback path",
      );

      await publishDriverFix(driver.page, FIRST_FIX.lat, FIRST_FIX.lon);
      await expectMarkerPresent(passenger.page);
      const before = await readMarkerTransform(passenger.page);

      await publishDriverFix(driver.page, SECOND_FIX.lat, SECOND_FIX.lon);
      // The interval is 3s, so allow several ticks.
      await expectMarkerMovedFrom(passenger.page, before, 45_000);

      assertNoErrors(driver.errors);
      assertNoErrors(passenger.errors);
    } finally {
      await closeAll(driver, passenger);
    }
  });

  test("refresh reads the position again without refitting the route", async ({ browser }) => {
    const driver = await openDriverRide(browser);
    const passenger = await openPassengerRide(browser);

    try {
      await publishDriverFix(driver.page, FIRST_FIX.lat, FIRST_FIX.lon);
      await expectMarkerPresent(passenger.page);

      // The exact read the repository is expected to issue: the ride filter, the
      // column list, and no cache-busting parameter appended.
      const locationReads: string[] = [];
      const otherRestReads: string[] = [];
      passenger.page.on("request", (request) => {
        const url = request.url();
        if (!url.includes("/rest/v1/")) return;
        if (url.includes("/ride_locations")) locationReads.push(url);
        else otherRestReads.push(url);
      });

      const urlBefore = passenger.page.url();
      const cameraBefore = await passenger.page.evaluate(() => {
        const canvas = document.querySelector(".passenger-live-map__container canvas");
        return canvas instanceof HTMLElement ? canvas.style.transform : null;
      });

      await passenger.page.getByTestId("live-location-refresh").click();

      await expect
        .poll(
          () => locationReads.filter((url) => new RegExp(`ride_id=eq\\.${UUID}&select=\\*`).test(url)).length,
          { timeout: 15_000, message: "refresh did not issue the expected ride_locations read" },
        )
        .toBeGreaterThan(0);

      expect(
        locationReads.every((url) => !/_live_ts|[?&]_=|\\bcache=/.test(url)),
        `refresh must not add cache-busting parameters, saw: ${locationReads.join(", ")}`,
      ).toBe(true);

      // "Refresh driver location" is not "refresh route": no other table is read,
      // the map is not rebuilt and the camera does not move.
      expect(otherRestReads, "refresh must not read any other table").toEqual([]);
      expect(passenger.page.url()).toBe(urlBefore);
      expect(await markerCount(passenger.page)).toBe(1);
      const cameraAfter = await passenger.page.evaluate(() => {
        const canvas = document.querySelector(".passenger-live-map__container canvas");
        return canvas instanceof HTMLElement ? canvas.style.transform : null;
      });
      expect(cameraAfter, "refresh must not move the camera").toBe(cameraBefore);
      expect(await passenger.page.getByTestId("live-location-error").count()).toBe(0);

      assertNoErrors(driver.errors);
      assertNoErrors(passenger.errors);
    } finally {
      await closeAll(driver, passenger);
    }
  });

  test("a failed refresh keeps the marker and explains the failure", async ({ browser }) => {
    const driver = await openDriverRide(browser);
    const passenger = await openPassengerRide(browser);

    try {
      await publishDriverFix(driver.page, FIRST_FIX.lat, FIRST_FIX.lon);
      await expectMarkerPresent(passenger.page);
      const before = await readMarkerTransform(passenger.page);

      // Break only the location read, and only from now on.
      await passenger.page.route(/\/rest\/v1\/ride_locations/, (route) => route.abort("failed"));
      passenger.errors.allowFailure(
        /ride_locations|ERR_FAILED|net::/i,
        "the location read is aborted deliberately to check the failure path",
      );

      await passenger.page.getByTestId("live-location-refresh").click();

      // An honest error, not a silent success and not a marker snapped to origin.
      await expect(passenger.page.getByTestId("live-location-error")).toBeVisible();
      await expect(passenger.page.getByTestId("live-location-error")).toContainText(/could not|position|location/i);
      expect(await markerCount(passenger.page), "the existing marker must survive a failed read").toBe(1);
      expect(await readMarkerTransform(passenger.page), "the marker must not move on a failed read").toBe(before);

      // The background poll is failing too, which is expected for this test.
      assertNoErrors(driver.errors);
      assertNoErrors(passenger.errors);
    } finally {
      await closeAll(driver, passenger);
    }
  });
});
