import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cancelRideRecord,
  completeRideRecord,
  createRideRecord,
  updateRideRecord,
  deleteSafetyContactRecord,
  deleteVehicleRecord,
  getStoredActiveUserId,
  initializeDatabase,
  markAllNotificationsForUser,
  markNotificationRecord,
  readSnapshot,
  requestBookingRecord,
  resetDatabase,
  saveProfileRecord,
  saveSafetyContactRecord,
  saveVehicleRecord,
  sendMessageRecord,
  storeActiveUserId,
  submitRatingRecord,
  updateBookingStatusRecord,
} from "../services/database";
import type {
  AppNotification,
  Booking,
  Message,
  Rating,
  Ride,
  RideInput,
  SafetyContact,
  User,
  Vehicle,
} from "../types";

export interface AppContextValue {
  loading: boolean;
  users: User[];
  activeUser: User;
  activeUserId: string;
  vehicles: Vehicle[];
  rides: Ride[];
  bookings: Booking[];
  messages: Message[];
  notifications: AppNotification[];
  ratings: Rating[];
  safetyContacts: SafetyContact[];
  switchUser: (userId: string) => Promise<void>;
  refresh: () => Promise<void>;
  createRide: (input: RideInput) => Promise<Ride>;
  updateRide: (rideId: string, input: RideInput) => Promise<Ride>;
  requestBooking: (rideId: string, seats: number) => Promise<void>;
  updateBookingStatus: (
    bookingId: string,
    status: "confirmed" | "rejected" | "cancelled",
  ) => Promise<void>;
  cancelRide: (rideId: string) => Promise<void>;
  completeRide: (rideId: string) => Promise<void>;
  sendMessage: (rideId: string, text: string) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  saveProfile: (
    userId: string,
    changes: Partial<Pick<User, "name" | "email" | "phone" | "avatar" | "role" | "bio">>,
  ) => Promise<void>;
  saveVehicle: (vehicle: Omit<Vehicle, "id"> & { id?: string }) => Promise<void>;
  deleteVehicle: (id: string) => Promise<void>;
  saveSafetyContact: (
    contact: Omit<SafetyContact, "id"> & { id?: string },
  ) => Promise<void>;
  deleteSafetyContact: (id: string) => Promise<void>;
  submitRating: (
    rideId: string,
    revieweeId: string,
    stars: number,
    comment: string,
  ) => Promise<void>;
  resetDemoData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const loadingUser: User = {
  id: "",
  name: "",
  email: "",
  phone: "",
  avatar: "",
  role: "",
  bio: "",
  rating: 0,
  tripCount: 0,
  joinedAt: "",
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [safetyContacts, setSafetyContacts] = useState<SafetyContact[]>([]);
  const [activeUserId, setActiveUserId] = useState("");
  const activeUserIdRef = useRef("");
  const activeUser =
    users.find((user) => user.id === activeUserId) ??
    users.find((user) => user.id === activeUserIdRef.current) ??
    users[0] ??
    loadingUser;

  const applySnapshot = useCallback(async (): Promise<string> => {
    const snapshot = await readSnapshot();
    if (snapshot.users.length === 0) {
      throw new Error("Demo users are unavailable.");
    }
    const storedId = getStoredActiveUserId();
    const selectedId =
      snapshot.users.find((user) => user.id === storedId)?.id ??
      snapshot.users.find((user) => user.id === activeUserIdRef.current)?.id ??
      snapshot.users[0].id;
    activeUserIdRef.current = selectedId;
    storeActiveUserId(selectedId);
    setUsers(snapshot.users);
    setVehicles(snapshot.vehicles);
    setRides(snapshot.rides);
    setBookings(snapshot.bookings);
    setMessages(snapshot.messages);
    setNotifications(snapshot.notifications);
    setRatings(snapshot.ratings);
    setSafetyContacts(snapshot.safetyContacts);
    setActiveUserId(selectedId);
    return selectedId;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await applySnapshot();
  }, [applySnapshot]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await initializeDatabase();
        await applySnapshot();
      } catch (error) {
        if (mounted) {
          console.error(error);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [applySnapshot]);

  const mutate = useCallback(
    async (operation: (userId: string) => Promise<void>): Promise<void> => {
      const userId = activeUserIdRef.current;
      if (!userId) throw new Error("The app is still loading. Please try again.");
      await operation(userId);
      await applySnapshot();
    },
    [applySnapshot],
  );

  const switchUser = useCallback(
    async (userId: string): Promise<void> => {
      if (!users.some((user) => user.id === userId)) {
        throw new Error("That demo user does not exist.");
      }
      activeUserIdRef.current = userId;
      storeActiveUserId(userId);
      setActiveUserId(userId);
      await refresh();
    },
    [refresh, users],
  );

  const createRide = useCallback(
    async (input: RideInput): Promise<Ride> => {
      const userId = activeUserIdRef.current;
      if (!userId) throw new Error("The app is still loading. Please try again.");
      const ride = await createRideRecord(input, userId);
      await applySnapshot();
      return ride;
    },
    [applySnapshot],
  );

  const updateRide = useCallback(
    async (rideId: string, input: RideInput): Promise<Ride> => {
      const userId = activeUserIdRef.current;
      if (!userId) throw new Error("The app is still loading. Please try again.");
      const ride = await updateRideRecord(rideId, input, userId);
      await applySnapshot();
      return ride;
    },
    [applySnapshot],
  );

  const requestBooking = useCallback(
    (rideId: string, seats: number): Promise<void> =>
      mutate((userId) => requestBookingRecord(rideId, seats, userId)),
    [mutate],
  );

  const updateBookingStatus = useCallback(
    (bookingId: string, status: "confirmed" | "rejected" | "cancelled"): Promise<void> =>
      mutate((userId) => updateBookingStatusRecord(bookingId, status, userId)),
    [mutate],
  );

  const cancelRide = useCallback(
    (rideId: string): Promise<void> =>
      mutate((userId) => cancelRideRecord(rideId, userId)),
    [mutate],
  );

  const completeRide = useCallback(
    (rideId: string): Promise<void> =>
      mutate((userId) => completeRideRecord(rideId, userId)),
    [mutate],
  );

  const sendMessage = useCallback(
    (rideId: string, text: string): Promise<void> =>
      mutate((userId) => sendMessageRecord(rideId, text, userId)),
    [mutate],
  );

  const markNotificationRead = useCallback(
    (id: string): Promise<void> =>
      mutate((userId) => markNotificationRecord(id, userId)),
    [mutate],
  );

  const markAllNotificationsRead = useCallback(
    (): Promise<void> =>
      mutate((userId) => markAllNotificationsForUser(userId)),
    [mutate],
  );

  const saveProfile = useCallback(
    (
      userId: string,
      changes: Partial<Pick<User, "name" | "email" | "phone" | "avatar" | "role" | "bio">>,
    ): Promise<void> => mutate((activeId) => saveProfileRecord(userId, changes, activeId)),
    [mutate],
  );

  const saveVehicle = useCallback(
    (vehicle: Omit<Vehicle, "id"> & { id?: string }): Promise<void> =>
      mutate((userId) => saveVehicleRecord(vehicle, userId)),
    [mutate],
  );

  const deleteVehicle = useCallback(
    (id: string): Promise<void> =>
      mutate((userId) => deleteVehicleRecord(id, userId)),
    [mutate],
  );

  const saveSafetyContact = useCallback(
    (contact: Omit<SafetyContact, "id"> & { id?: string }): Promise<void> =>
      mutate((userId) => saveSafetyContactRecord(contact, userId)),
    [mutate],
  );

  const deleteSafetyContact = useCallback(
    (id: string): Promise<void> =>
      mutate((userId) => deleteSafetyContactRecord(id, userId)),
    [mutate],
  );

  const submitRating = useCallback(
    (
      rideId: string,
      revieweeId: string,
      stars: number,
      comment: string,
    ): Promise<void> =>
      mutate((userId) => submitRatingRecord(rideId, revieweeId, stars, comment, userId)),
    [mutate],
  );

  const resetDemoData = useCallback(async (): Promise<void> => {
    await resetDatabase();
    await applySnapshot();
  }, [applySnapshot]);

  return (
    <AppContext.Provider
      value={{
        loading,
        users,
        activeUser,
        activeUserId,
        vehicles,
        rides,
        bookings,
        messages,
        notifications,
        ratings,
        safetyContacts,
        switchUser,
        refresh,
        createRide,
        updateRide,
        requestBooking,
        updateBookingStatus,
        cancelRide,
        completeRide,
        sendMessage,
        markNotificationRead,
        markAllNotificationsRead,
        saveProfile,
        saveVehicle,
        deleteVehicle,
        saveSafetyContact,
        deleteSafetyContact,
        submitRating,
        resetDemoData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextValue => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider.");
  }
  return context;
};

export { AppContext };
export default AppProvider;
