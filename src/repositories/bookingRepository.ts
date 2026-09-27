import type { Booking, BookingStatus, MatchScore, PickupPoint } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed booking data.
 *
 * Seat accounting is never done in React. The
 * `bookings_apply_seat_change` trigger in `supabase/schema.sql` owns every
 * increment and restore, and `enforce_booking_status_transition` decides which
 * transitions are legal and who may make them, so this repository only ever
 * sends a target state and then re-reads the authoritative row.
 *
 * The full path, and who drives each step:
 *
 *   rider   pending           requestBooking
 *   host    payment_pending   acceptBooking        (seat is held from here)
 *   rider   -                 openPayment
 *   host    confirmed         resolvePayment(success)
 *   host    picked_up         markPickedUp
 *   ride    completed         rideRepository.completeRide
 */

const BOOKING_TABLE = "bookings";
const BOOKING_COLUMNS =
  "id, ride_id, rider_id, seats, status,"
  + " pickup_lat, pickup_lon, pickup_label, walk_distance_km, pickup_detour_km, pickup_detour_minutes,"
  + " dropoff_lat, dropoff_lon, dropoff_label, dropoff_detour_km, dropoff_detour_minutes,"
  + " fare_amount, match_score, picked_up_at, no_show_at, driver_approaching_notified_at,"
  + " created_at, updated_at";

export interface BookingRow {
  id: string;
  ride_id: string;
  rider_id: string;
  seats: number;
  status: string;
  pickup_lat: number | null;
  pickup_lon: number | null;
  pickup_label: string | null;
  walk_distance_km: number | null;
  pickup_detour_km: number | null;
  pickup_detour_minutes: number | null;
  dropoff_lat: number | null;
  dropoff_lon: number | null;
  dropoff_label: string | null;
  dropoff_detour_km: number | null;
  dropoff_detour_minutes: number | null;
  fare_amount: number | null;
  match_score: number | null;
  picked_up_at: string | null;
  no_show_at: string | null;
  driver_approaching_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

const KNOWN_BOOKING_STATUSES: readonly BookingStatus[] = [
  "pending",
  "payment_pending",
  "confirmed",
  "picked_up",
  "completed",
  "rejected",
  "cancelled",
  "no_show",
];

const rowToBookingStatus = (value: unknown): BookingStatus => {
  const status = toText(value, "pending") as BookingStatus;
  return KNOWN_BOOKING_STATUSES.includes(status) ? status : "pending";
};

const toPickupPoint = (
  lat: number | null,
  lon: number | null,
  label: string | null,
  walkKm?: number | null,
  detourKm?: number | null,
  detourMinutes?: number | null,
): PickupPoint | undefined => {
  if (lat == null || lon == null) return undefined;
  return {
    lat,
    lon,
    label: toText(label),
    walkDistanceKm: walkKm == null ? undefined : toNumber(walkKm, 0),
    detourKm: detourKm == null ? undefined : toNumber(detourKm, 0),
    detourMinutes: detourMinutes == null ? undefined : toNumber(detourMinutes, 0),
  };
};

export const rowToBooking = (row: BookingRow): Booking => ({
  id: row.id,
  rideId: row.ride_id,
  riderId: row.rider_id,
  seats: toNumber(row.seats, 1),
  status: rowToBookingStatus(row.status),
  pickup: toPickupPoint(
    row.pickup_lat,
    row.pickup_lon,
    row.pickup_label,
    row.walk_distance_km,
    row.pickup_detour_km,
    row.pickup_detour_minutes,
  ),
  dropoff: toPickupPoint(
    row.dropoff_lat,
    row.dropoff_lon,
    row.dropoff_label,
    null,
    row.dropoff_detour_km,
    row.dropoff_detour_minutes,
  ),
  fareAmount: row.fare_amount == null ? undefined : toNumber(row.fare_amount, 0),
  pickedUpAt: row.picked_up_at ? toText(row.picked_up_at) : undefined,
  noShowAt: row.no_show_at ? toText(row.no_show_at) : undefined,
  driverApproachingNotifiedAt: row.driver_approaching_notified_at
    ? toText(row.driver_approaching_notified_at)
    : undefined,
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

/** Bookings the rider made, newest first. */
export const listMyBookings = async (): Promise<Booking[]> => {
  const riderId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(BOOKING_TABLE)
    .select(BOOKING_COLUMNS)
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<BookingRow[]>();

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as BookingRow[]).map(rowToBooking);
};

/**
 * Bookings other riders made on the signed-in user's rides. RLS restricts this
 * to the driver, so a non-driver simply gets an empty list.
 */
export const listBookingRequestsForMyRides = async (): Promise<Booking[]> => {
  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data: rideRows, error: rideError } = await client
    .from("rides")
    .select("id")
    .eq("driver_id", driverId);
  if (rideError) throw toDataError(rideError, "load");

  const rideIds = ((rideRows ?? []) as { id: string }[]).map((row) => row.id);
  if (rideIds.length === 0) return [];

  const { data, error } = await client
    .from(BOOKING_TABLE)
    .select(BOOKING_COLUMNS)
    .in("ride_id", rideIds)
    .neq("rider_id", driverId)
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<BookingRow[]>();

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as BookingRow[]).map(rowToBooking);
};

