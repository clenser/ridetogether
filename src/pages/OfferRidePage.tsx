import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CarFront,
  Check,
  Clock3,
  Edit3,
  Gauge,
  LoaderCircle,
  MapPin,
  Plus,
  Route as RouteIcon,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react";
import LocationSearch from "../components/LocationSearch";
import RideMap, { type MapCoordinate, type RideMapSelectionTarget } from "../components/RideMap";
import { useApp } from "../context/AppContext";
import { formatRupees, getFareRange, isContributionInRange } from "../services/fare";
import { reverseGeocodeLocation } from "../services/geocoding";
import { getRoute, MAX_ROUTE_WAYPOINTS } from "../services/routing";
import type { Coordinates, RouteResult, RideInput } from "../types";

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
};

const sameLocation = (first: Coordinates, second: Coordinates) =>
  Math.abs(first.lat - second.lat) < 0.0001 && Math.abs(first.lon - second.lon) < 0.0001;

const offerStyles = `
.rt-offer-page { min-height: 100%; color: #17231c; background: #f7fbf8; }
.rt-offer-page .container { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
.rt-offer-page .page-container { padding: 38px 0 66px; }
.rt-offer-page h1, .rt-offer-page h2, .rt-offer-page h3, .rt-offer-page p { margin-top: 0; }
.rt-offer-page .page-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 25px; }
.rt-offer-page .page-heading h1 { margin: 8px 0 7px; color: #183c25; font-size: clamp(1.8rem, 3vw, 2.55rem); letter-spacing: -.05em; }
.rt-offer-page .page-heading p { margin: 0; color: #6e7e74; font-size: .91rem; }
.rt-offer-page .section-kicker { color: #148642; font-size: .72rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-offer-page .page-heading-icon { width: 54px; height: 54px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 17px; color: #148642; background: #e1f5e7; }
.rt-offer-page .card { border: 1px solid #dbe8de; border-radius: 21px; background: #fff; box-shadow: 0 13px 34px rgba(32,75,45,.07); }
.rt-offer-page .offer-layout { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(340px, .92fr); gap: 20px; align-items: start; }
.rt-offer-page .offer-form-column { display: grid; gap: 15px; }
.rt-offer-page .form-card { padding: 23px; }
.rt-offer-page .form-section-title { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 17px; color: #2c4835; }
.rt-offer-page .form-section-title > svg { flex: 0 0 auto; margin-top: 1px; color: #159447; }
.rt-offer-page .form-section-title h2 { margin: 0; font-size: 1rem; letter-spacing: -.015em; }
.rt-offer-page .form-section-title p { margin: 4px 0 0; color: #7a887f; font-size: .75rem; line-height: 1.4; }
.rt-offer-page .location-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.rt-offer-page .field-group { display: grid; gap: 7px; min-width: 0; }
.rt-offer-page .field-group > label, .rt-offer-page .location-search__label { color: #405448; font-size: .78rem; font-weight: 760; }
.rt-offer-page .location-search { position: relative; }
.rt-offer-page .location-search__label { display: block; margin-bottom: 7px; }
.rt-offer-page .location-search__control { position: relative; }
.rt-offer-page .location-search__input { width: 100%; min-height: 45px; padding: 10px 40px 10px 37px; border: 1px solid #d7e3da; border-radius: 11px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .84rem; transition: border-color .18s ease, box-shadow .18s ease; }
.rt-offer-page .location-search__input:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21,148,71,.11); }
.rt-offer-page .location-search__search-icon { position: absolute; z-index: 1; top: 13px; left: 12px; color: #809087; pointer-events: none; }
.rt-offer-page .location-search__spinner, .rt-offer-page .location-search__selected-icon, .rt-offer-page .location-search__clear { position: absolute; top: 12px; right: 10px; }
.rt-offer-page .location-search__spinner { color: #159447; animation: rt-offer-spin .8s linear infinite; }
.rt-offer-page .location-search__selected-icon { color: #159447; }
.rt-offer-page .location-search__clear { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 7px; color: #78877e; background: transparent; cursor: pointer; }
.rt-offer-page .location-search__clear:hover { color: #b33d3d; background: #fff0f0; }
.rt-offer-page .location-search__dropdown { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; left: 0; overflow: auto; border: 1px solid #d8e5db; border-radius: 13px; background: #fff; box-shadow: 0 16px 30px rgba(24,64,38,.14); }
.rt-offer-page .location-search__option { display: flex; align-items: center; gap: 9px; padding: 11px 12px; color: #405448; font-size: .78rem; cursor: pointer; }
.rt-offer-page .location-search__option:hover, .rt-offer-page .location-search__option.is-active { background: #eff9f2; }
.rt-offer-page .location-search__option-icon { color: #159447; }
.rt-offer-page .location-search__state { display: flex; align-items: center; gap: 8px; padding: 12px; color: #77857c; font-size: .76rem; }
.rt-offer-page .location-search__state--error { color: #ad3838; }
.rt-offer-page .location-search__state button { margin-left: auto; border: 0; color: #148642; background: transparent; font: inherit; font-size: .74rem; font-weight: 750; cursor: pointer; }
.rt-offer-page .map-pick-button { display: inline-flex; align-items: center; gap: 5px; justify-self: start; padding: 0; border: 0; color: #148642; background: transparent; font: inherit; font-size: .72rem; font-weight: 750; cursor: pointer; }
.rt-offer-page .map-pick-button:hover, .rt-offer-page .map-pick-button.is-active { color: #0c5f2d; }
.rt-offer-page .map-pick-button.is-active { text-decoration: underline; text-underline-offset: 3px; }
.rt-offer-page .map-pick-cancel { min-height: 30px; display: inline-flex; align-items: center; padding: 0 9px; border: 0; border-radius: 8px; color: inherit; background: rgba(255,255,255,.88); font: inherit; font-size: .7rem; font-weight: 760; cursor: pointer; }
.rt-offer-page .optional-label { margin-left: 4px; color: #8a978e; font-size: .68rem; font-weight: 500; }
.rt-offer-page .stop-builder { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #edf2ee; }
.rt-offer-page .stop-action-buttons { min-width: 138px; display: grid; justify-items: stretch; gap: 8px; }
.rt-offer-page .stop-action-buttons .map-pick-button { min-height: 34px; justify-content: center; }
.rt-offer-page .stop-add-button { min-height: 45px; white-space: nowrap; }
.rt-offer-page .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid transparent; border-radius: 11px; font: inherit; font-size: .82rem; font-weight: 780; text-decoration: none; cursor: pointer; }
.rt-offer-page .btn-primary { color: #fff; background: #159447; box-shadow: 0 8px 18px rgba(21,148,71,.18); }
.rt-offer-page .btn-primary:hover:not(:disabled) { background: #10813b; }
.rt-offer-page .btn-outline { border-color: #c4ddcb; color: #14763c; background: #f7fcf8; }
.rt-offer-page .btn-outline:hover:not(:disabled) { border-color: #8ec9a0; background: #eef9f1; }
.rt-offer-page .btn-ghost { border-color: #efd1d1; color: #a23d3d; background: #fff8f8; }
.rt-offer-page .btn:disabled { opacity: .52; cursor: not-allowed; box-shadow: none; }
 .rt-offer-page .btn-block { width: 100%; }
 .rt-offer-page .btn-lg { min-height: 50px; font-size: .9rem; }
 .rt-offer-page .spin { animation: rt-offer-spin .8s linear infinite; }
.rt-offer-page .stop-list { display: grid; gap: 8px; margin-top: 14px; }
.rt-offer-page .stop-list-heading { display: flex; justify-content: space-between; color: #4b5f51; font-size: .76rem; }
.rt-offer-page .stop-list-heading span { color: #89958d; font-size: .7rem; }
.rt-offer-page .stop-item { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px 10px; border: 1px solid #dce9df; border-radius: 11px; color: #52655a; background: #f8fbf9; font-size: .76rem; }
.rt-offer-page .stop-item > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-offer-page .stop-number { width: 22px; height: 22px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 7px; color: #14763c; background: #dff4e6; font-size: .68rem; font-weight: 800; }
.rt-offer-page .icon-button { width: 35px; height: 35px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid #d8e4da; border-radius: 10px; color: #65766c; background: #fff; cursor: pointer; }
.rt-offer-page .icon-button:hover { color: #148642; background: #eff9f2; }
.rt-offer-page .danger-icon { margin-left: auto; color: #b44a4a; }
.rt-offer-page .danger-icon:hover { color: #a52f2f; background: #fff0f0; border-color: #f0caca; }
.rt-offer-page .form-grid { display: grid; gap: 13px; margin-top: 2px; }
.rt-offer-page .form-grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rt-offer-page .form-grid-two { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 15px; }
.rt-offer-page input:not([type="checkbox"]), .rt-offer-page select, .rt-offer-page textarea { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid #d7e3da; border-radius: 11px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .83rem; }
.rt-offer-page input:focus, .rt-offer-page select:focus, .rt-offer-page textarea:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21,148,71,.11); }
.rt-offer-page .field-hint { color: #849189; font-size: .69rem; line-height: 1.4; }
.rt-offer-page .field-error { color: #a73737; font-size: .69rem; line-height: 1.4; }
.rt-offer-page .input-with-icon { position: relative; }
.rt-offer-page .input-with-icon svg { position: absolute; z-index: 1; top: 13px; left: 11px; color: #159447; }
.rt-offer-page .input-with-icon input { padding-left: 35px !important; }
.rt-offer-page .inline-empty { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; padding: 11px 12px; border-radius: 11px; color: #7b5a1c; background: #fff8e5; font-size: .76rem; line-height: 1.45; }
.rt-offer-page .inline-empty a { color: #137d3d; font-weight: 750; }
.rt-offer-page .form-message { display: flex; align-items: flex-start; gap: 7px; margin: 0; padding: 10px 11px; border-radius: 10px; font-size: .75rem; line-height: 1.45; }
.rt-offer-page .error-message { color: #a73737; background: #fff0f0; }
.rt-offer-page .success-message { color: #126e39; background: #eaf8ee; }
.rt-offer-page .form-message svg { flex: 0 0 auto; margin-top: 1px; }
.rt-offer-page .offer-map-column { display: grid; gap: 15px; position: sticky; top: 20px; }
.rt-offer-page .map-panel { min-width: 0; overflow: hidden; }
.rt-offer-page .map-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 20px 20px 15px; }
.rt-offer-page .map-panel-header h2 { margin: 6px 0 0; color: #1d3b27; font-size: 1.05rem; }
.rt-offer-page .route-summary { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px 10px; color: #6f7f75; font-size: .7rem; }
.rt-offer-page .route-summary span { display: inline-flex; align-items: center; gap: 5px; }
.rt-offer-page .route-summary svg { color: #159447; }
.rt-offer-page .map-wrap { position: relative; min-height: 395px; overflow: hidden; background: #eaf3ec; }
.rt-offer-page .map-wrap-tall { min-height: 395px; }
.rt-offer-page .ride-map { width: 100%; height: 395px; min-height: 395px; }
.rt-offer-page .map-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; color: #45604f; background: rgba(247,252,248,.72); font-size: .8rem; font-weight: 700; pointer-events: none; }
.rt-offer-page .map-overlay-empty { flex-direction: column; color: #6c8173; }
.rt-offer-page .map-overlay-empty svg { color: #159447; }
.rt-offer-page .map-pick-banner { position: absolute; z-index: 4; top: 12px; left: 12px; right: 58px; display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid #b9ddc5; border-radius: 12px; color: #24543a; background: rgba(255,255,255,.95); box-shadow: 0 8px 24px rgba(20,55,32,.16); font-size: .74rem; font-weight: 720; }
.rt-offer-page .map-pick-banner > svg { flex: 0 0 auto; color: #159447; }
.rt-offer-page .map-pick-banner > span { min-width: 0; flex: 1; }
.rt-offer-page .map-error { display: flex; align-items: flex-start; gap: 8px; padding: 12px 15px; color: #a13b3b; background: #fff3f3; font-size: .74rem; line-height: 1.45; }
.rt-offer-page .map-error svg { flex: 0 0 auto; margin-top: 1px; }
.rt-offer-page .route-checklist { padding: 19px 20px; }
.rt-offer-page .route-checklist .form-section-title { margin-bottom: 13px; }
.rt-offer-page .check-list { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.rt-offer-page .check-list li { display: flex; align-items: center; gap: 8px; color: #87938b; font-size: .75rem; }
.rt-offer-page .check-list li > span { width: 21px; height: 21px; display: grid; place-items: center; border-radius: 7px; color: #84938a; background: #eef2ef; font-size: .66rem; font-weight: 800; }
.rt-offer-page .check-list li.done { color: #2c5638; }
.rt-offer-page .check-list li.done > span { color: #fff; background: #159447; }
.rt-offer-page .route-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; padding: 11px; border-radius: 11px; color: #63756a; background: #f1f8f3; font-size: .72rem; line-height: 1.45; }
.rt-offer-page .route-note svg { flex: 0 0 auto; color: #159447; }
[data-theme="dark"] .rt-offer-page .field-error { color: #ffb0b0; }
@keyframes rt-offer-spin { to { transform: rotate(360deg); } }
@media (max-width: 980px) {
  .rt-offer-page .offer-layout { grid-template-columns: 1fr; }
  .rt-offer-page .offer-map-column { position: static; }
}
@media (max-width: 620px) {
  .rt-offer-page .container { width: min(100% - 28px, 1180px); }
  .rt-offer-page .page-container { padding: 24px 0 45px; }
  .rt-offer-page .page-heading { align-items: flex-start; }
  .rt-offer-page .page-heading-icon { width: 44px; height: 44px; border-radius: 13px; }
  .rt-offer-page .form-card { padding: 18px; }
  .rt-offer-page .location-fields, .rt-offer-page .form-grid-three, .rt-offer-page .form-grid-two { grid-template-columns: 1fr; }
  .rt-offer-page .stop-builder { grid-template-columns: 1fr; align-items: stretch; }
  .rt-offer-page .stop-action-buttons { min-width: 0; }
  .rt-offer-page .stop-add-button { width: 100%; }
  .rt-offer-page .map-panel-header { display: block; }
  .rt-offer-page .route-summary { justify-content: flex-start; margin-top: 9px; }
  .rt-offer-page .map-wrap, .rt-offer-page .map-wrap-tall, .rt-offer-page .ride-map { min-height: 300px; height: 300px; }
}
`;

