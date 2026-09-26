import { getSupabaseClient } from "../services/supabase";

/**
 * Server-side half of the push status, as reported by the database.
 *
 * The browser can see its own subscription but has no way to tell whether the
 * database can reach the Edge Function, so without this the Settings screen can
 * only ever report local state. That is what makes a "Notifications enabled"
 * claim unreliable: a stored subscription proves the browser is willing, not that
 * anything is listening on the other end.
 *
 * `push_service_status()` answers with two booleans and no values - the secret
 * themselves stay in Vault, unreadable by any client role.
 */
export interface PushServiceStatus {
  /** The shared dispatch secret is present in Vault. */
  dispatchSecretSet: boolean;
  /** The Edge Function URL is present in Vault and non-empty. */
  functionUrlSet: boolean;
}

const toServiceStatus = (row: unknown): PushServiceStatus => {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    dispatchSecretSet: record.dispatch_secret_set === true,
    functionUrlSet: record.function_url_set === true,
  };
};

/**
 * Reads the delivery-path status, or `null` when it cannot be determined.
 *
 * A `null` result is a real possibility rather than an error case: the RPC does
 * not exist until this schema has been applied, and the table it reads lives in
 * Vault, which is absent on a non-Supabase host. Callers must treat it as "cannot
 * confirm", never as "working".
 */
export const getPushServiceStatus = async (): Promise<PushServiceStatus | null> => {
  const { data, error } = await getSupabaseClient().rpc("push_service_status");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return toServiceStatus(row);
};

/** True only when both halves of the database-to-function path are in place. */
export const isPushDeliveryWired = (status: PushServiceStatus | null): boolean =>
  status !== null && status.dispatchSecretSet && status.functionUrlSet;
