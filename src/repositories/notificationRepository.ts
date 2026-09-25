import type { AppNotification, NotificationType } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { toDataError, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed in-app notifications.
 *
 * Notifications are never written by the browser. They are produced by the
 * `notify_booking_change`, `notify_ride_completion` and `notify_new_message`
 * triggers, so they exist for every device the member is signed in on and
 * cannot be forged by naming somebody else as `user_id`. The only writes here
 * are the read flags.
 */

const NOTIFICATION_TABLE = "notifications";
const NOTIFICATION_COLUMNS = "id, user_id, ride_id, type, title, body, is_read, created_at";

export interface NotificationRow {
  id: string;
  user_id: string;
  ride_id: string | null;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * Types are free text in the database so a new notification kind does not need a
 * migration, but the UI switches on a fixed set. Anything unrecognised falls
 * back to `message` rather than being dropped, so a newer server can never make
 * a row invisible in the app.
 */
const KNOWN_TYPES: readonly NotificationType[] = [
  "booking-request",
  "booking-confirmed",
  "booking-rejected",
  "booking-cancelled",
  "ride-cancelled",
  "ride-completed",
  "message",
  "rating-request",
];

const toNotificationType = (value: unknown): NotificationType => {
  const raw = toText(value);
  return (KNOWN_TYPES as readonly string[]).includes(raw) ? (raw as NotificationType) : "message";
};

const rowToNotification = (row: NotificationRow): AppNotification => ({
  id: row.id,
  userId: row.user_id,
  rideId: row.ride_id ?? undefined,
  type: toNotificationType(row.type),
  title: toText(row.title),
  body: toText(row.body),
  read: Boolean(row.is_read),
  createdAt: row.created_at,
});

/** Newest first. RLS limits this to the caller's own rows. */
export const listNotifications = async (): Promise<AppNotification[]> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(NOTIFICATION_TABLE)
    .select(NOTIFICATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as NotificationRow[]).map(rowToNotification);
};

export const countUnreadNotifications = async (): Promise<number> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { count, error } = await client
    .from(NOTIFICATION_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);

  if (error) throw toDataError(error, "load");
  return count ?? 0;
};

export const markNotificationRead = async (notificationId: string): Promise<void> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { error } = await client
    .from(NOTIFICATION_TABLE)
    .update({ is_read: true })
    .eq("id", notificationId);
  if (error) throw toDataError(error, "update");
};

/**
 * Clears the unread badge in one statement. Scoped to unread rows so a tap on
 * "mark all read" does not rewrite history on rows the member already opened.
 */
export const markAllNotificationsRead = async (): Promise<void> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { error } = await client
    .from(NOTIFICATION_TABLE)
    .update({ is_read: true })
    .eq("is_read", false);
  if (error) throw toDataError(error, "update");
};

export { NOTIFICATION_COLUMNS, NOTIFICATION_TABLE, rowToNotification };
