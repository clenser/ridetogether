import type { Coordinates } from "../types";

interface PhotonProperties {
  name?: unknown;
  housenumber?: unknown;
  street?: unknown;
  postcode?: unknown;
  city?: unknown;
  county?: unknown;
  state?: unknown;
  country?: unknown;
  countrycode?: unknown;
}

interface PhotonFeature {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: PhotonProperties;
}

interface PhotonResponse {
  features?: unknown;
}

const INDIA_COUNTRY_CODE = "IN";
const PHOTON_BASE_URL = "https://photon.komoot.io";

export class LocationOutsideIndiaError extends Error {
  constructor() {
    super("This location is outside India. Choose a place within India to continue.");
    this.name = "LocationOutsideIndiaError";
  }
}

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const isCoordinate = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === "number" &&
  Number.isFinite(value[0]) &&
  typeof value[1] === "number" &&
  Number.isFinite(value[1]) &&
  value[0] >= -180 &&
  value[0] <= 180 &&
  value[1] >= -90 &&
  value[1] <= 90;

const buildLabel = (properties: PhotonProperties | undefined): string => {
  if (!properties) return "";
  const name = asText(properties.name);
  const houseNumber = asText(properties.housenumber);
  const street = asText(properties.street);
  const city = asText(properties.city);
  const county = asText(properties.county);
  const state = asText(properties.state);
  const country = asText(properties.country);
  const postcode = asText(properties.postcode);
  const streetAddress = [houseNumber, street].filter(Boolean).join(" ");
  const locality = [city || county || state, postcode].filter(Boolean).join(" ");
  const parts =
    name && streetAddress && name !== streetAddress
      ? [name, streetAddress]
      : [streetAddress || name, locality, country];
  return [...new Set(parts.filter(Boolean))].join(", ");
};

const requestPhotonFeatures = async (
  path: string,
  parameters: URLSearchParams,
  unavailableMessage: string,
  signal?: AbortSignal,
): Promise<unknown[]> => {
  if (signal?.aborted) {
    throw new DOMException("The location request was cancelled.", "AbortError");
  }

  let response: Response;
  try {
    response = await fetch(`${PHOTON_BASE_URL}${path}?${parameters}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    throw new Error(unavailableMessage);
  }

  if (!response.ok) {
    throw new Error(`Location service failed (${response.status}). Please try again in a moment.`);
  }

  let payload: PhotonResponse;
  try {
    payload = (await response.json()) as PhotonResponse;
  } catch {
    throw new Error("Location service returned an invalid response. Please try again.");
  }

  if (!Array.isArray(payload.features)) {
    throw new Error("Location service returned an invalid response. Please try again.");
  }
  return payload.features;
};

const getIndianLocations = (
  features: unknown[],
  reverse = false,
): Coordinates[] => {
  const seen = new Set<string>();
  const locations: Coordinates[] = [];
  let resolvableFeatureCount = 0;

  for (const item of features) {
    if (!item || typeof item !== "object") continue;
    const feature = item as PhotonFeature;
    if (!isCoordinate(feature.geometry?.coordinates)) continue;
    const label = buildLabel(feature.properties);
    if (!label) continue;
    resolvableFeatureCount += 1;

    const countryCode = asText(feature.properties?.countrycode).toUpperCase();
    if (countryCode !== INDIA_COUNTRY_CODE) continue;

    const [lon, lat] = feature.geometry.coordinates;
    const displayLabel = reverse ? `Near ${label}` : label;
    const dedupeKey = `${lat.toFixed(6)}:${lon.toFixed(6)}:${displayLabel.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    locations.push({
      lat,
      lon,
      label: displayLabel,
      countryCode: INDIA_COUNTRY_CODE,
    });
  }

  if (locations.length === 0 && resolvableFeatureCount > 0) {
    throw new LocationOutsideIndiaError();
  }
  return locations;
};

export const searchLocations = async (
  query: string,
  signal?: AbortSignal,
): Promise<Coordinates[]> => {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];

  const parameters = new URLSearchParams({
    q: normalizedQuery,
    limit: "15",
    lang: "en",
  });
  const features = await requestPhotonFeatures(
    "/api/",
    parameters,
    "Location search is unavailable. Check your connection and try again.",
    signal,
  );
  return getIndianLocations(features);
};

export const reverseGeocodeLocation = async (
  point: Pick<Coordinates, "lat" | "lon">,
  signal?: AbortSignal,
): Promise<Coordinates> => {
  const parameters = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lon),
    limit: "5",
    lang: "en",
  });
  const features = await requestPhotonFeatures(
    "/reverse",
    parameters,
    "We could not identify that map point. Check your connection and try again.",
    signal,
  );
  const locations = getIndianLocations(features, true);
  const location = locations[0];
  if (!location) {
    throw new Error("No place could be found at this point. Choose another point on the map.");
  }
  return {
    ...location,
    lat: point.lat,
    lon: point.lon,
  };
};

export default searchLocations;
