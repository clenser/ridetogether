import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from "idb";
import { createSeedData, type SeedData } from "../data/seed";
import {
  formatRupees,
  getFareRange,
  isContributionInRange,
  normalizeContributionForDistance,
} from "./fare";
import { MAX_ROUTE_WAYPOINTS } from "./routing";
import type {
  AppNotification,
  Booking,
  Coordinates,
  Message,
  NotificationType,
  Rating,
  Ride,
  RideInput,
  SafetyContact,
  User,
  Vehicle,
} from "../types";

export interface DemoDatabase extends DBSchema {
  users: {
    key: string;
    value: User;
  };
  vehicles: {
    key: string;
    value: Vehicle;
    indexes: { "by-user": string };
  };
  rides: {
    key: string;
    value: Ride;
    indexes: { "by-driver": string; "by-status": string };
  };
  bookings: {
    key: string;
    value: Booking;
    indexes: {
      "by-ride": string;
      "by-rider": string;
      "by-status": string;
    };
  };
  messages: {
    key: string;
    value: Message;
    indexes: { "by-ride": string };
  };
  notifications: {
    key: string;
    value: AppNotification;
    indexes: { "by-user": string };
  };
  ratings: {
    key: string;
    value: Rating;
    indexes: {
      "by-ride": string;
      "by-reviewer": string;
      "by-reviewee": string;
    };
  };
  safetyContacts: {
    key: string;
    value: SafetyContact;
    indexes: { "by-user": string };
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

type DemoStoreNames = StoreNames<DemoDatabase>[];
type DemoReadWriteTransaction = IDBPTransaction<DemoDatabase, DemoStoreNames, "readwrite">;

export interface DatabaseSnapshot {
  users: User[];
  vehicles: Vehicle[];
  rides: Ride[];
  bookings: Booking[];
  messages: Message[];
  notifications: AppNotification[];
  ratings: Rating[];
  safetyContacts: SafetyContact[];
}

type BookingDecision = "confirmed" | "rejected" | "cancelled";
type ProfileChanges = Partial<
  Pick<User, "name" | "email" | "phone" | "avatar" | "role" | "bio">
>;
type VehicleInput = Omit<Vehicle, "id"> & { id?: string };
type ContactInput = Omit<SafetyContact, "id"> & { id?: string };

const DATABASE_NAME = "ridetogether";
const DATABASE_VERSION = 1;
const SEED_VERSION_KEY = "seed-version";
const SEED_VERSION = "4";
const DEMO_RAHUL_DURGAPUR_RIDE_ID = "demo-rahul-durgapur-ride";
const ACTIVE_USER_KEY = "ridetogether-active-user";
const ACTIVE_BOOKING_STATUSES = new Set<Booking["status"]>([
  "pending",
  "confirmed",
]);
const PARTICIPANT_BOOKING_STATUSES = new Set<Booking["status"]>([
  "pending",
  "confirmed",
  "completed",
]);
const RATED_BOOKING_STATUSES = new Set<Booking["status"]>([
  "confirmed",
  "completed",
]);
const getDepartureTimestamp = (ride: Pick<Ride, "departureDate" | "departureTime">): number =>
  new Date(`${ride.departureDate}T${ride.departureTime}:00`).getTime();

const isValidCoordinate = (coordinate: Coordinates): boolean =>
  Number.isFinite(coordinate.lat)
  && coordinate.lat >= -90
  && coordinate.lat <= 90
  && Number.isFinite(coordinate.lon)
  && coordinate.lon >= -180
  && coordinate.lon <= 180
  && coordinate.label.trim().length > 0
  && (coordinate.countryCode === undefined || coordinate.countryCode === "IN");

const validateRideInput = (
  input: RideInput,
  options: { allowNoAvailableSeats?: boolean } = {},
): void => {
  if (!isValidCoordinate(input.origin) || !isValidCoordinate(input.destination)) {
    throw new Error("Choose valid starting point and destination locations in India.");
  }
  if (input.waypoints.length > MAX_ROUTE_WAYPOINTS) {
    throw new Error(`A ride can include up to ${MAX_ROUTE_WAYPOINTS} stops.`);
  }
  if (input.waypoints.some((waypoint) => !isValidCoordinate(waypoint))) {
    throw new Error("One or more route stops are invalid.");
  }
  const minimumAvailableSeats = options.allowNoAvailableSeats ? 0 : 1;
  if (
    !Number.isInteger(input.availableSeats)
    || input.availableSeats < minimumAvailableSeats
  ) {
    throw new Error(
      minimumAvailableSeats === 0
        ? "Available seats cannot be negative."
        : "A ride must offer at least one seat.",
    );
  }
  if (
    !Number.isInteger(input.totalSeats)
    || input.totalSeats < input.availableSeats
  ) {
    throw new Error("Total seats must be at least the available seats.");
  }
  if (input.distanceKm === undefined || !Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    throw new Error("A real route distance is required before saving this ride.");
  }
  if (!isContributionInRange(input.contribution, input.distanceKm)) {
    const fareRange = getFareRange(input.distanceKm);
    if (!fareRange) {
      throw new Error("A real route distance is required before saving this ride.");
    }
    throw new Error(
      `Contribution must be between ${formatRupees(fareRange.min)} and ${formatRupees(fareRange.max)} for this route.`,
    );
  }
  if (
    input.durationMinutes !== undefined &&
    (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0)
  ) {
    throw new Error("Route duration must be greater than zero.");
  }
  const departureTimestamp = getDepartureTimestamp(input);
  if (!Number.isFinite(departureTimestamp) || departureTimestamp <= Date.now()) {
    throw new Error("Choose a departure time in the future.");
  }
};

let databasePromise: Promise<IDBPDatabase<DemoDatabase>> | undefined;

const createDatabase = (): Promise<IDBPDatabase<DemoDatabase>> =>
  openDB<DemoDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      database.createObjectStore("users", { keyPath: "id" });

      const vehicles = database.createObjectStore("vehicles", { keyPath: "id" });
      vehicles.createIndex("by-user", "userId");

      const rides = database.createObjectStore("rides", { keyPath: "id" });
      rides.createIndex("by-driver", "driverId");
      rides.createIndex("by-status", "status");

      const bookings = database.createObjectStore("bookings", {
        keyPath: "id",
      });
      bookings.createIndex("by-ride", "rideId");
      bookings.createIndex("by-rider", "riderId");
      bookings.createIndex("by-status", "status");

      const messages = database.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("by-ride", "rideId");

      const notifications = database.createObjectStore("notifications", {
        keyPath: "id",
      });
      notifications.createIndex("by-user", "userId");

      const ratings = database.createObjectStore("ratings", { keyPath: "id" });
      ratings.createIndex("by-ride", "rideId");
      ratings.createIndex("by-reviewer", "reviewerId");
      ratings.createIndex("by-reviewee", "revieweeId");

      const contacts = database.createObjectStore("safetyContacts", {
        keyPath: "id",
      });
      contacts.createIndex("by-user", "userId");

      database.createObjectStore("meta", { keyPath: "key" });
    },
  });

