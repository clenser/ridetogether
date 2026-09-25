import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Crosshair,
  LoaderCircle,
  MapPinned,
  Navigation,
  Route as RouteIcon,
  Search,
  Users,
} from "lucide-react";
import LocationSearch from "../components/LocationSearch";
import RideCard from "../components/RideCard";
import RideMap, { type MapCoordinate, type RideMapSelectionTarget } from "../components/RideMap";
import { useApp } from "../context/AppContext";
import { reverseGeocodeLocation } from "../services/geocoding";
import { getRoute, haversineDistanceKm } from "../services/routing";
import type { Coordinates, Ride, RouteResult } from "../types";

const ENDPOINT_PROXIMITY_KM = 50;
const ROUTE_PROXIMITY_KM = 75;
const ROUTE_DIRECTION_EPSILON = 0.03;
const TIME_TOLERANCE_MINUTES = 180;
const MAX_CANDIDATE_RIDES = 8;

interface SearchMatch {
  ride: Ride;
  route: RouteResult;
}

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
};

const rideDepartureTimestamp = (ride: Ride) =>
  new Date(ride.departureDate.includes("T") ? ride.departureDate : `${ride.departureDate}T${ride.departureTime || "00:00"}`).getTime();

interface RouteProjection {
  distanceKm: number;
  progress: number;
}

const projectPointToRoute = (
  point: Coordinates,
  geometry: [number, number][],
): RouteProjection => {
  if (geometry.length === 0) {
    return { distanceKm: Number.POSITIVE_INFINITY, progress: 0 };
  }
  if (geometry.length === 1) {
    return {
      distanceKm: haversineDistanceKm(point, { lat: geometry[0][1], lon: geometry[0][0], label: "" }),
      progress: 0,
    };
  }

  const referenceLatitude = (point.lat * Math.PI) / 180;
  const longitudeScale = Math.cos(referenceLatitude);
  const pointX = point.lon * longitudeScale;
  const pointY = point.lat;
  let shortest = Number.POSITIVE_INFINITY;
  let shortestProgress = 0;

  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const startX = start[0] * longitudeScale;
    const endX = end[0] * longitudeScale;
    const startY = start[1];
    const endY = end[1];
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const projection = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
    const closestX = startX + projection * deltaX;
    const closestY = startY + projection * deltaY;
    const distance = Math.sqrt((pointX - closestX) ** 2 + (pointY - closestY) ** 2) * 111.32;
    if (distance < shortest) {
      shortest = distance;
      shortestProgress = (index - 1 + projection) / (geometry.length - 1);
    }
  }

  return { distanceKm: shortest, progress: shortestProgress };
};

const distanceToRouteKm = (point: Coordinates, geometry: [number, number][]) =>
  projectPointToRoute(point, geometry).distanceKm;

const circularTimeDifference = (first: number, second: number) => {
  const difference = Math.abs(first - second);
  return Math.min(difference, 24 * 60 - difference);
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isAbortError = (error: unknown) =>
  (error instanceof Error && error.name === "AbortError")
  || (typeof DOMException !== "undefined"
    && error instanceof DOMException
    && error.name === "AbortError");

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
};

