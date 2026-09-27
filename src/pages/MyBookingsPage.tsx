import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Route as RouteIcon,
  Search,
  TicketCheck,
  UsersRound,
  Wallet,
  XCircle,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import RideCard from "../components/RideCard";
import { BookingStatusBadge, isLiveRide, nextStepFor } from "../components/StatusBadge";
import { Tabs } from "../components/ui/Tabs";
import { useApp } from "../context/AppContext";
import { PAYMENT_DISCLAIMER } from "../services/payment";
import { formatRupees } from "../services/fare";
import {
  ACTIVE_BOOKING_STATUSES,
  type Booking,
  type BookingStatus,
  type Ride,
  type User,
  type Vehicle,
} from "../types";

interface BookingEntry {
  booking: Booking;
  ride: Ride | null;
  driver: User | null;
  timestamp: number;
}

interface CancellationDialog {
  bookingId: string;
}

type BookingTab = "upcoming" | "active" | "completed" | "cancelled";

/**
 * Per-tab wording. Kept next to the tab list so a new tab cannot appear without
 * a title, an explanation and an empty state of its own.
 */
const TAB_COPY: Record<BookingTab, {
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
}> = {
  upcoming: {
    label: "Upcoming",
    title: "Upcoming journeys",
    description: "Requested, paying and confirmed seats that have not departed yet.",
    icon: CalendarDays,
    emptyTitle: "No upcoming bookings",
    emptyDescription: "Find a compatible community ride and send the driver a seat request.",
  },
  active: {
    label: "Active",
    title: "Under way",
    description: "Trips you are riding right now, including the pickup in progress.",
    icon: RouteIcon,
    emptyTitle: "Nothing under way",
    emptyDescription: "A journey appears here from the moment the driver starts the trip.",
  },
  completed: {
    label: "Completed",
    title: "Completed trips",
    description: "Journeys you finished, ready to rate the driver.",
    icon: CheckCircle2,
    emptyTitle: "No completed trips yet",
    emptyDescription: "Trips you have finished will be listed here so you can leave a rating.",
  },
  cancelled: {
    label: "Cancelled",
    title: "Cancelled and closed",
    description: "Declined, withdrawn and cancelled requests, kept for your records.",
    icon: History,
    emptyTitle: "Nothing closed",
    emptyDescription: "Declined, withdrawn and cancelled requests will be listed here.",
  },
};

