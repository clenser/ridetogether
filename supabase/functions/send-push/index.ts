// Supabase Edge Function: send-push
//
// Delivers a Web Push notification to every device registered for one member.
// Runs on Deno, so it imports from esm.sh rather than node_modules.
//
// The whole point of moving delivery here is that the VAPID private key never
// reaches the browser. A client that could sign its own payload could notify
// every member of the app, so this function is the only thing that holds the
// key and the service-role key.
//
// Required secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY_X   base64url x coordinate of the P-256 key pair
//   VAPID_PUBLIC_KEY_Y   base64url y coordinate of the same key pair
//   VAPID_PRIVATE_KEY    base64url d coordinate (the only secret key material)
//   VAPID_SUBJECT        mailto: or https: contact for the push service
//   PUSH_DISPATCH_SECRET random shared secret required in the Authorization header
//
// The notification triggers in schema.sql write `public.notifications` rows.
// Something trusted has to call this function for those rows to be delivered;
// see supabase/README.md for the pg_net wiring. It is deliberately not callable
// from the browser: any caller that can reach it can notify any member, and the
// function is the only holder of the VAPID private key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** RFC 8291 aes128gcm: a single record with a 16-byte salt and 4096-byte size field. */
const RECORD_SIZE = 4096;
/** 16-byte salt prefix + 4-byte record size + 1-byte id length + ciphertext + 16-byte tag. */
const MAX_PLAINTEXT = RECORD_SIZE - 21 - 16;
const SALT_LENGTH = 16;
const AUTH_LENGTH = 16;

/** Push services return 404/410 once an endpoint is permanently gone. */
const GONE_STATUSES = new Set([404, 410]);
/** 401/403 mean the VAPID signature was rejected, which is our bug, not theirs. */
const AUTH_FAILED_STATUSES = new Set([401, 403]);

/** No CORS: this endpoint is for the database and other servers, not browsers. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const base64UrlToBytes = (value: string): Uint8Array => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

/**
 * Constant-time string comparison.
 *
 * `===` on a shared secret leaks its length and prefix through timing, which is
 * exactly the kind of oracle that turns a brute-force attempt from "hours" into
 * "minutes" on a service that fans out to every device of every member.
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
};

const hmacSha256 = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
};

/**
 * HKDF-Expand (RFC 5869) for a 32-byte PRK.
 *
 * Both the content key and the nonce come from the same PRK with the same info
 * string and differ only in output length, which is what RFC 8291 specifies.
 */
const hkdfExpand = async (
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> => {
  const block = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return block.slice(0, length);
};

/** Rebuilds the uncompressed P-256 point that both the browser and `k=` need. */
const buildVapidPublicKey = (x: string, y: string): string => {
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(base64UrlToBytes(x), 1);
  point.set(base64UrlToBytes(y), 33);
  return bytesToBase64Url(point);
};

/**
 * Builds the VAPID JWT (RFC 8292) that authorises a push request.
 *
 * The key material is held as the three base64url components of a P-256 JWK
 * rather than a PEM, so `jose` can import it directly. Generate the pair with
 * `supabase/functions/send-push/generate-vapid.ts`.
 *
 * `audience` must be the origin of the push endpoint being called. Hard-coding
 * one vendor works until a member's browser hands us a different provider, and
 * the resulting request fails with an opaque 400 from that provider.
 */
const createVapidToken = async (
  subject: string,
  audience: string,
  keyPair: { x: string; y: string; d: string },
): Promise<string> => {
  const { importJWK, SignJWT } = await import("https://esm.sh/jose@5");

  const key = await importJWK(
    { kty: "EC", crv: "P-256", x: keyPair.x, y: keyPair.y, d: keyPair.d },
    "ES256",
  );

  const now = Math.floor(Date.now() / 1000);
  // Push services reject tokens with more than 24h of validity; 12h is a common
  // middle ground and is regenerated per request anyway.
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuedAt(now)
    .setAudience(audience)
    .setSubject(subject)
    .setExpirationTime(now + 12 * 60 * 60)
    .sign(key);
};

/**
 * Encrypts a payload for one subscription (RFC 8291, aes128gcm).
 *
 * The shared secret is *derived*, not used directly: the receiver's public key
 * is an ECDH key, and the browser's `p256dh` value is that key as a raw point.
 * Feeding those 65 bytes straight into `importKey` as an AES key would fail
 * with "invalid key length", so the derivation is done explicitly here.
 */
const encryptPayload = async (
  subscription: { p256dh: string; auth: string },
  payload: string,
): Promise<Uint8Array> => {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(payload);
  if (plaintext.byteLength > MAX_PLAINTEXT) {
    throw new Error(`Payload too large for a single push message (max ${MAX_PLAINTEXT} bytes)`);
  }

  const authSecret = base64UrlToBytes(subscription.auth);
  if (authSecret.byteLength !== AUTH_LENGTH) {
    throw new Error("Subscription auth secret must be 16 bytes");
  }

  const recipientKey = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(subscription.p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // An ephemeral sender key, because ECDH needs a private half on our side too.
  const senderKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientKey },
    senderKey.privateKey,
    256,
  ));

  // Web Push inverts the usual HKDF roles: the receiver's auth secret is the
  // HMAC key and the ECDH output is the data, unlike TLS.
  const prk = await hmacSha256(authSecret, sharedSecret);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const info = encoder.encode("Content-Encoding: aes128gcm\0");
  const contentKey = await hkdfExpand(prk, info, 16);
  const nonce = await hkdfExpand(prk, info, 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);

  // RFC 8291: the record is salt || rs || idlen || keyid || ciphertext, and the
  // keyid is the base64url *text* of the receiver's auth secret. So idlen counts
  // the encoded length (22 for a 16-byte secret), not the decoded byte count -
  // using the decoded bytes here produces a record the browser cannot parse.
  // The whole header is also the AEAD's additional data.
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE, false);
  const keyId = encoder.encode(subscription.auth);
  const idLength = new Uint8Array([keyId.byteLength]);
  const header = concatBytes(salt, recordSize, idLength, keyId);

  // WebCrypto appends the 16-byte tag to the ciphertext, which is the layout
  // RFC 8291 asks for.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: header, tagLength: 128 },
    aesKey,
    plaintext,
  ));

  return concatBytes(header, ciphertext);
};