const findStyles = `
.rt-find-page { min-height: 100%; color: #17231c; background: #f7fbf8; }
.rt-find-page .container { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
.rt-find-page .page-container { padding: 38px 0 66px; }
.rt-find-page h1, .rt-find-page h2, .rt-find-page h3, .rt-find-page p { margin-top: 0; }
.rt-find-page .page-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 25px; }
.rt-find-page .page-heading h1 { margin: 8px 0 7px; color: #183c25; font-size: clamp(1.8rem, 3vw, 2.55rem); letter-spacing: -.05em; }
.rt-find-page .page-heading p { margin: 0; color: #6e7e74; font-size: .91rem; }
.rt-find-page .section-kicker { color: #148642; font-size: .72rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-find-page .page-heading-icon { width: 54px; height: 54px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 17px; color: #148642; background: #e1f5e7; }
.rt-find-page .card { border: 1px solid #dbe8de; border-radius: 21px; background: #fff; box-shadow: 0 13px 34px rgba(32,75,45,.07); }
.rt-find-page .find-layout { display: grid; grid-template-columns: minmax(340px, .82fr) minmax(0, 1.18fr); gap: 20px; align-items: stretch; }
.rt-find-page .search-form { padding: 24px; }
.rt-find-page .form-section-title { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; color: #2c4835; }
.rt-find-page .form-section-title > svg { color: #159447; }
.rt-find-page .form-section-title h2 { margin: 0; font-size: 1rem; letter-spacing: -.015em; }
.rt-find-page .form-section-title p { margin: 3px 0 0; color: #7a887f; font-size: .75rem; font-weight: 400; }
.rt-find-page .location-fields { display: grid; gap: 14px; }
.rt-find-page .field-group { display: grid; gap: 7px; min-width: 0; }
.rt-find-page .field-group > label, .rt-find-page .location-search__label { color: #405448; font-size: .78rem; font-weight: 760; }
.rt-find-page .location-search { position: relative; }
.rt-find-page .location-search__label { display: block; margin-bottom: 7px; }
.rt-find-page .location-search__control { position: relative; }
.rt-find-page .location-search__input { width: 100%; min-height: 45px; padding: 10px 40px 10px 37px; border: 1px solid #d7e3da; border-radius: 11px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .84rem; transition: border-color .18s ease, box-shadow .18s ease; }
.rt-find-page .location-search__input:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21,148,71,.11); }
.rt-find-page .location-search__search-icon { position: absolute; z-index: 1; top: 13px; left: 12px; color: #809087; pointer-events: none; }
.rt-find-page .location-search__spinner, .rt-find-page .location-search__selected-icon, .rt-find-page .location-search__clear { position: absolute; top: 12px; right: 10px; }
.rt-find-page .location-search__spinner { color: #159447; animation: rt-find-spin .8s linear infinite; }
.rt-find-page .location-search__selected-icon { color: #159447; }
.rt-find-page .location-search__clear { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 7px; color: #78877e; background: transparent; cursor: pointer; }
.rt-find-page .location-search__clear:hover { color: #b33d3d; background: #fff0f0; }
.rt-find-page .location-search__dropdown { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; left: 0; overflow: auto; border: 1px solid #d8e5db; border-radius: 13px; background: #fff; box-shadow: 0 16px 30px rgba(24,64,38,.14); }
.rt-find-page .location-search__option { display: flex; align-items: center; gap: 9px; padding: 11px 12px; color: #405448; font-size: .78rem; cursor: pointer; }
.rt-find-page .location-search__option:hover, .rt-find-page .location-search__option.is-active { background: #eff9f2; }
.rt-find-page .location-search__option-icon { color: #159447; }
.rt-find-page .location-search__state { display: flex; align-items: center; gap: 8px; padding: 12px; color: #77857c; font-size: .76rem; }
.rt-find-page .location-search__state--error { color: #ad3838; }
.rt-find-page .location-search__state button { margin-left: auto; border: 0; color: #148642; background: transparent; font: inherit; font-size: .74rem; font-weight: 750; cursor: pointer; }
.rt-find-page .location-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.rt-find-page .location-button, .rt-find-page .map-pick-button { display: inline-flex; align-items: center; gap: 5px; justify-self: start; padding: 0; border: 0; color: #148642; background: transparent; font: inherit; font-size: .72rem; font-weight: 750; cursor: pointer; }
.rt-find-page .location-button:hover, .rt-find-page .map-pick-button:hover, .rt-find-page .map-pick-button.is-active { color: #0c5f2d; }
.rt-find-page .map-pick-button.is-active { color: #0b6e32; text-decoration: underline; text-underline-offset: 3px; }
.rt-find-page .map-pick-cancel { min-height: 30px; display: inline-flex; align-items: center; padding: 0 9px; border: 0; border-radius: 8px; color: inherit; background: rgba(255,255,255,.88); font: inherit; font-size: .7rem; font-weight: 760; cursor: pointer; }
.rt-find-page .map-pick-banner { position: absolute; z-index: 4; top: 12px; left: 12px; right: 58px; display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid #b9ddc5; border-radius: 12px; color: #24543a; background: rgba(255,255,255,.95); box-shadow: 0 8px 24px rgba(20,55,32,.16); font-size: .74rem; font-weight: 720; }
.rt-find-page .map-pick-banner > svg { flex: 0 0 auto; color: #159447; }
.rt-find-page .map-pick-banner > span { min-width: 0; flex: 1; }
.rt-find-page .spin { animation: rt-find-spin .8s linear infinite; }
 .rt-find-page .empty-icon { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; color: #148642; background: #e1f5e7; }
 .rt-find-page .form-divider { height: 1px; margin: 22px 0; background: #edf2ee; }
.rt-find-page .form-grid { display: grid; gap: 13px; }
.rt-find-page .form-grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rt-find-page .form-grid-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rt-find-page input:not([type="checkbox"]), .rt-find-page select, .rt-find-page textarea { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid #d7e3da; border-radius: 11px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .83rem; }
.rt-find-page input:focus, .rt-find-page select:focus, .rt-find-page textarea:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21,148,71,.11); }
.rt-find-page .field-hint { color: #849189; font-size: .69rem; line-height: 1.35; }
.rt-find-page .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid transparent; border-radius: 11px; font: inherit; font-size: .82rem; font-weight: 780; text-decoration: none; cursor: pointer; }
.rt-find-page .btn-primary { color: #fff; background: #159447; box-shadow: 0 8px 18px rgba(21,148,71,.18); }
.rt-find-page .btn-primary:hover:not(:disabled) { background: #10813b; }
.rt-find-page .btn:disabled { opacity: .52; cursor: not-allowed; box-shadow: none; }
.rt-find-page .btn-block { width: 100%; margin-top: 22px; }
.rt-find-page .map-panel { min-width: 0; overflow: hidden; }
.rt-find-page .map-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 21px 22px 16px; }
.rt-find-page .map-panel-header h2 { margin: 6px 0 0; color: #1d3b27; font-size: 1.08rem; letter-spacing: -.02em; }
.rt-find-page .route-summary { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 11px; color: #6f7f75; font-size: .71rem; }
.rt-find-page .route-summary span { display: inline-flex; align-items: center; gap: 5px; }
.rt-find-page .route-summary svg { color: #159447; }
.rt-find-page .map-wrap { position: relative; min-height: 420px; height: 100%; overflow: hidden; background: #eaf3ec; }
.rt-find-page .ride-map { width: 100%; height: 100%; min-height: 420px; }
.rt-find-page .map-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; color: #45604f; background: rgba(247,252,248,.72); font-size: .8rem; font-weight: 700; pointer-events: none; }
.rt-find-page .map-overlay-empty { flex-direction: column; color: #6c8173; }
.rt-find-page .map-overlay-empty svg { color: #159447; }
.rt-find-page .map-error { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; color: #a13b3b; background: #fff3f3; font-size: .75rem; line-height: 1.45; }
.rt-find-page .map-error svg { flex: 0 0 auto; margin-top: 1px; }
.rt-find-page .form-message { display: flex; align-items: flex-start; gap: 7px; margin: 12px 0 0; padding: 10px 11px; border-radius: 10px; font-size: .75rem; line-height: 1.45; }
.rt-find-page .error-message { color: #a73737; background: #fff0f0; }
.rt-find-page .success-message { color: #126e39; background: #eaf8ee; }
.rt-find-page .notice-message { color: #7b611e; background: #fff8e5; }
.rt-find-page .form-message svg { flex: 0 0 auto; margin-top: 1px; }
.rt-find-page .results-section { margin-top: 48px; }
.rt-find-page .results-section .section-heading { margin-bottom: 17px; }
.rt-find-page .results-section h2 { margin: 6px 0 0; color: #1d3b27; font-size: 1.35rem; letter-spacing: -.03em; }
.rt-find-page .results-caption { color: #7b897f; font-size: .75rem; }
.rt-find-page .results-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rt-find-page .result-card-wrap { min-width: 0; }
.rt-find-page .result-card-wrap .ride-card { height: calc(100% - 67px); }
.rt-find-page .result-booking-bar { display: flex; align-items: center; gap: 7px; min-height: 67px; padding: 10px; border: 1px solid #dbe8de; border-top: 0; border-radius: 0 0 16px 16px; background: #fff; box-shadow: 0 10px 24px rgba(32,75,45,.05); }
.rt-find-page .result-booking-bar label { margin-right: auto; color: #67776d; font-size: .69rem; font-weight: 700; }
.rt-find-page .result-booking-bar select { width: 48px; min-height: 36px; padding: 5px 7px; }
.rt-find-page .result-booking-bar .btn { min-height: 36px; padding: 0 10px; font-size: .72rem; }
.rt-find-page .empty-state { min-height: 245px; display: grid; place-items: center; padding: 28px; text-align: center; }
.rt-find-page .empty-state h3 { margin: 15px 0 6px; color: #27432f; }
.rt-find-page .empty-state p { max-width: 390px; margin: 0; color: #75837a; font-size: .82rem; line-height: 1.5; }
.rt-find-page .ride-card-skeleton { min-height: 400px; background: linear-gradient(135deg, #eef7f0, #f9fcfa); }
.rt-find-page .info-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 48px; padding: 18px; border: 1px solid #dce9df; border-radius: 17px; background: #eef8f1; }
.rt-find-page .info-strip > div { display: flex; align-items: flex-start; gap: 9px; color: #148642; font-size: .71rem; line-height: 1.45; }
.rt-find-page .info-strip > div + div { padding-left: 15px; border-left: 1px solid #d3e5d7; }
.rt-find-page .info-strip span { color: #718077; }
.rt-find-page .info-strip strong { color: #2e4b37; }
@keyframes rt-find-spin { to { transform: rotate(360deg); } }
@media (max-width: 980px) {
  .rt-find-page .find-layout { grid-template-columns: 1fr; }
  .rt-find-page .map-wrap, .rt-find-page .ride-map { min-height: 380px; }
  .rt-find-page .results-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .rt-find-page .container { width: min(100% - 28px, 1180px); }
  .rt-find-page .page-container { padding: 24px 0 45px; }
  .rt-find-page .page-heading { align-items: flex-start; }
  .rt-find-page .page-heading-icon { width: 44px; height: 44px; border-radius: 13px; }
  .rt-find-page .search-form { padding: 18px; }
  .rt-find-page .form-grid-three, .rt-find-page .form-grid-two, .rt-find-page .results-grid { grid-template-columns: 1fr; }
  .rt-find-page .map-panel-header { display: block; padding: 18px; }
  .rt-find-page .route-summary { justify-content: flex-start; margin-top: 10px; }
  .rt-find-page .map-wrap, .rt-find-page .ride-map { min-height: 310px; }
  .rt-find-page .results-section { margin-top: 36px; }
  .rt-find-page .result-booking-bar { flex-wrap: wrap; }
  .rt-find-page .result-booking-bar label { width: 100%; }
  .rt-find-page .result-booking-bar select { flex: 1; }
  .rt-find-page .result-booking-bar .btn { flex: 1; }
  .rt-find-page .info-strip { grid-template-columns: 1fr; }
  .rt-find-page .info-strip > div + div { padding: 12px 0 0; border-top: 1px solid #d3e5d7; border-left: 0; }
}
`;

