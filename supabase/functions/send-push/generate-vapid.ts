// Generates a VAPID key pair for Web Push.
//
// Run with Deno, then set the results as Supabase secrets and as the public
// VITE_VAPID_PUBLIC_KEY in .env:
//
//   deno run --allow-env supabase/functions/send-push/generate-vapid.ts
//
// Only VAPID_PRIVATE_KEY is secret. The public key ships in the browser bundle
// and that is expected - it can only be used to address this app's own
// subscriptions, not to forge a subscription for somebody else.

const base64UrlFromBytes = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
const { x, y, d } = jwk as { x: string; y: string; d: string };

// The Push API does not want a bare JWK coordinate. `applicationServerKey` and
// the `k=` parameter of the VAPID Authorization header both use the
// uncompressed elliptic-curve point: the 0x04 tag byte followed by the 32-byte
// x and y coordinates. Shipping `x` on its own yields a key the browser
// rejects and a header the push service rejects, so the combined form is what
// both the client and the server must use.
const uncompressed = new Uint8Array(65);
uncompressed[0] = 0x04;
uncompressed.set(base64UrlToBytes(x), 1);
uncompressed.set(base64UrlToBytes(y), 33);
const publicKey = base64UrlFromBytes(uncompressed);

console.log(`
VAPID key pair generated.

1. Client (.env, safe to commit - this is a public key):
   VITE_VAPID_PUBLIC_KEY=${publicKey}

2. Supabase secrets (the private key never leaves the server):
   supabase secrets set VAPID_PUBLIC_KEY_X=${x}
   supabase secrets set VAPID_PUBLIC_KEY_Y=${y}
   supabase secrets set VAPID_PRIVATE_KEY=${d}
   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
   supabase secrets set PUSH_DISPATCH_SECRET=$(openssl rand -hex 32)

3. The Edge Function rebuilds the combined public key from X and Y, so the two
   secrets above can never drift apart from the client value.

Keep VAPID_PUBLIC_KEY_X and VAPID_PUBLIC_KEY_Y in sync with the deployed
VITE_VAPID_PUBLIC_KEY. Changing any of them invalidates every existing browser
subscription, because the push service checks the key that signed it.
`);
