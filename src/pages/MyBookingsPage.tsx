import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Route as RouteIcon,
  Search,
  TicketCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import RideCard from "../components/RideCard";
import { useApp } from "../context/AppContext";
import type { Booking, BookingStatus, Ride, User, Vehicle } from "../types";

interface BookingEntry {
  booking: Booking;
  ride: Ride | null;
  driver: User | null;
  timestamp: number;
}

interface CancellationDialog {
  bookingId: string;
}

const myBookingsStyles = `
.rt-bookings-page { min-height: 100%; padding: 28px 20px 60px; color: var(--rt-text, #17231c); background: var(--rt-surface-subtle, #f6faf7); }
.rt-bookings-shell { max-width: 1180px; margin: 0 auto; }
.rt-bookings-heading { display: flex; align-items: center; gap: 7px; color: #148642; font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.rt-bookings-find { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 17px; border: 0; border-radius: 12px; color: #fff; background: #159447; box-shadow: 0 8px 20px rgba(21,148,71,.2); font: inherit; font-size: .84rem; font-weight: 780; text-decoration: none; }
.rt-bookings-find:hover { background: #10813b; }
.rt-bookings-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0 26px; }
.rt-bookings-stat { display: flex; align-items: center; gap: 12px; padding: 15px; border: 1px solid var(--rt-border, #dce7df); border-radius: 17px; background: var(--rt-card, #fff); box-shadow: 0 8px 24px rgba(29,64,42,.045); }
.rt-bookings-stat-icon { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 12px; color: #148642; background: #e2f5e8; }
.rt-bookings-stat:nth-child(2) .rt-bookings-stat-icon { color: #2563a7; background: #e9f2fb; }
.rt-bookings-stat:nth-child(3) .rt-bookings-stat-icon { color: #a56608; background: #fff3dc; }
.rt-bookings-stat strong { display: block; font-size: 1.16rem; line-height: 1; }
.rt-bookings-stat span:last-child { display: block; margin-top: 5px; color: #748178; font-size: .72rem; }
.rt-bookings-alert { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 18px; padding: 12px 14px; border: 1px solid #efb9b9; border-radius: 13px; color: #a43131; background: #fff1f1; font-size: .81rem; line-height: 1.45; }
.rt-bookings-alert-success { border-color: #bce4c9; color: #116f38; background: #edf9f1; }
.rt-bookings-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-bookings-section { margin-top: 26px; }
.rt-bookings-section:first-of-type { margin-top: 0; }
.rt-bookings-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin-bottom: 13px; }
.rt-bookings-section-title { display: flex; align-items: center; gap: 9px; }
.rt-bookings-section-title > span { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 11px; color: #148642; background: #e2f5e8; }
.rt-bookings-section h2 { margin: 0; font-size: 1.06rem; letter-spacing: -.018em; }
.rt-bookings-section-head p { margin: 4px 0 0; color: #748178; font-size: .78rem; }
.rt-bookings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; align-items: start; }
.rt-bookings-grid .ride-card { height: 100%; }
.rt-bookings-status-line { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.rt-bookings-status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 999px; color: #526259; background: #f0f4f2; font-size: .69rem; font-weight: 800; text-transform: capitalize; }
.rt-bookings-status--confirmed { color: #116f39; background: #e2f5e9; }
.rt-bookings-status--pending { color: #94600a; background: #fff2d8; }
.rt-bookings-status--rejected { color: #a13939; background: #fdeaea; }
.rt-bookings-status--cancelled { color: #66726b; background: #edf0ee; }
.rt-bookings-status--completed { color: #116f39; background: #e2f5e9; }
.rt-bookings-window { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 999px; color: #526259; background: #f1f5f2; font-size: .69rem; font-weight: 720; }
.rt-bookings-window--departed { color: #116f39; background: #e2f5e9; }
.rt-bookings-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; width: 100%; }
.rt-bookings-action { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; border-radius: 11px; font: inherit; font-size: .76rem; font-weight: 760; text-decoration: none; cursor: pointer; }
.rt-bookings-action--primary { border: 0; color: #fff; background: #159447; }
.rt-bookings-action--primary:hover { background: #10813b; }
.rt-bookings-action--secondary { border: 1px solid #d8e3db; color: #4d5d54; background: #fff; }
.rt-bookings-action--secondary:hover { border-color: #b9d6c3; background: #f1f9f4; }
.rt-bookings-action--danger { border: 1px solid #edc2c2; color: #a63838; background: #fff7f7; }
.rt-bookings-action--danger:hover { background: #feecec; }
.rt-bookings-action:disabled { opacity: .48; cursor: not-allowed; }
.rt-bookings-lock-note { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: #7a877f; font-size: .69rem; line-height: 1.4; }
.rt-bookings-empty { min-height: 220px; display: grid; place-items: center; border: 1px dashed #cad8cf; border-radius: 20px; background: rgba(255,255,255,.55); }
.rt-bookings-missing { height: 100%; display: grid; align-content: center; justify-items: center; min-height: 270px; padding: 26px; border: 1px solid #e1e8e3; border-radius: 20px; background: var(--rt-card, #fff); text-align: center; }
.rt-bookings-missing-icon { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 17px; color: #7a877f; background: #edf2ef; }
.rt-bookings-missing h3 { margin: 15px 0 5px; font-size: 1rem; }
.rt-bookings-missing p { max-width: 360px; margin: 0; color: #738078; font-size: .8rem; line-height: 1.55; }
.rt-bookings-modal-copy { display: grid; gap: 13px; color: #59675f; font-size: .86rem; line-height: 1.6; }
.rt-bookings-modal-warning { display: flex; align-items: flex-start; gap: 9px; padding: 12px; border-radius: 12px; color: #8f3838; background: #fff0f0; font-size: .79rem; line-height: 1.5; }
.rt-bookings-modal-warning svg { flex: 0 0 auto; margin-top: 2px; }
.rt-bookings-modal-footer { display: flex; justify-content: flex-end; gap: 9px; width: 100%; }
.rt-bookings-spin { animation: rt-bookings-spin .8s linear infinite; }
@keyframes rt-bookings-spin { to { transform: rotate(360deg); } }
[data-theme="dark"] .rt-bookings-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-bookings-stat, [data-theme="dark"] .rt-bookings-empty { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-bookings-section-head p { color: #a6b5ac; }
[data-theme="dark"] .rt-bookings-status, [data-theme="dark"] .rt-bookings-window { color: #c5d0c9; background: #263229; }
[data-theme="dark"] .rt-bookings-action--secondary { color: #dce7df; background: #1a251e; border-color: #3a4a40; }
[data-theme="dark"] .rt-bookings-missing { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-bookings-missing p { color: #a6b5ac; }
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

const statusText: Record<BookingStatus, string> = {
  pending: "Awaiting driver",
  confirmed: "Seat confirmed",
  rejected: "Request declined",
  cancelled: "Booking cancelled",
  completed: "Journey completed",
};

const statusIcon: Record<BookingStatus, typeof Clock3> = {
  pending: Clock3,
  confirmed: CheckCircle2,
  rejected: XCircle,
  cancelled: History,
  completed: CheckCircle2,
};

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

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
  onCancel: (booking: Booking) => void;
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
  onCancel,
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
            const StatusIcon = statusIcon[booking.status];
            const vehicle = ride ? vehicles.find((item) => item.id === ride.vehicleId) : undefined;
            const departure = ride ? getDeparture(ride) : null;
            const departed = Boolean(departure && departure.getTime() <= now);
            const canCancel = Boolean(
              ride
              && departure
              && ride.status === "active"
              && departure.getTime() > now
              && (booking.status === "pending" || booking.status === "confirmed"),
            );
             const canChat = Boolean(
               ride
               && (booking.status === "pending" || booking.status === "confirmed" || booking.status === "completed"),
             );
            const cancellationLocked = Boolean(
              ride
              && ride.status === "active"
              && departed
              && (booking.status === "pending" || booking.status === "confirmed"),
            );

            if (!ride) {
              return (
                <article className="rt-bookings-missing" key={booking.id}>
                  <span className="rt-bookings-missing-icon"><RouteIcon size={25} /></span>
                  <h3>Ride details unavailable</h3>
                  <p>This saved booking points to a ride that is no longer available. Its status remains {statusText[booking.status].toLowerCase()}.</p>
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
                    {canCancel ? (
                      <button className="rt-bookings-action rt-bookings-action--danger" type="button" disabled={cancelling} onClick={() => onCancel(booking)}>
                        <XCircle size={15} aria-hidden="true" /> Cancel
                      </button>
                    ) : null}
                  </div>
                )}
              >
                <div className="rt-bookings-status-line">
                  <span className={`rt-bookings-status rt-bookings-status--${booking.status}`}><StatusIcon size={12} aria-hidden="true" /> {statusText[booking.status]}</span>
                  {booking.status === "pending" || booking.status === "confirmed" ? (
                    <span className={`rt-bookings-window${departed ? " rt-bookings-window--departed" : ""}`}>
                      <Clock3 size={12} /> {!departure ? "Departure unavailable" : departed ? "Journey started" : `Departs in ${formatRelativeDeparture(timestamp, now)}`}
                    </span>
                  ) : null}
                </div>
                {cancellationLocked ? <p className="rt-bookings-lock-note"><LockKeyhole size={13} /> Cancellation closes when the scheduled departure begins. Contact the driver if plans change.</p> : null}
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
    updateBookingStatus,
  } = useApp();
  const [cancellationDialog, setCancellationDialog] = useState<CancellationDialog | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    setCancellationDialog(null);
    setError("");
    setSuccess("");
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

  const currentEntries = useMemo(() => entries
    .filter(({ booking, ride, timestamp }) => (
      ride?.status === "active"
      && (booking.status === "pending" || booking.status === "confirmed")
    ))
    .sort((first, second) => {
      const firstDeparted = first.timestamp <= now;
      const secondDeparted = second.timestamp <= now;
      if (firstDeparted !== secondDeparted) return firstDeparted ? -1 : 1;
      return firstDeparted ? second.timestamp - first.timestamp : first.timestamp - second.timestamp;
    }), [entries, now]);

  const historyEntries = useMemo(() => entries
    .filter(({ booking, ride }) => (
      !ride
      || ride.status !== "active"
       || booking.status === "rejected"
       || booking.status === "cancelled"
       || booking.status === "completed"
     ))
    .sort((first, second) => second.timestamp - first.timestamp), [entries]);

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
    if (!["pending", "confirmed"].includes(selectedBooking.status) || selectedRide.status !== "active") {
      setError("This booking is no longer eligible for cancellation.");
      return;
    }
    const selectedDeparture = getDeparture(selectedRide);
    if (!selectedDeparture || selectedDeparture.getTime() <= Date.now()) {
      setError("Cancellation closes when the scheduled departure begins.");
      return;
    }
    setCancelling(true);
    setError("");
    setSuccess("");
    try {
      await updateBookingStatus(selectedBooking.id, "cancelled");
      setSuccess("Your booking was cancelled. The driver has been notified.");
      setCancellationDialog(null);
    } catch (caught) {
      setError(errorText(caught, "We could not cancel this booking."));
    } finally {
      setCancelling(false);
    }
  };

   const confirmedSeats = entries
     .filter(({ booking }) => booking.status === "confirmed" || booking.status === "completed")
     .reduce((total, { booking }) => total + booking.seats, 0);
  const upcomingSeats = currentEntries
    .filter(({ timestamp }) => timestamp > now)
    .reduce((total, { booking }) => total + booking.seats, 0);

  return (
    <div className="rt-bookings-page">
      <style>{myBookingsStyles}</style>
      <div className="rt-bookings-shell">
        <PageHeader
          title="My bookings"
          description="Follow your requested seats, message drivers, and manage upcoming journeys."
          eyebrow={<span className="rt-bookings-heading"><TicketCheck size={15} /> Rider dashboard</span>}
          actions={<Link className="rt-bookings-find" to="/find"><Search size={17} /> Find a ride</Link>}
        />

        <section className="rt-bookings-summary" aria-label="Booking overview">
          <div className="rt-bookings-stat"><span className="rt-bookings-stat-icon"><CalendarDays size={19} /></span><div><strong>{currentEntries.length}</strong><span>Current bookings</span></div></div>
          <div className="rt-bookings-stat"><span className="rt-bookings-stat-icon"><CheckCircle2 size={19} /></span><div><strong>{confirmedSeats}</strong><span>Confirmed seats</span></div></div>
          <div className="rt-bookings-stat"><span className="rt-bookings-stat-icon"><UsersRound size={19} /></span><div><strong>{upcomingSeats}</strong><span>Upcoming seats</span></div></div>
        </section>

        {error && !cancellationDialog ? <div className="rt-bookings-alert" role="alert"><AlertCircle size={17} />{error}</div> : null}
        {success ? <div className="rt-bookings-alert rt-bookings-alert-success" role="status"><CheckCircle2 size={17} />{success}</div> : null}

        <BookingSection
          title="Current & upcoming"
          description="Pending and confirmed journeys that have not been cancelled."
          entries={currentEntries}
          icon={CalendarDays}
          emptyTitle="No current bookings"
          emptyDescription="Find a compatible community ride and send the driver a seat request."
          vehicles={vehicles}
          activeUserId={activeUserId}
          now={now}
          cancelling={cancelling}
          onCancel={openCancellation}
        />
        <BookingSection
          title="Booking history"
          description="Completed, declined, cancelled, and unavailable ride records."
          entries={historyEntries}
          icon={History}
          emptyTitle="No booking history"
          emptyDescription="Completed and closed booking records will stay here for easy reference."
          vehicles={vehicles}
          activeUserId={activeUserId}
          now={now}
          cancelling={cancelling}
          onCancel={openCancellation}
          history
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
                ? "This seat will be returned to the driver immediately and the driver will be notified."
                : "The pending request will be withdrawn and the driver will no longer be able to confirm it."}</span>
            </div>
            {error ? <div className="rt-bookings-alert" role="alert"><AlertCircle size={16} />{error}</div> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default MyBookingsPage;
