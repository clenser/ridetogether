/**
 * Shared error layer for the Supabase-backed repositories.
 *
 * Every repository in this folder follows the same contract:
 *   - queries go through the single client from `services/supabase.ts`
 *   - raw Postgres/PostgREST text is never surfaced to the UI
 *   - failures become `DataError` with a short, user-facing `friendlyMessage`
 */

export type DataErrorAction =
  | "load"
  | "create"
  | "update"
  | "delete"
  | "book"
  | "confirm"
  | "cancel"
  | "complete";

interface ErrorShape {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
}

/** The same parts, normalised to strings so they are always printable. */
type NormalisedErrorShape = {
  code: string;
  message: string;
  status: string;
  details: string;
  hint: string;
};

const readError = (error: unknown): NormalisedErrorShape => {
  const candidate = (typeof error === "object" && error !== null ? error : {}) as ErrorShape;
  return {
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
    status: candidate.status === undefined || candidate.status === null ? "" : String(candidate.status),
    details: typeof candidate.details === "string" ? candidate.details : "",
    hint: typeof candidate.hint === "string" ? candidate.hint : "",
  };
};

/**
 * The parts of a Supabase/PostgREST failure worth keeping once it has been turned
 * into a friendly message. Retained on every `DataError` so a bug report can be
 * answered from a log line without re-running the request, and so the mapping
 * below is inspectable from a test rather than from a browser.
 */
export interface DataErrorDiagnostics {
  /** PostgREST (`PGRST205`) or PostgreSQL SQLSTATE (`42P01`) code, if any. */
  code: string;
  message: string;
  details: string;
  hint: string;
  status: string;
  /** Which operation was being attempted, e.g. `book`. */
  action: DataErrorAction;
}

export class DataError extends Error {
  readonly friendlyMessage: string;
  /** Stable machine-readable reason for UI branching (e.g. duplicate plate). */
  readonly reason: DataErrorReason;
  readonly cause?: unknown;
  readonly diagnostics: DataErrorDiagnostics;

  constructor(
    friendlyMessage: string,
    reason: DataErrorReason = "unknown",
    cause?: unknown,
    action: DataErrorAction = "load",
  ) {
    super(friendlyMessage);
    this.name = "DataError";
    this.friendlyMessage = friendlyMessage;
    this.reason = reason;
    this.cause = cause;
    this.diagnostics = { ...readError(cause), action };
  }
}

export type DataErrorReason =
  | "offline"
  | "forbidden"
  | "not-found"
  | "duplicate"
  | "invalid"
  | "insufficient-seats"
  | "self-booking"
  | "cancelled-ride"
  | "empty-result"
  | "schema"
  | "server-side"
  | "unknown";

const GENERIC: Record<DataErrorAction, string> = {
  load: "We could not load this right now. Please try again.",
  create: "We could not save that. Please try again.",
  update: "We could not update that. Please try again.",
  delete: "We could not remove that. Please try again.",
  book: "We could not send your seat request. Please try again.",
  confirm: "We could not confirm that booking. Please try again.",
  cancel: "We could not cancel that. Please try again.",
  complete: "We could not complete that ride. Please try again.",
};

const NET_PATTERN = /failed to fetch|networkerror|network request failed|load failed|fetch failed|econnrefused/i;
const FORBIDDEN_PATTERN = /row-level security|permission denied|violates row|not authorized|new row violates/i;
const NOT_FOUND_PATTERN = /not found|does not exist|foreign key/i;
/**
 * `PGRST116` is PostgREST's "expected exactly one row, got zero or many". It is
 * routinely mistaken for a missing resource, which is how a failed seat request
 * ended up telling the rider the ride "may have been removed".
 */
const EMPTY_RESULT_PATTERN = /pgrst116|json object requested, multiple \(or no\) rows returned/i;
/**
 * PostgREST could not resolve a table or column that *this app* asked for. The
 * app is genuinely out of step with the database, so this is the only case that
 * deserves the "not in sync" wording.
 */
const SCHEMA_CACHE_PATTERN = /schema cache|pgrst205|pgrst204/i;
/**
 * A bare `relation ... does not exist` / `column ... does not exist` is NOT the
 * same thing. The request resolved fine; something on the server raised the
 * error, and the usual culprit is a trigger or function referencing an object the
 * project does not have. Reporting that as "the app is not in sync" is what sent
 * a failed seat request looking for a stale frontend when the real fault was an
 * unguarded `vault.decrypted_secrets` read inside a notification trigger aborting
 * the booking transaction.
 *
 * Matched on SQLSTATE as well as text: `3F000 invalid_schema_name` - a missing
 * `vault` schema, the other way that same read can fail - shares none of the
 * words "relation" or "column", so on text alone it fell through to
 * `NOT_FOUND_PATTERN` and told a rider their ride "may have been removed".
 */
