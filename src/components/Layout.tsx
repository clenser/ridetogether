import { useEffect, useRef, useState } from "react";
import { Bell, CarFront, Ellipsis, Sun, Moon } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { UserMenu } from "./UserMenu";
import { GlobalSearch } from "./GlobalSearch";
import { AppLoadingScreen, InlineRefreshIndicator } from "./LoadingScreen";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { navigationItems } from "../config/navigation";
import { readAppearance, saveAppearance } from "../services/theme";
import type { AppNotification } from "../types";

const primaryMobileItems = navigationItems.slice(0, 5);
const moreMobileItems = navigationItems.slice(5);

/**
 * Where the member is, as a trail.
 *
 * A breadcrumb is only honest if the ancestors are real places to go back to, so
 * only the top-level section is a link; the current page is the leaf. A route
 * with no known label falls back to the section it sits under rather than
 * showing a raw path segment to the member.
 */
function Breadcrumbs() {
  const location = useLocation();
  const { pathname } = location;

  const section = navigationItems.find(
    (item) => item.to !== "/" && pathname.startsWith(item.to),
  );

  if (!section) {
    // Home, or an unknown path. Home needs no trail of its own.
    return null;
  }

  const isSectionRoot = pathname === section.to;
  const isRideDetail = section.to === "/rides" && pathname !== "/rides";
  const currentLabel = isRideDetail ? "Ride details" : section.label;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="app-breadcrumbs">
        <li className="app-breadcrumbs__item">
          <NavLink className="app-breadcrumbs__link" to="/">
            Home
          </NavLink>
        </li>
        <li className="app-breadcrumbs__item">
          {isRideDetail ? (
            <NavLink className="app-breadcrumbs__link" to={section.to}>
              {section.label}
            </NavLink>
          ) : null}
          {isRideDetail ? <span aria-hidden="true">/</span> : null}
          <span className="app-breadcrumbs__current" aria-current="page">
            {currentLabel}
          </span>
        </li>
      </ol>
    </nav>
  );
}

function getUnreadCount(notifications: AppNotification[], userId?: string): number {
  if (!userId) return 0;
  return notifications.filter((notification) => notification.userId === userId && !notification.read).length;
}

export function Layout() {
  const { loading, activeUser, notifications } = useApp();
  const { authUser, profileStatus } = useAuth();
  const location = useLocation();
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const unreadCount = getUnreadCount(notifications, activeUser?.id);
  const isMoreRoute = moreMobileItems.some((item) => location.pathname.startsWith(item.to));

  const appearance = readAppearance();

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
          <div className="app-topbar__context">
            <NavLink className="app-topbar__brand" to="/" aria-label="RideTogether home">
              <span className="app-brand__mark" aria-hidden="true">
                <CarFront size={22} />
              </span>
              <strong>RideTogether</strong>
            </NavLink>
            <Breadcrumbs />
          </div>
          <GlobalSearch />
          <div className="app-topbar__actions">
            <NavLink
              className={({ isActive }) => `app-icon-button${isActive ? " is-active" : ""}`}
              to="/notifications"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            >
              <Bell size={21} aria-hidden="true" />
              {unreadCount > 0 ? <span className="app-notification-dot">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
            </NavLink>
            <button
              type="button"
              className="app-icon-button"
              onClick={() => saveAppearance(appearance === "dark" ? "light" : "dark")}
              aria-label={appearance === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {appearance === "dark" ? (
                <Sun size={16} aria-hidden="true" />
              ) : (
                <Moon size={16} aria-hidden="true" />
              )}
            </button>
            <div className="app-topbar__user">
              <UserMenu user={activeUser} email={authUser?.email ?? ""} compact />
            </div>
          </div>
        </header>

        {/* `tabIndex={-1}` makes the skip link actually skip: without a focusable
            target, activating it only scrolls the page and leaves keyboard focus
            up in the navigation, which is the thing it exists to avoid. */}
        <main className="app-main" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <div className="app-mobile-navigation">
        <nav className="app-bottom-nav" aria-label="Mobile navigation">
          {primaryMobileItems.map(({ label, to, icon: Icon, end, emphasis }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `app-bottom-nav__link${isActive ? " is-active" : ""}${emphasis ? " app-bottom-nav__link--emphasis" : ""}`}
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
