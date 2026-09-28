import type { RideLocation } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { haversineDistanceKm } from "../services/geometry";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * The host's position while a ride is running.
 *
 * One row per ride, written by the driver and read by the confirmed passengers
 * on that ride. RLS decides who may read it - `ride_locations_select_participants`
 * is `driver_id = auth.uid() or is_ride_passenger(ride_id)` - so there is no path
 * by which a member can poll somebody else's location, and no policy here widens
 * that.
 *
 * Two rules are enforced in the database and repeated here so the failure is
 * explained rather than reported as a raw error:
 *   - only a ride that is actually `in_progress` streams a position;
 *   - the driver written into the row is overwritten with the caller, so a
 *     forged `driver_id` cannot be stored.
 */

const LOCATION_TABLE = "ride_locations";
const LOCATION_COLUMNS = "ride_id, driver_id, lat, lon, heading, speed_kph, accuracy_meters, recorded_at";

export interface RideLocationRow {
  ride_id: string;
  driver_id: string;
  lat: number;
  lon: number;
  heading: number | null;
  speed_kph: number | null;
  accuracy_meters: number | null;
  recorded_at: string;
}

export interface ReportPositionInput {
  rideId: string;
  lat: number;
  lon: number;
  heading?: number;
  speedKph?: number;
  accuracyMeters?: number;
}

