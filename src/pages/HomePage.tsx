import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CarFront,
  CheckCircle2,
  Clock3,
  CreditCard,
  MapPinned,
  MessageCircle,
  Navigation,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import RideCard from "../components/RideCard";
import { EmptyState } from "../components/EmptyState";
import { StatCard } from "../components/ui/Stats";
import { SectionHeader, TrustStrip } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/State";
import HowItWorks from "../components/home/HowItWorks";
import JourneyPlanner from "../components/home/JourneyPlanner";
import { useApp } from "../context/AppContext";
import { ACTIVE_BOOKING_STATUSES } from "../types";

const formatDeparture = (date: string, time: string) => {
  const value = new Date(date.includes("T") ? date : `${date}T${time || "00:00"}`);
  if (Number.isNaN(value.getTime())) {
    return `${date} · ${time}`;
  }
  return value.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

const rideDepartureTimestamp = (date: string, time: string) =>
  new Date(date.includes("T") ? date : `${date}T${time || "00:00"}`).getTime();

/**
 * Home page styles.
 *
 * Everything here is scoped under `.rt-home` and reads from the shared tokens,
 * so the page restyles itself wholesale when the theme flips rather than
 * needing its own dark-mode overrides.
 */
const homeStyles = `
.rt-home { min-height: 100%; overflow: hidden; color: var(--rt-text); background: var(--rt-surface-subtle); }
.rt-home h1, .rt-home h2, .rt-home h3, .rt-home p { margin-top: 0; }
.rt-home__container { width: min(1240px, calc(100% - var(--rt-gutter) * 2)); margin: 0 auto; }

/* Live trip banner -------------------------------------------------------- */
/* Above the hero rather than inside it: a running trip is a state, not a
   promotion. It has to be the first thing on the page and must not scroll away
   with the marketing copy. */
.rt-home__live { position: relative; z-index: 3; border-bottom: 1px solid var(--rt-border); background: var(--rt-primary-soft); }
.rt-home__live-inner { display: flex; align-items: center; gap: var(--rt-space-3); padding: var(--rt-space-3) 0; min-width: 0; }
.rt-home__live-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: var(--rt-radius-md); color: #fff; background: var(--rt-primary); box-shadow: var(--rt-shadow-glow); }
.rt-home__live-copy { flex: 1; min-width: 0; }
.rt-home__live-copy strong { display: block; color: var(--rt-primary-deep); font-size: 0.9rem; font-weight: 700; }
.rt-home__live-copy span { display: block; margin-top: 2px; overflow: hidden; color: var(--rt-muted); font-size: 0.78rem; text-overflow: ellipsis; white-space: nowrap; }
.rt-home__live-action { flex: 0 0 auto; }

/* Hero -------------------------------------------------------------------- */
.rt-home__hero { position: relative; padding: clamp(40px, 6vw, 76px) 0 clamp(44px, 6vw, 80px); background: radial-gradient(circle at 82% 10%, var(--rt-primary-softer), transparent 45%), linear-gradient(165deg, var(--rt-surface-subtle) 0%, var(--rt-primary-softer) 100%); }
.rt-home__hero::after { content: ""; position: absolute; right: -180px; bottom: -240px; width: 420px; height: 420px; border: 1px solid var(--rt-primary-soft); border-radius: 50%; box-shadow: 0 0 0 30px var(--rt-primary-softer); pointer-events: none; }
.rt-home__hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr); align-items: center; gap: clamp(28px, 5vw, 64px); }
.rt-home__hero-copy { max-width: 640px; }
.rt-home__eyebrow { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border: 1px solid var(--rt-primary-soft); border-radius: var(--rt-radius-pill); color: var(--rt-primary-deep); background: var(--rt-primary-softer); font-size: 0.72rem; font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; }
.rt-home__hero h1 { max-width: 640px; margin: 20px 0 16px; color: var(--rt-text-strong); font-size: clamp(2.4rem, 5vw, 4.1rem); font-weight: 800; line-height: 1.03; letter-spacing: -0.04em; }
.rt-home__hero-lede { max-width: 560px; margin-bottom: 0; color: var(--rt-muted); font-size: 1.02rem; line-height: 1.65; }
.rt-home__hero-trust { display: flex; flex-wrap: wrap; gap: var(--rt-space-2) var(--rt-space-4); margin-top: var(--rt-space-5); color: var(--rt-muted); font-size: 0.75rem; font-weight: 600; }
.rt-home__hero-trust span { display: inline-flex; align-items: center; gap: 6px; }
.rt-home__hero-trust svg { color: var(--rt-primary); }

/* Community panel --------------------------------------------------------- */
.rt-home__panel { position: relative; padding: var(--rt-space-5); background: var(--rt-card); border: 1px solid var(--rt-border); border-radius: var(--rt-radius-2xl); box-shadow: var(--rt-shadow-lg); }
.rt-home__panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--rt-space-3); margin-bottom: var(--rt-space-4); }
.rt-home__panel-kicker { display: block; color: var(--rt-primary); font-size: 0.68rem; font-weight: 750; letter-spacing: 0.07em; text-transform: uppercase; }
.rt-home__panel h3 { margin: 6px 0 0; color: var(--rt-text-strong); font-size: 1.2rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
.rt-home__panel-wrap { max-width: 720px; }
.rt-home__panel-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--rt-space-3); margin-top: var(--rt-space-5); padding-top: var(--rt-space-4); border-top: 1px solid var(--rt-border-subtle); }
.rt-home__driver { min-width: 0; }
.rt-home__driver strong { display: block; color: var(--rt-text); font-size: 0.85rem; }
.rt-home__driver span { display: flex; align-items: center; gap: 5px; margin-top: 3px; color: var(--rt-muted); font-size: 0.72rem; }
.rt-home__driver span svg { color: var(--rt-warning); }

/* Route summary inside the panel ----------------------------------------- */
.rt-home__route { display: grid; gap: var(--rt-space-2); }
.rt-home__route-stop { display: grid; grid-template-columns: 10px auto minmax(0, 1fr); align-items: center; gap: var(--rt-space-2); }
.rt-home__route-dot { width: 10px; height: 10px; border-radius: 50%; }
.rt-home__route-dot--from { background: var(--rt-primary); box-shadow: 0 0 0 4px var(--rt-primary-soft); }
.rt-home__route-dot--to { background: var(--rt-destination); box-shadow: 0 0 0 4px var(--rt-destination-soft); }
.rt-home__route-stop small { color: var(--rt-muted); font-size: 0.66rem; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; }
.rt-home__route-stop strong { overflow: hidden; color: var(--rt-text); font-size: 0.83rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.rt-home__route-line { width: 1px; height: 16px; margin: -2px 0 -2px 4px; border-left: 1px dashed var(--rt-border-strong); }
.rt-home__meta { display: flex; flex-wrap: wrap; gap: var(--rt-space-2) var(--rt-space-4); margin-top: var(--rt-space-4); color: var(--rt-muted); font-size: 0.74rem; }
.rt-home__meta span { display: inline-flex; align-items: center; gap: 6px; }
.rt-home__meta svg { color: var(--rt-primary); }

/* Sections ---------------------------------------------------------------- */
.rt-home__section { padding: clamp(44px, 5vw, 76px) 0; }
.rt-home__section--tint { background: var(--rt-surface-muted); }
.rt-home__section--tight { padding-top: 0; }
.rt-home__grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--rt-space-4); }
.rt-home__grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--rt-space-3); }
.rt-home__card { padding: var(--rt-space-5); background: var(--rt-card); border: 1px solid var(--rt-border); border-radius: var(--rt-radius-card); box-shadow: var(--rt-shadow-sm); }
.rt-home__card h3 { margin-bottom: 6px; color: var(--rt-text-strong); font-size: 0.98rem; font-weight: 650; }
.rt-home__card p { margin: 0; color: var(--rt-muted); font-size: 0.81rem; line-height: 1.6; }
.rt-home__card-icon { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: var(--rt-space-4); border-radius: var(--rt-radius-md); color: var(--rt-primary-deep); background: var(--rt-primary-soft); }
.rt-home__link { display: inline-flex; align-items: center; gap: 6px; color: var(--rt-primary-deep); font-size: 0.8rem; font-weight: 700; text-decoration: none; }
.rt-home__link:hover { text-decoration: underline; }

/* Featured rides ---------------------------------------------------------- */
.rt-home__rides { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--rt-space-4); align-items: stretch; }
.rt-home__rides > * { height: 100%; }
.rt-home__skeleton { min-height: 320px; border-radius: var(--rt-radius-card); }
.rt-home__empty { background: var(--rt-card); border: 1px solid var(--rt-border); border-radius: var(--rt-radius-card); }

/* Closing CTA ------------------------------------------------------------- */
.rt-home__cta { display: flex; align-items: center; justify-content: space-between; gap: var(--rt-space-5); padding: clamp(24px, 4vw, 38px); border-radius: var(--rt-radius-2xl); color: var(--rt-text-inverse); background: linear-gradient(120deg, var(--rt-primary-deep), var(--rt-primary) 55%, var(--rt-primary-deep)); box-shadow: var(--rt-shadow-glow); }
.rt-home__cta .ds-button--inverse { color: var(--rt-primary-deep); }
.rt-home__cta h2 { margin: 6px 0 6px; color: #fff; font-size: clamp(1.3rem, 2.4vw, 1.7rem); font-weight: 750; letter-spacing: -0.03em; }
.rt-home__cta p { margin: 0; color: rgba(255, 255, 255, 0.82); font-size: 0.86rem; }
.rt-home__cta-kicker { display: block; color: var(--rt-primary-border); font-size: 0.7rem; font-weight: 750; letter-spacing: 0.07em; text-transform: uppercase; }

@media (max-width: 1024px) {
  .rt-home__hero-grid { grid-template-columns: 1fr; gap: var(--rt-space-6); }
  .rt-home__hero-copy { max-width: 720px; }
  .rt-home__grid-4, .rt-home__rides { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 860px) {
  .rt-home__grid-3 { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .rt-home__grid-4, .rt-home__rides { grid-template-columns: 1fr; }
  .rt-home__live-inner { flex-wrap: wrap; gap: var(--rt-space-2) var(--rt-space-3); }
  .rt-home__live-icon { order: 1; }
  .rt-home__live-copy { flex: 1 1 100%; order: 2; }
  .rt-home__live-copy span { white-space: normal; line-height: 1.4; }
  .rt-home__live-action { order: 1; margin-left: auto; }
  .rt-home__hero h1 { font-size: 2.4rem; }
  .rt-home__hero-lede { font-size: 0.95rem; }
  .rt-home__hero-trust { display: grid; gap: var(--rt-space-2); }
  .rt-home__panel { padding: var(--rt-space-4); }
  .rt-home__panel-foot { display: grid; justify-items: stretch; }
  .rt-home__cta { display: grid; }
  .rt-home__card { padding: var(--rt-space-4); }
}
`;

const HOW_IT_WORKS = [
  {
    id: "search",
    title: "Search a real route",
    description: "Enter where you are going and we match rides along a genuine road route, not a straight line.",
    icon: MapPinned,
  },
  {
    id: "request",
    title: "Request a seat",
    description: "Compare drivers, ratings, contribution and seats. Send a request and the driver decides.",
    icon: Users,
  },
  {
    id: "connect",
    title: "Chat and meet up",
    description: "Agree the meeting point in trip chat, then follow the journey together in real time.",
    icon: MessageCircle,
  },
  {
    id: "rate",
    title: "Rate and repeat",
    description: "When the trip ends, rate each other so the community stays trustworthy for the next journey.",
    icon: Star,
  },
];

const TRUST_ITEMS = [
  { icon: <BadgeCheck size={19} />, title: "Community rated", body: "Every completed trip can be rated 1 to 5." },
  { icon: <ShieldCheck size={19} />, title: "Safety tools", body: "Emergency contacts and trip chat on every ride." },
  { icon: <RouteIcon size={19} />, title: "Real routes", body: "Distance and time come from live road routing." },
  { icon: <CreditCard size={19} />, title: "Clear costs", body: "See the contribution before you request a seat." },
];

export default function HomePage() {
  const { loading, activeUser, rides, bookings, notifications, users, vehicles } = useApp();

  /**
   * Who is actually in the car: confirmed and boarded riders on one ride.
   * Used only for the live-trip banner, where an accurate headcount matters
   * more than a total of every booking ever made against it.
   */
  const partyFor = (rideId: string) => bookings.filter((booking) => (
    booking.rideId === rideId
    && (booking.status === "confirmed" || booking.status === "picked_up")
  )).length;

  const featuredRides = useMemo(
    () =>
      rides
        .filter((ride) => {
          const departure = rideDepartureTimestamp(ride.departureDate, ride.departureTime);
          return ride.status === "active" && Number.isFinite(departure) && departure > Date.now();
        })
        .sort(
          (first, second) =>
            rideDepartureTimestamp(first.departureDate, first.departureTime) -
            rideDepartureTimestamp(second.departureDate, second.departureTime),
        )
        .slice(0, 3),
    [rides],
  );

  const nextRide = useMemo(() => {
    const now = Date.now();
    return featuredRides.find((ride) => {
      const departure = rideDepartureTimestamp(ride.departureDate, ride.departureTime);
      return Number.isFinite(departure) && departure >= now;
    });
  }, [featuredRides]);

  /**
   * A trip that is under way right now, from either side of it.
   *
   * The featured panel below only ever looks at future departures, so a member
   * who is mid-journey - driving with passengers, or riding - would open the app
   * and be told there is "no upcoming rides yet" while the trip they are in is
   * running. This takes priority over the panel so the most time-sensitive thing
   * on the product is the first thing on the home page.
   */
  const liveTrip = useMemo(() => {
    const mine = rides.filter((ride) => ride.status === "in_progress");
    const driven = mine.find((ride) => ride.driverId === activeUser?.id);
    if (driven) return { ride: driven, asDriver: true, party: partyFor(driven.id) };
    const booked = mine.find((ride) => bookings.some((booking) => (
      booking.rideId === ride.id
      && booking.riderId === activeUser?.id
      && ACTIVE_BOOKING_STATUSES.includes(booking.status)
    )));
    if (booked) return { ride: booked, asDriver: false, party: partyFor(booked.id) };
    return null;
    // `partyFor` reads the same `bookings` array the memo is given, so it does
    // not need to be a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, rides, activeUser?.id]);

  const liveTripDriver = users.find((user) => user.id === liveTrip?.ride.driverId);
  const nextRideDriver = users.find((user) => user.id === nextRide?.driverId);
  const nextRideVehicle = vehicles.find((vehicle) => vehicle.id === nextRide?.vehicleId);

  const stats = useMemo(() => {
    const offered = rides.filter((ride) => ride.driverId === activeUser?.id).length;
    const bookingRequests = bookings.filter((booking) => {
      const ride = rides.find((item) => item.id === booking.rideId);
      return ride?.driverId === activeUser?.id && booking.status === "pending";
    }).length;
    const upcomingBookings = bookings.filter((booking) => {
      const ride = rides.find((item) => item.id === booking.rideId);
      if (!ride) return false;
      const departure = rideDepartureTimestamp(ride.departureDate, ride.departureTime);
      return booking.riderId === activeUser?.id && booking.status === "confirmed"
        && ride.status === "active" && Number.isFinite(departure) && departure > Date.now();
    }).length;
    const unread = notifications.filter(
      (notification) => notification.userId === activeUser?.id && !notification.read,
    ).length;

    return [
      { label: "Trips shared", value: offered, icon: RouteIcon, tone: "brand" as const },
      { label: "Booking requests", value: bookingRequests, icon: Users, tone: "info" as const },
      { label: "Upcoming bookings", value: upcomingBookings, icon: CalendarDays, tone: "success" as const },
      { label: "Unread updates", value: unread, icon: MessageCircle, tone: "warning" as const },
    ];
  }, [activeUser?.id, bookings, notifications, rides]);

  return (
    <main className="rt-home home-page">
      <style>{homeStyles}</style>

      {liveTrip ? (
        <section className="rt-home__live" aria-label="Trip in progress">
          <div className="rt-home__container rt-home__live-inner">
            <span className="rt-home__live-icon" aria-hidden="true">
              <Navigation size={19} />
            </span>
            <div className="rt-home__live-copy">
              <strong>
                {liveTrip.asDriver
                  ? "You are driving now"
                  : `On the way with ${liveTripDriver?.name ?? "your driver"}`}
              </strong>
              <span>
                {liveTrip.ride.origin.label} to {liveTrip.ride.destination.label}
                {liveTrip.asDriver
                  ? ` · ${liveTrip.party} ${liveTrip.party === 1 ? "rider" : "riders"} on board`
                  : " · follow the driver's live position"}
              </span>
            </div>
            <Link className="ds-button ds-button--primary ds-button--sm rt-home__live-action" to={`/rides/${liveTrip.ride.id}`}>
              {liveTrip.asDriver ? "Manage trip" : "Open trip"}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      ) : null}

      <section className="rt-home__hero">
        <div className="rt-home__container rt-home__hero-grid">
          <div className="rt-home__hero-copy">
            <span className="rt-home__eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              Better journeys, shared together
            </span>
            <h1>Go together. Spend less. Travel better.</h1>
            <p className="rt-home__hero-lede">
              Find a trusted driver or share your journey with people heading your way. Every trip uses
              real routes, clear costs and community ratings.
            </p>
            <div className="rt-home__hero-trust">
              <span><CheckCircle2 size={16} /> Verified demo profiles</span>
              <span><ShieldCheck size={16} /> Safety controls</span>
              <span><Star size={16} /> Community rated</span>
            </div>
          </div>

          <JourneyPlanner />
        </div>
      </section>

      <section className="rt-home__section rt-home__section--tight" aria-labelledby="home-board-title">
        <div className="rt-home__container rt-home__panel-wrap">
          <h2 className="ds-visually-hidden" id="home-board-title">Community board</h2>
          <div className="rt-home__panel">
            <div className="rt-home__panel-head">
              <div>
                <span className="rt-home__panel-kicker">Community board</span>
                <h3>{nextRide ? "Your next shared journey" : "Ready for your next journey"}</h3>
              </div>
              {nextRide ? (
                <span className="ds-badge ds-badge--success">
                  {nextRide.availableSeats} {nextRide.availableSeats === 1 ? "seat" : "seats"} open
                </span>
              ) : null}
            </div>

            {loading ? (
              <div aria-label="Loading featured ride">
                <Skeleton className="rt-home__skeleton" />
              </div>
            ) : nextRide ? (
              <>
                <div className="rt-home__route">
                  <div className="rt-home__route-stop">
                    <span className="rt-home__route-dot rt-home__route-dot--from" aria-hidden="true" />
                    <small>From</small>
                    <strong>{nextRide.origin.label}</strong>
                  </div>
                  <div className="rt-home__route-line" aria-hidden="true" />
                  <div className="rt-home__route-stop">
                    <span className="rt-home__route-dot rt-home__route-dot--to" aria-hidden="true" />
                    <small>To</small>
                    <strong>{nextRide.destination.label}</strong>
                  </div>
                </div>
                <div className="rt-home__meta">
                  <span><CalendarDays size={16} aria-hidden="true" /> {formatDeparture(nextRide.departureDate, nextRide.departureTime)}</span>
                  {nextRide.distanceKm !== undefined ? (
                    <span><RouteIcon size={16} aria-hidden="true" /> {nextRide.distanceKm.toFixed(1)} km</span>
                  ) : null}
                  {nextRide.durationMinutes !== undefined ? (
                    <span><Clock3 size={16} aria-hidden="true" /> {Math.round(nextRide.durationMinutes)} min</span>
                  ) : null}
                </div>
                <div className="rt-home__panel-foot">
                  <div className="rt-home__driver">
                    <strong>{nextRideDriver?.name ?? "Community driver"}</strong>
                    <span>
                      <Star size={14} fill="currentColor" aria-hidden="true" />
                      {nextRideDriver?.rating.toFixed(1) ?? "New"} · {nextRideVehicle?.name ?? "Vehicle details in trip"}
                    </span>
                  </div>
                  <Link className="ds-button ds-button--primary ds-button--sm" to={`/rides/${nextRide.id}`}>
                    View ride <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </>
            ) : (
              <EmptyState
                icon={CarFront}
                title="No upcoming rides yet"
                description="Start a trip or explore rides offered by the community."
                action={<Link className="ds-button ds-button--primary" to="/offer">Create the first ride</Link>}
              />
            )}
          </div>
        </div>
      </section>

      <section className="rt-home__section rt-home__section--tint">
        <div className="rt-home__container">
          <SectionHeader
            as="h2"
            title="How a shared journey actually works"
            description="No detours, no haggling. Pick a route, request a seat, meet your driver in trip chat, and rate each other afterwards."
          />
          <HowItWorks steps={HOW_IT_WORKS} />
        </div>
      </section>

      {activeUser ? (
        <section className="rt-home__section">
          <div className="rt-home__container">
            <SectionHeader
              as="h2"
              title={`Welcome back, ${activeUser.name.split(" ")[0]}`}
              description="Everything you are sharing, requesting and waiting on, in one place."
              action={<Link className="rt-home__link" to="/bookings">View my bookings <ArrowRight size={16} aria-hidden="true" /></Link>}
            />
            <div className="rt-home__grid-4">
              {stats.map((stat) => (
                <StatCard key={stat.label} icon={stat.icon} value={stat.value} label={stat.label} tone={stat.tone} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rt-home__section">
        <div className="rt-home__container">
          <SectionHeader
            as="h2"
            title="Featured community rides"
            description="The next journeys being offered by members near you."
            action={<Link className="rt-home__link" to="/find">Explore all rides <ArrowRight size={16} aria-hidden="true" /></Link>}
          />

          {loading ? (
            <div className="rt-home__rides">
              {[0, 1, 2].map((item) => <Skeleton className="rt-home__skeleton" key={item} />)}
            </div>
          ) : featuredRides.length > 0 ? (
            <div className="rt-home__rides">
              {featuredRides.map((ride) => (
                <RideCard
                  key={ride.id}
                  ride={ride}
                  driver={users.find((user) => user.id === ride.driverId)}
                  vehicle={vehicles.find((vehicle) => vehicle.id === ride.vehicleId)}
                  currentUserId={activeUser?.id}
                />
              ))}
            </div>
          ) : (
            <div className="rt-home__empty">
              <EmptyState
                icon={CarFront}
                title="No active rides at the moment"
                description="Check back soon or be the first to offer a journey."
                action={<Link className="ds-button ds-button--primary" to="/offer">Offer a ride</Link>}
              />
            </div>
          )}
        </div>
      </section>

      <section className="rt-home__section rt-home__section--tight">
        <div className="rt-home__container">
          <TrustStrip items={TRUST_ITEMS} />
        </div>
      </section>

      <section className="rt-home__section">
        <div className="rt-home__container">
          <div className="rt-home__cta">
            <div>
              <span className="rt-home__cta-kicker">Your road, shared</span>
              <h2>Have a seat to spare?</h2>
              <p>Offer your planned journey and help another traveller get where they need to go.</p>
            </div>
            <Link className="ds-button ds-button--lg ds-button--inverse" to="/offer">
              Offer your ride <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
