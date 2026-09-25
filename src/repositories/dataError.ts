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

export class DataError extends Error {
  readonly friendlyMessage: string;
  /** Stable machine-readable reason for UI branching (e.g. duplicate plate). */
  readonly reason: DataErrorReason;
  readonly cause?: unknown;

  constructor(friendlyMessage: string, reason: DataErrorReason = "unknown", cause?: unknown) {
    super(friendlyMessage);
    this.name = "DataError";
    this.friendlyMessage = friendlyMessage;
    this.reason = reason;
    this.cause = cause;
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
  | "unknown";

interface ErrorShape {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
}

const readError = (error: unknown): Required<ErrorShape> => {
  const candidate = (typeof error === "object" && error !== null ? error : {}) as ErrorShape;
  return {
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
    status: candidate.status === undefined || candidate.status === null ? "" : String(candidate.status),
    details: typeof candidate.details === "string" ? candidate.details : "",
    hint: typeof candidate.hint === "string" ? candidate.hint : "",
  };
};

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
 * A missing table or column is a deployment problem, not a missing record, so it
 * must not be reported as "we could not find that".
 */
const SCHEMA_PATTERN = /relation .* does not exist|column .* does not exist|schema cache|pgrst205|pgrst204/i;
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
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    console.warn(`[supabase:${action}] unmapped failure`, readError(error));
  }

  const { code, message, status, details, hint } = readError(error);
  const haystack = `${message} ${details} ${hint}`;

  if (SEATS_PATTERN.test(haystack)) {
    return new DataError(
      "There are not enough seats left on that ride to confirm this request.",
      "insufficient-seats",
      error,
    );
  }
  if (SELF_BOOKING_PATTERN.test(haystack)) {
    return new DataError("You cannot book a seat on your own ride.", "self-booking", error);
  }
  if (CANCELLED_PATTERN.test(haystack)) {
    return new DataError("That ride is no longer accepting bookings.", "cancelled-ride", error);
  }
  if (code === "23505" || DUPLICATE_PATTERN.test(haystack)) {
    return new DataError("That already exists. Please use a different value.", "duplicate", error);
  }
  if (
    code === "23514"
    || code === "23503"
    || code === "22P02"
    || /invalid input value|violates check constraint|out of range|bad request/i.test(haystack)
  ) {
    return new DataError(GENERIC.update, "invalid", error);
  }
  if (code === "42501" || status === "403" || FORBIDDEN_PATTERN.test(haystack)) {
    return new DataError("You do not have permission to do that.", "forbidden", error);
  }
  if (code === "PGRST205" || code === "PGRST204" || SCHEMA_PATTERN.test(haystack)) {
    return new DataError(
      "The app is not in sync with the database. Please try again in a moment.",
      "schema",
      error,
    );
  }
  if (code === "PGRST116" || EMPTY_RESULT_PATTERN.test(haystack)) {
    // On a read this genuinely means the row is not there. On a write it means
    // the statement completed without producing a readable row, which says
    // nothing about whether the row exists - so never claim it was removed.
    if (!WRITE_ACTIONS.has(action)) {
      return new DataError("We could not find that. It may have been removed.", "not-found", error);
    }
    return new DataError(
      "The server accepted the request but did not return the saved record. "
      + "Please refresh to see the current state before trying again.",
      "empty-result",
      error,
    );
  }
  if (status === "404" || NOT_FOUND_PATTERN.test(haystack)) {
    return new DataError("We could not find that. It may have been removed.", "not-found", error);
  }
  if (code === "failed_to_fetch" || NET_PATTERN.test(haystack)) {
    return new DataError("We could not reach the server. Check your connection and try again.", "offline", error);
  }
  return new DataError(GENERIC[action], "unknown", error);
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
