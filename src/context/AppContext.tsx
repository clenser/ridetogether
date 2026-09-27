import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  acceptBooking as supabaseAcceptBooking,
  cancelBooking as supabaseCancelBooking,
  listAllVisibleBookings,
  markNoShow as supabaseMarkNoShow,
  markPickedUp as supabaseMarkPickedUp,
  rejectBooking as supabaseRejectBooking,
  requestBooking as supabaseRequestBooking,
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
  startRide as supabaseStartRide,
  updateRide as supabaseUpdateRide,
  type RideWithRelations,
} from "../repositories/rideRepository";
import {
  createSeries as supabaseCreateSeries,
  type SeriesInput,
} from "../repositories/rideSeriesRepository";
import {
  listMyPayments,
  openPayment as supabaseOpenPayment,
  resolvePayment as supabaseResolvePayment,
  recordPayoutPlaceholders as supabaseRecordPayoutPlaceholders,
} from "../repositories/paymentRepository";
import {
  clearMyUpiId as supabaseClearMyUpiId,
  getMyPaymentProfile,
  saveMyUpiId as supabaseSaveMyUpiId,
} from "../repositories/paymentProfileRepository";
import { reportRideLocation as supabaseReportRideLocation } from "../repositories/liveLocationRepository";
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
  MatchScore,
  Message,
  Payment,
  PaymentStatus,
  PickupPoint,
  Rating,
  Ride,
  RideInput,
  RideLocation,
  SafetyContact,
  SearchCriteria,
  User,
  Vehicle,
} from "../types";
import { isActiveBooking } from "../types";

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
  /** Placeholder payments the member owes, or is owed. Never a money movement. */
  payments: Payment[];
  refresh: () => Promise<void>;
  createRide: (input: RideInput) => Promise<Ride>;
  /**
   * Publishes a recurring schedule. Every date in the range becomes its own ride,
   * so seats, bookings and live location stay per-occurrence.
   */
  createSeries: (input: SeriesInput) => Promise<{ seriesId: string; rideCount: number }>;
  updateRide: (rideId: string, input: RideInput) => Promise<Ride>;
  requestBooking: (
    rideId: string,
    seats: number,
    options?: { pickup?: PickupPoint; dropoff?: PickupPoint; match?: MatchScore },
  ) => Promise<Booking>;
  /**
   * The host accepts a request. The seat is held from this moment, not from
   * confirmation, so an accepted request cannot be lost to a later booking.
   * `pickup`/`dropoff` let the host move the agreed meeting points to somewhere
   * they can actually stop.
   */
  acceptBooking: (
    bookingId: string,
    options?: { pickup?: PickupPoint; dropoff?: PickupPoint },
  ) => Promise<void>;
  rejectBooking: (bookingId: string) => Promise<void>;
  markPickedUp: (bookingId: string) => Promise<void>;
  markNoShow: (bookingId: string) => Promise<void>;
  cancelBooking: (bookingId: string) => Promise<void>;
  cancelRide: (rideId: string) => Promise<void>;
  startRide: (rideId: string) => Promise<void>;
  completeRide: (rideId: string) => Promise<void>;
  /** Opens the placeholder payment for an accepted seat. */
  payBooking: (bookingId: string) => Promise<void>;
  /**
   * The host records that the money arrived, or that it did not.
   */
  resolvePayment: (
    bookingId: string,
    outcome: Extract<PaymentStatus, "success" | "failed">,
    reason?: string,
  ) => Promise<void>;
  /**
   * The host marks the placeholder payouts for their finished trips as
   * acknowledged. Moves no money; it is the last step of the placeholder
   * lifecycle and the only way a `settlement` column ever leaves `pending`.
   */
  recordPayoutPlaceholders: () => Promise<number>;
  /**
   * Publishes the host's position for a running ride. Deliberately does not
   * trigger a snapshot refresh: this fires every few seconds while driving, and
   * a full refetch per fix would swamp the channel the passengers are watching.
   */
  reportRideLocation: (input: {
    rideId: string;
    lat: number;
    lon: number;
    heading?: number;
    speedKph?: number;
    accuracyMeters?: number;
  }) => Promise<RideLocation>;
  /** Saves or clears the member's own, private UPI handle. */
  saveUpiId: (value: string) => Promise<void>;
  clearUpiId: () => Promise<void>;
  /**
   * The member's own UPI handle, or undefined when none is stored.
   *
   * Read from the private profile table rather than from the public user row, so
   * it is only ever visible to its owner. Optional: a member without one is a
   * normal state, not an error, and the caller should render an empty field.
   */
  readMyUpiId: () => Promise<string | undefined>;
  /** Bookings the member is involved in that are still live. */
  liveBookings: Booking[];
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
  const [users, setUsers] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [safetyContacts, setSafetyContacts] = useState<SafetyContact[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [theme, setTheme] = useState("light");
  const [activeUserId, setActiveUserId] = useState("");
  const activeUserIdRef = useRef("");
  const activeUser = users.find((user) => user.id === activeUserId) ?? loadingUser;

  /**
   * The bookings that still matter to the member: a request awaiting a decision, a
   * seat awaiting payment, a confirmed seat, or a passenger in the car. Derived
   * rather than fetched, so it can never drift from the authoritative list.
   */
  const liveBookings = useMemo(
    () => bookings.filter((booking) => isActiveBooking(booking.status)),
    [bookings],
  );

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
      setPayments([]);
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

    const [ridesResult, vehiclesResult, bookingsResult, profilesResult, messagesResult, notificationsResult, ratingsResult, contactsResult, paymentsResult] =
      await Promise.all([
        settle<RideWithRelations[]>(() => supabaseListRides(), "rides"),
        settle<Vehicle[]>(() => supabaseListVehicles(), "vehicles"),
        settle<Booking[]>(() => listAllVisibleBookings(), "bookings"),
        settle<Awaited<ReturnType<typeof fetchProfiles>>>(() => fetchProfiles(), "profiles"),
        settle<Message[]>(() => supabaseListAllMessages(), "messages"),
        settle<AppNotification[]>(() => supabaseListNotifications(), "notifications"),
        settle<Rating[]>(() => listRatingsByReviewer(), "ratings"),
        settle<SafetyContact[]>(() => supabaseListSafetyContacts(), "safety contacts"),
        settle<Payment[]>(() => listMyPayments(), "payments"),
      ]);

    if (paymentsResult.ok) setPayments(paymentsResult.value ?? []);
    else {
      if (payments.length === 0) setPayments([]);
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
    if (paymentsResult.ok) setPayments(paymentsResult.value ?? []);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "safety_contacts" }, schedule)
      // A payment resolving is what confirms or cancels the booking behind it, so
      // the member on the other device has to hear about it.
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, schedule);

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
      setPayments([]);
      setActiveUserId("");
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
      let result: T;
      try {
        result = await operation();
      } catch (error) {
        // A partially applied change (for example a trigger that restored seats
        // before rejecting a second write) must not be left stale on screen.
        await applySnapshot().catch(() => undefined);
        throw new Error(describeDataFailure(error, action));
      }
      // Deliberately outside the `try` above. The write has already committed at
      // this point, so a failure while re-reading it must never be reported as a
      // failure of the write - that told a rider their seat request had not been
      // sent when it had, and invited a duplicate request against a ride that now
      // has one pending booking. `applySnapshot` degrades to a banner rather than
      // throwing, but the write's outcome has to be returned on its own terms.
      await applySnapshot().catch(() => undefined);
      return result;
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
    (
      rideId: string,
      seats: number,
      options: { pickup?: PickupPoint; dropoff?: PickupPoint; match?: MatchScore } = {},
    ): Promise<Booking> =>
      mutateCloud(() => supabaseRequestBooking(rideId, seats, options), "book"),
    [mutateCloud],
  );

  /**
   * Each of these is one database transition followed by a re-read. They are kept
   * separate rather than folded into a single `setBookingStatus` so that a page
   * cannot offer the host an action the workflow does not have - the ride's
   * acceptance path, the pickup path and the cancellation path are genuinely
   * different things to a host.
   *
   * There is deliberately no generic status setter. One existed, and it was the
   * way My Rides ended up writing `status = 'confirmed'` straight onto a
   * `pending` request: a transition the database refuses, so the host's primary
   * accept button always failed and no seat was ever held. Every step is now a
   * named call whose target state the database can actually reach.
   */
  const acceptBooking = useCallback(
    (bookingId: string, options: { pickup?: PickupPoint; dropoff?: PickupPoint } = {}): Promise<void> =>
      mutateCloud(async () => {
        await supabaseAcceptBooking(bookingId, options);
      }, "confirm"),
    [mutateCloud],
  );

  const rejectBooking = useCallback(
    (bookingId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseRejectBooking(bookingId);
      }, "update"),
    [mutateCloud],
  );

  const markPickedUp = useCallback(
    (bookingId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseMarkPickedUp(bookingId);
      }, "update"),
    [mutateCloud],
  );

  const markNoShow = useCallback(
    (bookingId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseMarkNoShow(bookingId);
      }, "update"),
    [mutateCloud],
  );

  const cancelBooking = useCallback(
    (bookingId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseCancelBooking(bookingId);
      }, "cancel"),
    [mutateCloud],
  );

  const cancelRide = useCallback(
    (rideId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseCancelRide(rideId);
      }, "cancel"),
    [mutateCloud],
  );

  /**
   * Publish → driving. Once the host is on the road the ride stops taking new
   * passengers and starts streaming a position.
   */
  const startRide = useCallback(
    (rideId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseStartRide(rideId);
      }, "update"),
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
   * Publishes a recurring schedule. The repository returns the individual rides it
   * created, but the context only reports how many: a page that publishes a
   * twelve-week commute does not need every occurrence in hand, and the snapshot
   * refresh that follows has already loaded them.
   */
  const createSeries = useCallback(
    async (input: SeriesInput): Promise<{ seriesId: string; rideCount: number }> =>
      mutateCloud(async () => {
        const created = await supabaseCreateSeries(input);
        return { seriesId: created.series.id, rideCount: created.rides.length };
      }, "create"),
    [mutateCloud],
  );

  /**
   * Opens the placeholder payment. Nothing here charges anybody: the insert is
   * priced by the database and the "gateway" only supplies a reference.
   */
  const payBooking = useCallback(
    (bookingId: string): Promise<void> =>
      mutateCloud(async () => {
        await supabaseOpenPayment(bookingId);
      }, "create"),
    [mutateCloud],
  );

  /**
   * The host records the outcome. `success` confirms the booking and `failed`
   * releases the seat, both inside the same transaction as the payment write.
   */
  const resolvePayment = useCallback(
    (
      bookingId: string,
      outcome: Extract<PaymentStatus, "success" | "failed">,
      reason?: string,
    ): Promise<void> =>
      mutateCloud(async () => {
        await supabaseResolvePayment(bookingId, outcome, { reason });
      }, "update"),
    [mutateCloud],
  );

  /**
   * Settles every payout this host is currently owed on trips they have already
   * finished driving, then re-reads so the host sees the new state. The RPC is
   * idempotent, so a host with nothing pending gets `0` back rather than an
   * error - the button stays available instead of needing to know in advance
   * whether there was anything to claim.
   */
  const recordPayoutPlaceholders = useCallback(
    (): Promise<number> =>
      mutateCloud(async () => {
        return await supabaseRecordPayoutPlaceholders();
      }, "update"),
    [mutateCloud],
  );

  /**
   * Shares the host's position.
   *
   * Intentionally outside `mutateCloud`: this runs on a timer while driving, and
   * each call would otherwise trigger a nine-query snapshot refresh. Passengers
   * watching the ride have their own subscription to `ride_locations`, so the
   * position still reaches them, and the ride row itself is not changing here.
   */
  const reportRideLocation = useCallback(
    async (input: {
      rideId: string;
      lat: number;
      lon: number;
      heading?: number;
      speedKph?: number;
      accuracyMeters?: number;
    }): Promise<RideLocation> => {
      if (!activeUserIdRef.current) throw new Error("You need to be signed in to do that.");
      try {
        return await supabaseReportRideLocation(input);
      } catch (error) {
        throw new Error(describeDataFailure(error, "update"));
      }
    },
    [],
  );

  /**
   * The member's own UPI handle. Read and written only for the signed-in account,
   * and never merged into the profile directory, so it cannot be picked up by a
   * page that renders somebody else.
   */
  const saveUpiId = useCallback(
    async (value: string): Promise<void> => {
      if (!activeUserIdRef.current) throw new Error("You need to be signed in to do that.");
      try {
        await supabaseSaveMyUpiId(value);
      } catch (error) {
        throw new Error(describeDataFailure(error, "update"));
      }
    },
    [],
  );

  const clearUpiId = useCallback(
    async (): Promise<void> => {
      if (!activeUserIdRef.current) throw new Error("You need to be signed in to do that.");
      try {
        await supabaseClearMyUpiId();
      } catch (error) {
        throw new Error(describeDataFailure(error, "update"));
      }
    },
    [],
  );

  const readMyUpiId = useCallback(async (): Promise<string | undefined> => {
    if (!activeUserIdRef.current) return undefined;
    try {
      const profile = await getMyPaymentProfile();
      return profile.upiId;
    } catch (error) {
      throw new Error(describeDataFailure(error, "load"));
    }
  }, []);

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
        payments,
        liveBookings,
        refresh,
        createRide,
        createSeries,
        updateRide,
        requestBooking,
        acceptBooking,
        rejectBooking,
        markPickedUp,
        markNoShow,
        cancelBooking,
        cancelRide,
        startRide,
        completeRide,
        payBooking,
        resolvePayment,
        recordPayoutPlaceholders,
        reportRideLocation,
    saveUpiId,
    clearUpiId,
    readMyUpiId,
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
