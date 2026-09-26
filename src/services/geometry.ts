/**
 * Spherical geometry helpers used by ride matching, pickup negotiation and the
 * live-location distance checks.
 *
 * Everything here works on the host's real road corridor - the `[lon, lat]`
 * polyline Valhalla returned and that `rides.route_geometry` stores - rather
 * than on the straight line between two pins. A straight line through a city
 * crosses rivers and compound walls, so it cannot answer "is this passenger
 * along the driver's road".
 *
 * The projection used throughout is an equirectangular one: longitude is scaled
 * by cos(latitude) so distances stay close to true while the point stays in
 * plane coordinates. It is accurate to well under 1% at the scale of a single
 * city ride, which is far finer than the walking tolerances used here.
 */
const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export type LonLat = [number, number];

/** A bare position. `Coordinates` adds the human label the UI shows. */
export interface LatLon {
  lat: number;
  lon: number;
}

const longitudeScale = (latitude: number): number =>
  Math.max(0.01, Math.cos(toRadians(latitude)));

/** Great-circle distance between two points, in kilometres. */
export const haversineDistanceKm = (
  first: LatLon,
  second: LatLon,
): number => {
  const latitudeDelta = toRadians(second.lat - first.lat);
  const longitudeDelta = toRadians(second.lon - first.lon);
  const firstLatitude = toRadians(first.lat);
  const secondLatitude = toRadians(second.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
};

/** Shortest distance from a point to a single line segment, in kilometres. */
const distanceToSegmentKm = (point: LatLon, start: LonLat, end: LonLat): number => {
  const scale = longitudeScale(point.lat);
  const px = point.lon * scale;
  const py = point.lat;
  const ax = start[0] * scale;
  const ay = start[1];
  const bx = end[0] * scale;
  const by = end[1];

  const dx = bx - ax;
  const dy = by - ay;
  const squaredLength = dx * dx + dy * dy;
  // A degenerate segment still has a well-defined closest point.
  if (squaredLength === 0) {
    return haversineDistanceKm(point, { lat: start[1], lon: start[0] });
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / squaredLength));
  return haversineDistanceKm(point, {
    lat: ay + t * dy,
    lon: (ax + t * dx) / scale,
  });
};

/** Length of a polyline, in kilometres. */
export const polylineLengthKm = (geometry: readonly LonLat[]): number => {
  let total = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    total += haversineDistanceKm(
      { lat: geometry[index - 1][1], lon: geometry[index - 1][0] },
      { lat: geometry[index][1], lon: geometry[index][0] },
    );
  }
  return total;
};

export interface PolylineProjection {
  /** Shortest distance from the query point to the line, in kilometres. */
  distanceKm: number;
  /**
   * Distance travelled along the line to reach that closest point, in
   * kilometres. This is what makes "the passenger is 4 km along your route"
   * a real statement about the road order, not just a straight-line guess.
   */
  travelledKm: number;
  /** The same position expressed as 0-1 along the line. */
  fraction: number;
  /** The closest point on the line. */
  point: LatLon;
}

/**
 * Projects a point onto a polyline and returns how far off the road it is plus
 * how far along the road it sits.
 *
 * Used to answer both halves of "will this ride work for me": `distanceKm` is
 * the walk to the road, and `travelledKm` compared between pickup and drop-off
 * is the road distance the passenger actually shares with the driver.
 */
export const projectOntoPolyline = (
  point: LatLon,
  geometry: readonly LonLat[],
): PolylineProjection | null => {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;

  let bestDistanceKm = Number.POSITIVE_INFINITY;
  let bestTravelledKm = 0;
  let bestPoint: LonLat = geometry[0];
  let travelled = 0;

  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const distanceKm = distanceToSegmentKm(point, start, end);
    if (distanceKm < bestDistanceKm) {
      // Recompute the along-line offset only for the winning segment, so the
      // common case (a point near a long straight) stays cheap.
      const scale = longitudeScale(point.lat);
      const dx = (end[0] - start[0]) * scale;
      const dy = end[1] - start[1];
      const squaredLength = dx * dx + dy * dy;
      const t = squaredLength === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.lon * scale - start[0] * scale) * dx +
                (point.lat - start[1]) * dy) /
                squaredLength,
            ),
          );
      const segmentLength = haversineDistanceKm(
        { lat: start[1], lon: start[0] },
        { lat: end[1], lon: end[0] },
      );
      bestDistanceKm = distanceKm;
      bestTravelledKm = travelled + t * segmentLength;
      bestPoint = [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])];
    }
    travelled += haversineDistanceKm(
      { lat: start[1], lon: start[0] },
      { lat: end[1], lon: end[0] },
    );
  }

  const totalKm = travelled;
  return {
    distanceKm: bestDistanceKm,
    travelledKm: bestTravelledKm,
    fraction: totalKm > 0 ? bestTravelledKm / totalKm : 0,
    point: { lat: bestPoint[1], lon: bestPoint[0] },
  };
};

/** The point `fraction` of the way along a polyline, as coordinates. */
export const pointAlongPolyline = (
  geometry: readonly LonLat[],
  fraction: number,
): LatLon | null => {
  if (geometry.length < 2) return null;
  const clamped = Math.max(0, Math.min(1, fraction));
  const target = polylineLengthKm(geometry) * clamped;
  let travelled = 0;

  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const segmentLength = haversineDistanceKm(
      { lat: start[1], lon: start[0] },
      { lat: end[1], lon: end[0] },
    );
    if (travelled + segmentLength >= target) {
      const t = segmentLength === 0 ? 0 : (target - travelled) / segmentLength;
      return {
        lat: start[1] + t * (end[1] - start[1]),
        lon: start[0] + t * (end[0] - start[0]),
      };
    }
    travelled += segmentLength;
  }

  const last = geometry[geometry.length - 1];
  return { lat: last[1], lon: last[0] };
};

/** Bounding box of a polyline, used to reject far-away points cheaply. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const boundingBoxOf = (geometry: readonly LonLat[]): BoundingBox | null => {
  if (geometry.length === 0) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of geometry) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
};

/**
 * True when a point is so far outside the corridor's bounding box that it cannot
 * possibly be near it. Lets a long search reject most of its candidates without
 * running the full projection over every segment of every ride.
 */
export const outsideBox = (point: LatLon, box: BoundingBox, marginKm: number): boolean => {
  const latMargin = marginKm / 111.32;
  const lonMargin = marginKm / (111.32 * longitudeScale(point.lat));
  return (
    point.lat < box.minLat - latMargin
    || point.lat > box.maxLat + latMargin
    || point.lon < box.minLon - lonMargin
    || point.lon > box.maxLon + lonMargin
  );
};
