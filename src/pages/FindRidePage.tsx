import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Crosshair,
  Expand,
  LoaderCircle,
  MapPin,
  MapPinned,
  Navigation,
  Route as RouteIcon,
  Search,
  Shrink,
  Users,
} from "lucide-react";
import LocationSearch from "../components/LocationSearch";
import RideCard from "../components/RideCard";
import RideMap, { type MapCoordinate, type RideMapSelectionTarget } from "../components/RideMap";
import { DraftBanner } from "../components/DraftBanner";
import { BOOKING_STATUS_META } from "../components/StatusBadge";
import { useApp } from "../context/AppContext";
import { useDraft } from "../services/drafts";
import { reverseGeocodeLocation } from "../services/geocoding";
import { readJourneyParams } from "../services/journeyParams";
import { getRoute } from "../services/routing";
import {
  applyDetourResults,
  MATCH_DEFAULTS,
  measureDetours,
  minutesBetween,
  rankRideMatches,
  type LocalMatch,
} from "../services/matching";
import {
  buildPickupProposal,
  verifyPickupPairing,
  type PickupCandidate,
  type PickupProposal,
} from "../services/pickup";
import { ACTIVE_BOOKING_STATUSES } from "../types";
import type { Coordinates, Ride, RouteResult } from "../types";

/** Unfinished "find a ride" search, persisted per user. */
interface FindDraft {
  origin: Coordinates | null;
  destination: Coordinates | null;
  date: string;
  time: string;
  seats: number;
  /** True once the user has actually run a search with these parameters. */
  searched: boolean;
}

/**
 * Only a handful of rides are re-routed for detour measurement, because that is
 * the one part of matching that costs a network round trip each. The rest of the
 * screen is answered from stored geometry.
 */
