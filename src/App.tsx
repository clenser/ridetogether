import { useEffect } from "react";
import { ArrowLeft, Compass, Home, MapPinned } from "lucide-react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import ChatPage from "./pages/ChatPage";
import FindRidePage from "./pages/FindRidePage";
import HomePage from "./pages/HomePage";
import MyBookingsPage from "./pages/MyBookingsPage";
import MyRidesPage from "./pages/MyRidesPage";
import NotificationsPage from "./pages/NotificationsPage";
import OfferRidePage from "./pages/OfferRidePage";
import ProfilePage from "./pages/ProfilePage";
import RideDetailsPage from "./pages/RideDetailsPage";
import SafetyPage from "./pages/SafetyPage";
import SettingsPage from "./pages/SettingsPage";
import VehiclesPage from "./pages/VehiclesPage";

const notFoundStyles = `
.rt-not-found {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: clamp(32px, 6vw, 72px) 20px;
  color: #17231c;
  background:
    radial-gradient(circle at 50% 10%, rgba(185, 235, 202, .58), transparent 32%),
    linear-gradient(145deg, #f7fbf8, #eef8f1);
}
.rt-not-found__card {
  position: relative;
  width: min(720px, 100%);
  overflow: hidden;
  border: 1px solid #d5e6da;
  border-radius: 28px;
  background: rgba(255, 255, 255, .94);
  box-shadow: 0 24px 64px rgba(24, 77, 43, .12);
  text-align: center;
}
.rt-not-found__visual {
  position: relative;
  min-height: 210px;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 34px 24px 20px;
  background:
    radial-gradient(circle at 24% 18%, rgba(255, 255, 255, .74), transparent 24%),
    linear-gradient(135deg, #159447, #0d7d3c);
}
.rt-not-found__visual::before,
.rt-not-found__visual::after {
  content: "";
  position: absolute;
  border: 1px solid rgba(255, 255, 255, .16);
  border-radius: 50%;
}
.rt-not-found__visual::before {
  width: 260px;
  height: 260px;
  top: -174px;
  left: -58px;
  box-shadow: 0 0 0 28px rgba(255, 255, 255, .045), 0 0 0 58px rgba(255, 255, 255, .025);
}
.rt-not-found__visual::after {
  width: 190px;
  height: 190px;
  right: -80px;
  bottom: -135px;
  box-shadow: 0 0 0 25px rgba(255, 255, 255, .04);
}
.rt-not-found__code {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 1px solid rgba(255, 255, 255, .2);
  border-radius: 999px;
  color: #fff;
  background: rgba(7, 93, 43, .25);
  box-shadow: 0 10px 28px rgba(5, 70, 31, .16);
  font-size: .8rem;
  font-weight: 850;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.rt-not-found__pin {
  width: 76px;
  height: 76px;
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  margin: 2px auto 0;
  border: 1px solid rgba(255, 255, 255, .24);
  border-radius: 24px;
  color: #159447;
  background: #fff;
  box-shadow: 0 15px 30px rgba(5, 70, 31, .2);
  transform: rotate(-5deg);
}
.rt-not-found__copy {
  padding: clamp(28px, 5vw, 44px) clamp(22px, 6vw, 52px) clamp(30px, 5vw, 46px);
}
.rt-not-found__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #148642;
  font-size: .72rem;
  font-weight: 850;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.rt-not-found h1 {
  margin: 11px 0 10px;
  color: #183c25;
  font-size: clamp(1.75rem, 5vw, 2.65rem);
  line-height: 1.08;
  letter-spacing: -.045em;
}
.rt-not-found__description {
  max-width: 520px;
  margin: 0 auto;
  color: #6b7c72;
  font-size: .92rem;
  line-height: 1.65;
}
.rt-not-found__path {
  max-width: 520px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin: 22px auto 0;
  padding: 11px 13px;
  border: 1px solid #dce8df;
  border-radius: 12px;
  color: #67786e;
  background: #f5f9f6;
  font-size: .73rem;
  text-align: left;
}
.rt-not-found__path span {
  flex: 0 0 auto;
  font-weight: 750;
}
.rt-not-found__path code {
  min-width: 0;
  overflow: hidden;
  color: #28533a;
  font-family: inherit;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rt-not-found__actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 25px;
}
.rt-not-found__button {
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  font: inherit;
  font-size: .82rem;
  font-weight: 800;
  text-decoration: none;
  transition: transform .18s ease, background .18s ease, border-color .18s ease;
}
.rt-not-found__button--primary {
  color: #fff;
  background: #159447;
  box-shadow: 0 9px 20px rgba(21, 148, 71, .2);
}
.rt-not-found__button--primary:hover {
  background: #10813b;
  transform: translateY(-1px);
}
.rt-not-found__button--secondary {
  border-color: #cfe0d5;
  color: #345343;
  background: #fff;
}
.rt-not-found__button--secondary:hover {
  border-color: #a8cfb5;
  background: #f1f9f3;
  transform: translateY(-1px);
}
[data-theme="dark"] .rt-not-found {
  color: #eef7f1;
  background: radial-gradient(circle at 50% 10%, rgba(39, 102, 62, .4), transparent 32%), linear-gradient(145deg, #101712, #142219);
}
[data-theme="dark"] .rt-not-found__card {
  border-color: #2b3a30;
  background: rgba(23, 33, 26, .96);
  box-shadow: 0 24px 64px rgba(0, 0, 0, .25);
}
[data-theme="dark"] .rt-not-found__copy h1 { color: #eef7f1; }
[data-theme="dark"] .rt-not-found__description { color: #a6b5ac; }
[data-theme="dark"] .rt-not-found__path {
  border-color: #34463a;
  color: #a6b5ac;
  background: #1b271f;
}
[data-theme="dark"] .rt-not-found__path code { color: #d5eadc; }
[data-theme="dark"] .rt-not-found__button--secondary {
  border-color: #3b4e41;
  color: #eef7f1;
  background: #1a251e;
}
@media (max-width: 560px) {
  .rt-not-found { padding: 22px 14px 34px; }
  .rt-not-found__card { border-radius: 22px; }
  .rt-not-found__visual { min-height: 180px; }
  .rt-not-found__actions { display: grid; }
  .rt-not-found__button { width: 100%; }
}
`;

