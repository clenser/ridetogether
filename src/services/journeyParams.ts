import type { Coordinates } from "../types";

/**
 * Handing a journey from the home page planner to the real Find / Offer forms.
 *
 * The home page collects a route so the member does not have to type it twice,
 * but the routing, geocoding and validation all belong to the real forms. So the
 * planner does not calculate a route: it passes the chosen origin, destination
 * and journey details through the URL, and Find Ride / Offer Ride hydrate their
 * own draft from it and do the real work as usual.
 *
 * Everything here is deliberately defensive. These values arrive from a URL, so
 * they are untrusted input that happens to be shaped like our own data - a
 * hand-edited query string must not be able to put `NaN` into a lat/lon or a
 * negative seat count into a form.
 */

export interface JourneyParams {
  origin: Coordinates | null;
  destination: Coordinates | null;
  date?: string;
  time?: string;
  seats?: number;
  contribution?: number;
}

const readCoordinate = (raw: string | null): Coordinates | null => {
  if (!raw) return null;
  const [latRaw, lonRaw, ...labelParts] = raw.split("|");
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const label = labelParts.join("|").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!label) return null;
  return { lat, lon, label };
};

const readNumber = (raw: string | null, min: number, max: number): number | undefined => {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
};

/** `YYYY-MM-DD`, and a date that actually exists - `2025-02-31` is not one. */
const readDate = (raw: string | null): string | undefined => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Guards against JS rolling 2025-02-31 forward into March.
  if (localDateKey(parsed) !== raw) return undefined;
  return raw;
};

const readTime = (raw: string | null): string | undefined => {
  if (!raw || !/^\d{2}:\d{2}$/.test(raw)) return undefined;
  const [hours, minutes] = raw.split(":").map(Number);
  if (hours > 23 || minutes > 59) return undefined;
  return raw;
};

export const MAX_HANDOFF_SEATS = 8;

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Serialise a route for the URL.
 *
 * Coordinates are packed into one parameter with `|` separators rather than
 * three, because a label is allowed to contain `|` but a latitude is not - so
 * the label is rejoined from the tail and cannot be mis-split.
 */
export function encodeJourneyParams(params: JourneyParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.origin) {
    search.set("from", `${params.origin.lat}|${params.origin.lon}|${params.origin.label}`);
  }
  if (params.destination) {
    search.set("to", `${params.destination.lat}|${params.destination.lon}|${params.destination.label}`);
  }
  if (params.date) search.set("date", params.date);
  if (params.time) search.set("time", params.time);
  if (typeof params.seats === "number") search.set("seats", String(params.seats));
  if (typeof params.contribution === "number") search.set("contribution", String(params.contribution));
  return search;
}

/** Parse a handoff. Returns `null` when there is nothing usable to restore. */
export function readJourneyParams(search: URLSearchParams): JourneyParams | null {
  const origin = readCoordinate(search.get("from"));
  const destination = readCoordinate(search.get("to"));
  const date = readDate(search.get("date"));
  const time = readTime(search.get("time"));
  const seats = readNumber(search.get("seats"), 1, MAX_HANDOFF_SEATS);
  const contribution = readNumber(search.get("contribution"), 0, 100_000);

  if (!origin && !destination && !date && !time && seats === undefined && contribution === undefined) {
    return null;
  }
  return { origin, destination, date, time, seats, contribution };
}
