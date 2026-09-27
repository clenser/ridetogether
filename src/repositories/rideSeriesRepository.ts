import type { Coordinates, Ride, RideSeries, RideStatus } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { FARE_PER_KM, getFareRange, isContributionInRange, normalizeContributionForDistance } from "../services/fare";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";
import { rowToRide, RIDE_COLUMNS, RIDE_TABLE, STOP_TABLE, STOP_COLUMNS, type RideRow, type RideStopRow } from "./rideRepository";

/**
 * Recurring commutes.
 *
 * A "series" is a schedule, not a ride. It exists so a host can publish their
 * Monday-to-Friday office trip once, and every date in the range becomes its own
 * row in `rides` with the same route and the same seats. That is deliberate:
 * seats, bookings and live location are all per-occurrence, so a series that held
 * its own seats would need a second seat ledger that could disagree with the
 * first. The schedule is the pattern; each date is the truth.
 *
 * Every occurrence is created with the route geometry copied from the series, so
 * Find Ride can match each one against a real corridor without re-routing.
 */

const SERIES_TABLE = "ride_series";
const SERIES_COLUMNS =
  "id, driver_id, vehicle_id, origin_label, origin_lat, origin_lon,"
  + " destination_label, destination_lat, destination_lon, departure_time, days_of_week,"
  + " valid_from, valid_until, total_seats, base_fare, contribution, distance_km,"
  + " duration_minutes, route_geometry, is_active, created_at, updated_at";

/** Two full seasons is plenty, and it keeps one insert bounded. */
export const MAX_SERIES_DAYS = 120;
/**
 * Most rides a single schedule may publish at once.
 *
 * Checked against the schedule the host actually asked for, so this is a limit
 * they are told about rather than one applied behind their back.
 */
const MAX_OCCURRENCES = 60;