export const listAllVisibleBookings = async (): Promise<Booking[]> => {
  const [mine, requests] = await Promise.all([listMyBookings(), listBookingRequestsForMyRides()]);
  const merged = new Map<string, Booking>();
  for (const booking of [...mine, ...requests]) merged.set(booking.id, booking);
  return [...merged.values()];
};

export const getBookingById = async (bookingId: string): Promise<Booking | null> => {
  if (!bookingId) return null;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(BOOKING_TABLE)
    .select(BOOKING_COLUMNS)
    .eq("id", bookingId)
    .returns<BookingRow>()
    .maybeSingle();

  if (error) throw toDataError(error, "load");
  return data ? rowToBooking(data as BookingRow) : null;
};

/**
 * Requests seats as the authenticated rider.
 *
 * `options.pickup` and `options.dropoff` are the meeting points the rider and
 * the app agreed on for this ride - normally points on the driver's own route,
 * produced by `buildPickupProposal`. They are stored with the request so the
 * host can see exactly where they expect to be collected, and so the measured
 * walk and detour travel with the booking instead of having to be recomputed
 * later. The host may adjust both when they accept.
 *
 * The ride is read first only to produce a good error message when it is gone,
 * full, or the caller's own - the authoritative checks are the RLS policies, the
 * CHECK constraints, and the `bookings_prevent_self_booking` trigger.
 */
export const requestBooking = async (
  rideId: string,
  seats: number,
  options: { pickup?: PickupPoint; dropoff?: PickupPoint; match?: MatchScore } = {},
): Promise<Booking> => {
  if (!rideId) throw new DataError("That ride could not be found.", "not-found");
  if (!Number.isInteger(seats) || seats < 1 || seats > 12) {
    throw new DataError("Choose between 1 and 12 seats.", "invalid");
  }

  const riderId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data: rideRows, error: rideError } = await client
    .from("rides")
    .select("id, driver_id, status, seats_available, total_seats")
    .eq("id", rideId)
    .maybeSingle();
  if (rideError) throw toDataError(rideError, "load");

  const ride = rideRows as
    | { id: string; driver_id: string; status: string; seats_available: number; total_seats: number }
    | null;
  if (!ride) throw new DataError("That ride no longer exists.", "not-found");
  if (ride.driver_id === riderId) {
    throw new DataError("You cannot book a seat on your own ride.", "self-booking");
  }
  if (ride.status === "cancelled") {
    throw new DataError("That ride has been cancelled.", "cancelled-ride");
  }
  if (ride.status === "completed") {
    throw new DataError("That ride has already finished.", "cancelled-ride");
  }
  if (ride.status === "in_progress") {
    throw new DataError("That ride is already under way, so it is not taking new passengers.", "cancelled-ride");
  }
  /**
   * Capacity is checked here rather than only at confirmation time. Without it a
   * rider could ask for more seats than the ride has, the request would sit in
   * `pending` forever, and the failure would only surface when the driver tried
   * to confirm it - which reads to the rider as "Request Seat is broken".
   */
  const available = toNumber(ride.seats_available, 0);
  if (available < 1) {
    throw new DataError("There are no seats left on that ride.", "insufficient-seats");
  }
  if (seats > available) {
    throw new DataError(
      `Only ${available} ${available === 1 ? "seat is" : "seats are"} still available on that ride.`,
      "insufficient-seats",
    );
  }

  const pickup = options.pickup;
  const dropoff = options.dropoff;
  if (pickup && (!Number.isFinite(pickup.lat) || !Number.isFinite(pickup.lon))) {
    throw new DataError("The agreed pickup point is not a valid location.", "invalid");
  }
  if (dropoff && (!Number.isFinite(dropoff.lat) || !Number.isFinite(dropoff.lon))) {
    throw new DataError("The agreed drop-off point is not a valid location.", "invalid");
  }

  /**
   * The insert asks for the row back, but never through `.single()`.
   *
   * `insert().select().single()` reports "expected one row, got zero" as
   * `PGRST116`, which is indistinguishable from a missing record. Zero rows can
   * also happen when a BEFORE trigger declines the row or a policy hides it from
   * the returning SELECT, and the resulting error was surfaced to riders as
   * "We could not find that. It may have been removed." Even when the write did
   * land, that message was a lie. Reading the array and re-checking below keeps
   * the reported outcome honest either way.
   */
  const { data, error } = await client
    .from(BOOKING_TABLE)
    .insert({
      ride_id: rideId,
      rider_id: riderId,
      seats,
      status: "pending",
      pickup_lat: pickup?.lat ?? null,
      pickup_lon: pickup?.lon ?? null,
      pickup_label: pickup?.label?.trim() || null,
      walk_distance_km: pickup?.walkDistanceKm ?? null,
      pickup_detour_km: pickup?.detourKm ?? null,
      pickup_detour_minutes: pickup?.detourMinutes ?? null,
      dropoff_lat: dropoff?.lat ?? null,
      dropoff_lon: dropoff?.lon ?? null,
      dropoff_label: dropoff?.label?.trim() || null,
      dropoff_detour_km: dropoff?.detourKm ?? null,
      dropoff_detour_minutes: dropoff?.detourMinutes ?? null,
      match_score: options.match ? Math.round(options.match.score) : null,
    })
    .select(BOOKING_COLUMNS)
    .returns<BookingRow[]>();

  if (error) {
    if (error.code === "23505") {
      throw new DataError("You already have an active request for this ride.", "duplicate", error);
    }
    if (/own ride/i.test(error.message ?? "")) {
      throw new DataError("You cannot book a seat on your own ride.", "self-booking", error);
    }
    if (/not enough seats/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
      throw new DataError("There are no seats left on that ride.", "insufficient-seats", error);
    }
    if (error.code === "42501") {
      throw new DataError("You do not have permission to request a seat on that ride.", "forbidden", error);
    }
    throw toDataError(error, "book");
  }

  const rows = (data ?? []) as BookingRow[];

  if (rows.length === 0) {
    // The insert reported success but returned nothing readable. Ask the
    // database whether the request is actually there before telling the rider
    // anything, so a successful write is never reported as a failure and a
    // genuine failure is never reported as success.
    const existing = await findActiveBookingForRider(client, rideId, riderId);
    if (existing) {
      if (import.meta.env.DEV) {
        console.info("[bookings] insert returned no row; recovered an existing request", {
          bookingId: existing.id,
          rideId,
        });
      }
      return existing;
    }
    throw new DataError(
      "The seat request was not saved. Please check your connection and try again.",
      "unknown",
    );
  }

  const booking = rowToBooking(rows[0]);
  if (import.meta.env.DEV) {
    console.info("[bookings] requested", { bookingId: booking.id, rideId, seats, status: booking.status });
  }
  return booking;
};

