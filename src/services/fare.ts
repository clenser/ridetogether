export const FARE_PER_KM = 9;
export const FARE_VARIANCE = 10;

export interface FareRange {
  base: number;
  min: number;
  max: number;
}

const hasValidDistance = (distanceKm: unknown): distanceKm is number =>
  typeof distanceKm === "number" && Number.isFinite(distanceKm) && distanceKm > 0;

export const getBaseFare = (distanceKm?: number): number | null =>
  hasValidDistance(distanceKm) ? Math.round(distanceKm * FARE_PER_KM) : null;

export const getFareRange = (distanceKm?: number): FareRange | null => {
  const base = getBaseFare(distanceKm);
  if (base === null) return null;
  return {
    base,
    min: Math.max(0, base - FARE_VARIANCE),
    max: base + FARE_VARIANCE,
  };
};

export const isContributionInRange = (contribution: number, distanceKm?: number): boolean => {
  const range = getFareRange(distanceKm);
  return range !== null
    && Number.isInteger(contribution)
    && contribution >= range.min
    && contribution <= range.max;
};

export const normalizeContributionForDistance = (contribution: number, distanceKm?: number): number => {
  const range = getFareRange(distanceKm);
  if (!range || isContributionInRange(contribution, distanceKm)) return contribution;
  return range.base;
};

export const formatRupees = (value: number): string => {
  if (!Number.isFinite(value)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
};
