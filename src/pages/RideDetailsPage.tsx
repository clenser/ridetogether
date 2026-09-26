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
  actionLoading,
  onAction,
}: {
  booking: Booking;
  isDriver: boolean;
  actionLoading: string;
  onAction: (action: BookingAction, success: string, fallback: string) => void;
}) {
  const { Icon } = BOOKING_STATUS_META[booking.status];
  const nextStep = nextStepFor(booking.status, isDriver);
  const busy = Boolean(actionLoading);
  const canPay = booking.status === "payment_pending";
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
.rt-details-page { min-height: 100%; color: #17231c; background: #f7fbf8; }
.rt-details-page .container { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
.rt-details-page .page-container { padding: 27px 0 66px; }
.rt-details-page h1, .rt-details-page h2, .rt-details-page h3, .rt-details-page p { margin-top: 0; }
.rt-details-page .card { border: 1px solid #dbe8de; border-radius: 21px; background: #fff; box-shadow: 0 13px 34px rgba(32,75,45,.07); }
.rt-details-page .spin { animation: rt-details-spin .8s linear infinite; }
.rt-details-page .empty-icon { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; color: #148642; background: #e1f5e7; }
.rt-details-page .back-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 19px; }
.rt-details-page .back-link { display: inline-flex; align-items: center; gap: 7px; color: #147b3d; font-size: .78rem; font-weight: 780; text-decoration: none; }
.rt-details-page .back-link:hover { color: #0d5f2e; }
.rt-details-page .status-badge { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; color: #14723a; background: #e2f5e8; font-size: .68rem; font-weight: 800; text-transform: capitalize; }
.rt-details-page .status-completed { color: #53665a; background: #edf1ee; }
.rt-details-page .status-cancelled { color: #a33d3d; background: #ffeded; }
.rt-details-page .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.rt-details-page .page-header__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.rt-details-page .page-header__eyebrow { color: #148642; font-size: .72rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-details-page .page-header h1 { margin: 8px 0 7px; color: #183c25; font-size: clamp(1.75rem, 3vw, 2.45rem); letter-spacing: -.05em; }
.rt-details-page .page-header__description { color: #6e7e74; font-size: .89rem; }
.rt-details-page .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid transparent; border-radius: 11px; font: inherit; font-size: .81rem; font-weight: 780; text-decoration: none; cursor: pointer; }
.rt-details-page .btn-primary { color: #fff; background: #159447; box-shadow: 0 8px 18px rgba(21,148,71,.18); }
.rt-details-page .btn-primary:hover:not(:disabled) { background: #10813b; }
.rt-details-page .btn-outline { border-color: #c4ddcb; color: #14763c; background: #f7fcf8; }
.rt-details-page .btn-outline:hover:not(:disabled) { border-color: #8ec9a0; background: #eef9f1; }
.rt-details-page .btn-ghost { border-color: #efd1d1; color: #a23d3d; background: #fff8f8; }
.rt-details-page .btn:disabled { opacity: .52; cursor: not-allowed; box-shadow: none; }
.rt-details-page .btn-block { width: 100%; }
.rt-details-page .btn-small { min-height: 34px; padding: 0 9px; font-size: .7rem; }
.rt-details-page .danger-button { border-color: #edcaca; color: #a23d3d; background: #fff8f8; }
.rt-details-page .danger-text { white-space: nowrap; }
.rt-details-page .icon-button { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid #d8e4da; border-radius: 10px; color: #65766c; background: #fff; cursor: pointer; }
 .rt-details-page .icon-button:hover { color: #148642; background: #eff9f2; }
 .rt-details-page .icon-button:disabled { opacity: .55; cursor: wait; }
 .rt-details-page .control-hint { margin: 0; color: #849189; font-size: .68rem; line-height: 1.4; }
.rt-details-page .ride-details-layout { display: grid; grid-template-columns: minmax(0, 1.23fr) minmax(315px, .77fr); gap: 20px; align-items: start; }
.rt-details-page .ride-details-main, .rt-details-page .ride-details-side { display: grid; gap: 17px; min-width: 0; }
.rt-details-page .details-map-card, .rt-details-page .trip-route-card, .rt-details-page .rating-card, .rt-details-page .driver-card, .rt-details-page .booking-panel, .rt-details-page .ride-info-card, .rt-details-page .safety-note { overflow: hidden; }
.rt-details-page .map-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 20px 21px 15px; }
.rt-details-page .map-panel-header h2 { margin: 6px 0 0; color: #1d3b27; font-size: 1.08rem; }
.rt-details-page .section-kicker { color: #148642; font-size: .71rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-details-page .map-wrap { position: relative; min-height: 405px; overflow: hidden; background: #eaf3ec; }
.rt-details-page .map-wrap-tall { min-height: 405px; }
.rt-details-page .ride-map { width: 100%; height: 405px; min-height: 405px; }
.rt-details-page .map-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; color: #45604f; background: rgba(247,252,248,.72); font-size: .8rem; font-weight: 700; pointer-events: none; }
.rt-details-page .map-error { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; color: #a13b3b; background: #fff3f3; font-size: .75rem; line-height: 1.45; }
.rt-details-page .map-error svg { flex: 0 0 auto; margin-top: 1px; }
.rt-details-page .route-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: #edf2ee; }
.rt-details-page .route-facts > div { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 15px 17px; background: #fff; }
.rt-details-page .route-facts svg { flex: 0 0 auto; color: #159447; }
.rt-details-page .route-facts strong, .rt-details-page .route-facts small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-details-page .route-facts strong { color: #2b4533; font-size: .78rem; }
.rt-details-page .route-facts small { margin-top: 4px; color: #849189; font-size: .66rem; }
.rt-details-page .trip-route-card, .rt-details-page .rating-card { padding: 21px; }
.rt-details-page .card-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
.rt-details-page .card-title-row > svg { color: #159447; }
.rt-details-page .card-title-row h2 { margin: 6px 0 0; color: #1d3b27; font-size: 1.05rem; letter-spacing: -.02em; }
.rt-details-page .detail-route-list { display: grid; gap: 0; }
.rt-details-page .detail-route-item { position: relative; display: grid; grid-template-columns: 31px minmax(0, 1fr); align-items: center; gap: 11px; min-height: 55px; }
.rt-details-page .detail-route-item:not(:last-child)::after { content: ""; position: absolute; top: 37px; bottom: -8px; left: 15px; border-left: 1px dashed #c4d6c9; }
.rt-details-page .detail-route-marker { z-index: 1; width: 31px; height: 31px; display: grid; place-items: center; border-radius: 10px; color: #fff; font-size: .68rem; font-weight: 800; }
.rt-details-page .marker-origin { background: #159447; }
.rt-details-page .marker-stop { color: #14763c; background: #dff4e6; }
.rt-details-page .marker-destination { background: #e88743; }
.rt-details-page .detail-route-item small, .rt-details-page .detail-route-item strong { display: block; }
.rt-details-page .detail-route-item small { margin-bottom: 3px; color: #89958d; font-size: .66rem; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; }
.rt-details-page .detail-route-item strong { overflow: hidden; color: #405548; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
.rt-details-page .rating-card { background: linear-gradient(145deg, #f2faf4, #fff); }
.rt-details-page .rating-form { display: grid; justify-items: start; gap: 12px; }
.rt-details-page .rating-form p { margin: 0; color: #63756a; font-size: .8rem; }
.rt-details-page .rating-target-field { display: grid; gap: 6px; width: 100%; margin-bottom: 12px; color: #52655a; font-size: .75rem; font-weight: 750; }
.rt-details-page .rating-target-field select { width: 100%; min-height: 42px; padding: 8px 10px; border: 1px solid #d7e3da; border-radius: 10px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .78rem; }
.rt-details-page .rating-form textarea { width: 100%; min-height: 91px; padding: 10px 11px; border: 1px solid #d7e3da; border-radius: 11px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .8rem; resize: vertical; }
.rt-details-page .rating-form textarea:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21,148,71,.11); }
.rt-details-page .rating-complete { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border-radius: 12px; color: #23653a; background: #e8f7ec; }
.rt-details-page .rating-complete svg { flex: 0 0 auto; }
.rt-details-page .rating-complete strong { display: block; font-size: .81rem; }
.rt-details-page .rating-complete p { margin: 4px 0 0; color: #6c7d72; font-size: .74rem; }
.rt-details-page .muted-copy { margin: 0; color: #7b897f; font-size: .77rem; line-height: 1.5; }
.rt-details-page .driver-card, .rt-details-page .booking-panel, .rt-details-page .ride-info-card { padding: 20px; }
.rt-details-page .driver-card-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 17px; color: #159447; }
.rt-details-page .driver-profile { display: flex; align-items: center; gap: 12px; }
.rt-details-page .driver-profile img, .rt-details-page .driver-avatar-fallback { width: 54px; height: 54px; flex: 0 0 auto; border-radius: 17px; object-fit: cover; background: #dff3e6; }
.rt-details-page .driver-avatar-fallback { display: grid; place-items: center; color: #14763c; font-weight: 800; }
.rt-details-page .driver-profile strong, .rt-details-page .driver-profile span { display: block; }
.rt-details-page .driver-profile strong { color: #294632; font-size: .9rem; }
.rt-details-page .driver-rating { display: flex !important; align-items: center; gap: 4px; margin-top: 5px; color: #718077; font-size: .7rem; }
.rt-details-page .driver-rating svg { color: #e49a2f; }
.rt-details-page .vehicle-summary { display: flex; align-items: flex-start; gap: 9px; margin-top: 18px; padding: 12px; border-radius: 12px; color: #159447; background: #f1f8f3; }
.rt-details-page .vehicle-summary > div { min-width: 0; }
.rt-details-page .vehicle-summary strong, .rt-details-page .vehicle-summary span { display: block; }
.rt-details-page .vehicle-summary strong { color: #31503b; font-size: .77rem; }
.rt-details-page .vehicle-summary span { margin-top: 4px; color: #74837a; font-size: .68rem; line-height: 1.35; }
.rt-details-page .driver-bio { margin: 15px 0 0; color: #718077; font-size: .75rem; line-height: 1.5; }
.rt-details-page .booking-panel .card-title-row { margin-bottom: 15px; }
.rt-details-page .request-list { display: grid; gap: 9px; }
.rt-details-page .request-item { display: grid; gap: 11px; padding: 12px; border: 1px solid #e0e9e3; border-radius: 13px; background: #fbfdfb; }
.rt-details-page .request-person { display: flex; align-items: center; gap: 9px; min-width: 0; }
.rt-details-page .request-avatar { width: 31px; height: 31px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 10px; color: #14763c; background: #def3e5; font-size: .65rem; font-weight: 800; }
.rt-details-page .request-person strong, .rt-details-page .request-person span { display: block; }
.rt-details-page .request-person strong { color: #385341; font-size: .76rem; }
.rt-details-page .request-person span { margin-top: 3px; color: #859189; font-size: .67rem; }
.rt-details-page .request-actions { display: flex; gap: 7px; }
.rt-details-page .request-actions .btn { flex: 1; }
.rt-details-page .small-empty { display: grid; justify-items: center; padding: 16px 8px; color: #89968d; text-align: center; }
.rt-details-page .small-empty p { margin: 8px 0 0; font-size: .75rem; }
.rt-details-page .confirmed-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 14px; padding: 10px 11px; border-radius: 10px; color: #246b3b; background: #eaf8ee; font-size: .73rem; }
.rt-details-page .confirmed-summary span { color: #718878; font-size: .68rem; }
.rt-details-page .driver-controls { display: grid; gap: 8px; margin-top: 16px; padding-top: 15px; border-top: 1px solid #edf2ee; }
.rt-details-page .current-booking { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border-radius: 12px; }
.rt-details-page .current-booking > div:last-child { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.rt-details-page .current-booking .btn { margin-top: 4px; }
.rt-details-page .current-booking .control-hint { margin: 0; }
.rt-details-page .booking-pending { color: #7a5b17; background: #fff7df; }
.rt-details-page .booking-payment_pending { color: #7a5b17; background: #fff7df; }
.rt-details-page .booking-confirmed { color: #176b39; background: #e9f8ed; }
.rt-details-page .booking-picked_up { color: #1a5a80; background: #e9f2fa; }
.rt-details-page .booking-completed { color: #425b49; background: #edf3ef; }
.rt-details-page .booking-rejected { color: #8f3232; background: #fdeeee; }
.rt-details-page .booking-cancelled { color: #4f5f55; background: #eef2ef; }
.rt-details-page .booking-no_show { color: #8f3232; background: #fdeeee; }
.rt-details-page .current-booking-icon { display: grid; place-items: center; flex: 0 0 auto; }
.rt-details-page .current-booking strong, .rt-details-page .current-booking span { display: block; }
.rt-details-page .current-booking strong { font-size: .79rem; }
.rt-details-page .current-booking span { margin-top: 4px; color: #6f8175; font-size: .7rem; line-height: 1.4; }
.rt-details-page .current-booking-next { display: flex; align-items: flex-start; gap: 6px; margin: 2px 0 0; color: inherit; font-size: .7rem; line-height: 1.45; }
.rt-details-page .current-booking-next svg { flex: 0 0 auto; margin-top: 2px; }
.rt-details-page .current-booking-pickup { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: #51685a; font-size: .69rem; line-height: 1.45; }
.rt-details-page .current-booking-pickup svg { flex: 0 0 auto; margin-top: 2px; color: #159447; }
.rt-details-page .request-meeting { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 7px 9px; border-radius: 9px; color: #4a6353; background: #f1f8f3; font-size: .68rem; line-height: 1.4; }
.rt-details-page .request-meeting svg { flex: 0 0 auto; margin-top: 1px; color: #159447; }
.rt-details-page .live-status { display: flex; align-items: center; gap: 7px; margin: 0; padding: 9px 22px; color: #1c5c96; background: #eef5fc; font-size: .71rem; font-weight: 730; }
.rt-details-page .live-status svg { flex: 0 0 auto; }
.rt-details-page .live-status--stale { color: #5d6b74; background: #f0f3f5; }
.rt-details-page .live-status--error { color: #a13b3b; background: #fff3f3; }
.rt-details-page .request-form { display: grid; gap: 8px; }
.rt-details-page .request-form label { color: #52655a; font-size: .76rem; font-weight: 750; }
.rt-details-page .request-form select { width: 100%; min-height: 43px; padding: 8px 10px; border: 1px solid #d7e3da; border-radius: 10px; color: #263d2e; background: #fff; outline: none; font: inherit; font-size: .8rem; }
.rt-details-page .request-form .field-hint { margin: 0; color: #849189; font-size: .68rem; line-height: 1.4; }
.rt-details-page .detail-list { display: grid; gap: 0; margin: 0; }
.rt-details-page .detail-list > div { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 11px 0; border-bottom: 1px solid #edf2ee; }
.rt-details-page .detail-list > div:last-child { border-bottom: 0; }
.rt-details-page .detail-list dt { color: #849189; font-size: .72rem; }
.rt-details-page .detail-list dd { display: flex; align-items: center; gap: 5px; max-width: 62%; margin: 0; color: #3d5545; font-size: .73rem; font-weight: 700; text-align: right; }
.rt-details-page .safety-note { display: flex; align-items: flex-start; gap: 10px; padding: 16px; color: #148642; background: #eff9f2; }
.rt-details-page .safety-note > div { min-width: 0; }
.rt-details-page .safety-note strong { display: block; color: #2e5c3b; font-size: .78rem; }
.rt-details-page .safety-note p { margin: 5px 0 7px; color: #6f8175; font-size: .72rem; line-height: 1.45; }
.rt-details-page .safety-note .text-link { display: inline-flex; align-items: center; gap: 5px; color: #137d3d; font-size: .71rem; font-weight: 800; text-decoration: none; }
.rt-details-page .form-message { display: flex; align-items: flex-start; gap: 7px; margin: 0 0 16px; padding: 10px 11px; border-radius: 10px; font-size: .75rem; line-height: 1.45; }
.rt-details-page .error-message { color: #a73737; background: #fff0f0; }
.rt-details-page .success-message { color: #126e39; background: #eaf8ee; }
.rt-details-page .form-message svg { flex: 0 0 auto; margin-top: 1px; }
.rt-details-page .page-loading-card { min-height: 300px; display: flex; align-items: center; justify-content: center; gap: 9px; color: #6e7e74; }
.rt-details-page .empty-state { min-height: 300px; display: grid; place-items: center; padding: 30px; text-align: center; }
.rt-details-page .empty-state h1 { margin: 16px 0 7px; color: #27432f; font-size: 1.45rem; }
.rt-details-page .empty-state p { max-width: 390px; margin: 0 0 19px; color: #75837a; font-size: .82rem; line-height: 1.5; }
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
  const canRequest = Boolean(
    ride &&
      !isDriver &&
      ride.status === "active" &&
      ride.availableSeats > 0 &&
      hasValidDeparture &&
      !hasDeparted &&
      !currentBooking,
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
                        const canAccept = booking.seats <= ride.availableSeats;
                        const busy = Boolean(actionLoading);
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
                                title={canAccept ? "Accept and hold this seat" : "There are not enough seats available."}
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
                                disabled={busy}
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
                    </div>
                  ) : (
                    <div className="small-empty"><Users size={20} /><p>No pending requests right now.</p></div>
                  )}

                  {payingBookings.length > 0 ? (
                    <div className="request-list">
                      {payingBookings.map((booking) => {
                        const rider = users.find((user) => user.id === booking.riderId);
                        return (
                          <div className="request-item" key={booking.id}>
                            <div className="request-person">
                              <span className="request-avatar">{rider ? initials(rider.name) : "?"}</span>
                              <div>
                                <strong>{rider?.name ?? "Community rider"}</strong>
                                <span>Waiting to pay {formatRupees(booking.fareAmount ?? 0)}</span>
                              </div>
                            </div>
                            <div className="request-actions">
                              <button
                                className="btn btn-primary btn-small"
                                type="button"
                                disabled={Boolean(actionLoading)}
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
                 <CurrentBookingPanel
                   booking={currentBooking}
                   isDriver={false}
                   actionLoading={actionLoading}
                   onAction={(action, success, fallback) => void runBookingAction(currentBooking, action, success, fallback)}
                 />
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
