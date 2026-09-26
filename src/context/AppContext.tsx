import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clearLegacyLocalData } from "../services/database";
import {
  deleteAvatar as supabaseDeleteAvatar,
  uploadAvatar as supabaseUploadAvatar,
} from "../repositories/avatarRepository";
import {
  cancelBooking as supabaseCancelBooking,
  listAllVisibleBookings,
  requestBooking as supabaseRequestBooking,
  updateBookingStatus as supabaseUpdateBookingStatus,
} from "../repositories/bookingRepository";
import { describeDataFailure } from "../repositories/dataError";
import {
  listAllMessages as supabaseListAllMessages,
  sendMessage as supabaseSendMessage,
} from "../repositories/messageRepository";
import {
  listNotifications as supabaseListNotifications,
  markAllNotificationsRead as supabaseMarkAllNotificationsRead,
  markNotificationRead as supabaseMarkNotificationRead,
} from "../repositories/notificationRepository";
import {
  listRatingsByReviewer,
  submitRating as supabaseSubmitRating,
} from "../repositories/ratingRepository";
import {
  createSafetyContact as supabaseCreateSafetyContact,
  deleteSafetyContact as supabaseDeleteSafetyContact,
  listSafetyContacts as supabaseListSafetyContacts,
  updateSafetyContact as supabaseUpdateSafetyContact,
  type SafetyContactDraft,
} from "../repositories/safetyContactRepository";
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
  setDefaultVehicle as supabaseSetDefaultVehicle,
  updateVehicle as supabaseUpdateVehicle,
  type VehicleDraft,
} from "../repositories/vehicleRepository";
import { getSupabaseClient } from "../services/supabase";
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

/**
 * The shape the Vehicles form submits.
 *
 * This is `VehicleDraft` on purpose: the old `Omit<Vehicle,"id"> & {id?}` type
 * let the UI decide identity, which is exactly what caused "add" to run as
 * "edit". Identity now comes from the repository (insert) or the argument of
 * `updateVehicle`, never from the form payload.
 */
export type VehicleFormValues = VehicleDraft;

