import type { Coordinates, Ride, RideInput, RideStatus, SearchCriteria, User, Vehicle } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { FARE_PER_KM, getFareRange, isContributionInRange, normalizeContributionForDistance } from "../services/fare";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";
import { rowToVehicle, VEHICLE_COLUMNS, type VehicleRow } from "./vehicleRepository";
import { toAppUser, type ProfileRow } from "./profileRepository";

/**
 * Supabase-backed ride data. A ride is one row in `rides` plus ordered rows in
 * `ride_stops`. Seat columns are never written directly: the
 * `rides_init_seats` and `rides_sync_total_seats` triggers own them.
 */

const RIDE_TABLE = "rides";
const STOP_TABLE = "ride_stops";
const RIDE_COLUMNS =
  "id, driver_id, vehicle_id, origin_label, origin_lat, origin_lon, destination_label, destination_lat, destination_lon,"
  + " departure_at, total_seats, seats_available, distance_km, duration_minutes, base_fare, contribution, status, created_at, updated_at";
const STOP_COLUMNS = "id, ride_id, stop_order, label, lat, lon";

export interface RideRow {
  id: string;
  driver_id: string;
  vehicle_id: string | null;
  origin_label: string;
  origin_lat: number;
  origin_lon: number;
  destination_label: string;
  destination_lat: number;
  destination_lon: number;
  departure_at: string;
  total_seats: number;
  seats_available: number;
  distance_km: number;
  duration_minutes: number;
  base_fare: number;
  contribution: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RideStopRow {
  id: string;
  ride_id: string;
  stop_order: number;
  label: string;
  lat: number;
  lon: number;
}

/** A ride plus the joined rows the UI needs to render a card or detail page. */
export interface RideWithRelations {
  ride: Ride;
  driver: User | null;
  vehicle: Vehicle | null;
}

// --- data mapping (snake_case -> camelCase happens only here) ----------------

/** Postgres `ride_status` includes 'upcoming'; the app treats it as active. */
const rowToRideStatus = (value: unknown): RideStatus => {
  const status = toText(value, "active");
  if (status === "cancelled" || status === "completed") return status;
  return "active";
};

/**
 * Statuses that mean "this ride can still be booked". The app writes `active`
 * but the database default is `upcoming`, so both are treated as open to avoid
 * a ride being invisible just because of how its row was created.
 */
const OPEN_STATUSES = ["active", "upcoming"];

/**
 * `departure_at` is a single timestamptz while the app models a date and a
 * time. Both are read back in the viewer's local zone so a ride published at a
 * given wall-clock time always displays at that same wall-clock time.
 */
const splitDeparture = (departureAt: string): { departureDate: string; departureTime: string } => {
  const parsed = new Date(departureAt);
  if (Number.isNaN(parsed.getTime())) {
    return { departureDate: toText(departureAt).slice(0, 10), departureTime: "00:00" };
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    departureDate: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    departureTime: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
};

const toDepartureTimestamp = (departureDate: string, departureTime: string): string => {
  const parsed = new Date(`${departureDate}T${departureTime}:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new DataError("Enter a valid departure date and time.", "invalid");
  }
  return parsed.toISOString();
};

export const rowToRide = (row: RideRow, stops: RideStopRow[] = []): Ride => {
  const { departureDate, departureTime } = splitDeparture(row.departure_at);
  const ordered = [...stops].sort((first, second) => first.stop_order - second.stop_order);
  const distanceKm = toNumber(row.distance_km, 0);

  return {
    id: row.id,
    driverId: row.driver_id,
    vehicleId: toText(row.vehicle_id),
    origin: {
      lat: toNumber(row.origin_lat, 0),
      lon: toNumber(row.origin_lon, 0),
      label: toText(row.origin_label),
    },
    destination: {
      lat: toNumber(row.destination_lat, 0),
      lon: toNumber(row.destination_lon, 0),
      label: toText(row.destination_label),
    },
    waypoints: ordered.map((stop) => ({
      lat: toNumber(stop.lat, 0),
      lon: toNumber(stop.lon, 0),
      label: toText(stop.label),
    })),
    departureDate,
    departureTime,
    availableSeats: toNumber(row.seats_available, 0),
    totalSeats: toNumber(row.total_seats, 1),
    // `base_fare` is persisted. The fallback keeps a pre-migration row readable
    // instead of showing ₹0, and matches the same ₹9/km rule.
    baseFare: toNumber(row.base_fare, Math.round(distanceKm * FARE_PER_KM)),
    contribution: toNumber(row.contribution, 0),
    status: rowToRideStatus(row.status),
    distanceKm,
    durationMinutes: toNumber(row.duration_minutes, 0),
    createdAt: toText(row.created_at),
  };
};

// --- validation -------------------------------------------------------------

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isValidCoordinate = (value: Coordinates): boolean =>
  isFiniteNumber(value?.lat) && value.lat >= -90 && value.lat <= 90
  && isFiniteNumber(value?.lon) && value.lon >= -180 && value.lon <= 180
  && Boolean(value?.label?.trim());

/**
 * Enforces the fare business rule before anything is written and returns the
 * two values that get persisted:
 *   base = round(distanceKm * 9);  contribution must be within base +/- 10.
 *
 * The `rides_base_fare_matches_distance` and `rides_contribution_fare_band`
 * CHECK constraints in `supabase/schema.sql` enforce the same rule, so this is
 * defence in depth rather than the only guard - but it is what lets the UI
 * explain the problem instead of surfacing a raw 23514.
 */
const resolveFare = (distanceKm: number | undefined, contribution: number): { baseFare: number; contribution: number } => {
  if (!isFiniteNumber(distanceKm) || distanceKm <= 0) {
    throw new DataError("The route distance is required to calculate the fare.", "invalid");
  }
  const range = getFareRange(distanceKm);
  if (!range) {
    throw new DataError("The route distance is required to calculate the fare.", "invalid");
  }
  if (!Number.isInteger(contribution)) {
    throw new DataError("The contribution must be a whole number of rupees.", "invalid");
  }
  if (!isContributionInRange(contribution, distanceKm)) {
    throw new DataError(
      `The contribution must be between ₹${range.min} and ₹${range.max} for this route.`,
      "invalid",
    );
  }
  return { baseFare: range.base, contribution: normalizeContributionForDistance(contribution, distanceKm) };
};

const validateInput = (input: RideInput): void => {
  if (!isValidCoordinate(input.origin)) {
    throw new DataError("Choose a valid starting point.", "invalid");
  }
  if (!isValidCoordinate(input.destination)) {
    throw new DataError("Choose a valid destination.", "invalid");
  }
  const waypoints = input.waypoints ?? [];
  if (waypoints.length > 8) {
    throw new DataError("You can add at most 8 stops to a ride.", "invalid");
  }
  if (waypoints.some((stop) => !isValidCoordinate(stop))) {
    throw new DataError("One of the stops is not a valid location.", "invalid");
  }
  if (!Number.isInteger(input.totalSeats) || input.totalSeats < 1 || input.totalSeats > 12) {
    throw new DataError("Total seats must be between 1 and 12.", "invalid");
  }
  if (!Number.isInteger(input.availableSeats) || input.availableSeats < 0 || input.availableSeats > input.totalSeats) {
    throw new DataError("Available seats must be between 0 and the total seats.", "invalid");
  }
  if (!isFiniteNumber(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new DataError("The route duration is required to publish a ride.", "invalid");
  }
  resolveFare(input.distanceKm, input.contribution);
};

// --- stops ------------------------------------------------------------------

const listStops = async (rideId: string): Promise<RideStopRow[]> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(STOP_TABLE)
    .select(STOP_COLUMNS)
    .eq("ride_id", rideId)
    .order("stop_order", { ascending: true });

  if (error) throw toDataError(error, "load");
  return (data ?? []) as RideStopRow[];
};

const listStopsForRides = async (rideIds: string[]): Promise<Map<string, RideStopRow[]>> => {
  const grouped = new Map<string, RideStopRow[]>();
  if (rideIds.length === 0) return grouped;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(STOP_TABLE)
    .select(STOP_COLUMNS)
    .in("ride_id", rideIds)
    .order("stop_order", { ascending: true });

  if (error) throw toDataError(error, "load");

  for (const stop of (data ?? []) as RideStopRow[]) {
    const bucket = grouped.get(stop.ride_id) ?? [];
    bucket.push(stop);
    grouped.set(stop.ride_id, bucket);
  }
  return grouped;
};

const insertStops = async (rideId: string, waypoints: Coordinates[]): Promise<void> => {
  if (waypoints.length === 0) return;
  const client = getSupabaseClient();

  const { error } = await client.from(STOP_TABLE).insert(
    waypoints.map((stop, index) => ({
      ride_id: rideId,
      stop_order: index + 1,
      label: stop.label.trim(),
      lat: stop.lat,
      lon: stop.lon,
    })),
  );
  if (error) throw toDataError(error, "create");
};

/**
 * Replaces a ride's stops with the given set. The existing rows are deleted
 * first so reordering or removing a stop can never leave a duplicate
 * `stop_order` behind - `ride_stops_ride_order_key` forbids duplicates anyway.
 */
const replaceStops = async (rideId: string, waypoints: Coordinates[]): Promise<void> => {
  const client = getSupabaseClient();
  const { error: deleteError } = await client.from(STOP_TABLE).delete().eq("ride_id", rideId);
  if (deleteError) throw toDataError(deleteError, "update");
  await insertStops(rideId, waypoints);
};

// --- reads ------------------------------------------------------------------

const attachRelations = async (rows: RideRow[]): Promise<RideWithRelations[]> => {
  if (rows.length === 0) return [];
  const client = getSupabaseClient();

  const [stopsByRide, driverIds, vehicleIds] = [
    await listStopsForRides(rows.map((row) => row.id)),
    [...new Set(rows.map((row) => row.driver_id).filter(Boolean))],
    [...new Set(rows.map((row) => toText(row.vehicle_id)).filter(Boolean))],
  ];

  let drivers: ProfileRow[] = [];
  if (driverIds.length > 0) {
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, phone, avatar_url, bio, role, rating, trip_count, created_at, updated_at")
      .in("id", driverIds);
    if (error) throw toDataError(error, "load");
    drivers = (data ?? []) as ProfileRow[];
  }

  let vehicles: Vehicle[] = [];
  if (vehicleIds.length > 0) {
    const { data, error } = await client
      .from("vehicles")
      .select(VEHICLE_COLUMNS)
      .in("id", vehicleIds)
      .returns<VehicleRow[]>();
    if (error) throw toDataError(error, "load");
    vehicles = (data ?? []).map(rowToVehicle);
  }

  return rows.map((row) => ({
    ride: rowToRide(row, stopsByRide.get(row.id) ?? []),
    // Mapped to the app's `User` shape so pages can read name/avatar/rating
    // directly. `profiles` never stores an email; only the signed-in account's
    // own email is available, and that comes from Supabase Auth, not here.
    driver: (() => {
      const profile = drivers.find((entry) => entry.id === row.driver_id);
      return profile ? toAppUser(profile, null) : null;
    })(),
    vehicle: vehicles.find((vehicle) => vehicle.id === toText(row.vehicle_id)) ?? null,
  }));
};

/**
 * Rides relevant to the signed-in user:
 *   - their own rides, in any state
 *   - other people's rides they hold a booking on, in any state, so a
 *     completed trip still resolves for My Bookings, Ride Details and ratings
 *   - everyone else's upcoming open rides
 * Other users' cancelled or past rides are excluded so the list stays small.
 * The booked-ride branch is capped at the 100 most recent bookings so the
 * `or` filter cannot grow into an unreasonably long URL.
 */
export const listRides = async (options: { includePast?: boolean } = {}): Promise<RideWithRelations[]> => {
  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data: bookedRideIds, error: bookedError } = await client
    .from("bookings")
    .select("ride_id")
    .eq("rider_id", driverId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (bookedError) throw toDataError(bookedError, "load");

  const bookedIds = [...new Set(((bookedRideIds ?? []) as { ride_id: string }[]).map((row) => row.ride_id))];
  const branches = [
    `driver_id.eq.${driverId}`,
    `and(status.in.(${OPEN_STATUSES}),departure_at.gte.${nowIso})`,
    ...(bookedIds.length > 0 ? [`id.in.(${bookedIds.join(",")})`] : []),
  ];

  const { data, error } = await client
    .from(RIDE_TABLE)
    .select(RIDE_COLUMNS)
    .or(branches.join(","))
    .order("departure_at", { ascending: true })
    .limit(options.includePast ? 200 : 100)
    .returns<RideRow[]>();

  if (error) throw toDataError(error, "load");
  return attachRelations(data ?? []);
};

export const listRidesByDriver = async (driverId: string): Promise<RideWithRelations[]> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(RIDE_TABLE)
    .select(RIDE_COLUMNS)
    .eq("driver_id", driverId)
    .order("departure_at", { ascending: false })
    .limit(100)
    .returns<RideRow[]>();

  if (error) throw toDataError(error, "load");
  return attachRelations(data ?? []);
};

/**
 * Targeted search used by Find Ride. Date and seat filtering happens in
 * Postgres (indexed on `departure_at` and `seats_available`) so the whole table
 * is never pulled into memory; the route compatibility check stays client-side
 * because it needs the caller's exact origin/destination.
 */
export const searchRides = async (criteria: SearchCriteria): Promise<RideWithRelations[]> => {
  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const from = `${criteria.date}T00:00:00`;
  const to = `${criteria.date}T23:59:59`;

  const { data, error } = await client
    .from(RIDE_TABLE)
    .select(RIDE_COLUMNS)
    .in("status", OPEN_STATUSES)
    .neq("driver_id", driverId)
    .gte("seats_available", Math.max(1, Math.trunc(criteria.seats)))
    .gte("departure_at", new Date(from).toISOString())
    .lte("departure_at", new Date(to).toISOString())
    .order("departure_at", { ascending: true })
    .limit(60)
    .returns<RideRow[]>();

  if (error) throw toDataError(error, "load");
  return attachRelations(data ?? []);
};

export const getRideById = async (rideId: string): Promise<RideWithRelations | null> => {
  if (!rideId) return null;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(RIDE_TABLE)
    .select(RIDE_COLUMNS)
    .eq("id", rideId)
    .maybeSingle()
    .returns<RideRow>();

  if (error) throw toDataError(error, "load");
  if (!data) return null;

  const [withRelations] = await attachRelations([data]);
  return withRelations ?? null;
};

// --- writes -----------------------------------------------------------------

export const createRide = async (input: RideInput): Promise<Ride> => {
  validateInput(input);
  // The driver is the authenticated Supabase user. `RideInput` has no driverId
  // field at all, so there is nothing for a caller to forge here.
  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { baseFare, contribution } = resolveFare(input.distanceKm, input.contribution);

  // `seats_available` is intentionally omitted: rides_init_seats sets it to
  // `total_seats` on insert, and sending it would fight the trigger.
  const { data, error } = await client
    .from(RIDE_TABLE)
    .insert({
      driver_id: driverId,
      vehicle_id: input.vehicleId || null,
      origin_label: input.origin.label.trim(),
      origin_lat: input.origin.lat,
      origin_lon: input.origin.lon,
      destination_label: input.destination.label.trim(),
      destination_lat: input.destination.lat,
      destination_lon: input.destination.lon,
      departure_at: toDepartureTimestamp(input.departureDate, input.departureTime),
      total_seats: input.totalSeats,
      distance_km: input.distanceKm,
      duration_minutes: Math.max(1, Math.round(input.durationMinutes as number)),
      base_fare: baseFare,
      contribution,
      status: "active",
    })
    .select(RIDE_COLUMNS)
    .single<RideRow>();

  if (error) {
    if (error.code === "23514") {
      const message = error.message ?? "";
      if (/base_fare/i.test(message)) {
        throw new DataError(
          "The ₹9/km base fare could not be calculated for this route. Please try again.",
          "invalid",
          error,
        );
      }
      throw new DataError("The fare or seat values were rejected. Please review and try again.", "invalid", error);
    }
    throw toDataError(error, "create");
  }

  const row = data;
  try {
    await insertStops(row.id, input.waypoints ?? []);
  } catch (stopError) {
    // Do not leave a ride with orphaned route data.
    await client.from(RIDE_TABLE).delete().eq("id", row.id);
    throw stopError;
  }

  if (import.meta.env.DEV) {
    console.info("[rides] published", { rideId: row.id, driverId, stops: input.waypoints?.length ?? 0 });
  }
  return rowToRide(row, await listStops(row.id));
};

export const updateRide = async (rideId: string, input: RideInput): Promise<Ride> => {
  validateInput(input);
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { baseFare, contribution } = resolveFare(input.distanceKm, input.contribution);
  const stops = input.waypoints ?? [];

  const { data, error } = await client
    .from(RIDE_TABLE)
    .update({
      vehicle_id: input.vehicleId || null,
      origin_label: input.origin.label.trim(),
      origin_lat: input.origin.lat,
      origin_lon: input.origin.lon,
      destination_label: input.destination.label.trim(),
      destination_lat: input.destination.lat,
      destination_lon: input.destination.lon,
      departure_at: toDepartureTimestamp(input.departureDate, input.departureTime),
      total_seats: input.totalSeats,
      distance_km: input.distanceKm,
      duration_minutes: Math.max(1, Math.round(input.durationMinutes as number)),
      base_fare: baseFare,
      contribution,
    })
    .eq("id", rideId)
    .select(RIDE_COLUMNS)
    .returns<RideRow>()
    .maybeSingle();

  if (error) {
    if (error.code === "23514") {
      const message = error.message ?? "";
      if (/reduce total seats/i.test(message)) {
        throw new DataError(
          "You cannot reduce the seats below the number already booked.",
          "invalid",
          error,
        );
      }
      if (/base_fare/i.test(message)) {
        throw new DataError(
          "The route distance changed, so the ₹9/km base fare was recalculated. Check the contribution and try again.",
          "invalid",
          error,
        );
      }
      if (/fare|contribution/i.test(message)) {
        throw new DataError("The contribution is outside the allowed range for this route.", "invalid", error);
      }
      throw new DataError("Those ride values were rejected. Please review and try again.", "invalid", error);
    }
    throw toDataError(error, "update");
  }
  if (!data) {
    throw new DataError("We could not find that ride. It may have been removed.", "not-found");
  }

  // Replace stops wholesale so reordering and removal stay consistent.
  await replaceStops(rideId, stops);
  return rowToRide(data, await listStops(rideId));
};

export const setRideStatus = async (
  rideId: string,
  status: Extract<RideStatus, "cancelled" | "completed">,
): Promise<Ride> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(RIDE_TABLE)
    .update({ status })
    .eq("id", rideId)
    .select(RIDE_COLUMNS)
    .returns<RideRow>()
    .maybeSingle();

  if (error) throw toDataError(error, status === "cancelled" ? "cancel" : "complete");
  if (!data) {
    throw new DataError("We could not find that ride. It may have been removed.", "not-found");
  }
  return rowToRide(data, await listStops(rideId));
};

export const cancelRide = (rideId: string): Promise<Ride> => setRideStatus(rideId, "cancelled");
export const completeRide = (rideId: string): Promise<Ride> => setRideStatus(rideId, "completed");

export { RIDE_COLUMNS, RIDE_TABLE, STOP_COLUMNS, STOP_TABLE, rowToRideStatus, splitDeparture };
