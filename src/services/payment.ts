import type { Payment, PaymentStatus } from "../types";

/**
 * The payment seam.
 *
 * Nothing in this app moves money. What exists here is the boundary a real
 * gateway would be dropped behind, so the booking workflow - accept, pay,
 * confirm, release the seat on failure - is written once against an interface
 * rather than being rewritten when a provider is chosen.
 *
 * The flow the rest of the app depends on:
 *
 *   1. the host accepts a request, which moves the booking to `payment_pending`
 *      and takes the seat out of the pool;
 *   2. the rider opens a payment. `beginPayment` returns a reference; the
 *      gateway that reference belongs to is the only thing that would change if
 *      this were real;
 *   3. the host marks it received, and the database moves the booking to
 *      `confirmed`;
 *   4. a failure releases the seat rather than leaving it held by a booking that
 *      can never be paid for.
 *
 * `beginPayment` is intentionally not implemented as a network call. There is
 * no provider, so a call would be a fake latency in front of a fake response.
 */

/** What a gateway needs to open a payment for one booking. */
export interface PaymentIntent {
  bookingId: string;
  rideId: string;
  riderId: string;
  /** What the rider owes, in whole rupees. Computed by the database, not here. */
  amount: number;
  currency: string;
}

export interface PaymentResult {
  /** The gateway's own identifier. With no gateway, a stable local reference. */
  reference: string;
  status: PaymentStatus;
}

/**
 * A gateway that can open a payment. `resolve` is deliberately absent: in this
 * build the **host** records that the money arrived, and that is a database
 * write against a column the host is authorised to change, not something a
 * client-side integration should be trusted to assert.
 */
export interface PaymentGateway {
  readonly name: string;
  /** Creates a payment intent and returns the reference to show the rider. */
  begin(intent: PaymentIntent): Promise<PaymentResult>;
  /** What the rider is told, verbatim, about the state of their payment. */
  describe(status: PaymentStatus, payment?: Payment | null): string;
}

/**
 * The no-gateway implementation.
 *
 * It produces a reference and nothing else. It is named honestly in the UI so a
 * member is never told a payment succeeded when no payment was ever attempted.
 */
export const placeholderGateway: PaymentGateway = {
  name: "placeholder",

  async begin(intent: PaymentIntent): Promise<PaymentResult> {
    return {
      reference: `placeholder-${intent.bookingId.slice(0, 8)}`,
      status: "pending",
    };
  },

  describe(status: PaymentStatus, payment?: Payment | null): string {
    switch (status) {
      case "pending":
        return "Waiting for the driver to confirm they received your payment.";
      case "success":
        return "Payment recorded. Your seat is confirmed.";
      case "failed":
        return payment?.failureReason
          ? `Payment not received: ${payment.failureReason} Your seat has been released.`
          : "Payment not received. Your seat has been released.";
      case "refunded":
        return "This payment was refunded. The amount is on its way back to you.";
      default:
        return "This payment is not available.";
    }
  },
};

/** The gateway in use. One place, so swapping it is a one-line change. */
export const paymentGateway: PaymentGateway = placeholderGateway;

/**
 * The disclaimer shown wherever a payment is discussed.
 *
 * Kept next to the gateway rather than in a component so the copy cannot drift
 * away from the implementation it describes.
 */
export const PAYMENT_DISCLAIMER =
  "This build does not move money. Payments are recorded as placeholders so the booking flow can be tested end to end.";

/** A UPI handle as a user would type it. */
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{0,32}$/;

export const isValidUpiId = (value: string): boolean => UPI_PATTERN.test(value.trim());

/**
 * Validates a UPI handle for storage.
 *
 * Returns the normalised value, or a message the field can show. Clearing the
 * field is allowed and is not an error - the handle is optional, so an empty
 * value simply removes it.
 */
export const normalizeUpiId = (value: string): { upiId?: string; error?: string } => {
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (!UPI_PATTERN.test(trimmed)) {
    return {
      error: "Enter a UPI ID in the form name@bank, for example ananya@okhdfcbank.",
    };
  }
  // UPI ids are conventionally lower case. Normalising here means two members
  // cannot end up with handles that differ only by case, which is a common
  // source of "that is not my UPI id" disputes.
  return { upiId: trimmed.toLowerCase() };
};

/** Masks a UPI handle for a summary line, e.g. `an***@okhdfcbank`. */
export const maskUpiId = (value: string): string => {
  const trimmed = value.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return trimmed;
  const name = trimmed.slice(0, at);
  const bank = trimmed.slice(at);
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(1, name.length - visible.length))}${bank}`;
};