export const getDatabase = (): Promise<IDBPDatabase<DemoDatabase>> => {
  databasePromise ??= createDatabase().catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
};

const makeNotification = (
  userId: string,
  rideId: string,
  type: NotificationType,
  title: string,
  body: string,
  createdAt: string,
): AppNotification => ({
  id: crypto.randomUUID(),
  userId,
  rideId,
  type,
  title,
  body,
  read: false,
  createdAt,
});

const putSeedData = async (
  transaction: DemoReadWriteTransaction,
  seed: SeedData,
): Promise<void> => {
  await Promise.all([
    ...seed.users.map((user) => transaction.objectStore("users").put(user)),
    ...seed.vehicles.map((vehicle) =>
      transaction.objectStore("vehicles").put(vehicle),
    ),
    ...seed.rides.map((ride) => transaction.objectStore("rides").put(ride)),
    ...seed.bookings.map((booking) =>
      transaction.objectStore("bookings").put(booking),
    ),
    ...seed.messages.map((message) =>
      transaction.objectStore("messages").put(message),
    ),
    ...seed.notifications.map((item) =>
      transaction.objectStore("notifications").put(item),
    ),
    ...seed.ratings.map((item) =>
      transaction.objectStore("ratings").put(item),
    ),
    ...seed.safetyContacts.map((contact) =>
      transaction.objectStore("safetyContacts").put(contact),
    ),
    transaction.objectStore("meta").put({
      key: SEED_VERSION_KEY,
      value: SEED_VERSION,
    }),
  ]);
};

