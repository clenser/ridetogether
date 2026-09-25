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
  deleteSafetyContactRecord,
  initializeDatabase,
  markAllNotificationsForUser,
  markNotificationRecord,
  readSnapshot,
  resetDatabase,
  saveSafetyContactRecord,
  sendMessageRecord,
  submitRatingRecord,
  upsertAuthenticatedUserRecord,
} from "../services/database";
import {
  cancelBooking as supabaseCancelBooking,
  listAllVisibleBookings,
  requestBooking as supabaseRequestBooking,
  updateBookingStatus as supabaseUpdateBookingStatus,
} from "../repositories/bookingRepository";
import { describeDataFailure } from "../repositories/dataError";
import { fetchProfiles, toAppUser as toAppUserFromProfile } from "../repositories/profileRepository";
import {
  cancelRide as supabaseCancelRide,
  completeRide as supabaseCompleteRide,
  createRide as supabaseCreateRide,
  listRides as supabaseListRides,
  searchRides as supabaseSearchRides,
  updateRide as supabaseUpdateRide,
  type RideWithRelations,
} from "../repositories/rideRepository";
import {
  createVehicle as supabaseCreateVehicle,
  deleteVehicle as supabaseDeleteVehicle,
  listVehicles as supabaseListVehicles,
  makeDefaultVehicle,
  updateVehicle as supabaseUpdateVehicle,
  type VehicleDraft,
} from "../repositories/vehicleRepository";
import { useAuth } from "./AuthContext";
import type { User as AuthUser } from "@supabase/supabase-js";
import type {
  AppNotification,
  Booking,
  Message,
  Rating,
  Ride,
  RideInput,
  SafetyContact,
  SearchCriteria,
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
  searchRides: (criteria: SearchCriteria) => Promise<Ride[]>;
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

const buildFallbackUser = (authUser: AuthUser | null): User | null => {
  if (!authUser) return null;
  const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  const metadataName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  const metadataPhone = typeof metadata.phone === "string" ? metadata.phone.trim() : "";
  const metadataAvatar = typeof metadata.avatar_url === "string" ? metadata.avatar_url.trim() : "";

  return {
    ...loadingUser,
    id: authUser.id,
    name: metadataName,
    email: authUser.email ?? "",
    phone: metadataPhone,
    avatar: metadataAvatar,
    role: "Member",
    joinedAt: new Date().toISOString(),
  };
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const { authUser, profileUser, updateProfile, isAuthenticated } = useAuth();
  const authUserId = authUser?.id ?? "";
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
  const activeUser = users.find((user) => user.id === activeUserId) ?? loadingUser;

  /**
   * Loads the Supabase-backed data. Rides, vehicles and bookings come from the
   * cloud; messages, notifications, ratings and safety contacts still come from
   * IndexedDB until those are migrated. The active user is mirrored into
   * IndexedDB so the remaining local features can resolve the current user.
   */
  const applySnapshot = useCallback(async (): Promise<string> => {
    if (!authUserId) {
      setUsers([]);
      setVehicles([]);
      setRides([]);
      setBookings([]);
      setActiveUserId("");
      return "";
    }

    const [cloudRides, cloudVehicles, cloudBookings, profiles] = await Promise.all([
      supabaseListRides().catch(() => [] as RideWithRelations[]),
      supabaseListVehicles().catch(() => [] as Vehicle[]),
      listAllVisibleBookings().catch(() => [] as Booking[]),
      fetchProfiles().catch(() => []),
    ]);

    // Driver profiles ride along with the rides; merge them into the directory
    // so the pages that resolve `ride.driverId` to a name/avatar/rating work.
    const directory = new Map<string, User>();
    for (const profile of profiles) {
      const mapped = toAppUserFromProfile(profile, profile.id === authUserId ? authUser : null);
      if (mapped) directory.set(mapped.id, mapped);
    }
    for (const entry of cloudRides) {
      if (entry.driver) directory.set(entry.driver.id, entry.driver);
    }

    const localSnapshot = await readSnapshot();
    const source = profileUser ?? buildFallbackUser(authUser);
    if (source) {
      await upsertAuthenticatedUserRecord(source).catch(() => null);
    }
    for (const localUser of localSnapshot.users) {
      if (!directory.has(localUser.id)) directory.set(localUser.id, localUser);
    }

    activeUserIdRef.current = authUserId;
    setUsers([...directory.values()]);
    setVehicles(cloudVehicles);
    setRides(cloudRides.map((entry) => entry.ride));
    setBookings(cloudBookings);
    setMessages(localSnapshot.messages);
    setNotifications(localSnapshot.notifications);
    setRatings(localSnapshot.ratings);
    setSafetyContacts(localSnapshot.safetyContacts);
    setActiveUserId(authUserId);
    return authUserId;
  }, [authUser, authUserId, profileUser]);

  const refresh = useCallback(async (): Promise<void> => {
    await applySnapshot();
  }, [applySnapshot]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Signed out: clear cloud data so nothing from the previous account stays
      // on screen, and stop the app-loading spinner.
      setUsers([]);
      setVehicles([]);
      setRides([]);
      setBookings([]);
      setActiveUserId("");
      activeUserIdRef.current = "";
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
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
  }, [applySnapshot, isAuthenticated]);

  /** Wraps an IndexedDB-only mutation with the usual post-write refresh. */
  const mutateLocal = useCallback(
    async (operation: (userId: string) => Promise<void>): Promise<void> => {
      const userId = activeUserIdRef.current;
      if (!userId) throw new Error("You need to be signed in to do that.");
      await operation(userId);
      await applySnapshot();
    },
    [applySnapshot],
  );

  /** Wraps a Supabase mutation, then re-reads the authoritative cloud state. */
  const mutateCloud = useCallback(
    async <T,>(operation: () => Promise<T>, action: Parameters<typeof describeDataFailure>[1]): Promise<T> => {
      if (!activeUserIdRef.current) throw new Error("You need to be signed in to do that.");
      try {
        const result = await operation();
        await applySnapshot();
        return result;
      } catch (error) {
        // Re-read anyway: a partially applied change (for example a trigger that
        // restored seats before rejecting a second write) must not be left
        // stale on screen.
        await applySnapshot().catch(() => undefined);
        throw new Error(describeDataFailure(error, action));
      }
    },
    [applySnapshot],
  );

  const createRide = useCallback(
    (input: RideInput): Promise<Ride> => mutateCloud(() => supabaseCreateRide(input), "create"),
    [mutateCloud],
  );

  const updateRide = useCallback(
    (rideId: string, input: RideInput): Promise<Ride> =>
      mutateCloud(() => supabaseUpdateRide(rideId, input), "update"),
    [mutateCloud],
  );

  const requestBooking = useCallback(
    (rideId: string, seats: number): Promise<void> =>
      mutateCloud(async () => {
        await supabaseRequestBooking(rideId, seats);
      }, "book"),
    [mutateCloud],
  );

  const updateBookingStatus = useCallback(
    (bookingId: string, status: "confirmed" | "rejected" | "cancelled"): Promise<void> =>
      mutateCloud(async () => {
        // The database trigger performs the seat change; nothing is decremented
        // or restored here. The follow-up refresh re-reads the real numbers.
        await (status === "cancelled"
          ? supabaseCancelBooking(bookingId)
          : supabaseUpdateBookingStatus(bookingId, status));
      }, status === "confirmed" ? "confirm" : status === "cancelled" ? "cancel" : "update"),
    [mutateCloud],
  );

  const cancelRide = useCallback(
    (rideId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseCancelRide(rideId);
      }, "cancel"),
    [mutateCloud],
  );

  const completeRide = useCallback(
    (rideId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseCompleteRide(rideId);
      }, "complete"),
    [mutateCloud],
  );

  const searchRides = useCallback(
    async (criteria: SearchCriteria): Promise<Ride[]> => {
      const results = await supabaseSearchRides(criteria);
      return results.map((entry) => entry.ride);
    },
    [],
  );

  const sendMessage = useCallback(
    (rideId: string, text: string): Promise<void> =>
      mutateLocal((userId) => sendMessageRecord(rideId, text, userId)),
    [mutateLocal],
  );

  const markNotificationRead = useCallback(
    (id: string): Promise<void> =>
      mutateLocal((userId) => markNotificationRecord(id, userId)),
    [mutateLocal],
  );

  const markAllNotificationsRead = useCallback(
    (): Promise<void> =>
      mutateLocal((userId) => markAllNotificationsForUser(userId)),
    [mutateLocal],
  );

  const saveProfile = useCallback(
    async (
      userId: string,
      changes: Partial<Pick<User, "name" | "email" | "phone" | "avatar" | "role" | "bio">>,
    ): Promise<void> => {
      if (userId !== authUserId) {
        throw new Error("You can only edit your own profile.");
      }

      if (changes.email !== undefined && changes.email.trim() !== (authUser?.email ?? "")) {
        throw new Error("Your sign-in email is managed by Supabase Auth and cannot be edited here.");
      }

      await updateProfile({
        fullName: changes.name,
        phone: changes.phone,
        bio: changes.bio,
        avatarUrl: changes.avatar,
        role: changes.role,
      });
      await applySnapshot();
    },
    [applySnapshot, authUser?.email, authUserId, updateProfile],
  );

  const saveVehicle = useCallback(
    async (vehicle: Omit<Vehicle, "id"> & { id?: string }): Promise<void> => {
      const draft: VehicleDraft = {
        name: vehicle.name,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        plate: vehicle.plate,
        seats: vehicle.seats,
        isDefault: vehicle.isDefault,
      };
      await mutateCloud(async () => {
        const saved = vehicle.id
          ? await supabaseUpdateVehicle(vehicle.id, draft)
          : await supabaseCreateVehicle(draft);
        // The schema has no partial unique index on the default vehicle, so the
        // previous default is demoted after the new one is safely stored.
        if (saved.isDefault) await makeDefaultVehicle(saved.id);
      }, vehicle.id ? "update" : "create");
    },
    [mutateCloud],
  );

  const deleteVehicle = useCallback(
    (id: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseDeleteVehicle(id);
      }, "delete"),
    [mutateCloud],
  );

  const saveSafetyContact = useCallback(
    (contact: Omit<SafetyContact, "id"> & { id?: string }): Promise<void> =>
      mutateLocal((userId) => saveSafetyContactRecord(contact, userId)),
    [mutateLocal],
  );

  const deleteSafetyContact = useCallback(
    (id: string): Promise<void> =>
      mutateLocal((userId) => deleteSafetyContactRecord(id, userId)),
    [mutateLocal],
  );

  const submitRating = useCallback(
    (
      rideId: string,
      revieweeId: string,
      stars: number,
      comment: string,
    ): Promise<void> =>
      mutateLocal((userId) => submitRatingRecord(rideId, revieweeId, stars, comment, userId)),
    [mutateLocal],
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
        searchRides,
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