export interface SeriesRow {
  id: string;
  driver_id: string;
  vehicle_id: string | null;
  origin_label: string;
  origin_lat: number;
  origin_lon: number;
  destination_label: string;
  destination_lat: number;
  destination_lon: number;
  departure_time: string;
  days_of_week: number[];
  valid_from: string;
  valid_until: string | null;
  total_seats: number;
  base_fare: number;
  contribution: number;
  distance_km: number;
  duration_minutes: number;
  route_geometry: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const toGeometry = (value: unknown): [number, number][] | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const pairs: [number, number][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return undefined;
    const lon = toNumber(entry[0], Number.NaN);
    const lat = toNumber(entry[1], Number.NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    pairs.push([lon, lat]);
  }
  return pairs;
};

export const rowToSeries = (row: SeriesRow): RideSeries => ({
  id: row.id,
  driverId: row.driver_id,
  vehicleId: row.vehicle_id ? toText(row.vehicle_id) : undefined,
  origin: { lat: toNumber(row.origin_lat, 0), lon: toNumber(row.origin_lon, 0), label: toText(row.origin_label) },
  destination: {
    lat: toNumber(row.destination_lat, 0),
    lon: toNumber(row.destination_lon, 0),
    label: toText(row.destination_label),
  },
  departureTime: toText(row.departure_time),
  daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week.map((day) => toNumber(day, 0)) : [],
  validFrom: toText(row.valid_from),
  validUntil: row.valid_until ? toText(row.valid_until) : undefined,
  totalSeats: toNumber(row.total_seats, 1),
  baseFare: toNumber(row.base_fare, 0),
  contribution: toNumber(row.contribution, 0),
  distanceKm: toNumber(row.distance_km, 0),
  durationMinutes: toNumber(row.duration_minutes, 0),
  routeGeometry: toGeometry(row.route_geometry),
  isActive: row.is_active !== false,
  createdAt: toText(row.created_at),
});

export interface SeriesInput {
  vehicleId: string;
  origin: Coordinates;
  destination: Coordinates;
  waypoints: Coordinates[];
  /** Wall-clock departure, `HH:MM`. */
  departureTime: string;
  /** ISO weekdays, 0 = Sunday. */
  daysOfWeek: number[];
  /** `YYYY-MM-DD`, inclusive. */
  validFrom: string;
  /** `YYYY-MM-DD`, inclusive. Defaults to `validFrom`. */
  validUntil?: string;
  totalSeats: number;
  contribution: number;
  distanceKm: number;
  durationMinutes: number;
  routeGeometry: [number, number][];
}

const isValidCoordinate = (value: Coordinates): boolean =>
  Number.isFinite(value?.lat) && value.lat >= -90 && value.lat <= 90
  && Number.isFinite(value?.lon) && value.lon >= -180 && value.lon <= 180
  && Boolean(value?.label?.trim());

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `YYYY-MM-DD` to a UTC timestamp at midnight, without local-time drift. */
const parseIsoDate = (value: string): Date | null => {
  if (!DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * How many calendar days a range covers, inclusive of both ends, or `null` if
 * either end is unparseable.
 *
 * Exported so the offer form can apply the same `MAX_SERIES_DAYS` limit while the
 * host is still choosing dates. The rule and its wording live here rather than in
 * the page, so the form cannot drift from what the validator will accept.
 */
export const seriesRangeDayCount = (validFrom: string, validUntil: string): number | null => {
  const from = parseIsoDate(validFrom);
  const to = parseIsoDate(validUntil);
  if (!from || !to || to < from) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
};

/**
 * Every date a schedule covers, in order, with the instant each occurrence
 * actually departs.
 *
 * Dates are walked in UTC so a member in a half-hour timezone zone gets the dates
 * they picked rather than a day either side, and each one is paired with the same
 * local-time instant that will be written to `departure_at`.
 */
interface Occurrence {
  date: string;
  departureAt: string;
}

const enumerateOccurrences = (input: {
  daysOfWeek: number[];
  validFrom: string;
  validUntil: string;
  departureTime: string;
}): Occurrence[] => {
  const from = parseIsoDate(input.validFrom);
  const to = parseIsoDate(input.validUntil);
  if (!from || !to || to < from) return [];

  const wanted = new Set(input.daysOfWeek);
  const occurrences: Occurrence[] = [];
  const cursor = new Date(from.getTime());
  // Bounded by the range length so a hostile `validUntil` cannot spin here; the
  // validator below rejects anything longer than `MAX_SERIES_DAYS` first.
  for (let guard = 0; guard <= MAX_SERIES_DAYS && cursor <= to; guard += 1) {
    if (wanted.has(cursor.getUTCDay())) {
      occurrences.push({
        date: toIsoDate(cursor),
        departureAt: new Date(`${toIsoDate(cursor)}T${input.departureTime}:00`).toISOString(),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return occurrences;
};

/**
 * The dates a schedule covers, in order.
 *
 * Occurrences that have already departed are left out. A host who starts a
 * weekday commute from a date earlier in the week means "from now on", and
 * publishing rides for days that have passed puts rows in the database that can
 * never be booked and that the host then has to look at on My Rides.
 */
export const occurrenceDates = (input: {
  daysOfWeek: number[];
  validFrom: string;
  validUntil: string;
  departureTime?: string;
  /** Departures at or before this instant are treated as already gone. */
  notBefore?: number;
}): string[] => {
  const departureTime = input.departureTime?.trim() || "00:00";
  const occurrences = enumerateOccurrences({ ...input, departureTime });
  const cutoff = input.notBefore ?? Number.NEGATIVE_INFINITY;

  return occurrences
    .filter((occurrence) => new Date(occurrence.departureAt).getTime() > cutoff)
    .map((occurrence) => occurrence.date);
};

/**
 * Normalises the end of the range.
 *
 * `validUntil` is optional and an empty date input produces `""` rather than
 * `undefined`. Treating those two differently is how a schedule with a blank end
 * date ends up with an end date of `""`, which then fails to parse and produces
 * zero occurrences - reported to the host as "no dates in that range fall on the
 * days you chose", which is not what went wrong. One rule for every caller.
 */
const resolveValidUntil = (validFrom: Date, requested?: string): Date => {
  if (!requested || !requested.trim()) return validFrom;
  return parseIsoDate(requested.trim()) ?? new Date(Number.NaN);
};

const validateSeriesInput = (
  input: SeriesInput,
  now: number,
): { baseFare: number; contribution: number; validUntil: string; occurrences: string[] } => {
  if (!isValidCoordinate(input.origin)) {
    throw new DataError("Choose a valid starting point for the schedule.", "invalid");
  }
  if (!isValidCoordinate(input.destination)) {
    throw new DataError("Choose a valid destination for the schedule.", "invalid");
  }
  if ((input.waypoints ?? []).some((stop) => !isValidCoordinate(stop))) {
    throw new DataError("One of the stops is not a valid location.", "invalid");
  }
  if (!TIME_PATTERN.test(input.departureTime.trim())) {
    throw new DataError("Choose a valid departure time.", "invalid");
  }
  if (!Array.isArray(input.daysOfWeek) || input.daysOfWeek.length === 0) {
    throw new DataError("Choose at least one day of the week.", "invalid");
  }
  if (new Set(input.daysOfWeek).size !== input.daysOfWeek.length) {
    throw new DataError("Each day of the week can only be chosen once.", "invalid");
  }
  if (input.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new DataError("Choose valid days of the week.", "invalid");
  }
  if (!Number.isInteger(input.totalSeats) || input.totalSeats < 1 || input.totalSeats > 12) {
    throw new DataError("Total seats must be between 1 and 12.", "invalid");
  }
  if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    throw new DataError("The route distance is required before a schedule can be saved.", "invalid");
  }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new DataError("The route duration is required before a schedule can be saved.", "invalid");
  }
  if (!Array.isArray(input.routeGeometry) || input.routeGeometry.length < 2) {
    throw new DataError("Calculate the route before saving a schedule.", "invalid");
  }

  const validFrom = parseIsoDate(input.validFrom);
  if (!validFrom) throw new DataError("Choose a valid start date for the schedule.", "invalid");
  const validUntil = resolveValidUntil(validFrom, input.validUntil);
  if (!validUntil || Number.isNaN(validUntil.getTime())) {
    throw new DataError("Choose a valid end date for the schedule.", "invalid");
  }
  if (validUntil < validFrom) {
    throw new DataError("The schedule cannot end before it starts.", "invalid");
  }
  // The inclusive day count comes from the shared helper the offer form also calls,
  // so the range limit reads the same in the form and here.
  const spanDays = seriesRangeDayCount(input.validFrom, toIsoDate(validUntil)) ?? 0;
  if (spanDays > MAX_SERIES_DAYS) {
    throw new DataError(`A schedule can cover at most ${MAX_SERIES_DAYS} days at a time.`, "invalid");
  }

  const departureTime = input.departureTime.trim();
  const occurrences = occurrenceDates({
    daysOfWeek: input.daysOfWeek,
    validFrom: input.validFrom,
    validUntil: toIsoDate(validUntil),
    departureTime,
    notBefore: now,
  });

  if (occurrences.length === 0) {
    throw new DataError(
      "That range has no upcoming dates on the days you chose. Try a later start date or a wider range.",
      "invalid",
    );
  }
  /**
   * Checked against the whole range before anything is written, and reported with
   * the number the host would have got. Silently stopping at the limit left them
   * with a schedule that looked complete and quietly missing its last few weeks.
   */
  if (occurrences.length > MAX_OCCURRENCES) {
    throw new DataError(
      `That schedule covers ${occurrences.length} rides, which is more than the ${MAX_OCCURRENCES} one schedule can publish. Shorten the range or pick fewer days.`,
      "invalid",
    );
  }

  const range = getFareRange(input.distanceKm);
  if (!range) throw new DataError("The route distance is required to calculate the fare.", "invalid");
  if (!Number.isInteger(input.contribution) || !isContributionInRange(input.contribution, input.distanceKm)) {
    throw new DataError(
      `The contribution must be between ₹${range.min} and ₹${range.max} for this route.`,
      "invalid",
    );
  }

  return {
    baseFare: range.base ?? Math.round(input.distanceKm * FARE_PER_KM),
    contribution: normalizeContributionForDistance(input.contribution, input.distanceKm),
    validUntil: toIsoDate(validUntil),
    occurrences,
  };
};

export interface CreatedSeries {
  series: RideSeries;
  /** The individual rides, one per date, in date order. */
  rides: Ride[];
}

/**
 * Publishes a recurring schedule and every ride in it.
 *
 * The schedule row and the ride rows are written together and rolled back
 * together: if any date cannot be created, the whole series is removed rather
 * than leaving a half-published commute that looks real on the Find Ride page.
 * Each ride gets its own `occurrence_index`, which is what lets a host cancel a
 * single Tuesday without touching the rest.
 */
export const createSeries = async (input: SeriesInput): Promise<CreatedSeries> => {
  const fare = validateSeriesInput(input, Date.now());
  const validUntil = fare.validUntil;
  const dates = fare.occurrences;

  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();
  const departureTime = input.departureTime.trim();

  const { data: seriesData, error: seriesError } = await client
    .from(SERIES_TABLE)
    .insert({
      driver_id: driverId,
      vehicle_id: input.vehicleId || null,
      origin_label: input.origin.label.trim(),
      origin_lat: input.origin.lat,
      origin_lon: input.origin.lon,
      destination_label: input.destination.label.trim(),
      destination_lat: input.destination.lat,
      destination_lon: input.destination.lon,
      departure_time: departureTime,
      days_of_week: [...new Set(input.daysOfWeek)].sort((first, second) => first - second),
      valid_from: input.validFrom,
      valid_until: validUntil,
      total_seats: input.totalSeats,
      base_fare: fare.baseFare,
      contribution: fare.contribution,
      distance_km: input.distanceKm,
      duration_minutes: Math.max(1, Math.round(input.durationMinutes)),
      route_geometry: input.routeGeometry,
      is_active: true,
    })
    .select(SERIES_COLUMNS)
    .single<SeriesRow>();

  if (seriesError) {
    // The vehicle has to belong to the driver; `ride_series_guard_vehicle` is what
    // decides that, so map its message rather than reporting a bare insert failure.
    if (/your own vehicle|not a vehicle you/i.test(seriesError.message ?? "")) {
      throw new DataError("You can only offer a schedule using one of your own vehicles.", "forbidden", seriesError);
    }
    throw toDataError(seriesError, "create");
  }
  const series = rowToSeries(seriesData as SeriesRow);

  const rows = dates.map((date, index) => ({
    driver_id: driverId,
    vehicle_id: input.vehicleId || null,
    origin_label: input.origin.label.trim(),
    origin_lat: input.origin.lat,
    origin_lon: input.origin.lon,
    destination_label: input.destination.label.trim(),
    destination_lat: input.destination.lat,
    destination_lon: input.destination.lon,
    departure_at: new Date(`${date}T${departureTime}:00`).toISOString(),
    total_seats: input.totalSeats,
    distance_km: input.distanceKm,
    duration_minutes: Math.max(1, Math.round(input.durationMinutes)),
    base_fare: fare.baseFare,
    contribution: fare.contribution,
    status: "upcoming" as RideStatus,
    route_geometry: input.routeGeometry,
    series_id: series.id,
    occurrence_index: index,
  }));

  const { data: rideData, error: rideError } = await client
    .from(RIDE_TABLE)
    .insert(rows)
    .select(RIDE_COLUMNS)
    .returns<RideRow[]>();

  if (rideError) {
    await client.from(SERIES_TABLE).delete().eq("id", series.id);
    if (rideError.code === "23514") {
      throw new DataError("The fare or seat values for this schedule were rejected.", "invalid", rideError);
    }
    throw toDataError(rideError, "create");
  }

  const created = (rideData ?? []) as RideRow[];
  if (created.length !== rows.length) {
    await client.from(RIDE_TABLE).delete().eq("series_id", series.id);
    await client.from(SERIES_TABLE).delete().eq("id", series.id);
    throw new DataError("The schedule could not be published completely. Nothing was saved.", "unknown");
  }

  const stops = input.waypoints ?? [];
  if (stops.length > 0) {
    const stopRows = created.flatMap((ride) =>
      stops.map((stop, index) => ({
        ride_id: ride.id,
        stop_order: index + 1,
        label: stop.label.trim(),
        lat: stop.lat,
        lon: stop.lon,
      })),
    );
    const { error: stopError } = await client.from(STOP_TABLE).insert(stopRows);
    if (stopError) {
      await client.from(RIDE_TABLE).delete().eq("series_id", series.id);
      await client.from(SERIES_TABLE).delete().eq("id", series.id);
      throw toDataError(stopError, "create");
    }
  }

  const stopsByRide = new Map<string, RideStopRow[]>();
  for (const ride of created) {
    stopsByRide.set(
      ride.id,
      stops.map((stop, index) => ({
        id: "",
        ride_id: ride.id,
        stop_order: index + 1,
        label: stop.label.trim(),
        lat: stop.lat,
        lon: stop.lon,
      })),
    );
  }

  const rides = created
    .map((ride) => rowToRide(ride, stopsByRide.get(ride.id) ?? []))
    .sort((first, second) => first.departureDate.localeCompare(second.departureDate));

  if (import.meta.env.DEV) {
    console.info("[ride-series] published", { seriesId: series.id, occurrences: rides.length });
  }

  return { series, rides };
};

/** The schedules the signed-in member has published. */
export const listMySeries = async (): Promise<RideSeries[]> => {
  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SERIES_TABLE)
    .select(SERIES_COLUMNS)
    .eq("driver_id", driverId)
    .order("departure_time", { ascending: true })
    .limit(100)
    .returns<SeriesRow[]>();

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as SeriesRow[]).map(rowToSeries);
};

export const getSeriesById = async (seriesId: string): Promise<RideSeries | null> => {
  if (!seriesId) return null;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SERIES_TABLE)
    .select(SERIES_COLUMNS)
    .eq("id", seriesId)
    .maybeSingle()
    .returns<SeriesRow>();

  if (error) throw toDataError(error, "load");
  return data ? rowToSeries(data as SeriesRow) : null;
};

/**
 * Stops a schedule publishing new rides.
 *
 * Existing rides are left alone: some are already booked, and cancelling a ride
 * a passenger is relying on is not what "stop repeating this" means. Setting
 * `is_active` to false only affects future occurrences, which are created
 * explicitly by the host anyway.
 */
export const setSeriesActive = async (seriesId: string, isActive: boolean): Promise<RideSeries> => {
  const driverId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SERIES_TABLE)
    .update({ is_active: isActive })
    .eq("id", seriesId)
    .eq("driver_id", driverId)
    .select(SERIES_COLUMNS)
    .returns<SeriesRow>()
    .maybeSingle();

  if (error) throw toDataError(error, "update");
  if (!data) throw new DataError("We could not find that schedule.", "not-found");
  return rowToSeries(data as SeriesRow);
};

export { MAX_OCCURRENCES, SERIES_COLUMNS, SERIES_TABLE };