export interface AppContextValue {
  loading: boolean;
  /**
   * Set when a background refresh could not read one or more collections. The UI
   * stays usable on the last known-good data, so this is a warning rather than a
   * blocking error.
   */
  loadError: string | null;
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
  requestBooking: (rideId: string, seats: number) => Promise<Booking>;
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
  saveVehicle: (draft: VehicleFormValues) => Promise<void>;
  updateVehicle: (vehicleId: string, draft: VehicleFormValues) => Promise<void>;
  setDefaultVehicle: (vehicleId: string) => Promise<void>;
  deleteVehicle: (id: string) => Promise<void>;
  searchRides: (criteria: SearchCriteria) => Promise<Ride[]>;
  /**
   * `userId` is not accepted: the owner of a safety contact is always the
   * authenticated Supabase user. Pass `id` to edit, omit it to add.
   */
  saveSafetyContact: (contact: SafetyContactDraft & { id?: string }) => Promise<void>;
  deleteSafetyContact: (id: string) => Promise<void>;
  submitRating: (
    rideId: string,
    revieweeId: string,
    stars: number,
    comment: string,
  ) => Promise<void>;
  /**
   * Uploads a photo to Supabase Storage and returns its public URL. Uploading
   * and saving are separate steps so the file field can report its own failure.
   */
  uploadAvatar: (file: File) => Promise<string>;
  /** Best-effort cleanup of a photo this member previously uploaded. */
  deleteAvatar: (publicUrl: string) => Promise<void>;
  /** Purges the pre-cloud local cache. Never affects cloud data. */
  clearLocalCache: () => Promise<void>;
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
  const [loadError, setLoadError] = useState<string | null>(null);
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
   * Loads the Supabase-backed data. Supabase is the single source of truth for
   * rides, vehicles, bookings, chat, notifications, ratings and safety
   * contacts. IndexedDB is only touched to keep the legacy user mirror working
   * for the demo seed; none of its ride/vehicle/booking rows are read.
   *
   * A failed read must NOT blank the screen. The previous version replaced every
   * collection with `[]` on error, so one failed request made a ride vanish and
   * the ride-details page render "this ride may have been removed" for a ride
   * that still existed. Each collection is now settled independently: what the
   * database can confirm is applied, and a collection that failed to load keeps
   * the last known-good rows while the error is recorded.
   */
  const applySnapshot = useCallback(async (): Promise<string> => {
    if (!authUserId) {
      setUsers([]);
      setVehicles([]);
      setRides([]);
      setBookings([]);
      setMessages([]);
      setNotifications([]);
      setRatings([]);
      setSafetyContacts([]);
      setActiveUserId("");
      return "";
    }

    // `settle` reports both outcomes: the value, and whether it came from a
    // successful read. Only a success is allowed to replace existing state.
    const settle = async <T,>(
      read: () => Promise<T>,
      label: string,
    ): Promise<{ value: T; ok: boolean }> => {
      try {
        return { value: await read(), ok: true };
      } catch (error) {
        console.error(`[snapshot] ${label} failed; keeping the last known data`, error);
        return { value: undefined as T, ok: false };
      }
    };

    const [ridesResult, vehiclesResult, bookingsResult, profilesResult, messagesResult, notificationsResult, ratingsResult, contactsResult] =
      await Promise.all([
        settle<RideWithRelations[]>(() => supabaseListRides(), "rides"),
        settle<Vehicle[]>(() => supabaseListVehicles(), "vehicles"),
        settle<Booking[]>(() => listAllVisibleBookings(), "bookings"),
        settle<Awaited<ReturnType<typeof fetchProfiles>>>(() => fetchProfiles(), "profiles"),
        settle<Message[]>(() => supabaseListAllMessages(), "messages"),
        settle<AppNotification[]>(() => supabaseListNotifications(), "notifications"),
        settle<Rating[]>(() => listRatingsByReviewer(), "ratings"),
        settle<SafetyContact[]>(() => supabaseListSafetyContacts(), "safety contacts"),
      ]);

    const failed = [
      ["rides", ridesResult],
      ["vehicles", vehiclesResult],
      ["bookings", bookingsResult],
      ["profiles", profilesResult],
      ["messages", messagesResult],
      ["notifications", notificationsResult],
      ["ratings", ratingsResult],
      ["safety contacts", contactsResult],
    ].filter(([, result]) => !(result as { ok: boolean }).ok).map(([name]) => name);

    if (failed.length > 0) {
      setLoadError(
        `Some data could not be refreshed (${failed.join(", ")}). `
        + "What you see may be out of date.",
      );
    } else {
      setLoadError(null);
    }

    const cloudRides = ridesResult.value ?? [];
    const cloudVehicles = vehiclesResult.value ?? [];
    const cloudBookings = bookingsResult.value ?? [];
    const cloudMessages = messagesResult.value ?? [];
    const cloudNotifications = notificationsResult.value ?? [];
    const cloudRatings = ratingsResult.value ?? [];
    const cloudContacts = contactsResult.value ?? [];
    const profiles = (profilesResult.value ?? []).filter(
      (profile): profile is NonNullable<typeof profile> => Boolean(profile),
    );

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

    // The signed-in member is always in the directory even if their profile row
    // has not loaded yet, so pages that resolve an id to a name do not flash a
    // blank while `profileSettled` is still false.
    const source = profileUser ?? buildFallbackUser(authUser);
    if (source) directory.set(source.id, source);

    activeUserIdRef.current = authUserId;
    // A failed read keeps the previous rows, so only overwrite what was read.
    if (ridesResult.ok) setRides(cloudRides.map((entry) => entry.ride));
    if (vehiclesResult.ok) setVehicles(cloudVehicles);
    if (bookingsResult.ok) setBookings(cloudBookings);
    if (messagesResult.ok) setMessages(cloudMessages);
    if (notificationsResult.ok) setNotifications(cloudNotifications);
    if (ratingsResult.ok) setRatings(cloudRatings);
    if (contactsResult.ok) setSafetyContacts(cloudContacts);
    if (profilesResult.ok) setUsers([...directory.values()]);
    else setUsers((current) => {
      // Keep the known directory but make sure the signed-in member is present.
      if (source && !current.some((user) => user.id === source.id)) {
        return [...current, source];
      }
      return current;
    });
    setActiveUserId(authUserId);
    return authUserId;
  }, [authUser, authUserId, profileUser]);