const SERVER_MISSING_OBJECT_CODES: ReadonlySet<string> = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "3F000", // invalid_schema_name
  "3F001", // invalid_catalog_name
]);
const SERVER_MISSING_OBJECT_PATTERN =
  /relation .* does not exist|column .* does not exist|schema ".*" does not exist/i;
const DUPLICATE_PATTERN = /duplicate key|already exists|unique constraint/i;
const SEATS_PATTERN = /not enough seats/i;
const SELF_BOOKING_PATTERN = /cannot book a seat on their own ride/i;
const CANCELLED_PATTERN = /ride is cancelled|ride is not active|only active rides/i;

const WRITE_ACTIONS: ReadonlySet<DataErrorAction> = new Set<DataErrorAction>([
  "create",
  "update",
  "delete",
  "book",
  "confirm",
  "cancel",
  "complete",
]);

/**
 * Maps a Supabase/PostgREST failure onto a `DataError` with a user-facing
 * message. Business-rule messages raised by our own triggers are matched first
 * so the driver sees why a confirmation failed.
 */
export const toDataError = (error: unknown, action: DataErrorAction): DataError => {
  if (error instanceof DataError) return error;

  const { code, message, status, details, hint } = readError(error);
  const haystack = `${message} ${details} ${hint}`;

  // Development-only, and deliberately the first thing that happens: the exact
  // Postgres error is the only way to tell a deployment gap from a genuine
  // constraint, so it is recorded before any of it is flattened into a
  // user-facing sentence. Never enabled in a production build, and it holds no
  // credentials - the Supabase error body never carries the session token.
  if (import.meta.env?.DEV) {
    console.warn(`[supabase:${action}] failure`, { code, message, details, hint, status });
  }

  const fail = (friendlyMessage: string, reason: DataErrorReason): DataError =>
    new DataError(friendlyMessage, reason, error, action);

  if (SEATS_PATTERN.test(haystack)) {
    return fail(
      "There are not enough seats left on that ride to confirm this request.",
      "insufficient-seats",
    );
  }
  if (SELF_BOOKING_PATTERN.test(haystack)) {
    return fail("You cannot book a seat on your own ride.", "self-booking");
  }
  if (CANCELLED_PATTERN.test(haystack)) {
    return fail("That ride is no longer accepting bookings.", "cancelled-ride");
  }
  if (code === "23505" || DUPLICATE_PATTERN.test(haystack)) {
    return fail("That already exists. Please use a different value.", "duplicate");
  }
  if (
    code === "23514"
    || code === "23503"
    || code === "22P02"
    || /invalid input value|violates check constraint|out of range|bad request/i.test(haystack)
  ) {
    // `GENERIC[action]`, not a hard-coded `update`: telling someone adding their
    // first vehicle "we could not update that" hides both the operation they
    // attempted and the fact that a plain retry will not help.
    return fail(GENERIC[action], "invalid");
  }
  if (code === "42501" || status === "403" || FORBIDDEN_PATTERN.test(haystack)) {
    return fail("You do not have permission to do that.", "forbidden");
  }
  if (code === "PGRST205" || code === "PGRST204" || SCHEMA_CACHE_PATTERN.test(haystack)) {
    return fail("The app is not in sync with the database. Please try again in a moment.", "schema");
  }
  if (SERVER_MISSING_OBJECT_CODES.has(code) || SERVER_MISSING_OBJECT_PATTERN.test(haystack)) {
    // The write was rolled back by the server, so say so: a retry cannot succeed
    // and the member should not go on to re-enter the same details.
    if (WRITE_ACTIONS.has(action)) {
      return fail(
        "We could not save that because of a problem on our side, so nothing was changed. "
        + "Please try again in a moment.",
        "server-side",
      );
    }
    return fail("We could not load this right now. Please try again.", "server-side");
  }
  if (code === "PGRST116" || EMPTY_RESULT_PATTERN.test(haystack)) {
    // On a read this genuinely means the row is not there. On a write it means
    // the statement completed without producing a readable row, which says
    // nothing about whether the row exists - so never claim it was removed.
    if (!WRITE_ACTIONS.has(action)) {
      return fail("We could not find that. It may have been removed.", "not-found");
    }
    return fail(
      "The server accepted the request but did not return the saved record. "
      + "Please refresh to see the current state before trying again.",
      "empty-result",
    );
  }
  if (status === "404" || NOT_FOUND_PATTERN.test(haystack)) {
    return fail("We could not find that. It may have been removed.", "not-found");
  }
  if (code === "failed_to_fetch" || NET_PATTERN.test(haystack)) {
    return fail("We could not reach the server. Check your connection and try again.", "offline");
  }
  return fail(GENERIC[action], "unknown");
};

/** Unwraps a `DataError` message for direct use in a toast or inline error. */
export const describeDataFailure = (error: unknown, action: DataErrorAction): string =>
  toDataError(error, action).friendlyMessage;

/** Supabase returns `numeric`/`bigint` as strings; this normalises them. */
export const toNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

export const toText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
