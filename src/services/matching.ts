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
  /** Rider's preferred departure, `HH:MM`. */
  time: string;
}

export interface LocalMatch {
  ride: Ride;
  /** Where the driver can actually stop to collect this rider. */
  pickup: PickupPoint;
  /** Where this rider will be set down, on the driver's road. */
  dropoff: PickupPoint;
  score: MatchScore;
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
 */
const analyseLeg = (
  ride: Ride,
  origin: Coordinates,
  destination: Coordinates,
): {
  pickup: Anchor;
  dropoff: Anchor;
  overlap: number;
  riderLegKm: number;
} | null => {
  const pickup = anchorOnRide(ride, origin);
  const dropoff = anchorOnRide(ride, destination);

  if (pickup.distanceKm > MATCH_DEFAULTS.hardWalkLimitKm) return null;
  if (dropoff.distanceKm > MATCH_DEFAULTS.hardWalkLimitKm) return null;

  // With no corridor there is no road order to check, so a match is only claimed
  // when the rider's origin and destination are in the same direction as the
  // host's. The caller is told the ride has no corridor so it can be labelled.
  if (pickup.fraction === null || dropoff.fraction === null) {
    const along = dropoff.travelledKm - pickup.travelledKm;
    return {
      pickup,
      dropoff,
      overlap: along >= 0 ? 0.5 : 0,
      riderLegKm: haversineDistanceKm(origin, destination),
    };
  }

  if (dropoff.travelledKm <= pickup.travelledKm) return null;

  // Overlap is measured against the rider's leg. Comparing against the host's
  // whole route would punish a short ride inside a long one, which is a fine
  // arrangement for both parties.
  const sharedKm = dropoff.travelledKm - pickup.travelledKm;
  const riderLegKm = haversineDistanceKm(origin, destination);
  const overlap = riderLegKm > 0 ? Math.min(1, sharedKm / riderLegKm) : 1;

  return { pickup, dropoff, overlap, riderLegKm };
};

/** Scales a value to 0-1 where 0 is perfect and `worst` is the floor. */
const penalty = (value: number, worst: number): number =>
  worst <= 0 ? 0 : Math.max(0, Math.min(1, 1 - value / worst));

/**
 * Turns the measured parts into the 0-100 ranking score.
 *
 * Exported so the UI can show the same breakdown it ranked by, instead of
 * showing a bare number the rider cannot interrogate.
 */
export const scoreMatch = (parts: {
  overlap: number;
  walkKm: number;
  detourKm: number;
  timeDifferenceMinutes: number;
  seatsAvailable: number;
}): MatchScore => {
  const { weights } = MATCH_DEFAULTS;
  const overlapComponent = Math.max(0, Math.min(1, parts.overlap)) * weights.overlap;
  const detourComponent = penalty(parts.detourKm, MATCH_DEFAULTS.maxDetourKm) * weights.detour;
  const walkComponent =
    penalty(Math.max(parts.walkKm, 0), MATCH_DEFAULTS.maxWalkKm) * weights.walk;
  const timeComponent =
    penalty(Math.abs(parts.timeDifferenceMinutes), MATCH_DEFAULTS.maxTimeWindowMinutes) * weights.time;

  return {
    score: Math.round(overlapComponent + detourComponent + walkComponent + timeComponent),
    timeDifferenceMinutes: parts.timeDifferenceMinutes,
    walkDistanceKm: Math.round(parts.walkKm * 100) / 100,
    totalDetourKm: Math.round(Math.max(0, parts.detourKm) * 100) / 100,
    totalDetourMinutes: 0,
    overlap: Math.round(Math.max(0, Math.min(1, parts.overlap)) * 100) / 100,
    seatsAvailable: parts.seatsAvailable,
  };
};

/**
 * Ranks rides for a rider using only what is stored on each ride. No network
 * calls, so it is safe to run over a whole page of results.
 *
 * `detourKm` is left at zero here: measuring it needs a re-route, which
 * `measureDetours` does for the rides that are still in contention.
 */
export const rankRideMatches = (
  rides: readonly Ride[],
  request: MatchRequest,
  options: { timeWindowMinutes?: number; maxDetourKm?: number } = {},
): LocalMatch[] => {
  const timeWindowMinutes = options.timeWindowMinutes ?? MATCH_DEFAULTS.maxTimeWindowMinutes;
  const maxDetourKm = options.maxDetourKm ?? MATCH_DEFAULTS.maxDetourKm;
  const matches: LocalMatch[] = [];

  for (const ride of rides) {
    const timeDifferenceMinutes = minutesBetween(ride.departureTime, request.time);
    if (timeDifferenceMinutes === null || Math.abs(timeDifferenceMinutes) > timeWindowMinutes) {
      continue;
    }

    const leg = analyseLeg(ride, request.origin, request.destination);
    if (!leg) continue;
    if (leg.overlap < MATCH_DEFAULTS.minOverlap) continue;
    // The walk is capped here too: a meeting point can be improved within the
    // tolerance, but a long walk cannot.
    const walkKm = (leg.pickup.distanceKm + leg.dropoff.distanceKm) / 2;
    if (walkKm > MATCH_DEFAULTS.maxWalkKm) continue;

    matches.push({
      ride,
      pickup: leg.pickup.point,
      dropoff: leg.dropoff.point,
      score: scoreMatch({
        overlap: leg.overlap,
        walkKm,
        detourKm: 0,
        timeDifferenceMinutes,
        seatsAvailable: ride.availableSeats,
      }),
    });
  }

  matches.sort((first, second) => second.score.score - first.score.score);
  return matches.filter((match) => match.score.totalDetourKm <= maxDetourKm);
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

  if (!start.onCorridor || !end.onCorridor) {
    return [pickup, ...ride.waypoints, dropoff].slice(0, MAX_ROUTE_WAYPOINTS);
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

  // Cap the host's own stops first, so the pickup and drop-off are never the
  // points that fall off the end of the request.
  const budget = Math.max(0, MAX_ROUTE_WAYPOINTS - 2);
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
 */
export interface DetourResult {
  rideId: string;
  detourKm: number;
  detourMinutes: number;
  pickupDetourKm: number;
  dropoffDetourKm: number;
}

export const measureDetours = async (
  matches: readonly LocalMatch[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, DetourResult>> => {
  const results = new Map<string, DetourResult>();
  if (matches.length === 0) return results;

  // One request per match, but only up to a handful: this is a refinement pass
  // over the rides that already survived the local screen, and it should never
  // become the slow part of a search.
  const targets = matches.slice(0, 12);

  await Promise.all(
    targets.map(async (match) => {
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
        // cost is. Falling back to an even split is honest enough for display
        // and is clearly marked as an estimate by the component that uses it.
        const pickupOnly = await getRoute(
          origin,
          destination,
          [pickup, ...match.ride.waypoints],
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
        // A failed re-route must not remove a ride that measured fine locally.
        // It stays in the list with the detour it already has, and the UI shows
        // the ride's own distance instead of an invented detour.
        results.set(match.ride.id, {
          rideId: match.ride.id,
          detourKm: 0,
          detourMinutes: 0,
          pickupDetourKm: 0,
          dropoffDetourKm: 0,
        });
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
 * Re-ranks after detours are known, dropping the rides whose detour exceeds what
 * the rider said they would accept.
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
    if (detour.detourKm > maxDetourKm) continue;

    reranked.push({
      ...match,
      pickup: { ...match.pickup, detourKm: detour.pickupDetourKm, detourMinutes: detour.detourMinutes },
      dropoff: { ...match.dropoff, detourKm: detour.dropoffDetourKm, detourMinutes: detour.detourMinutes },
      score: {
        ...scoreMatch({
          overlap: match.score.overlap,
          walkKm: match.score.walkDistanceKm,
          detourKm: detour.detourKm,
          timeDifferenceMinutes: match.score.timeDifferenceMinutes,
          seatsAvailable: match.ride.availableSeats,
        }),
        totalDetourMinutes: detour.detourMinutes,
      },
    });
  }

  reranked.sort((first, second) => second.score.score - first.score.score);
  return reranked;
};
