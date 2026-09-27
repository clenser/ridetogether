import type { Payment, PaymentStatus, SettlementStatus } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { paymentGateway } from "../services/payment";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase access for the payment placeholder.
 *
 * Every write here is a status change on a row the database then reacts to:
 * resolving a payment is what confirms or cancels the booking, and that reaction
 * happens in `apply_payment_outcome` rather than in this file. Nothing here
 * touches `rides.seats_available`.
 *
 * The amount is never sent by the client. `guard_payment_insert` recomputes it
 * from the host's contribution, so a caller cannot offer to pay ₹1 for a ₹180
 * seat.
 */

const PAYMENT_TABLE = "payments";
const PAYMENT_COLUMNS =
  "id, booking_id, ride_id, rider_id, amount, currency, status, settlement,"
  + " provider, provider_ref, failure_reason, settled_at, created_at, updated_at";

export interface PaymentRow {
  id: string;
  booking_id: string;
  ride_id: string;
  rider_id: string;
  amount: number;
  currency: string;
  status: string;
  settlement: string;
  provider: string;
  provider_ref: string | null;
  failure_reason: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

const toPaymentStatus = (value: unknown): PaymentStatus => {
  const status = toText(value, "pending");
  if (status === "success" || status === "failed" || status === "refunded") return status;
  return "pending";
};

const toSettlementStatus = (value: unknown): SettlementStatus => {
  const status = toText(value, "not_due");
  return status === "pending" || status === "complete" ? status : "not_due";
};

export const rowToPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  bookingId: row.booking_id,
  rideId: row.ride_id,
  riderId: row.rider_id,
  amount: toNumber(row.amount, 0),
  currency: toText(row.currency, "INR"),
  status: toPaymentStatus(row.status),
  settlement: toSettlementStatus(row.settlement),
  provider: toText(row.provider, "placeholder"),
  providerRef: row.provider_ref ? toText(row.provider_ref) : undefined,
  failureReason: row.failure_reason ? toText(row.failure_reason) : undefined,
  settledAt: row.settled_at ? toText(row.settled_at) : undefined,
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

export const getPaymentForBooking = async (bookingId: string): Promise<Payment | null> => {
  if (!bookingId) return null;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(PAYMENT_TABLE)
    .select(PAYMENT_COLUMNS)
    .eq("booking_id", bookingId)
    .maybeSingle()
    .returns<PaymentRow>();

  if (error) throw toDataError(error, "load");
  return data ? rowToPayment(data) : null;
};

/** A UUID that cannot exist, so an empty `in` list is still valid PostgREST. */
const PAYMENT_NO_MATCH = "00000000-0000-0000-0000-000000000000";

/**
 * PostgREST cannot express "rides where I am the driver" as a filter on
 * `payments`, so the driver's ride ids are collected first. The list is small -
 * a member's own rides - and the result is inlined as a literal `in` filter.
 */
const rideIdsForDriver = async (driverId: string): Promise<string[]> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("rides")
    .select("id")
    .eq("driver_id", driverId)
    .limit(500);
  if (error) return [];
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
};

/**
 * Payments tied to the signed-in user, newest first - the ones they owe as a
 * rider and the ones owed to them as a host. RLS returns only the rows they are
 * involved in, so a single query covers both sides.
 */
export const listMyPayments = async (): Promise<Payment[]> => {
  const riderId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const driverRideIds = await rideIdsForDriver(riderId);
  const driverBranch = driverRideIds.length > 0
    ? `ride_id.in.(${driverRideIds.join(",")})`
    : `ride_id.in.(${PAYMENT_NO_MATCH})`;

  const { data, error } = await client
    .from(PAYMENT_TABLE)
    .select(PAYMENT_COLUMNS)
    .or(`rider_id.eq.${riderId},${driverBranch}`)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<PaymentRow[]>();

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as PaymentRow[]).map(rowToPayment);
};

/**
 * The rider opens a payment for an accepted seat.
 *
 * There is no gateway to call, so the only real work is the insert, which the
 * database validates and prices. It is safe to retry: the unique constraint on
 * `booking_id` turns a second attempt into a readable error rather than a second
 * charge, and a booking that already has one returns the existing row.
 */
