import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  CheckCircle2,
  Clock3,
  MapPinned,
  MessageCircle,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import RideCard from "../components/RideCard";
import { useApp } from "../context/AppContext";

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

const homeStyles = `
.rt-home-page { min-height: 100%; overflow: hidden; color: #17231c; background: #f7fbf8; }
.rt-home-page .container { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
.rt-home-page h1, .rt-home-page h2, .rt-home-page h3, .rt-home-page p { margin-top: 0; }
.rt-home-page .hero-section { position: relative; padding: 76px 0 82px; background: radial-gradient(circle at 78% 20%, rgba(191, 239, 207, .7), transparent 30%), linear-gradient(135deg, #f5fbf6 0%, #e8f6ec 100%); }
.rt-home-page .hero-section::after { content: ""; position: absolute; width: 360px; height: 360px; right: -160px; bottom: -220px; border: 1px solid rgba(21, 148, 71, .13); border-radius: 50%; box-shadow: 0 0 0 28px rgba(21, 148, 71, .035), 0 0 0 58px rgba(21, 148, 71, .025); pointer-events: none; }
.rt-home-page .hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(360px, .98fr); align-items: center; gap: 64px; }
.rt-home-page .hero-copy { max-width: 650px; }
.rt-home-page .eyebrow, .rt-home-page .section-kicker { display: inline-flex; align-items: center; gap: 7px; color: #148642; font-size: .73rem; font-weight: 800; letter-spacing: .075em; text-transform: uppercase; }
.rt-home-page .eyebrow { padding: 8px 12px; border: 1px solid #bde3c8; border-radius: 999px; background: rgba(255,255,255,.68); }
.rt-home-page .hero-copy h1 { max-width: 650px; margin: 22px 0 18px; color: #12351f; font-size: clamp(2.7rem, 5.2vw, 4.65rem); line-height: 1.02; letter-spacing: -.065em; }
.rt-home-page .hero-copy > p { max-width: 570px; margin-bottom: 28px; color: #5b6c61; font-size: 1.06rem; line-height: 1.7; }
.rt-home-page .hero-actions { display: flex; flex-wrap: wrap; gap: 11px; }
.rt-home-page .btn { min-height: 45px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 18px; border: 1px solid transparent; border-radius: 12px; font: inherit; font-size: .86rem; font-weight: 780; text-decoration: none; cursor: pointer; transition: transform .18s ease, background .18s ease, box-shadow .18s ease; }
.rt-home-page .btn:hover { transform: translateY(-1px); }
.rt-home-page .btn-primary { color: #fff; background: #159447; box-shadow: 0 10px 22px rgba(21,148,71,.2); }
.rt-home-page .btn-primary:hover { background: #10813b; }
.rt-home-page .btn-outline { border-color: #b8d9c1; color: #176d3a; background: rgba(255,255,255,.7); }
.rt-home-page .btn-outline:hover { border-color: #8bc89e; background: #fff; }
.rt-home-page .btn-lg { min-height: 51px; padding: 0 21px; font-size: .91rem; }
.rt-home-page .btn-light { color: #126b37; background: #fff; box-shadow: 0 10px 22px rgba(6, 52, 24, .13); }
.rt-home-page .btn-light:hover { background: #f0faf3; }
.rt-home-page .hero-trust { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 25px; color: #62756a; font-size: .73rem; font-weight: 700; }
.rt-home-page .hero-trust span { display: inline-flex; align-items: center; gap: 6px; }
.rt-home-page .hero-trust svg { color: #159447; }
.rt-home-page .card { border: 1px solid #dbe8de; border-radius: 21px; background: rgba(255,255,255,.9); box-shadow: 0 16px 40px rgba(32, 75, 45, .08); }
.rt-home-page .hero-panel { position: relative; padding: 24px; overflow: hidden; background: rgba(255,255,255,.82); }
.rt-home-page .hero-panel::before { content: ""; position: absolute; width: 170px; height: 170px; right: -80px; top: -82px; border-radius: 50%; background: rgba(21,148,71,.07); }
.rt-home-page .hero-panel-header, .rt-home-page .section-heading, .rt-home-page .driver-preview, .rt-home-page .stat-card, .rt-home-page .cta-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.rt-home-page .hero-panel h2 { max-width: 270px; margin: 7px 0 0; color: #173b25; font-size: 1.35rem; line-height: 1.15; letter-spacing: -.03em; }
.rt-home-page .status-badge { display: inline-flex; align-items: center; padding: 6px 9px; border-radius: 999px; color: #14723a; background: #e2f5e8; font-size: .67rem; font-weight: 800; white-space: nowrap; }
.rt-home-page .status-completed { color: #53665a; background: #edf1ee; }
.rt-home-page .status-cancelled { color: #a33d3d; background: #ffeded; }
.rt-home-page .route-skeleton { display: grid; gap: 15px; margin-top: 32px; }
.rt-home-page .route-skeleton span { display: block; height: 16px; border-radius: 8px; background: linear-gradient(90deg, #edf5ef, #f8fbf9, #edf5ef); background-size: 200% 100%; animation: rt-home-shimmer 1.4s infinite; }
.rt-home-page .route-skeleton span:nth-child(2) { width: 78%; }
.rt-home-page .route-skeleton span:nth-child(3) { width: 58%; margin-top: 13px; }
.rt-home-page .next-ride-preview { margin-top: 28px; }
.rt-home-page .route-labels { display: grid; gap: 10px; }
.rt-home-page .route-labels > div:not(.route-labels-line) { display: grid; grid-template-columns: 12px 43px minmax(0, 1fr); align-items: center; gap: 8px; }
.rt-home-page .route-labels small { color: #829087; font-size: .67rem; text-transform: uppercase; letter-spacing: .05em; }
.rt-home-page .route-labels strong { overflow: hidden; color: #2b4032; font-size: .83rem; text-overflow: ellipsis; white-space: nowrap; }
.rt-home-page .route-dot { width: 10px; height: 10px; border-radius: 50%; }
.rt-home-page .route-dot-origin { background: #159447; box-shadow: 0 0 0 4px #dff4e6; }
.rt-home-page .route-dot-destination { background: #ef8c47; box-shadow: 0 0 0 4px #fff0e4; }
.rt-home-page .route-labels-line { width: 1px; height: 18px; margin: -3px 0 -3px 5px; border-left: 1px dashed #b8cabe; }
.rt-home-page .next-ride-meta { display: flex; flex-wrap: wrap; gap: 9px 15px; margin: 25px 0; padding: 14px 0; border-top: 1px solid #edf2ee; border-bottom: 1px solid #edf2ee; color: #66776d; font-size: .73rem; }
.rt-home-page .next-ride-meta span { display: inline-flex; align-items: center; gap: 6px; }
.rt-home-page .next-ride-meta svg { color: #159447; }
.rt-home-page .driver-preview { align-items: flex-end; }
.rt-home-page .driver-preview strong, .rt-home-page .driver-preview span { display: block; }
.rt-home-page .driver-preview strong { color: #2c4233; font-size: .85rem; }
.rt-home-page .driver-preview span { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: #7a887f; font-size: .71rem; }
.rt-home-page .driver-preview span svg { color: #e49a2f; }
.rt-home-page .hero-empty { display: grid; justify-items: center; padding: 37px 12px 13px; text-align: center; }
.rt-home-page .hero-empty h3 { margin: 15px 0 5px; font-size: 1.05rem; }
.rt-home-page .hero-empty p { margin-bottom: 18px; color: #728077; font-size: .81rem; }
.rt-home-page .empty-icon { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; color: #148642; background: #e1f5e7; }
.rt-home-page .section { padding-top: 76px; padding-bottom: 76px; }
.rt-home-page .section-muted { background: #eef8f1; }
.rt-home-page .section-heading { align-items: flex-end; margin-bottom: 24px; }
.rt-home-page .section-heading h2 { margin: 7px 0 0; color: #183c25; font-size: clamp(1.55rem, 2.8vw, 2.1rem); letter-spacing: -.04em; }
.rt-home-page .section-heading > p { max-width: 330px; margin: 0; color: #718077; font-size: .84rem; line-height: 1.55; }
.rt-home-page .benefit-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.rt-home-page .benefit-card { padding: 23px; }
.rt-home-page .benefit-icon { width: 45px; height: 45px; display: grid; place-items: center; margin-bottom: 19px; border-radius: 14px; color: #148642; background: #e1f5e7; }
.rt-home-page .benefit-card:nth-child(2) .benefit-icon { color: #5572a0; background: #eaf0fa; }
.rt-home-page .benefit-card:nth-child(3) .benefit-icon { color: #b06c26; background: #fff1df; }
.rt-home-page .benefit-card h3 { margin-bottom: 8px; color: #24402d; font-size: 1rem; }
.rt-home-page .benefit-card p { margin: 0; color: #718077; font-size: .8rem; line-height: 1.6; }
.rt-home-page .compact-heading { margin-bottom: 17px; }
.rt-home-page .text-link { display: inline-flex; align-items: center; gap: 6px; color: #137c3d; font-size: .78rem; font-weight: 800; text-decoration: none; }
.rt-home-page .text-link:hover { color: #0e5e2e; }
.rt-home-page .quick-stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.rt-home-page .stat-card { justify-content: flex-start; padding: 16px; }
.rt-home-page .stat-icon { width: 40px; height: 40px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 12px; color: #148642; background: #e1f5e7; }
.rt-home-page .stat-card:nth-child(2) .stat-icon { color: #5572a0; background: #eaf0fa; }
.rt-home-page .stat-card:nth-child(3) .stat-icon { color: #b06c26; background: #fff1df; }
.rt-home-page .stat-card:nth-child(4) .stat-icon { color: #7651a8; background: #f1eafb; }
.rt-home-page .stat-card strong, .rt-home-page .stat-card span { display: block; }
.rt-home-page .stat-card strong { color: #203c29; font-size: 1.35rem; line-height: 1; }
.rt-home-page .stat-card span { margin-top: 5px; color: #78867d; font-size: .71rem; }
.rt-home-page .ride-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 17px; align-items: stretch; }
.rt-home-page .ride-grid .ride-card { height: 100%; }
.rt-home-page .ride-card-skeleton { min-height: 330px; background: linear-gradient(135deg, #eef7f0, #f9fcfa); }
.rt-home-page .empty-state { min-height: 240px; display: grid; place-items: center; padding: 28px; text-align: center; }
.rt-home-page .empty-state h3 { margin: 16px 0 6px; color: #27422f; }
.rt-home-page .empty-state p { margin-bottom: 18px; color: #75837a; font-size: .82rem; }
.rt-home-page .cta-section { padding-top: 0; padding-bottom: 76px; }
.rt-home-page .cta-card { padding: 34px 38px; border-radius: 24px; color: #fff; background: linear-gradient(120deg, #118943, #159447 52%, #0c7336); box-shadow: 0 20px 42px rgba(21,148,71,.2); }
.rt-home-page .cta-card h2 { margin: 7px 0 8px; font-size: 1.75rem; letter-spacing: -.04em; }
.rt-home-page .cta-card p { margin: 0; color: rgba(255,255,255,.78); font-size: .86rem; }
.rt-home-page .cta-card .section-kicker { color: #bff0cc; }
@keyframes rt-home-shimmer { to { background-position: -200% 0; } }
@media (max-width: 900px) {
  .rt-home-page .hero-grid { grid-template-columns: 1fr; gap: 38px; }
  .rt-home-page .hero-copy { max-width: 730px; }
  .rt-home-page .quick-stats-grid, .rt-home-page .ride-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .rt-home-page .container { width: min(100% - 28px, 1180px); }
  .rt-home-page .hero-section { padding: 52px 0 58px; }
  .rt-home-page .hero-copy h1 { font-size: 2.65rem; }
  .rt-home-page .hero-copy > p { font-size: .95rem; }
  .rt-home-page .hero-actions { display: grid; }
  .rt-home-page .hero-actions .btn { width: 100%; }
  .rt-home-page .hero-trust { display: grid; gap: 9px; }
  .rt-home-page .hero-panel { padding: 18px; }
  .rt-home-page .section { padding-top: 54px; padding-bottom: 54px; }
  .rt-home-page .section-heading { display: block; }
  .rt-home-page .section-heading > p { margin-top: 12px; }
  .rt-home-page .section-heading .text-link { margin-top: 14px; }
  .rt-home-page .benefit-grid, .rt-home-page .quick-stats-grid, .rt-home-page .ride-grid { grid-template-columns: 1fr; }
  .rt-home-page .cta-section { padding-bottom: 54px; }
  .rt-home-page .cta-card { display: grid; padding: 25px 21px; }
  .rt-home-page .cta-card h2 { font-size: 1.45rem; }
  .rt-home-page .cta-card .btn { width: 100%; }
}
`;

