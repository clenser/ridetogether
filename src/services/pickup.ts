import type { Coordinates, PickupPoint, Ride } from "../types";
import { haversineDistanceKm, projectOntoPolyline, type LonLat } from "./geometry";
import { getRoute, MAX_ROUTE_WAYPOINTS } from "./routing";
import { MATCH_DEFAULTS, passengerRouteWaypoints } from "./matching";

/**
 * Turns a rider's requested origin and destination into concrete places the
 * driver can actually stop.
 *
 * A rider types "Koramangala". The driver is not going to the middle of
 * Koramangala, they are going to be on 80 Feet Road already. So the candidate
 * points offered here are vertices of the **host's own road corridor** that are
 * within walking distance of the rider's request - a corner on the route the
 * car is already using, rather than an invented point in the middle of a
 * locality.
 *
 * Nothing here fabricates a location. Every candidate is a real coordinate from
 * the geometry Valhalla returned for this driver, and the walk shown to the
 * rider is the measured distance from their request to that point.
 */

export interface PickupCandidate {
  /** Stable within one proposal, so React keys and selection survive re-renders. */
  id: string;
  point: PickupPoint;
  /** 0-1 along the driver's route. */
  fraction: number;
  /** Measured distance from the rider's request to this point. */
  walkKm: number;
  /** The leg of the driver's route this point sits on, e.g. "after Koramangala". */
  description: string;
}

export interface PickupProposal {
  pickups: PickupCandidate[];
  dropoffs: PickupCandidate[];
  /** Best local pairing, before the network check. */
  recommended: { pickup: PickupCandidate; dropoff: PickupCandidate } | null;
  /** False when the ride has no stored corridor, so the UI can say so plainly. */
  basedOnCorridor: boolean;
  /** Populated when the ride genuinely has no usable meeting point nearby. */
  notice?: string;
}

const DEGREES = (radians: number): number => (radians * 180) / Math.PI;

/** Compass point for a bearing, for the "walk north-east" hint. */
const bearingLabel = (from: Coordinates, to: Coordinates): string => {
  const latitude1 = (from.lat * Math.PI) / 180;
  const latitude2 = (to.lat * Math.PI) / 180;
  const deltaLongitude = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  const bearing = (DEGREES(Math.atan2(y, x)) + 360) % 360;
  const points = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
  ];
  return points[Math.round(bearing / 45) % 8];
};

/** A plain-language description of where on the route a candidate sits. */
const describeAlongRoute = (ride: Ride, fraction: number, walking: string): string => {
  const stops = ride.waypoints;
  if (fraction < 0.08) {
    return `Just after ${ride.origin.label}${walking ? `, ${walking}` : ""}`;
  }
  if (fraction > 0.92) {
    return `Just before ${ride.destination.label}${walking ? `, ${walking}` : ""}`;
  }
  // Find the last stop the candidate is after, so the rider hears a place name
  // they recognise rather than a percentage.
  let afterLabel: string | null = null;
  for (const stop of stops) {
    const projection = projectOntoPolyline(stop, ride.routeGeometry as LonLat[]);
    if (projection && projection.fraction < fraction) afterLabel = stop.label;
  }
  return afterLabel
    ? `On the way from ${afterLabel} to ${ride.destination.label}`
    : `On the way to ${ride.destination.label}`;
};

/**
 * Vertices of the host's route within walking distance of a rider's request,
 * thinned so the options are spread along the road instead of clustered on one
 * junction.
 */
