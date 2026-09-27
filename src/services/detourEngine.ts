import type { Booking, Coordinates, Ride } from "../types";
import { haversineDistanceKm, projectOntoPolyline, type LonLat } from "./geometry";

export const DETOUR_DEFAULTS = {
  pickupToleranceKm: 0.7,
  dropoffToleranceKm: 1.5,
  arrivalRadiusMeters: 120,
  departureRadiusMeters: 250,
  minStopSpacingMeters: 100,
} as const;

export type StopType = "pickup" | "dropoff";

export interface ActiveStop {
  bookingId: string;
  riderId: string;
  type: StopType;
  point: Coordinates;
  fraction: number;
  detourKm: number;
}

export type NavigationState =
  | "BASE_ROUTE_TRAVEL"
  | "APPROACHING_PICKUP"
  | "ARRIVED_PICKUP"
  | "AWAITING_PICKUP_CONFIRMATION"
  | "PASSENGER_PICKED_UP"
  | "DETOUR_TO_REJOIN"
  | "APPROACHING_DROP"
  | "ARRIVED_DROP"
  | "AWAITING_DROP_CONFIRMATION"
  | "PASSENGER_DROPPED";

export interface DetourEngineConfig {
  pickupToleranceKm: number;
  dropoffToleranceKm: number;
  arrivalRadiusMeters: number;
  departureRadiusMeters: number;
}