  const refresh = useCallback(async (): Promise<void> => {
    await applySnapshot();
  }, [applySnapshot]);

  /**
   * `applySnapshot` closes over `authUser`/`profileUser`, so its identity changes
   * whenever Supabase hands back a new user object - which it does on every
   * token refresh, and on every profile write. Both effects below used to depend
   * on that callback directly, so each of those events tore down and re-ran the
   * bootstrap: `setLoading(true)` flashed the full-page loader over an otherwise
   * working screen, and the realtime channel was unsubscribed and resubscribed.
   *
   * A ref keeps the latest callback while the effects key off the session, which
   * is the only thing that should restart them.
   */
  const applySnapshotRef = useRef(applySnapshot);
  applySnapshotRef.current = applySnapshot;

  /**
   * Live updates for a member signed in on more than one device, or with the app
   * open in two tabs.
   *
   * The payload is deliberately ignored: a change on another device is only a
   * signal that something moved, and the authoritative state is re-read through
   * `applySnapshot`. That is what keeps seat counts, notification rows and
   * profile rating averages consistent with the database instead of trusting a
   * replica of a row that a trigger may have since changed.
   *
   * Realtime applies the same RLS policies as `select`, so a member only
   * receives events for rows they are allowed to read. If realtime is
   * unavailable the app still works; the page just stops updating on its own.
   */
  useEffect(() => {
    if (!isAuthenticated || !authUserId) return;

    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    /**
     * A single booking confirmation can fire several postgres_changes events in
     * quick succession, and each `applySnapshot` is eight parallel queries.
     * Coalescing them into one trailing refetch keeps a burst of updates from
     * turning into a burst of full reloads.
     */
    const schedule = () => {
      if (cancelled) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!cancelled) void applySnapshotRef.current();
      }, 400);
    };

    const client = getSupabaseClient();
    const channel = client
      .channel(`ride-together:${authUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, schedule)
      // Without these, editing a profile or a vehicle on one device leaves the
      // other device showing the old value until a manual reload.
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "ratings" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "safety_contacts" }, schedule);

    channel.subscribe((status) => {
      if (import.meta.env.DEV) console.info(`[realtime] ${status}`);
      // A fresh subscription may have missed events while it was connecting.
      if (status === "SUBSCRIBED") void applySnapshotRef.current();
    });

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      void client.removeChannel(channel);
    };
    // Keyed on the session only: see `applySnapshotRef` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Signed out: clear cloud data so nothing from the previous account stays
      // on screen, and stop the app-loading spinner.
      setUsers([]);
      setVehicles([]);
      setRides([]);
      setBookings([]);
      setMessages([]);
      setNotifications([]);
      setRatings([]);
      setSafetyContacts([]);
      setActiveUserId("");
      setLoadError(null);
      activeUserIdRef.current = "";
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        await applySnapshotRef.current();
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the session only: a new object identity for the same user must not
    // restart the bootstrap and flash the full-page loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, isAuthenticated]);

  /**
   * Wraps a Supabase mutation, then re-reads the authoritative cloud state.
   *
   * Every write in the app goes through here. Reading back after each write is
   * what keeps the screen honest: the triggers in `schema.sql` change rows this
   * browser never touched (seat counts, notifications, profile ratings), so a
   * local "optimistic" patch would drift from the server.
   */
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
    (rideId: string, seats: number): Promise<Booking> =>
      mutateCloud(() => supabaseRequestBooking(rideId, seats), "book"),
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

  /**
   * Chat and notification writes go straight to Supabase. `mutateCloud`
   * refetches afterwards, so the sender sees their own message immediately
   * without an optimistic-insert path that could disagree with the row the
   * server actually stored.
   */
  const sendMessage = useCallback(
    async (rideId: string, text: string): Promise<void> => {
      await mutateCloud(async () => {
        await supabaseSendMessage(rideId, text);
      }, "create");
    },
    [mutateCloud],
  );

  const markNotificationRead = useCallback(
    async (id: string): Promise<void> => {
      await mutateCloud(async () => {
        await supabaseMarkNotificationRead(id);
      }, "update");
    },
    [mutateCloud],
  );

  const markAllNotificationsRead = useCallback(
    async (): Promise<void> => {
      await mutateCloud(async () => {
        await supabaseMarkAllNotificationsRead();
      }, "update");
    },
    [mutateCloud],
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
        throw new Error("Your sign-in email cannot be changed here.");
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

  /**
   * Create and update are separate methods on purpose. The previous single
   * `saveVehicle(vehicle & { id? })` shape meant "add" and "edit" shared one
   * code path, so a caller that generated its own `id` silently took the
   * UPDATE branch and every add failed with "vehicle not found".
   */
  const saveVehicle = useCallback(
    async (draft: VehicleFormValues): Promise<void> => {
      await mutateCloud(async () => {
        await supabaseCreateVehicle(draft);
      }, "create");
    },
    [mutateCloud],
  );

  const updateVehicle = useCallback(
    async (vehicleId: string, draft: VehicleFormValues): Promise<void> => {
      await mutateCloud(async () => {
        await supabaseUpdateVehicle(vehicleId, draft);
      }, "update");
    },
    [mutateCloud],
  );

  const setDefaultVehicle = useCallback(
    async (vehicleId: string): Promise<void> => {
      await mutateCloud(async () => {
        await supabaseSetDefaultVehicle(vehicleId);
      }, "update");
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

  /**
   * Safety contacts are private rows keyed on the session user, so create and
   * update are separate methods for the same reason vehicles are: the previous
   * combined `saveContact(contact & { id? })` made the UI responsible for
   * identity, which is how the same class of bug got in twice.
   */
  const saveSafetyContact = useCallback(
    async (contact: SafetyContactDraft & { id?: string }): Promise<void> => {
      await mutateCloud(async () => {
        if (contact.id) {
          await supabaseUpdateSafetyContact(contact.id, contact);
        } else {
          await supabaseCreateSafetyContact(contact);
        }
      }, contact.id ? "update" : "create");
    },
    [mutateCloud],
  );

  const deleteSafetyContact = useCallback(
    (id: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseDeleteSafetyContact(id);
      }, "delete"),
    [mutateCloud],
  );

  const submitRating = useCallback(
    (
      rideId: string,
      revieweeId: string,
      stars: number,
      comment: string,
    ): Promise<void> =>
      mutateCloud(async () => {
        await supabaseSubmitRating(rideId, revieweeId, stars, comment);
      }, "create"),
    [mutateCloud],
  );

  const uploadAvatar = useCallback(
    async (file: File): Promise<string> => {
      if (!activeUserIdRef.current) throw new Error("You need to be signed in to do that.");
      try {
        return await supabaseUploadAvatar(file);
      } catch (error) {
        throw new Error(describeDataFailure(error, "update"));
      }
    },
    [],
  );

  const deleteAvatar = useCallback(
    async (publicUrl: string): Promise<void> => {
      if (!activeUserIdRef.current) return;
      await supabaseDeleteAvatar(publicUrl).catch((error: unknown) => {
        // A leftover object is untidy, not broken, so never fail the edit.
        if (import.meta.env.DEV) console.warn("[avatar] cleanup skipped", error);
      });
    },
    [],
  );

  /**
   * Clears the pre-cloud local cache an older build may have left in this
   * browser. Deliberately does not touch Supabase: everything the member cares
   * about is in the cloud, and the Settings dialog says exactly that.
   */
  const clearLocalCache = useCallback(async (): Promise<void> => {
    await clearLegacyLocalData();
  }, []);
  return (
    <AppContext.Provider
      value={{
        loading,
        loadError,
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
    updateVehicle,
    setDefaultVehicle,
    deleteVehicle,
        searchRides,
        saveSafetyContact,
        deleteSafetyContact,
    submitRating,
    uploadAvatar,
    deleteAvatar,
    clearLocalCache,
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