const migrateSeedData = async (
  transaction: DemoReadWriteTransaction,
  seed: SeedData,
): Promise<void> => {
  const users = await transaction.objectStore("users").getAll();
  const usersByEmail = new Map(users.map((user) => [user.email, user]));
  const missingUsers = seed.users.filter((user) => !usersByEmail.has(user.email));
  await Promise.all(missingUsers.map((user) => transaction.objectStore("users").put(user)));

  const existingUsers = await transaction.objectStore("users").getAll();
  const existingVehicles = await transaction.objectStore("vehicles").getAll();
  const seedUserIds = new Map(
    existingUsers.map((user) => [user.email, user.id]),
  );
  const missingVehicles = seed.vehicles.filter((vehicle) => {
    const userId = seedUserIds.get(
      seed.users.find((user) => user.id === vehicle.userId)?.email ?? "",
    );
    return !existingVehicles.some(
      (item) => item.userId === userId && item.plate === vehicle.plate,
    );
  });
  await Promise.all(
    missingVehicles.map((vehicle) => {
      const seedUser = seed.users.find((user) => user.id === vehicle.userId);
      const userId = seedUser ? seedUserIds.get(seedUser.email) : undefined;
      return transaction.objectStore("vehicles").put({
        ...vehicle,
        userId: userId ?? vehicle.userId,
      });
    }),
  );

  const rahul = (await transaction.objectStore("users").getAll()).find(
    (user) => user.email === "rahul.sharma@example.com",
  );
  const vehicle = rahul
    ? (await transaction.objectStore("vehicles").getAll()).find(
        (item) => item.userId === rahul.id,
      )
    : undefined;
  const demoRide = seed.rides.find((ride) => ride.id === DEMO_RAHUL_DURGAPUR_RIDE_ID);
  const existingDemoRide = await transaction
    .objectStore("rides")
    .get(DEMO_RAHUL_DURGAPUR_RIDE_ID);
  if (demoRide && rahul && vehicle && !existingDemoRide) {
    await transaction.objectStore("rides").put({
      ...demoRide,
      driverId: rahul.id,
      vehicleId: vehicle.id,
    });
  }

  const existingRides = await transaction.objectStore("rides").getAll();
  const normalizedRides = existingRides.map((ride) => ({
    ...ride,
    contribution: normalizeContributionForDistance(ride.contribution, ride.distanceKm),
  }));
  await Promise.all(
    normalizedRides
      .filter((ride, index) => ride.contribution !== existingRides[index].contribution)
      .map((ride) => transaction.objectStore("rides").put(ride)),
  );

  const completedRideIds = new Set(
    (await transaction.objectStore("rides").getAll())
      .filter((ride) => ride.status === "completed")
      .map((ride) => ride.id),
  );
  const completedBookings = (await transaction.objectStore("bookings").getAll())
    .filter(
      (booking) =>
        completedRideIds.has(booking.rideId) && booking.status === "confirmed",
    )
    .map((booking) => ({ ...booking, status: "completed" as const }));
  await Promise.all(
    completedBookings.map((booking) =>
      transaction.objectStore("bookings").put(booking),
    ),
  );

  await transaction.objectStore("meta").put({
    key: SEED_VERSION_KEY,
    value: SEED_VERSION,
  });
};

const seedIfMissing = async (
  database: IDBPDatabase<DemoDatabase>,
): Promise<void> => {
  const transaction = database.transaction(
    [
      "users",
      "vehicles",
      "rides",
      "bookings",
      "messages",
      "notifications",
      "ratings",
      "safetyContacts",
      "meta",
    ],
    "readwrite",
  );
  const existingSeed = await transaction.objectStore("meta").get(SEED_VERSION_KEY);
  const existingVersion = Number.parseInt(existingSeed?.value ?? "", 10);

  if (!existingSeed && (await transaction.objectStore("users").count()) === 0) {
    await putSeedData(transaction, createSeedData());
  } else if (!Number.isFinite(existingVersion) || existingVersion < Number(SEED_VERSION)) {
    await migrateSeedData(transaction, createSeedData());
  }

  await transaction.done;
};

export const initializeDatabase = async (): Promise<void> => {
  const database = await getDatabase();
  await seedIfMissing(database);
};

export const resetDatabase = async (): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction(
    [
      "users",
      "vehicles",
      "rides",
      "bookings",
      "messages",
      "notifications",
      "ratings",
      "safetyContacts",
      "meta",
    ],
    "readwrite",
  );

  await Promise.all([
    transaction.objectStore("users").clear(),
    transaction.objectStore("vehicles").clear(),
    transaction.objectStore("rides").clear(),
    transaction.objectStore("bookings").clear(),
    transaction.objectStore("messages").clear(),
    transaction.objectStore("notifications").clear(),
    transaction.objectStore("ratings").clear(),
    transaction.objectStore("safetyContacts").clear(),
    transaction.objectStore("meta").clear(),
  ]);
  await transaction.done;
  await seedIfMissing(database);
};

