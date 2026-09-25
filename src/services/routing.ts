import type { Coordinates, RouteResult } from "../types";

export const MAX_ROUTE_WAYPOINTS = 8;

interface ValhallaLocation {
  lat: number;
  lon: number;
  name?: string;
  type: "break" | "through";
}

interface ValhallaRouteRequest {
  locations: ValhallaLocation[];
  costing: "auto";
  units: "kilometers";
  directions_options: {
    units: "kilometers";
  };
}

interface ValhallaRouteResponse {
  trip?: {
    legs?: Array<{
      shape?: unknown;
      summary?: {
        length?: unknown;
        time?: unknown;
      };
    }>;
    summary?: {
      length?: unknown;
      time?: unknown;
    };
  };
  error?: unknown;
}

export interface RouteOptions {
  signal?: AbortSignal;
}

interface CachedRoute {
  expiresAt: number;
  result: RouteResult;
}

const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
const ROUTE_REQUEST_TIMEOUT_MS = 15_000;
const routeCache = new Map<string, CachedRoute>();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const assertCoordinate = (coordinate: Coordinates, name: string): void => {
  if (
    !Number.isFinite(coordinate.lat) ||
    coordinate.lat < -90 ||
    coordinate.lat > 90 ||
    !Number.isFinite(coordinate.lon) ||
    coordinate.lon < -180 ||
    coordinate.lon > 180 ||
    !coordinate.label.trim()
  ) {
    throw new Error(`${name} contains invalid coordinates.`);
  }
};

const abortError = (message: string): Error => {
  try {
    return new DOMException(message, "AbortError");
  } catch {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
};

const routeCacheKey = (
  origin: Coordinates,
  destination: Coordinates,
  waypoints: Coordinates[],
): string =>
  [origin, ...waypoints, destination]
    .map((location) => `${location.lat.toFixed(5)},${location.lon.toFixed(5)}`)
    .join(";");

const decodePolyline = (
  encoded: string,
  precision = 6,
): [number, number][] => {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63 || !Number.isFinite(byte)) {
        throw new Error("The routing service returned malformed route geometry.");
      }
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63 || !Number.isFinite(byte)) {
        throw new Error("The routing service returned malformed route geometry.");
      }
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([longitude / factor, latitude / factor]);
  }

  return coordinates;
};

const extractError = (payload: ValhallaRouteResponse): string => {
  if (typeof payload.error === "string") return payload.error;
  if (
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return "No route was returned.";
};

export const clearRouteCache = (): void => {
  routeCache.clear();
};

export const getRoute = async (
  origin: Coordinates,
  destination: Coordinates,
  waypoints: Coordinates[] = [],
  options: RouteOptions = {},
): Promise<RouteResult> => {
  assertCoordinate(origin, "Origin");
  assertCoordinate(destination, "Destination");
  if (waypoints.length > MAX_ROUTE_WAYPOINTS) {
    throw new Error(`A route can include up to ${MAX_ROUTE_WAYPOINTS} stops.`);
  }
  waypoints.forEach((waypoint, index) =>
    assertCoordinate(waypoint, `Waypoint ${index + 1}`),
  );
  if (options.signal?.aborted) {
    throw abortError("Route calculation was cancelled.");
  }

  const cacheKey = routeCacheKey(origin, destination, waypoints);
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  if (cached) {
    routeCache.delete(cacheKey);
  }

  const locations: ValhallaLocation[] = [
    { lat: origin.lat, lon: origin.lon, name: origin.label, type: "break" },
    ...waypoints.map((waypoint) => ({
      lat: waypoint.lat,
      lon: waypoint.lon,
      name: waypoint.label,
      type: "through" as const,
    })),
    {
      lat: destination.lat,
      lon: destination.lon,
      name: destination.label,
      type: "break",
    },
  ];
  const body: ValhallaRouteRequest = {
    locations,
    costing: "auto",
    units: "kilometers",
    directions_options: { units: "kilometers" },
  };

  const controller = new AbortController();
  let timedOut = false;
  const cancelFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ROUTE_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      if (timedOut) {
        throw new Error("Route calculation timed out. Please try again.");
      }
      throw abortError("Route calculation was cancelled.");
    }
    throw new Error(
      "We could not reach the routing service. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", cancelFromCaller);
  }

  let payload: ValhallaRouteResponse;
  try {
    payload = (await response.json()) as ValhallaRouteResponse;
  } catch {
    throw new Error(
      "The routing service returned an unreadable response. Please try again.",
    );
  }

  if (!response.ok || payload.error) {
    const detail = extractError(payload);
    throw new Error(
      `Route calculation failed${detail ? `: ${detail}` : "."} Please choose another location or try again.`,
    );
  }

  const legs = payload.trip?.legs;
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new Error("No drivable route was found between these locations.");
  }
  const shapes = legs
    .map((leg) => (typeof leg.shape === "string" ? leg.shape.trim() : ""))
    .filter((shape): shape is string => shape.length > 0);
  if (shapes.length === 0) {
    throw new Error("The routing service returned no route geometry.");
  }

  const geometry = shapes.flatMap((shape) => decodePolyline(shape));
  if (geometry.length < 2) {
    throw new Error("The routing service returned incomplete route geometry.");
  }

  const distance = isFiniteNumber(payload.trip?.summary?.length)
    ? payload.trip.summary.length
    : legs.reduce(
        (total, leg) =>
          total +
          (isFiniteNumber(leg.summary?.length) ? leg.summary.length : 0),
        0,
      );
  const durationSeconds = isFiniteNumber(payload.trip?.summary?.time)
    ? payload.trip.summary.time
    : legs.reduce(
        (total, leg) =>
          total + (isFiniteNumber(leg.summary?.time) ? leg.summary.time : 0),
        0,
      );

  if (distance <= 0 || durationSeconds <= 0) {
    throw new Error("The routing service could not calculate this route.");
  }

  const result: RouteResult = {
    geometry,
    distanceKm: Math.round(distance * 100) / 100,
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
  };
  routeCache.set(cacheKey, { expiresAt: Date.now() + ROUTE_CACHE_TTL_MS, result });
  return result;
};

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const haversineDistanceKm = (
  first: Coordinates,
  second: Coordinates,
): number => {
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(second.lat - first.lat);
  const longitudeDelta = toRadians(second.lon - first.lon);
  const firstLatitude = toRadians(first.lat);
  const secondLatitude = toRadians(second.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, haversine)));
};

export const routeCompatibility = (
  firstOrigin: Coordinates,
  firstDestination: Coordinates,
  secondOrigin: Coordinates,
  secondDestination: Coordinates,
): number => {
  const maximumAcceptedDetourKm = 40;
  const endpointDistance =
    haversineDistanceKm(firstOrigin, secondOrigin) +
    haversineDistanceKm(firstDestination, secondDestination);
  return Math.max(0, 1 - endpointDistance / maximumAcceptedDetourKm);
};

export default getRoute;
