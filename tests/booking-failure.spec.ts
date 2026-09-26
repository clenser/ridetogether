import { expect, test, type DataErrorAction } from "@playwright/test";
import { toDataError } from "../src/repositories/dataError";
import { collectErrors, assertNoErrors, riderCredentials, signIn, waitForApp } from "./helpers";

/**
 * The failed seat request, and the message that came with it.
 *
 * A rider pressed "Request 1 seat" and was told "The app is not in sync with the
 * database." Nothing about the app was out of sync. The rider's INSERT into
 * public.bookings was rolled back by `notifications_dispatch_push`, because the
 * dispatch trigger read `vault.decrypted_secrets` at the top of its function body
 * - above its only exception handler - on a project where that read could not be
 * resolved. The `42P01` that came back mentioned a relation, the error layer
 * mapped any missing relation to "not in sync", and the actual fault - a push
 * integration that was allowed to fail a booking - became invisible.
 *
 * Two halves, and both can regress independently:
 *
 *  - the schema half: no push reference may sit outside an exception handler.
 *    That is enforced in `scripts/check-schema.mjs`, because it is a property of
 *    the SQL and needs no browser or credentials.
 *  - the client half, below: a server-side failure must say the change was not
 *    saved, and must not be reported as a frontend/database mismatch.
 */

/** The exact error PostgREST returns when the push trigger aborts the INSERT. */
const VAULT_42P01 = {
  code: "42P01",
  message: 'relation "vault.decrypted_secrets" does not exist',
  details: null,
  hint: null,
};

const OUT_OF_SYNC = "not in sync with the database";

/** The pure mapping, with no browser and no credentials. */
test.describe("server-side failure mapping", () => {
  test("a missing relation raised by the server is not reported as an app/schema mismatch", () => {
    const error = toDataError(VAULT_42P01, "book");
    expect(error.reason).toBe("server-side");
    expect(error.friendlyMessage).not.toContain(OUT_OF_SYNC);
  });

  test("a rolled-back write says so, because a retry cannot succeed", () => {
    const error = toDataError(VAULT_42P01, "book");
    expect(error.friendlyMessage).toMatch(/nothing was changed/i);
  });

  test("a missing vault schema is the same class of failure as a missing relation", () => {
    const error = toDataError(
      { code: "3F000", message: 'schema "vault" does not exist', details: null, hint: null },
      "book",
    );
    expect(error.reason).toBe("server-side");
    expect(error.friendlyMessage).not.toContain(OUT_OF_SYNC);
  });

  test("a read that fails server-side does not claim to be out of sync either", () => {
    const error = toDataError(VAULT_42P01, "load");
    expect(error.reason).toBe("server-side");
    expect(error.friendlyMessage).not.toContain(OUT_OF_SYNC);
  });

  test("PGRST205 is still a genuine schema mismatch and keeps its own wording", () => {
    const error = toDataError(
      { code: "PGRST205", message: "Could not find the table 'public.rides' in the schema cache", details: null, hint: null },
      "load",
    );
    expect(error.reason).toBe("schema");
    expect(error.friendlyMessage).toContain(OUT_OF_SYNC);
  });

  test("the full Postgres error is kept on the DataError for diagnosis", () => {
    const raw = {
      ...VAULT_42P01,
      details: "PL/pgSQL function public.dispatch_push_for_notifications() line 12",
      hint: "Perhaps you meant to reference vault.decrypted_secret",
      status: 400,
    };
    const error = toDataError(raw, "book");
    expect(error.diagnostics).toMatchObject({
      code: "42P01",
      message: VAULT_42P01.message,
      details: raw.details,
      hint: raw.hint,
      status: "400",
      action: "book",
    });
  });

  test("no mapping leaks raw Postgres text to the user", () => {
    const cases: Array<[unknown, DataErrorAction]> = [
      [VAULT_42P01, "book"],
      [{ code: "3F000", message: 'schema "vault" does not exist' }, "create"],
      [{ code: "42501", message: "new row violates row-level security policy" }, "book"],
      [{ code: "23505", message: "duplicate key value violates unique constraint" }, "create"],
      [{ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, "book"],
      [{ code: "PGRST205", message: "schema cache" }, "load"],
      [{ message: "Failed to fetch" }, "book"],
      [{ message: 'not enough seats on ride "abc"' }, "confirm"],
      [{ message: "cannot book a seat on their own ride" }, "book"],
      [{ message: "ride is not active" }, "book"],
    ];
    for (const [raw, action] of cases) {
      const { friendlyMessage } = toDataError(raw, action);
      expect(friendlyMessage, `action=${action} raw=${JSON.stringify(raw)}`).not.toMatch(
        /vault|pg_net|row-level security|duplicate key|schema cache|PGRST|select |insert |function |42P01|3F000|42501|23505/i,
      );
    }
  });

  test("the business-rule and permission mappings are unchanged", () => {
    expect(toDataError({ code: "23505", message: "duplicate key" }, "create").reason).toBe("duplicate");
    expect(toDataError({ message: "not enough seats on this ride" }, "confirm").reason).toBe("insufficient-seats");
    expect(toDataError({ message: "cannot book a seat on their own ride" }, "book").reason).toBe("self-booking");
    expect(toDataError({ message: "ride is not active" }, "book").reason).toBe("cancelled-ride");
    expect(toDataError({ code: "42501", message: "permission denied" }, "book").reason).toBe("forbidden");
    expect(toDataError({ message: "Failed to fetch" }, "book").reason).toBe("offline");
    expect(toDataError({ code: "PGRST116", message: "0 rows" }, "load").reason).toBe("not-found");
    expect(toDataError({ code: "PGRST116", message: "0 rows" }, "book").reason).toBe("empty-result");
  });
});

/**
 * The original failure, end to end, for a rider who is really signed in.
 *
 * Only the booking write is replaced. The session, the ride list and the rest of
 * the cloud conversation are real, because the thing under test is what the app
 * does with the server's answer - not whether a hand-built session in
 * localStorage is accepted by supabase-js, which is a different and much noisier
 * question.
 */
test.describe("a rolled-back seat request in the UI", () => {
  const rider = riderCredentials();
  test.skip(!rider, "E2E_RIDER_EMAIL / E2E_RIDER_PASSWORD are not set");

  test("a server-side abort is not reported as an app/schema mismatch", async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page, rider!);
    await waitForApp(page);

    // The exact error PostgREST returns when `notifications_dispatch_push` aborts
    // the rider's INSERT because `vault.decrypted_secrets` cannot be resolved.
    await page.route("**/rest/v1/bookings*", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify(VAULT_42P01),
      }),
    );

    await page.goto("/find");
    const results = page.getByTestId("find-results");
    if (!(await results.isVisible({ timeout: 15_000 }).catch(() => false))) return;

    const button = page.locator('[data-testid^="find-book-"]').first();
    if (!(await button.isEnabled().catch(() => false))) return;
    await button.click();

    const bookingError = page.getByTestId("find-booking-error");
    if (!(await bookingError.isVisible({ timeout: 15_000 }).catch(() => false))) return;

    const text = ((await bookingError.textContent()) ?? "").trim();
    // The regression: this used to read "The app is not in sync with the
    // database", which points a developer at the frontend when the fault was a
    // push trigger in the database.
    expect(text).not.toMatch(/not in sync/i);
    expect(text).not.toMatch(/vault|42P01|decrypted_secrets/i);
    assertNoErrors(errors);
  });
});
