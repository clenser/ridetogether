export interface Coordinates {
  lat: number;
  lon: number;
  label: string;
  countryCode?: string;
}

/**
 * `active` means "published and open" - the state a ride sits in from the moment
 * it goes live until the host starts driving. Postgres calls that `upcoming`;
 * `rideRepository.rowToRideStatus` bridges the two so the app has one name for
 * it. `in_progress` is the state the host enters with START RIDE.
 */
export type RideStatus = "active" | "in_progress" | "completed" | "cancelled";

/**
 * The full booking lifecycle, in the order the database walks it:
 *
 *   pending        rider asked for a seat
 *   payment_pending host accepted; the seat is held while payment is resolved
 *   confirmed      payment resolved successfully; the rider is on the ride
 *   picked_up      the host collected this passenger
 *   completed      the trip finished
 *
 * plus `rejected`, `cancelled` and `no_show` as terminal outcomes. A seat is
 * held from `payment_pending` onwards, so a passenger who has been accepted
 * cannot be squeezed out by a later request.
 */
export type BookingStatus =
  | "pending"
  | "payment_pending"
  | "confirmed"
  | "picked_up"
  | "completed"
  | "rejected"
  | "cancelled"
  | "no_show";

/** Statuses that still hold a seat on the ride. Mirrors `booking_holds_seat`. */
export const SEAT_HOLDING_BOOKING_STATUSES: readonly BookingStatus[] = [
  "payment_pending",
  "confirmed",
  "picked_up",
  "completed",
];

/** Statuses that mean the rider is still involved and the record is live. */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  "pending",
  "payment_pending",
  "confirmed",
  "picked_up",
];

export const holdsSeat = (status: BookingStatus): boolean =>
  SEAT_HOLDING_BOOKING_STATUSES.includes(status);

export const isActiveBooking = (status: BookingStatus): boolean =>
  ACTIVE_BOOKING_STATUSES.includes(status);

/** A ride that is published and can still take requests. */
export const isBookableRide = (status: RideStatus): boolean => status === "active";

/** A ride whose host has started driving. */
export const isRideInProgress = (status: RideStatus): boolean => status === "in_progress";

export type NotificationType =
  | "booking-request"
  | "booking-accepted"
  | "booking-confirmed"
  | "booking-rejected"
  | "booking-cancelled"
  | "booking-no-show"
  | "ride-cancelled"
  | "ride-completed"
  | "ride-started"
  | "ride-reminder"
  | "driver-approaching"
  | "payment-status"
  | "message"
  | "rating-request";

/**
 * Placeholder payment lifecycle. Nothing here moves money: the row records the
 * states a real gateway would drive so the booking logic does not have to change
 * when one is added. `provider`/`providerRef` are where the real integration
 * puts its identifiers.
 */
export type PaymentStatus = "pending" | "success" | "failed" | "refunded";
export type SettlementStatus = "not_due" | "pending" | "complete";

