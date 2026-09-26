import type { PaymentProfile } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { normalizeUpiId } from "../services/payment";
import { DataError, toDataError, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * The signed-in member's own payment details.
 *
 * A UPI handle lives in its own table with owner-only policies, and this
 * repository is the only thing in the app that touches it. Two consequences are
 * deliberate:
 *
 *   - it is never joined into a profile, a booking or a message read. Every read
 *     here asks for `user_id = auth.uid()`, so there is no code path that could
 *     hand one member another's handle even by accident;
 *   - it is not part of the `AppContext` snapshot, for the same reason. It is
 *     fetched only when the member opens the screen that edits it.
 */

const TABLE = "profile_payment_details";
const COLUMNS = "user_id, upi_id, updated_at";

interface PaymentProfileRow {
  user_id: string;
  upi_id: string | null;
  updated_at: string | null;
}

const rowToProfile = (row: PaymentProfileRow): PaymentProfile => ({
  userId: row.user_id,
  upiId: row.upi_id ? toText(row.upi_id) : undefined,
  updatedAt: row.updated_at ? toText(row.updated_at) : undefined,
});

/**
 * The member's saved UPI handle, or an empty profile when none is stored.
 *
 * An empty result is a normal state, not a failure: the handle is optional, so
 * a member who has never saved one must not be shown an error.
 */
export const getMyPaymentProfile = async (): Promise<PaymentProfile> => {
  const userId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<PaymentProfileRow>();

  if (error) throw toDataError(error, "load");
  return data ? rowToProfile(data as PaymentProfileRow) : { userId };
};

/**
 * Saves, replaces or clears the member's UPI handle.
 *
 * The upsert is on `user_id`, so this is one call whether the member is setting
 * it for the first time or changing it later. An empty value removes the handle
 * rather than storing an empty string, so "no handle saved" has exactly one
 * representation in the table.
 */
export const saveMyUpiId = async (value: string): Promise<PaymentProfile> => {
  const userId = await getAuthenticatedUserId();
  const { upiId, error: validationError } = normalizeUpiId(value);
  if (validationError) {
    throw new DataError(validationError, "invalid");
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(TABLE)
    .upsert({ user_id: userId, upi_id: upiId ?? null }, { onConflict: "user_id" })
    .select(COLUMNS)
    .returns<PaymentProfileRow>()
    .maybeSingle();

  if (error) {
    if (/upi/i.test(error.message ?? "")) {
      throw new DataError("That UPI ID was not accepted. Check the format and try again.", "invalid", error);
    }
    throw toDataError(error, "update");
  }
  if (!data) {
    throw new DataError("Your UPI ID could not be saved. Please try again.", "unknown");
  }
  return rowToProfile(data as PaymentProfileRow);
};

/** Removes the saved handle. Used by the "remove" action in Settings. */
export const clearMyUpiId = async (): Promise<PaymentProfile> => {
  const userId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { error } = await client.from(TABLE).delete().eq("user_id", userId);
  if (error) throw toDataError(error, "update");
  return { userId };
};

export { COLUMNS as PAYMENT_PROFILE_COLUMNS, TABLE as PAYMENT_PROFILE_TABLE };
