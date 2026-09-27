import { useEffect } from "react";
import { ArrowLeft, Compass, Home, MapPinned } from "lucide-react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { RedirectIfAuthenticated, RequireAuth, RequireCompleteProfile } from "./components/AuthGuards";
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
import CompleteProfilePage from "./pages/auth/CompleteProfilePage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import LoginPage from "./pages/auth/LoginPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import SignUpPage from "./pages/auth/SignUpPage";
import AuthCallbackPage from "./pages/auth/AuthCallbackPage";
import { ToastProvider } from "./components/ui/Toast";

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
  if (pathname === "/login") return "Log In | RideTogether";
  if (pathname === "/signup") return "Create Account | RideTogether";
  if (pathname === "/forgot-password") return "Reset Password | RideTogether";
  if (pathname === "/reset-password") return "Choose a New Password | RideTogether";
  if (pathname === "/auth/callback") return "Signing In | RideTogether";
  if (pathname === "/complete-profile") return "Complete Your Profile | RideTogether";
  return "Page Not Found | RideTogether";
};

function NotFoundPage({ pathname }: { pathname: string }) {
  return (
    <section className="rt-not-found" aria-labelledby="not-found-title">
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
    <ToastProvider>
      <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfAuthenticated>
            <SignUpPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <RedirectIfAuthenticated>
            <ForgotPasswordPage />
          </RedirectIfAuthenticated>
        }
      />
      {/*
        Deliberately not wrapped in `RedirectIfAuthenticated`. That guard sends a
        signed-in member to `/`, which is the right destination but the wrong
        component to own the OAuth handoff: this page has to wait for the session
        that arrives in the URL before it can decide anything, and it must show a
        real error when the provider declined. It forwards to `/` itself, and the
        `RequireCompleteProfile` guard there sends an incomplete profile to
        `/complete-profile`.
      */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      {/*
        Recovery links establish a session in the URL, so this route must stay
        reachable while signed in. `ResetPasswordPage` re-checks the session and
        signs the member out on success.
      */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/complete-profile" element={<CompleteProfilePage />} />
        <Route element={<RequireCompleteProfile />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="find" element={<FindRidePage />} />
            <Route path="offer" element={<OfferRidePage />} />
            <Route path="offer/:rideId/edit" element={<OfferRidePage />} />
            <Route path="rides" element={<MyRidesPage />} />
            <Route path="rides/:rideId" element={<RideDetailsPage />} />
            <Route path="bookings" element={<MyBookingsPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="chat/:rideId" element={<ChatPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="vehicles" element={<VehiclesPage />} />
            <Route path="safety" element={<SafetyPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage pathname={location.pathname} />} />
          </Route>
        </Route>
      </Route>
    </Routes>
    </ToastProvider>
  );
}