export interface Payment {
  id: string;
  bookingId: string;
  rideId: string;
  riderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  settlement: SettlementStatus;
  provider: string;
  providerRef?: string;
  failureReason?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single geographic point agreed between one rider and one host. */
export interface PickupPoint extends Coordinates {
  /** How far the rider walks from their requested origin to the agreed point. */
  walkDistanceKm?: number;
  /** Extra road distance the host drives to collect this passenger. */
  detourKm?: number;
  detourMinutes?: number;
}

export interface Booking {
  id: string;
  rideId: string;
  riderId: string;
  seats: number;
  status: BookingStatus;
  pickup?: PickupPoint;
  dropoff?: PickupPoint;
  /** Rides shown to the rider when they picked this ride, and why. */
  match?: MatchScore;
  /** The amount the rider owes, captured when the host accepted. */
  fareAmount?: number;
  pickedUpAt?: string;
  noShowAt?: string;
  /** Set once, by the database, when the driver first came close enough. */
  driverApproachingNotifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Why a ride was offered to a rider.
 *
 * Every field is a measured quantity, and `score` is their documented
 * combination - it is a ranking aid, not a probability of the trip happening.
 * See `services/matching.ts` for the weights and the reasoning.
 */
export interface MatchScore {
  /** 0-100. Higher is a better fit. Not a probability. */
  score: number;
  /** Minutes the host's departure differs from the rider's ideal. */
  timeDifferenceMinutes: number;
  /** Distance from the rider's requested origin to the agreed pickup point. */
  walkDistanceKm: number;
  /** Extra road distance and time for the host, pickup and drop-off combined. */
  totalDetourKm: number;
  totalDetourMinutes: number;
  /** Share of the host route the passenger's leg lies along, 0-1. */
  overlap: number;
  seatsAvailable: number;
}


export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  role: string;
  bio: string;
  rating: number;
  tripCount: number;
  joinedAt: string;
}

export interface Vehicle {
  id: string;
  userId: string;
  name: string;
  make: string;
  model: string;
  color: string;
  plate: string;
  seats: number;
  isDefault: boolean;
}

export interface Ride {
  id: string;
  driverId: string;
  vehicleId: string;
  origin: Coordinates;
  destination: Coordinates;
  waypoints: Coordinates[];
  departureDate: string;
  departureTime: string;
  availableSeats: number;
  totalSeats: number;
  /** ₹9/km rounded to the nearest rupee, as persisted by the database. */
  baseFare: number;
  contribution: number;
  status: RideStatus;
  distanceKm?: number;
  durationMinutes?: number;
  /**
   * The host's road route as `[lon, lat]` pairs, exactly as Valhalla returned it.
   * Find Ride matches passengers against this corridor rather than against the
   * straight line between origin and destination, so it is persisted with the
   * ride instead of being recalculated per search.
   */
  routeGeometry?: [number, number][];
  /** Set when this ride is one occurrence of a recurring schedule. */
  seriesId?: string;
  occurrenceIndex?: number;
  startedAt?: string;
  endedAt?: string;
  /**
   * Stamped by the departure-reminder scheduler so a trip is announced once.
   * Set on the ride, not on a booking, because the host is reminded too and the
   * host's row is what the claim writes to.
   */
  reminderSentAt?: string;
  createdAt: string;
}

/** The most recent position the host shared for a ride that is running. */
export interface RideLocation {
  rideId: string;
  driverId: string;
  lat: number;
  lon: number;
  heading?: number;
  speedKph?: number;
  accuracyMeters?: number;
  recordedAt: string;
}

/** A recurring commute. Each date is its own row in `rides`. */
export interface RideSeries {
  id: string;
  driverId: string;
  vehicleId?: string;
  origin: Coordinates;
  destination: Coordinates;
  /** Wall-clock time of day, `HH:MM`. */
  departureTime: string;
  /** ISO weekdays, 0 = Sunday. */
  daysOfWeek: number[];
  validFrom: string;
  validUntil?: string;
  totalSeats: number;
  baseFare: number;
  contribution: number;
  distanceKm: number;
  durationMinutes: number;
  /**
   * Stored on the schedule as well as on each occurrence, so a later change to
   * the route is visible as "this differs from your usual" instead of silently
   * becoming a different trip.
   */
  routeGeometry?: [number, number][];
  isActive: boolean;
  createdAt: string;
}

/**
 * The optional UPI handle a member has saved for future settlement.
 *
 * Deliberately not part of `User`: `profiles` is readable by every signed-in
 * member, and a payment handle is nobody else's business. It comes from its own
 * owner-only table and is only ever fetched for the signed-in member.
 */
export interface PaymentProfile {
  userId: string;
  upiId?: string;
  updatedAt?: string;
}

export interface Message {
  id: string;
  rideId: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  rideId?: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface Rating {
  id: string;
  rideId: string;
  reviewerId: string;
  revieweeId: string;
  stars: number;
  comment: string;
  createdAt: string;
}

export interface SafetyContact {
  id: string;
  userId: string;
  name: string;
  phone: string;
  relationship: string;
}

/**
 * What the UI may submit when publishing or editing a ride.
 *
 * There is deliberately no `driverId`: the ride always belongs to the
 * authenticated Supabase user, so the field is not part of the input contract
 * and cannot be forged from a component. `availableSeats` is likewise not
 * persisted directly - the database owns `rides.seats_available`.
 */
export interface RideInput {
  vehicleId: string;
  origin: Coordinates;
  destination: Coordinates;
  waypoints: Coordinates[];
  departureDate: string;
  departureTime: string;
  availableSeats: number;
  totalSeats: number;
  contribution: number;
  distanceKm?: number;
  durationMinutes?: number;
  /** Persisted so Find Ride can match against the host's road corridor. */
  routeGeometry?: [number, number][];
  /** Set when publishing one occurrence of a recurring schedule. */
  seriesId?: string;
  occurrenceIndex?: number;
}

export interface RouteResult {
  geometry: [number, number][];
  distanceKm: number;
  durationMinutes: number;
}

export interface SearchCriteria {
  origin?: Coordinates;
  destination?: Coordinates;
  date: string;
  time: string;
  seats: number;
  /**
   * How far either side of the requested time a host may depart. Defaults to
   * `MATCH_DEFAULTS.timeWindowMinutes`. Widen it to see more rides, not to make
   * a poor match look good.
   */
  timeWindowMinutes?: number;
  /**
   * Longest total detour the rider will accept, in km, for pickup and drop-off
   * combined. Defaults to `MATCH_DEFAULTS.maxDetourKm`.
   */
  maxDetourKm?: number;
}