export const readSnapshot = async (): Promise<DatabaseSnapshot> => {
  const database = await getDatabase();
  const transaction = database.transaction(
    [
      "users",
      "vehicles",
      "rides",
      "bookings",
      "messages",
      "notifications",
      "ratings",
      "safetyContacts",
    ],
    "readonly",
  );

  const [
    users,
    vehicles,
    rides,
    bookings,
    messages,
    notifications,
    ratings,
    safetyContacts,
  ] = await Promise.all([
    transaction.objectStore("users").getAll(),
    transaction.objectStore("vehicles").getAll(),
    transaction.objectStore("rides").getAll(),
    transaction.objectStore("bookings").getAll(),
    transaction.objectStore("messages").getAll(),
    transaction.objectStore("notifications").getAll(),
    transaction.objectStore("ratings").getAll(),
    transaction.objectStore("safetyContacts").getAll(),
  ]);
  await transaction.done;

  return {
    users,
    vehicles,
    rides,
    bookings,
    messages,
    notifications,
    ratings,
    safetyContacts,
  };
};

export const getStoredActiveUserId = (): string | null => {
  try {
    return window.localStorage.getItem(ACTIVE_USER_KEY);
  } catch {
    return null;
  }
};

export const storeActiveUserId = (userId: string): void => {
  try {
    window.localStorage.setItem(ACTIVE_USER_KEY, userId);
  } catch {
    return;
  }
};

