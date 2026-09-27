import type { Coordinates, MatchScore, PickupPoint, Ride } from "../types";
import { haversineDistanceKm, projectOntoPolyline, type LonLat } from "./geometry";
import { getRoute, MAX_ROUTE_WAYPOINTS } from "./routing";

/**
 * Decides which published rides suit a rider's origin, destination and time.
 *
 * The rule the product is built on: a ride is a match when the rider's trip lies
 * **along the driver's road**, not merely between the same two pins. A driver
 * going Airport -> MG Road and a rider wanting Domlur -> MG Road overlap for
 * most of the way even though their straight-line origins are 6 km apart, and a
 * driver going the opposite direction through the same area overlaps for
 * almost none of it. Only a road corridor can tell those apart.
 *
 * So the comparison here is:
 *
 *   1. project the rider's pickup and drop-off onto the host's stored route,
 *   2. measure how far off the road each one is (the walk),
 *   3. measure how much of the host's route the two points bracket (the shared
 *      leg, and therefore how much of the trip they ride together), and
 *   4. re-route host -> pickup -> drop-off -> host destination through Valhalla
 *      to get the real detour the passenger costs the driver.
 *
 * Step 4 is the one that needs the network, so it is opt-in: `rankRideMatches`
 * does the cheap local work first and only asks Valhalla about the rides that
 * survived it.
 *
 * The composite `score` exists purely to order the list. Its inputs are all
 * displayed next to it, so a rider can always see the measurements the number
 * was built from, and the UI is careful never to present it as a probability.
 */

export const MATCH_DEFAULTS = {
  /**
   * How far the rider is willing to walk from where they asked to be collected
   * to where the car can actually stop. Pickup points are only proposed within
   * this radius.
   */
  maxWalkKm: 2.5,
  /**
   * Ceiling on the walk considered at all, before scoring. A rider five
   * kilometres from the road is not a match they can fix by picking a slightly
   * better meeting point, so it is filtered out rather than ranked low.
   */
  hardWalkLimitKm: 6,
  /** Longest shared leg, as a share of the rider's own trip, still worth showing. */
  minOverlap: 0.25,
  /** Total detour (pickup + drop-off) the rider accepts before it is filtered out. */
  maxDetourKm: 12,
  /** Either side of the rider's preferred time a host may depart. */
  maxTimeWindowMinutes: 90,
  /** Weights for the ranking score. They sum to 100. */
  weights: {
    overlap: 40,
    detour: 25,
    walk: 20,
    time: 15,
  },
} as const;

export interface MatchRequest {
  origin: Coordinates;
  destination: Coordinates;
  /**
   * Rider's preferred departure, `HH:MM`. Optional: leaving it blank means "any
   * time that day", which is a search the rider can genuinely make and one the
   * window has no business filtering.
   */
  time?: string;
}