/**
 * Most recent request this rider still holds on a ride, or null. Used to tell
 * "the write failed" apart from "the write succeeded but the response did not
 * include the row".
 *
 * The status list matches `bookings_one_active_per_rider`, so this cannot report
 * a request the unique index would have rejected anyway.
 */
const findActiveBookingForRider = async (
  client: ReturnType<typeof getSupabaseClient>,
  rideId: string,
  riderId: string,
): Promise<Booking | null> => {
  const { data, error } = await client
    .from(BOOKING_TABLE)
    .select(BOOKING_COLUMNS)
    .eq("ride_id", rideId)
    .eq("rider_id", riderId)
    .in("status", ["pending", "payment_pending", "confirmed", "picked_up", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<BookingRow>()
    .maybeSingle();
  if (error) return null;
  return data ? rowToBooking(data as BookingRow) : null;
};

/**
 * Moves a booking to a new state and re-reads the authoritative row.
 *
 * Every lifecycle step goes through here. The legality of the transition and the
 * authority to make it are decided by `enforce_booking_status_transition` in the
 * database, so this function's job is to send the state and translate the
 * trigger's messages into something the person can act on. It never touches
 * `rides.seats_available`.
 */
const transitionBooking = async (
  bookingId: string,
  status: BookingStatus,
  patch: Record<string, unknown> = {},
  action: "confirm" | "book" | "cancel" | "update" = "update",
): Promise<Booking> => {
  if (!bookingId) throw new DataError("That seat request could not be found.", "not-found");
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(BOOKING_TABLE)
    .update({ status, ...patch })
    .eq("id", bookingId)
    .select(BOOKING_COLUMNS)
    .returns<BookingRow>()
    .maybeSingle();

  if (error) {
    const detail = `${error.message ?? ""} ${error.details ?? ""}`;
    if (/not enough seats/i.test(detail)) {
      throw new DataError(
        "There are not enough seats left on that ride to accept this request.",
        "insufficient-seats",
        error,
      );
    }
    if (/only the host/i.test(detail)) {
      throw new DataError("Only the driver can do that.", "forbidden", error);
    }
    if (/cannot change this booking/i.test(detail)) {
      throw new DataError("You cannot change this seat.", "forbidden", error);
    }
    if (/cannot change status/i.test(detail)) {
      throw new DataError("That seat is already closed, so it cannot be changed further.", "duplicate", error);
    }
    if (/must be accepted before/i.test(detail)) {
      throw new DataError("Accept the request before taking the next step.", "invalid", error);
    }
    if (/awaiting payment/i.test(detail)) {
      throw new DataError(
        "This seat is still waiting for payment and cannot be changed yet.",
        "invalid",
        error,
      );
    }
    if (/only be picked up|before the trip is completed/i.test(detail)) {
      throw new DataError(
        "Mark the passenger as picked up before completing the trip.",
        "invalid",
        error,
      );
    }
    if (/start the ride before you can (collect|write off)/i.test(detail)) {
      throw new DataError(
        "Start the ride before you can collect or write off a passenger.",
        "invalid",
        error,
      );
    }
    if (/only a ride that is in progress|only a published ride/i.test(detail)) {
      throw new DataError("Start the ride before making that change.", "invalid", error);
    }
    if (error.code === "23505") {
      throw new DataError("That request has already been handled.", "duplicate", error);
    }
    if (error.code === "42501") {
      throw new DataError("You do not have permission to do that.", "forbidden", error);
    }
    throw toDataError(error, action);
  }
  if (!data) {
    throw new DataError("That booking request no longer exists.", "not-found");
  }
  return rowToBooking(data as BookingRow);
};

/**
 * The host accepts a request.
 *
 * This is the point at which the seat is held: `bookings_apply_seat_change`
 * counts a seat from `payment_pending` onwards, so an accepted request cannot be
 * squeezed out by a later one, and it stays held while the rider pays.
 *
 * The host may adjust the agreed pickup and drop-off on the way in - riders
 * routinely ask for a point the driver cannot stop at - and the adjusted points
 * are what the rider is subsequently told. The fare is not adjustable: the
 * database recomputes it from the host's own contribution.
 */
export const acceptBooking = async (
  bookingId: string,
  options: { pickup?: PickupPoint; dropoff?: PickupPoint } = {},
): Promise<Booking> => {
  const patch: Record<string, unknown> = {};
  if (options.pickup) {
    patch.pickup_lat = options.pickup.lat;
    patch.pickup_lon = options.pickup.lon;
    patch.pickup_label = options.pickup.label?.trim() || null;
    patch.walk_distance_km = options.pickup.walkDistanceKm ?? null;
    patch.pickup_detour_km = options.pickup.detourKm ?? null;
    patch.pickup_detour_minutes = options.pickup.detourMinutes ?? null;
  }
  if (options.dropoff) {
    patch.dropoff_lat = options.dropoff.lat;
    patch.dropoff_lon = options.dropoff.lon;
    patch.dropoff_label = options.dropoff.label?.trim() || null;
    patch.dropoff_detour_km = options.dropoff.detourKm ?? null;
    patch.dropoff_detour_minutes = options.dropoff.detourMinutes ?? null;
  }
  return transitionBooking(bookingId, "payment_pending", patch, "confirm");
};

/** The host turns a request down. Nothing was held, so no seat is returned. */
export const rejectBooking = (bookingId: string): Promise<Booking> =>
  transitionBooking(bookingId, "rejected", {}, "update");

/** The host collects a confirmed passenger. */
export const markPickedUp = (bookingId: string): Promise<Booking> =>
  transitionBooking(bookingId, "picked_up", {}, "update");

/**
 * The host writes off a confirmed passenger who never turned up. The seat returns
 * to the pool in the same transaction, so a no-show frees a seat the host can
 * still sell before departure.
 */
export const markNoShow = (bookingId: string): Promise<Booking> =>
  transitionBooking(bookingId, "no_show", {}, "update");

/** The rider withdraws, or a cancelled ride takes the booking with it. */
export const cancelBooking = (bookingId: string): Promise<Booking> =>
  transitionBooking(bookingId, "cancelled", {}, "cancel");

/**
 * There is intentionally no generic `setBookingStatus(bookingId, status)` here.
 *
 * One existed, and because it accepted `"confirmed"` it offered the database a
 * transition the booking trigger refuses: a `pending` request must be accepted
 * first, which moves it to `payment_pending` and holds the seat. The only way to
 * reach `confirmed` is by resolving that payment, which is a different operation
 * with different seat and notification consequences. A helper that lets a caller
 * name `confirmed` without having crossed the payment step is how the host's main
 * accept button came to always fail.
 *
 * Every state the workflow can actually reach has a named function above, and
 * `enforce_booking_status_transition` is the single authority on which are legal.
 */

export { BOOKING_COLUMNS, BOOKING_TABLE, rowToBookingStatus };