const candidatesAlongRoute = (
  ride: Ride,
  request: Coordinates,
  options: { maxWalkKm: number; maxCandidates: number; maxFraction: number; minFraction: number; idPrefix: string },
): PickupCandidate[] => {
  const geometry = (ride.routeGeometry ?? []) as LonLat[];
  if (geometry.length < 2) return [];

  const maxCandidates = Math.max(1, options.maxCandidates);
  const found: PickupCandidate[] = [];

  for (let index = 0; index < geometry.length; index += 1) {
    const [lon, lat] = geometry[index];
    const point = { lat, lon, label: request.label };
    const walkKm = haversineDistanceKm(request, point);
    if (walkKm > options.maxWalkKm) continue;

    const projection = projectOntoPolyline(point, geometry);
    if (!projection) continue;
    if (projection.fraction < options.minFraction || projection.fraction > options.maxFraction) continue;

    found.push({
      id: `${options.idPrefix}-${index}`,
      point: { lat, lon, label: request.label, walkDistanceKm: Math.round(walkKm * 100) / 100 },
      fraction: projection.fraction,
      walkKm: Math.round(walkKm * 100) / 100,
      description: describeAlongRoute(
        ride,
        projection.fraction,
        walkKm < 0.15 ? "right on your side of the road" : `walk ${bearingLabel(request, point)}`,
      ),
    });
  }

  if (found.length === 0) return [];

  // Thin by walking the list and keeping every step-th candidate, which
  // guarantees the survivors are spread along the route.
  const step = Math.max(1, Math.ceil(found.length / maxCandidates));
  const thinned: PickupCandidate[] = [];
  for (let index = 0; index < found.length; index += step) {
    thinned.push(found[index]);
  }
  // The nearest point is always worth offering, even if thinning skipped it.
  const nearest = found.reduce((best, current) => (current.walkKm < best.walkKm ? current : best));
  if (!thinned.some((candidate) => candidate.id === nearest.id)) {
    thinned.unshift(nearest);
    thinned.length = Math.min(thinned.length, maxCandidates + 1);
  }

  return thinned;
};

export interface BuildProposalOptions {
  maxWalkKm?: number;
  maxPickups?: number;
  maxDropoffs?: number;
}

/**
 * Proposes where the driver can collect the rider and where they will be set
 * down, both on the host's route.
 *
 * Pickup candidates are taken from the earlier part of the route and drop-off
 * candidates from the later part, so any pairing is in driving order by
 * construction. The recommended pair is the one that keeps the walk short and
 * shares the most road, which is the best default to offer before the caller
 * spends a routing request on verification.
 */
export const buildPickupProposal = (
  ride: Ride,
  origin: Coordinates,
  destination: Coordinates,
  options: BuildProposalOptions = {},
): PickupProposal => {
  const maxWalkKm = options.maxWalkKm ?? MATCH_DEFAULTS.maxWalkKm;
  const maxPickups = options.maxPickups ?? 3;
  const maxDropoffs = options.maxDropoffs ?? 3;

  const pickups = candidatesAlongRoute(ride, origin, {
    maxWalkKm,
    maxCandidates: maxPickups,
    // Collecting is offered only in the first two-thirds of the trip: a driver
    // who would have to backtrack to collect is not offering that ride.
    minFraction: 0.02,
    maxFraction: 0.66,
    idPrefix: "pickup",
  });

  const dropoffs = candidatesAlongRoute(ride, destination, {
    maxWalkKm,
    maxCandidates: maxDropoffs,
    // The drop-off has to be after the pickup, and pickup candidates never run
    // past 0.66, so anything from there on is safely later.
    minFraction: 0.34,
    maxFraction: 0.98,
    idPrefix: "dropoff",
  });

  const pairs = pickups.flatMap((pickup) =>
    dropoffs
      .filter((dropoff) => dropoff.fraction > pickup.fraction)
      .map((dropoff) => ({ pickup, dropoff })),
  );

  if (pairs.length === 0) {
    return {
      pickups,
      dropoffs,
      recommended: null,
      basedOnCorridor: Boolean(ride.routeGeometry?.length),
      notice: pickups.length === 0 || dropoffs.length === 0
        ? "No meeting point near that address sits on this driver's route. Try searching from a nearby landmark, or pick a different ride."
        : "No drop-off point near that address comes after any pickup point on this route.",
    };
  }

  // Best default: least walking first, then the longest shared stretch of road.
  const best = pairs.reduce((winner, candidate) => {
    const candidateWalk = candidate.pickup.walkKm + candidate.dropoff.walkKm;
    const winnerWalk = winner.pickup.walkKm + winner.dropoff.walkKm;
    if (candidateWalk !== winnerWalk) return candidateWalk < winnerWalk ? candidate : winner;
    const candidateShared = candidate.dropoff.fraction - candidate.pickup.fraction;
    const winnerShared = winner.dropoff.fraction - winner.pickup.fraction;
    return candidateShared > winnerShared ? candidate : winner;
  });

  return {
    pickups,
    dropoffs,
    recommended: best,
    basedOnCorridor: true,
  };
};