const MAX_DETOUR_MATCHES = 6;

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const rideDepartureTimestamp = (ride: Ride) =>
  new Date(ride.departureDate.includes("T") ? ride.departureDate : `${ride.departureDate}T${ride.departureTime || "00:00"}`).getTime();

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
.rt-find-page { min-height: 100%; color: var(--rt-text-strong); background: var(--rt-surface-subtle); }
.rt-find-page .container { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
.rt-find-page .page-container { padding: 38px 0 66px; }
.rt-find-page h1, .rt-find-page h2, .rt-find-page h3, .rt-find-page p { margin-top: 0; }
.rt-find-page .page-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 25px; }
.rt-find-page .page-heading h1 { margin: 8px 0 7px; color: var(--rt-text-strong); font-size: clamp(1.8rem, 3vw, 2.55rem); letter-spacing: -.05em; }
.rt-find-page .page-heading p { margin: 0; color: var(--rt-muted); font-size: .91rem; }
.rt-find-page .section-kicker { color: var(--rt-primary-strong); font-size: .72rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-find-page .page-heading-icon { width: 54px; height: 54px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 17px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-find-page .card { border: 1px solid var(--rt-border); border-radius: 21px; background: var(--rt-card); box-shadow: 0 13px 34px rgba(32,75,45,.07); }
.rt-find-page .find-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, .86fr); gap: 20px; align-items: start; }
.rt-find-page .find-main { display: grid; gap: 20px; min-width: 0; }
.rt-find-page .find-map { position: sticky; top: 18px; min-width: 0; }
.rt-find-page .search-form { padding: 24px; }
.rt-find-page .form-section-title { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; color: var(--rt-text); }
.rt-find-page .form-section-title > svg { color: var(--rt-primary-strong); }
.rt-find-page .form-section-title h2 { margin: 0; font-size: 1rem; letter-spacing: -.015em; }
.rt-find-page .form-section-title p { margin: 3px 0 0; color: var(--rt-muted); font-size: .75rem; font-weight: 400; }
.rt-find-page .location-fields { display: grid; gap: 14px; }
.rt-find-page .field-group { display: grid; gap: 7px; min-width: 0; }
.rt-find-page .field-group > label, .rt-find-page .location-search__label { color: var(--rt-text); font-size: .78rem; font-weight: 760; }
.rt-find-page .location-search { position: relative; }
.rt-find-page .location-search__label { display: block; margin-bottom: 7px; }
.rt-find-page .location-search__control { position: relative; }
.rt-find-page .location-search__input { width: 100%; min-height: 45px; padding: 10px 40px 10px 37px; border: 1px solid var(--rt-border); border-radius: 11px; color: var(--rt-text-strong); background: var(--rt-card); outline: none; font: inherit; font-size: .84rem; transition: border-color .18s ease, box-shadow .18s ease; }
.rt-find-page .location-search__input:focus { border-color: var(--rt-primary-strong); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 11%, transparent); }
.rt-find-page .location-search__search-icon { position: absolute; z-index: 1; top: 13px; left: 12px; color: var(--rt-muted); pointer-events: none; }
.rt-find-page .location-search__spinner, .rt-find-page .location-search__selected-icon, .rt-find-page .location-search__clear { position: absolute; top: 12px; right: 10px; }
.rt-find-page .location-search__spinner { color: var(--rt-primary-strong); animation: rt-find-spin .8s linear infinite; }
.rt-find-page .location-search__selected-icon { color: var(--rt-primary-strong); }
.rt-find-page .location-search__clear { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 7px; color: var(--rt-muted); background: transparent; cursor: pointer; }
.rt-find-page .location-search__clear:hover { color: var(--rt-danger); background: var(--rt-danger-soft); }
.rt-find-page .location-search__dropdown { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; left: 0; overflow: auto; border: 1px solid var(--rt-border); border-radius: 13px; background: var(--rt-card); box-shadow: 0 16px 30px rgba(24,64,38,.14); }
.rt-find-page .location-search__option { display: flex; align-items: center; gap: 9px; padding: 11px 12px; color: var(--rt-text); font-size: .78rem; cursor: pointer; }
.rt-find-page .location-search__option:hover, .rt-find-page .location-search__option.is-active { background: var(--rt-surface-subtle); }
.rt-find-page .location-search__option-icon { color: var(--rt-primary-strong); }
.rt-find-page .location-search__state { display: flex; align-items: center; gap: 8px; padding: 12px; color: var(--rt-muted); font-size: .76rem; }
.rt-find-page .location-search__state--error { color: var(--rt-danger-text); }
.rt-find-page .location-search__state button { margin-left: auto; border: 0; color: var(--rt-primary-strong); background: transparent; font: inherit; font-size: .74rem; font-weight: 750; cursor: pointer; }
.rt-find-page .location-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.rt-find-page .location-button, .rt-find-page .map-pick-button { display: inline-flex; align-items: center; gap: 5px; justify-self: start; padding: 0; border: 0; color: var(--rt-primary-strong); background: transparent; font: inherit; font-size: .72rem; font-weight: 750; cursor: pointer; }
.rt-find-page .location-button:hover, .rt-find-page .map-pick-button:hover, .rt-find-page .map-pick-button.is-active { color: var(--rt-primary-strong); }
.rt-find-page .map-pick-button.is-active { color: var(--rt-primary-strong); text-decoration: underline; text-underline-offset: 3px; }
.rt-find-page .map-pick-cancel { min-height: 30px; display: inline-flex; align-items: center; padding: 0 9px; border: 0; border-radius: 8px; color: inherit; background: rgba(255,255,255,.88); font: inherit; font-size: .7rem; font-weight: 760; cursor: pointer; }
.rt-find-page .map-pick-banner { position: absolute; z-index: 4; top: 12px; left: 12px; right: 58px; display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid var(--rt-border); border-radius: 12px; color: var(--rt-text); background: rgba(255,255,255,.95); box-shadow: 0 8px 24px rgba(20,55,32,.16); font-size: .74rem; font-weight: 720; }
.rt-find-page .map-pick-banner > svg { flex: 0 0 auto; color: var(--rt-primary-strong); }
.rt-find-page .map-pick-banner > span { min-width: 0; flex: 1; }
.rt-find-page .spin { animation: rt-find-spin .8s linear infinite; }
 .rt-find-page .empty-icon { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
 .rt-find-page .form-divider { height: 1px; margin: 22px 0; background: var(--rt-surface-muted); }
.rt-find-page .form-grid { display: grid; gap: 13px; }
.rt-find-page .form-grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rt-find-page .form-grid-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rt-find-page input:not([type="checkbox"]), .rt-find-page select, .rt-find-page textarea { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid var(--rt-border); border-radius: 11px; color: var(--rt-text-strong); background: var(--rt-card); outline: none; font: inherit; font-size: .83rem; }
.rt-find-page input:focus, .rt-find-page select:focus, .rt-find-page textarea:focus { border-color: var(--rt-primary-strong); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 11%, transparent); }
.rt-find-page .field-hint { color: var(--rt-muted); font-size: .69rem; line-height: 1.35; }
.rt-find-page .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid transparent; border-radius: 11px; font: inherit; font-size: .82rem; font-weight: 780; text-decoration: none; cursor: pointer; }
.rt-find-page .btn-primary { color: var(--rt-text-inverse); background: var(--rt-primary-strong); box-shadow: 0 8px 18px color-mix(in srgb, var(--rt-primary) 18%, transparent); }
.rt-find-page .btn-primary:hover:not(:disabled) { background: var(--rt-primary-strong); }
.rt-find-page .btn:disabled { opacity: .52; cursor: not-allowed; box-shadow: none; }
.rt-find-page .btn-block { width: 100%; margin-top: 22px; }
.rt-find-page .map-panel { min-width: 0; overflow: hidden; }
.rt-find-page .map-panel-actions { display: flex; align-items: center; gap: 12px; }
.rt-find-page .map-expand { display: none; min-height: 34px; align-items: center; gap: 5px; padding: 0 10px; border: 1px solid var(--rt-border); border-radius: 9px; color: var(--rt-text); background: var(--rt-card); font: inherit; font-size: .72rem; font-weight: 760; white-space: nowrap; cursor: pointer; }
.rt-find-page .map-expand:hover { border-color: var(--rt-primary-strong); color: var(--rt-primary-strong); }
.rt-find-page .map-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 21px 22px 16px; }
.rt-find-page .map-panel-header h2 { margin: 6px 0 0; color: var(--rt-text-strong); font-size: 1.08rem; letter-spacing: -.02em; }
.rt-find-page .route-summary { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 11px; color: var(--rt-muted); font-size: .71rem; }
.rt-find-page .route-summary span { display: inline-flex; align-items: center; gap: 5px; }
.rt-find-page .route-summary svg { color: var(--rt-primary-strong); }
.rt-find-page .map-wrap { position: relative; min-height: 420px; height: 100%; overflow: hidden; background: var(--rt-surface-muted); }
.rt-find-page .ride-map { width: 100%; height: 100%; min-height: 420px; }
.rt-find-page .map-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--rt-text); background: rgba(247,252,248,.72); font-size: .8rem; font-weight: 700; pointer-events: none; }
.rt-find-page .map-overlay-empty { flex-direction: column; color: var(--rt-muted); }
.rt-find-page .map-overlay-empty svg { color: var(--rt-primary-strong); }
.rt-find-page .map-error { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; color: var(--rt-danger-text); background: var(--rt-danger-soft); font-size: .75rem; line-height: 1.45; }
.rt-find-page .map-error svg { flex: 0 0 auto; margin-top: 1px; }
.rt-find-page .form-message { display: flex; align-items: flex-start; gap: 7px; margin: 12px 0 0; padding: 10px 11px; border-radius: 10px; font-size: .75rem; line-height: 1.45; }
.rt-find-page .error-message { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-find-page .success-message { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-find-page .notice-message { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-find-page .form-message svg { flex: 0 0 auto; margin-top: 1px; }
.rt-find-page .results-section { margin-top: 0; }
.rt-find-page .results-section .section-heading { margin-bottom: 17px; }
.rt-find-page .results-section h2 { margin: 6px 0 0; color: var(--rt-text-strong); font-size: 1.35rem; letter-spacing: -.03em; }
.rt-find-page .results-caption { color: var(--rt-muted); font-size: .75rem; }
.rt-find-page .results-grid { grid-template-columns: minmax(0, 1fr); }
.rt-find-page .result-card-wrap { display: flex; flex-direction: column; min-width: 0; }
.rt-find-page .result-card-wrap .ride-card { flex: 1 1 auto; }
.rt-find-page .match-card { margin-bottom: 12px; padding: 13px 14px; border: 1px solid var(--rt-border); border-top: 0; border-radius: 0 0 16px 16px; background: var(--rt-surface-subtle); box-shadow: 0 10px 24px rgba(32,75,45,.05); }
.rt-find-page .match-score { display: flex; align-items: center; gap: 10px; }
.rt-find-page .match-score-value { display: inline-flex; align-items: baseline; gap: 3px; padding: 5px 9px; border-radius: 9px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); font-size: .95rem; font-weight: 800; letter-spacing: -.02em; }
.rt-find-page .match-score-value small { font-size: .58rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; opacity: .72; }
.rt-find-page .match-score-note { color: var(--rt-text); font-size: .67rem; line-height: 1.35; }
.rt-find-page .match-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; margin: 11px 0 0; padding: 0; list-style: none; }
.rt-find-page .match-facts li { display: flex; align-items: flex-start; gap: 6px; color: var(--rt-text); font-size: .68rem; line-height: 1.35; }
.rt-find-page .match-facts svg { flex: 0 0 auto; margin-top: 1px; color: var(--rt-primary-strong); }
.rt-find-page .match-facts strong { color: var(--rt-text-strong); font-weight: 800; }
.rt-find-page .match-weak { color: var(--rt-warning-text); }
.rt-find-page .match-unmeasured { color: var(--rt-warning-text); }
.rt-find-page .pickup-toggle { display: inline-flex; align-items: center; gap: 5px; margin-top: 11px; padding: 0; border: 0; color: var(--rt-primary-strong); background: transparent; font: inherit; font-size: .71rem; font-weight: 780; cursor: pointer; }
.rt-find-page .pickup-toggle:hover { color: var(--rt-text-strong); text-decoration: underline; text-underline-offset: 3px; }
.rt-find-page .pickup-panel { margin-top: 11px; padding: 12px; border: 1px solid var(--rt-border); border-radius: 13px; background: var(--rt-card); }
.rt-find-page .pickup-panel h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; color: var(--rt-text); font-size: .78rem; }
.rt-find-page .pickup-panel h4 svg { color: var(--rt-primary-strong); }
.rt-find-page .pickup-panel > p { margin: 0 0 10px; color: var(--rt-muted); font-size: .68rem; line-height: 1.45; }
.rt-find-page .pickup-group + .pickup-group { margin-top: 12px; }
.rt-find-page .pickup-group > span { display: block; margin-bottom: 6px; color: var(--rt-text); font-size: .68rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.rt-find-page .pickup-option { display: flex; align-items: flex-start; gap: 8px; width: 100%; margin-top: 6px; padding: 8px 9px; border: 1px solid var(--rt-border); border-radius: 10px; color: var(--rt-text); background: var(--rt-card); font: inherit; font-size: .69rem; line-height: 1.4; text-align: left; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.rt-find-page .pickup-option:hover { border-color: var(--rt-green-200); background: var(--rt-surface-subtle); }
.rt-find-page .pickup-option.is-selected { border-color: var(--rt-primary-strong); background: var(--rt-surface-subtle); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rt-primary) 28%, transparent); }
.rt-find-page .pickup-option-radio { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 1px; border: 1.5px solid var(--rt-border); border-radius: 50%; }
.rt-find-page .pickup-option.is-selected .pickup-option-radio { border-color: var(--rt-primary-strong); background: radial-gradient(circle, var(--rt-primary-strong) 0 45%, transparent 48%); }
.rt-find-page .pickup-option-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rt-find-page .pickup-option-label { color: var(--rt-text); font-weight: 750; }
.rt-find-page .pickup-option-walk { color: var(--rt-muted); }
.rt-find-page .pickup-notice { display: flex; align-items: flex-start; gap: 7px; margin: 0; padding: 9px 10px; border-radius: 10px; color: var(--rt-warning-text); background: var(--rt-warning-border); font-size: .68rem; line-height: 1.45; }
.rt-find-page .pickup-notice svg { flex: 0 0 auto; margin-top: 1px; }
.rt-find-page .pickup-verified { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--rt-surface-muted); color: var(--rt-primary-strong); font-size: .67rem; font-weight: 750; }
.rt-find-page .result-booking-bar { display: flex; align-items: center; gap: 7px; min-height: 67px; margin-top: auto; padding: 10px; border: 1px solid var(--rt-border); border-top: 0; border-radius: 0 0 16px 16px; background: var(--rt-card); box-shadow: 0 10px 24px rgba(32,75,45,.05); }
.rt-find-page .result-booking-bar label { margin-right: auto; color: var(--rt-text); font-size: .69rem; font-weight: 700; }
.rt-find-page .result-booking-bar select { width: 48px; min-height: 36px; padding: 5px 7px; }
.rt-find-page .result-booking-bar .btn { min-height: 36px; padding: 0 10px; font-size: .72rem; }
.rt-find-page .empty-state { min-height: 245px; display: grid; place-items: center; padding: 28px; text-align: center; }
.rt-find-page .empty-state h3 { margin: 15px 0 6px; color: var(--rt-text-strong); }
.rt-find-page .empty-state p { max-width: 390px; margin: 0; color: var(--rt-muted); font-size: .82rem; line-height: 1.5; }
.rt-find-page .ride-card-skeleton { min-height: 400px; background: linear-gradient(135deg, var(--rt-surface-subtle), var(--rt-surface-subtle)); }
.rt-find-page .info-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 48px; padding: 18px; border: 1px solid var(--rt-border); border-radius: 17px; background: var(--rt-surface-subtle); }
.rt-find-page .info-strip > div { display: flex; align-items: flex-start; gap: 9px; color: var(--rt-primary-strong); font-size: .71rem; line-height: 1.45; }
.rt-find-page .info-strip > div + div { padding-left: 15px; border-left: 1px solid var(--rt-border); }
.rt-find-page .info-strip span { color: var(--rt-muted); }
.rt-find-page .info-strip strong { color: var(--rt-text); }
@keyframes rt-find-spin { to { transform: rotate(360deg); } }
@media (max-width: 980px) {
  /* Stacking the columns is not enough: the map has to land between the search
     form and the results, which are siblings inside the find-main wrapper.
     Letting that wrapper generate no box hands its children to the grid
     directly, so the order below can place them. minmax(0, 1fr) rather than 1fr
     so a long place name cannot push the column wider than the viewport. */
  .rt-find-page .find-main { display: contents; }
  .rt-find-page .find-layout { grid-template-columns: minmax(0, 1fr); }
  .rt-find-page .find-map { position: static; order: 2; }
  .rt-find-page .search-form { order: 1; }
  .rt-find-page .results-section { order: 3; }
  .rt-find-page .map-wrap, .rt-find-page .ride-map { min-height: 380px; }
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
  .rt-find-page .map-panel-actions { display: block; }
  .rt-find-page .map-expand { display: inline-flex; margin-top: 12px; }
  .rt-find-page .map-wrap, .rt-find-page .ride-map { min-height: 310px; }
  .rt-find-page .results-section { margin-top: 0; }
  .rt-find-page .match-facts { grid-template-columns: 1fr; }
  .rt-find-page .result-booking-bar { flex-wrap: wrap; }
  .rt-find-page .result-booking-bar label { width: 100%; }
  .rt-find-page .result-booking-bar select { flex: 1; }
  .rt-find-page .result-booking-bar .btn { flex: 1; }
  .rt-find-page .info-strip { grid-template-columns: 1fr; }
  .rt-find-page .info-strip > div + div { padding: 12px 0 0; border-top: 1px solid var(--rt-border); border-left: 0; }
  /* Expanding the map takes over the viewport on a phone, so the collapsed
     default has to stay short enough that the results are still reachable. */
  .rt-find-page .find-map--expanded { position: fixed; z-index: 40; inset: 0; padding: 12px; background: rgba(20,42,28,.55); }
  .rt-find-page .find-map--expanded .map-panel { display: flex; flex-direction: column; height: 100%; }
  .rt-find-page .find-map--expanded .map-wrap, .rt-find-page .find-map--expanded .ride-map { flex: 1 1 auto; min-height: 0; }
}
`;

export default function FindRidePage() {
  const { loading, activeUserId, users, vehicles, rides, bookings, requestBooking, searchRides } = useApp();
  const [searchParams] = useSearchParams();
  /**
   * Search parameters survive a reload or a recreated PWA. `searched` records
   * that the user already ran this search, so restoring the parameters does not
   * silently fire a fresh search (and a burst of route requests) on arrival -
   * results are always re-read from Supabase anyway.
   */
  const emptyFindDraft = useMemo<FindDraft>(
    () => ({ origin: null, destination: null, date: "", time: "", seats: 1, searched: false }),
    [],
  );
  const findDraft = useDraft<FindDraft>("find-ride", emptyFindDraft, activeUserId);
  const { value: form, setValue: setFormValue } = findDraft;
  const { origin, destination, date, time, seats } = form;
  const setOrigin = (value: Coordinates | null) => setFormValue((c) => ({ ...c, origin: value }));
  const setDestination = (value: Coordinates | null) => setFormValue((c) => ({ ...c, destination: value }));
  const setDate = (value: string) => {
    dateManuallyChanged.current = true;
    setFormValue((c) => ({ ...c, date: value }));
  };
  const setTime = (value: string) => setFormValue((c) => ({ ...c, time: value }));
  const setSeats = (value: number | ((current: number) => number)) =>
    setFormValue((c) => ({ ...c, seats: typeof value === "function" ? value(c.seats) : value }));

  /**
   * A route handed over from the home page planner.
   *
   * Applied once per mount, and it marks the date as user-chosen so the
   * suggested-date effect does not immediately overwrite the date that came
   * with the route. It deliberately does not run the search: the member has
   * arrived on the Find Ride form, and firing a search - and a burst of route
   * requests - before they have looked at what was carried over would be
   * presumptuous. They press Search.
   */
  const handoffApplied = useRef(false);
  useEffect(() => {
    if (handoffApplied.current) return;
    const params = readJourneyParams(searchParams);
    if (!params) return;
    handoffApplied.current = true;
    if (params.origin) setOrigin(params.origin);
    if (params.destination) setDestination(params.destination);
    if (params.date) setDate(params.date);
    if (params.time) setTime(params.time);
    if (params.seats) setSeats(params.seats);
  }, [searchParams]);

  const [searchRoute, setSearchRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [pickTarget, setPickTarget] = useState<RideMapSelectionTarget | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [results, setResults] = useState<LocalMatch[]>([]);
  /** Ride id whose meeting-point panel is open. Only one at a time, on purpose. */
  const [pickupOpenRideId, setPickupOpenRideId] = useState<string | null>(null);
  const [pickupChoice, setPickupChoice] = useState<Record<string, { pickupId: string; dropoffId: string }>>({});
  const [verifyingRideId, setVerifyingRideId] = useState<string | null>(null);
   const [bookingRideId, setBookingRideId] = useState("");
   const [bookingSeatsByRide, setBookingSeatsByRide] = useState<Record<string, number>>({});
  const [bookingError, setBookingError] = useState("");
   const [bookingSuccess, setBookingSuccess] = useState("");
const [mapExpanded, setMapExpanded] = useState(false);
  const mapPanelRef = useRef<HTMLElement>(null);
  const pickRequest = useRef(0);
  const pickController = useRef<AbortController | null>(null);
   const routeRequest = useRef(0);
   const routeController = useRef<AbortController | null>(null);
  const searchRequest = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  // Lets the restore effect above invoke the current search implementation
  // without making that effect depend on a function redefined every render.
  const runSearchRef = useRef<() => Promise<void>>(async () => undefined);
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

   /**
    * Suggest the earliest date that actually has a ride, but never overwrite a
    * date the user chose or a date that was restored from a saved draft.
    */
   useEffect(() => {
     if (dateManuallyChanged.current) return;
     if (findDraft.restored && date) {
       dateManuallyChanged.current = true;
       return;
     }
     if (!date) setDate(suggestedDate);
   }, [suggestedDate]);

   /**
    * Restoring a search that had already been run: re-run it once the route is
    * ready so the results match what the user last saw. Results themselves are
    * always read from Supabase, never restored from the draft.
    */
   const restoredSearch = useRef(false);
   useEffect(() => {
     if (restoredSearch.current) return;
     if (!findDraft.value.searched) return;
     if (!origin || !destination) return;
     if (!searchRoute || routeLoading) return;
     restoredSearch.current = true;
     findDraft.dismissBanner();
     void runSearchRef.current();
   }, [findDraft.value.searched, origin, destination, searchRoute, routeLoading]);

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
    setPickupOpenRideId(null);
    setPickupChoice({});
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
    setPickupOpenRideId(null);
    setPickupChoice({});
  }, [activeUserId]);

  /**
   * Live revalidation.
   *
   * A published ride can be edited, filled up or cancelled by somebody else while
   * this page is open, and a seat count that came back over the realtime channel
   * has to take a result off the screen immediately. The pickup and drop-off a
   * rider had already chosen are kept, because they are still valid for the same
   * route.
   */
  useEffect(() => {
    setResults((current) =>
      current.flatMap((match) => {
        const currentRide = rides.find((item) => item.id === match.ride.id);
        if (!currentRide || currentRide.status !== "active" || currentRide.driverId === activeUserId) return [];
        if (currentRide.departureDate !== date || currentRide.availableSeats < seats) return [];
        const departure = rideDepartureTimestamp(currentRide);
        if (!Number.isFinite(departure) || departure <= Date.now()) return [];
        const timeDifference = minutesBetween(currentRide.departureTime, time);
        if (timeDifference !== null && Math.abs(timeDifference) > MATCH_DEFAULTS.maxTimeWindowMinutes) {
          return [];
        }
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

  // The expanded map covers the whole screen, so it has to behave like the modal
  // it effectively is: Escape dismisses it, the page behind it cannot scroll, and
  // focus moves into the map and returns to the button that opened it.
  useEffect(() => {
    if (!mapExpanded) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => mapPanelRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMapExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [mapExpanded]);

  const handleSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
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
    // Remember that this exact search was run, so restoring the draft re-runs it.
    setFormValue((current) => ({ ...current, searched: true }));

    try {
      // The date, seat and self-exclusion filters run in Postgres so only
      // relevant candidates cross the network. Everything after that needs the
      // rider's exact origin and destination, and runs here.
      const serverCandidates = await searchRides({ origin, destination, date, time, seats });
      if (searchRequest.current !== requestId) return;

      const candidates = serverCandidates.filter((ride) => {
        if (ride.status !== "active" || ride.driverId === activeUserId) return false;
        if (ride.availableSeats < seats) return false;
        if (ride.departureDate !== date) return false;
        const departure = rideDepartureTimestamp(ride);
        return Number.isFinite(departure) && departure > Date.now();
      });

      if (candidates.length === 0) {
        setResults([]);
        setSearchNotice("");
        setSearchError("No published rides are open for that date and seat count.");
        return;
      }

      // Stage 1, entirely local: project the rider's trip onto each stored road
      // corridor. A ride whose road does not pass near both ends, or that does
      // not go the right way, never reaches the network stage.
      const localMatches = rankRideMatches(candidates, { origin, destination, time });
      const offCorridor = candidates.length - localMatches.length;

      if (localMatches.length === 0) {
        setResults([]);
        setSearchError(
          "No ride on that date follows a road through both your pickup and your drop-off. "
          + "Try a nearby starting point, or look at another date.",
        );
        return;
      }

      // Stage 2, network: re-route the best few with the passenger inserted, so
      // the cost to the driver is measured rather than guessed.
      const detourTargets = localMatches.slice(0, MAX_DETOUR_MATCHES);
      const detours = await measureDetours(detourTargets, { signal: controller.signal });
      if (searchRequest.current !== requestId) return;

      const measured = applyDetourResults(detourTargets, detours);
      // Rides past the measurement budget keep their local score rather than
      // being dropped, but they are shown after the measured ones and say so.
      const unmeasured = localMatches
        .slice(MAX_DETOUR_MATCHES)
        .map((match) => ({ ...match, unmeasured: true as const }));
      const finalMatches = [...measured, ...unmeasured];

      const notices: string[] = [];
      if (offCorridor > 0) {
        notices.push(
          `${offCorridor} of ${candidates.length} ${offCorridor === 1 ? "ride does" : "rides do"} not travel along a road through both your pickup and your drop-off.`,
        );
      }
      // Counted from the measurement itself rather than by subtracting list
      // lengths. A re-route that failed leaves a ride in the results without a
      // detour figure, and working it out by subtraction reported those as
      // "adds too much driving" - the opposite of what went wrong.
      const overBudget = [...detours.values()].filter(
        (detour) => detour.detourKm !== null && detour.detourKm > MATCH_DEFAULTS.maxDetourKm,
      ).length;
      if (overBudget > 0) {
        notices.push(
          `${overBudget} ${overBudget === 1 ? "ride adds" : "rides add"} more than ${MATCH_DEFAULTS.maxDetourKm} km of extra driving to your journey.`,
        );
      }
      const failedToMeasure = [...detours.values()].filter((detour) => detour.detourKm === null).length;
      if (failedToMeasure > 0) {
        notices.push(
          `The extra driving for ${failedToMeasure} ${failedToMeasure === 1 ? "ride could" : "rides could"} not be measured, so ${failedToMeasure === 1 ? "it is" : "they are"} ranked on the road the driver published.`,
        );
      }
      if (unmeasured.length > 0) {
        notices.push(
          `${unmeasured.length} further ${unmeasured.length === 1 ? "ride is" : "rides are"} shown with the detour not yet measured.`,
        );
      }
      setSearchNotice(notices.join(" "));
      setSearchError("");
      setResults(finalMatches);
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

  runSearchRef.current = handleSearch;

  /**
   * Where the driver can actually meet this rider, and where they will be set
   * down. Both are points on the driver's own road, not in the middle of the
   * locality the rider typed.
   */
  const proposals = useMemo(() => {
    const built = new Map<string, PickupProposal>();
    if (!origin || !destination) return built;
    for (const match of results) {
      built.set(match.ride.id, buildPickupProposal(match.ride, origin, destination));
    }
    return built;
  }, [origin, destination, results]);

  const selectedPairing = (
    match: LocalMatch,
  ): { pickup: PickupCandidate; dropoff: PickupCandidate } | null => {
    const proposal = proposals.get(match.ride.id);
    if (!proposal?.recommended) return null;
    const choice = pickupChoice[match.ride.id];
    if (!choice) return proposal.recommended;
    const pickup = proposal.pickups.find((candidate) => candidate.id === choice.pickupId);
    const dropoff = proposal.dropoffs.find((candidate) => candidate.id === choice.dropoffId);
    return pickup && dropoff ? { pickup, dropoff } : proposal.recommended;
  };


    /**
     * Sends the seat request.
     *
     * When a meeting point was proposed, the pairing is confirmed with the
     * routing service first, so the detour stored on the booking is one the
     * driver will actually drive. If that check fails the request is not sent:
     * an unmeasured detour is not something to write into a booking that another
     * person will act on.
     */
   const handleBooking = async (rideId: string, availableSeats: number) => {
     const selectedSeats = bookingSeatsByRide[rideId] ?? 1;
     const seatsToRequest = Math.min(selectedSeats, availableSeats);
     if (!Number.isInteger(seatsToRequest) || seatsToRequest < 1) {
      setBookingError("Choose at least one seat.");
      return;
    }
    const match = results.find((item) => item.ride.id === rideId);
    if (!match) {
      setBookingError("This ride is no longer in your results. Search again.");
      return;
    }
    setBookingRideId(rideId);
    setBookingError("");
    setBookingSuccess("");
    try {
      const pairing = selectedPairing(match);
      if (pairing) {
        setVerifyingRideId(rideId);
        const verified = await verifyPickupPairing(
          match.ride,
          pairing.pickup,
          pairing.dropoff,
        );
        setVerifyingRideId(null);
        await requestBooking(rideId, seatsToRequest, {
          pickup: verified.pickup,
          dropoff: verified.dropoff,
          match: match.score,
        });
      } else {
        await requestBooking(rideId, seatsToRequest, { match: match.score });
      }
       const meetingNote = pairing
         ? ` Meeting point: ${pairing.pickup.point.label}, ${pairing.pickup.walkKm} km walk.`
         : "";
       setBookingSuccess(
         `Your request for ${seatsToRequest} ${seatsToRequest === 1 ? "seat" : "seats"} was sent to the driver.${meetingNote}`,
       );
       setBookingSeatsByRide((current) => ({ ...current, [rideId]: 1 }));
       setPickupOpenRideId(null);
    } catch (error: unknown) {
      setVerifyingRideId(null);
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

        {findDraft.restored ? (
          <DraftBanner
            savedAt={findDraft.savedAt}
            workflow="search"
            onDiscard={findDraft.discard}
            onDismiss={findDraft.dismissBanner}
          />
        ) : null}

        <div className="find-layout">
          <div className="find-main">
          <form className="card search-form" onSubmit={(event) => void handleSearch(event)}>
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
            {locationLoading && <p className="form-message notice-message" role="status" data-testid="find-location-status"><LoaderCircle className="spin" size={16} />Finding that place in India…</p>}
            {locationError && <p className="form-message error-message" role="alert" data-testid="find-location-error"><AlertCircle size={16} />{locationError}</p>}

            <div className="form-divider" />
            <div className="form-section-title"><CalendarDays size={19} /><h2>When and how many?</h2></div>
            <div className="form-grid form-grid-three">
              <div className="field-group">
                <label htmlFor="ride-date">Date</label>
                <input id="ride-date" data-testid="find-date" type="date" min={today} value={date} onChange={(event) => { dateManuallyChanged.current = true; setDate(event.target.value); clearResults(); }} required />
              </div>
              <div className="field-group">
                <label htmlFor="ride-time">Time</label>
                <input id="ride-time" data-testid="find-time" type="time" value={time} onChange={(event) => { setTime(event.target.value); clearResults(); }} />
                <span className="field-hint">
                  Optional · leave blank for any time that day, or set it to match a departure within {Math.round(MATCH_DEFAULTS.maxTimeWindowMinutes / 60 * 10) / 10} hours
                </span>
              </div>
              <div className="field-group">
                <label htmlFor="ride-seats">Seats</label>
                <select id="ride-seats" data-testid="find-seats" value={seats} onChange={(event) => { setSeats(Number(event.target.value)); clearResults(); }}>
                  {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} {value === 1 ? "seat" : "seats"}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary btn-block" data-testid="find-submit" type="submit" disabled={routeLoading || !searchRoute || searchLoading}>
              {searchLoading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
              {searchLoading ? "Checking compatible rides…" : "Search rides"}
            </button>
            {searchError && <p className="form-message error-message" role="alert" data-testid="find-error"><AlertCircle size={16} />{searchError}</p>}
          </form>

        <section className="results-section" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <span className="section-kicker">Real matches</span>
              <h2>{results.length > 0 ? `${results.length} compatible ${results.length === 1 ? "ride" : "rides"}` : "Available rides"}</h2>
            </div>
            {results.length > 0 && searchRoute && <span className="results-caption">Ranked by how well the route fits your trip</span>}
          </div>
          {searchNotice && <p className="form-message notice-message"><AlertCircle size={16} />{searchNotice}</p>}
          {bookingSuccess && <p className="form-message success-message" role="status" data-testid="find-booking-success"><Check size={16} />{bookingSuccess}</p>}
          {bookingError && <p className="form-message error-message" role="alert" data-testid="find-booking-error"><AlertCircle size={16} />{bookingError}</p>}

          {loading ? (
            <div className="ride-grid"><div className="card ride-card-skeleton" /><div className="card ride-card-skeleton" /><div className="card ride-card-skeleton" /></div>
          ) : results.length > 0 ? (
            <div className="ride-grid results-grid" data-testid="find-results">
              {results.map((match) => {
                const ride = match.ride;
                const driver = users.find((user) => user.id === ride.driverId);
                const vehicle = vehicles.find((item) => item.id === ride.vehicleId);
                const existingBooking = bookings.find(
                  (booking) =>
                    booking.rideId === ride.id
                    && booking.riderId === activeUserId
                    && ACTIVE_BOOKING_STATUSES.includes(booking.status),
                );
                const proposal = proposals.get(ride.id);
                const pairing = selectedPairing(match);
                const panelOpen = pickupOpenRideId === ride.id;
                const busy = bookingRideId === ride.id;
                const unmatched = "unmeasured" in match;
                return (
                  <div className="result-card-wrap" key={ride.id}>
                    <RideCard ride={ride} driver={driver} vehicle={vehicle} currentUserId={activeUserId} />
                    <div className="match-card">
                      <div className="match-score">
                        <span className="match-score-value">
                          {match.score.score}<small>fit</small>
                        </span>
                        <span className="match-score-note">
                          {unmatched
                            ? "From the driver's stored road, before the extra driving was measured."
                            : "Built from the measurements below, not a prediction."}
                        </span>
                      </div>
                      <ul className="match-facts">
                        <li className={match.onCorridor ? undefined : "match-unmeasured"}>
                          <RouteIcon size={13} aria-hidden="true" />
                          {match.onCorridor ? (
                            <span>
                              <strong>{Math.round((match.score.overlap ?? 0) * 100)}%</strong> of your trip follows this road
                            </span>
                          ) : (
                            <span>This ride has no stored road, so the shared stretch could not be measured</span>
                          )}
                        </li>
                        <li>
                          <MapPin size={13} aria-hidden="true" />
                          <span>
                            <strong>{match.score.walkDistanceKm} km</strong> average walk to the meeting point
                          </span>
                        </li>
                        <li className={unmatched || match.score.totalDetourKm === null ? "match-unmeasured" : undefined}>
                          <ArrowRight size={13} aria-hidden="true" />
                          {unmatched || match.score.totalDetourKm === null ? (
                            <span>Extra driving could not be measured</span>
                          ) : (
                            <span>
                              Adds <strong>{match.score.totalDetourKm} km</strong>
                              {match.score.totalDetourMinutes ? ` / ${match.score.totalDetourMinutes} min` : ""} to the driver
                            </span>
                          )}
                        </li>
                        <li className={match.score.timeDifferenceMinutes === null ? "match-unmeasured" : undefined}>
                          <Clock3 size={13} aria-hidden="true" />
                          {match.score.timeDifferenceMinutes === null ? (
                            <span>You did not ask for a particular time</span>
                          ) : match.score.timeDifferenceMinutes === 0 ? (
                            <span>Departs at your time</span>
                          ) : (
                            <span>
                              Departs <strong>{Math.abs(match.score.timeDifferenceMinutes)} min</strong>
                              {match.score.timeDifferenceMinutes > 0 ? " later" : " earlier"}
                            </span>
                          )}
                        </li>
                      </ul>
                      {proposal?.recommended ? (
                        <>
                          <button
                            className="pickup-toggle"
                            type="button"
                            aria-expanded={panelOpen}
                            onClick={() => setPickupOpenRideId((current) => (current === ride.id ? null : ride.id))}
                          >
                            <MapPinned size={13} />
                            {panelOpen ? "Hide meeting points" : "Choose a different meeting point"}
                          </button>
                          {panelOpen ? (
                            <div className="pickup-panel">
                              <h4><MapPin size={14} />Where this driver can meet you</h4>
                              <p>
                                Every option is a real point on the road this driver is already using, and the
                                walk is the measured distance from where you asked to be collected.
                              </p>
                              <div className="pickup-group">
                                <span>Pickup</span>
                                {proposal.pickups.map((candidate) => {
                                  const selected = pairing?.pickup.id === candidate.id;
                                  return (
                                    <button
                                      className={`pickup-option${selected ? " is-selected" : ""}`}
                                      type="button"
                                      key={candidate.id}
                                      onClick={() => {
                                        const dropoffId = pickupChoice[ride.id]?.dropoffId
                                          ?? proposal.recommended?.dropoff.id
                                          ?? "";
                                        setPickupChoice((current) => ({ ...current, [ride.id]: { pickupId: candidate.id, dropoffId } }));
                                      }}
                                    >
                                      <span className="pickup-option-radio" aria-hidden="true" />
                                      <span className="pickup-option-body">
                                        <span className="pickup-option-label">{candidate.description}</span>
                                        <span className="pickup-option-walk">
                                          {candidate.walkKm < 0.15
                                            ? "Right where you asked"
                                            : `${candidate.walkKm} km walk from ${origin?.label ?? "your pickup"}`}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="pickup-group">
                                <span>Drop-off</span>
                                {proposal.dropoffs.map((candidate) => {
                                  const selected = pairing?.dropoff.id === candidate.id;
                                  const afterPickup = !pairing || candidate.fraction > pairing.pickup.fraction;
                                  return (
                                    <button
                                      className={`pickup-option${selected ? " is-selected" : ""}`}
                                      type="button"
                                      key={candidate.id}
                                      disabled={!afterPickup}
                                      onClick={() => {
                                        const pickupId = pickupChoice[ride.id]?.pickupId
                                          ?? proposal.recommended?.pickup.id
                                          ?? "";
                                        setPickupChoice((current) => ({ ...current, [ride.id]: { pickupId, dropoffId: candidate.id } }));
                                      }}
                                    >
                                      <span className="pickup-option-radio" aria-hidden="true" />
                                      <span className="pickup-option-body">
                                        <span className="pickup-option-label">{candidate.description}</span>
                                        <span className="pickup-option-walk">
                                          {afterPickup
                                            ? `${candidate.walkKm} km walk from ${destination?.label ?? "your destination"}`
                                            : "Before your pickup, so the driver would have to turn back"}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              {busy ? (
                                <p className="pickup-verified">
                                  <LoaderCircle className="spin" size={13} />
                                  Checking this meeting point with the route service…
                                </p>
                              ) : (
                                <p className="pickup-verified">
                                  <Check size={13} />
                                  The driver can confirm a different point before your seat is held.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="pickup-notice">
                          <AlertCircle size={13} />
                          {proposal?.notice
                            ?? "This ride was published without a stored road, so the driver will agree a meeting point with you directly."}
                        </p>
                      )}
                    </div>
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
                        data-testid={`find-book-${ride.id}`}
                        type="button"
                        disabled={ride.availableSeats < 1 || Boolean(bookingRideId) || Boolean(existingBooking)}
                        onClick={() => handleBooking(ride.id, ride.availableSeats)}
                      >
                        {busy
                          ? <LoaderCircle className="spin" size={16} />
                          : verifyingRideId === ride.id
                            ? <RouteIcon size={16} />
                            : <ArrowRight size={16} />}
                        {existingBooking
                          ? BOOKING_STATUS_META[existingBooking.status].label
                          : busy && verifyingRideId === ride.id
                            ? "Checking route…"
                            : "Request seat"}
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
          </div>

          <aside
            className={mapExpanded ? "find-map find-map--expanded" : "find-map"}
            aria-label="Journey map"
            {...(mapExpanded ? { role: "dialog", "aria-modal": true } : {})}
          >
            <section
              id="find-map-panel"
              ref={mapPanelRef}
              tabIndex={-1}
              className="card map-panel"
              aria-label="Journey map"
            >
              <div className="map-panel-header">
                <div>
                  <span className="section-kicker">Route preview</span>
                  <h2>Your journey on the map</h2>
                </div>
                <div className="map-panel-actions">
                  {searchRoute && (
                    <div className="route-summary">
                      <span><RouteIcon size={16} /> {searchRoute.distanceKm.toFixed(1)} km</span>
                      <span><Clock3 size={16} /> {formatDuration(searchRoute.durationMinutes)}</span>
                    </div>
                  )}
                  <button
                    className="map-expand"
                    type="button"
                    data-testid="find-map-expand"
                    aria-expanded={mapExpanded}
                    aria-controls="find-map-panel"
                    onClick={() => setMapExpanded((current) => !current)}
                  >
                    {mapExpanded ? <Shrink size={17} aria-hidden="true" /> : <Expand size={17} aria-hidden="true" />}
                    <span>{mapExpanded ? "Collapse" : "Expand"}</span>
                  </button>
                </div>
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
          </aside>
        </div>

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
