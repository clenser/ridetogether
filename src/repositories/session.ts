import { getSupabaseClient } from "../services/supabase";
import { DataError } from "./dataError";

/**
 * Every write in this folder derives the acting user from the Supabase session,
 * never from a value the UI passed in. Callers cannot forge a `driver_id` or
 * `rider_id` because they are not accepted as parameters at all.
 */
export const getAuthenticatedUserId = async (): Promise<string> => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw new DataError("Your session has expired. Please sign in again.", "forbidden", error);
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new DataError("You need to be signed in to do that.", "forbidden");
  }
  return userId;
};

/** Races a promise against a timeout so a hung request cannot lock the UI. */
export const withTimeout = async <T>(promise: Promise<T>, ms: number, action: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DataError("That took too long. Please try again.", "offline", action)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