export interface LocalMatch {
  ride: Ride;
  /** Where the driver can actually stop to collect this rider. */
  pickup: PickupPoint;
  /** Where this rider will be set down, on the driver's road. */
  dropoff: PickupPoint;
  score: MatchScore;
  /**
   * False when the ride was published without a stored route, so the pickup and
   * drop-off are its endpoints rather than points on a real road. The match is
   * shown, and labelled, instead of being given an invented corridor.
   */
  onCorridor: boolean;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** `HH:MM` to minutes past midnight, or null when unusable. */
export const parseClockMinutes = (time: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/** Minutes between two `HH:MM` values, wrapping past midnight in both directions. */
export const minutesBetween = (from: string, to: string): number | null => {
  const fromMinutes = parseClockMinutes(from);
  const toMinutes = parseClockMinutes(to);
  if (fromMinutes === null || toMinutes === null) return null;
  const difference = toMinutes - fromMinutes;
  if (Math.abs(difference) <= 720) return difference;
  return difference > 0 ? difference - 1440 : difference + 1440;
};

/**
 * How far off the driver's road a point is, and where on the road to meet.
 *
 * A ride published before route persistence was added has no geometry. Rather
 * than drop it, the endpoint itself is used as a single anchor: the result is
 * weaker but honest, and the UI marks the ride as having no corridor rather than
 * inventing one.
 */
export interface Anchor {
  point: Coordinates;
  distanceKm: number;
  travelledKm: number;
  /** Null when the ride has no stored corridor, so callers can say so. */
  fraction: number | null;
  onCorridor: boolean;
}

export const anchorOnRide = (ride: Ride, point: Coordinates): Anchor => {
  const geometry = ride.routeGeometry as LonLat[] | undefined;
  const projection = geometry?.length
    ? projectOntoPolyline(point, geometry)
    : null;

  if (!projection) {
    const onRoad = haversineDistanceKm(point, ride.origin);
    return {
      point: { ...ride.origin, label: ride.origin.label },
      distanceKm: onRoad,
      travelledKm: 0,
      fraction: null,
      onCorridor: false,
    };
  }

  return {
    point: { lat: projection.point.lat, lon: projection.point.lon, label: point.label },
    distanceKm: projection.distanceKm,
    travelledKm: projection.travelledKm,
    fraction: projection.fraction,
    onCorridor: true,
  };
};

/**
 * The shape of a match before any detour is known.
 *
 * `overlap` is the share of the rider's own leg that sits on the driver's road,
 * which is the part of the trip they actually share. Requiring the drop-off to
 * come after the pickup along the route is what rejects a ride heading the wrong
 * way: a passenger who joins after the driver has already passed their drop-off
 * would have to turn back, so that is not a match.
 *
 * `overlap` is null when the ride has no stored corridor. There is then no road
 * order to project onto and nothing to measure against, so no number is claimed -
 * see `anchorOnRide`, where both anchors collapse to the ride's own origin and
 * carry no distance along the route at all.
 */
const analyseLeg = (
  ride: Ride,
  origin: Coordinates,
  destination: Coordinates,
): {
  pickup: Anchor;
  dropoff: Anchor;
  overlap: number | null;
  riderLegKm: number;
} | null => {
  const pickup = anchorOnRide(ride, origin);
  const dropoff = anchorOnRide(ride, destination);

  if (pickup.distanceKm > MATCH_DEFAULTS.hardWalkLimitKm) return null;
  if (dropoff.distanceKm > MATCH_DEFAULTS.hardWalkLimitKm) return null;

  const riderLegKm = haversineDistanceKm(origin, destination);

  // Without geometry there is no road order to check, so whether the driver is
  // going the rider's way is unknown. The ride is kept and reported as having no
  // corridor; the overlap is left unmeasured.
  if (pickup.fraction === null || dropoff.fraction === null) {
    return { pickup, dropoff, overlap: null, riderLegKm };
  }

  if (dropoff.travelledKm <= pickup.travelledKm) return null;

  // Overlap is measured against the rider's leg. Comparing against the host's
  // whole route would punish a short ride inside a long one, which is a fine
  // arrangement for both parties.
  const sharedKm = dropoff.travelledKm - pickup.travelledKm;
  const overlap = riderLegKm > 0 ? Math.min(1, sharedKm / riderLegKm) : 1;

  return { pickup, dropoff, overlap, riderLegKm };
};

/** Scales a value to 0-1 where 0 is perfect and `worst` is the floor. */
const penalty = (value: number, worst: number): number =>
  worst <= 0 ? 0 : Math.max(0, Math.min(1, 1 - value / worst));

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Turns the measured parts into the 0-100 ranking score.
 *
 * Exported so the UI can show the same breakdown it ranked by, instead of
 * showing a bare number the rider cannot interrogate.
 *
 * Only the parts that were actually measured take part. A dimension the rider
 * never asked about (no departure time given) or that failed to measure (the
 * re-route could not be fetched) is dropped from the score and its weight is
 * shared out across the rest, so the number stays a fair ranking of what is known
 * instead of being dragged down - or inflated - by an input nobody supplied. The
 * unmeasured values are reported as null alongside so the UI can say so.
 */
export const scoreMatch = (parts: {
  overlap: number | null;
  walkKm: number;
  detourKm: number | null;
  timeDifferenceMinutes: number | null;
  seatsAvailable: number;
  detourMinutes?: number | null;
}): MatchScore => {
  const { weights } = MATCH_DEFAULTS;

  const components: Array<{ weight: number; earned: number }> = [];
  if (parts.overlap !== null) {
    components.push({ weight: weights.overlap, earned: clamp01(parts.overlap) });
  }
  if (parts.detourKm !== null) {
    components.push({ weight: weights.detour, earned: penalty(parts.detourKm, MATCH_DEFAULTS.maxDetourKm) });
  }
  components.push({ weight: weights.walk, earned: penalty(Math.max(0, parts.walkKm), MATCH_DEFAULTS.maxWalkKm) });
  if (parts.timeDifferenceMinutes !== null) {
    components.push({
      weight: weights.time,
      earned: penalty(Math.abs(parts.timeDifferenceMinutes), MATCH_DEFAULTS.maxTimeWindowMinutes),
    });
  }

  const availableWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const earnedWeight = components.reduce((sum, component) => sum + component.earned * component.weight, 0);
  const score = availableWeight > 0 ? Math.round((earnedWeight / availableWeight) * 100) : 0;

  return {
    score,
    timeDifferenceMinutes: parts.timeDifferenceMinutes,
    walkDistanceKm: Math.round(Math.max(0, parts.walkKm) * 100) / 100,
    totalDetourKm: parts.detourKm === null ? null : Math.round(Math.max(0, parts.detourKm) * 100) / 100,
    totalDetourMinutes: parts.detourMinutes === null || parts.detourMinutes === undefined
      ? null
      : Math.max(0, Math.round(parts.detourMinutes)),
    overlap: parts.overlap === null ? null : Math.round(clamp01(parts.overlap) * 100) / 100,
    seatsAvailable: parts.seatsAvailable,
  };
};

/**
 * Ranks rides for a rider using only what is stored on each ride. No network
 * calls, so it is safe to run over a whole page of results.
 *
 * `detourKm` is left unmeasured here: measuring it needs a re-route, which
 * `measureDetours` does for the rides that are still in contention. For the same
 * reason no detour limit is applied yet - every ride would carry an unmeasured
 * detour and none could be filtered, so `applyDetourResults` does it once the real
 * numbers exist.
 */
export const rankRideMatches = (
  rides: readonly Ride[],
  request: MatchRequest,
  options: { timeWindowMinutes?: number } = {},
): LocalMatch[] => {
  const timeWindowMinutes = options.timeWindowMinutes ?? MATCH_DEFAULTS.maxTimeWindowMinutes;
  const wantedTime = request.time?.trim() ?? "";
  if (wantedTime && parseClockMinutes(wantedTime) === null) {
    // A time that cannot be read is a caller bug, not a search with no time. Failing
    // loudly beats silently matching every ride in the day as though no time was asked.
    throw new RangeError(`"${wantedTime}" is not a time of day. Use HH:MM.`);
  }

  const matches: LocalMatch[] = [];

  for (const ride of rides) {
    const timeDifferenceMinutes = wantedTime ? minutesBetween(ride.departureTime, wantedTime) : null;
    // With no time asked for, the window does not apply. With a time asked for, a
    // host outside the window is not a match at all.
    if (timeDifferenceMinutes !== null && Math.abs(timeDifferenceMinutes) > timeWindowMinutes) {
      continue;
    }

    const leg = analyseLeg(ride, request.origin, request.destination);
    if (!leg) continue;
    if (leg.overlap !== null && leg.overlap < MATCH_DEFAULTS.minOverlap) continue;
    // The walk is capped here too: a meeting point can be improved within the
    // tolerance, but a long walk cannot.
    const walkKm = (leg.pickup.distanceKm + leg.dropoff.distanceKm) / 2;
    if (walkKm > MATCH_DEFAULTS.maxWalkKm) continue;

    matches.push({
      ride,
      pickup: leg.pickup.point,
      dropoff: leg.dropoff.point,
      onCorridor: leg.pickup.fraction !== null && leg.dropoff.fraction !== null,
      score: scoreMatch({
        overlap: leg.overlap,
        walkKm,
        detourKm: null,
        timeDifferenceMinutes,
        seatsAvailable: ride.availableSeats,
      }),
    });
  }

  matches.sort((first, second) => second.score.score - first.score.score);
  return matches;
};

/**
 * The location list for re-routing a host's trip with a passenger on board.
 *
 * The passenger is spliced into the host's own sequence at the point where their
 * leg actually falls, rather than being pinned to the front and back. A host who
 * stops for coffee 4 km along, collects a passenger, drops them, then stops again
 * is a real trip; emitting "pickup, coffee, fuel, dropoff" would send the driver
 * back the way they came, and the detour reported to the rider would be that
 * detour rather than the honest one. So stops before the pickup stay before it,
 * stops after the drop-off stay after it, and only the stops the new leg already
 * covers are removed.
 *
 * Without a stored corridor there is no road order to reason about. In that case
 * the original order is preserved and the passenger's leg is appended, which is
 * the same honest fallback used elsewhere for corridor-less rides: a number that
 * may be an overestimate, never a fabricated one.
 */
export const passengerRouteWaypoints = (
  ride: Ride,
  pickup: Coordinates,
  dropoff: Coordinates,
): Coordinates[] => {
  const start = anchorOnRide(ride, pickup);
  const end = anchorOnRide(ride, dropoff);
  // The host's own stops are the first thing to give up when the request hits the
  // waypoint budget. The pickup and drop-off are the two points the re-route exists
  // to measure, so they are reserved first and the host's stops fill what is left.
  const budget = Math.max(0, MAX_ROUTE_WAYPOINTS - 2);

  if (!start.onCorridor || !end.onCorridor) {
    return [pickup, ...ride.waypoints.slice(0, budget), dropoff];
  }

  const before: Coordinates[] = [];
  const after: Coordinates[] = [];
  for (const stop of ride.waypoints) {
    const anchor = anchorOnRide(ride, stop);
    if (!anchor.onCorridor) {
      // A stop that is not on the corridor cannot be placed by road order, and
      // guessing would be worse than keeping the host's declared sequence.
      before.push(stop);
      continue;
    }
    if (anchor.travelledKm < start.travelledKm) before.push(stop);
    else if (anchor.travelledKm > end.travelledKm) after.push(stop);
    // Between the two anchors the passenger's leg already covers that stretch.
  }

  return [pickup, ...[...before, ...after].slice(0, budget), dropoff];
};

/**
 * Re-routes `host origin -> pickup -> drop-off -> host destination` and reports
 * what the passenger actually costs the driver.
 *
 * The detour is the extra distance and time versus the host's own route. A
 * negative time is possible when a detour replaces a slower stretch of the
 * original path, so only the distance is allowed to drive a decision; the time
 * is reported because riders and drivers both want to know it.
 *
 * Every field is null when the re-route failed. The ride is kept rather than
 * dropped, and the unmeasured values are surfaced as such: a ride whose detour
 * could not be fetched must not appear in the list as a zero-detour bargain,
 * because that is a claim the app has no basis for, and it would rank above rides
 * that were measured honestly.
 */
export interface DetourResult {
  rideId: string;
  /** Null when the re-route could not be measured. */
  detourKm: number | null;
  detourMinutes: number | null;
  /** The host's extra driving to reach the pickup, or null when unmeasured. */
  pickupDetourKm: number | null;
  /** The host's extra driving after the drop-off, or null when unmeasured. */
  dropoffDetourKm: number | null;
}

/** What a caller sees for a ride whose re-route failed. */
const UNMEASURED_DETOUR: Omit<DetourResult, "rideId"> = {
  detourKm: null,
  detourMinutes: null,
  pickupDetourKm: null,
  dropoffDetourKm: null,
};

export const measureDetours = async (
  matches: readonly LocalMatch[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, DetourResult>> => {
  const results = new Map<string, DetourResult>();
  if (matches.length === 0) return results;

  /**
   * The caller decides how many rides are worth a network round trip - it already
   * has to, to label the ones it left out. This used to cap the list again at 12,
   * which silently made the caller's own budget a lie whenever it was larger.
   */
  await Promise.all(
    matches.map(async (match) => {
      const origin = match.ride.origin;
      const destination = match.ride.destination;

      const pickup = withLabel(match.pickup, `${match.ride.origin.label} pickup`);
      const dropoff = withLabel(match.dropoff, `${match.ride.destination.label} drop-off`);

      const base = isFiniteNumber(match.ride.distanceKm) ? match.ride.distanceKm : 0;

      try {
        const withPassenger = await getRoute(
          origin,
          destination,
          passengerRouteWaypoints(match.ride, pickup, dropoff),
          options,
        );
        const detourKm = Math.max(0, withPassenger.distanceKm - base);

        // Split the detour between the two ends so the UI can show where the
        // cost is. The split is measured by re-routing with the pickup alone,
        // rather than halved, so the two figures the rider sees add up to the
        // total that was actually measured.
        const pickupOnly = await getRoute(
          origin,
          destination,
          [pickup, ...match.ride.waypoints].slice(0, MAX_ROUTE_WAYPOINTS),
          options,
        );
        const pickupDetourKm = Math.max(0, pickupOnly.distanceKm - base);

        results.set(match.ride.id, {
          rideId: match.ride.id,
          detourKm: Math.round(detourKm * 100) / 100,
          detourMinutes: Math.max(0, Math.round(withPassenger.durationMinutes - (match.ride.durationMinutes ?? 0))),
          pickupDetourKm: Math.round(pickupDetourKm * 100) / 100,
          dropoffDetourKm: Math.round(Math.max(0, detourKm - pickupDetourKm) * 100) / 100,
        });
      } catch {
        // A failed re-route must not remove a ride that measured fine locally, and
        // must not be recorded as costing the driver nothing.
        results.set(match.ride.id, { rideId: match.ride.id, ...UNMEASURED_DETOUR });
      }
    }),
  );

  return results;
};

const withLabel = (point: Coordinates, label: string): Coordinates => ({
  lat: point.lat,
  lon: point.lon,
  label: point.label?.trim() || label,
});

/**
 * Re-ranks after detours are known, dropping the rides whose measured detour
 * exceeds what the rider said they would accept.
 *
 * A ride whose re-route failed is kept and ranked on what is known, with the
 * detour simply left out of the score. Dropping it would hide a ride that is
 * probably fine because Valhalla was briefly unavailable, and keeping it with a
 * zero would rank it as though it had been proven to cost nothing.
 */
export const applyDetourResults = (
  matches: readonly LocalMatch[],
  detours: Map<string, DetourResult>,
  options: { maxDetourKm?: number } = {},
): LocalMatch[] => {
  const maxDetourKm = options.maxDetourKm ?? MATCH_DEFAULTS.maxDetourKm;

  const reranked: LocalMatch[] = [];
  for (const match of matches) {
    const detour = detours.get(match.ride.id);
    if (!detour) continue;
    if (detour.detourKm !== null && detour.detourKm > maxDetourKm) continue;

    const score = scoreMatch({
      overlap: match.score.overlap,
      walkKm: match.score.walkDistanceKm,
      detourKm: detour.detourKm,
      timeDifferenceMinutes: match.score.timeDifferenceMinutes,
      seatsAvailable: match.ride.availableSeats,
      detourMinutes: detour.detourMinutes,
    });

    reranked.push({
      ...match,
      // Distance is attributed to each end, because the pickup was re-routed on
      // its own to find it. Minutes are not: only the leg as a whole was timed, so
      // that figure stays on the score instead of being written onto both points.
      pickup: { ...match.pickup, detourKm: detour.pickupDetourKm ?? undefined },
      dropoff: { ...match.dropoff, detourKm: detour.dropoffDetourKm ?? undefined },
      score,
    });
  }

  reranked.sort((first, second) => second.score.score - first.score.score);
  return reranked;
};
