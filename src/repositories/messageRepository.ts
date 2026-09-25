import type { Message } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed ride chat.
 *
 * Visibility is enforced by the `messages_select_participant` RLS policy, which
 * only admits rows for rides the caller drives or has a booking on, so the
 * `eq("ride_id", ...)` here is a filter and not the security boundary.
 *
 * The sender is always the authenticated user. New rows fan out a notification
 * from the `messages_notify_recipients` trigger, so a message sent from the
 * phone still notifies a driver signed in on a laptop.
 */

const MESSAGE_TABLE = "messages";
const MESSAGE_COLUMNS = "id, ride_id, sender_id, content, created_at";

export interface MessageRow {
  id: string;
  ride_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/**
 * Kept in step with the composer's own check so the two cannot drift. The
 * database allows more (`messages_content_length` is 2000), but the composer
 * refuses anything past this, so validating here gives the same message the UI
 * would have shown rather than a database error.
 */
export const MESSAGE_MAX_LENGTH = 1000;

const rowToMessage = (row: MessageRow): Message => ({
  id: row.id,
  rideId: row.ride_id,
  senderId: row.sender_id,
  text: toText(row.content),
  createdAt: row.created_at,
});

/** Oldest first, so the chat reads top to bottom. */
export const listMessages = async (rideId: string): Promise<Message[]> => {
  if (!rideId) return [];
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(MESSAGE_TABLE)
    .select(MESSAGE_COLUMNS)
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as MessageRow[]).map(rowToMessage);
};

/**
 * Every message in every ride the caller can see. Used to hydrate the chat
 * badge counts and to let the notifications list link straight to a thread
 * without a second round trip.
 */
export const listAllMessages = async (): Promise<Message[]> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(MESSAGE_TABLE)
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as MessageRow[]).map(rowToMessage);
};

export const sendMessage = async (rideId: string, text: string): Promise<Message> => {
  const senderId = await getAuthenticatedUserId();
  const content = text.trim();

  if (!rideId) throw new DataError("This chat is not linked to a ride yet.", "invalid");
  if (!content) throw new DataError("Write a message before sending.", "invalid");
  if (content.length > MESSAGE_MAX_LENGTH) {
    throw new DataError(`Messages are limited to ${MESSAGE_MAX_LENGTH} characters.`, "invalid");
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(MESSAGE_TABLE)
    .insert({ ride_id: rideId, sender_id: senderId, content })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    if (error.code === "42501") {
      throw new DataError("You can only chat about a ride you are part of.", "forbidden", error);
    }
    throw toDataError(error, "create");
  }
  return rowToMessage(data as MessageRow);
};

export { MESSAGE_COLUMNS, MESSAGE_TABLE, rowToMessage };
