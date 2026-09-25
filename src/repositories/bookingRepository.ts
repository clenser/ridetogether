import type { Booking, BookingStatus } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed booking data.
 *
 * Seat accounting is never done in React. The
 * `bookings_apply_seat_change` trigger in `supabase/schema.sql` owns every
 * increment and restore, so this repository only changes a booking's `status`
 * and then re-reads the authoritative rows.
 */

const BOOKING_TABLE = "bookings";
const BOOKING_COLUMNS = "id, ride_id, rider_id, seats, status, created_at, updated_at";

export interface BookingRow {
  id: string;
  ride_id: string;
  rider_id: string;
  seats: number;
  status: string;
  created_at: string;
  updated_at: string;
}

const rowToBookingStatus = (value: unknown): BookingStatus => {
  const status = toText(value, "pending");
  if (
    status === "confirmed"
    || status === "rejected"
    || status === "cancelled"
    || status === "completed"
  ) {
    return status;
  }
  return "pending";
};

export const rowToBooking = (row: BookingRow): Booking => ({
  id: row.id,
  rideId: row.ride_id,
  riderId: row.rider_id,
  seats: toNumber(row.seats, 1),
  status: rowToBookingStatus(row.status),
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
    .limit(200);

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
    .limit(300);

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
    .maybeSingle();

  if (error) throw toDataError(error, "load");
  return data ? rowToBooking(data as BookingRow) : null;
};

/**
 * Requests seats as the authenticated rider. The ride is read first only to
 * produce a good error message when it is gone, full, or the caller's own -
 * the authoritative checks are the RLS policies, the CHECK constraints, and
 * the `bookings_prevent_self_booking` trigger.
 */
export const requestBooking = async (rideId: string, seats: number): Promise<Booking> => {
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

  const { data, error } = await client
    .from(BOOKING_TABLE)
    .insert({ ride_id: rideId, rider_id: riderId, seats, status: "pending" })
    .select(BOOKING_COLUMNS)
    .single();

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

  const booking = rowToBooking(data as BookingRow);
  if (import.meta.env.DEV) {
    console.info("[bookings] requested", { bookingId: booking.id, rideId, seats, status: booking.status });
  }
  return booking;
};

/**
 * Changes a booking's status. For a driver this confirms or rejects; for a
 * rider this cancels. Seat changes are performed by the database trigger, so
 * nothing here touches `rides.seats_available`.
 */
export const updateBookingStatus = async (
  bookingId: string,
  status: Extract<BookingStatus, "confirmed" | "rejected" | "cancelled">,
): Promise<Booking> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const action = status === "confirmed" ? "confirm" : status === "cancelled" ? "cancel" : "update";

  const { data, error } = await client
    .from(BOOKING_TABLE)
    .update({ status })
    .eq("id", bookingId)
    .select(BOOKING_COLUMNS)
    .maybeSingle();

  if (error) {
    if (/not enough seats/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
      throw new DataError(
        "There are not enough seats left on that ride to confirm this request.",
        "insufficient-seats",
        error,
      );
    }
    if (error.code === "23505") {
      throw new DataError("That request has already been handled.", "duplicate", error);
    }
    throw toDataError(error, action);
  }
  if (!data) {
    throw new DataError("That booking request no longer exists.", "not-found");
  }
  return rowToBooking(data as BookingRow);
};

export const cancelBooking = (bookingId: string): Promise<Booking> => updateBookingStatus(bookingId, "cancelled");

export { BOOKING_COLUMNS, BOOKING_TABLE, rowToBookingStatus };
