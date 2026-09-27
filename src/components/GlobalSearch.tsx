import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Car,
  CarFront,
  Compass,
  MapPin,
  PlusCircle,
  Route,
  Search,
  TicketCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "../context/AppContext";
import { navigationItems } from "../config/navigation";
import { Avatar } from "./ui/Avatar";

interface QuickDestination {
  label: string;
  to: string;
  icon: LucideIcon;
  /** The pages that are hidden behind "More" on mobile. */
  hiddenOnMobile?: boolean;
}

/**
 * Navigation targets come from the shared configuration, so search can never
 * offer a destination the rest of the app does not actually link to.
 */
const DESTINATIONS: QuickDestination[] = navigationItems;

interface Result {
  id: string;
  label: string;
  meta?: string;
  icon: LucideIcon;
  /** A rendered avatar takes the place of the icon, for people. */
  avatar?: { name: string | null; src?: string | null };
  to: string;
}

interface Group {
  heading: string;
  results: Result[];
}

const includes = (haystack: string | null | undefined, needle: string) =>
  (haystack ?? "").toLowerCase().includes(needle);

/**
 * Global quick search for the desktop header.
 *
 * It searches what the member already has loaded - their own rides, their
 * bookings, their vehicles - plus the navigation itself. That is deliberately
 * scoped: it needs no extra request, it cannot be slow, and every result is a
 * real thing in the product. It is not a ride marketplace search; Find Ride is.
 */
export function GlobalSearch() {
  const { rides, bookings, vehicles, users } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim().toLowerCase();

  const groups = useMemo<Group[]>(() => {
    if (trimmed.length === 0) {
      /* With no query this is a jump list, not a result set, so it stays short
         enough to be scannable. */
      return [
        {
          heading: "Quick actions",
          results: [
            { id: "nav-find", label: "Find a ride", icon: Search, to: "/find" },
            { id: "nav-offer", label: "Offer a ride", icon: PlusCircle, to: "/offer" },
            { id: "nav-bookings", label: "My bookings", icon: TicketCheck, to: "/bookings" },
            { id: "nav-vehicles", label: "Vehicles", icon: Car, to: "/vehicles" },
          ],
        },
      ];
    }

    const next: Group[] = [];

    const pages = DESTINATIONS.filter((item) => includes(item.label, trimmed)).map((item) => ({
      id: `nav-${item.to}`,
      label: item.label,
      icon: item.icon,
      to: item.to,
    }));
    if (pages.length > 0) next.push({ heading: "Pages", results: pages });

    const driverById = new Map(users.map((user) => [user.id, user]));

    const matchedRides = rides
      .filter(
        (ride) =>
          includes(ride.origin.label, trimmed) ||
          includes(ride.destination.label, trimmed) ||
          includes(ride.contribution.toFixed(0), trimmed),
      )
      .slice(0, 5)
      .map((ride) => ({
        id: `ride-${ride.id}`,
        label: `${ride.origin.label} → ${ride.destination.label}`,
        meta: "Your ride",
        icon: Route,
        to: `/rides/${ride.id}`,
      }));
    if (matchedRides.length > 0) next.push({ heading: "Your rides", results: matchedRides });

    const matchedBookings = bookings
      .filter((booking) => {
        const ride = rides.find((candidate) => candidate.id === booking.rideId);
        const driver = ride ? driverById.get(ride.driverId) : undefined;
        return (
          includes(ride?.origin.label, trimmed) ||
          includes(ride?.destination.label, trimmed) ||
          includes(driver?.name, trimmed)
        );
      })
      .slice(0, 5)
      .map((booking) => {
        const ride = rides.find((candidate) => candidate.id === booking.rideId);
        const driver = ride ? driverById.get(ride.driverId) : undefined;
        return {
          id: `booking-${booking.id}`,
          label: ride ? `${ride.origin.label} → ${ride.destination.label}` : "A booking",
          meta: driver ? `With ${driver.name}` : "Your booking",
          icon: MapPin,
          avatar: driver ? { name: driver.name, src: driver.avatar || undefined } : undefined,
          to: ride ? `/rides/${ride.id}` : "/bookings",
        };
      });
    if (matchedBookings.length > 0) next.push({ heading: "Your bookings", results: matchedBookings });

    const matchedVehicles = vehicles
      .filter(
        (vehicle) =>
          includes(vehicle.make, trimmed) ||
          includes(vehicle.model, trimmed) ||
          includes(vehicle.plate, trimmed) ||
          includes(vehicle.color, trimmed),
      )
      .slice(0, 4)
      .map((vehicle) => ({
        id: `vehicle-${vehicle.id}`,
        label: `${vehicle.make} ${vehicle.model}`.trim(),
        meta: vehicle.plate,
        icon: CarFront,
        to: "/vehicles",
      }));
    if (matchedVehicles.length > 0) next.push({ heading: "Vehicles", results: matchedVehicles });

    return next;
  }, [trimmed, rides, bookings, vehicles, users]);

  const flat = useMemo(() => groups.flatMap((group) => group.results), [groups]);

  /* A shorter result set must not leave the highlight pointing past the end. */
  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(to);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) setOpen(false);
      return;
    }
    if (flat.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = flat[activeIndex];
      if (target) go(target.to);
    }
  };

  /* Counted as we go so each result needs a single index across all groups. */
  let runningIndex = -1;

  return (
    <div className="app-global-search" ref={containerRef}>
      <div className="ds-search app-global-search__field">
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="ds-input"
          value={query}
          placeholder="Search your rides, bookings and vehicles"
          aria-label="Search your rides, bookings and vehicles"
          role="combobox"
          aria-expanded={open}
          aria-controls="app-global-search-results"
          aria-autocomplete="list"
          aria-activedescendant={open && flat[activeIndex] ? `gsr-${flat[activeIndex].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {query.length > 0 ? (
          <button
            className="ds-search__clear"
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <Compass size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          className="app-global-search__panel"
          id="app-global-search-results"
          role="listbox"
          aria-label="Search results"
        >
          {flat.length === 0 ? (
            <p className="app-global-search__empty">
              Nothing matched “{query.trim()}”. Try a place, a driver or a registration.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.heading} className="app-global-search__group">
                <p className="app-global-search__heading">{group.heading}</p>
                <ul className="app-global-search__list">
                  {group.results.map((result) => {
                    runningIndex += 1;
                    const index = runningIndex;
                    const Icon = result.icon;
                    const active = index === activeIndex;
                    return (
                      <li key={result.id}>
                        <button
                          type="button"
                          id={`gsr-${result.id}`}
                          className={`app-global-search__result${active ? " is-active" : ""}`}
                          role="option"
                          aria-selected={active}
                          /* `mousedown` rather than `click`: the input's blur must
                             not close the panel before the click lands. */
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => go(result.to)}
                        >
                          {result.avatar ? (
                            <Avatar name={result.avatar.name} src={result.avatar.src} size="sm" />
                          ) : (
                            <span className="app-global-search__icon" aria-hidden="true">
                              <Icon size={16} />
                            </span>
                          )}
                          <span className="app-global-search__text">
                            <span className="app-global-search__label">{result.label}</span>
                            {result.meta ? (
                              <span className="app-global-search__meta">{result.meta}</span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default GlobalSearch;