export interface VerifiedPairing {
  pickup: PickupPoint;
  dropoff: PickupPoint;
  detourKm: number;
  detourMinutes: number;
  /** Total time from the driver's origin with the passenger aboard. */
  totalMinutes: number;
  totalKm: number;
}

/**
 * Confirms a candidate pairing with the routing service before it is stored on
 * the booking, so the detour recorded in the database is measured rather than
 * estimated.
 *
 * A failure here is reported as a failure. No fallback estimate is invented: an
 * unverified detour is not something to write into a booking another person will
 * act on.
 */
export const verifyPickupPairing = async (
  ride: Ride,
  pickup: PickupCandidate,
  dropoff: PickupCandidate,
  options: { signal?: AbortSignal } = {},
): Promise<VerifiedPairing> => {
  const baseKm = ride.distanceKm ?? 0;
  const baseMinutes = ride.durationMinutes ?? 0;

  const pickupPoint: Coordinates = {
    lat: pickup.point.lat,
    lon: pickup.point.lon,
    label: `${ride.origin.label} pickup`,
  };
  const dropoffPoint: Coordinates = {
    lat: dropoff.point.lat,
    lon: dropoff.point.lon,
    label: `${ride.destination.label} drop-off`,
  };

  // The pickup-only request adds one location in front of the host's own stops,
  // so a ride that is already at the waypoint limit would otherwise exceed it and
  // getRoute would throw - taking the whole pairing verification down with it.
  // The surplus is trimmed from the tail, which keeps the stretch that actually
  // determines the pickup's cost and matches how the passenger leg is capped.
  const pickupOnlyStops = [pickupPoint, ...ride.waypoints].slice(0, MAX_ROUTE_WAYPOINTS);

  // Two requests: the full trip with the passenger, and the trip with only the
  // pickup. The difference is the pickup's own cost, which the host cares about
  // separately from the drop-off. Both end at the host's own destination - the
  // driver is still driving there after setting the passenger down.
  const [withPassenger, withPickupOnly] = await Promise.all([
    getRoute(
      ride.origin,
      ride.destination,
      passengerRouteWaypoints(ride, pickupPoint, dropoffPoint),
      options,
    ),
    getRoute(ride.origin, ride.destination, pickupOnlyStops, options),
  ]);

  const detourKm = Math.max(0, withPassenger.distanceKm - baseKm);
  const pickupDetourKm = Math.max(0, withPickupOnly.distanceKm - baseKm);
  const round = (value: number): number => Math.round(value * 100) / 100;

  return {
    pickup: {
      ...pickupPoint,
      walkDistanceKm: pickup.walkKm,
      detourKm: round(pickupDetourKm),
      detourMinutes: Math.max(0, Math.round(withPickupOnly.durationMinutes - baseMinutes)),
    },
    dropoff: {
      ...dropoffPoint,
      walkDistanceKm: dropoff.walkKm,
      detourKm: round(Math.max(0, detourKm - pickupDetourKm)),
      detourMinutes: Math.max(0, Math.round(withPassenger.durationMinutes - withPickupOnly.durationMinutes)),
    },
    detourKm: round(detourKm),
    detourMinutes: Math.max(0, Math.round(withPassenger.durationMinutes - baseMinutes)),
    totalMinutes: withPassenger.durationMinutes,
    totalKm: withPassenger.distanceKm,
  };
};