const myBookingsStyles = `
.rt-bookings-page { min-height: 100%; padding: 28px 20px 60px; color: var(--rt-text, var(--rt-text-strong)); background: var(--rt-surface-subtle, var(--rt-surface-subtle)); }
.rt-bookings-shell { max-width: 1180px; margin: 0 auto; }
.rt-bookings-tabs { margin: 0 0 18px; }
.rt-bookings-heading { display: flex; align-items: center; gap: 7px; color: var(--rt-primary-strong); font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.rt-bookings-find { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 17px; border: 0; border-radius: 12px; color: var(--rt-text-inverse); background: var(--rt-primary); box-shadow: 0 8px 20px color-mix(in srgb, var(--rt-primary) 20%, transparent); font: inherit; font-size: .84rem; font-weight: 780; text-decoration: none; }
.rt-bookings-find:hover { background: var(--rt-primary-strong); }
.rt-bookings-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0 26px; }
.rt-bookings-stat { display: flex; align-items: center; gap: 12px; padding: 15px; border: 1px solid var(--rt-border, var(--rt-border)); border-radius: 17px; background: var(--rt-card, var(--rt-card)); box-shadow: 0 8px 24px color-mix(in srgb, var(--rt-primary) 5%, transparent); }
.rt-bookings-stat-icon { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 12px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-bookings-stat:nth-child(2) .rt-bookings-stat-icon { color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-bookings-stat:nth-child(3) .rt-bookings-stat-icon { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-bookings-stat strong { display: block; font-size: 1.16rem; line-height: 1; }
.rt-bookings-stat span:last-child { display: block; margin-top: 5px; color: var(--rt-muted); font-size: .72rem; }
.rt-bookings-alert { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 18px; padding: 12px 14px; border: 1px solid var(--rt-danger-border); border-radius: 13px; color: var(--rt-danger-text); background: var(--rt-danger-soft); font-size: .81rem; line-height: 1.45; }
.rt-bookings-alert-success { border-color: var(--rt-border); color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
.rt-bookings-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-bookings-section { margin-top: 26px; }
.rt-bookings-section:first-of-type { margin-top: 0; }
.rt-bookings-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin-bottom: 13px; }
.rt-bookings-section-title { display: flex; align-items: center; gap: 9px; }
.rt-bookings-section-title > span { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 11px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-bookings-section h2 { margin: 0; font-size: 1.06rem; letter-spacing: -.018em; }
.rt-bookings-section-head p { margin: 4px 0 0; color: var(--rt-muted); font-size: .78rem; }
.rt-bookings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; align-items: start; }
.rt-bookings-grid .ride-card { height: 100%; }
.rt-bookings-status-line { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.rt-bookings-status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 999px; color: var(--rt-text); background: var(--rt-surface-muted); font-size: .69rem; font-weight: 800; text-transform: capitalize; }
.rt-bookings-status--confirmed { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-bookings-status--pending { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-bookings-status--rejected { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-bookings-status--cancelled { color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-bookings-status--completed { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-bookings-window { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 999px; color: var(--rt-text); background: var(--rt-surface-subtle); font-size: .69rem; font-weight: 720; }
.rt-bookings-window--departed { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-bookings-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; width: 100%; }
.rt-bookings-action { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; border-radius: 11px; font: inherit; font-size: .76rem; font-weight: 760; text-decoration: none; cursor: pointer; }
.rt-bookings-action--primary { border: 0; color: var(--rt-text-inverse); background: var(--rt-primary); }
.rt-bookings-action--primary:hover { background: var(--rt-primary-strong); }
.rt-bookings-action--secondary { border: 1px solid var(--rt-border); color: var(--rt-text); background: var(--rt-card); }
.rt-bookings-action--secondary:hover { border-color: var(--rt-border); background: var(--rt-surface-subtle); }
.rt-bookings-action--danger { border: 1px solid var(--rt-danger-border); color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-bookings-action--danger:hover { background: var(--rt-danger-soft); }
.rt-bookings-action:disabled { opacity: .48; cursor: not-allowed; }
.rt-bookings-lock-note { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: var(--rt-muted); font-size: .69rem; line-height: 1.4; }
.rt-bookings-lock-note svg { flex: 0 0 auto; margin-top: 1px; }
.rt-bookings-pickup { display: flex; align-items: flex-start; gap: 6px; margin: 9px 0 0; color: var(--rt-text); font-size: .71rem; line-height: 1.45; }
.rt-bookings-pickup svg { flex: 0 0 auto; margin-top: 2px; color: var(--rt-primary); }
.rt-bookings-next { margin: 8px 0 0; padding: 8px 10px; border-radius: 10px; color: var(--rt-text); background: var(--rt-surface-subtle); font-size: .71rem; line-height: 1.45; }
.rt-bookings-empty { min-height: 220px; display: grid; place-items: center; border: 1px dashed var(--rt-border); border-radius: 20px; background: rgba(255,255,255,.55); }
.rt-bookings-missing { height: 100%; display: grid; align-content: center; justify-items: center; min-height: 270px; padding: 26px; border: 1px solid var(--rt-border); border-radius: 20px; background: var(--rt-card, var(--rt-card)); text-align: center; }
.rt-bookings-missing-icon { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 17px; color: var(--rt-muted); background: var(--rt-surface-muted); }
.rt-bookings-missing h3 { margin: 15px 0 5px; font-size: 1rem; }
.rt-bookings-missing p { max-width: 360px; margin: 0; color: var(--rt-muted); font-size: .8rem; line-height: 1.55; }
.rt-bookings-modal-copy { display: grid; gap: 13px; color: var(--rt-text); font-size: .86rem; line-height: 1.6; }
.rt-bookings-modal-warning { display: flex; align-items: flex-start; gap: 9px; padding: 12px; border-radius: 12px; color: var(--rt-danger-text); background: var(--rt-danger-soft); font-size: .79rem; line-height: 1.5; }
.rt-bookings-modal-warning svg { flex: 0 0 auto; margin-top: 2px; }
.rt-bookings-modal-footer { display: flex; justify-content: flex-end; gap: 9px; width: 100%; }
.rt-bookings-spin { animation: rt-bookings-spin .8s linear infinite; }
@keyframes rt-bookings-spin { to { transform: rotate(360deg); } }
[data-theme="dark"] .rt-bookings-page { --rt-surface-subtle: var(--rt-surface-subtle); --rt-card: var(--rt-surface); --rt-border: var(--rt-border); --rt-text: var(--rt-text); }
[data-theme="dark"] .rt-bookings-stat, [data-theme="dark"] .rt-bookings-empty { background: var(--rt-surface); border-color: var(--rt-border); }
[data-theme="dark"] .rt-bookings-section-head p { color: var(--rt-muted); }
[data-theme="dark"] .rt-bookings-status, [data-theme="dark"] .rt-bookings-window { color: var(--rt-muted); background: #263229; }
[data-theme="dark"] .rt-bookings-action--secondary { color: #dce7df; background: #1a251e; border-color: #3a4a40; }
[data-theme="dark"] .rt-bookings-missing { background: var(--rt-surface); border-color: var(--rt-border); }
[data-theme="dark"] .rt-bookings-missing p { color: var(--rt-muted); }
/*
 * Per-status dark values, declared after the base status-chip rule.
 *
 * The base rule and the status variants have identical specificity, so the dark
 * override on the base class was winning over all of them and every status chip
 * rendered as the same neutral grey - which is the one thing a status colour is
 * not allowed to do. Declaring each variant here restores the distinction, and
 * the label text still carries the meaning, so colour is reinforcement here
 * rather than the only signal.
 */
[data-theme="dark"] .rt-bookings-status--confirmed, [data-theme="dark"] .rt-bookings-status--completed { color: var(--rt-success-text); background: #16301f; }
[data-theme="dark"] .rt-bookings-status--pending { color: var(--rt-warning-text); background: #33290f; }
[data-theme="dark"] .rt-bookings-status--rejected { color: var(--rt-danger-text); background: #341c1c; }
[data-theme="dark"] .rt-bookings-status--cancelled { color: var(--rt-muted); background: #263229; }
[data-theme="dark"] .rt-bookings-window--departed { color: #bcd8f0; background: #1d2c3a; }
[data-theme="dark"] .rt-bookings-action--primary { background: #1fae55; }
[data-theme="dark"] .rt-bookings-action--primary:hover { background: #32b965; }
[data-theme="dark"] .rt-bookings-action--danger { color: var(--rt-danger-text); background: #2a1717; border-color: #5c3232; }
[data-theme="dark"] .rt-bookings-action--danger:hover { background: #351d1d; }
@media (max-width: 900px) { .rt-bookings-grid { grid-template-columns: 1fr; } }
@media (max-width: 680px) {
  .rt-bookings-page { padding: 18px 14px 44px; }
  .rt-bookings-summary { grid-template-columns: 1fr; }
  .rt-bookings-find { width: 100%; }
  .rt-bookings-section-head { align-items: flex-start; }
  .rt-bookings-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-bookings-modal-footer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
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

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * A rider may withdraw while the trip has not started. `payment_pending` is
 * included because the seat is already held at that point, so the driver is
 * relying on it - but the rider still has to be able to give it back before the
 * car leaves. `picked_up` is not: once somebody is in the vehicle the booking is
 * part of a trip that is under way.
 */
const CANCELLABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  "pending",
  "payment_pending",
  "confirmed",
];

interface BookingSectionProps {
  title: string;
  description: string;
  entries: BookingEntry[];
  icon: typeof CalendarDays;
  emptyTitle: string;
  emptyDescription: string;
  vehicles: Vehicle[];
  activeUserId: string;
  now: number;
  cancelling: boolean;
  paying: string | null;
  /** Payments keyed by booking, so a seat that is already open says so. */
  openedPaymentBookings: ReadonlySet<string>;
  onCancel: (booking: Booking) => void;
  onPay: (booking: Booking) => void;
  history?: boolean;
}

function BookingSection({
  title,
  description,
  entries,
  icon: Icon,
  emptyTitle,
  emptyDescription,
  vehicles,
  activeUserId,
  now,
  cancelling,
  paying,
  openedPaymentBookings,
  onCancel,
  onPay,
  history = false,
}: BookingSectionProps) {
  return (
    <section className="rt-bookings-section" aria-labelledby={`bookings-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="rt-bookings-section-head">
        <div>
          <div className="rt-bookings-section-title">
            <span aria-hidden="true"><Icon size={18} /></span>
            <div>
              <h2 id={`bookings-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h2>
              <p>{description}</p>
            </div>
          </div>
        </div>
        <span className="rt-bookings-status">{entries.length} {entries.length === 1 ? "booking" : "bookings"}</span>
      </div>
      {entries.length === 0 ? (
        <div className="rt-bookings-empty">
          <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} action={history ? <Link className="rt-bookings-find" to="/find"><Search size={16} /> Find a ride</Link> : undefined} />
        </div>
      ) : (
        <div className="rt-bookings-grid">
          {entries.map(({ booking, ride, driver, timestamp }) => {
            const vehicle = ride ? vehicles.find((item) => item.id === ride.vehicleId) : undefined;
            const departure = ride ? getDeparture(ride) : null;
            const departed = Boolean(departure && departure.getTime() <= now);
            /**
             * "Started" covers both ends of the journey rather than just the
             * database state: a ride that is no longer live has already finished
             * or been cancelled, and an `in_progress` one is under way even if
             * its departure time has not technically passed. Cancelling is
             * gated on `!started` rather than on `isLiveRide`, because the latter
             * still returns true mid-trip and would offer a button the schema
             * then rejects.
             */
            const started = ride ? !isLiveRide(ride.status) || ride.status === "in_progress" : false;
            const cancellableStatus = CANCELLABLE_BOOKING_STATUSES.includes(booking.status);
            const canCancel = Boolean(ride && !departed && !started && cancellableStatus);
            /**
             * A held seat stays payable for as long as the ride is running, not
             * only while it is still open for bookings.
             *
             * The seat is the rider's from the moment the host accepts it, and the
             * host may confirm the payment on a departed trip. Gating this on
             * `active` alone meant a rider whose host had already set off lost the
             * Pay button, leaving the host's only remaining option to release a seat
             * the rider was trying to pay for. Both sides now share one rule: while
             * the ride is live, `payment_pending` can be paid; once it is closed the
             * booking is closed too and there is nothing to pay.
             */
            const canPay = Boolean(ride && isLiveRide(ride.status) && booking.status === "payment_pending");
            /**
             * A payment that has already been opened is not something to offer
             * again. The button is idempotent, but showing "Pay" to a rider who has
             * already paid-as-far-as-the-placeholder-goes invites them to press it
             * again and tells the host nothing about what is actually outstanding.
             */
            const paymentOpen = openedPaymentBookings.has(booking.id);
            const canPayNow = canPay && !paymentOpen;
            const canChat = ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.status === "completed";
            const cancellationLocked = Boolean(ride && (departed || started) && cancellableStatus);
            const nextStep = nextStepFor(booking.status, false);

            if (!ride) {
              return (
                <article className="rt-bookings-missing" key={booking.id}>
                  <span className="rt-bookings-missing-icon"><RouteIcon size={25} /></span>
                  <h3>Ride details unavailable</h3>
                  <p>This saved booking points to a ride that is no longer available. Its status is still shown below.</p>
                </article>
              );
            }

            return (
              <RideCard
                key={booking.id}
                ride={ride}
                driver={driver ?? undefined}
                vehicle={vehicle}
                currentUserId={activeUserId}
                action={(
                  <div className="rt-bookings-actions">
                    <Link className="rt-bookings-action rt-bookings-action--secondary" to={`/rides/${ride.id}`}>
                      <RouteIcon size={15} aria-hidden="true" /> Details
                    </Link>
                    {canChat ? (
                      <Link className="rt-bookings-action rt-bookings-action--secondary" to={`/chat/${ride.id}`}>
                        <MessageCircle size={15} aria-hidden="true" /> Chat
                      </Link>
                    ) : null}
                    {canPayNow ? (
                      <button
                        className="rt-bookings-action rt-bookings-action--primary"
                        type="button"
                        disabled={paying === booking.id}
                        onClick={() => onPay(booking)}
                      >
                        {paying === booking.id
                          ? <LoaderCircle className="rt-bookings-spin" size={15} aria-hidden="true" />
                          : <Wallet size={15} aria-hidden="true" />}
                        {paying === booking.id
                          ? "Opening…"
                          : `Pay ${formatRupees(booking.fareAmount ?? ride.contribution * booking.seats)}`}
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button className="rt-bookings-action rt-bookings-action--danger" type="button" disabled={cancelling} onClick={() => onCancel(booking)}>
                        <XCircle size={15} aria-hidden="true" /> Cancel
                      </button>
                    ) : null}
                  </div>
                )}
              >
                <div className="rt-bookings-status-line">
                  <BookingStatusBadge status={booking.status} />
                  {ACTIVE_BOOKING_STATUSES.includes(booking.status) ? (
                    <span className={`rt-bookings-window${departed ? " rt-bookings-window--departed" : ""}`}>
                      <Clock3 size={12} /> {!departure ? "Departure unavailable" : departed ? "Journey started" : `Departs in ${formatRelativeDeparture(timestamp, now)}`}
                    </span>
                  ) : null}
                </div>
                {booking.pickup ? (
                  <p className="rt-bookings-pickup">
                    <MapPin size={13} aria-hidden="true" />
                    <span>
                      Pickup: {booking.pickup.label}
                      {typeof booking.pickup.walkDistanceKm === "number" && booking.pickup.walkDistanceKm > 0
                        ? ` (${booking.pickup.walkDistanceKm.toFixed(1)} km walk)`
                        : ""}
                    </span>
                  </p>
                ) : null}
                {nextStep ? <p className="rt-bookings-next">{nextStep}</p> : null}
                {booking.status === "payment_pending" ? (
                  paymentOpen ? (
                    <p className="rt-bookings-lock-note"><Clock3 size={13} /> Your payment is open. The driver marks it received to confirm your seat.</p>
                  ) : (
                    <p className="rt-bookings-lock-note"><Wallet size={13} /> {PAYMENT_DISCLAIMER}</p>
                  )
                ) : null}
                {cancellationLocked ? <p className="rt-bookings-lock-note"><LockKeyhole size={13} /> Cancellation closes when the trip starts. Contact the driver if plans change.</p> : null}
              </RideCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatRelativeDeparture(timestamp: number, now: number) {
  if (!Number.isFinite(timestamp)) return "soon";
  const minutes = Math.max(1, Math.round((timestamp - now) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"}`;
}

