import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CarFront,
  Check,
  CheckCircle2,
  Clock3,
  Edit3,
  Flag,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Navigation,
  PlayCircle,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  Star,
  UserCheck,
  UserX,
  Users,
  Wallet,
  WalletCards,
  X,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import RideMap from "../components/RideMap";
import { Stars } from "../components/Stars";
import {
  BOOKING_STATUS_META,
  BookingStatusBadge,
  isLiveRide,
  nextStepFor,
  RideStatusBadge,
} from "../components/StatusBadge";
import { useApp } from "../context/AppContext";
import { useRideLocation } from "../hooks/useRideLocation";
import { formatRupees } from "../services/fare";
import { getRoute } from "../services/routing";
import { PAYMENT_DISCLAIMER } from "../services/payment";
import { ACTIVE_BOOKING_STATUSES } from "../types";
import type { Booking, Coordinates, RouteResult } from "../types";

const formatDeparture = (date: string, time: string) => {
  const value = new Date(date.includes("T") ? date : `${date}T${time || "00:00"}`);
  if (Number.isNaN(value.getTime())) return `${date} · ${time || "Time not set"}`;
  return value.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDuration = (minutes?: number) => {
  if (minutes === undefined || !Number.isFinite(minutes)) return "Not available";
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (!hours) return `${remaining} min`;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RT";

type BookingAction = "accept" | "reject" | "pickup" | "no-show" | "cancel" | "pay" | "paid" | "unpaid";

/**
 * What one member sees about their own seat.
 *
 * Separate from the host's list because the available actions are the mirror
 * image: a rider can pay or withdraw, and can do nothing at all about being
 * collected. The state name alone is not enough here, so the panel also says
 * whose turn it is - otherwise a rider waits on a driver who is waiting on them.
 */
function CurrentBookingPanel({
  booking,
  isDriver,
  paymentOpened,
  actionLoading,
  onAction,
}: {
  booking: Booking;
  isDriver: boolean;
  /**
   * Whether the rider has already opened a payment for this seat.
   *
   * Accepting a request only holds the seat; the seat becomes confirmed when the
   * payment is resolved by the host. Until then the booking stays
   * `payment_pending`, which on its own looks identical whether the rider has done
   * nothing yet or has opened the payment and is waiting. Reading the payment row
   * is the only way to tell those two apart, and telling them apart is the whole
   * difference between "pay now" and "nothing left for you to do".
   */
  paymentOpened: boolean;
  actionLoading: string;
  onAction: (action: BookingAction, success: string, fallback: string) => void;
}) {
  const { Icon } = BOOKING_STATUS_META[booking.status];
  const nextStep = nextStepFor(booking.status, isDriver);
  const busy = Boolean(actionLoading);
  const canPay = booking.status === "payment_pending" && !paymentOpened;
  const canCancel = booking.status === "pending"
    || booking.status === "payment_pending"
    || booking.status === "confirmed";
  return (
    <div className={`current-booking booking-${booking.status}`} data-testid="current-booking" data-status={booking.status}>
      <div className="current-booking-icon"><Icon size={21} /></div>
      <div>
        <BookingStatusBadge status={booking.status} />
        <span>
          {booking.seats} {booking.seats === 1 ? "seat" : "seats"}
          {typeof booking.fareAmount === "number"
            ? ` · ${formatRupees(booking.fareAmount)}`
            : ""}
        </span>
        {nextStep ? <p className="current-booking-next">{nextStep}</p> : null}
        {booking.pickup ? (
          <p className="current-booking-pickup">
            <MapPin size={13} />
            <span>
              {booking.pickup.label}
              {typeof booking.pickup.walkDistanceKm === "number" && booking.pickup.walkDistanceKm > 0
                ? ` · ${booking.pickup.walkDistanceKm} km walk`
                : ""}
            </span>
          </p>
        ) : null}
        {booking.dropoff ? (
          <p className="current-booking-pickup">
            <Flag size={13} />
            <span>
              Set down at {booking.dropoff.label}
              {typeof booking.dropoff.detourKm === "number" && booking.dropoff.detourKm > 0
                ? ` · adds ${booking.dropoff.detourKm} km to the driver`
                : ""}
            </span>
          </p>
        ) : null}
        {canPay ? (
          <>
            <button
              className="btn btn-primary btn-block"
              type="button"
              data-testid="pay-booking"
              disabled={busy}
              onClick={() => onAction(
                "pay",
                "Payment opened. The driver marks it received to confirm your seat.",
                "We could not open the payment for this seat.",
              )}
            >
              {actionLoading === `${booking.id}:pay` ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}
              Pay {formatRupees(booking.fareAmount ?? 0)} to confirm
            </button>
            <p className="control-hint">{PAYMENT_DISCLAIMER}</p>
          </>
        ) : null}
        {booking.status === "payment_pending" && paymentOpened ? (
          <p className="control-hint" data-testid="payment-opened">
            <Clock3 size={13} /> Your payment is open and waiting for the driver to confirm it. Nothing more to do from here.
          </p>
        ) : null}
        {canCancel ? (
          <button
            className="btn btn-ghost btn-block danger-text"
            type="button"
            data-testid="cancel-booking"
            disabled={busy}
            onClick={() => onAction(
              "cancel",
              "Your booking was cancelled and the seat is free again.",
              "We could not cancel this booking.",
            )}
          >
            {actionLoading === `${booking.id}:cancel` ? <LoaderCircle className="spin" size={17} /> : <X size={17} />}
            Cancel my booking
          </button>
        ) : null}
        {booking.status === "picked_up" ? (
          <p className="current-booking-next"><Clock3 size={13} /> Have a safe trip. The driver ends the trip on arrival.</p>
        ) : null}
      </div>
    </div>
  );
}

const rideDetailsStyles = `
.rt-details-page { min-height: 100%; color: var(--rt-text-strong); background: var(--rt-surface-subtle); }
.rt-details-page .container { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
.rt-details-page .page-container { padding: 27px 0 66px; }
.rt-details-page h1, .rt-details-page h2, .rt-details-page h3, .rt-details-page p { margin-top: 0; }
.rt-details-page .card { border: 1px solid var(--rt-border); border-radius: 21px; background: var(--rt-card); box-shadow: 0 13px 34px rgba(32,75,45,.07); }
.rt-details-page .spin { animation: rt-details-spin .8s linear infinite; }
.rt-details-page .empty-icon { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-details-page .back-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 19px; }
.rt-details-page .back-link { display: inline-flex; align-items: center; gap: 7px; color: var(--rt-primary-strong); font-size: .78rem; font-weight: 780; text-decoration: none; }
.rt-details-page .back-link:hover { color: var(--rt-primary-strong); }
.rt-details-page .status-badge { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); font-size: .68rem; font-weight: 800; text-transform: capitalize; }
.rt-details-page .status-completed { color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-details-page .status-cancelled { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.rt-details-page .page-header__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.rt-details-page .page-header__eyebrow { color: var(--rt-primary-strong); font-size: .72rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-details-page .page-header h1 { margin: 8px 0 7px; color: var(--rt-text-strong); font-size: clamp(1.75rem, 3vw, 2.45rem); letter-spacing: -.05em; }
.rt-details-page .page-header__description { color: var(--rt-muted); font-size: .89rem; }
.rt-details-page .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid transparent; border-radius: 11px; font: inherit; font-size: .81rem; font-weight: 780; text-decoration: none; cursor: pointer; }
.rt-details-page .btn-primary { color: var(--rt-text-inverse); background: var(--rt-primary-strong); box-shadow: 0 8px 18px color-mix(in srgb, var(--rt-primary) 18%, transparent); }
.rt-details-page .btn-primary:hover:not(:disabled) { background: var(--rt-primary-strong); }
.rt-details-page .btn-outline { border-color: var(--rt-border); color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
.rt-details-page .btn-outline:hover:not(:disabled) { border-color: var(--rt-border-strong); background: var(--rt-surface-subtle); }
.rt-details-page .btn-ghost { border-color: var(--rt-danger-border); color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .btn:disabled { opacity: .52; cursor: not-allowed; box-shadow: none; }
.rt-details-page .btn-block { width: 100%; }
.rt-details-page .btn-small { min-height: 34px; padding: 0 9px; font-size: .7rem; }
.rt-details-page .danger-button { border-color: var(--rt-danger-border); color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .danger-text { white-space: nowrap; }
.rt-details-page .icon-button { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--rt-border); border-radius: 10px; color: var(--rt-text); background: var(--rt-card); cursor: pointer; }
 .rt-details-page .icon-button:hover { color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
 .rt-details-page .icon-button:disabled { opacity: .55; cursor: wait; }
 .rt-details-page .control-hint { margin: 0; color: var(--rt-muted); font-size: .68rem; line-height: 1.4; }
/* Keeps the booking CTA reachable while the route, driver and trip detail cards
   scroll past. It is sticky rather than fixed so it still occupies its place in
   the flow, which means it can never strand the page on a phantom gap. */
.rt-details-page .booking-panel { position: sticky; bottom: 18px; z-index: 5; box-shadow: 0 18px 40px rgba(28,66,42,.13); }
.rt-details-page .ride-details-layout { display: grid; grid-template-columns: minmax(0, 1.23fr) minmax(315px, .77fr); gap: 20px; align-items: start; }
.rt-details-page .ride-details-main, .rt-details-page .ride-details-side { display: grid; gap: 17px; min-width: 0; }
.rt-details-page .details-map-card, .rt-details-page .trip-route-card, .rt-details-page .rating-card, .rt-details-page .driver-card, .rt-details-page .booking-panel, .rt-details-page .ride-info-card, .rt-details-page .safety-note { overflow: hidden; }
.rt-details-page .map-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 20px 21px 15px; }
.rt-details-page .map-panel-header h2 { margin: 6px 0 0; color: var(--rt-text-strong); font-size: 1.08rem; }
.rt-details-page .section-kicker { color: var(--rt-primary-strong); font-size: .71rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-details-page .map-wrap { position: relative; min-height: 405px; overflow: hidden; background: var(--rt-surface-muted); }
.rt-details-page .map-wrap-tall { min-height: 405px; }
.rt-details-page .ride-map { width: 100%; height: 405px; min-height: 405px; }
.rt-details-page .map-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--rt-text); background: rgba(247,252,248,.72); font-size: .8rem; font-weight: 700; pointer-events: none; }
.rt-details-page .map-error { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; color: var(--rt-danger-text); background: var(--rt-danger-soft); font-size: .75rem; line-height: 1.45; }
.rt-details-page .map-error svg { flex: 0 0 auto; margin-top: 1px; }
.rt-details-page .route-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--rt-surface-muted); }
.rt-details-page .route-facts > div { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 15px 17px; background: var(--rt-card); }
.rt-details-page .route-facts svg { flex: 0 0 auto; color: var(--rt-primary-strong); }
.rt-details-page .route-facts strong, .rt-details-page .route-facts small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-details-page .route-facts strong { color: var(--rt-text-strong); font-size: .78rem; }
.rt-details-page .route-facts small { margin-top: 4px; color: var(--rt-muted); font-size: .66rem; }
.rt-details-page .trip-route-card, .rt-details-page .rating-card { padding: 21px; }
.rt-details-page .card-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
.rt-details-page .card-title-row > svg { color: var(--rt-primary-strong); }
.rt-details-page .card-title-row h2 { margin: 6px 0 0; color: var(--rt-text-strong); font-size: 1.05rem; letter-spacing: -.02em; }
.rt-details-page .detail-route-list { display: grid; gap: 0; }
.rt-details-page .detail-route-item { position: relative; display: grid; grid-template-columns: 31px minmax(0, 1fr); align-items: center; gap: 11px; min-height: 55px; }
.rt-details-page .detail-route-item:not(:last-child)::after { content: ""; position: absolute; top: 37px; bottom: -8px; left: 15px; border-left: 1px dashed var(--rt-border); }
.rt-details-page .detail-route-marker { z-index: 1; width: 31px; height: 31px; display: grid; place-items: center; border-radius: 10px; color: var(--rt-text-inverse); font-size: .68rem; font-weight: 800; }
.rt-details-page .marker-origin { background: var(--rt-primary-strong); }
.rt-details-page .marker-stop { color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-details-page .marker-destination { background: var(--rt-accent); }
.rt-details-page .detail-route-item small, .rt-details-page .detail-route-item strong { display: block; }
.rt-details-page .detail-route-item small { margin-bottom: 3px; color: var(--rt-muted); font-size: .66rem; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; }
.rt-details-page .detail-route-item strong { overflow: hidden; color: var(--rt-text); font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
.rt-details-page .rating-card { background: linear-gradient(145deg, var(--rt-surface-subtle), var(--rt-card)); }
.rt-details-page .rating-form { display: grid; justify-items: start; gap: 12px; }
.rt-details-page .rating-form p { margin: 0; color: var(--rt-text); font-size: .8rem; }
.rt-details-page .rating-target-field { display: grid; gap: 6px; width: 100%; margin-bottom: 12px; color: var(--rt-text); font-size: .75rem; font-weight: 750; }
.rt-details-page .rating-target-field select { width: 100%; min-height: 42px; padding: 8px 10px; border: 1px solid var(--rt-border); border-radius: 10px; color: var(--rt-text-strong); background: var(--rt-card); outline: none; font: inherit; font-size: .78rem; }
.rt-details-page .rating-form textarea { width: 100%; min-height: 91px; padding: 10px 11px; border: 1px solid var(--rt-border); border-radius: 11px; color: var(--rt-text-strong); background: var(--rt-card); outline: none; font: inherit; font-size: .8rem; resize: vertical; }
.rt-details-page .rating-form textarea:focus { border-color: var(--rt-primary-strong); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 11%, transparent); }
.rt-details-page .rating-complete { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border-radius: 12px; color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-details-page .rating-complete svg { flex: 0 0 auto; }
.rt-details-page .rating-complete strong { display: block; font-size: .81rem; }
.rt-details-page .rating-complete p { margin: 4px 0 0; color: var(--rt-muted); font-size: .74rem; }
.rt-details-page .muted-copy { margin: 0; color: var(--rt-muted); font-size: .77rem; line-height: 1.5; }
.rt-details-page .driver-card, .rt-details-page .booking-panel, .rt-details-page .ride-info-card { padding: 20px; }
.rt-details-page .driver-card-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 17px; color: var(--rt-primary-strong); }
.rt-details-page .driver-profile { display: flex; align-items: center; gap: 12px; }
.rt-details-page .driver-profile img, .rt-details-page .driver-avatar-fallback { width: 54px; height: 54px; flex: 0 0 auto; border-radius: 17px; object-fit: cover; background: var(--rt-surface-muted); }
.rt-details-page .driver-avatar-fallback { display: grid; place-items: center; color: var(--rt-primary-strong); font-weight: 800; }
.rt-details-page .driver-profile strong, .rt-details-page .driver-profile span { display: block; }
.rt-details-page .driver-profile strong { color: var(--rt-text-strong); font-size: .9rem; }
.rt-details-page .driver-rating { display: flex !important; align-items: center; gap: 4px; margin-top: 5px; color: var(--rt-muted); font-size: .7rem; }
.rt-details-page .driver-rating svg { color: var(--rt-accent); }
.rt-details-page .vehicle-summary { display: flex; align-items: flex-start; gap: 9px; margin-top: 18px; padding: 12px; border-radius: 12px; color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
.rt-details-page .vehicle-summary > div { min-width: 0; }
.rt-details-page .vehicle-summary strong, .rt-details-page .vehicle-summary span { display: block; }
.rt-details-page .vehicle-summary strong { color: var(--rt-text); font-size: .77rem; }
.rt-details-page .vehicle-summary span { margin-top: 4px; color: var(--rt-muted); font-size: .68rem; line-height: 1.35; }
.rt-details-page .driver-bio { margin: 15px 0 0; color: var(--rt-muted); font-size: .75rem; line-height: 1.5; }
.rt-details-page .booking-panel .card-title-row { margin-bottom: 15px; }
.rt-details-page .request-list { display: grid; gap: 9px; }
.rt-details-page .request-item { display: grid; gap: 11px; padding: 12px; border: 1px solid var(--rt-border); border-radius: 13px; background: var(--rt-card); }
.rt-details-page .request-person { display: flex; align-items: center; gap: 9px; min-width: 0; }
.rt-details-page .request-avatar { width: 31px; height: 31px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 10px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); font-size: .65rem; font-weight: 800; }
.rt-details-page .request-person strong, .rt-details-page .request-person span { display: block; }
.rt-details-page .request-person strong { color: var(--rt-text); font-size: .76rem; }
.rt-details-page .request-person span { margin-top: 3px; color: var(--rt-muted); font-size: .67rem; }
.rt-details-page .request-actions { display: flex; gap: 7px; }
.rt-details-page .request-actions .btn { flex: 1; }
.rt-details-page .small-empty { display: grid; justify-items: center; padding: 16px 8px; color: var(--rt-muted); text-align: center; }
.rt-details-page .small-empty p { margin: 8px 0 0; font-size: .75rem; }
.rt-details-page .confirmed-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 14px; padding: 10px 11px; border-radius: 10px; color: var(--rt-text); background: var(--rt-surface-muted); font-size: .73rem; }
.rt-details-page .confirmed-summary span { color: var(--rt-muted); font-size: .68rem; }
.rt-details-page .driver-controls { display: grid; gap: 8px; margin-top: 16px; padding-top: 15px; border-top: 1px solid var(--rt-surface-muted); }
.rt-details-page .current-booking { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border-radius: 12px; }
.rt-details-page .current-booking > div:last-child { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.rt-details-page .current-booking .btn { margin-top: 4px; }
.rt-details-page .current-booking .control-hint { margin: 0; }
.rt-details-page .booking-pending { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-details-page .booking-payment_pending { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-details-page .booking-confirmed { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-details-page .booking-picked_up { color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-details-page .booking-completed { color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-details-page .booking-rejected { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .booking-cancelled { color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-details-page .booking-no_show { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .current-booking-icon { display: grid; place-items: center; flex: 0 0 auto; }
.rt-details-page .current-booking strong, .rt-details-page .current-booking span { display: block; }
.rt-details-page .current-booking strong { font-size: .79rem; }
.rt-details-page .current-booking span { margin-top: 4px; color: var(--rt-muted); font-size: .7rem; line-height: 1.4; }
.rt-details-page .current-booking-next { display: flex; align-items: flex-start; gap: 6px; margin: 2px 0 0; color: inherit; font-size: .7rem; line-height: 1.45; }
.rt-details-page .current-booking-next svg { flex: 0 0 auto; margin-top: 2px; }
.rt-details-page .current-booking-pickup { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: var(--rt-text); font-size: .69rem; line-height: 1.45; }
.rt-details-page .current-booking-pickup svg { flex: 0 0 auto; margin-top: 2px; color: var(--rt-primary-strong); }
.rt-details-page .request-meeting { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 7px 9px; border-radius: 9px; color: var(--rt-text); background: var(--rt-surface-subtle); font-size: .68rem; line-height: 1.4; }
.rt-details-page .request-meeting svg { flex: 0 0 auto; margin-top: 1px; color: var(--rt-primary-strong); }
.rt-details-page .live-status { display: flex; align-items: center; gap: 7px; margin: 0; padding: 9px 22px; color: var(--rt-info-text); background: var(--rt-info-soft); font-size: .71rem; font-weight: 730; }
.rt-details-page .live-status svg { flex: 0 0 auto; }
.rt-details-page .live-status--stale { color: var(--rt-text); background: var(--rt-info-soft); }
.rt-details-page .live-status--error { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .request-form { display: grid; gap: 8px; }
.rt-details-page .request-form label { color: var(--rt-text); font-size: .76rem; font-weight: 750; }
.rt-details-page .request-form select { width: 100%; min-height: 43px; padding: 8px 10px; border: 1px solid var(--rt-border); border-radius: 10px; color: var(--rt-text-strong); background: var(--rt-card); outline: none; font: inherit; font-size: .8rem; }
.rt-details-page .request-form .field-hint { margin: 0; color: var(--rt-muted); font-size: .68rem; line-height: 1.4; }
.rt-details-page .detail-list { display: grid; gap: 0; margin: 0; }
.rt-details-page .detail-list > div { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 11px 0; border-bottom: 1px solid var(--rt-surface-muted); }
.rt-details-page .detail-list > div:last-child { border-bottom: 0; }
.rt-details-page .detail-list dt { color: var(--rt-muted); font-size: .72rem; }
.rt-details-page .detail-list dd { display: flex; align-items: center; gap: 5px; max-width: 62%; margin: 0; color: var(--rt-text); font-size: .73rem; font-weight: 700; text-align: right; }
.rt-details-page .safety-note { display: flex; align-items: flex-start; gap: 10px; padding: 16px; color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
.rt-details-page .safety-note > div { min-width: 0; }
.rt-details-page .safety-note strong { display: block; color: var(--rt-text); font-size: .78rem; }
.rt-details-page .safety-note p { margin: 5px 0 7px; color: var(--rt-muted); font-size: .72rem; line-height: 1.45; }
.rt-details-page .safety-note .text-link { display: inline-flex; align-items: center; gap: 5px; color: var(--rt-primary-strong); font-size: .71rem; font-weight: 800; text-decoration: none; }
.rt-details-page .form-message { display: flex; align-items: flex-start; gap: 7px; margin: 0 0 16px; padding: 10px 11px; border-radius: 10px; font-size: .75rem; line-height: 1.45; }
.rt-details-page .error-message { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-details-page .success-message { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-details-page .form-message svg { flex: 0 0 auto; margin-top: 1px; }
.rt-details-page .page-loading-card { min-height: 300px; display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--rt-muted); }
.rt-details-page .empty-state { min-height: 300px; display: grid; place-items: center; padding: 30px; text-align: center; }
.rt-details-page .empty-state h1 { margin: 16px 0 7px; color: var(--rt-text-strong); font-size: 1.45rem; }
.rt-details-page .empty-state p { max-width: 390px; margin: 0 0 19px; color: var(--rt-muted); font-size: .82rem; line-height: 1.5; }
@keyframes rt-details-spin { to { transform: rotate(360deg); } }
@media (max-width: 960px) {
  .rt-details-page .ride-details-layout { grid-template-columns: 1fr; }
  .rt-details-page .ride-details-side { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
  .rt-details-page .booking-panel { grid-row: span 2; }
  .rt-details-page .safety-note { grid-column: 1 / -1; }
}
@media (max-width: 620px) {
  .rt-details-page .container { width: min(100% - 28px, 1180px); }
  .rt-details-page .page-container { padding: 20px 0 45px; }
  .rt-details-page .page-header { display: block; }
  .rt-details-page .page-header__actions { margin-top: 15px; }
  .rt-details-page .page-header__actions .btn { width: 100%; }
  .rt-details-page .map-wrap, .rt-details-page .map-wrap-tall, .rt-details-page .ride-map { min-height: 300px; height: 300px; }
  .rt-details-page .route-facts { grid-template-columns: 1fr; }
  .rt-details-page .route-facts > div { padding: 12px 15px; }
  .rt-details-page .ride-details-side { grid-template-columns: 1fr; }
  .rt-details-page .booking-panel { grid-row: auto; }
  /* On a phone the CTA becomes a bottom bar. The cap keeps a driver's whole
     request queue from swallowing the screen, and the extra page padding stops
     the bar from permanently covering the last card. */
  .rt-details-page .booking-panel { bottom: 0; z-index: 20; max-height: 68vh; overflow-y: auto; border-radius: 21px 21px 0 0; box-shadow: 0 -10px 32px rgba(20,50,30,.18); }
  .rt-details-page .page-container { padding-bottom: 88px; }
  .rt-details-page .safety-note { grid-column: auto; }
  .rt-details-page .trip-route-card, .rt-details-page .rating-card, .rt-details-page .driver-card, .rt-details-page .booking-panel, .rt-details-page .ride-info-card { padding: 17px; }
}
`;

export default function RideDetailsPage() {
  const { rideId } = useParams<{ rideId: string }>();
  const {
    loading,
    activeUserId,
    users,
    vehicles,
    rides,
    bookings,
    ratings,
    payments,
    requestBooking,
    acceptBooking,
    rejectBooking,
    markPickedUp,
    markNoShow,
    cancelBooking,
    cancelRide,
    startRide,
    completeRide,
    payBooking,
    resolvePayment,
    submitRating,
  } = useApp();
  const ride = rides.find((item) => item.id === rideId);
  const driver = users.find((user) => user.id === ride?.driverId);
  const vehicle = vehicles.find((item) => item.id === ride?.vehicleId);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeRefresh, setRouteRefresh] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [requestSeats, setRequestSeats] = useState(1);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingTargetId, setRatingTargetId] = useState("");
  const [ratingComment, setRatingComment] = useState("");
  const [ratingError, setRatingError] = useState("");
  const [ratingSuccess, setRatingSuccess] = useState("");

  const waypointKey = ride
    ? ride.waypoints.map((waypoint) => `${waypoint.lat},${waypoint.lon}`).join("|")
    : "";
  const routeKey = ride
    ? `${ride.id}-${ride.origin.lat}-${ride.origin.lon}-${ride.destination.lat}-${ride.destination.lon}-${waypointKey}`
    : "missing";

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!ride) {
      setRoute(null);
      setRouteError("");
      setRouteLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setRoute(null);
    setRouteError("");
    setRouteLoading(true);
    getRoute(ride.origin, ride.destination, ride.waypoints, { signal: controller.signal })
      .then((result) => {
        if (active) setRoute(result);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof Error && error.name === "AbortError")) {
          setRouteError(errorMessage(error, "We could not refresh this route. Please try again."));
        }
      })
      .finally(() => {
        if (active) setRouteLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [routeKey, routeRefresh]);

  const rideBookings = useMemo(
    () => bookings.filter((booking) => booking.rideId === ride?.id),
    [bookings, ride?.id],
  );
   const pendingBookings = rideBookings.filter((booking) => booking.status === "pending");
   const payingBookings = rideBookings.filter((booking) => booking.status === "payment_pending");
   const confirmedBookings = rideBookings.filter((booking) => booking.status === "confirmed");
   const onBoardBookings = rideBookings.filter((booking) => booking.status === "picked_up");
   /**
    * Who took part. A request that was declined, cancelled or never collected
    * did not share the car, so it is not reviewable - and the database enforces
    * the same rule, so a client that disagrees simply fails to save.
    */
   const reviewableBookings = rideBookings.filter(
     (booking) => booking.status === "picked_up" || booking.status === "completed",
   );
   const currentBooking = [...rideBookings]
     .filter((booking) => booking.riderId === activeUserId)
     .sort((first, second) => {
       const firstTime = new Date(first.updatedAt || first.createdAt).getTime();
       const secondTime = new Date(second.updatedAt || second.createdAt).getTime();
       return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0);
     })[0];
  const departureTimestamp = ride
    ? new Date(ride.departureDate.includes("T") ? ride.departureDate : `${ride.departureDate}T${ride.departureTime || "00:00"}`).getTime()
    : Number.NaN;
  const hasValidDeparture = Number.isFinite(departureTimestamp);
  const hasDeparted = hasValidDeparture && departureTimestamp <= currentTime;
  const isDriver = Boolean(ride && activeUserId === ride.driverId);
  const isRunning = ride?.status === "in_progress";
  /**
   * Which host controls are meaningful right now, derived from the ride's own state
   * rather than from the booking's.
   *
   * The roster is the same list whatever the ride is doing, so without this a host
   * could still be offered "Accept" and "Mark received" for a trip that has already
   * left or finished. The database now refuses those writes, which turned a stale
   * button into an error instead of an action - correct, but a bad experience, and
   * on a completed ride the rows are closed by the ride itself so the counts here
   * would not match what the buttons acted on.
   */
  const canHostRequests = Boolean(ride && ride.status === "active");
  /**
   * A payment the rider has already opened still has to be resolvable once the car
   * is moving: the seat has been held since acceptance, and holding a seat the
   * host can never settle is worse than one that is briefly in the air. Once the
   * ride is closed the database closes the booking and the placeholder itself, so
   * there is nothing left to resolve.
   */
  const canHostPayments = Boolean(ride && isLiveRide(ride.status));
  /**
   * The payment row for a booking, if one exists. Read from the payments already
   * loaded in context rather than fetched, so the realtime subscription keeps it
   * current without another request.
   */
  const paymentForBooking = useMemo(() => {
    const byBooking = new Map(payments.map((payment) => [payment.bookingId, payment]));
    return (bookingId: string) => byBooking.get(bookingId);
  }, [payments]);
  /**
   * Whether this rider can open a fresh request on this ride.
   *
   * A request that was declined or cancelled does not block a new one - a rider
   * turned away by one host should still be able to ask again while the car is
   * running. A seat that is merely waiting on a decision does block it, so that a
   * rider who taps twice does not create a duplicate request for the host to
   * answer twice.
   */
  const rideIsOpen = Boolean(
    ride
      && !isDriver
      && ride.status === "active"
      && ride.availableSeats > 0
      && hasValidDeparture
      && !hasDeparted,
  );
  const canRequest = rideIsOpen && (
    !currentBooking
    || currentBooking.status === "rejected"
    || currentBooking.status === "cancelled"
  );
   /**
    * A trip can only be finished from the running state: the host presses Start
    * when they set off, and End when they arrive. Anything still uncollected at
    * that point is settled as a no-show by the database, so the host is not asked
    * to resolve a passenger one by one at the roadside.
    */
    const canStart = Boolean(isDriver && ride?.status === "active" && ride.availableSeats >= 0);
    const canComplete = Boolean(isDriver && ride?.status === "in_progress");
   /**
    * Chat is a shared space for people who are actually travelling together, so
    * it is keyed on a booking that has not been walked away from. Without the
    * status check a declined or cancelled request still left the Chat button on
    * the page, and the link led somewhere the row-level security then refuses.
    */
   const hasChatAccess = isDriver || Boolean(
     currentBooking
     && (ACTIVE_BOOKING_STATUSES.includes(currentBooking.status) || currentBooking.status === "completed"),
   );
   /**
    * Only the host publishes a position, and only while the trip is running.
    * Passengers read it, so the hook is active for them too - it is the
    * subscription that fills the map, not the write.
    */
   const live = useRideLocation({
     rideId: ride?.id ?? "",
     share: isDriver,
     isRunning: ride?.status === "in_progress",
   });
   const liveLocation = live.location;
   const isConfirmedRider = currentBooking?.status === "confirmed" || currentBooking?.status === "completed";
   const reviewTargets = isDriver
     ? reviewableBookings
         .map((booking) => users.find((user) => user.id === booking.riderId))
         .filter((user): user is NonNullable<typeof user> => Boolean(user))
     : isConfirmedRider && driver
       ? [driver]
       : [];
  const reviewTarget = reviewTargets.find((user) => user.id === ratingTargetId) ?? reviewTargets[0];
  const existingRating = ratings.find(
    (rating) =>
      rating.rideId === ride?.id &&
      rating.reviewerId === activeUserId &&
      rating.revieweeId === reviewTarget?.id,
  );
  const canRate = Boolean(ride?.status === "completed" && reviewTarget && !existingRating);

  useEffect(() => {
    setRatingTargetId(reviewTargets[0]?.id ?? "");
    setRatingValue(0);
    setRatingComment("");
    setRatingError("");
    setRatingSuccess("");
    setActionError("");
    setActionSuccess("");
  }, [ride?.id, activeUserId]);

  useEffect(() => {
    setRequestSeats((current) => {
      const safeCurrent = Number.isInteger(current) ? current : 1;
      return Math.min(Math.max(1, safeCurrent), Math.max(1, ride?.availableSeats ?? 1));
    });
  }, [ride?.id, ride?.availableSeats]);

  const handleRequest = async () => {
    if (!ride || !canRequest || actionLoading) return;
    if (!Number.isInteger(requestSeats) || requestSeats < 1 || requestSeats > ride.availableSeats) {
      setActionError(
        ride.availableSeats < 1
          ? "There are no seats available on this ride."
          : `Choose between 1 and ${ride.availableSeats} seats.`,
      );
      return;
    }
    setActionError("");
    setActionSuccess("");
    setActionLoading("request");
    try {
      await requestBooking(ride.id, requestSeats);
      setActionSuccess(
        `Seat request sent for ${requestSeats} ${requestSeats === 1 ? "seat" : "seats"}. `
        + "The driver has been notified and will confirm or decline.",
      );
    } catch (error: unknown) {
      setActionError(errorMessage(error, "We could not send your seat request."));
    } finally {
      setActionLoading("");
    }
  };

  /**
   * One entry point for every booking-state change on this page.
   *
   * Each of these has exactly one legal transition and one person allowed to
   * perform it, and the database checks both. Keeping them behind a single
   * helper means the button, the spinner key, the success copy and the error
   * copy cannot drift apart per action.
   */
  const runBookingAction = async (
    booking: Booking,
    action: "accept" | "reject" | "pickup" | "no-show" | "cancel" | "pay" | "paid" | "unpaid",
    success: string,
    fallback: string,
  ) => {
    if (actionLoading) return;
    setActionError("");
    setActionSuccess("");
    setActionLoading(`${booking.id}:${action}`);
    try {
      switch (action) {
        case "accept":
          await acceptBooking(booking.id);
          break;
        case "reject":
          await rejectBooking(booking.id);
          break;
        case "pickup":
          await markPickedUp(booking.id);
          break;
        case "no-show":
          await markNoShow(booking.id);
          break;
        case "cancel":
          await cancelBooking(booking.id);
          break;
        case "pay":
          await payBooking(booking.id);
          break;
        case "paid":
          await resolvePayment(booking.id, "success");
          break;
        case "unpaid":
          await resolvePayment(booking.id, "failed", "The driver did not receive this payment.");
          break;
        default:
          return;
      }
      setActionSuccess(success);
    } catch (error: unknown) {
      setActionError(errorMessage(error, fallback));
    } finally {
      setActionLoading("");
    }
  };

  const runRideAction = async (
    action: "start" | "complete" | "cancel",
    success: string,
    fallback: string,
    confirm?: string,
  ) => {
    if (!ride || actionLoading) return;
    if (confirm && !window.confirm(confirm)) return;
    setActionError("");
    setActionSuccess("");
    setActionLoading(action);
    try {
      if (action === "start") await startRide(ride.id);
      else if (action === "complete") await completeRide(ride.id);
      else await cancelRide(ride.id);
      setActionSuccess(success);
    } catch (error: unknown) {
      setActionError(errorMessage(error, fallback));
    } finally {
      setActionLoading("");
    }
  };

  const handleRatingSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ride || !canRate || !reviewTarget || ratingValue < 1) {
      setRatingError("Choose a star rating before submitting.");
      return;
    }
    setRatingError("");
    setRatingSuccess("");
    setActionLoading("rating");
    try {
      await submitRating(ride.id, reviewTarget.id, ratingValue, ratingComment.trim());
      setRatingSuccess("Thanks for helping the community travel better.");
    } catch (error: unknown) {
      setRatingError(errorMessage(error, "We could not save your rating."));
    } finally {
      setActionLoading("");
    }
  };

  if (loading) {
    return (
      <main className="rt-details-page page ride-details-page">
        <style>{rideDetailsStyles}</style>
        <div className="container page-container">
          <div className="page-loading-card card"><LoaderCircle className="spin" size={24} /> Loading ride details…</div>
        </div>
      </main>
    );
  }

  if (!ride) {
    return (
      <main className="rt-details-page page ride-details-page">
        <style>{rideDetailsStyles}</style>
        <div className="container page-container">
          <div className="card empty-state">
            <div className="empty-icon"><MapPin size={30} /></div>
            <h1>Ride not found</h1>
            <p>This ride may have been removed or the link is no longer available.</p>
            <Link className="btn btn-primary" to="/find"><ArrowLeft size={17} /> Back to find a ride</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="rt-details-page page ride-details-page">
      <style>{rideDetailsStyles}</style>
      <div className="container page-container">
        <div className="back-row">
          <Link className="back-link" to="/find"><ArrowLeft size={17} /> Back to rides</Link>
          <RideStatusBadge status={ride.status} />
        </div>
        <PageHeader
          eyebrow="Ride details"
          title={`${ride.origin.label.split(",")[0]} to ${ride.destination.label.split(",")[0]}`}
          description={formatDeparture(ride.departureDate, ride.departureTime)}
           actions={hasChatAccess || (isDriver && ride.status === "active") ? (
             <div className="page-header__actions">
               {isDriver && ride.status === "active" ? (
                 <Link className="btn btn-outline" to={`/offer/${ride.id}/edit`}>
                   <Edit3 size={17} /> Edit ride
                 </Link>
               ) : null}
               {hasChatAccess ? (
                 <Link className="btn btn-outline" to={`/chat/${ride.id}`}>
                   <MessageCircle size={17} /> Open chat
                 </Link>
               ) : null}
             </div>
           ) : undefined}
        />

        {actionError && <p className="form-message error-message" role="alert"><AlertCircle size={16} />{actionError}</p>}
        {actionSuccess && <p className="form-message success-message" role="status"><CheckCircle2 size={16} />{actionSuccess}</p>}

        <div className="ride-details-layout">
          <div className="ride-details-main">
            <section className="card details-map-card">
              <div className="map-panel-header">
                <div><span className="section-kicker">Live route</span><h2>Trip map</h2></div>
                <button className="icon-button" type="button" onClick={() => setRouteRefresh((value) => value + 1)} disabled={routeLoading} aria-label="Refresh route" title="Refresh route">
                  <RefreshCw size={17} />
                </button>
              </div>
              <div className="map-wrap map-wrap-tall">
                <RideMap
                  origin={ride.origin}
                  destination={ride.destination}
                  waypoints={ride.waypoints}
                  route={route?.geometry}
                  liveLocation={liveLocation
                    ? { lat: liveLocation.lat, lon: liveLocation.lon, heading: liveLocation.heading, stale: live.isStale }
                    : null}
                />
                {routeLoading && <div className="map-overlay"><LoaderCircle className="spin" size={23} /> Refreshing your real route…</div>}
              </div>
              {liveLocation ? (
                <p className={`live-status${live.isStale ? " live-status--stale" : ""}`}>
                  <Navigation size={14} />
                  {live.isStale
                    ? `Driver's last position was ${live.ageSeconds}s ago.`
                    : "Showing the driver's live position."}
                </p>
              ) : null}
              {isRunning && live.error ? <p className="live-status live-status--error" role="alert"><AlertCircle size={14} />{live.error}</p> : null}
              {routeError && <div className="map-error" role="alert"><AlertCircle size={17} /><span>{routeError} The map and ride markers remain available.</span></div>}
              <div className="route-facts">
                <div><RouteIcon size={18} /><span><strong>{route?.distanceKm !== undefined ? `${route.distanceKm.toFixed(1)} km` : ride.distanceKm !== undefined ? `${ride.distanceKm.toFixed(1)} km` : "Distance pending"}</strong><small>Distance</small></span></div>
                <div><Clock3 size={18} /><span><strong>{formatDuration(route?.durationMinutes ?? ride.durationMinutes)}</strong><small>Estimated time</small></span></div>
                <div><Users size={18} /><span><strong>{ride.availableSeats} available</strong><small>of {ride.totalSeats} seats</small></span></div>
              </div>
            </section>

            <section className="card trip-route-card">
              <div className="card-title-row"><div><span className="section-kicker">The journey</span><h2>Pickup and drop-off</h2></div><RouteIcon size={20} /></div>
              <div className="detail-route-list">
                <div className="detail-route-item"><span className="detail-route-marker marker-origin">A</span><div><small>Pickup</small><strong>{ride.origin.label}</strong></div></div>
                {ride.waypoints.map((stop: Coordinates, index) => <div className="detail-route-item" key={`${stop.lat}-${stop.lon}-${index}`}><span className="detail-route-marker marker-stop">{index + 1}</span><div><small>Stop {index + 1}</small><strong>{stop.label}</strong></div></div>)}
                <div className="detail-route-item"><span className="detail-route-marker marker-destination">B</span><div><small>Drop-off</small><strong>{ride.destination.label}</strong></div></div>
              </div>
            </section>

            {ride.status === "completed" && (
              <section className="card rating-card">
                <div className="card-title-row"><div><span className="section-kicker">After your trip</span><h2>Share your experience</h2></div><Star size={20} /></div>
                {reviewTargets.length > 1 ? (
                  <label className="rating-target-field">
                    <span>Rate</span>
                    <select value={reviewTarget?.id ?? ""} onChange={(event) => { setRatingTargetId(event.target.value); setRatingValue(0); setRatingComment(""); setRatingError(""); setRatingSuccess(""); }}>
                      {reviewTargets.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                  </label>
                ) : null}
                {existingRating ? (
                  <div className="rating-complete"><CheckCircle2 size={20} /><div><strong>You rated {reviewTarget?.name} {existingRating.stars} out of 5</strong><p>{existingRating.comment || "Thanks for sharing your feedback."}</p></div></div>
                ) : canRate ? (
                  <form className="rating-form" onSubmit={handleRatingSubmit}>
                    <p>How was your ride with {reviewTarget?.name}?</p>
                    <Stars value={ratingValue} onChange={setRatingValue} size="large" label="Rate your ride" />
                    <textarea value={ratingComment} onChange={(event) => setRatingComment(event.target.value)} placeholder="Add an optional comment" maxLength={500} rows={4} />
                    {ratingError && <p className="form-message error-message"><AlertCircle size={15} />{ratingError}</p>}
                    {ratingSuccess && <p className="form-message success-message"><Check size={15} />{ratingSuccess}</p>}
                    <button className="btn btn-primary" type="submit" disabled={actionLoading === "rating"}>{actionLoading === "rating" ? <LoaderCircle className="spin" size={17} /> : <Star size={17} />} Submit rating</button>
                  </form>
                ) : (
                  <p className="muted-copy">Ratings are available to confirmed ride participants after this trip is completed.</p>
                )}
              </section>
            )}
          </div>

          <aside className="ride-details-side">
            <section className="card driver-card">
              <div className="driver-card-heading"><span className="section-kicker">{isDriver ? "Your ride" : "Your driver"}</span><ShieldCheck size={20} /></div>
              {driver ? (
                <div className="driver-profile">
                  {driver.avatar ? <img src={driver.avatar} alt="" /> : <span className="driver-avatar-fallback">{initials(driver.name)}</span>}
                  <div><strong>{driver.name}</strong><span className="driver-rating"><Star size={14} fill="currentColor" /> {driver.rating.toFixed(1)} · {driver.tripCount} trips</span></div>
                </div>
              ) : <p className="muted-copy">Driver information is unavailable.</p>}
              {vehicle && <div className="vehicle-summary"><CarFront size={18} /><div><strong>{vehicle.name}</strong><span>{vehicle.color} {vehicle.make} {vehicle.model} · {vehicle.plate}</span></div></div>}
              {driver?.bio && <p className="driver-bio">{driver.bio}</p>}
            </section>

            <section className="card booking-panel">
              <div className="card-title-row"><div><span className="section-kicker">Seats</span><h2>{isDriver ? "Manage requests" : "Your booking"}</h2></div><Users size={20} /></div>
              {isDriver ? (
                <>
                  {pendingBookings.length > 0 ? (
                    <div className="request-list">
                      {pendingBookings.map((booking) => {
                        const rider = users.find((user) => user.id === booking.riderId);
                        // Accepting holds the seat immediately, so a full car cannot
                        // be over-committed between this check and the write.
                        const canAccept = canHostRequests && booking.seats <= ride.availableSeats;
                        const busy = Boolean(actionLoading);
                        const acceptReason = !canHostRequests
                          ? "This ride is no longer taking requests."
                          : booking.seats > ride.availableSeats
                            ? "There are not enough seats available."
                            : undefined;
                        return (
                          <div className="request-item" key={booking.id}>
                            <div className="request-person">
                              <span className="request-avatar">{rider ? initials(rider.name) : "?"}</span>
                              <div>
                                <strong>{rider?.name ?? "Community rider"}</strong>
                                <span>{booking.seats} {booking.seats === 1 ? "seat" : "seats"} requested</span>
                              </div>
                            </div>
                            {booking.pickup ? (
                              <p className="request-meeting">
                                <MapPin size={13} />
                                {booking.pickup.label}
                                {typeof booking.pickup.walkDistanceKm === "number" && booking.pickup.walkDistanceKm > 0
                                  ? ` · ${booking.pickup.walkDistanceKm} km walk`
                                  : ""}
                                {typeof booking.pickup.detourKm === "number" && booking.pickup.detourKm > 0
                                  ? ` · adds ${booking.pickup.detourKm} km`
                                  : ""}
                              </p>
                            ) : null}
                            <div className="request-actions">
                              <button
                                className="btn btn-primary btn-small"
                                type="button"
                                disabled={busy || !canAccept}
                                title={acceptReason ?? "Accept and hold this seat"}
                                onClick={() => void runBookingAction(
                                  booking,
                                  "accept",
                                  `Seat held for ${rider?.name ?? "the rider"}. They have been asked to pay.`,
                                  "We could not accept that request.",
                                )}
                              >
                                {actionLoading === `${booking.id}:accept` ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Accept
                              </button>
                              <button
                                className="btn btn-ghost btn-small danger-text"
                                type="button"
                                disabled={busy || !canHostRequests}
                                title={canHostRequests ? "Decline this request" : "This ride is no longer taking requests."}
                                onClick={() => void runBookingAction(
                                  booking,
                                  "reject",
                                  "Request declined and the rider has been told.",
                                  "We could not decline that request.",
                                )}
                              >
                                {actionLoading === `${booking.id}:reject` ? <LoaderCircle className="spin" size={14} /> : <X size={14} />} Decline
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {canHostRequests ? null : (
                        <p className="control-hint">
                          This ride is {ride.status === "in_progress" ? "on the road" : "closed"}, so these requests can no longer be accepted or declined.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="small-empty"><Users size={20} /><p>No pending requests right now.</p></div>
                  )}

                  {payingBookings.length > 0 ? (
                    <div className="request-list">
                      {payingBookings.map((booking) => {
                        const rider = users.find((user) => user.id === booking.riderId);
                        const payment = paymentForBooking(booking.id);
                        const opened = Boolean(payment);
                        return (
                          <div className="request-item" key={booking.id}>
                            <div className="request-person">
                              <span className="request-avatar">{rider ? initials(rider.name) : "?"}</span>
                              <div>
                                <strong>{rider?.name ?? "Community rider"}</strong>
                                <span>
                                  {opened
                                    ? `Payment open for ${formatRupees(booking.fareAmount ?? 0)} - confirm it when the money arrives`
                                    : `Seat held for ${formatRupees(booking.fareAmount ?? 0)} - not paid yet`}
                                </span>
                              </div>
                            </div>
                            {canHostPayments ? (
                              <div className="request-actions">
                                <button
                                  className="btn btn-primary btn-small"
                                  type="button"
                                  title={opened
                                    ? "Confirm the payment and their seat"
                                    : "No payment was opened for this seat, so there is nothing to confirm yet."}
                                  disabled={Boolean(actionLoading) || !opened}
                                  onClick={() => void runBookingAction(
                                    booking,
                                    "paid",
                                    "Payment recorded and the seat is confirmed.",
                                    "We could not record that payment.",
                                  )}
                                >
                                  {actionLoading === `${booking.id}:paid` ? <LoaderCircle className="spin" size={14} /> : <Wallet size={14} />} Mark received
                                </button>
                                <button
                                  className="btn btn-ghost btn-small danger-text"
                                  type="button"
                                  disabled={Boolean(actionLoading)}
                                  title={opened
                                    ? "Release the seat and mark the payment as not received"
                                    : "Release the seat this rider is holding without paying"}
                                  onClick={() => void runBookingAction(
                                    booking,
                                    "unpaid",
                                    "Marked as not received. The seat is back on offer.",
                                    "We could not release that seat.",
                                  )}
                                >
                                  {actionLoading === `${booking.id}:unpaid` ? <LoaderCircle className="spin" size={14} /> : <X size={14} />} Not received
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      <p className="control-hint">{PAYMENT_DISCLAIMER}</p>
                    </div>
                  ) : null}

                  {confirmedBookings.length > 0 ? (
                    <div className="request-list">
                      {confirmedBookings.map((booking) => {
                        const rider = users.find((user) => user.id === booking.riderId);
                        return (
                          <div className="request-item" key={booking.id}>
                            <div className="request-person">
                              <span className="request-avatar">{rider ? initials(rider.name) : "?"}</span>
                              <div>
                                <strong>{rider?.name ?? "Community rider"}</strong>
                                <span>
                                  {booking.seats} {booking.seats === 1 ? "seat" : "seats"} confirmed
                                  {isRunning ? " · waiting to be collected" : ""}
                                </span>
                              </div>
                            </div>
                            {isRunning ? (
                              <div className="request-actions">
                                <button
                                  className="btn btn-primary btn-small"
                                  type="button"
                                  disabled={Boolean(actionLoading)}
                                  onClick={() => void runBookingAction(
                                    booking,
                                    "pickup",
                                    `${rider?.name ?? "The rider"} is marked as on board.`,
                                    "We could not mark that passenger as on board.",
                                  )}
                                >
                                  {actionLoading === `${booking.id}:pickup` ? <LoaderCircle className="spin" size={14} /> : <UserCheck size={14} />} On board
                                </button>
                                <button
                                  className="btn btn-ghost btn-small danger-text"
                                  type="button"
                                  disabled={Boolean(actionLoading)}
                                  onClick={() => void runBookingAction(
                                    booking,
                                    "no-show",
                                    "Marked as a no-show and the seat is free again.",
                                    "We could not mark that passenger as a no-show.",
                                  )}
                                >
                                  {actionLoading === `${booking.id}:no-show` ? <LoaderCircle className="spin" size={14} /> : <UserX size={14} />} No-show
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {onBoardBookings.length > 0 && (
                    <div className="confirmed-summary">
                      <strong>{onBoardBookings.reduce((total, booking) => total + booking.seats, 0)} seats on board</strong>
                      <span>across {onBoardBookings.length} {onBoardBookings.length === 1 ? "rider" : "riders"}</span>
                    </div>
                  )}
                  {confirmedBookings.length > 0 && (
                    <div className="confirmed-summary">
                      <strong>{confirmedBookings.reduce((total, booking) => total + booking.seats, 0)} seats confirmed</strong>
                      <span>across {confirmedBookings.length} {confirmedBookings.length === 1 ? "rider" : "riders"}</span>
                    </div>
                  )}
                  <div className="driver-controls">
                    {canStart && (
                      <button
                        className="btn btn-primary btn-block"
                        type="button"
                        onClick={() => void runRideAction(
                          "start",
                          "Trip started. No new passengers can join.",
                          "We could not start this trip.",
                        )}
                        disabled={Boolean(actionLoading)}
                      >
                        {actionLoading === "start" ? <LoaderCircle className="spin" size={17} /> : <PlayCircle size={17} />}
                        {actionLoading === "start" ? "Starting…" : "Start trip"}
                      </button>
                    )}
                    {canComplete && (
                      <button className="btn btn-primary btn-block" type="button" onClick={() => void runRideAction(
                        "complete",
                        "Trip completed. Anyone not collected has been recorded as a no-show, and participants can rate the journey.",
                        "We could not complete this trip.",
                        "End this trip? Passengers you did not collect will be recorded as no-shows.",
                      )} disabled={Boolean(actionLoading)}>
                        {actionLoading === "complete" ? <LoaderCircle className="spin" size={17} /> : <Flag size={17} />}
                        {actionLoading === "complete" ? "Ending trip…" : "End trip"}
                      </button>
                    )}
                    {ride.status === "active" && <p className="control-hint">Starting the trip closes the seats. Ending it settles who travelled.</p>}
                    {isLiveRide(ride.status) && <button className="btn btn-outline btn-block danger-button" type="button" onClick={() => void runRideAction(
                      "cancel",
                      "The ride has been cancelled and everyone booked on it has been notified.",
                      "We could not cancel this ride.",
                      "Cancel this ride for everyone? Held seats are returned.",
                    )} disabled={Boolean(actionLoading)}>{actionLoading === "cancel" ? <LoaderCircle className="spin" size={17} /> : <X size={17} />} Cancel ride</button>}
                  </div>
                </>
               ) : currentBooking ? (
                 <>
                   <CurrentBookingPanel
                     booking={currentBooking}
                     isDriver={false}
                     paymentOpened={Boolean(paymentForBooking(currentBooking.id))}
                     actionLoading={actionLoading}
                     onAction={(action, success, fallback) => void runBookingAction(currentBooking, action, success, fallback)}
                   />
                   {/* A declined or cancelled request does not end the rider's
                       interest in the ride, so the form stays available underneath
                       the outcome. Every other state blocks a second request, and
                       `canRequest` already says so. */}
                   {canRequest ? (
                     <div className="request-form" data-testid="request-form" style={{ marginTop: 16 }}>
                       <label htmlFor="detail-request-seats">Ask again for</label>
                       <select
                         id="detail-request-seats"
                         data-testid="request-seats"
                         value={requestSeats}
                         onChange={(event) => setRequestSeats(Number(event.target.value))}
                       >
                         {Array.from({ length: Math.max(1, ride.availableSeats) }, (_, index) => index + 1).map((value) => (
                           <option key={value} value={value}>{value} {value === 1 ? "seat" : "seats"}</option>
                         ))}
                       </select>
                       <button
                         className="btn btn-primary btn-block"
                         type="button"
                         data-testid="request-seat"
                         onClick={handleRequest}
                         disabled={Boolean(actionLoading) || !canRequest}
                       >
                         {actionLoading === "request" ? <LoaderCircle className="spin" size={17} /> : <Users size={17} />}
                         Request {requestSeats} {requestSeats === 1 ? "seat" : "seats"}
                       </button>
                       <p className="field-hint">The driver will review this request before confirming.</p>
                     </div>
                   ) : null}
                 </>
              ) : !activeUserId ? (
                <p className="muted-copy">Sign in to request a seat on this ride.</p>
              ) : ride.status !== "active" ? (
                <p className="muted-copy">This ride is no longer accepting requests.</p>
              ) : !hasValidDeparture ? (
                <p className="muted-copy">This ride has no valid departure time, so requests are closed.</p>
              ) : hasDeparted ? (
                <p className="muted-copy">This ride has already departed and no longer accepts requests.</p>
              ) : ride.availableSeats < 1 ? (
                <p className="muted-copy">There are no seats available for this ride.</p>
              ) : (
                <div className="request-form" data-testid="request-form"><label htmlFor="detail-request-seats">Number of seats</label><select id="detail-request-seats" data-testid="request-seats" value={requestSeats} onChange={(event) => setRequestSeats(Number(event.target.value))}>{Array.from({ length: Math.max(1, ride.availableSeats) }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} {value === 1 ? "seat" : "seats"}</option>)}</select><button className="btn btn-primary btn-block" type="button" data-testid="request-seat" onClick={handleRequest} disabled={Boolean(actionLoading) || !canRequest}>{actionLoading === "request" ? <LoaderCircle className="spin" size={17} /> : <Users size={17} />} Request {requestSeats} {requestSeats === 1 ? "seat" : "seats"}</button><p className="field-hint">The driver will review your request before confirming.</p></div>
              )}
            </section>

            <section className="card ride-info-card">
              <div className="card-title-row"><div><span className="section-kicker">Trip details</span><h2>At a glance</h2></div><CalendarDays size={20} /></div>
              <dl className="detail-list"><div><dt>Departure</dt><dd>{formatDeparture(ride.departureDate, ride.departureTime)}</dd></div><div><dt>Contribution</dt><dd><WalletCards size={15} /> {formatRupees(ride.contribution)} / seat</dd></div><div><dt>Seats</dt><dd>{ride.availableSeats} open · {ride.totalSeats} total</dd></div><div><dt>Created</dt><dd>{new Date(ride.createdAt).toLocaleDateString()}</dd></div></dl>
            </section>

            <section className="card safety-note"><ShieldCheck size={19} /><div><strong>Travel safely</strong><p>Keep conversations in RideTogether chat and review safety guidance before every trip.</p><Link className="text-link" to="/safety">Open safety center <ArrowLeft size={14} /></Link></div></section>
          </aside>
        </div>
      </div>
    </main>
  );
}
