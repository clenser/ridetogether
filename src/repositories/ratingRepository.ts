import type { Rating } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed post-trip ratings.
 *
 * `ratings_ride_reviewer_reviewee_key` makes a duplicate rating impossible at
 * the database level, and the `ratings_insert_participant` RLS policy only admits
 * a row when the reviewer actually took part in that completed ride, so neither
 * the reviewer nor the reviewee can be supplied by the client as a way around
 * either rule.
 *
 * The insert fires `ratings_sync_profile`, which recomputes `profiles.rating`
 * and `profiles.trip_count`. The UI therefore never averages ratings itself.
 */

const RATING_TABLE = "ratings";
const RATING_COLUMNS = "id, ride_id, reviewer_id, reviewee_id, stars, comment, created_at";

const MAX_COMMENT_LENGTH = 500;

export interface RatingRow {
  id: string;
  ride_id: string;
  reviewer_id: string;
  reviewee_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
}

const rowToRating = (row: RatingRow): Rating => ({
  id: row.id,
  rideId: row.ride_id,
  reviewerId: row.reviewer_id,
  revieweeId: row.reviewee_id,
  stars: row.stars,
  comment: toText(row.comment),
  createdAt: row.created_at,
});

/**
 * Ratings left *about* a driver, newest first. `ratings_select_authenticated`
 * lets any signed-in member read ratings so the profile page can show a driver's
 * score, but the app only ever asks about one person at a time.
 */
export const listRatingsAbout = async (userId: string): Promise<Rating[]> => {
  await getAuthenticatedUserId();
  if (!userId) return [];
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(RATING_TABLE)
    .select(RATING_COLUMNS)
    .eq("reviewee_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as RatingRow[]).map(rowToRating);
};

/** Only the reviewer's own ratings: `ratings_select_reviewer` allows these. */
export const listRatingsByReviewer = async (): Promise<Rating[]> => {
  const reviewerId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(RATING_TABLE)
    .select(RATING_COLUMNS)
    .eq("reviewer_id", reviewerId)
    .order("created_at", { ascending: false });

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as RatingRow[]).map(rowToRating);
};

export const submitRating = async (
  rideId: string,
  revieweeId: string,
  stars: number,
  comment: string,
): Promise<Rating> => {
  const reviewerId = await getAuthenticatedUserId();
  const cleanComment = comment.trim();

  if (!rideId) throw new DataError("A rating must belong to a ride.", "invalid");
  if (!revieweeId) throw new DataError("Choose who you are rating.", "invalid");
  if (revieweeId === reviewerId) throw new DataError("You cannot rate yourself.", "invalid");
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new DataError("Choose a rating between 1 and 5 stars.", "invalid");
  }
  if (cleanComment.length > MAX_COMMENT_LENGTH) {
    throw new DataError(`Comments are limited to ${MAX_COMMENT_LENGTH} characters.`, "invalid");
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(RATING_TABLE)
    .insert({
      ride_id: rideId,
      // The reviewer is the session, never a value the UI could tamper with.
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      stars,
      comment: cleanComment,
    })
    .select(RATING_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new DataError("You have already rated this person for this ride.", "duplicate", error);
    }
    if (error.code === "42501") {
      throw new DataError("You can only rate someone you shared a completed ride with.", "forbidden", error);
    }
    if (error.code === "23514") {
      throw new DataError("That rating is not valid yet. It can only be left after the ride is completed.", "invalid", error);
    }
    throw toDataError(error, "create");
  }
  return rowToRating(data as RatingRow);
};

/** Has this reviewer already rated this reviewee on this ride? */
export const hasRated = (
  ratings: Rating[],
  rideId: string,
  revieweeId: string,
): boolean =>
  ratings.some(
    (rating) => rating.rideId === rideId && rating.revieweeId === revieweeId,
  );

export { RATING_COLUMNS, RATING_TABLE, rowToRating };