export const createRideRecord = async (
  input: RideInput,
  userId: string,
): Promise<Ride> => {
  if (input.driverId !== userId) {
    throw new Error("You can only publish a ride as the active user.");
  }
  validateRideInput(input);

  const database = await getDatabase();
  const transaction = database.transaction(
    ["users", "vehicles", "rides"],
    "readwrite",
  );
  const user = await transaction.objectStore("users").get(userId);
  if (!user) {
    throw new Error("The active user no longer exists.");
  }
  const vehicle = await transaction.objectStore("vehicles").get(input.vehicleId);
  if (!vehicle || vehicle.userId !== userId) {
    throw new Error("You can only offer a ride using your own vehicle.");
  }
  if (input.totalSeats > vehicle.seats) {
    throw new Error("The selected vehicle does not have that many seats.");
  }

  const ride: Ride = {
    ...input,
    id: crypto.randomUUID(),
    waypoints: [...input.waypoints],
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await transaction.objectStore("rides").put(ride);
  await transaction.done;
  return ride;
};

export const updateRideRecord = async (
  rideId: string,
  input: RideInput,
  userId: string,
): Promise<Ride> => {
  if (input.driverId !== userId) {
    throw new Error("You can only edit a ride as its driver.");
  }
  validateRideInput(input, { allowNoAvailableSeats: true });

  const database = await getDatabase();
  const transaction = database.transaction(
    ["vehicles", "rides", "bookings"],
    "readwrite",
  );
  const ride = await transaction.objectStore("rides").get(rideId);
  if (!ride) {
    throw new Error("This ride no longer exists.");
  }
  if (ride.driverId !== userId) {
    throw new Error("You can only edit your own ride.");
  }
  if (ride.status !== "active") {
    throw new Error("Only active rides can be edited.");
  }
  const vehicle = await transaction.objectStore("vehicles").get(input.vehicleId);
  if (!vehicle || vehicle.userId !== userId) {
    throw new Error("You can only use one of your own vehicles.");
  }
  if (input.totalSeats > vehicle.seats) {
    throw new Error("The selected vehicle does not have that many seats.");
  }
  const bookings = await transaction
    .objectStore("bookings")
    .index("by-ride")
    .getAll(rideId);
  const confirmedSeats = bookings
    .filter((booking) => booking.status === "confirmed")
    .reduce((total, booking) => total + booking.seats, 0);
  if (input.availableSeats + confirmedSeats > input.totalSeats) {
    throw new Error("Available seats cannot be lower than the confirmed passengers.");
  }

  const updatedRide: Ride = {
    ...ride,
    ...input,
    waypoints: [...input.waypoints],
    id: ride.id,
    status: "active",
    createdAt: ride.createdAt,
  };
  await transaction.objectStore("rides").put(updatedRide);
  await transaction.done;
  return updatedRide;
};

export const requestBookingRecord = async (
  rideId: string,
  seats: number,
  userId: string,
): Promise<void> => {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error("Seat request must be at least one.");
  }

  const now = new Date().toISOString();
  const database = await getDatabase();
  const transaction = database.transaction(
    ["users", "rides", "bookings", "notifications"],
    "readwrite",
  );
  const user = await transaction.objectStore("users").get(userId);
  if (!user) {
    throw new Error("The active user no longer exists.");
  }
  const ride = await transaction.objectStore("rides").get(rideId);
  if (!ride) {
    throw new Error("This ride no longer exists.");
  }
  if (ride.status !== "active") {
    throw new Error("Only active rides accept booking requests.");
  }
  const departureTimestamp = getDepartureTimestamp(ride);
  if (Number.isFinite(departureTimestamp) && departureTimestamp <= Date.now()) {
    throw new Error("This ride has already departed and no longer accepts requests.");
  }
  if (ride.driverId === userId) {
    throw new Error("You cannot book a seat on your own ride.");
  }
  if (seats > ride.availableSeats) {
    throw new Error("This ride does not have enough available seats.");
  }

  const existingBookings = await transaction
    .objectStore("bookings")
    .index("by-ride")
    .getAll(rideId);
  if (
    existingBookings.some(
      (booking) =>
        booking.riderId === userId && ACTIVE_BOOKING_STATUSES.has(booking.status),
    )
  ) {
    throw new Error("You already have an active request for this ride.");
  }

  const booking: Booking = {
    id: crypto.randomUUID(),
    rideId,
    riderId: userId,
    seats,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const requestNotification = makeNotification(
    ride.driverId,
    ride.id,
    "booking-request",
    "New booking request",
    `${user.name} requested ${seats} seat${seats === 1 ? "" : "s"} for your ride from ${ride.origin.label} to ${ride.destination.label}.`,
    now,
  );

  await transaction.objectStore("bookings").put(booking);
  await transaction.objectStore("notifications").put(requestNotification);
  await transaction.done;
};

export const updateBookingStatusRecord = async (
  bookingId: string,
  status: BookingDecision,
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction(
    ["rides", "bookings", "notifications"],
    "readwrite",
  );
  const booking = await transaction.objectStore("bookings").get(bookingId);
  if (!booking) {
    throw new Error("This booking request no longer exists.");
  }
  const ride = await transaction.objectStore("rides").get(booking.rideId);
  if (!ride) {
    throw new Error("The ride for this booking no longer exists.");
  }
  if (status === "cancelled" && booking.riderId !== userId) {
    throw new Error("Only the rider can cancel a booking.");
  }
  if (status !== "cancelled" && ride.driverId !== userId) {
    throw new Error("Only the driver can confirm or reject a request.");
  }
  if (booking.status === status) {
    await transaction.done;
    return;
  }
  if (status === "rejected" && booking.status !== "pending") {
    throw new Error("Only pending requests can be rejected.");
  }
  if (ride.status !== "active") {
    throw new Error("Bookings cannot be changed after the ride is closed.");
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    throw new Error("This booking request has already been closed.");
  }

  let updatedRide = ride;
  if (status === "confirmed") {
    if (booking.status !== "pending") {
      throw new Error("Only pending requests can be confirmed.");
    }
    if (booking.seats > ride.availableSeats) {
      throw new Error("There are not enough seats to confirm this request.");
    }
    updatedRide = {
      ...ride,
      availableSeats: ride.availableSeats - booking.seats,
    };
  } else if (booking.status === "confirmed") {
    updatedRide = {
      ...ride,
      availableSeats: Math.min(ride.totalSeats, ride.availableSeats + booking.seats),
    };
  }

  const now = new Date().toISOString();
  const updatedBooking: Booking = {
    ...booking,
    status,
    updatedAt: now,
  };
  let notification: AppNotification | undefined;
  if (status === "confirmed") {
    notification = makeNotification(
      booking.riderId,
      ride.id,
      "booking-confirmed",
      "Booking confirmed",
      `Your ${booking.seats}-seat booking from ${ride.origin.label} to ${ride.destination.label} was confirmed.`,
      now,
    );
  } else if (status === "rejected") {
    notification = makeNotification(
      booking.riderId,
      ride.id,
      "booking-rejected",
      "Booking request declined",
      `Your booking request for the ride from ${ride.origin.label} to ${ride.destination.label} was declined.`,
      now,
    );
  } else {
    notification = makeNotification(
      booking.riderId === userId ? ride.driverId : booking.riderId,
      ride.id,
      "booking-cancelled",
      "Booking cancelled",
      booking.riderId === userId
        ? `The rider cancelled ${booking.seats} ${booking.seats === 1 ? "seat" : "seats"} for the ride from ${ride.origin.label} to ${ride.destination.label}.`
        : `The booking for the ride from ${ride.origin.label} to ${ride.destination.label} was cancelled.`,
      now,
    );
  }

  await transaction.objectStore("rides").put(updatedRide);
  await transaction.objectStore("bookings").put(updatedBooking);
  await transaction
    .objectStore("notifications")
    .put(notification as AppNotification);
  await transaction.done;
};

export const cancelRideRecord = async (
  rideId: string,
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction(
    ["rides", "bookings", "notifications"],
    "readwrite",
  );
  const ride = await transaction.objectStore("rides").get(rideId);
  if (!ride) {
    throw new Error("This ride no longer exists.");
  }
  if (ride.driverId !== userId) {
    throw new Error("Only the driver can cancel this ride.");
  }
  if (ride.status === "cancelled") {
    await transaction.done;
    return;
  }
  if (ride.status !== "active") {
    throw new Error("A completed ride cannot be cancelled.");
  }

  const now = new Date().toISOString();
  const bookings = await transaction
    .objectStore("bookings")
    .index("by-ride")
    .getAll(rideId);
  const activeBookings = bookings.filter((booking) =>
    ACTIVE_BOOKING_STATUSES.has(booking.status),
  );

  await transaction.objectStore("rides").put({
    ...ride,
    status: "cancelled",
    availableSeats: ride.totalSeats,
  });

  await Promise.all(
    activeBookings.flatMap((booking) => [
      transaction.objectStore("bookings").put({
        ...booking,
        status: "cancelled",
        updatedAt: now,
      }),
      transaction.objectStore("notifications").put(
        makeNotification(
          booking.riderId,
          ride.id,
          "ride-cancelled",
          "Ride cancelled",
          `The ride from ${ride.origin.label} to ${ride.destination.label} was cancelled by the driver.`,
          now,
        ),
      ),
    ]),
  );
  await transaction.done;
};

export const completeRideRecord = async (
  rideId: string,
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction(
    ["users", "rides", "bookings", "notifications"],
    "readwrite",
  );
  const ride = await transaction.objectStore("rides").get(rideId);
  if (!ride) {
    throw new Error("This ride no longer exists.");
  }
  if (ride.driverId !== userId) {
    throw new Error("Only the driver can complete this ride.");
  }
  if (ride.status === "completed") {
    await transaction.done;
    return;
  }
  if (ride.status !== "active") {
    throw new Error("A cancelled ride cannot be completed.");
  }

  const now = new Date().toISOString();
  const bookings = await transaction
    .objectStore("bookings")
    .index("by-ride")
    .getAll(rideId);
  if (bookings.some((booking) => booking.status === "pending")) {
    throw new Error("Resolve every pending booking before completing the ride.");
  }
  const confirmedBookings = bookings.filter(
    (booking) => booking.status === "confirmed",
  );
  const driver = await transaction.objectStore("users").get(ride.driverId);
  const updates: Promise<unknown>[] = [
    transaction.objectStore("rides").put({ ...ride, status: "completed" }),
  ];

  if (driver) {
    updates.push(
      transaction.objectStore("users").put({
        ...driver,
        tripCount: driver.tripCount + 1,
      }),
    );
  }

  for (const booking of confirmedBookings) {
    updates.push(
      transaction.objectStore("bookings").put({
        ...booking,
        status: "completed",
        updatedAt: now,
      }),
    );
    const rider = await transaction.objectStore("users").get(booking.riderId);
    if (rider) {
      updates.push(
        transaction.objectStore("users").put({
          ...rider,
          tripCount: rider.tripCount + 1,
        }),
      );
    }
    updates.push(
      transaction.objectStore("notifications").put(
        makeNotification(
          booking.riderId,
          ride.id,
          "ride-completed",
          "Ride completed",
          `The ride from ${ride.origin.label} to ${ride.destination.label} is now complete.`,
          now,
        ),
      ),
      transaction.objectStore("notifications").put(
        makeNotification(
          booking.riderId,
          ride.id,
          "rating-request",
          "Rate your driver",
          `Your ride from ${ride.origin.label} to ${ride.destination.label} is complete. Share your rating.`,
          now,
        ),
      ),
    );
  }

  if (driver) {
    updates.push(
      transaction.objectStore("notifications").put(
        makeNotification(
          driver.id,
          ride.id,
          "ride-completed",
          "Ride completed",
          `Your ride from ${ride.origin.label} to ${ride.destination.label} is now complete.`,
          now,
        ),
      ),
    );
    for (const booking of confirmedBookings) {
      const rider = await transaction.objectStore("users").get(booking.riderId);
      updates.push(
        transaction.objectStore("notifications").put(
          makeNotification(
            driver.id,
            ride.id,
            "rating-request",
            "Rate your rider",
            rider
              ? `Your ride with ${rider.name} is complete. Share your rating.`
              : "Your completed ride is ready for a rating.",
            now,
          ),
        ),
      );
    }
  }

  await Promise.all(updates);
  await transaction.done;
};

export const sendMessageRecord = async (
  rideId: string,
  text: string,
  userId: string,
): Promise<void> => {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error("Message cannot be empty.");
  }
  if (cleanText.length > 2000) {
    throw new Error("Message cannot exceed 2000 characters.");
  }

  const database = await getDatabase();
  const transaction = database.transaction(
    ["users", "rides", "bookings", "messages", "notifications"],
    "readwrite",
  );
  const user = await transaction.objectStore("users").get(userId);
  if (!user) {
    throw new Error("The active user no longer exists.");
  }
  const ride = await transaction.objectStore("rides").get(rideId);
  if (!ride) {
    throw new Error("This ride no longer exists.");
  }
  if (ride.status !== "active") {
    throw new Error("This conversation is read-only because the ride is closed.");
  }
  const bookings = await transaction
    .objectStore("bookings")
    .index("by-ride")
    .getAll(rideId);
  const participants = new Set<string>([
    ride.driverId,
    ...bookings
      .filter((booking) => PARTICIPANT_BOOKING_STATUSES.has(booking.status))
      .map((booking) => booking.riderId),
  ]);
  if (!participants.has(userId)) {
    throw new Error("Only ride participants can send messages.");
  }

  const now = new Date().toISOString();
  const message: Message = {
    id: crypto.randomUUID(),
    rideId,
    senderId: userId,
    text: cleanText,
    createdAt: now,
  };
  const updates: Promise<unknown>[] = [
    transaction.objectStore("messages").put(message),
  ];

  for (const participantId of participants) {
    if (participantId === userId) {
      continue;
    }
    const participant = await transaction.objectStore("users").get(participantId);
    if (!participant) {
      continue;
    }
    updates.push(
      transaction.objectStore("notifications").put(
        makeNotification(
          participant.id,
          ride.id,
          "message",
          "New ride message",
          `${user.name}: ${cleanText}`,
          now,
        ),
      ),
    );
  }

  await Promise.all(updates);
  await transaction.done;
};

