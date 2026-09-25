import { getBaseFare, normalizeContributionForDistance } from "../services/fare";
import type {
  AppNotification,
  Booking,
  Message,
  Rating,
  Ride,
  SafetyContact,
  User,
  Vehicle,
} from "../types";

export interface SeedData {
  users: User[];
  vehicles: Vehicle[];
  rides: Ride[];
  bookings: Booking[];
  messages: Message[];
  notifications: AppNotification[];
  ratings: Rating[];
  safetyContacts: SafetyContact[];
}

interface Departure {
  date: string;
  time: string;
  instant: string;
}

const pad = (value: number): string => value.toString().padStart(2, "0");

const relativeDeparture = (
  now: Date,
  offsetDays: number,
  hour: number,
  minute = 0,
): Departure => {
  const departure = new Date(now);
  departure.setDate(departure.getDate() + offsetDays);
  departure.setHours(hour, minute, 0, 0);

  return {
    date: `${departure.getFullYear()}-${pad(departure.getMonth() + 1)}-${pad(departure.getDate())}`,
    time: `${pad(departure.getHours())}:${pad(departure.getMinutes())}`,
    instant: departure.toISOString(),
  };
};

const before = (instant: string, hours: number): string =>
  new Date(new Date(instant).getTime() - hours * 60 * 60 * 1000).toISOString();

const after = (instant: string, hours: number): string =>
  new Date(new Date(instant).getTime() + hours * 60 * 60 * 1000).toISOString();

const ago = (now: Date, hours: number): string =>
  new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

const notification = (
  userId: string,
  rideId: string | undefined,
  type: AppNotification["type"],
  title: string,
  body: string,
  createdAt: string,
  read = false,
): AppNotification => ({
  id: crypto.randomUUID(),
  userId,
  ...(rideId ? { rideId } : {}),
  type,
  title,
  body,
  read,
  createdAt,
});

