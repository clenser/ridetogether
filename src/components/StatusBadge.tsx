import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Flag,
  Hourglass,
  PlayCircle,
  UserCheck,
  UserX,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { BookingStatus, PaymentStatus, RideStatus } from "../types";

/**
 * One place that decides what every lifecycle state looks like.
 *
 * The booking path has eight states and the ride path has four, and between them
 * they are rendered on the Find Ride results, the ride card, Ride Details, My
 * Rides, My Bookings and the notifications list. When each page kept its own
 * `Record<BookingStatus, ...>`, the same state read as "Awaiting driver" in one
 * place and "pending" in another, and adding a state meant hunting down every
 * map. These records are exhaustive, so a new state will not compile until it has
 * been given a label, an icon and a tone here.
 *
 * `tone` is about urgency, not sentiment, which is why a confirmed seat is
 * `positive` while a seat waiting on payment is `attention`: the second one needs
 * the rider to do something.
 */

export type StatusTone = "neutral" | "progress" | "attention" | "positive" | "danger";

export interface StatusMeta {
  label: string;
  Icon: LucideIcon;
  tone: StatusTone;
}

export const BOOKING_STATUS_META: Record<BookingStatus, StatusMeta> = {
  pending: { label: "Awaiting driver", Icon: Clock3, tone: "attention" },
  payment_pending: { label: "Payment due", Icon: Wallet, tone: "attention" },
  confirmed: { label: "Seat confirmed", Icon: CheckCircle2, tone: "positive" },
  picked_up: { label: "On board", Icon: UserCheck, tone: "progress" },
  completed: { label: "Journey completed", Icon: Flag, tone: "positive" },
  rejected: { label: "Request declined", Icon: XCircle, tone: "danger" },
  cancelled: { label: "Booking cancelled", Icon: Ban, tone: "neutral" },
  no_show: { label: "No-show", Icon: UserX, tone: "danger" },
};

export const RIDE_STATUS_META: Record<RideStatus, StatusMeta> = {
  active: { label: "Open for bookings", Icon: Hourglass, tone: "positive" },
  in_progress: { label: "On the road", Icon: PlayCircle, tone: "progress" },
  completed: { label: "Completed", Icon: Flag, tone: "neutral" },
  cancelled: { label: "Cancelled", Icon: CircleSlash, tone: "danger" },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, StatusMeta> = {
  pending: { label: "Awaiting driver", Icon: Clock3, tone: "attention" },
  success: { label: "Payment recorded", Icon: CheckCircle2, tone: "positive" },
  failed: { label: "Not received", Icon: AlertTriangle, tone: "danger" },
  refunded: { label: "Refunded", Icon: Ban, tone: "neutral" },
};

/** States in which the driver can still take actions on the ride. */
export const isLiveRide = (status: RideStatus): boolean =>
  status === "active" || status === "in_progress";

/**
 * Written in tokens rather than literal colours.
 *
 * This badge is the one piece of status vocabulary that appears on every page,
 * so hard-coding its palette here meant the dark theme had to be re-declared
 * per page, and a new tone was easy to land on one screen and not another.
 * Driving it from the shared tokens means dark mode is a consequence of the
 * theme rather than a block someone has to remember to update.
 */
const statusStyles = `
.rt-status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: .72rem; font-weight: 700; line-height: 1.2; white-space: nowrap; }
.rt-status svg { flex: 0 0 auto; }
.rt-status--neutral { color: var(--rt-muted); background: var(--rt-surface-muted); }
.rt-status--progress { color: var(--rt-info); background: var(--rt-info-soft); }
.rt-status--attention { color: var(--rt-warning); background: var(--rt-warning-soft); }
.rt-status--positive { color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-status--danger { color: var(--rt-danger); background: var(--rt-danger-soft); }
`;

export function StatusBadge({
  meta,
  className,
}: {
  meta: StatusMeta;
  className?: string;
}) {
  const { Icon } = meta;
  return (
    <>
      <style>{statusStyles}</style>
      <span className={`rt-status rt-status--${meta.tone}${className ? ` ${className}` : ""}`}>
        <Icon size={12} aria-hidden="true" />
        {meta.label}
      </span>
    </>
  );
}

export const BookingStatusBadge = ({ status }: { status: BookingStatus }) => (
  <StatusBadge meta={BOOKING_STATUS_META[status]} />
);

export const RideStatusBadge = ({ status }: { status: RideStatus }) => (
  <StatusBadge meta={RIDE_STATUS_META[status]} />
);

export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => (
  <StatusBadge meta={PAYMENT_STATUS_META[status]} />
);

/**
 * A short line saying what has to happen next, and by whom.
 *
 * The workflow has a step that is always somebody else's to take, and saying
 * which one - rather than only showing a state name - is what stops a rider
 * waiting for a payment that only the driver can mark, or a driver wondering why
 * a seat is stuck.
 */
export const nextStepFor = (status: BookingStatus, isHost: boolean): string | null => {
  switch (status) {
    case "pending":
      return isHost
        ? "Decide whether to accept this request."
        : "Waiting for the driver to accept. You can still cancel.";
    case "payment_pending":
      return isHost
        ? "The rider is paying. Mark the payment received once you have it."
        : "Pay to confirm your seat. The driver confirms once they receive it.";
    case "confirmed":
      return isHost
        ? "Mark each passenger as picked up when they get in."
        : "Your seat is confirmed. Meet your driver at the agreed pickup point.";
    case "picked_up":
      return isHost
        ? "End the ride when you reach the destination."
        : "You are on board. The driver will end the ride on arrival.";
    case "no_show":
      return isHost
        ? "The seat is free again. You can offer it to somebody else."
        : "You were marked as a no-show for this trip. Contact the driver if that is wrong.";
    default:
      return null;
  }
};

/** A compact, non-technical description of where a ride is. */
export const rideStatusHint = (status: RideStatus): string => {
  switch (status) {
    case "active":
      return "Published and accepting seat requests.";
    case "in_progress":
      return "The driver has started. No new passengers.";
    case "completed":
      return "This trip has finished.";
    case "cancelled":
      return "This trip was cancelled.";
    default:
      return "";
  }
};