export const markNotificationRecord = async (
  id: string,
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction("notifications", "readwrite");
  const notification = await transaction.store.get(id);
  if (!notification) {
    await transaction.done;
    return;
  }
  if (notification.userId !== userId) {
    throw new Error("You can only update your own notifications.");
  }
  await transaction.store.put({ ...notification, read: true });
  await transaction.done;
};

export const markAllNotificationsForUser = async (
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction("notifications", "readwrite");
  const index = transaction.store.index("by-user");
  let cursor = await index.openCursor(userId);
  while (cursor) {
    await cursor.update({ ...cursor.value, read: true });
    cursor = await cursor.continue();
  }
  await transaction.done;
};

export const saveProfileRecord = async (
  userId: string,
  changes: ProfileChanges,
  activeUserId: string,
): Promise<void> => {
  if (userId !== activeUserId) {
    throw new Error("You can only edit your own profile.");
  }
  const database = await getDatabase();
  const transaction = database.transaction("users", "readwrite");
  const user = await transaction.store.get(userId);
  if (!user) {
    throw new Error("The active user no longer exists.");
  }
  const updated: User = { ...user };
  if (changes.name !== undefined) updated.name = changes.name.trim();
  if (changes.email !== undefined) updated.email = changes.email.trim();
  if (changes.phone !== undefined) updated.phone = changes.phone.trim();
  if (changes.avatar !== undefined) updated.avatar = changes.avatar.trim();
  if (changes.role !== undefined) updated.role = changes.role.trim();
  if (changes.bio !== undefined) updated.bio = changes.bio.trim();
  if (!updated.name || !updated.email) {
    throw new Error("Name and email are required.");
  }
  await transaction.store.put(updated);
  await transaction.done;
};

