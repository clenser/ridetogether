export interface Coordinates {
  lat: number;
  lon: number;
  label: string;
  countryCode?: string;
}

export type RideStatus = "active" | "cancelled" | "completed";
export type BookingStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "completed";
export type NotificationType =
  | "booking-request"
  | "booking-confirmed"
  | "booking-rejected"
  | "booking-cancelled"
  | "ride-cancelled"
  | "ride-completed"
  | "message"
  | "rating-request";

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
  contribution: number;
  status: RideStatus;
  distanceKm?: number;
  durationMinutes?: number;
  createdAt: string;
}

export interface Booking {
  id: string;
  rideId: string;
  riderId: string;
  seats: number;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
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

export interface RideInput {
  driverId: string;
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
}