export const openPayment = async (bookingId: string): Promise<Payment> => {
  const riderId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(PAYMENT_TABLE)
    .insert({
      booking_id: bookingId,
      rider_id: riderId,
      currency: "INR",
      status: "pending",
      settlement: "not_due",
      provider: paymentGateway.name,
    })
    .select(PAYMENT_COLUMNS)
    .returns<PaymentRow[]>();

  if (error) {
    if (error.code === "23505") {
      const existing = await getPaymentForBooking(bookingId);
      if (existing) return existing;
    }
    if (/not awaiting payment/i.test(error.message ?? "")) {
      throw new DataError(
        "This seat is not waiting for payment. It may already be confirmed or cancelled.",
        "invalid",
        error,
      );
    }
    if (/own booking/i.test(error.message ?? "")) {
      throw new DataError("You can only pay for your own seat.", "forbidden", error);
    }
    throw toDataError(error, "create");
  }

  const rows = (data ?? []) as PaymentRow[];
  if (rows.length === 0) {
    const existing = await getPaymentForBooking(bookingId);
    if (existing) return existing;
    throw new DataError("The payment was not opened. Please try again.", "unknown");
  }

  const payment = rowToPayment(rows[0]);

  // The reference is what a real gateway would have handed back. Recording it
  // keeps the seam visible in the data, so swapping in a provider is a change to
  // `paymentGateway`, not a change to the booking flow.
  const result = await paymentGateway.begin({
    bookingId: payment.bookingId,
    rideId: payment.rideId,
    riderId: payment.riderId,
    amount: payment.amount,
    currency: payment.currency,
  });

  const { data: referenced, error: referenceError } = await client
    .from(PAYMENT_TABLE)
    .update({ provider_ref: result.reference })
    .eq("id", payment.id)
    .select(PAYMENT_COLUMNS)
    .returns<PaymentRow>()
    .maybeSingle();

  if (referenceError) {
    // The payment exists; only the cosmetic reference is missing. Reporting a
    // failure here would tell the rider their payment did not open when it did.
    if (import.meta.env.DEV) {
      console.info("[payments] could not record the gateway reference", referenceError);
    }
    return payment;
  }

  return referenced ? rowToPayment(referenced) : payment;
};

/**
 * The host records that the money arrived, or that it did not.
 *
 * `success` confirms the booking and `failed` releases the seat, both inside the
 * same database transaction as this write, so the seat count can never disagree
 * with the booking status.
 */
export const resolvePayment = async (
  bookingId: string,
  outcome: Extract<PaymentStatus, "success" | "failed">,
  options: { reason?: string } = {},
): Promise<Payment> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(PAYMENT_TABLE)
    .update({
      status: outcome,
      failure_reason: outcome === "failed" ? (options.reason?.trim() || null) : null,
    })
    .eq("booking_id", bookingId)
    .eq("status", "pending")
    .select(PAYMENT_COLUMNS)
    .returns<PaymentRow>()
    .maybeSingle();

  if (error) {
    const detail = `${error.message ?? ""} ${error.details ?? ""}`;
    if (/only the driver/i.test(detail)) {
      throw new DataError("Only the driver can mark a payment as received.", "forbidden", error);
    }
    if (/already been resolved/i.test(detail)) {
      throw new DataError("That payment has already been resolved.", "duplicate", error);
    }
    throw toDataError(error, "update");
  }
  if (!data) {
    throw new DataError(
      "We could not find a pending payment for that seat. It may already be settled.",
      "not-found",
    );
  }

  return rowToPayment(data as PaymentRow);
};

/**
 * The host acknowledges the placeholder payouts owed to them for a trip they
 * have finished driving.
 *
 * This is the third leg of the placeholder lifecycle
 * (`payment_success -> settlement_pending -> settlement_complete`) and it moves
 * no money. It is a single call to the `record_payout_placeholders` RPC, which
 * is the only place a settlement status is ever written, and it is host-scoped
 * in the database - a caller cannot settle somebody else's payout.
 *
 * The RPC updates rows rather than returning them, so the rows are re-read
 * afterwards. Refreshing regardless of the count means a host who taps twice sees
 * the same settled state rather than a second unexplained press.
 */
export const recordPayoutPlaceholders = async (): Promise<number> => {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("record_payout_placeholders");
  if (error) {
    if (error.code === "42501" || /permission|denied/i.test(error.message ?? "")) {
      throw new DataError("Only the driver can settle their own payouts.", "forbidden", error);
    }
    throw toDataError(error, "update");
  }
  return toNumber(data, 0);
};

export { PAYMENT_COLUMNS, PAYMENT_TABLE };