export default function FindRidePage() {
  const { loading, activeUserId, users, vehicles, rides, bookings, requestBooking, searchRides } = useApp();
   const [origin, setOrigin] = useState<Coordinates | null>(null);
   const [destination, setDestination] = useState<Coordinates | null>(null);
   const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [seats, setSeats] = useState(1);
  const [searchRoute, setSearchRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [pickTarget, setPickTarget] = useState<RideMapSelectionTarget | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
   const [bookingRideId, setBookingRideId] = useState("");
   const [bookingSeatsByRide, setBookingSeatsByRide] = useState<Record<string, number>>({});
  const [bookingError, setBookingError] = useState("");
   const [bookingSuccess, setBookingSuccess] = useState("");
  const mapPanelRef = useRef<HTMLElement>(null);
  const pickRequest = useRef(0);
  const pickController = useRef<AbortController | null>(null);
   const routeRequest = useRef(0);
   const routeController = useRef<AbortController | null>(null);
   const searchRequest = useRef(0);
   const searchController = useRef<AbortController | null>(null);
   const dateManuallyChanged = useRef(false);
   const today = useMemo(() => localDateKey(new Date()), []);
   const suggestedDate = useMemo(() => {
     const dates = rides
       .filter((ride) => ride.status === "active" && ride.driverId !== activeUserId && rideDepartureTimestamp(ride) > Date.now())
       .map((ride) => rideDepartureTimestamp(ride))
       .filter((timestamp) => Number.isFinite(timestamp))
       .map((timestamp) => localDateKey(new Date(timestamp)))
       .filter(Boolean)
       .sort();
     return dates[0] ?? today;
   }, [activeUserId, rides, today]);

   useEffect(() => {
     if (!dateManuallyChanged.current) setDate(suggestedDate);
   }, [suggestedDate]);

   useEffect(() => {
     const requestId = routeRequest.current + 1;
     const controller = new AbortController();
     routeRequest.current = requestId;
     routeController.current?.abort();
     routeController.current = controller;
     if (!origin || !destination) {
      setSearchRoute(null);
      setRouteError("");
      setRouteLoading(false);
      return;
    }

    setSearchRoute(null);
    setRouteError("");
    setRouteLoading(true);
    setResults([]);
    setSearchNotice("");

     getRoute(origin, destination, undefined, { signal: controller.signal })
       .then((result) => {
        if (routeRequest.current === requestId) {
          setSearchRoute(result);
        }
      })
       .catch((error: unknown) => {
         if (routeRequest.current === requestId && !isAbortError(error)) {
           setRouteError(errorMessage(error, "We could not calculate that route. Please try again."));
         }
       })
      .finally(() => {
        if (routeRequest.current === requestId) {
          setRouteLoading(false);
        }
      });

     return () => {
       if (routeRequest.current === requestId) {
         routeRequest.current += 1;
         controller.abort();
       }
       if (routeController.current === controller) routeController.current = null;
     };
  }, [destination, origin]);

   const clearResults = () => {
     searchRequest.current += 1;
     searchController.current?.abort();
     searchController.current = null;
     setSearchLoading(false);
    setResults([]);
    setSearchError("");
    setSearchNotice("");
    setBookingError("");
    setBookingSuccess("");
  };

   useEffect(() => {
     searchRequest.current += 1;
     searchController.current?.abort();
     searchController.current = null;
     setSearchLoading(false);
    setResults([]);
    setSearchError("");
    setSearchNotice("");
    setBookingError("");
    setBookingSuccess("");
  }, [activeUserId]);

  useEffect(() => {
    const selectedTime = timeToMinutes(time);
    setResults((current) =>
      current.flatMap((match) => {
        const currentRide = rides.find((item) => item.id === match.ride.id);
        if (!currentRide || currentRide.status !== "active" || currentRide.driverId === activeUserId) return [];
        if (currentRide.departureDate !== date || currentRide.availableSeats < seats) return [];
        const departure = rideDepartureTimestamp(currentRide);
        if (!Number.isFinite(departure) || departure <= Date.now()) return [];
        const rideTime = timeToMinutes(currentRide.departureTime);
        if (Number.isFinite(selectedTime) && Number.isFinite(rideTime) && circularTimeDifference(selectedTime, rideTime) > TIME_TOLERANCE_MINUTES) return [];
        return [{ ...match, ride: currentRide }];
      }),
    );
  }, [activeUserId, date, rides, seats, time]);

  const cancelPendingLocation = () => {
    pickRequest.current += 1;
    pickController.current?.abort();
    pickController.current = null;
    setLocationLoading(false);
    setPickTarget(null);
  };

  const handleOriginChange = (value: Coordinates | null) => {
    cancelPendingLocation();
    setOrigin(value);
    setSearchRoute(null);
    setRouteError("");
    clearResults();
    setLocationError("");
  };

  const handleDestinationChange = (value: Coordinates | null) => {
    cancelPendingLocation();
    setDestination(value);
    setSearchRoute(null);
    setRouteError("");
    clearResults();
    setLocationError("");
  };

  const selectMapPoint = async (
    target: Exclude<RideMapSelectionTarget, "waypoint">,
    point: MapCoordinate,
  ) => {
    pickRequest.current += 1;
    const requestId = pickRequest.current;
    pickController.current?.abort();
    const controller = new AbortController();
    pickController.current = controller;
    setLocationLoading(true);
    setLocationError("");

    try {
      const location = await reverseGeocodeLocation(point, controller.signal);
      if (pickRequest.current !== requestId) return;
      if (target === "origin") setOrigin(location);
      else setDestination(location);
      setSearchRoute(null);
      setRouteError("");
      setPickTarget(null);
      setLocationError("");
      clearResults();
    } catch (error: unknown) {
      if (pickRequest.current === requestId && !isAbortError(error)) {
        setLocationError(errorMessage(error, "We could not identify that map point."));
      }
    } finally {
      if (pickRequest.current === requestId) {
        setLocationLoading(false);
        pickController.current = null;
      }
    }
  };

  const startMapPick = (target: Exclude<RideMapSelectionTarget, "waypoint">) => {
    if (pickTarget === target) {
      cancelPendingLocation();
      return;
    }
    cancelPendingLocation();
    setPickTarget(target);
    setLocationError("");
    if (window.innerWidth <= 980) {
      window.requestAnimationFrame(() => mapPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Location services are not available in this browser.");
      return;
    }
    cancelPendingLocation();
    pickRequest.current += 1;
    const requestId = pickRequest.current;
    setLocationLoading(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (pickRequest.current !== requestId) return;
        void selectMapPoint("origin", {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (error) => {
        if (pickRequest.current !== requestId) return;
        setLocationLoading(false);
        setLocationError(error.message || "We could not access your current location.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  useEffect(() => () => {
    pickRequest.current += 1;
    pickController.current?.abort();
  }, []);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBookingError("");
    setBookingSuccess("");
    if (!origin || !destination) {
      setSearchError("Choose both a starting point and a destination.");
      return;
    }
    if (!searchRoute) {
      setSearchError("The route is not ready yet. Wait for the map route or try again.");
      return;
    }

     const requestId = searchRequest.current + 1;
     searchRequest.current = requestId;
     searchController.current?.abort();
     const controller = new AbortController();
     searchController.current = controller;
     setSearchLoading(true);
    setSearchError("");
    setSearchNotice("");
    const selectedTime = timeToMinutes(time);

    try {
      // The date, seat and self-exclusion filters run in Postgres so only
      // relevant candidates cross the network. Time tolerance, endpoint
      // proximity and route compatibility stay client-side because they need
      // the caller's exact origin and destination.
      const serverCandidates = await searchRides({ origin, destination, date, time, seats });
      if (searchRequest.current !== requestId) return;

      const matchingCandidates = serverCandidates.filter((ride) => {
        if (ride.status !== "active" || ride.driverId === activeUserId) return false;
        if (ride.availableSeats < seats) return false;
        const departure = rideDepartureTimestamp(ride);
        if (!Number.isFinite(departure) || departure <= Date.now()) return false;
        const rideTime = timeToMinutes(ride.departureTime);
        if (
          Number.isFinite(selectedTime)
          && Number.isFinite(rideTime)
          && circularTimeDifference(selectedTime, rideTime) > TIME_TOLERANCE_MINUTES
        ) {
          return false;
        }
        return (
          haversineDistanceKm(origin, ride.origin) <= ENDPOINT_PROXIMITY_KM
          && haversineDistanceKm(destination, ride.destination) <= ENDPOINT_PROXIMITY_KM
        );
      });
      const candidates = matchingCandidates
        .sort((first, second) =>
          haversineDistanceKm(origin, first.origin) + haversineDistanceKm(destination, first.destination)
          - haversineDistanceKm(origin, second.origin) - haversineDistanceKm(destination, second.destination),
        )
        .slice(0, MAX_CANDIDATE_RIDES);

      const routeErrors: string[] = [];
      const checked = await Promise.all(
        candidates.map(async (ride) => {
          try {
            const route = await getRoute(ride.origin, ride.destination, ride.waypoints, { signal: controller.signal });
            const originProjection = projectPointToRoute(origin, route.geometry);
            const destinationProjection = projectPointToRoute(destination, route.geometry);
            const directionCompatible =
              destinationProjection.progress - originProjection.progress
              >= ROUTE_DIRECTION_EPSILON;
            return originProjection.distanceKm <= ROUTE_PROXIMITY_KM
              && destinationProjection.distanceKm <= ROUTE_PROXIMITY_KM
              && directionCompatible
              ? { ride, route }
              : null;
          } catch (error: unknown) {
            if (isAbortError(error)) throw error;
            routeErrors.push(errorMessage(error, "The route service could not check this ride."));
            return null;
          }
        }),
      );
      if (searchRequest.current !== requestId) return;

        const matched = checked.filter((match): match is SearchMatch => match !== null);
        const checkedRoutes = candidates.length - matched.length - routeErrors.length;
        const omittedRoutes = matchingCandidates.length - candidates.length;
        const notices: string[] = [];
        if (omittedRoutes > 0) {
          notices.push(`Showing the ${candidates.length} nearest of ${matchingCandidates.length} matching rides.`);
        }
        if (checkedRoutes > 0) {
          notices.push(`${checkedRoutes} nearby ${checkedRoutes === 1 ? "ride was" : "rides were"} excluded after route compatibility checks.`);
        }
        if (notices.length > 0) setSearchNotice(notices.join(" "));
        if (routeErrors.length > 0) {
          setSearchError(
            `${routeErrors.length} nearby ${routeErrors.length === 1 ? "ride could" : "rides could"} not be checked because the route service failed. ${routeErrors[0]}`,
          );
        }
        setResults(matched.sort((first, second) => {
         const firstDistance = haversineDistanceKm(origin, first.ride.origin) + haversineDistanceKm(destination, first.ride.destination);
         const secondDistance = haversineDistanceKm(origin, second.ride.origin) + haversineDistanceKm(destination, second.ride.destination);
         return firstDistance - secondDistance;
       }));
        if (matched.length === 0 && routeErrors.length === 0) {
         setSearchError("No compatible rides matched those details. Try a nearby time or fewer seats.");
       }
      } catch (error: unknown) {
       if (searchRequest.current === requestId && !isAbortError(error)) {
         setSearchError(errorMessage(error, "We could not check those rides right now."));
       }
     } finally {
       if (searchController.current === controller) searchController.current = null;
       if (searchRequest.current === requestId) {
         setSearchLoading(false);
       }
     }
  };

   const handleBooking = async (rideId: string, availableSeats: number) => {
     const selectedSeats = bookingSeatsByRide[rideId] ?? 1;
     const seatsToRequest = Math.min(selectedSeats, availableSeats);
     if (!Number.isInteger(seatsToRequest) || seatsToRequest < 1) {
      setBookingError("Choose at least one seat.");
      return;
    }
    setBookingRideId(rideId);
    setBookingError("");
    setBookingSuccess("");
    try {
      await requestBooking(rideId, seatsToRequest);
       setBookingSuccess(`Your request for ${seatsToRequest} ${seatsToRequest === 1 ? "seat" : "seats"} was sent to the driver.`);
       setBookingSeatsByRide((current) => ({ ...current, [rideId]: 1 }));
    } catch (error: unknown) {
      setBookingError(errorMessage(error, "We could not send your booking request."));
    } finally {
      setBookingRideId("");
    }
  };

   return (
    <main className="rt-find-page page find-ride-page">
      <style>{findStyles}</style>
      <div className="container page-container">
        <div className="page-heading">
          <div>
            <span className="section-kicker">Find your way</span>
            <h1>Find a ride that fits</h1>
            <p>Search real community journeys and request a seat with confidence.</p>
          </div>
          <div className="page-heading-icon"><Navigation size={25} /></div>
        </div>

        <div className="find-layout">
          <form className="card search-form" onSubmit={handleSearch}>
            <div className="form-section-title"><MapPinned size={19} /><h2>Your journey</h2></div>
            <div className="location-fields">
              <div className="field-group">
                <label htmlFor="ride-from">From</label>
                <LocationSearch
                  id="ride-from"
                  label="Starting point"
                  placeholder="Search a starting location in India"
                  value={origin}
                  onChange={handleOriginChange}
                />
                <div className="location-actions">
                  <button className="location-button" type="button" onClick={useCurrentLocation} disabled={locationLoading}>
                    <Crosshair size={15} /> Use my location
                  </button>
                  <button
                    className={`map-pick-button${pickTarget === "origin" ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={pickTarget === "origin"}
                    onClick={() => startMapPick("origin")}
                  >
                    <MapPinned size={15} /> {pickTarget === "origin" ? "Cancel map pick" : "Pick on map"}
                  </button>
                </div>
              </div>
              <div className="field-group">
                <label htmlFor="ride-to">To</label>
                <LocationSearch
                  id="ride-to"
                  label="Destination"
                  placeholder="Search a destination in India"
                  value={destination}
                  onChange={handleDestinationChange}
                />
                <button
                  className={`map-pick-button${pickTarget === "destination" ? " is-active" : ""}`}
                  type="button"
                  aria-pressed={pickTarget === "destination"}
                  onClick={() => startMapPick("destination")}
                >
                  <MapPinned size={15} /> {pickTarget === "destination" ? "Cancel map pick" : "Pick on map"}
                </button>
              </div>
            </div>
            {locationLoading && <p className="form-message notice-message" role="status"><LoaderCircle className="spin" size={16} />Finding that place in India…</p>}
            {locationError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{locationError}</p>}

            <div className="form-divider" />
            <div className="form-section-title"><CalendarDays size={19} /><h2>When and how many?</h2></div>
            <div className="form-grid form-grid-three">
              <div className="field-group">
                <label htmlFor="ride-date">Date</label>
                 <input id="ride-date" type="date" min={today} value={date} onChange={(event) => { dateManuallyChanged.current = true; setDate(event.target.value); clearResults(); }} required />
              </div>
              <div className="field-group">
                <label htmlFor="ride-time">Time</label>
                <input id="ride-time" type="time" value={time} onChange={(event) => { setTime(event.target.value); clearResults(); }} />
                <span className="field-hint">Optional · ± 3 hours</span>
              </div>
              <div className="field-group">
                <label htmlFor="ride-seats">Seats</label>
                <select id="ride-seats" value={seats} onChange={(event) => { setSeats(Number(event.target.value)); clearResults(); }}>
                  {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} {value === 1 ? "seat" : "seats"}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={routeLoading || !searchRoute || searchLoading}>
              {searchLoading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
              {searchLoading ? "Checking compatible rides…" : "Search rides"}
            </button>
            {searchError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{searchError}</p>}
          </form>

          <section ref={mapPanelRef} className="card map-panel" aria-label="Journey map">
            <div className="map-panel-header">
              <div>
                <span className="section-kicker">Route preview</span>
                <h2>Your journey on the map</h2>
              </div>
              {searchRoute && (
                <div className="route-summary">
                  <span><RouteIcon size={16} /> {searchRoute.distanceKm.toFixed(1)} km</span>
                  <span><Clock3 size={16} /> {formatDuration(searchRoute.durationMinutes)}</span>
                </div>
              )}
            </div>
            <div className="map-wrap">
              <RideMap
                origin={origin ?? undefined}
                destination={destination ?? undefined}
                waypoints={[]}
                route={searchRoute?.geometry}
                selectionTarget={pickTarget}
                onPickLocation={(point) => {
                  if (pickTarget === "origin" || pickTarget === "destination") {
                    void selectMapPoint(pickTarget, point);
                  }
                }}
              />
              {pickTarget && (
                <div className="map-pick-banner" role="status">
                  {locationLoading ? <LoaderCircle className="spin" size={18} /> : <MapPinned size={18} />}
                  <span>{locationLoading ? "Identifying that point…" : `Click the map to choose ${pickTarget === "origin" ? "From" : "To"}.`}</span>
                  <button className="map-pick-cancel" type="button" onClick={cancelPendingLocation}>Cancel</button>
                </div>
              )}
              {routeLoading && <div className="map-overlay"><LoaderCircle className="spin" size={23} /> Calculating your real route…</div>}
              {!routeLoading && !pickTarget && !origin && !destination && <div className="map-overlay map-overlay-empty"><MapPinned size={23} />Choose From and To to see the route</div>}
            </div>
            {routeError && <div className="map-error" role="alert"><AlertCircle size={17} /><span>{routeError} The map and your selected markers are still available.</span></div>}
          </section>
        </div>

        <section className="results-section" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <span className="section-kicker">Real matches</span>
              <h2>{results.length > 0 ? `${results.length} compatible ${results.length === 1 ? "ride" : "rides"}` : "Available rides"}</h2>
            </div>
            {results.length > 0 && searchRoute && <span className="results-caption">Sorted by pickup closeness</span>}
          </div>
          {searchNotice && <p className="form-message notice-message"><AlertCircle size={16} />{searchNotice}</p>}
          {bookingSuccess && <p className="form-message success-message" role="status"><Check size={16} />{bookingSuccess}</p>}
          {bookingError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{bookingError}</p>}

          {loading ? (
            <div className="ride-grid"><div className="card ride-card-skeleton" /><div className="card ride-card-skeleton" /><div className="card ride-card-skeleton" /></div>
          ) : results.length > 0 ? (
            <div className="ride-grid results-grid">
              {results.map(({ ride }) => {
                const driver = users.find((user) => user.id === ride.driverId);
                const vehicle = vehicles.find((item) => item.id === ride.vehicleId);
                const existingBooking = bookings.find(
                  (booking) =>
                    booking.rideId === ride.id &&
                    booking.riderId === activeUserId &&
                    (booking.status === "pending" || booking.status === "confirmed"),
                );
                return (
                  <div className="result-card-wrap" key={ride.id}>
                    <RideCard ride={ride} driver={driver} vehicle={vehicle} currentUserId={activeUserId} />
                    <div className="result-booking-bar">
                      <label htmlFor={`booking-seats-${ride.id}`}>Seats to request</label>
                      <select
                        id={`booking-seats-${ride.id}`}
                         value={Math.min(bookingSeatsByRide[ride.id] ?? 1, Math.max(1, ride.availableSeats))}
                         onChange={(event) => setBookingSeatsByRide((current) => ({ ...current, [ride.id]: Number(event.target.value) }))}
                        disabled={ride.availableSeats < 1 || Boolean(existingBooking) || Boolean(bookingRideId)}
                      >
                        {Array.from({ length: Math.max(1, ride.availableSeats) }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={ride.availableSeats < 1 || Boolean(bookingRideId) || Boolean(existingBooking)}
                        onClick={() => handleBooking(ride.id, ride.availableSeats)}
                      >
                        {bookingRideId === ride.id ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                        {existingBooking ? (existingBooking.status === "pending" ? "Request pending" : "Seat confirmed") : "Request seat"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card empty-state">
              <div className="empty-icon"><Search size={28} /></div>
              <h3>{origin && destination ? "No matching rides yet" : "Start with your route"}</h3>
              <p>{origin && destination ? "Try another date, a nearby time or fewer seats." : "Choose your starting point and destination to see compatible community rides."}</p>
            </div>
          )}
        </section>

        <div className="info-strip">
          <div><ShieldIcon /><span><strong>Real route matching</strong><br />We verify that your pickup and drop-off sit along each ride.</span></div>
          <div><Users /><span><strong>Book with context</strong><br />Drivers review every request before confirming your seat.</span></div>
          <div><CalendarDays /><span><strong>Travel on your terms</strong><br />Cancellation and seat availability stay in your control.</span></div>
        </div>
      </div>
    </main>
  );
}

function ShieldIcon() {
  return <Check size={21} />;
}
