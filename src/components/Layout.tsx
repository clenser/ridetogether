import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Car,
  CarFront,
  CircleUserRound,
  CloudOff,
  Ellipsis,
  Home,
  PlusCircle,
  Route,
  Search,
  Settings,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { UserMenu } from "./UserMenu";
import { AppLoadingScreen, InlineRefreshIndicator } from "./LoadingScreen";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import type { AppNotification } from "../types";

interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const navigationItems: NavigationItem[] = [
  { label: "Home", to: "/", icon: Home, end: true },
  { label: "Find a ride", to: "/find", icon: Search },
  { label: "Offer a ride", to: "/offer", icon: PlusCircle },
  { label: "My rides", to: "/rides", icon: Route },
  { label: "My bookings", to: "/bookings", icon: TicketCheck },
  { label: "Notifications", to: "/notifications", icon: Bell },
  { label: "Profile", to: "/profile", icon: CircleUserRound },
  { label: "Vehicles", to: "/vehicles", icon: Car },
  { label: "Safety", to: "/safety", icon: ShieldCheck },
  { label: "Settings", to: "/settings", icon: Settings },
];

const primaryMobileItems = navigationItems.slice(0, 5);
const moreMobileItems = navigationItems.slice(5);

function getUnreadCount(notifications: AppNotification[], userId?: string): number {
  if (!userId) return 0;
  return notifications.filter((notification) => notification.userId === userId && !notification.read).length;
}

export function Layout() {
  const { loading, loadError, activeUser, notifications, refresh } = useApp();
  const { authUser, profileStatus } = useAuth();
  const location = useLocation();
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const unreadCount = getUnreadCount(notifications, activeUser?.id);
  const isMoreRoute = moreMobileItems.some((item) => location.pathname.startsWith(item.to));

  useEffect(() => {
    setIsMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMoreOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) setIsMoreOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMoreOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMoreOpen]);

  if (loading) {
    // Only reachable on sign-in/sign-out and an account switch, where there is
    // genuinely nothing to render yet.
    return <AppLoadingScreen label="Loading your rides" />;
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      {/* Background profile/session refreshes surface here instead of replacing
          the page, so the member keeps their route and their scroll position. */}
      <InlineRefreshIndicator active={profileStatus === "refreshing"} label="Syncing your details" />
      <a className="app-skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="app-sidebar" aria-label="Primary navigation">
        <NavLink className="app-brand" to="/" aria-label="RideTogether home">
          <span className="app-brand__mark" aria-hidden="true">
            <CarFront size={24} />
          </span>
          <span>
            <strong>RideTogether</strong>
            <small>Share the journey</small>
          </span>
        </NavLink>

        <nav className="app-sidebar__nav">
          {navigationItems.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `app-nav-link${isActive ? " is-active" : ""}`}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
              {to === "/notifications" && unreadCount > 0 ? (
                <span className="app-nav-link__count" aria-label={`${unreadCount} unread`}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="app-sidebar__footer">
          <UserMenu user={activeUser} email={authUser?.email ?? ""} />
        </div>
      </aside>

      <div className="app-shell__content">
        <header className="app-topbar">
          <NavLink className="app-topbar__brand" to="/" aria-label="RideTogether home">
            <span className="app-brand__mark" aria-hidden="true">
              <CarFront size={22} />
            </span>
            <strong>RideTogether</strong>
          </NavLink>
          <div className="app-topbar__actions">
            <NavLink
              className={({ isActive }) => `app-icon-button${isActive ? " is-active" : ""}`}
              to="/notifications"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            >
              <Bell size={21} aria-hidden="true" />
              {unreadCount > 0 ? <span className="app-notification-dot">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
            </NavLink>
            <div className="app-topbar__user">
              <UserMenu user={activeUser} email={authUser?.email ?? ""} compact />
            </div>
          </div>
        </header>

        <main className="app-main" id="main-content">
          {loadError ? (
            // A refresh failed but the last known data is still on screen, so this
            // is a dismissible warning rather than a blocking error.
            <div className="app-refresh-warning" role="status" data-testid="load-warning">
              <CloudOff size={16} aria-hidden="true" />
              <span>{loadError}</span>
              <button type="button" onClick={() => void refresh()} data-testid="load-warning-retry">
                Retry
              </button>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      <div className="app-mobile-navigation">
        <nav className="app-bottom-nav" aria-label="Mobile navigation">
          {primaryMobileItems.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `app-bottom-nav__link${isActive ? " is-active" : ""}`}
            >
              <Icon size={21} aria-hidden="true" />
              <span>{label.replace(" a ride", "")}</span>
            </NavLink>
          ))}
          <div className="app-bottom-nav__more" ref={moreMenuRef}>
            {isMoreOpen ? (
              <div className="app-mobile-menu" id="app-mobile-more-menu" role="menu" aria-label="More navigation">
                {moreMobileItems.map(({ label, to, icon: Icon }) => (
                  <NavLink key={to} to={to} role="menuitem" className="app-mobile-menu__link">
                    <Icon size={19} aria-hidden="true" />
                    <span>{label}</span>
                    {to === "/notifications" && unreadCount > 0 ? (
                      <span className="app-mobile-menu__count">{unreadCount > 99 ? "99+" : unreadCount}</span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            ) : null}
            <button
              className={`app-bottom-nav__link app-bottom-nav__button${isMoreOpen || isMoreRoute ? " is-active" : ""}`}
              type="button"
              aria-label="More navigation"
              aria-expanded={isMoreOpen}
              aria-controls={isMoreOpen ? "app-mobile-more-menu" : undefined}
              onClick={() => setIsMoreOpen((open) => !open)}
            >
              <Ellipsis size={21} aria-hidden="true" />
              <span>More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

export default Layout;
