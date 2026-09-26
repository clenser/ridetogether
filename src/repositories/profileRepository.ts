import type { User as SupabaseUser } from "@supabase/supabase-js";
import { describeAuthError } from "../services/auth";
import { getSupabaseClient } from "../services/supabase";
import type { User } from "../types";

export interface ProfileRow {
  id: string;
  full_name: string;
  phone: string;
  avatar_url: string | null;
  bio: string;
  role: string;
  rating: number | string;
  trip_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileChanges {
  fullName?: string;
  phone?: string;
  bio?: string;
  avatarUrl?: string;
  role?: string;
}

const PROFILE_TABLE = "profiles";
const PROFILE_COLUMNS =
  "id, full_name, phone, avatar_url, bio, role, rating, trip_count, created_at, updated_at";

/**
 * Wraps a failure that already has a user-facing message so callers can surface
 * the specific reason (RLS, network, missing row) instead of a generic one.
 */
export class ProfileError extends Error {
  readonly friendlyMessage: string;

  constructor(friendlyMessage: string) {
    super(friendlyMessage);
    this.name = "ProfileError";
    this.friendlyMessage = friendlyMessage;
  }
}

/**
 * Returns the user-facing sentence for a profile failure. Raw Supabase messages
 * are never propagated to the interface.
 */
export const describeProfileFailure = (error: unknown): string => {
  if (error instanceof ProfileError) {
    return error.friendlyMessage;
  }
  if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
    return describeAuthError(error, "profile");
  }
  // Anything else is mapped rather than passed through. A raw `Error.message`
  // from the client can name tables, columns or env vars, none of which belong
  // in front of a member.
  return describeProfileError(error);
};

const describeProfileError = (error: unknown): string => {  if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
    return describeAuthError(error, "profile");
  }

  const candidate = (typeof error === "object" && error !== null
    ? (error as { code?: unknown; message?: unknown; status?: unknown })
    : {});
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const status = typeof candidate.status === "string" ? candidate.status : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";

  if (code === "42501" || status === "403" || /row-level security/i.test(message)) {
    return "You do not have permission to change this profile.";
  }
  if (code === "PGRST116" || status === "404") {
    return "We could not find your profile record.";
  }
  if (
    code === "failed_to_fetch"
    || /failed to fetch|network/i.test(message)
  ) {
    return "We could not reach the server. Check your connection and try again.";
  }
  return "We could not save your profile right now. Please try again.";
};

const toNumber = (value: number | string | null | undefined, fallback: number): number => {  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const fetchProfile = async (userId: string): Promise<ProfileRow | null> => {
  if (!userId) return null;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(PROFILE_TABLE)
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new ProfileError(describeProfileError(error));
  }
  return (data as ProfileRow | null) ?? null;
};

const insertProfile = async (userId: string, patch: Record<string, string>): Promise<ProfileRow> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(PROFILE_TABLE)
    .insert({ id: userId, ...patch })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    // 23505 = unique violation. The handle_new_user() trigger already created
    // the row, so a concurrent insert lost the race. Fall back to an update so
    // we never surface a duplicate-key error to the user.
    if (error.code === "23505") {
      const raced = await updateProfileRow(userId, patch);
      if (raced) return raced;
    }
    throw new ProfileError(describeProfileError(error));
  }
  return data as ProfileRow;
};

/** Returns null when no row exists, so callers can decide to insert instead. */
const updateProfileRow = async (
  userId: string,
  patch: Record<string, string>,
): Promise<ProfileRow | null> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(PROFILE_TABLE)
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new ProfileError(describeProfileError(error));
  }
  return (data as ProfileRow | null) ?? null;
};

const fetchProfileOrThrow = async (userId: string): Promise<ProfileRow> => {
  const existing = await fetchProfile(userId);
  if (!existing) {
    throw new ProfileError("We could not save your profile. Please try again.");
  }
  return existing;
};

/**
 * Saves profile fields to Supabase. The row is created once by the
 * handle_new_user() trigger, so this always issues an UPDATE and an existing
 * profile is preserved. An INSERT is only attempted when the row genuinely does
 * not exist yet (for example an account created before the schema was applied).
 */
export const saveProfile = async (
  userId: string,
  changes: ProfileChanges,
): Promise<ProfileRow> => {
  if (!userId) {
    throw new ProfileError("You are not signed in.");
  }

  const patch: Record<string, string> = {};
  if (changes.fullName !== undefined) patch.full_name = changes.fullName.trim();
  if (changes.phone !== undefined) patch.phone = changes.phone.trim();
  if (changes.bio !== undefined) patch.bio = changes.bio.trim();
  if (changes.avatarUrl !== undefined) {
    patch.avatar_url = changes.avatarUrl.trim();
  }
  if (changes.role !== undefined) patch.role = changes.role.trim();

  // Nothing to write: return the stored row untouched rather than inserting.
  if (Object.keys(patch).length === 0) {
    return fetchProfileOrThrow(userId);
  }

  const updated = (await updateProfileRow(userId, patch)) ?? (await insertProfile(userId, patch));

  if (import.meta.env.DEV) {
    console.info("[profile] saved to Supabase", {
      userId,
      fields: Object.keys(patch),
      complete: isProfileComplete(updated),
    });
  }
  return updated;
};

/**
 * A profile counts as complete when the fields the app actually requires are
 * filled in. Avatar/photo and bio are optional by design, so they are never
 * part of this check - otherwise a user could never pass the gate.
 */
export const isProfileComplete = (row: ProfileRow | null): boolean => {
  if (!row) return false;
  const name = (row.full_name ?? "").trim();
  const phone = (row.phone ?? "").trim();
  return name.length >= 2 && phone.replace(/\D/g, "").length >= 7;
};

/**
 * Explains which required field is still missing, for the completion screen and
 * for development logging. Returns null when the profile is already complete.
 */
export const describeProfileGaps = (row: ProfileRow | null): string[] => {
  if (!row) return ["profile row missing"];
  const gaps: string[] = [];
  if ((row.full_name ?? "").trim().length < 2) gaps.push("full_name");
  if ((row.phone ?? "").trim().replace(/\D/g, "").length < 7) gaps.push("phone");
  return gaps;
};

/**
 * Maps a Supabase profile row (plus the auth email) onto the app's User shape
 * so existing screens keep working without knowing about Supabase.
 */
/**
 * Every profile the signed-in user is allowed to see. `profiles` RLS allows any
 * authenticated user to read profiles, which is what the app needs to show a
 * driver's name, avatar, rating and trip count next to a ride.
 */
export const fetchProfiles = async (): Promise<ProfileRow[]> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(PROFILE_TABLE)
    .select(PROFILE_COLUMNS)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    throw new ProfileError(describeProfileError(error));
  }
  return (data ?? []) as ProfileRow[];
};

export const toAppUser = (
  row: ProfileRow | null,
  authUser: SupabaseUser | null,
): User | null => {
  if (!authUser && !row) return null;
  if (!row) {
    return {
      id: authUser?.id ?? "",
      name: "",
      email: authUser?.email ?? "",
      phone: "",
      avatar: "",
      role: "",
      bio: "",
      rating: 0,
      tripCount: 0,
      joinedAt: authUser?.created_at ?? "",
    };
  }

  return {
    id: row.id,
    name: row.full_name ?? "",
    email: authUser?.email ?? "",
    phone: row.phone ?? "",
    avatar: row.avatar_url ?? "",
    role: row.role ?? "",
    bio: row.bio ?? "",
    rating: toNumber(row.rating, 0),
    tripCount: toNumber(row.trip_count, 0),
    joinedAt: row.created_at ?? "",
  };
};