export interface DetourEngineState {
  navigationState: NavigationState;
  activeStop: ActiveStop | null;
  orderedStops: ActiveStop[];
  driverFraction: number;
  driverProgressKm: number;
  totalRouteKm: number;
  error: string;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

export const bearingDegrees = (from: Coordinates, to: Coordinates): number => {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

export const findRejoinPoint = (
  baseGeometry: readonly LonLat[],
  driverPosition: Coordinates,
  currentFraction: number,
): { fraction: number; point: Coordinates } | null => {
  if (baseGeometry.length < 2) return null;

  const projection = projectOntoPolyline(driverPosition, baseGeometry);
  if (!projection) return null;

  const minFraction = Math.max(0, currentFraction - 0.05);
  const maxFraction = Math.min(1, currentFraction + 0.15);

  let bestFraction = projection.fraction;
  let bestDistance = projection.distanceKm;

  for (let i = 0; i < baseGeometry.length; i += 1) {
    const [lon, lat] = baseGeometry[i];
    const point = { lat, lon };
    const proj = projectOntoPolyline(point, baseGeometry);
    if (!proj) continue;
    if (proj.fraction < minFraction || proj.fraction > maxFraction) continue;
    const dist = haversineDistanceKm(driverPosition, point);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestFraction = proj.fraction;
    }
  }

  const rejoinPoint = baseGeometry[Math.round(bestFraction * (baseGeometry.length - 1))];
  return {
    fraction: bestFraction,
    point: { lat: rejoinPoint[1], lon: rejoinPoint[0], label: "Route rejoin" },
  };
};

export const orderStops = (
  stops: ActiveStop[],
  driverFraction: number,
  completedStopIds: ReadonlySet<string>,
): ActiveStop[] => {
  const pending = stops.filter((stop) => !completedStopIds.has(stop.bookingId + stop.type));
  const pickups = pending.filter((stop) => stop.type === "pickup");
  const dropoffs = pending.filter((stop) => stop.type === "dropoff");

  const ordered: ActiveStop[] = [];
  const usedBookings = new Set<string>();

  const sortedPickups = [...pickups].sort((a, b) => a.fraction - b.fraction);
  const sortedDropoffs = [...dropoffs].sort((a, b) => a.fraction - b.fraction);

  for (const pickup of sortedPickups) {
    if (usedBookings.has(pickup.bookingId)) continue;
    ordered.push(pickup);
    usedBookings.add(pickup.bookingId);

    const matchingDropoff = sortedDropoffs.find(
      (d) => d.bookingId === pickup.bookingId && !usedBookings.has(d.bookingId + "dropoff"),
    );
    if (matchingDropoff) {
      ordered.push(matchingDropoff);
      usedBookings.add(matchingDropoff.bookingId + "dropoff");
    }
  }

  for (const dropoff of sortedDropoffs) {
    if (!usedBookings.has(dropoff.bookingId + "dropoff")) {
      ordered.push(dropoff);
    }
  }

  return ordered;
};

export const calculateDriverProgress = (
  driverPosition: Coordinates,
  baseGeometry: readonly LonLat[],
): { fraction: number; progressKm: number; totalKm: number } => {
  if (baseGeometry.length < 2) return { fraction: 0, progressKm: 0, totalKm: 0 };

  const projection = projectOntoPolyline(driverPosition, baseGeometry);
  if (!projection) return { fraction: 0, progressKm: 0, totalKm: 0 };

  let totalKm = 0;
  for (let i = 1; i < baseGeometry.length; i += 1) {
    totalKm += haversineDistanceKm(
      { lat: baseGeometry[i - 1][1], lon: baseGeometry[i - 1][0] },
      { lat: baseGeometry[i][1], lon: baseGeometry[i][0] },
    );
  }

  return {
    fraction: projection.fraction,
    progressKm: projection.travelledKm,
    totalKm,
  };
};

export const checkProximity = (
  driverPosition: Coordinates,
  stop: ActiveStop,
  config: DetourEngineConfig,
): "far" | "approaching" | "arrived" => {
  const distanceMeters = haversineDistanceKm(driverPosition, stop.point) * 1000;

  if (distanceMeters <= config.arrivalRadiusMeters) return "arrived";
  if (distanceMeters <= config.arrivalRadiusMeters * 3) return "approaching";
  return "far";
};

export const checkDeparture = (
  driverPosition: Coordinates,
  stop: ActiveStop,
  config: DetourEngineConfig,
): boolean => {
  const distanceMeters = haversineDistanceKm(driverPosition, stop.point) * 1000;
  return distanceMeters >= config.departureRadiusMeters;
};

export const buildActiveStops = (
  bookings: Booking[],
  ride: Ride,
  config: DetourEngineConfig,
): ActiveStop[] => {
  const stops: ActiveStop[] = [];
  const geometry = (ride.routeGeometry ?? []) as LonLat[];

  for (const booking of bookings) {
    if (booking.status !== "confirmed" && booking.status !== "picked_up") continue;

    if (booking.pickup) {
      const projection = geometry.length
        ? projectOntoPolyline(booking.pickup, geometry)
        : null;
      const walkKm = projection?.distanceKm ?? haversineDistanceKm(booking.pickup, ride.origin);

      if (walkKm <= config.pickupToleranceKm) {
        stops.push({
          bookingId: booking.id,
          riderId: booking.riderId,
          type: "pickup",
          point: booking.pickup,
          fraction: projection?.fraction ?? 0,
          detourKm: booking.pickup.detourKm ?? 0,
        });
      }
    }

    if (booking.dropoff) {
      const projection = geometry.length
        ? projectOntoPolyline(booking.dropoff, geometry)
        : null;
      const walkKm = projection?.distanceKm ?? haversineDistanceKm(booking.dropoff, ride.destination);

      if (walkKm <= config.dropoffToleranceKm) {
        stops.push({
          bookingId: booking.id,
          riderId: booking.riderId,
          type: "dropoff",
          point: booking.dropoff,
          fraction: projection?.fraction ?? 0.5,
          detourKm: booking.dropoff.detourKm ?? 0,
        });
      }
    }
  }

  return stops;
};

export const getNavigationRoute = (
  baseGeometry: readonly LonLat[],
  activeStop: ActiveStop | null,
  driverPosition: Coordinates,
  driverFraction: number,
): Coordinates[] => {
  if (!activeStop) {
    const remaining = baseGeometry.filter((_, index) => {
      const fraction = index / (baseGeometry.length - 1);
      return fraction >= driverFraction - 0.02;
    });
    return remaining.map(([lon, lat]) => ({ lat, lon, label: "" }));
  }

  const rejoin = findRejoinPoint(baseGeometry, driverPosition, driverFraction);
  const route: Coordinates[] = [driverPosition];

  if (activeStop.type === "pickup") {
    route.push(activeStop.point);
    if (rejoin) route.push(rejoin.point);
  } else {
    const pickupStop = activeStop;
    route.push(pickupStop.point);
    if (rejoin) route.push(rejoin.point);
  }

  return route;
};
