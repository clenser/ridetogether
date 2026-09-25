import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Car,
  Clock3,
  IndianRupee,
  Route as RouteIcon,
  UsersRound,
} from "lucide-react";
import { Stars } from "./Stars";
import { formatRupees } from "../services/fare";
import type { Ride, User, Vehicle } from "../types";

export interface RideCardProps {
  ride: Ride;
  driver?: User;
  vehicle?: Vehicle;
  currentUserId?: string;
  action?: ReactNode;
  actionHref?: string;
  actionLabel?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function getDeparture(ride: Ride): Date | null {
  if (ride.departureDate.includes("T")) {
    const parsed = new Date(ride.departureDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const [year, month, day] = ride.departureDate.split("-").map(Number);
  const [hours, minutes] = ride.departureTime.split(":").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day, hours || 0, minutes || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDeparture(ride: Ride): { date: string; time: string; dateTime: string } {
  const departure = getDeparture(ride);
  if (!departure) {
    return {
      date: ride.departureDate || "Date not set",
      time: ride.departureTime || "Time not set",
      dateTime: ride.departureDate,
    };
  }

  return {
    date: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(departure),
    time: new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(departure),
    dateTime: ride.departureDate.includes("T")
      ? ride.departureDate
      : `${ride.departureDate}T${ride.departureTime || "00:00"}`,
  };
}

function formatDuration(minutes?: number): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return "Pending";
  const roundedMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} hr`;
  return `${hours} hr ${remainingMinutes} min`;
}

export function RideCard({
  ride,
  driver,
  vehicle,
  currentUserId,
  action,
  actionHref = `/rides/${ride.id}`,
  actionLabel,
  children,
  footer,
  className = "",
}: RideCardProps) {
  const departure = formatDeparture(ride);
  const isCurrentUsersRide = Boolean(currentUserId && currentUserId === ride.driverId);
  const defaultActionLabel = isCurrentUsersRide ? "Manage ride" : "View ride";
  const rootClassName = ["ride-card", className].filter(Boolean).join(" ");

  return (
    <article className={rootClassName}>
      <div className="ride-card__header">
        <div className="ride-card__driver">
          {driver?.avatar ? (
            <img className="ride-card__avatar" src={driver.avatar} alt="" />
          ) : (
            <span className="ride-card__avatar ride-card__avatar--fallback" aria-hidden="true">
              {driver?.name?.charAt(0) ?? "?"}
            </span>
          )}
          <div>
            <div className="ride-card__driver-line">
              <strong>{driver?.name ?? "Driver unavailable"}</strong>
              {isCurrentUsersRide ? <span className="ride-card__owner-badge">Your ride</span> : null}
            </div>
            {driver ? (
              <div className="ride-card__rating" aria-label={`${driver.rating.toFixed(1)} out of 5 stars`}>
                <Stars value={driver.rating} readOnly size="small" />
                <span>{driver.rating.toFixed(1)}</span>
                <span>({driver.tripCount} trips)</span>
              </div>
            ) : null}
          </div>
        </div>
        {ride.status !== "active" ? <span className={`ride-card__status ride-card__status--${ride.status}`}>{ride.status}</span> : null}
      </div>

      <div className="ride-card__route" aria-label="Ride route">
        <div className="ride-card__route-rail" aria-hidden="true">
          <span className="ride-card__route-dot" />
          <span className="ride-card__route-line" />
          {ride.waypoints.map((waypoint, index) => (
            <span className="ride-card__route-stop" key={`${waypoint.lat}-${waypoint.lon}-${index}`}>
              <span className="ride-card__route-line" />
            </span>
          ))}
          <span className="ride-card__route-destination" />
        </div>
        <div className="ride-card__places">
          <div>
            <span>From</span>
            <strong>{ride.origin.label}</strong>
          </div>
          {ride.waypoints.map((waypoint, index) => (
            <div key={`${waypoint.lat}-${waypoint.lon}-${index}`}>
              <span>Stop {index + 1}</span>
              <strong>{waypoint.label}</strong>
            </div>
          ))}
          <div>
            <span>To</span>
            <strong>{ride.destination.label}</strong>
          </div>
        </div>
      </div>

      <div className="ride-card__departure">
        <CalendarDays size={18} aria-hidden="true" />
        <time dateTime={departure.dateTime}>
          <strong>{departure.date}</strong>
          <span>{departure.time}</span>
        </time>
      </div>

      <div className="ride-card__details">
        <div>
          <UsersRound size={18} aria-hidden="true" />
          <span>
            <strong>{ride.availableSeats}</strong> {ride.availableSeats === 1 ? "seat" : "seats"} left
          </span>
        </div>
        <div>
          <IndianRupee size={18} aria-hidden="true" />
          <span>
            <strong>{formatRupees(ride.contribution)}</strong> / seat
          </span>
        </div>
        <div>
          <Car size={18} aria-hidden="true" />
          <span>{vehicle ? `${vehicle.make} ${vehicle.model}`.trim() : "Vehicle not specified"}</span>
        </div>
        <div>
          <RouteIcon size={18} aria-hidden="true" />
          <span>{ride.distanceKm === undefined ? "Distance pending" : `${ride.distanceKm.toFixed(1)} km`}</span>
        </div>
        <div>
          <Clock3 size={18} aria-hidden="true" />
          <span>{formatDuration(ride.durationMinutes)}</span>
        </div>
      </div>

      {vehicle?.plate ? (
        <div className="ride-card__vehicle-meta">
          <Car size={15} aria-hidden="true" />
          <span>{vehicle.name}</span>
          <span aria-hidden="true">·</span>
          <span>{vehicle.plate}</span>
        </div>
      ) : null}

      {children ? <div className="ride-card__content">{children}</div> : null}
      {footer ? <div className="ride-card__footer">{footer}</div> : null}

      <div className="ride-card__actions">
        {action ?? (
          <Link className="button button--primary button--full" to={actionHref}>
            {actionLabel ?? defaultActionLabel}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  );
}

export default RideCard;