export const createSeedData = (now = new Date()): SeedData => {
  const rahulId = crypto.randomUUID();
  const sreemantaId = crypto.randomUUID();
  const ananyaId = crypto.randomUUID();

  const rahulVehicleId = crypto.randomUUID();
  const sreemantaVehicleId = crypto.randomUUID();
  const ananyaVehicleId = crypto.randomUUID();

  const users: User[] = [
    {
      id: rahulId,
      name: "Rahul Sharma",
      email: "rahul.sharma@example.com",
      phone: "+91 98300 24561",
      avatar: "https://i.pravatar.cc/200?u=rahul.sharma",
      role: "Driver & rider",
      bio: "Weekend road trips and calm daily commutes. I enjoy sharing rides and helping people travel affordably.",
      rating: 4.8,
      tripCount: 34,
      joinedAt: "2024-02-12T10:00:00.000Z",
    },
    {
      id: sreemantaId,
      name: "Sreemanta Barman",
      email: "sreemanta.barman@example.com",
      phone: "+91 90076 18240",
      avatar: "https://i.pravatar.cc/200?u=sreemanta.barman",
      role: "Driver & rider",
      bio: "Tech professional planning early and reliable rides across Kolkata and nearby cities.",
      rating: 4.9,
      tripCount: 21,
      joinedAt: "2024-06-03T10:00:00.000Z",
    },
    {
      id: ananyaId,
      name: "Ananya Das",
      email: "ananya.das@example.com",
      phone: "+91 98765 43210",
      avatar: "https://i.pravatar.cc/200?u=ananya.das",
      role: "Driver & rider",
      bio: "Designer, punctual traveller, and careful driver. Happy to coordinate pickups around south Kolkata.",
      rating: 4.7,
      tripCount: 17,
      joinedAt: "2025-01-18T10:00:00.000Z",
    },
  ];

  const vehicles: Vehicle[] = [
    {
      id: rahulVehicleId,
      userId: rahulId,
      name: "Family Cruiser",
      make: "Toyota",
      model: "Innova Crysta",
      color: "Silver",
      plate: "WB 06 AB 2456",
      seats: 6,
      isDefault: true,
    },
    {
      id: sreemantaVehicleId,
      userId: sreemantaId,
      name: "City Sedan",
      make: "Honda",
      model: "City",
      color: "White",
      plate: "WB 06 SR 8240",
      seats: 4,
      isDefault: true,
    },
    {
      id: ananyaVehicleId,
      userId: ananyaId,
      name: "Easy Ride",
      make: "Maruti Suzuki",
      model: "Dzire",
      color: "Blue",
      plate: "WB 06 AD 4321",
      seats: 3,
      isDefault: true,
    },
  ];

  const kolkataDeparture = relativeDeparture(now, 1, 8, 0);
  const howrahDeparture = relativeDeparture(now, 2, 18, 30);
  const aliporeDeparture = relativeDeparture(now, 3, 9, 15);
  const airportDeparture = relativeDeparture(now, 4, 6, 30);
  const asansolDeparture = relativeDeparture(now, 5, 7, 0);
  const durgapurDeparture = relativeDeparture(now, 6, 6, 15);
  const rahulDurgapurDeparture = relativeDeparture(now, 1, 6, 30);
  const rahulPastDeparture = relativeDeparture(now, -4, 10, 0);
  const ananyaPastDeparture = relativeDeparture(now, -9, 17, 30);

  const rahulKolkataRideId = crypto.randomUUID();
  const rahulDurgapurRideId = "demo-rahul-durgapur-ride";
  const sreemantaHowrahRideId = crypto.randomUUID();
  const ananyaAliporeRideId = crypto.randomUUID();
  const rahulAirportRideId = crypto.randomUUID();
  const rahulCancelledRideId = crypto.randomUUID();
  const sreemantaDurgapurRideId = crypto.randomUUID();
  const rahulPastRideId = crypto.randomUUID();
  const ananyaPastRideId = crypto.randomUUID();

  // `baseFare` is derived once from each ride's distance (₹9/km, rounded)
  // rather than repeated nine times in the literals above.
  const rides: Ride[] = ([
    {
      id: rahulKolkataRideId,
      driverId: rahulId,
      vehicleId: rahulVehicleId,
      origin: {
        lat: 22.5808,
        lon: 88.4707,
        label: "New Town, Kolkata",
      },
      destination: {
        lat: 22.5867,
        lon: 88.4172,
        label: "Salt Lake Sector V, Kolkata",
      },
      waypoints: [],
      departureDate: kolkataDeparture.date,
      departureTime: kolkataDeparture.time,
      availableSeats: 3,
      totalSeats: 6,
      contribution: 180,
      status: "active",
      distanceKm: 14.8,
      durationMinutes: 48,
      createdAt: before(kolkataDeparture.instant, 36),
    },
    {
      id: rahulDurgapurRideId,
      driverId: rahulId,
      vehicleId: rahulVehicleId,
      origin: {
        lat: 22.5808,
        lon: 88.4707,
        label: "New Town, Kolkata",
      },
      destination: {
        lat: 23.5204,
        lon: 87.3119,
        label: "Durgapur, West Bengal",
      },
      waypoints: [
        {
          lat: 23.0312,
          lon: 87.8615,
          label: "Chandannagar",
        },
      ],
      departureDate: rahulDurgapurDeparture.date,
      departureTime: rahulDurgapurDeparture.time,
      availableSeats: 3,
      totalSeats: 6,
      contribution: 900,
      status: "active",
      distanceKm: 207.8,
      durationMinutes: 238,
      createdAt: before(rahulDurgapurDeparture.instant, 24),
    },
    {
      id: sreemantaHowrahRideId,
      driverId: sreemantaId,
      vehicleId: sreemantaVehicleId,
      origin: {
        lat: 22.5958,
        lon: 88.2636,
        label: "Howrah Maidan, Kolkata",
      },
      destination: {
        lat: 22.5807,
        lon: 88.4705,
        label: "New Town, Kolkata",
      },
      waypoints: [
        {
          lat: 22.5447,
          lon: 88.3422,
          label: "Bally, Kolkata",
        },
      ],
      departureDate: howrahDeparture.date,
      departureTime: howrahDeparture.time,
      availableSeats: 2,
      totalSeats: 4,
      contribution: 240,
      status: "active",
      distanceKm: 31.2,
      durationMinutes: 79,
      createdAt: before(howrahDeparture.instant, 48),
    },
    {
      id: ananyaAliporeRideId,
      driverId: ananyaId,
      vehicleId: ananyaVehicleId,
      origin: {
        lat: 22.445,
        lon: 88.415,
        label: "Alipore, Kolkata",
      },
      destination: {
        lat: 22.5867,
        lon: 88.4172,
        label: "Salt Lake Sector V, Kolkata",
      },
      waypoints: [],
      departureDate: aliporeDeparture.date,
      departureTime: aliporeDeparture.time,
      availableSeats: 1,
      totalSeats: 3,
      contribution: 210,
      status: "active",
      distanceKm: 25.6,
      durationMinutes: 66,
      createdAt: before(aliporeDeparture.instant, 30),
    },
    {
      id: rahulAirportRideId,
      driverId: rahulId,
      vehicleId: rahulVehicleId,
      origin: {
        lat: 22.5808,
        lon: 88.4707,
        label: "New Town, Kolkata",
      },
      destination: {
        lat: 22.6547,
        lon: 88.4467,
        label: "Netaji Subhas Chandra Bose International Airport",
      },
      waypoints: [],
      departureDate: airportDeparture.date,
      departureTime: airportDeparture.time,
      availableSeats: 3,
      totalSeats: 6,
      contribution: 300,
      status: "active",
      distanceKm: 29.4,
      durationMinutes: 62,
      createdAt: before(airportDeparture.instant, 24),
    },
    {
      id: rahulCancelledRideId,
      driverId: rahulId,
      vehicleId: rahulVehicleId,
      origin: {
        lat: 22.5808,
        lon: 88.4707,
        label: "New Town, Kolkata",
      },
      destination: {
        lat: 23.6739,
        lon: 86.9524,
        label: "Asansol, West Bengal",
      },
      waypoints: [],
      departureDate: asansolDeparture.date,
      departureTime: asansolDeparture.time,
      availableSeats: 6,
      totalSeats: 6,
      contribution: 650,
      status: "cancelled",
      distanceKm: 217.5,
      durationMinutes: 245,
      createdAt: before(asansolDeparture.instant, 52),
    },
    {
      id: sreemantaDurgapurRideId,
      driverId: sreemantaId,
      vehicleId: sreemantaVehicleId,
      origin: {
        lat: 22.58,
        lon: 88.42,
        label: "Salt Lake, Kolkata",
      },
      destination: {
        lat: 23.5204,
        lon: 87.3119,
        label: "Durgapur, West Bengal",
      },
      waypoints: [
        {
          lat: 23.0312,
          lon: 87.8615,
          label: "Chandannagar",
        },
      ],
      departureDate: durgapurDeparture.date,
      departureTime: durgapurDeparture.time,
      availableSeats: 4,
      totalSeats: 4,
      contribution: 900,
      status: "active",
      distanceKm: 207.3,
      durationMinutes: 236,
      createdAt: before(durgapurDeparture.instant, 60),
    },
    {
      id: rahulPastRideId,
      driverId: rahulId,
      vehicleId: rahulVehicleId,
      origin: {
        lat: 22.5958,
        lon: 88.2636,
        label: "Howrah Maidan, Kolkata",
      },
      destination: {
        lat: 22.5867,
        lon: 88.4172,
        label: "Salt Lake Sector V, Kolkata",
      },
      waypoints: [],
      departureDate: rahulPastDeparture.date,
      departureTime: rahulPastDeparture.time,
      availableSeats: 4,
      totalSeats: 6,
      contribution: 180,
      status: "completed",
      distanceKm: 26.4,
      durationMinutes: 69,
      createdAt: before(rahulPastDeparture.instant, 72),
    },
    {
      id: ananyaPastRideId,
      driverId: ananyaId,
      vehicleId: ananyaVehicleId,
      origin: {
        lat: 22.5807,
        lon: 88.4705,
        label: "New Town, Kolkata",
      },
      destination: {
        lat: 23.5204,
        lon: 87.3119,
        label: "Durgapur, West Bengal",
      },
      waypoints: [],
      departureDate: ananyaPastDeparture.date,
      departureTime: ananyaPastDeparture.time,
      availableSeats: 1,
      totalSeats: 3,
      contribution: 850,
      status: "completed",
      distanceKm: 204.8,
      durationMinutes: 232,
      createdAt: before(ananyaPastDeparture.instant, 96),
    },
  ] as Omit<Ride, "baseFare">[]).map((ride) => ({
    ...ride,
    baseFare: getBaseFare(ride.distanceKm) ?? 0,
  }));

  const bookings: Booking[] = [
    {
      id: crypto.randomUUID(),
      rideId: rahulKolkataRideId,
      riderId: sreemantaId,
      seats: 1,
      status: "confirmed",
      createdAt: ago(now, 30),
      updatedAt: ago(now, 27),
    },
    {
      id: crypto.randomUUID(),
      rideId: rahulKolkataRideId,
      riderId: ananyaId,
      seats: 1,
      status: "pending",
      createdAt: ago(now, 5),
      updatedAt: ago(now, 5),
    },
    {
      id: crypto.randomUUID(),
      rideId: sreemantaHowrahRideId,
      riderId: rahulId,
      seats: 1,
      status: "confirmed",
      createdAt: ago(now, 38),
      updatedAt: ago(now, 35),
    },
    {
      id: crypto.randomUUID(),
      rideId: sreemantaHowrahRideId,
      riderId: ananyaId,
      seats: 1,
      status: "cancelled",
      createdAt: ago(now, 28),
      updatedAt: ago(now, 20),
    },
    {
      id: crypto.randomUUID(),
      rideId: ananyaAliporeRideId,
      riderId: rahulId,
      seats: 1,
      status: "confirmed",
      createdAt: ago(now, 26),
      updatedAt: ago(now, 24),
    },
    {
      id: crypto.randomUUID(),
      rideId: ananyaAliporeRideId,
      riderId: sreemantaId,
      seats: 1,
      status: "pending",
      createdAt: ago(now, 3),
      updatedAt: ago(now, 3),
    },
    {
      id: crypto.randomUUID(),
      rideId: rahulCancelledRideId,
      riderId: sreemantaId,
      seats: 1,
      status: "cancelled",
      createdAt: ago(now, 44),
      updatedAt: ago(now, 8),
    },
    {
      id: crypto.randomUUID(),
      rideId: sreemantaDurgapurRideId,
      riderId: ananyaId,
      seats: 1,
      status: "rejected",
      createdAt: ago(now, 18),
      updatedAt: ago(now, 16),
    },
    {
      id: crypto.randomUUID(),
      rideId: rahulPastRideId,
      riderId: sreemantaId,
      seats: 1,
      status: "completed",
      createdAt: before(rahulPastDeparture.instant, 48),
      updatedAt: before(rahulPastDeparture.instant, 45),
    },
    {
      id: crypto.randomUUID(),
      rideId: ananyaPastRideId,
      riderId: rahulId,
      seats: 1,
      status: "completed",
      createdAt: before(ananyaPastDeparture.instant, 72),
      updatedAt: before(ananyaPastDeparture.instant, 70),
    },
  ];

  const messages: Message[] = [
    {
      id: crypto.randomUUID(),
      rideId: rahulKolkataRideId,
      senderId: sreemantaId,
      text: "Hi Rahul, I am near the New Town market gate. Is that a good pickup point?",
      createdAt: ago(now, 6),
    },
    {
      id: crypto.randomUUID(),
      rideId: rahulKolkataRideId,
      senderId: rahulId,
      text: "Yes, the gate works well. I will message you when I am five minutes away.",
      createdAt: ago(now, 5.5),
    },
    {
      id: crypto.randomUUID(),
      rideId: sreemantaHowrahRideId,
      senderId: rahulId,
      text: "I will be at the Maidan bus stand side entrance.",
      createdAt: ago(now, 12),
    },
    {
      id: crypto.randomUUID(),
      rideId: ananyaAliporeRideId,
      senderId: sreemantaId,
      text: "Could we take the bypass if traffic near the airport crossing is heavy?",
      createdAt: ago(now, 2),
    },
    {
      id: crypto.randomUUID(),
      rideId: rahulPastRideId,
      senderId: rahulId,
      text: "Thanks for the smooth ride. Have a good day!",
      createdAt: after(rahulPastDeparture.instant, 20),
    },
  ];

  const notifications: AppNotification[] = [
    notification(
      rahulId,
      rahulKolkataRideId,
      "booking-request",
      "New booking request",
      "Sreemanta Barman requested 1 seat for your New Town to Salt Lake ride.",
      ago(now, 30),
      true,
    ),
    notification(
      sreemantaId,
      rahulKolkataRideId,
      "booking-confirmed",
      "Booking confirmed",
      "Rahul Sharma confirmed your seat for the New Town to Salt Lake ride.",
      ago(now, 27),
      true,
    ),
    notification(
      rahulId,
      rahulKolkataRideId,
      "booking-request",
      "New booking request",
      "Ananya Das requested 1 seat for your New Town to Salt Lake ride.",
      ago(now, 5),
    ),
    notification(
      sreemantaId,
      sreemantaHowrahRideId,
      "booking-confirmed",
      "Booking confirmed",
      "Rahul Sharma confirmed your seat for the Howrah to New Town ride.",
      ago(now, 35),
      true,
    ),
    notification(
      sreemantaId,
      sreemantaHowrahRideId,
      "ride-cancelled",
      "Booking cancelled",
      "Ananya Das cancelled her booking for the Howrah to New Town ride.",
      ago(now, 20),
      true,
    ),
    notification(
      ananyaId,
      sreemantaHowrahRideId,
      "ride-cancelled",
      "Booking cancelled",
      "Your booking for the Howrah to New Town ride was cancelled.",
      ago(now, 20),
      true,
    ),
    notification(
      sreemantaId,
      ananyaAliporeRideId,
      "booking-confirmed",
      "Booking confirmed",
      "Ananya Das confirmed your seat for the Alipore to Salt Lake ride.",
      ago(now, 24),
      true,
    ),
    notification(
      ananyaId,
      ananyaAliporeRideId,
      "booking-request",
      "New booking request",
      "Sreemanta Barman requested 1 seat for your Alipore to Salt Lake ride.",
      ago(now, 3),
    ),
    notification(
      sreemantaId,
      rahulCancelledRideId,
      "ride-cancelled",
      "Ride cancelled",
      "Rahul Sharma cancelled the New Town to Asansol ride.",
      ago(now, 8),
      true,
    ),
    notification(
      ananyaId,
      sreemantaDurgapurRideId,
      "booking-rejected",
      "Booking request declined",
      "Sreemanta Barman could not accept your booking for the Salt Lake to Durgapur ride.",
      ago(now, 16),
      true,
    ),

    notification(
      rahulId,
      rahulKolkataRideId,
      "message",
      "New ride message",
      "Sreemanta Barman: I am near the New Town market gate.",
      ago(now, 6),
    ),
    notification(
      sreemantaId,
      rahulKolkataRideId,
      "message",
      "New ride message",
      "Rahul Sharma: The gate works well. I will message you on arrival.",
      ago(now, 5.5),
    ),
    notification(
      rahulId,
      ananyaAliporeRideId,
      "message",
      "New ride message",
      "Sreemanta Barman asked about taking the bypass.",
      ago(now, 2),
    ),
    notification(
      sreemantaId,
      rahulPastRideId,
      "rating-request",
      "Rate your driver",
      "Your ride with Rahul Sharma is complete. Share your rating.",
      after(rahulPastDeparture.instant, 20),
      true,
    ),
    notification(
      rahulId,
      rahulPastRideId,
      "rating-request",
      "Rate your rider",
      "Your ride with Sreemanta Barman is complete. Share your rating.",
      after(rahulPastDeparture.instant, 20),
      true,
    ),
    notification(
      rahulId,
      ananyaPastRideId,
      "rating-request",
      "Rate your rider",
      "Your ride with Ananya Das is complete. Share your rating.",
      after(ananyaPastDeparture.instant, 20),
      true,
    ),
    notification(
      ananyaId,
      ananyaPastRideId,
      "rating-request",
      "Rate your driver",
      "Your ride with Rahul Sharma is complete. Share your rating.",
      after(ananyaPastDeparture.instant, 20),
      true,
    ),
  ];

  const ratings: Rating[] = [
    {
      id: crypto.randomUUID(),
      rideId: rahulPastRideId,
      reviewerId: sreemantaId,
      revieweeId: rahulId,
      stars: 5,
      comment: "On time, careful driving, and a very comfortable car.",
      createdAt: after(rahulPastDeparture.instant, 19),
    },
    {
      id: crypto.randomUUID(),
      rideId: rahulPastRideId,
      reviewerId: rahulId,
      revieweeId: sreemantaId,
      stars: 5,
      comment: "Friendly and punctual. Great to share a ride with.",
      createdAt: after(rahulPastDeparture.instant, 18),
    },
    {
      id: crypto.randomUUID(),
      rideId: ananyaPastRideId,
      reviewerId: rahulId,
      revieweeId: ananyaId,
      stars: 4,
      comment: "Safe driver and an easy rider to travel with.",
      createdAt: after(ananyaPastDeparture.instant, 19),
    },
    {
      id: crypto.randomUUID(),
      rideId: ananyaPastRideId,
      reviewerId: ananyaId,
      revieweeId: rahulId,
      stars: 5,
      comment: "Well planned and very considerate throughout the trip.",
      createdAt: after(ananyaPastDeparture.instant, 18),
    },
  ];

  const safetyContacts: SafetyContact[] = [
    {
      id: crypto.randomUUID(),
      userId: rahulId,
      name: "Priya Sharma",
      phone: "+91 98300 11223",
      relationship: "Partner",
    },
    {
      id: crypto.randomUUID(),
      userId: rahulId,
      name: "Vikram Sharma",
      phone: "+91 98300 55678",
      relationship: "Brother",
    },
    {
      id: crypto.randomUUID(),
      userId: sreemantaId,
      name: "Mita Barman",
      phone: "+91 90076 22114",
      relationship: "Sister",
    },
    {
      id: crypto.randomUUID(),
      userId: ananyaId,
      name: "Arjun Das",
      phone: "+91 98765 30122",
      relationship: "Father",
    },
  ];

  const normalizedRides = rides.map((ride) => ({
    ...ride,
    contribution: normalizeContributionForDistance(ride.contribution, ride.distanceKm),
  }));

  return {
    users,
    vehicles,
    rides: normalizedRides,
    bookings,
    messages,
    notifications,
    ratings,
    safetyContacts,
  };
};