export function MyBookingsPage() {
  const {
    activeUserId,
    users,
    vehicles,
    rides,
    bookings,
    payments,
    payBooking,
    cancelBooking: withdrawBooking,
  } = useApp();
  const [cancellationDialog, setCancellationDialog] = useState<CancellationDialog | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [bookingTab, setBookingTab] = useState<BookingTab>("upcoming");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    setCancellationDialog(null);
    setError("");
    setSuccess("");
    /* A different member has entirely different bookings, so leaving the tab on
       "Cancelled" would open onto someone else's history. */
    setBookingTab("upcoming");
  }, [activeUserId]);

  const entries = useMemo<BookingEntry[]>(() => bookings
    .filter((booking) => booking.riderId === activeUserId)
    .map((booking) => {
      const ride = rides.find((item) => item.id === booking.rideId) ?? null;
      const departure = ride ? getDeparture(ride) : null;
      const bookingTimestamp = new Date(booking.updatedAt || booking.createdAt).getTime();
      return {
        booking,
        ride,
        driver: ride ? users.find((user) => user.id === ride.driverId) ?? null : null,
        timestamp: departure?.getTime() ?? (Number.isFinite(bookingTimestamp) ? bookingTimestamp : 0),
      };
    }), [activeUserId, bookings, rides, users]);

  /**
   * Which of this rider's bookings already have an open payment.
   *
   * Derived from the payments already loaded in context, which the realtime
   * subscription keeps current, so a card flips to "waiting for the driver" the
   * moment the payment row is written rather than on the next navigation.
   */
  const openedPaymentBookings = useMemo(
    () => new Set(payments.filter((payment) => payment.status === "pending").map((payment) => payment.bookingId)),
    [payments],
  );

  /**
   * The four lifecycle views a rider actually thinks in.
   *
   * Previously these were two buckets - "current & upcoming" and "everything
   * else" - which put a trip that has not departed in the same list as one being
   * driven right now, and mixed a declined request in with a completed trip.
   * Splitting them by what the rider can do about it is the useful distinction.
   */
  // These buckets have to be mutually exclusive and exhaustive, or a booking
  // shows up twice or vanishes. They follow the ride lifecycle - a published
  // ride is upcoming, `in_progress` is under way, and it ends as completed or
  // cancelled - with the rider's own outcome taking priority over the ride's,
  // because a rejected seat on a finished trip was never travelled.
  const isTerminalBooking = ({ booking }: Pick<BookingEntry, "booking">): boolean =>
    booking.status === "cancelled" || booking.status === "rejected" || booking.status === "no_show";

  const isClosed = (entry: BookingEntry): boolean =>
    isTerminalBooking(entry) || entry.ride?.status === "cancelled";

  const isFinished = ({ booking, ride }: BookingEntry): boolean =>
    booking.status === "completed" || ride?.status === "completed";

  const isUnderway = ({ ride }: BookingEntry): boolean => ride?.status === "in_progress";

  const isUpcoming = ({ booking, ride }: BookingEntry): boolean =>
    ride?.status === "active" && !isTerminalBooking({ booking });

  const tabEntries = useMemo<Record<BookingTab, BookingEntry[]>>(() => {
    const byTime = (first: BookingEntry, second: BookingEntry) => first.timestamp - second.timestamp;
    const newestFirst = (first: BookingEntry, second: BookingEntry) => second.timestamp - first.timestamp;

    return {
      upcoming: entries.filter((entry) => !isClosed(entry) && isUpcoming(entry)).sort(byTime),
      active: entries.filter((entry) => !isClosed(entry) && !isFinished(entry) && isUnderway(entry)).sort(byTime),
      completed: entries.filter((entry) => !isClosed(entry) && isFinished(entry)).sort(newestFirst),
      // A booking whose ride could not be loaded is not a real outcome, so it
      // lands here rather than disappearing from every tab and its count.
      cancelled: entries.filter((entry) => isClosed(entry) || !entry.ride).sort(newestFirst),
    };
  }, [entries]);

  const bookingTabs = useMemo(
    () => (Object.keys(TAB_COPY) as BookingTab[]).map((id) => ({
      id,
      label: TAB_COPY[id].label,
      count: tabEntries[id].length,
    })),
    [tabEntries],
  );

  const activeTabCopy = TAB_COPY[bookingTab];
  const activeTabEntries = tabEntries[bookingTab];

  const selectedBooking = cancellationDialog
    ? bookings.find((booking) => booking.id === cancellationDialog.bookingId && booking.riderId === activeUserId) ?? null
    : null;
  const selectedRide = selectedBooking
    ? rides.find((ride) => ride.id === selectedBooking.rideId) ?? null
    : null;
  const selectedIsConfirmed = selectedBooking?.status === "confirmed";

  const openCancellation = (booking: Booking) => {
    setError("");
    setSuccess("");
    setCancellationDialog({ bookingId: booking.id });
  };

  const closeCancellation = () => {
    if (cancelling) return;
    setCancellationDialog(null);
    setError("");
  };

  const confirmCancellation = async () => {
    if (!selectedBooking || !selectedRide || cancelling) return;
    if (!CANCELLABLE_BOOKING_STATUSES.includes(selectedBooking.status) || !isLiveRide(selectedRide.status)) {
      setError("This booking is no longer eligible for cancellation.");
      return;
    }
    const selectedDeparture = getDeparture(selectedRide);
    if (!selectedDeparture || selectedDeparture.getTime() <= Date.now()) {
      setError("Cancellation closes when the trip starts.");
      return;
    }
    setCancelling(true);
    setError("");
    setSuccess("");
    try {
      await withdrawBooking(selectedBooking.id);
      setSuccess("Your booking was cancelled. The driver has been notified.");
      setCancellationDialog(null);
    } catch (caught) {
      setError(errorText(caught, "We could not cancel this booking."));
    } finally {
      setCancelling(false);
    }
  };

  /**
   * Opens the placeholder payment. There is no gateway, so this records intent and
   * hands the seat over to the driver to mark received - the success message says
   * exactly that rather than claiming money moved.
   */
  const handlePay = async (booking: Booking) => {
    if (paying) return;
    setPaying(booking.id);
    setError("");
    setSuccess("");
    try {
      await payBooking(booking.id);
      setSuccess(
        `Payment opened for ${formatRupees(booking.fareAmount ?? 0)}. `
        + "The driver now marks it received to confirm your seat.",
      );
    } catch (caught) {
      setError(errorText(caught, "We could not open the payment for this seat."));
    } finally {
      setPaying(null);
    }
  };

  const heldSeats = entries
    .filter(({ booking }) => booking.status === "payment_pending" || booking.status === "confirmed" || booking.status === "picked_up" || booking.status === "completed")
    .reduce((total, { booking }) => total + booking.seats, 0);
  const currentCount = tabEntries.upcoming.length + tabEntries.active.length;
  const upcomingSeats = tabEntries.upcoming.reduce((total, { booking }) => total + booking.seats, 0);
  const awaitingPayment = entries.filter(({ booking }) => booking.status === "payment_pending").length;

  return (
    <div className="rt-bookings-page">
      <style>{myBookingsStyles}</style>
      <div className="rt-bookings-shell">
        <PageHeader
          title="My bookings"
          description="Follow your requested seats, pay for accepted requests, and manage upcoming journeys."
          eyebrow={<span className="rt-bookings-heading"><TicketCheck size={15} /> Rider dashboard</span>}
          actions={<Link className="rt-bookings-find" to="/find"><Search size={17} /> Find a ride</Link>}
        />

        <section className="rt-bookings-summary" aria-label="Booking overview">
          <div className="rt-bookings-stat"><span className="rt-bookings-stat-icon"><CalendarDays size={19} /></span><div><strong>{currentCount}</strong><span>Current bookings</span></div></div>
          <div className="rt-bookings-stat"><span className="rt-bookings-stat-icon"><CheckCircle2 size={19} /></span><div><strong>{heldSeats}</strong><span>Seats held</span></div></div>
          <div className="rt-bookings-stat"><span className="rt-bookings-stat-icon"><UsersRound size={19} /></span><div><strong>{upcomingSeats}</strong><span>Upcoming seats</span></div></div>
        </section>

        {awaitingPayment > 0 ? (
          <div className="rt-bookings-alert" role="status">
            <Wallet size={17} />
            {awaitingPayment === 1
              ? "One accepted request is waiting on your payment. Your seat is already held."
              : `${awaitingPayment} accepted requests are waiting on your payment. Those seats are already held.`}
          </div>
        ) : null}

        {error && !cancellationDialog ? <div className="rt-bookings-alert" role="alert"><AlertCircle size={17} />{error}</div> : null}
        {success ? <div className="rt-bookings-alert rt-bookings-alert-success" role="status"><CheckCircle2 size={17} />{success}</div> : null}

        <div className="rt-bookings-tabs">
          <Tabs
            items={bookingTabs}
            activeId={bookingTab}
            onChange={(id) => setBookingTab(id as BookingTab)}
            label="Filter bookings"
            idPrefix="booking-tab"
          />
        </div>

        <BookingSection
          title={activeTabCopy.title}
          description={activeTabCopy.description}
          entries={activeTabEntries}
          icon={activeTabCopy.icon}
          emptyTitle={activeTabCopy.emptyTitle}
          emptyDescription={activeTabCopy.emptyDescription}
          vehicles={vehicles}
          activeUserId={activeUserId}
          now={now}
            cancelling={cancelling}
            paying={paying}
            openedPaymentBookings={openedPaymentBookings}
            onCancel={openCancellation}
            onPay={handlePay}
            history={bookingTab === "completed" || bookingTab === "cancelled"}
        />
      </div>

      <Modal
        isOpen={Boolean(cancellationDialog && selectedBooking && selectedRide)}
        onClose={closeCancellation}
        title="Cancel your booking?"
        size="small"
        footer={(
          <div className="rt-bookings-modal-footer">
            <button className="rt-bookings-action rt-bookings-action--secondary" type="button" disabled={cancelling} onClick={closeCancellation}>Keep booking</button>
            <button className="rt-bookings-action rt-bookings-action--danger" type="button" disabled={cancelling} onClick={() => void confirmCancellation()}>
              {cancelling ? <LoaderCircle className="rt-bookings-spin" size={16} /> : <XCircle size={16} />}
              {cancelling ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        )}
      >
        {selectedBooking && selectedRide ? (
          <div className="rt-bookings-modal-copy">
            <p>Cancel your {selectedBooking.seats}-seat request for {selectedRide.origin.label} to {selectedRide.destination.label}?</p>
            <div className="rt-bookings-modal-warning">
              <AlertCircle size={17} />
              <span>{selectedIsConfirmed
                ? "This seat is already held for you. Cancelling returns it to the driver immediately and they will be notified."
                : selectedBooking.status === "payment_pending"
                  ? "Your seat is already held. Cancelling releases it back to the driver before you pay."
                  : "The pending request will be withdrawn and the driver will no longer be able to accept it."}</span>
            </div>
            {error ? <div className="rt-bookings-alert" role="alert"><AlertCircle size={16} />{error}</div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default MyBookingsPage;