export default function OfferRidePage() {
  const { rideId: editingRideId } = useParams<{ rideId: string }>();
  const { loading, activeUserId, vehicles, rides, createRide, updateRide } = useApp();
  const navigate = useNavigate();
   const requestedEditingRide = rides.find((ride) => ride.id === editingRideId);
   const editingRide = requestedEditingRide?.driverId === activeUserId ? requestedEditingRide : undefined;
   const isEditing = Boolean(editingRideId);
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [destination, setDestination] = useState<Coordinates | null>(null);
  const [stopInput, setStopInput] = useState<Coordinates | null>(null);
  const [stops, setStops] = useState<Coordinates[]>([]);
  const [date, setDate] = useState(localDateKey(new Date()));
  const [time, setTime] = useState("");
  const [availableSeats, setAvailableSeats] = useState(1);
  const [contribution, setContribution] = useState(0);
  const [vehicleId, setVehicleId] = useState("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [stopError, setStopError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [pickTarget, setPickTarget] = useState<RideMapSelectionTarget | null>(null);
  const mapPanelRef = useRef<HTMLElement>(null);
  const pickRequest = useRef(0);
  const pickController = useRef<AbortController | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState(false);

  const ownVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.userId === activeUserId),
    [activeUserId, vehicles],
  );
  const selectedVehicle = ownVehicles.find((vehicle) => vehicle.id === vehicleId);
  const fareRange = route ? getFareRange(route.distanceKm) : null;
  const contributionError = route && fareRange && !isContributionInRange(contribution, route.distanceKm)
    ? `Choose a contribution between ${formatRupees(fareRange.min)} and ${formatRupees(fareRange.max)}.`
    : "";

  useEffect(() => {
    if (!editingRide) return;
    setOrigin(editingRide.origin);
    setDestination(editingRide.destination);
    setStops([...editingRide.waypoints]);
    setDate(editingRide.departureDate);
    setTime(editingRide.departureTime);
    setAvailableSeats(editingRide.availableSeats);
    setContribution(editingRide.contribution);
    setVehicleId(editingRide.vehicleId);
    setPublishError("");
   }, [editingRide?.id, editingRide?.driverId]);

  useEffect(() => {
    if (ownVehicles.length === 0) {
      if (vehicleId) setVehicleId("");
      return;
    }
    if (!ownVehicles.some((vehicle) => vehicle.id === vehicleId)) {
      setVehicleId(ownVehicles.find((vehicle) => vehicle.isDefault)?.id ?? ownVehicles[0].id);
    }
  }, [ownVehicles, vehicleId]);

   useEffect(() => {
     if (!selectedVehicle) return;
     const minimumSeats = isEditing ? 0 : 1;
     setAvailableSeats((current) => {
       const normalized = Number.isFinite(current) ? current : minimumSeats;
       return Math.min(Math.max(minimumSeats, normalized), selectedVehicle.seats);
     });
   }, [isEditing, selectedVehicle]);

  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      setRouteError("");
      setRouteLoading(false);
      setContribution(0);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setRoute(null);
    setRouteError("");
    setRouteLoading(true);
    setContribution(0);
    getRoute(origin, destination, stops, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setRoute(result);
        setContribution(getFareRange(result.distanceKm)?.base ?? 0);
      })
      .catch((error: unknown) => {
        if (active && !isAbortError(error)) {
          setRouteError(errorMessage(error, "We could not calculate that route. Please try again."));
          setContribution(0);
        }
      })
      .finally(() => {
        if (active) setRouteLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [destination, origin, stops]);

  const cancelPendingLocation = () => {
    pickRequest.current += 1;
    pickController.current?.abort();
    pickController.current = null;
    setLocationLoading(false);
    setPickTarget(null);
  };

  const updateOrigin = (value: Coordinates | null) => {
    cancelPendingLocation();
    setOrigin(value);
    setRoute(null);
    setStopError("");
    setLocationError("");
    setPublishError("");
  };

  const updateDestination = (value: Coordinates | null) => {
    cancelPendingLocation();
    setDestination(value);
    setRoute(null);
    setStopError("");
    setLocationError("");
    setPublishError("");
  };

  const updateStopInput = (value: Coordinates | null) => {
    cancelPendingLocation();
    setStopInput(value);
    setStopError("");
    setLocationError("");
    setPublishError("");
  };

  const selectMapPoint = async (target: RideMapSelectionTarget, point: MapCoordinate) => {
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
      else if (target === "destination") setDestination(location);
      else {
        if ((origin && sameLocation(origin, location)) || (destination && sameLocation(destination, location))) {
          setStopError("Choose a stop different from your start or destination.");
          setPickTarget(null);
          return;
        }
        if (stops.some((stop) => sameLocation(stop, location))) {
          setStopError("That stop is already on your route.");
          setPickTarget(null);
          return;
        }
        setStopInput(location);
      }
      setRoute(null);
      setStopError("");
      setLocationError("");
      setPickTarget(null);
      setPublishError("");
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

  const startMapPick = (target: RideMapSelectionTarget) => {
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

  const addStop = () => {
    if (!stopInput) return;
    cancelPendingLocation();
    if (stops.length >= MAX_ROUTE_WAYPOINTS) {
      setStopError(`You can add up to ${MAX_ROUTE_WAYPOINTS} stops.`);
      return;
    }
    if ((origin && sameLocation(origin, stopInput)) || (destination && sameLocation(destination, stopInput))) {
      setStopError("Choose a stop different from your start or destination.");
      return;
    }
    if (stops.some((stop) => sameLocation(stop, stopInput))) {
      setStopError("That stop is already on your route.");
      return;
    }
    setStops((current) => [...current, stopInput]);
    setStopInput(null);
    setStopError("");
    setPublishError("");
    setRoute(null);
  };

  const removeStop = (stop: Coordinates) => {
    cancelPendingLocation();
    setStops((current) => current.filter((item) => !sameLocation(item, stop)));
    setStopError("");
    setPublishError("");
    setRoute(null);
  };

  useEffect(() => () => {
    pickRequest.current += 1;
    pickController.current?.abort();
  }, []);

  const handlePublish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPublishError("");
    setPublished(false);
    if (!origin || !destination) {
      setPublishError("Choose both a starting point and a destination.");
      return;
    }
    if (isEditing && !editingRide) {
      setPublishError("This ride is no longer available for editing.");
      return;
    }
    if (!route || routeLoading) {
      setPublishError("A valid route is required before publishing this ride.");
      return;
    }
    if (!selectedVehicle) {
      setPublishError("Choose one of your vehicles before publishing.");
      return;
    }
    if (!date || !time) {
      setPublishError("Choose a departure date and time.");
      return;
    }
    const departureTimestamp = new Date(`${date}T${time}`).getTime();
    if (!Number.isFinite(departureTimestamp) || departureTimestamp <= Date.now()) {
      setPublishError("Choose a departure time in the future.");
      return;
    }
     const minimumAvailableSeats = isEditing ? 0 : 1;
     if (
       !Number.isInteger(availableSeats)
       || availableSeats < minimumAvailableSeats
       || availableSeats > selectedVehicle.seats
     ) {
       setPublishError(`Choose between ${minimumAvailableSeats} and ${selectedVehicle.seats} available seats.`);
       return;
     }
    if (!fareRange || !isContributionInRange(contribution, route.distanceKm)) {
      setPublishError(
        fareRange
          ? `Choose a contribution between ${formatRupees(fareRange.min)} and ${formatRupees(fareRange.max)} for this route.`
          : "A real route distance is required before publishing.",
      );
      return;
    }

    const input: RideInput = {
      vehicleId: selectedVehicle.id,
      origin,
      destination,
      waypoints: stops,
      departureDate: date,
      departureTime: time,
       availableSeats,
       totalSeats: isEditing && editingRide
         ? Math.min(selectedVehicle.seats, Math.max(editingRide.totalSeats, availableSeats))
         : selectedVehicle.seats,
      contribution,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
    };

    setPublishing(true);
    try {
      if (isEditing && editingRide) {
        await updateRide(editingRide.id, input);
        setPublished(true);
        navigate(`/rides/${editingRide.id}`);
      } else {
        await createRide(input);
        setPublished(true);
        navigate("/rides");
      }
    } catch (error: unknown) {
      setPublishError(errorMessage(error, "We could not publish your ride. Please try again."));
      setPublishing(false);
    }
  };

   if (isEditing && !loading && !editingRide) {
     return (
       <main className="rt-offer-page page offer-ride-page">
         <style>{offerStyles}</style>
         <div className="container page-container">
           <section className="card form-card">
             <div className="form-section-title"><AlertCircle size={19} /><div><h2>Ride unavailable</h2><p>This ride is no longer available, or it belongs to another driver.</p></div></div>
             <Link className="btn btn-outline" to="/rides"><ArrowRight size={17} /> Back to my rides</Link>
           </section>
         </div>
       </main>
     );
   }

   return (
     <main className="rt-offer-page page offer-ride-page">
      <style>{offerStyles}</style>
      <div className="container page-container">
        <div className="page-heading">
          <div>
            <span className="section-kicker">{isEditing ? "Update your journey" : "Share the journey"}</span>
            <h1>{isEditing ? "Edit your ride" : "Offer a ride"}</h1>
            <p>{isEditing ? "Keep your route, timing, and seat details current for riders." : "Turn your planned trip into a more connected, affordable journey."}</p>
          </div>
          <div className="page-heading-icon">{isEditing ? <Edit3 size={25} /> : <CarFront size={25} />}</div>
        </div>

        <form className="offer-layout" onSubmit={handlePublish}>
          <div className="offer-form-column">
            <section className="card form-card">
              <div className="form-section-title"><MapPin size={19} /><div><h2>Route details</h2><p>Add the places you will pass through.</p></div></div>
              <div className="location-fields">
                <div className="field-group">
                  <label htmlFor="offer-from">From</label>
                  <LocationSearch
                    id="offer-from"
                    label="Starting point"
                    placeholder="Where will you leave from in India?"
                    value={origin}
                    onChange={updateOrigin}
                  />
                  <button
                    className={`map-pick-button${pickTarget === "origin" ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={pickTarget === "origin"}
                    onClick={() => startMapPick("origin")}
                  >
                    <MapPin size={15} /> {pickTarget === "origin" ? "Cancel map pick" : "Pick From on map"}
                  </button>
                </div>
                <div className="field-group">
                  <label htmlFor="offer-to">To</label>
                  <LocationSearch
                    id="offer-to"
                    label="Destination"
                    placeholder="Where are you headed in India?"
                    value={destination}
                    onChange={updateDestination}
                  />
                  <button
                    className={`map-pick-button${pickTarget === "destination" ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={pickTarget === "destination"}
                    onClick={() => startMapPick("destination")}
                  >
                    <MapPin size={15} /> {pickTarget === "destination" ? "Cancel map pick" : "Pick To on map"}
                  </button>
                </div>
              </div>
              <div className="stop-builder">
                <div className="field-group">
                  <label htmlFor="offer-stop">Add a stop <span className="optional-label">Optional</span></label>
                  <LocationSearch
                    id="offer-stop"
                    label="Route stop"
                    placeholder="Search a stop along the way in India"
                    value={stopInput}
                    onChange={updateStopInput}
                  />
                </div>
                <div className="stop-action-buttons">
                  <button
                    className={`map-pick-button${pickTarget === "waypoint" ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={pickTarget === "waypoint"}
                    onClick={() => startMapPick("waypoint")}
                  >
                    <MapPin size={15} /> {pickTarget === "waypoint" ? "Cancel stop pick" : "Pick stop on map"}
                  </button>
                  <button className="btn btn-outline stop-add-button" type="button" onClick={addStop} disabled={!stopInput || stops.length >= MAX_ROUTE_WAYPOINTS}>
                    <Plus size={17} /> Add stop
                  </button>
                </div>
              </div>
              {locationLoading && <p className="form-message notice-message" role="status"><LoaderCircle className="spin" size={16} />Finding that place in India…</p>}
              {locationError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{locationError}</p>}
              {stopError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{stopError}</p>}
              {stops.length >= MAX_ROUTE_WAYPOINTS && <p className="field-hint">The route supports up to {MAX_ROUTE_WAYPOINTS} stops.</p>}
               {stops.length > 0 && (
                <div className="stop-list" aria-label="Stops on this ride">
                  <div className="stop-list-heading"><strong>Stops</strong><span>{stops.length} added</span></div>
                  {stops.map((stop, index) => (
                    <div className="stop-item" key={`${stop.lat}-${stop.lon}-${index}`}>
                      <span className="stop-number">{index + 1}</span>
                      <span>{stop.label}</span>
                      <button className="icon-button danger-icon" type="button" onClick={() => removeStop(stop)} aria-label={`Remove ${stop.label}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card form-card">
              <div className="form-section-title"><CalendarDays size={19} /><div><h2>Trip logistics</h2><p>Set the departure and how many seats you can share.</p></div></div>
              <div className="form-grid form-grid-three">
                <div className="field-group">
                  <label htmlFor="offer-date">Date</label>
                  <input id="offer-date" type="date" min={localDateKey(new Date())} value={date} onChange={(event) => { setDate(event.target.value); setPublishError(""); }} required />
                </div>
                <div className="field-group">
                  <label htmlFor="offer-time">Time</label>
                  <input id="offer-time" type="time" value={time} onChange={(event) => { setTime(event.target.value); setPublishError(""); }} required />
                </div>
                <div className="field-group">
                  <label htmlFor="offer-seats">Seats available</label>
                   <input id="offer-seats" type="number" min={isEditing ? 0 : 1} max={selectedVehicle?.seats ?? 1} value={availableSeats} onChange={(event) => { setAvailableSeats(Number(event.target.value)); setPublishError(""); }} required />
                </div>
              </div>
              <div className="form-grid form-grid-two">
                <div className="field-group">
                  <label htmlFor="offer-vehicle">Vehicle</label>
                  <select id="offer-vehicle" value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setPublishError(""); }} required>
                    <option value="" disabled>Select a vehicle</option>
                    {ownVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.make} {vehicle.model}</option>)}
                  </select>
                  {selectedVehicle && <span className="field-hint">{selectedVehicle.seats} total seats · {selectedVehicle.color} {selectedVehicle.plate}</span>}
                </div>
                <div className="field-group">
                  <label htmlFor="offer-contribution">Contribution per seat</label>
                  <div className="input-with-icon">
                    <WalletCards size={17} />
                    <input
                      id="offer-contribution"
                      type="number"
                      min={fareRange?.min ?? 0}
                      max={fareRange?.max}
                      step="1"
                      value={contribution}
                      disabled={!route || routeLoading}
                      aria-invalid={Boolean(contributionError)}
                      aria-describedby={contributionError ? "offer-contribution-hint offer-contribution-error" : "offer-contribution-hint"}
                      onChange={(event) => { setContribution(Number(event.target.value)); setPublishError(""); }}
                      placeholder="0"
                    />
                  </div>
                  <span id="offer-contribution-hint" className="field-hint">
                    {fareRange
                      ? `Base ${formatRupees(fareRange.base)} for ${route?.distanceKm.toFixed(1) ?? "0"} km · choose ${formatRupees(fareRange.min)}–${formatRupees(fareRange.max)}.`
                      : "Calculate a real route before setting the contribution."}
                  </span>
                  {contributionError ? <span id="offer-contribution-error" className="field-error" role="alert">{contributionError}</span> : null}
                </div>
              </div>
              {!loading && ownVehicles.length === 0 && (
                <div className="inline-empty"><CarFront size={19} /><span>Add a vehicle in <Link to="/vehicles">Vehicles</Link> before offering a ride.</span></div>
              )}
            </section>

            {publishError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{publishError}</p>}
            {published && <p className="form-message success-message" role="status"><Check size={16} />Your ride was published successfully.</p>}
             <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={publishing || routeLoading || !route || ownVehicles.length === 0 || Boolean(contributionError)}>
             {publishing ? <LoaderCircle className="spin" size={19} /> : <ArrowRight size={19} />}
               {publishing ? "Saving your ride…" : isEditing ? "Save changes" : "Publish ride"}
            </button>
          </div>

          <aside className="offer-map-column">
            <section ref={mapPanelRef} className="card map-panel offer-map-panel">
              <div className="map-panel-header">
                <div><span className="section-kicker">Live preview</span><h2>Your route</h2></div>
                {route && <div className="route-summary"><span><RouteIcon size={16} /> {route.distanceKm.toFixed(1)} km</span><span><Clock3 size={16} /> {formatDuration(route.durationMinutes)}</span></div>}
              </div>
              <div className="map-wrap map-wrap-tall">
                <RideMap
                  origin={origin ?? undefined}
                  destination={destination ?? undefined}
                  waypoints={stops}
                  route={route?.geometry}
                  selectionTarget={pickTarget}
                  onPickLocation={(point) => {
                    if (pickTarget) void selectMapPoint(pickTarget, point);
                  }}
                />
                {pickTarget && (
                  <div className="map-pick-banner" role="status">
                    {locationLoading ? <LoaderCircle className="spin" size={18} /> : <MapPin size={18} />}
                    <span>
                      {locationLoading
                        ? "Identifying that point…"
                        : `Click the map to choose ${pickTarget === "origin" ? "From" : pickTarget === "destination" ? "To" : "a route stop"}.`}
                    </span>
                    <button className="map-pick-cancel" type="button" onClick={cancelPendingLocation}>Cancel</button>
                  </div>
                )}
                {routeLoading && <div className="map-overlay"><LoaderCircle className="spin" size={23} /> Calculating your real route…</div>}
                {!routeLoading && !pickTarget && !origin && !destination && <div className="map-overlay map-overlay-empty"><MapPin size={23} />Choose From and To to see your route</div>}
              </div>
              {routeError && <div className="map-error" role="alert"><AlertCircle size={17} /><span>{routeError} Your markers remain visible; publishing stays disabled until routing works.</span></div>}
            </section>
            <div className="card route-checklist">
              <div className="form-section-title"><Gauge size={19} /><h2>Before you publish</h2></div>
              <ul className="check-list">
                <li className={origin && destination ? "done" : ""}><span>{origin && destination ? <Check size={14} /> : "1"}</span>Set both endpoints</li>
                <li className={route ? "done" : ""}><span>{route ? <Check size={14} /> : "2"}</span>Verify the real route</li>
                <li className={selectedVehicle ? "done" : ""}><span>{selectedVehicle ? <Check size={14} /> : "3"}</span>Select your vehicle</li>
                <li className={date && time ? "done" : ""}><span>{date && time ? <Check size={14} /> : "4"}</span>Add departure details</li>
              </ul>
              <div className="route-note"><Users size={17} /><span>Riders can request seats. You decide whether to confirm each request.</span></div>
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}