const pushEndpointOrigin = (endpoint: string): string => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Subscription endpoint is not a valid URL");
  }
  // Only real push services are allowed as targets, so a poisoned
  // `push_subscriptions` row cannot be used to make this function issue signed
  // requests to an internal address.
  if (url.protocol !== "https:") throw new Error("Subscription endpoint must be https");
  return url.origin;
};

const sendToSubscription = async (
  endpoint: string,
  keys: { p256dh: string; auth: string },
  payload: string,
  vapid: {
    keyPair: { x: string; y: string; d: string };
    publicKey: string;
    subject: string;
  },
): Promise<number> => {
  const audience = pushEndpointOrigin(endpoint);
  const body = await encryptPayload(keys, payload);
  const token = await createVapidToken(vapid.subject, audience, vapid.keyPair);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      "push delivery failed",
      response.status,
      endpoint.slice(0, 48),
      detail,
    );
  }
  return response.status;
};

const str = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKeyX = Deno.env.get("VAPID_PUBLIC_KEY_X");
  const vapidPublicKeyY = Deno.env.get("VAPID_PUBLIC_KEY_Y");
  const vapidPrivateKeyD = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const dispatchSecret = Deno.env.get("PUSH_DISPATCH_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Function environment is missing Supabase credentials." }, 500);
  }
  if (!vapidPublicKeyX || !vapidPublicKeyY || !vapidPrivateKeyD || !vapidSubject) {
    return json({ error: "VAPID secrets are not configured." }, 500);
  }
  // Fail closed rather than shipping an endpoint that anyone can call to notify
  // arbitrary members.
  if (!dispatchSecret) {
    return json({ error: "PUSH_DISPATCH_SECRET is not configured." }, 500);
  }

  // The shared secret is what distinguishes the database from an attacker who
  // found this URL. The service role below is the only reason this endpoint
  // needs protecting in the first place: it can read any member's devices.
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(presented, dispatchSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  let raw: Record<string, unknown>;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  if (typeof raw !== "object" || raw === null) {
    return json({ error: "Body must be a JSON object." }, 400);
  }

  const userId = str(raw.user_id, 64);
  if (!userId) return json({ error: "user_id is required." }, 400);

  // Optional. The database sends the notification's own id, which lets a replayed
  // trigger statement or a retried HTTP request be recognised and skipped instead
  // of notifying a member a second time.
  const notificationId = str(raw.notification_id, 64);

  const title = str(raw.title, 80) ?? "RideTogether";
  const message = str(raw.body, 240) ?? "";
  const path = str(raw.url, 200) ?? "/notifications";
  // A notification click must not be able to navigate a member to another site:
  // the payload is written by a trigger but the endpoint is remote input.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return json({ error: "url must be a path inside the app." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Claim the notification before sending, not after: the fan-out below can take
  // seconds, and two overlapping calls for the same id would both pass a check
  // made at the end. The primary key on notification_id is what makes the second
  // claim fail, so exactly one of them proceeds.
  if (notificationId) {
    const { error: claimError } = await admin
      .from("push_deliveries")
      .insert({ notification_id: notificationId, user_id: userId, delivered: 0, attempted: 0 });

    if (claimError) {
      // 23505 is the unique violation: this id has already been claimed, so this
      // call is a duplicate of work already in flight or already done.
      if (claimError.code === "23505") {
        return json({ delivered: 0, attempted: 0, skipped: true, reason: "already dispatched" });
      }
      // Anything else is a real problem with the delivery log. Carrying on would
      // mean losing the de-duplication guarantee silently, so it is reported and
      // the send is refused rather than risking a duplicate.
      console.error("push delivery log unavailable", claimError);
      return json({ error: "Could not record the delivery attempt." }, 500);
    }
  }

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh_key, auth_key")
    .eq("user_id", userId);

  if (error) return json({ error: "Could not read subscriptions." }, 500);
  if (!subscriptions || subscriptions.length === 0) {
    if (notificationId) {
      await admin
        .from("push_deliveries")
        .update({ attempted: 0, delivered: 0 })
        .eq("notification_id", notificationId);
    }
    return json({ delivered: 0, reason: "no subscriptions" });
  }

  const payload = JSON.stringify({
    title,
    body: message,
    url: path,
    tag: `ride-together-${userId.slice(0, 8)}`,
  });

  const vapid = {
    keyPair: { x: vapidPublicKeyX, y: vapidPublicKeyY, d: vapidPrivateKeyD },
    publicKey: buildVapidPublicKey(vapidPublicKeyX, vapidPublicKeyY),
    subject: vapidSubject,
  };

  const results = await Promise.allSettled(
    subscriptions.map((row) =>
      sendToSubscription(
        row.endpoint,
        { p256dh: row.p256dh_key, auth: row.auth_key },
        payload,
        vapid,
      ).catch((error: unknown) => {
        // A malformed row must not abort the fan-out to the member's other
        // devices, but it is not a delivery success either.
        console.error("push target skipped", error);
        throw error;
      }),
    ),
  );

  const settled = results.map((result, index) => ({ result, row: subscriptions[index] }));

  // A dead endpoint is a permanent condition: drop the row so the table does not
  // grow and so we stop paying to retry a subscription the browser discarded.
  const staleEndpoints = settled
    .filter(({ result }) => result.status === "fulfilled" && GONE_STATUSES.has(result.value))
    .map(({ row }) => row.endpoint);

  if (staleEndpoints.length > 0) {
    await admin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  // A rejected signature or an over-quota response is worth surfacing: both mean
  // the deployment's keys or limits are wrong rather than a single stale device.
  const authFailures = settled
    .filter(({ result }) => result.status === "fulfilled" && AUTH_FAILED_STATUSES.has(result.value))
    .map(({ row }) => row.endpoint);

  if (authFailures.length > 0) {
    console.error(
      `${authFailures.length} push target(s) rejected the VAPID signature. ` +
        "Check that the deployed VAPID_* secrets match VITE_VAPID_PUBLIC_KEY.",
    );
  }

  const delivered = settled.filter(
    ({ result }) => result.status === "fulfilled" && result.value < 300,
  ).length;
  const failed = settled.filter(({ result }) => result.status === "rejected").length;

  // A claim that reached this point but delivered nothing is released, so a
  // transient outage - a push service 5xx, a network blip between here and the
  // endpoint - is retried by the next dispatch rather than being permanently
  // suppressed by its own de-duplication row. A claim that did deliver is kept,
  // because that is the case the de-duplication exists to protect.
  if (notificationId) {
    if (delivered > 0) {
      await admin
        .from("push_deliveries")
        .update({ delivered, attempted: subscriptions.length })
        .eq("notification_id", notificationId);
    } else {
      await admin.from("push_deliveries").delete().eq("notification_id", notificationId);
    }
  }

  return json({
    delivered,
    attempted: subscriptions.length,
    pruned: staleEndpoints.length,
    failed,
    signatureRejected: authFailures.length,
  });
});