export const saveVehicleRecord = async (
  input: VehicleInput,
  userId: string,
): Promise<void> => {
  if (input.userId !== userId) {
    throw new Error("You can only manage your own vehicles.");
  }
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 12) {
    throw new Error("Vehicle seats must be between 1 and 12.");
  }
  if (!input.name.trim() || !input.make.trim() || !input.model.trim()) {
    throw new Error("Vehicle name, make, and model are required.");
  }
  if (!input.plate.trim()) {
    throw new Error("Vehicle registration is required.");
  }

  const database = await getDatabase();
  const transaction = database.transaction("vehicles", "readwrite");
  const store = transaction.store;
  const existing = input.id ? await store.get(input.id) : undefined;
  if (input.id && (!existing || existing.userId !== userId)) {
    throw new Error("You can only edit your own vehicle.");
  }
  const userVehicles = await store.index("by-user").getAll(userId);
  const vehicle: Vehicle = {
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    make: input.make.trim(),
    model: input.model.trim(),
    color: input.color.trim(),
    plate: input.plate.trim().toUpperCase(),
    isDefault: input.isDefault || (!existing && userVehicles.length === 0),
  };

  if (vehicle.isDefault) {
    await Promise.all(
      userVehicles
        .filter((item) => item.id !== vehicle.id && item.isDefault)
        .map((item) => store.put({ ...item, isDefault: false })),
    );
  }
  await store.put(vehicle);
  await transaction.done;
};

