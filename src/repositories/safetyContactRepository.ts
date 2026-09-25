import type { SafetyContact } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed emergency contacts.
 *
 * These are the most private rows in the app: a contact's phone number should
 * never be visible to another member, so every policy is scoped to
 * `user_id = auth.uid()` and there is no policy that lets anyone else read them.
 * The SOS demo screen in Safety only ever reads the caller's own rows.
 */

const SAFETY_TABLE = "safety_contacts";
const SAFETY_COLUMNS = "id, user_id, name, phone, relationship, created_at, updated_at";

const MAX_NAME_LENGTH = 80;
const MAX_PHONE_LENGTH = 32;
const MAX_RELATIONSHIP_LENGTH = 60;

export interface SafetyContactRow {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string | null;
  created_at: string;
  updated_at: string;
}

/** What the UI may set. The owner always comes from the session. */
export interface SafetyContactDraft {
  name: string;
  phone: string;
  relationship: string;
}

const rowToContact = (row: SafetyContactRow): SafetyContact => ({
  id: row.id,
  userId: row.user_id,
  name: toText(row.name),
  phone: toText(row.phone),
  relationship: toText(row.relationship),
});

const toPatch = (draft: SafetyContactDraft): Record<string, unknown> => ({
  name: draft.name.trim(),
  phone: draft.phone.trim(),
  relationship: draft.relationship.trim(),
});

const validateDraft = (draft: SafetyContactDraft): void => {
  if (!draft.name.trim()) throw new DataError("Enter the contact's name.", "invalid");
  if (draft.name.trim().length > MAX_NAME_LENGTH) {
    throw new DataError(`Names are limited to ${MAX_NAME_LENGTH} characters.`, "invalid");
  }
  if (!draft.phone.trim()) throw new DataError("Enter a phone number to call.", "invalid");
  if (draft.phone.trim().length > MAX_PHONE_LENGTH) {
    throw new DataError("That phone number is too long.", "invalid");
  }
  if (draft.relationship.trim().length > MAX_RELATIONSHIP_LENGTH) {
    throw new DataError("Relationships are limited to 60 characters.", "invalid");
  }
};

export const listSafetyContacts = async (): Promise<SafetyContact[]> => {
  const userId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SAFETY_TABLE)
    .select(SAFETY_COLUMNS)
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as SafetyContactRow[]).map(rowToContact);
};

export const createSafetyContact = async (draft: SafetyContactDraft): Promise<SafetyContact> => {
  validateDraft(draft);
  const userId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SAFETY_TABLE)
    .insert({ ...toPatch(draft), user_id: userId })
    .select(SAFETY_COLUMNS)
    .single();

  if (error) throw toDataError(error, "create");
  return rowToContact(data as SafetyContactRow);
};

export const updateSafetyContact = async (
  contactId: string,
  draft: SafetyContactDraft,
): Promise<SafetyContact> => {
  validateDraft(draft);
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SAFETY_TABLE)
    .update(toPatch(draft))
    .eq("id", contactId)
    .select(SAFETY_COLUMNS)
    .maybeSingle();

  if (error) throw toDataError(error, "update");
  if (!data) {
    throw new DataError("We could not find that contact. It may have been removed.", "not-found");
  }
  return rowToContact(data as SafetyContactRow);
};

export const deleteSafetyContact = async (contactId: string): Promise<void> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { error } = await client.from(SAFETY_TABLE).delete().eq("id", contactId);
  if (error) throw toDataError(error, "delete");
};

export { SAFETY_COLUMNS, SAFETY_TABLE, rowToContact };
