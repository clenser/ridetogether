import { haversineDistanceKm, type LonLat } from "./geometry";

export interface SimulationFrame {
  lat: number;
  lon: number;
  heading: number;
  speedKph: number;
  distanceAlongRouteKm: number;
  totalRouteKm: number;
  progress: number;
}

export interface SimulationConfig {
  routeGeometry: readonly LonLat[];
  /** Base speed in km/h at 1x multiplier. */
  baseSpeedKph: number;
  /** Speed multiplier (0.5, 1, 2, 5, 10). */
  speedMultiplier: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * Bearing from point A to point B, in degrees clockwise from north.
 */
export const bearingDegrees = (a: LonLat, b: LonLat): number => {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLon = toRadians(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

/**
 * Cumulative distances along a polyline, in kilometres.
 */
export const cumulativeDistances = (geometry: readonly LonLat[]): number[] => {
  const distances: number[] = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    const prev = geometry[i - 1];
    const curr = geometry[i];
    distances.push(distances[i - 1] + haversineDistanceKm({ lat: prev[1], lon: prev[0] }, { lat: curr[1], lon: curr[0] }));
  }
  return distances;
};

/**
 * Interpolates a position along the route at a given distance.
 */
export const interpolateAtDistance = (
  geometry: readonly LonLat[],
  cumulativeKm: number[],
  targetKm: number,
): { lat: number; lon: number; heading: number } | null => {
  if (geometry.length < 2) return null;

  const totalKm = cumulativeKm[cumulativeKm.length - 1];
  if (totalKm <= 0) return null;

  const clamped = Math.max(0, Math.min(targetKm, totalKm));

  for (let i = 1; i < geometry.length; i += 1) {
    if (clamped <= cumulativeKm[i]) {
      const segmentLength = cumulativeKm[i] - cumulativeKm[i - 1];
      const t = segmentLength === 0 ? 0 : (clamped - cumulativeKm[i - 1]) / segmentLength;
      const start = geometry[i - 1];
      const end = geometry[i];
      const lat = start[1] + t * (end[1] - start[1]);
      const lon = start[0] + t * (end[0] - start[0]);
      const heading = bearingDegrees(start, end);
      return { lat, lon, heading };
    }
  }

  const last = geometry[geometry.length - 1];
  const prev = geometry[geometry.length - 2];
  return { lat: last[1], lon: last[0], heading: bearingDegrees(prev, last) };
};

/**
 * Creates a simulation frame for a given elapsed time.
 */
export const createSimulationFrame = (
  config: SimulationConfig,
  cumulativeKm: number[],
  elapsedSeconds: number,
): SimulationFrame | null => {
  const { routeGeometry, baseSpeedKph, speedMultiplier } = config;
  if (routeGeometry.length < 2) return null;

  const totalKm = cumulativeKm[cumulativeKm.length - 1];
  if (totalKm <= 0) return null;

  const speedKph = baseSpeedKph * speedMultiplier;
  const speedKmPerSecond = speedKph / 3600;
  const distanceAlongRouteKm = elapsedSeconds * speedKmPerSecond;
  const progress = Math.min(1, distanceAlongRouteKm / totalKm);

  const position = interpolateAtDistance(routeGeometry, cumulativeKm, distanceAlongRouteKm);
  if (!position) return null;

  return {
    lat: position.lat,
    lon: position.lon,
    heading: position.heading,
    speedKph,
    distanceAlongRouteKm: Math.min(distanceAlongRouteKm, totalKm),
    totalRouteKm: totalKm,
    progress,
  };
};

/**
 * Validates route geometry for simulation.
 */
export const validateRouteGeometry = (geometry: unknown): LonLat[] | null => {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const valid: LonLat[] = [];
  for (const entry of geometry) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const lon = Number(entry[0]);
    const lat = Number(entry[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    valid.push([lon, lat]);
  }
  return valid;
};