export const deleteVehicleRecord = async (
  id: string,
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction("vehicles", "readwrite");
  const store = transaction.store;
  const vehicle = await store.get(id);
  if (!vehicle) {
    await transaction.done;
    return;
  }
  if (vehicle.userId !== userId) {
    throw new Error("You can only delete your own vehicle.");
  }
  await store.delete(id);
  if (vehicle.isDefault) {
    const remaining = await store.index("by-user").getAll(userId);
    const replacement = remaining[0];
    if (replacement) {
      await store.put({ ...replacement, isDefault: true });
    }
  }
  await transaction.done;
};

export const saveSafetyContactRecord = async (
  input: ContactInput,
  userId: string,
): Promise<void> => {
  if (input.userId !== userId) {
    throw new Error("You can only manage your own safety contacts.");
  }
  if (!input.name.trim() || !input.phone.trim() || !input.relationship.trim()) {
    throw new Error("Contact name, phone, and relationship are required.");
  }
  const database = await getDatabase();
  const transaction = database.transaction("safetyContacts", "readwrite");
  const existing = input.id ? await transaction.store.get(input.id) : undefined;
  if (input.id && (!existing || existing.userId !== userId)) {
    throw new Error("You can only edit your own safety contact.");
  }
  await transaction.store.put({
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    relationship: input.relationship.trim(),
  });
  await transaction.done;
};

export const deleteSafetyContactRecord = async (
  id: string,
  userId: string,
): Promise<void> => {
  const database = await getDatabase();
  const transaction = database.transaction("safetyContacts", "readwrite");
  const contact = await transaction.store.get(id);
  if (!contact) {
    await transaction.done;
    return;
  }
  if (contact.userId !== userId) {
    throw new Error("You can only delete your own safety contact.");
  }
  await transaction.store.delete(id);
  await transaction.done;
};

export const submitRatingRecord = async (
  rideId: string,
  revieweeId: string,
  stars: number,
  comment: string,
  reviewerId: string,
): Promise<void> => {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error("Rating must be between 1 and 5 stars.");
  }
  if (revieweeId === reviewerId) {
    throw new Error("You cannot rate yourself.");
  }

  const database = await getDatabase();
  const transaction = database.transaction(
    ["users", "rides", "bookings", "ratings"],
    "readwrite",
  );
  const ride = await transaction.objectStore("rides").get(rideId);
  if (!ride || ride.status !== "completed") {
    throw new Error("Ratings are available only after a ride is completed.");
  }
  const bookings = await transaction
    .objectStore("bookings")
    .index("by-ride")
    .getAll(rideId);
  const confirmedRiderIds = new Set(
    bookings
      .filter((booking) => RATED_BOOKING_STATUSES.has(booking.status))
      .map((booking) => booking.riderId),
  );
  const reviewerIsDriver = ride.driverId === reviewerId;
  const reviewerIsRider = confirmedRiderIds.has(reviewerId);
  if (!reviewerIsDriver && !reviewerIsRider) {
    throw new Error("Only confirmed participants can rate this ride.");
  }
  const validReviewee = reviewerIsDriver
    ? confirmedRiderIds.has(revieweeId)
    : revieweeId === ride.driverId;
  if (!validReviewee) {
    throw new Error("You can only rate another participant on this ride.");
  }

  const existingRatings = await transaction
    .objectStore("ratings")
    .index("by-ride")
    .getAll(rideId);
  if (
    existingRatings.some(
      (rating) =>
        rating.reviewerId === reviewerId && rating.revieweeId === revieweeId,
    )
  ) {
    throw new Error("You have already rated this person for this ride.");
  }

  const reviewee = await transaction.objectStore("users").get(revieweeId);
  if (!reviewee) {
    throw new Error("The user being rated no longer exists.");
  }

  const now = new Date().toISOString();
  const previousRevieweeRatings = await transaction
    .objectStore("ratings")
    .index("by-reviewee")
    .getAll(revieweeId);
  const average =
    (previousRevieweeRatings.reduce((total, rating) => total + rating.stars, 0) +
      stars) /
    (previousRevieweeRatings.length + 1);
  await transaction.objectStore("ratings").put({
    id: crypto.randomUUID(),
    rideId,
    reviewerId,
    revieweeId,
    stars,
    comment: comment.trim(),
    createdAt: now,
  });
  await transaction.objectStore("users").put({
    ...reviewee,
    rating: Math.round(average * 100) / 100,
  });
  await transaction.done;
};

export const resetDemoData = resetDatabase;
