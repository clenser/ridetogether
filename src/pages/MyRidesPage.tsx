import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CalendarClock,
  CarFront,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  CreditCard,
  Edit3,
  Flag,
  History,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Navigation,
  PlayCircle,
  Plus,
  Route as RouteIcon,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import RideCard from "../components/RideCard";
import { BookingStatusBadge, isLiveRide, nextStepFor } from "../components/StatusBadge";
import { useApp } from "../context/AppContext";
import type { Booking, BookingStatus, Ride, User, Vehicle } from "../types";

/**
 * "Departed" is a published ride whose departure time has passed but which the
 * host has not started; "onRoad" is the in-progress trip itself. They are
 * separate tabs because they need different controls, not because they are
 * different database states.
 */
type RideCategory = "upcoming" | "departed" | "onRoad" | "completed" | "cancelled";
type LifecycleAction = "cancel" | "start" | "complete";
type PaymentOutcome = "success" | "failed";

interface LifecycleDialog {
  rideId: string;
  action: LifecycleAction;
}

const myRidesStyles = `
.rt-rides-page { min-height: 100%; padding: 28px 20px 60px; color: var(--rt-text, #17231c); background: var(--rt-surface-subtle, #f6faf7); }
.rt-rides-shell { max-width: 1180px; margin: 0 auto; }
.rt-rides-heading { display: flex; align-items: center; gap: 7px; color: #148642; font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.rt-rides-offer { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 17px; border: 0; border-radius: 12px; color: #fff; background: #159447; box-shadow: 0 8px 20px rgba(21,148,71,.2); font: inherit; font-size: .84rem; font-weight: 780; text-decoration: none; cursor: pointer; }
.rt-rides-offer:hover { background: #10813b; }
.rt-rides-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0 20px; }
.rt-rides-stat { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 15px; border: 1px solid var(--rt-border, #dce7df); border-radius: 17px; background: var(--rt-card, #fff); box-shadow: 0 8px 24px rgba(29,64,42,.045); }
.rt-rides-stat-icon { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 12px; color: #148642; background: #e2f5e8; }
.rt-rides-stat:nth-child(2) .rt-rides-stat-icon { color: #2563a7; background: #eaf2fb; }
.rt-rides-stat:nth-child(3) .rt-rides-stat-icon { color: #a56608; background: #fff4dd; }
.rt-rides-stat:nth-child(4) .rt-rides-stat-icon { color: #7651a8; background: #f1eafb; }
.rt-rides-stat strong { display: block; font-size: 1.16rem; line-height: 1; }
.rt-rides-stat span:last-child { display: block; margin-top: 5px; color: #748178; font-size: .72rem; }
.rt-rides-alert { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 16px; padding: 12px 14px; border: 1px solid #efb9b9; border-radius: 13px; color: #a43131; background: #fff1f1; font-size: .81rem; line-height: 1.45; }
.rt-rides-alert-success { border-color: #bce4c9; color: #116f38; background: #edf9f1; }
.rt-rides-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-rides-tabs { display: flex; gap: 7px; overflow-x: auto; margin-bottom: 23px; padding: 5px; border: 1px solid var(--rt-border, #dce7df); border-radius: 15px; background: var(--rt-card, #fff); scrollbar-width: none; }
.rt-rides-tab { min-height: 39px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex: 1 0 auto; padding: 0 13px; border: 0; border-radius: 11px; color: #657269; background: transparent; font: inherit; font-size: .79rem; font-weight: 750; cursor: pointer; }
.rt-rides-tab:hover { background: #f2f7f4; }
.rt-rides-tab.is-active { color: #fff; background: #159447; box-shadow: 0 5px 13px rgba(21,148,71,.18); }
.rt-rides-tab-count { min-width: 22px; padding: 3px 6px; border-radius: 999px; color: #4f5f56; background: #edf2ef; font-size: .65rem; line-height: 1; }
.rt-rides-tab.is-active .rt-rides-tab-count { color: #116f38; background: #fff; }
.rt-rides-section { margin-top: 25px; }
.rt-rides-section:first-of-type { margin-top: 0; }
.rt-rides-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin-bottom: 13px; }
.rt-rides-section-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
.rt-rides-section-title > span { width: 35px; height: 35px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 11px; color: #148642; background: #e2f5e8; }
.rt-rides-section h2 { margin: 0; font-size: 1.06rem; letter-spacing: -.018em; }
.rt-rides-section-head p { margin: 4px 0 0; color: #748178; font-size: .78rem; }
.rt-rides-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; align-items: start; }
.rt-rides-grid .ride-card { height: 100%; }
.rt-rides-context { display: flex; flex-wrap: wrap; gap: 7px; }
.rt-rides-pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 999px; color: #526259; background: #f1f5f2; font-size: .69rem; font-weight: 720; }
.rt-rides-pill--warning { color: #925d08; background: #fff3da; }
.rt-rides-pill--success { color: #126f39; background: #e3f5e9; }
.rt-rides-pill--danger { color: #9e3636; background: #fdeaea; }
.rt-rides-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
.rt-rides-action { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border-radius: 11px; font: inherit; font-size: .78rem; font-weight: 760; text-decoration: none; cursor: pointer; }
.rt-rides-action--primary { border: 0; color: #fff; background: #159447; }
.rt-rides-action--primary:hover { background: #10813b; }
.rt-rides-action--secondary { border: 1px solid #d8e3db; color: #4d5d54; background: #fff; }
.rt-rides-action--secondary:hover { border-color: #b9d6c3; background: #f1f9f4; }
.rt-rides-action--danger { border: 1px solid #edc2c2; color: #a63838; background: #fff7f7; }
.rt-rides-action--danger:hover { background: #feecec; }
.rt-rides-action:disabled { opacity: .48; cursor: not-allowed; }
.rt-rides-action-note { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: #7a877f; font-size: .69rem; line-height: 1.4; }
.rt-rides-empty { min-height: 220px; display: grid; place-items: center; border: 1px dashed #cad8cf; border-radius: 20px; background: rgba(255,255,255,.55); }
.rt-rides-requests { margin-bottom: 26px; border: 1px solid #cfe5d6; border-radius: 21px; background: linear-gradient(145deg, #f2faf5, #fff); box-shadow: 0 10px 30px rgba(29,64,42,.05); overflow: hidden; }
.rt-rides-requests-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 18px 20px; border-bottom: 1px solid #e1ece4; }
.rt-rides-requests-title { display: flex; align-items: center; gap: 10px; }
.rt-rides-requests-title > span { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: #fff; background: #159447; }
.rt-rides-requests h2 { margin: 0; font-size: 1rem; }
.rt-rides-requests-head p { margin: 3px 0 0; color: #6d7b73; font-size: .75rem; }
.rt-rides-request-count { min-width: 28px; padding: 5px 8px; border-radius: 999px; color: #116e38; background: #dff4e6; font-size: .72rem; font-weight: 800; text-align: center; }
.rt-rides-request-list { display: grid; gap: 10px; padding: 14px; }
.rt-rides-request { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 13px; border: 1px solid #e0e9e3; border-radius: 15px; background: #fff; }
.rt-rides-request-main { min-width: 0; }
.rt-rides-request-title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.rt-rides-request-title strong { font-size: .86rem; }
.rt-rides-request-main p { margin: 5px 0 0; overflow: hidden; color: #68766e; font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.rt-rides-request-time { margin-top: 5px; color: #89958e; font-size: .69rem; }
.rt-rides-request-actions { display: flex; gap: 7px; }
.rt-rides-request-button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 10px; font: inherit; font-size: .75rem; font-weight: 760; cursor: pointer; }
.rt-rides-request-button--confirm { border: 0; color: #fff; background: #159447; }
.rt-rides-request-button--reject { border: 1px solid #e1d5d5; color: #8a4545; background: #fff; }
.rt-rides-request-button:disabled { opacity: .48; cursor: not-allowed; }
.rt-rides-modal-copy { display: grid; gap: 13px; color: #59675f; font-size: .86rem; line-height: 1.6; }
.rt-rides-modal-warning { display: flex; align-items: flex-start; gap: 9px; padding: 12px; border-radius: 12px; color: #8f3838; background: #fff0f0; font-size: .79rem; line-height: 1.5; }
.rt-rides-modal-warning svg { flex: 0 0 auto; margin-top: 2px; }
.rt-rides-modal-note { display: flex; align-items: flex-start; gap: 9px; padding: 12px; border-radius: 12px; color: #3f5c4a; background: #eef7f1; font-size: .79rem; line-height: 1.5; }
.rt-rides-modal-note svg { flex: 0 0 auto; margin-top: 2px; color: #159447; }
.rt-rides-pill--info { color: #1d5f9e; background: #e4f0fb; }
.rt-rides-request-button--primary { border: 0; color: #fff; background: #159447; }
.rt-rides-request-button--secondary { border: 1px solid #dbe6de; color: #3f5c4a; background: #fff; }
.rt-rides-modal-footer { display: flex; justify-content: flex-end; gap: 9px; width: 100%; }
.rt-spin { animation: rt-rides-spin .8s linear infinite; }
@keyframes rt-rides-spin { to { transform: rotate(360deg); } }
[data-theme="dark"] .rt-rides-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-rides-stat, [data-theme="dark"] .rt-rides-tabs, [data-theme="dark"] .rt-rides-empty { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-rides-tab { color: #b2c0b7; }
[data-theme="dark"] .rt-rides-tab:hover { background: #1d2a21; }
[data-theme="dark"] .rt-rides-tab.is-active { color: #fff; background: #159447; }
[data-theme="dark"] .rt-rides-tab-count { color: #eef7f1; background: #2b3930; }
[data-theme="dark"] .rt-rides-section-head p, [data-theme="dark"] .rt-rides-requests-head p, [data-theme="dark"] .rt-rides-request-main p, [data-theme="dark"] .rt-rides-request-time { color: #a6b5ac; }
[data-theme="dark"] .rt-rides-requests { background: #17211a; border-color: #31533d; }
[data-theme="dark"] .rt-rides-requests-head { border-color: #2b3a30; }
[data-theme="dark"] .rt-rides-request { background: #1a251e; border-color: #304037; }
[data-theme="dark"] .rt-rides-pill { color: #c7d2cb; background: #243128; }
/*
 * Tinted pill variants need their own dark values, not just the base pill.
 * Without these they keep their light-mode fills, so a row of status chips reads
 * as a line of bright stickers on a near-black card - the single most common way
 * a hand-maintained dark theme falls apart.
 */
[data-theme="dark"] .rt-rides-pill--info { color: #bcd8f0; background: #1d2c3a; }
[data-theme="dark"] .rt-rides-pill--warning { color: #f0d199; background: #33290f; }
[data-theme="dark"] .rt-rides-pill--success { color: #a9e0c1; background: #16301f; }
[data-theme="dark"] .rt-rides-pill--danger { color: #f0b4b4; background: #341c1c; }
[data-theme="dark"] .rt-rides-action--primary { background: #1fae55; }
[data-theme="dark"] .rt-rides-action--danger { color: #f0b4b4; background: #2a1717; border-color: #5c3232; }
[data-theme="dark"] .rt-rides-action-note { color: #a6b5ac; }
[data-theme="dark"] .rt-rides-action-note svg { color: #8be0a6; }
[data-theme="dark"] .rt-rides-modal-copy { color: #c2d0c8; }
[data-theme="dark"] .rt-rides-modal-note { color: #bcd8c6; background: #17281d; }
[data-theme="dark"] .rt-rides-modal-warning { color: #f0b4b4; background: #2a1717; }
[data-theme="dark"] .rt-rides-tab:hover { background: #1d2a21; }
[data-theme="dark"] .rt-rides-action--secondary, [data-theme="dark"] .rt-rides-request-button--reject { color: #dce7df; background: #1a251e; border-color: #3a4a40; }
[data-theme="dark"] .rt-rides-request-button--primary { background: #1fae55; }
[data-theme="dark"] .rt-rides-request-button--secondary { color: #dce7df; background: #1a251e; border-color: #3a4a40; }
[data-theme="dark"] .rt-rides-alert { border-color: #5c3232; color: #f0b4b4; background: #2a1717; }
[data-theme="dark"] .rt-rides-alert-success { border-color: #2f6b45; color: #a9e0c1; background: #16291d; }
@media (max-width: 900px) { .rt-rides-grid { grid-template-columns: 1fr; } }
@media (max-width: 680px) {
  .rt-rides-page { padding: 18px 14px 44px; }
  .rt-rides-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-rides-offer { width: 100%; }
  .rt-rides-section-head { align-items: flex-start; }
  .rt-rides-request { grid-template-columns: 1fr; }
  .rt-rides-request-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-rides-modal-footer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

const getDeparture = (ride: Ride): Date | null => {
  if (ride.departureDate.includes("T")) {
    const parsed = new Date(ride.departureDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [year, month, day] = ride.departureDate.split("-").map(Number);
  const [hours, minutes] = ride.departureTime.split(":").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day, hours || 0, minutes || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const departureTime = (ride: Ride) => getDeparture(ride)?.getTime() ?? Number.POSITIVE_INFINITY;

const formatDeparture = (ride: Ride) => {
  const departure = getDeparture(ride);
  if (!departure) return `${ride.departureDate} at ${ride.departureTime}`;
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(departure);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(departure);
  return `${date} at ${time}`;
};

const formatRequestedTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently requested";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(parsed);
};

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const BOOKING_SUCCESS: Record<BookingStatus, string> = {
  pending: "The request is still awaiting your decision.",
  payment_pending: "The seat is held and the rider can now pay.",
  confirmed: "The rider is confirmed for this trip.",
  picked_up: "Boarding recorded.",
  completed: "The trip is complete.",
  rejected: "The request was rejected and the seat released.",
  cancelled: "The booking was cancelled and the seat restored.",
  no_show: "Marked as a no-show and the seat released.",
};

const BOOKING_ERROR: Record<BookingStatus, string> = {
  pending: "We could not update this request.",
  payment_pending: "We could not update this booking.",
  confirmed: "We could not confirm this booking.",
  picked_up: "We could not record this boarding.",
  completed: "We could not update this booking.",
  rejected: "We could not release this seat.",
  cancelled: "We could not cancel this booking.",
  no_show: "We could not mark this rider as a no-show.",
};

const LIFECYCLE_ERROR: Record<LifecycleAction, string> = {
  cancel: "We could not cancel this ride.",
  start: "We could not start this trip.",
  complete: "We could not end this trip.",
};

const LIFECYCLE_TITLE: Record<LifecycleAction, string> = {
  cancel: "Cancel this ride?",
  start: "Start this trip?",
  complete: "End this trip?",
};

const LIFECYCLE_CONFIRM: Record<LifecycleAction, string> = {
  cancel: "Cancel ride",
  start: "Start trip",
  complete: "End trip",
};

const LIFECYCLE_COPY: Record<LifecycleAction, (ride: Ride) => string> = {
  cancel: (ride) => `This cancels ${ride.origin.label} to ${ride.destination.label} for everyone booked on it.`,
  start: (ride) => `This puts ${ride.origin.label} to ${ride.destination.label} on the road. Riders will see your live position from this moment.`,
  complete: (ride) => `This ends ${ride.origin.label} to ${ride.destination.label} and opens ratings for everyone who travelled.`,
};

interface RosterAction {
  kind: "accept" | "payment" | "pickup";
  label: string;
  status: BookingStatus;
  icon: typeof Check;
  tone: "primary" | "secondary" | "danger";
  /** Why the control is unavailable, if it is. */
  reason?: string;
}

/**
 * Which controls a host may use on one booking, given the state of both the
 * booking and its ride.
 *
 * Seats are already held from `payment_pending`, so a payment the rider has
 * already opened must be resolvable on a departed ride. Pickup is only
 * meaningful once the trip is actually running: recording a boarding on a ride
 * that has not left yet would let a host claim a seat on a cancelled trip.
 */
function rosterActionsFor(booking: Booking, ride: Ride): RosterAction[] {
  if (booking.status === "pending") {
    if (ride.status !== "active") return [];
    return [
      { kind: "accept", label: "Confirm", status: "confirmed", icon: Check, tone: "primary" },
      { kind: "accept", label: "Reject", status: "rejected", icon: X, tone: "danger" },
    ];
  }
  if (booking.status === "payment_pending") {
    if (!isLiveRide(ride.status)) return [];
    return [
      { kind: "payment", label: "Payment failed", status: "rejected", icon: X, tone: "danger" },
      { kind: "payment", label: "Payment received", status: "confirmed", icon: CreditCard, tone: "primary" },
    ];
  }
  if (booking.status === "confirmed") {
    if (ride.status !== "in_progress") return [];
    return [
      { kind: "pickup", label: "No-show", status: "no_show", icon: Flag, tone: "danger" },
      { kind: "pickup", label: "Picked up", status: "picked_up", icon: MapPin, tone: "primary" },
    ];
  }
  return [];
}

interface RideRosterProps {
  rows: Array<{ booking: Booking; ride: Ride }>;
  users: User[];
  busyKey: string;
  onBookingStatus: (booking: Booking, status: BookingStatus) => void;
  onPayment: (booking: Booking, outcome: PaymentOutcome) => void;
}

function RideRoster({ rows, users, busyKey, onBookingStatus, onPayment }: RideRosterProps) {
  const locked = Boolean(busyKey);
  if (rows.length === 0) return null;

  return (
    <section className="rt-rides-requests" aria-labelledby="ride-roster-title">
      <div className="rt-rides-requests-head">
        <div className="rt-rides-requests-title">
          <span aria-hidden="true"><UserRoundCheck size={19} /></span>
          <div>
            <h2 id="ride-roster-title">Needs your attention</h2>
            <p>Requests to confirm, payments to resolve, and riders to pick up.</p>
          </div>
        </div>
        <span className="rt-rides-request-count" aria-label={`${rows.length} to action`}>{rows.length}</span>
      </div>
      <div className="rt-rides-request-list">
        {rows.map(({ booking, ride }) => {
          const rider = users.find((user) => user.id === booking.riderId);
          const key = `booking:${booking.id}`;
          const isBusy = busyKey === key;
          const hasCapacity = ride.availableSeats >= booking.seats;
          const next = nextStepFor(booking.status, true);
          const actions = rosterActionsFor(booking, ride).map((action) => (
            action.kind === "accept" && action.status === "confirmed" && !hasCapacity
              ? { ...action, reason: "There are not enough available seats." }
              : action
          ));
          return (
            <article className="rt-rides-request" key={booking.id}>
              <div className="rt-rides-request-main">
                <div className="rt-rides-request-title">
                  <strong>{rider?.name ?? "Community rider"}</strong>
                  <span className="rt-rides-pill">{booking.seats} {booking.seats === 1 ? "seat" : "seats"}</span>
                  <BookingStatusBadge status={booking.status} />
                  {hasCapacity ? null : <span className="rt-rides-pill rt-rides-pill--danger">No capacity</span>}
                </div>
                <p>{ride.origin.label} → {ride.destination.label}</p>
                <span className="rt-rides-request-time">
                  {booking.status === "pending" ? `Requested ${formatRequestedTime(booking.createdAt)}` : next}
                </span>
              </div>
              <div className="rt-rides-request-actions">
                {actions.map((action) => {
                  const Icon = action.icon;
                  const disabled = locked || Boolean(action.reason);
                  return (
                    <button
                      key={`${action.kind}-${action.status}`}
                      className={`rt-rides-request-button rt-rides-request-button--${action.tone}`}
                      type="button"
                      disabled={disabled}
                      title={action.reason}
                      onClick={() => {
                        if (action.kind === "payment") onPayment(booking, action.status === "confirmed" ? "success" : "failed");
                        else onBookingStatus(booking, action.status);
                      }}
                    >
                      {isBusy ? <LoaderCircle className="rt-spin" size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface RideCategorySectionProps {
  category: RideCategory;
  rides: Ride[];
  driver: User | null;
  activeUserId: string;
  vehicles: Vehicle[];
  pendingByRide: Map<string, number>;
  now: number;
  busyKey: string;
  onOpenLifecycle: (ride: Ride, action: LifecycleAction) => void;
}

function RideCategorySection({
  category,
  rides,
  driver,
  activeUserId,
  vehicles,
  pendingByRide,
  now,
  busyKey,
  onOpenLifecycle,
}: RideCategorySectionProps) {
  const details = {
    upcoming: { title: "Upcoming", description: "Published rides that have not departed yet.", icon: CalendarClock },
    departed: { title: "Departed", description: "Your departure time has passed. Start the trip to begin the run.", icon: CircleDot },
    onRoad: { title: "On the road", description: "Rides currently running. Pick up riders as they board, then end the trip.", icon: MapPin },
    completed: { title: "Completed", description: "Your finished ride history.", icon: CheckCircle2 },
    cancelled: { title: "Cancelled", description: "Rides that will no longer depart.", icon: History },
  }[category];
  const Icon = details.icon;

  return (
    <section className="rt-rides-section" aria-labelledby={`rides-${category}`}>
      <div className="rt-rides-section-head">
        <div>
          <div className="rt-rides-section-title">
            <span aria-hidden="true"><Icon size={18} /></span>
            <div>
              <h2 id={`rides-${category}`}>{details.title}</h2>
              <p>{details.description}</p>
            </div>
          </div>
        </div>
        <span className="rt-rides-pill">{rides.length} {rides.length === 1 ? "ride" : "rides"}</span>
      </div>
      {rides.length === 0 ? (
        <div className="rt-rides-empty">
          <EmptyState
            icon={Icon}
            title={`No ${details.title.toLowerCase()} rides`}
            description={category === "upcoming" ? "Offer a route to start filling your next shared journey." : `Your ${details.title.toLowerCase()} rides will appear here.`}
            action={category === "upcoming" ? <Link className="rt-rides-offer" to="/offer"><Plus size={16} /> Offer a ride</Link> : undefined}
          />
        </div>
      ) : (
        <div className="rt-rides-grid">
          {rides.map((ride) => {
            const vehicle = vehicles.find((item) => item.id === ride.vehicleId);
            const pending = pendingByRide.get(ride.id) ?? 0;
            const hasDeparted = departureTime(ride) <= now;
            const onRoad = ride.status === "in_progress";
            /**
             * The database is the real gate here: a ride cannot be completed
             * from `active`, and cannot start twice. This only stops the button
             * from inviting a request the schema will refuse.
             */
            const canStart = ride.status === "active";
            const canEnd = onRoad;
            const lifecycleKey = `ride:${ride.id}`;
            const isBusy = busyKey === lifecycleKey;
            return (
              <RideCard
                key={ride.id}
                ride={ride}
                driver={driver ?? undefined}
                currentUserId={activeUserId}
                vehicle={vehicle}
                action={(
                  <div className="rt-rides-actions">
                    <Link className="rt-rides-action rt-rides-action--secondary" to={`/rides/${ride.id}`}>
                      <RouteIcon size={16} aria-hidden="true" /> View details
                    </Link>
                     <Link className="rt-rides-action rt-rides-action--secondary" to={`/chat/${ride.id}`}>
                       <MessageCircle size={16} aria-hidden="true" /> Chat
                     </Link>
                     {ride.status === "active" ? (
                       <Link className="rt-rides-action rt-rides-action--secondary" to={`/offer/${ride.id}/edit`}>
                         <Edit3 size={16} aria-hidden="true" /> Edit ride
                       </Link>
                     ) : null}
                     {canStart ? (
                       <>
                         <button
                           className="rt-rides-action rt-rides-action--danger"
                           type="button"
                           disabled={Boolean(busyKey)}
                           onClick={() => onOpenLifecycle(ride, "cancel")}
                         >
                           <X size={16} aria-hidden="true" /> Cancel ride
                         </button>
                         <button
                           className="rt-rides-action rt-rides-action--primary"
                           type="button"
                           disabled={!canStart || Boolean(busyKey)}
                           onClick={() => onOpenLifecycle(ride, "start")}
                         >
                           {isBusy ? <LoaderCircle className="rt-spin" size={16} aria-hidden="true" /> : <PlayCircle size={16} aria-hidden="true" />}
                           Start trip
                         </button>
                       </>
                     ) : null}
                     {onRoad ? (
                       <button
                         className="rt-rides-action rt-rides-action--primary"
                         type="button"
                         disabled={!canEnd || Boolean(busyKey)}
                         onClick={() => onOpenLifecycle(ride, "complete")}
                       >
                         {isBusy ? <LoaderCircle className="rt-spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                         End trip
                       </button>
                     ) : null}
                  </div>
                )}
              >
                <div className="rt-rides-context">
                   {ride.status === "active" ? <span className="rt-rides-pill rt-rides-pill--success"><CircleDot size={12} /> {hasDeparted ? "Departed" : "Active"}</span> : null}
                   {onRoad ? <span className="rt-rides-pill rt-rides-pill--info"><MapPin size={12} /> On the road</span> : null}
                  {category === "cancelled" ? <span className="rt-rides-pill rt-rides-pill--danger"><X size={12} /> Cancelled</span> : null}
                  {category === "completed" ? <span className="rt-rides-pill rt-rides-pill--success"><ShieldCheck size={12} /> Completed</span> : null}
                  {pending > 0 ? <span className="rt-rides-pill rt-rides-pill--warning"><UsersRound size={12} /> {pending} pending</span> : null}
                  {ride.status === "active" && !hasDeparted ? <span className="rt-rides-pill"><Clock3 size={12} /> Departs {formatDeparture(ride)}</span> : null}
                </div>
                {ride.status === "active" && pending > 0 ? (
                  <p className="rt-rides-action-note">
                    <AlertCircle size={13} aria-hidden="true" />
                     Confirm or reject every pending request before starting this trip.
                  </p>
                ) : null}
                {onRoad ? (
                  <p className="rt-rides-action-note">
                    <MapPin size={13} aria-hidden="true" />
                    Your position is shared with riders in the roster above. End the trip once everyone has been dropped off.
                  </p>
                ) : null}
              </RideCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function MyRidesPage() {
  const {
    activeUser,
    activeUserId,
    users,
    vehicles,
    rides,
    bookings,
    updateBookingStatus,
    markPickedUp,
    markNoShow,
    resolvePayment,
    cancelRide,
    startRide,
    completeRide,
  } = useApp();
  const [selectedCategory, setSelectedCategory] = useState<RideCategory>("upcoming");
  const [lifecycleDialog, setLifecycleDialog] = useState<LifecycleDialog | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    setSelectedCategory("upcoming");
    setLifecycleDialog(null);
    setError("");
    setSuccess("");
  }, [activeUserId]);

  const driverRides = useMemo(
    () => rides.filter((ride) => ride.driverId === activeUserId),
    [activeUserId, rides],
  );
  const categories = useMemo(() => {
    const upcoming = driverRides
      .filter((ride) => ride.status === "active" && departureTime(ride) > now)
      .sort((first, second) => departureTime(first) - departureTime(second));
    const departed = driverRides
      .filter((ride) => ride.status === "active" && departureTime(ride) <= now)
      .sort((first, second) => departureTime(second) - departureTime(first));
    const onRoad = driverRides
      .filter((ride) => ride.status === "in_progress")
      .sort((first, second) => departureTime(second) - departureTime(first));
    const completed = driverRides
      .filter((ride) => ride.status === "completed")
      .sort((first, second) => departureTime(second) - departureTime(first));
    const cancelled = driverRides
      .filter((ride) => ride.status === "cancelled")
      .sort((first, second) => departureTime(second) - departureTime(first));
    return { upcoming, departed, onRoad, completed, cancelled };
  }, [driverRides, now]);

  const pendingByRide = useMemo(() => {
    const counts = new Map<string, number>();
    driverRides.forEach((ride) => {
      if (!isLiveRide(ride.status)) return;
      const count = bookings.filter((booking) => booking.rideId === ride.id && booking.status === "pending").length;
      if (count > 0) counts.set(ride.id, count);
    });
    return counts;
  }, [bookings, driverRides]);

  /**
   * One list of everything the host must act on, ordered by how blocking it is:
   * riders waiting to board a trip that is already moving come first, then
   * requests, then unpaid seats.
   */
  const roster = useMemo(() => {
    const priority: Record<string, number> = { confirmed: 0, pending: 1, payment_pending: 2 };
    return driverRides
      .filter((ride) => isLiveRide(ride.status))
      .flatMap((ride) => bookings
        .filter((booking) => booking.rideId === ride.id && rosterActionsFor(booking, ride).length > 0)
        .map((booking) => ({ booking, ride })))
      .sort((first, second) => (priority[first.booking.status] ?? 9) - (priority[second.booking.status] ?? 9)
        || departureTime(first.ride) - departureTime(second.ride));
  }, [bookings, driverRides]);

  const activeRides = categories.upcoming.length + categories.departed.length + categories.onRoad.length;
  const onBoardRiders = useMemo(
    () => bookings.filter((booking) => (
      booking.status === "picked_up"
      && driverRides.some((ride) => ride.id === booking.rideId && ride.status === "in_progress")
    )).length,
    [bookings, driverRides],
  );
  const confirmedPassengers = useMemo(
    () => bookings.filter((booking) => (
      (booking.status === "confirmed" || booking.status === "picked_up")
      && driverRides.some((ride) => ride.id === booking.rideId && isLiveRide(ride.status))
    )).length,
    [bookings, driverRides],
  );
  const selectedRide = lifecycleDialog
    ? driverRides.find((ride) => ride.id === lifecycleDialog.rideId) ?? null
    : null;
  const selectedPendingCount = selectedRide
    ? bookings.filter((booking) => booking.rideId === selectedRide.id && booking.status === "pending").length
    : 0;
  const selectedConfirmedCount = selectedRide
    ? bookings.filter((booking) => (
      booking.rideId === selectedRide.id
      && (booking.status === "confirmed" || booking.status === "picked_up")
    )).length
    : 0;
  const selectedOnBoardCount = selectedRide
    ? bookings.filter((booking) => booking.rideId === selectedRide.id && booking.status === "picked_up").length
    : 0;

   const handleBookingStatus = async (booking: Booking, status: BookingStatus) => {
    const key = `booking:${booking.id}`;
    if (busyKey) return;
    /**
     * `rosterActionsFor` only offers states this context can actually reach.
     * Boarding and no-show go through their own calls because each also moves
     * seat accounting and notifies the right side; a bare status write would
     * skip all of that. The guard makes an unreachable state a visible bug
     * rather than a silently malformed request.
     */
    if (status !== "confirmed" && status !== "rejected" && status !== "picked_up" && status !== "no_show") return;
    setBusyKey(key);
    setError("");
    setSuccess("");
    try {
      /**
       * Boarding and no-show are separate repository calls rather than generic
       * status writes: each one also moves the seat accounting and notifies the
       * right side, which a bare status update would skip.
       */
      if (status === "picked_up") await markPickedUp(booking.id);
      else if (status === "no_show") await markNoShow(booking.id);
      else await updateBookingStatus(booking.id, status);      setSuccess(BOOKING_SUCCESS[status]);
    } catch (caught) {
      setError(errorText(caught, BOOKING_ERROR[status]));
    } finally {
      setBusyKey("");
    }
  };

  const handlePayment = async (booking: Booking, outcome: PaymentOutcome) => {
    const key = `booking:${booking.id}`;
    if (busyKey) return;
    setBusyKey(key);
    setError("");
    setSuccess("");
    try {
      await resolvePayment(booking.id, outcome);
      setSuccess(outcome === "success"
        ? "Payment recorded and the rider's seat is confirmed."
        : "The payment was marked as not received and the seat released.");
    } catch (caught) {
      setError(errorText(caught, outcome === "success"
        ? "We could not record this payment."
        : "We could not release this seat."));
    } finally {
      setBusyKey("");
    }
  };

  const openLifecycle = (ride: Ride, action: LifecycleAction) => {
    if (busyKey) return;
    setError("");
    setSuccess("");
    setLifecycleDialog({ rideId: ride.id, action });
  };

  const closeLifecycle = () => {
    if (busyKey.startsWith("ride:")) return;
    setLifecycleDialog(null);
    setError("");
  };

  const confirmLifecycle = async () => {
    if (!lifecycleDialog || !selectedRide || busyKey) return;
    const action = lifecycleDialog.action;
    const required = action === "complete" ? "in_progress" : "active";
    if (selectedRide.status !== required) {
      setError(action === "complete"
        ? "Only a trip that is already on the road can be ended."
        : "This ride is no longer active.");
      return;
    }
    if (action === "start" && selectedPendingCount > 0) {
      setError("Confirm or reject every pending request before starting this ride.");
      return;
    }
    setBusyKey(`ride:${selectedRide.id}`);
    setError("");
    setSuccess("");
    try {
      if (action === "cancel") {
        await cancelRide(selectedRide.id);
        setSuccess("The ride was cancelled and its riders were notified.");
      } else if (action === "start") {
        await startRide(selectedRide.id);
        setSuccess("The trip is on the road. Your position is now shared with your riders.");
      } else {
        await completeRide(selectedRide.id);
        setSuccess("The trip is now marked as completed and ratings are open.");
      }
      setLifecycleDialog(null);
    } catch (caught) {
      setError(errorText(caught, LIFECYCLE_ERROR[action]));
    } finally {
      setBusyKey("");
    }
  };

  const categoryTabs: Array<{ id: RideCategory; label: string; count: number }> = [
    { id: "upcoming", label: "Upcoming", count: categories.upcoming.length },
    { id: "departed", label: "Departed", count: categories.departed.length },
    { id: "onRoad", label: "On the road", count: categories.onRoad.length },
    { id: "completed", label: "Completed", count: categories.completed.length },
    { id: "cancelled", label: "Cancelled", count: categories.cancelled.length },
  ];

  return (
    <div className="rt-rides-page">
      <style>{myRidesStyles}</style>
      <div className="rt-rides-shell">
        <PageHeader
          title="My rides"
          description="Manage requests, keep riders informed, and track every journey you offer."
          eyebrow={<span className="rt-rides-heading"><CarFront size={15} /> Driver dashboard</span>}
          actions={<Link className="rt-rides-offer" to="/offer"><Plus size={17} /> Offer a ride</Link>}
        />

        <section className="rt-rides-summary" aria-label="Ride overview">
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><RouteIcon size={19} /></span><div><strong>{activeRides}</strong><span>Open rides</span></div></div>
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><UsersRound size={19} /></span><div><strong>{confirmedPassengers}</strong><span>Confirmed riders</span></div></div>
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><UserRoundCheck size={19} /></span><div><strong>{roster.length}</strong><span>Need action</span></div></div>
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><MapPin size={19} /></span><div><strong>{onBoardRiders}</strong><span>On board now</span></div></div>
        </section>

        {error && !lifecycleDialog ? <div className="rt-rides-alert" role="alert"><AlertCircle size={17} />{error}</div> : null}
        {success && !lifecycleDialog ? <div className="rt-rides-alert rt-rides-alert-success" role="status"><CheckCircle2 size={17} />{success}</div> : null}

        <RideRoster
          rows={roster}
          users={users}
          busyKey={busyKey}
          onBookingStatus={(booking, status) => void handleBookingStatus(booking, status)}
          onPayment={(booking, outcome) => void handlePayment(booking, outcome)}
        />

        <nav className="rt-rides-tabs" aria-label="Ride status">
          {categoryTabs.map((tab) => (
            <button
              key={tab.id}
              className={`rt-rides-tab${selectedCategory === tab.id ? " is-active" : ""}`}
              type="button"
              aria-pressed={selectedCategory === tab.id}
              onClick={() => setSelectedCategory(tab.id)}
            >
              {tab.label}<span className="rt-rides-tab-count">{tab.count}</span>
            </button>
          ))}
        </nav>

        <RideCategorySection
          category={selectedCategory}
          rides={categories[selectedCategory]}
          driver={activeUser}
          activeUserId={activeUserId}
          vehicles={vehicles}
          pendingByRide={pendingByRide}
          now={now}
          busyKey={busyKey}
          onOpenLifecycle={openLifecycle}
        />
      </div>

      <Modal
        isOpen={Boolean(lifecycleDialog && selectedRide)}
        onClose={closeLifecycle}
        title={lifecycleDialog ? LIFECYCLE_TITLE[lifecycleDialog.action] : ""}
        size="small"
        footer={(
          <div className="rt-rides-modal-footer">
            <button className="rt-rides-action rt-rides-action--secondary" type="button" disabled={busyKey.startsWith("ride:")} onClick={closeLifecycle}>
              {lifecycleDialog?.action === "complete" ? "Keep running" : "Go back"}
            </button>
            <button
              className={`rt-rides-action ${lifecycleDialog?.action === "cancel" ? "rt-rides-action--danger" : "rt-rides-action--primary"}`}
              type="button"
              disabled={busyKey.startsWith("ride:")}
              onClick={() => void confirmLifecycle()}
            >
              {busyKey.startsWith("ride:")
                ? <LoaderCircle className="rt-spin" size={16} />
                : lifecycleDialog?.action === "cancel" ? <X size={16} />
                  : lifecycleDialog?.action === "start" ? <PlayCircle size={16} /> : <CheckCircle2 size={16} />}
              {lifecycleDialog ? LIFECYCLE_CONFIRM[lifecycleDialog.action] : ""}
            </button>
          </div>
        )}
      >
        {selectedRide && lifecycleDialog ? (
          <div className="rt-rides-modal-copy">
            <p>{LIFECYCLE_COPY[lifecycleDialog.action](selectedRide)}</p>
            {lifecycleDialog.action === "cancel" && selectedConfirmedCount > 0 ? (
              <div className="rt-rides-modal-warning"><AlertCircle size={17} /><span>{selectedConfirmedCount} booked {selectedConfirmedCount === 1 ? "rider has" : "riders have"} been notified that this ride was cancelled.</span></div>
            ) : null}
            {lifecycleDialog.action === "start" ? (
              <>
                {selectedPendingCount > 0 ? (
                  <div className="rt-rides-modal-warning"><AlertCircle size={17} /><span>{selectedPendingCount} {selectedPendingCount === 1 ? "request is" : "requests are"} still unanswered. Confirm or reject them first.</span></div>
                ) : null}
                <div className="rt-rides-modal-note"><Navigation size={17} /><span>Your position starts sharing with riders and stops as soon as you end the trip.</span></div>
              </>
            ) : null}
            {lifecycleDialog.action === "complete" ? (
              <>
                <div className="rt-rides-modal-note"><ShieldCheck size={17} /><span>Riders still marked confirmed are recorded as no-shows, and everyone can now rate this trip.</span></div>
                {selectedOnBoardCount > 0 ? (
                  <div className="rt-rides-modal-note"><UsersRound size={17} /><span>{selectedOnBoardCount} {selectedOnBoardCount === 1 ? "rider is" : "riders are"} still on board and will be marked as completed.</span></div>
                ) : null}
              </>
            ) : null}
            {error ? <div className="rt-rides-alert" role="alert"><AlertCircle size={16} />{error}</div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default MyRidesPage;
