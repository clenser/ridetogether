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
   Edit3,
   History,
  LoaderCircle,
  MessageCircle,
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
import { useApp } from "../context/AppContext";
import type { Booking, Ride, User, Vehicle } from "../types";

type RideCategory = "upcoming" | "active" | "completed" | "cancelled";
type LifecycleAction = "cancel" | "complete";
type BookingDecision = "confirmed" | "rejected";

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
[data-theme="dark"] .rt-rides-action--secondary, [data-theme="dark"] .rt-rides-request-button--reject { color: #dce7df; background: #1a251e; border-color: #3a4a40; }
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

interface RideRequestsProps {
  requests: Array<{ booking: Booking; ride: Ride }>;
  users: User[];
  now: number;
  busyKey: string;
  onUpdate: (booking: Booking, status: BookingDecision) => void;
}

function RideRequests({ requests, users, now, busyKey, onUpdate }: RideRequestsProps) {
  const requestsLocked = Boolean(busyKey);
  if (requests.length === 0) return null;

  return (
    <section className="rt-rides-requests" aria-labelledby="ride-requests-title">
      <div className="rt-rides-requests-head">
        <div className="rt-rides-requests-title">
          <span aria-hidden="true"><UserRoundCheck size={19} /></span>
          <div>
            <h2 id="ride-requests-title">Passenger requests</h2>
            <p>Confirm only when you have enough seats. Rejections notify the rider.</p>
          </div>
        </div>
        <span className="rt-rides-request-count" aria-label={`${requests.length} pending`}>{requests.length}</span>
      </div>
      <div className="rt-rides-request-list">
        {requests.map(({ booking, ride }) => {
          const rider = users.find((user) => user.id === booking.riderId);
          const key = `booking:${booking.id}`;
          const hasCapacity = ride.availableSeats >= booking.seats;
          const isBusy = busyKey === key;
          return (
            <article className="rt-rides-request" key={booking.id}>
              <div className="rt-rides-request-main">
                <div className="rt-rides-request-title">
                  <strong>{rider?.name ?? "Community rider"}</strong>
                  <span className="rt-rides-pill">{booking.seats} {booking.seats === 1 ? "seat" : "seats"}</span>
                   {!hasCapacity ? <span className="rt-rides-pill rt-rides-pill--danger">No capacity</span> : null}
                </div>
                <p>{ride.origin.label} → {ride.destination.label}</p>
                <span className="rt-rides-request-time">Requested {formatRequestedTime(booking.createdAt)}</span>
              </div>
              <div className="rt-rides-request-actions">
                <button
                  className="rt-rides-request-button rt-rides-request-button--reject"
                  type="button"
                  disabled={requestsLocked}
                  onClick={() => onUpdate(booking, "rejected")}
                >
                  {isBusy ? <LoaderCircle className="rt-spin" size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                  Reject
                </button>
                <button
                  className="rt-rides-request-button rt-rides-request-button--confirm"
                  type="button"
                   disabled={requestsLocked || !hasCapacity}
                   title={!hasCapacity ? "There are not enough available seats." : undefined}
                  onClick={() => onUpdate(booking, "confirmed")}
                >
                  {isBusy ? <LoaderCircle className="rt-spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                  Confirm
                </button>
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
    active: { title: "Active", description: "Published rides that are ready to manage.", icon: CircleDot },
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
             const canComplete = ride.status === "active" && pending === 0;
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
                     {ride.status === "active" ? (
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
                          disabled={!canComplete || Boolean(busyKey)}
                           title={pending > 0 ? "Resolve every pending request before completing." : undefined}
                          onClick={() => onOpenLifecycle(ride, "complete")}
                        >
                          {isBusy ? <LoaderCircle className="rt-spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                          Complete
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              >
                <div className="rt-rides-context">
                   {category === "active" ? <span className="rt-rides-pill rt-rides-pill--success"><CircleDot size={12} /> {hasDeparted ? "Departed" : "Active"}</span> : null}
                  {category === "cancelled" ? <span className="rt-rides-pill rt-rides-pill--danger"><X size={12} /> Cancelled</span> : null}
                  {category === "completed" ? <span className="rt-rides-pill rt-rides-pill--success"><ShieldCheck size={12} /> Completed</span> : null}
                  {pending > 0 && ride.status === "active" ? <span className="rt-rides-pill rt-rides-pill--warning"><UsersRound size={12} /> {pending} pending</span> : null}
                  {ride.status === "active" && !hasDeparted ? <span className="rt-rides-pill"><Clock3 size={12} /> Departs {formatDeparture(ride)}</span> : null}
                </div>
                {ride.status === "active" && !canComplete ? (
                  <p className="rt-rides-action-note">
                    <AlertCircle size={13} aria-hidden="true" />
                     {pending > 0
                       ? "Confirm or reject every pending request before completing."
                       : "You can complete this journey when every request has been resolved."}
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
    cancelRide,
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
    const active = driverRides
      .filter((ride) => ride.status === "active" && departureTime(ride) <= now)
      .sort((first, second) => departureTime(second) - departureTime(first));
    const completed = driverRides
      .filter((ride) => ride.status === "completed")
      .sort((first, second) => departureTime(second) - departureTime(first));
    const cancelled = driverRides
      .filter((ride) => ride.status === "cancelled")
      .sort((first, second) => departureTime(second) - departureTime(first));
    return { upcoming, active, completed, cancelled };
  }, [driverRides, now]);

  const pendingByRide = useMemo(() => {
    const counts = new Map<string, number>();
    driverRides.forEach((ride) => {
      if (ride.status !== "active") return;
      const count = bookings.filter((booking) => booking.rideId === ride.id && booking.status === "pending").length;
      if (count > 0) counts.set(ride.id, count);
    });
    return counts;
  }, [bookings, driverRides]);

  const pendingRequests = useMemo(
    () => driverRides
      .filter((ride) => ride.status === "active")
      .flatMap((ride) => bookings
        .filter((booking) => booking.rideId === ride.id && booking.status === "pending")
        .map((booking) => ({ booking, ride })))
      .sort((first, second) => departureTime(first.ride) - departureTime(second.ride)),
    [bookings, driverRides],
  );

  const activeRides = categories.upcoming.length + categories.active.length;
  const confirmedPassengers = useMemo(
    () => bookings.filter((booking) => (
      booking.status === "confirmed"
      && driverRides.some((ride) => ride.id === booking.rideId && ride.status === "active")
    )).length,
    [bookings, driverRides],
  );
  const availableSeats = categories.upcoming.concat(categories.active)
    .reduce((total, ride) => total + Math.max(0, ride.availableSeats), 0);

  const selectedRide = lifecycleDialog
    ? driverRides.find((ride) => ride.id === lifecycleDialog.rideId) ?? null
    : null;
  const selectedPendingCount = selectedRide
    ? bookings.filter((booking) => booking.rideId === selectedRide.id && booking.status === "pending").length
    : 0;
  const selectedConfirmedCount = selectedRide
    ? bookings.filter((booking) => booking.rideId === selectedRide.id && booking.status === "confirmed").length
    : 0;

   const handleBookingUpdate = async (booking: Booking, status: BookingDecision) => {
     const key = `booking:${booking.id}`;
     if (busyKey) return;
     setBusyKey(key);
    setError("");
    setSuccess("");
    try {
      await updateBookingStatus(booking.id, status);
      setSuccess(status === "confirmed" ? "The passenger request was confirmed." : "The passenger request was rejected.");
    } catch (caught) {
      setError(errorText(caught, `We could not ${status === "confirmed" ? "confirm" : "reject"} this request.`));
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
    if (selectedRide.status !== "active") {
      setError("This ride is no longer active.");
      return;
    }
     if (lifecycleDialog.action === "complete") {
       if (selectedPendingCount > 0) {
        setError("Resolve every pending request before completing this ride.");
        return;
      }
    }
    setBusyKey(`ride:${selectedRide.id}`);
    setError("");
    setSuccess("");
    try {
      if (lifecycleDialog.action === "cancel") {
        await cancelRide(selectedRide.id);
        setSuccess("The ride was cancelled and its riders were notified.");
      } else {
        await completeRide(selectedRide.id);
        setSuccess("The ride is now marked as completed.");
      }
      setLifecycleDialog(null);
    } catch (caught) {
      setError(errorText(caught, lifecycleDialog.action === "cancel" ? "We could not cancel this ride." : "We could not complete this ride."));
    } finally {
      setBusyKey("");
    }
  };

  const categoryTabs: Array<{ id: RideCategory; label: string; count: number }> = [
    { id: "upcoming", label: "Upcoming", count: categories.upcoming.length },
    { id: "active", label: "Active", count: categories.active.length },
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
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><RouteIcon size={19} /></span><div><strong>{activeRides}</strong><span>Active & upcoming</span></div></div>
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><UsersRound size={19} /></span><div><strong>{confirmedPassengers}</strong><span>Confirmed riders</span></div></div>
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><UserRoundCheck size={19} /></span><div><strong>{pendingRequests.length}</strong><span>Pending requests</span></div></div>
          <div className="rt-rides-stat"><span className="rt-rides-stat-icon"><ShieldCheck size={19} /></span><div><strong>{availableSeats}</strong><span>Seats available</span></div></div>
        </section>

        {error && !lifecycleDialog ? <div className="rt-rides-alert" role="alert"><AlertCircle size={17} />{error}</div> : null}
        {success && !lifecycleDialog ? <div className="rt-rides-alert rt-rides-alert-success" role="status"><CheckCircle2 size={17} />{success}</div> : null}

        <RideRequests requests={pendingRequests} users={users} now={now} busyKey={busyKey} onUpdate={(booking, status) => void handleBookingUpdate(booking, status)} />

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
        title={lifecycleDialog?.action === "cancel" ? "Cancel this ride?" : "Complete this ride?"}
        size="small"
        footer={(
          <div className="rt-rides-modal-footer">
            <button className="rt-rides-action rt-rides-action--secondary" type="button" disabled={busyKey.startsWith("ride:")} onClick={closeLifecycle}>Keep ride</button>
            <button
              className={`rt-rides-action ${lifecycleDialog?.action === "cancel" ? "rt-rides-action--danger" : "rt-rides-action--primary"}`}
              type="button"
              disabled={busyKey.startsWith("ride:")}
              onClick={() => void confirmLifecycle()}
            >
              {busyKey.startsWith("ride:") ? <LoaderCircle className="rt-spin" size={16} /> : lifecycleDialog?.action === "cancel" ? <X size={16} /> : <CheckCircle2 size={16} />}
              {lifecycleDialog?.action === "cancel" ? "Cancel ride" : "Mark completed"}
            </button>
          </div>
        )}
      >
        {selectedRide ? (
          <div className="rt-rides-modal-copy">
            <p>
              {lifecycleDialog?.action === "cancel"
                ? `This will cancel ${selectedRide.origin.label} to ${selectedRide.destination.label} for everyone.`
                : `This marks ${selectedRide.origin.label} to ${selectedRide.destination.label} as completed and makes it available for trip ratings.`}
            </p>
            {lifecycleDialog?.action === "cancel" && selectedConfirmedCount > 0 ? (
              <div className="rt-rides-modal-warning"><AlertCircle size={17} /><span>{selectedConfirmedCount} confirmed {selectedConfirmedCount === 1 ? "rider has" : "riders have"} been booked. They will be notified that this ride was cancelled.</span></div>
            ) : null}
            {lifecycleDialog?.action === "complete" ? (
              <div className="rt-rides-modal-warning" style={{ color: "#536159", background: "#f1f6f3" }}><ShieldCheck size={17} /><span>Only complete the ride after the journey has finished. This action changes the booking and rating flow.</span></div>
            ) : null}
            {error ? <div className="rt-rides-alert" role="alert"><AlertCircle size={16} />{error}</div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default MyRidesPage;