const getDocumentTitle = (pathname: string) => {
  if (pathname === "/") return "RideTogether | Go together, travel better";
  if (pathname === "/find") return "Find a Ride | RideTogether";
  if (pathname === "/offer" || pathname.startsWith("/offer/")) return "Offer a Ride | RideTogether";
  if (pathname === "/rides") return "My Rides | RideTogether";
  if (pathname.startsWith("/rides/")) return "Ride Details | RideTogether";
  if (pathname === "/bookings") return "My Bookings | RideTogether";
  if (pathname.startsWith("/chat/")) return "Ride Chat | RideTogether";
  if (pathname === "/notifications") return "Notifications | RideTogether";
  if (pathname === "/profile") return "Profile | RideTogether";
  if (pathname === "/vehicles") return "My Vehicles | RideTogether";
  if (pathname === "/safety") return "Safety Center | RideTogether";
  if (pathname === "/settings") return "Settings | RideTogether";
  return "Page Not Found | RideTogether";
};

function NotFoundPage({ pathname }: { pathname: string }) {
  return (
    <section className="rt-not-found" aria-labelledby="not-found-title">
      <style>{notFoundStyles}</style>
      <div className="rt-not-found__card">
        <div className="rt-not-found__visual" aria-hidden="true">
          <span className="rt-not-found__code">Error 404</span>
          <span className="rt-not-found__pin"><MapPinned size={38} strokeWidth={2.15} /></span>
        </div>
        <div className="rt-not-found__copy">
          <span className="rt-not-found__eyebrow"><Compass size={15} /> Route not found</span>
          <h1 id="not-found-title">This path is off the map</h1>
          <p className="rt-not-found__description">
            The page may have moved, or the address may be incomplete. Let’s get you back to familiar roads.
          </p>
          <div className="rt-not-found__path">
            <span>Requested path</span>
            <code>{pathname}</code>
          </div>
          <div className="rt-not-found__actions">
            <Link className="rt-not-found__button rt-not-found__button--primary" to="/">
              <Home size={17} /> Back to home
            </Link>
            <Link className="rt-not-found__button rt-not-found__button--secondary" to="/find">
              <ArrowLeft size={17} /> Find a ride
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const location = useLocation();

  useEffect(() => {
    document.title = getDocumentTitle(location.pathname);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="find" element={<FindRidePage />} />
         <Route path="offer" element={<OfferRidePage />} />
         <Route path="offer/:rideId/edit" element={<OfferRidePage />} />
         <Route path="rides" element={<MyRidesPage />} />
        <Route path="rides/:rideId" element={<RideDetailsPage />} />
        <Route path="bookings" element={<MyBookingsPage />} />
        <Route path="chat/:rideId" element={<ChatPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage pathname={location.pathname} />} />
      </Route>
    </Routes>
  );
}