export default function HomePage() {
  const { loading, activeUser, rides, bookings, notifications, users, vehicles } = useApp();

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
      return booking.riderId === activeUser?.id && booking.status === "confirmed" && ride.status === "active" && Number.isFinite(departure) && departure > Date.now();
    }).length;
    const unread = notifications.filter(
      (notification) => notification.userId === activeUser?.id && !notification.read,
    ).length;

    return [
      { label: "Trips shared", value: offered, icon: RouteIcon },
      { label: "Booking requests", value: bookingRequests, icon: Users },
      { label: "Upcoming bookings", value: upcomingBookings, icon: CalendarDays },
      { label: "Unread updates", value: unread, icon: MessageCircle },
    ];
  }, [activeUser?.id, bookings, notifications, rides]);

  return (
    <main className="rt-home-page home-page">
      <style>{homeStyles}</style>
      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">
              <Sparkles size={16} aria-hidden="true" />
              Better journeys, shared together
            </span>
            <h1>Go together. Spend less. Travel better.</h1>
            <p>
              Find a trusted driver or share your journey with people heading your way. Every trip uses
              real routes, clear costs and community ratings.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" to="/find">
                <MapPinned size={19} aria-hidden="true" />
                Find a ride
              </Link>
              <Link className="btn btn-outline btn-lg" to="/offer">
                <CarFront size={19} aria-hidden="true" />
                Offer a ride
              </Link>
            </div>
            <div className="hero-trust" aria-label="RideTogether benefits">
              <span><CheckCircle2 size={17} /> Verified demo profiles</span>
              <span><ShieldCheck size={17} /> Safety controls</span>
              <span><Star size={17} /> Community rated</span>
            </div>
          </div>

          <div className="hero-panel card">
            <div className="hero-panel-header">
              <div>
                <span className="section-kicker">Community board</span>
                <h2>{nextRide ? "Your next shared journey" : "Ready for your next journey"}</h2>
              </div>
              <span className={`status-badge status-${nextRide?.status ?? "active"}`}>
                {nextRide ? `${nextRide.availableSeats} seats open` : "Live updates"}
              </span>
            </div>

            {loading ? (
              <div className="route-skeleton" aria-label="Loading featured ride">
                <span />
                <span />
                <span />
              </div>
            ) : nextRide ? (
              <div className="next-ride-preview">
                <div className="route-labels">
                  <div>
                    <span className="route-dot route-dot-origin" />
                    <small>From</small>
                    <strong>{nextRide.origin.label}</strong>
                  </div>
                  <div className="route-labels-line" />
                  <div>
                    <span className="route-dot route-dot-destination" />
                    <small>To</small>
                    <strong>{nextRide.destination.label}</strong>
                  </div>
                </div>
                <div className="next-ride-meta">
                  <span><CalendarDays size={18} /> {formatDeparture(nextRide.departureDate, nextRide.departureTime)}</span>
                  {nextRide.distanceKm !== undefined && (
                    <span><RouteIcon size={18} /> {nextRide.distanceKm.toFixed(1)} km</span>
                  )}
                  {nextRide.durationMinutes !== undefined && (
                    <span><Clock3 size={18} /> {Math.round(nextRide.durationMinutes)} min</span>
                  )}
                </div>
                <div className="driver-preview">
                  <div>
                    <strong>{nextRideDriver?.name ?? "Community driver"}</strong>
                    <span>
                      <Star size={15} fill="currentColor" />
                      {nextRideDriver?.rating.toFixed(1) ?? "New"} · {nextRideVehicle?.name ?? "Vehicle details in trip"}
                    </span>
                  </div>
                  <Link className="btn btn-primary" to={`/rides/${nextRide.id}`}>
                    View ride <ArrowRight size={17} />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="hero-empty">
                <div className="empty-icon"><CarFront size={30} /></div>
                <h3>No upcoming rides yet</h3>
                <p>Start a trip or explore rides offered by the community.</p>
                <Link className="btn btn-primary" to="/offer">Create the first ride</Link>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Simple, safe, social</span>
            <h2>Carpooling made refreshingly easy</h2>
          </div>
          <p>Plan less, meet people nearby and make every commute more worthwhile.</p>
        </div>
        <div className="benefit-grid">
          <article className="card benefit-card">
            <div className="benefit-icon"><MapPinned /></div>
            <h3>Search real journeys</h3>
            <p>Enter your start and destination to see matching rides along a genuine road route.</p>
          </article>
          <article className="card benefit-card">
            <div className="benefit-icon"><Users /></div>
            <h3>Choose your community</h3>
            <p>Compare drivers, ratings, contribution and available seats before you request a spot.</p>
          </article>
          <article className="card benefit-card">
            <div className="benefit-icon"><ShieldCheck /></div>
            <h3>Stay in control</h3>
            <p>Manage requests, keep trip chat together and access safety information when you need it.</p>
          </article>
        </div>
      </section>

      {!loading && activeUser && (
        <section className="section section-muted">
          <div className="container">
            <div className="section-heading compact-heading">
              <div>
                <span className="section-kicker">Your activity</span>
                <h2>Welcome back, {activeUser.name.split(" ")[0]}</h2>
              </div>
              <Link className="text-link" to="/bookings">View my bookings <ArrowRight size={17} /></Link>
            </div>
            <div className="quick-stats-grid">
              {stats.map(({ label, value, icon: Icon }) => (
                <article className="card stat-card" key={label}>
                  <div className="stat-icon"><Icon size={21} /></div>
                  <div><strong>{value}</strong><span>{label}</span></div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section container">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Fresh options</span>
            <h2>Featured community rides</h2>
          </div>
          <Link className="text-link" to="/find">Explore all rides <ArrowRight size={17} /></Link>
        </div>

        {loading ? (
          <div className="ride-grid">
            {[0, 1, 2].map((item) => <div className="card ride-card-skeleton" key={item} />)}
          </div>
        ) : featuredRides.length > 0 ? (
          <div className="ride-grid">
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
          <div className="card empty-state">
            <div className="empty-icon"><CarFront size={30} /></div>
            <h3>No active rides at the moment</h3>
            <p>Check back soon or be the first to offer a journey.</p>
            <Link className="btn btn-primary" to="/offer">Offer a ride</Link>
          </div>
        )}
      </section>

      <section className="section cta-section">
        <div className="container cta-card">
          <div>
            <span className="section-kicker">Your road, shared</span>
            <h2>Have a seat to spare?</h2>
            <p>Offer your planned journey and help another traveller get where they need to go.</p>
          </div>
          <Link className="btn btn-light btn-lg" to="/offer">
            Offer your ride <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </main>
  );
}