const rowToRideLocation = (row: RideLocationRow): RideLocation => ({
  rideId: row.ride_id,
  driverId: row.driver_id,
  lat: toNumber(row.lat, 0),
  lon: toNumber(row.lon, 0),
  heading: row.heading == null ? undefined : toNumber(row.heading, 0),
  speedKph: row.speed_kph == null ? undefined : toNumber(row.speed_kph, 0),
  accuracyMeters: row.accuracy_meters == null ? undefined : toNumber(row.accuracy_meters, 0),
  recordedAt: toText(row.recorded_at),
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The host's last known position for a ride, or null when nothing has been
 * reported yet. A passenger watching the map before the driver has moved sees
 * the origin instead of a fabricated marker.
 */
export const getRideLocation = async (rideId: string): Promise<RideLocation | null> => {
  if (!rideId) return null;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(LOCATION_TABLE)
    .select(LOCATION_COLUMNS)
    .eq("ride_id", rideId)
    .maybeSingle()
    .returns<RideLocationRow>();

  if (error) throw toDataError(error, "load");
  return data ? rowToRideLocation(data as RideLocationRow) : null;
};

/**
 * The host's last known positions for several rides at once, for the passenger
 * who is watching more than one trip.
 */
export const getRideLocations = async (rideIds: string[]): Promise<Map<string, RideLocation>> => {
  const results = new Map<string, RideLocation>();
  if (rideIds.length === 0) return results;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(LOCATION_TABLE)
    .select(LOCATION_COLUMNS)
    .in("ride_id", rideIds)
    .returns<RideLocationRow[]>();

  if (error) throw toDataError(error, "load");
  for (const row of (data ?? []) as RideLocationRow[]) {
    results.set(row.ride_id, rowToRideLocation(row));
  }
  return results;
};

/**
 * Reads the stored position straight over HTTP, bypassing the PostgREST client.
 *
 * This exists for the passenger's live map, which polls on a fixed interval while
 * the map is open and needs one guaranteed-fresh row per tick. Three details are
 * deliberate and must not be "simplified" away:
 *
 *   - `cache: "no-store"`. Without it a browser or intermediary HTTP cache is
 *     free to answer with a row from minutes ago, and the marker freezes while
 *     every log line claims the read succeeded.
 *   - no cache-busting query parameter. An unrecognised PostgREST parameter is
 *     rejected outright by a strict deployment, which turns a read into a 400.
 *   - the body is read as text once and parsed once. Reading it a second time to
 *     log the lat/lon while also reading it to use the data is what previously
 *     hid the real HTTP status behind a JSON parse error.
 */
export const readRideLocationRow = async (rideId: string): Promise<RideLocation | null> => {
  if (!rideId) return null;
  const client = getSupabaseClient();
  const { data } = await client.auth.getSession();

  const url =
    `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/ride_locations`
    + `?ride_id=eq.${encodeURIComponent(rideId)}&select=*`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    cache: "no-store",
  });

  const body = await response.text();

  if (!response.ok) {
    console.error("[live-location] position read failed", {
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new DataError(
      "We could not read the driver's position. Please try again.",
      response.status >= 500 ? "server-side" : "unknown",
    );
  }

  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch (error) {
    console.error("[live-location] unreadable position response", {
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new DataError("The server returned an unreadable position. Please try again.", "server-side", error);
  }

  if (!Array.isArray(rows)) return null;
  const stored = rows[0] as RideLocationRow | undefined;
  if (!stored) return null;

  const parsed = rowToRideLocation(stored);
  return isFiniteNumber(parsed.lat) && isFiniteNumber(parsed.lon) ? parsed : null;
};

/**
 * Publishes the host's current position.
 *
 * `recorded_at` is the database's `now()`, not the browser's clock, so two
 * devices with skewed clocks cannot produce a location that looks newer than it
 * is. The `onConflict` upsert matches the unique index on `ride_id`.
 */
export const reportRideLocation = async (input: ReportPositionInput): Promise<RideLocation> => {
  const driverId = await getAuthenticatedUserId();
  if (!input.rideId) throw new DataError("That ride could not be found.", "not-found");
  if (!isFiniteNumber(input.lat) || input.lat < -90 || input.lat > 90) {
    throw new DataError("That position is not a valid latitude.", "invalid");
  }
  if (!isFiniteNumber(input.lon) || input.lon < -180 || input.lon > 180) {
    throw new DataError("That position is not a valid longitude.", "invalid");
  }
  if (input.heading != null && (!isFiniteNumber(input.heading) || input.heading < 0 || input.heading > 360)) {
    throw new DataError("A heading must be between 0 and 360 degrees.", "invalid");
  }
  if (input.speedKph != null && (!isFiniteNumber(input.speedKph) || input.speedKph < 0)) {
    throw new DataError("Speed cannot be negative.", "invalid");
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(LOCATION_TABLE)
    .upsert(
      {
        ride_id: input.rideId,
        driver_id: driverId,
        lat: input.lat,
        lon: input.lon,
        heading: input.heading ?? null,
        speed_kph: input.speedKph == null ? null : Math.round(input.speedKph),
        accuracy_meters:
          input.accuracyMeters == null ? null : Math.max(0, Math.round(input.accuracyMeters)),
      },
      { onConflict: "ride_id" },
    )
    .select(LOCATION_COLUMNS)
    .returns<RideLocationRow>()
    .maybeSingle();

  if (error) {
    const detail = `${error.message ?? ""} ${error.details ?? ""}`;
    if (/only a ride that is running|not running/i.test(detail)) {
      throw new DataError(
        "Live location is only shared once you start the ride.",
        "invalid",
        error,
      );
    }
    if (/only the driver|own ride/i.test(detail)) {
      throw new DataError("Only the driver can share a position for this ride.", "forbidden", error);
    }
    throw toDataError(error, "update");
  }
  if (!data) {
    throw new DataError("Your position could not be shared. Please try again.", "unknown");
  }
  return rowToRideLocation(data as RideLocationRow);
};

/**
 * Stops reporting. Used when the ride ends, and by the host when they pause.
 *
 * The matched row count is returned deliberately. A `delete` that matches
 * nothing is indistinguishable from a successful one unless the count is
 * checked, and a driver pressing "stop sharing" must be able to trust that the
 * stored position is actually gone rather than assuming the call succeeded.
 */
export const clearRideLocation = async (rideId: string): Promise<boolean> => {
  if (!rideId) return false;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(LOCATION_TABLE)
    .delete()
    .eq("ride_id", rideId)
    .select("id");
  if (error) throw toDataError(error, "update");
  return (data ?? []).length > 0;
};

/**
 * How far the driver is from a point, in kilometres.
 *
 * The approaching notification is triggered in the database so it fires once even
 * if several riders have the app open; this is for the UI, so a passenger can be
 * shown how far away the car is without waiting for a notification.
 */
export const distanceToRideLocationKm = (
  location: RideLocation | null | undefined,
  point: { lat: number; lon: number } | null | undefined,
): number | null => {
  if (!location || !point) return null;
  if (!isFiniteNumber(location.lat) || !isFiniteNumber(location.lon)) return null;
  return haversineDistanceKm(location, point);
};

/** How stale a position is, in seconds. Used to show "last seen 2 min ago". */
export const locationAgeSeconds = (location: RideLocation | null | undefined): number | null => {
  if (!location) return null;
  const recorded = Date.parse(location.recordedAt);
  if (Number.isNaN(recorded)) return null;
  return Math.max(0, Math.round((Date.now() - recorded) / 1000));
};

export { LOCATION_COLUMNS, LOCATION_TABLE, rowToRideLocation };
