import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase Storage backed profile photos.
 *
 * The `avatars` bucket is public so a driver photo can be rendered on a ride
 * card with a plain `<img src>`, but writes are private: the storage policies
 * require the first path segment to be the caller's own id, so one member can
 * never overwrite or delete another's photo. This module keeps that shape by
 * always building paths as `<userId>/<file>.<ext>` and never accepting a path
 * from the UI.
 */

const BUCKET = "avatars";

/** 2 MB is generous for a profile photo and keeps the public bucket cheap. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Extensions we are willing to store, derived from the accepted MIME types. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const randomId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const describeStorageError = (error: unknown): DataError => {
  if (error instanceof DataError) return error;
  const candidate = (typeof error === "object" && error !== null
    ? (error as { message?: unknown })
    : {});
  const message = typeof candidate.message === "string" ? candidate.message : "";

  if (/row-level security|not authorized|new row violates/i.test(message)) {
    return new DataError("You can only change your own photo.", "forbidden", error);
  }
  if (/exceeded the maximum allowed size|payload too large/i.test(message)) {
    return new DataError(`Photos must be smaller than ${AVATAR_MAX_BYTES / (1024 * 1024)} MB.`, "invalid", error);
  }
  if (/mime type|invalid input/i.test(message)) {
    return new DataError("That file type is not supported.", "invalid", error);
  }
  return toDataError(error, "update");
};

/**
 * Uploads a photo and returns its public URL.
 *
 * The returned URL is what goes into `profiles.avatar_url`. The upload happens
 * immediately rather than on form submit so a slow connection does not leave the
 * member staring at a spinner on an unrelated "Save" button, and so a failed
 * upload can be reported against the file field itself.
 */
export const uploadAvatar = async (file: File): Promise<string> => {
  const userId = await getAuthenticatedUserId();

  if (!file) throw new DataError("Choose a photo to upload.", "invalid");
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    throw new DataError("Photos must be a JPG, PNG, WebP or GIF image.", "invalid");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new DataError(`Photos must be smaller than ${AVATAR_MAX_BYTES / (1024 * 1024)} MB.`, "invalid");
  }

  const extension = EXTENSION_BY_TYPE[file.type] ?? "jpg";
  const path = `${userId}/${randomId()}.${extension}`;
  const client = getSupabaseClient();

  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    // A unique path per upload means there is nothing to overwrite, so the
    // upsert flag would only invite confusion.
    upsert: false,
    cacheControl: "31536000",
    contentType: file.type,
  });

  if (error) throw describeStorageError(error);

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new DataError("Your photo was uploaded but could not be read back. Please try again.", "unknown");
  }
  return data.publicUrl;
};

/**
 * Removes a previously uploaded photo.
 *
 * Only paths inside the caller's own folder are attempted, and a miss is not
 * treated as a failure: the profile row is cleared either way, so refusing to
 * finish because an old object is already gone would be worse than leaving it.
 */
export const deleteAvatar = async (publicUrl: string): Promise<void> => {
  if (!publicUrl) return;
  const userId = await getAuthenticatedUserId();
  const path = extractOwnedPath(publicUrl, userId);
  if (!path) return;

  const client = getSupabaseClient();
  const { error } = await client.storage.from(BUCKET).remove([path]);
  if (error && import.meta.env.DEV) {
    console.warn("[avatar] remove failed", error);
  }
};

/**
 * Recovers the storage path from a public URL, but only when it lives in the
 * caller's own folder. Returns null for external links (someone pasted a URL)
 * and for anything belonging to another member, so a crafted URL can never turn
 * a profile edit into a delete of somebody else's file.
 */
const extractOwnedPath = (publicUrl: string, userId: string): string | null => {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;

  const path = decodeURIComponent(publicUrl.slice(index + marker.length));
  if (!path.startsWith(`${userId}/`)) return null;
  // Defend against traversal even though Storage normalises it server-side.
  if (path.includes("..")) return null;
  return path;
};

export { BUCKET as AVATAR_BUCKET, extractOwnedPath };
