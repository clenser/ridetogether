# RideTogether - Supabase

Server-side schema for RideTogether. **Supabase Auth is the sign-in mechanism**:
users create an account with an email address (or Google), a `profiles` row is
created automatically, and the authenticated `auth.users.id` is the identity the
whole app runs on. The demo user switcher has been removed as an auth path.

**Supabase is the only source of truth.** Rides, vehicles, bookings, chat,
notifications, ratings, and safety contacts are all read from and written to
Postgres through the repositories in `src/repositories`. The browser no longer
keeps a writable local copy of any of them: `src/services/database.ts` exists
only so the pre-cloud IndexedDB cache can be purged, and nothing in the app ever
reads a record from it. That is deliberate - a stale local store is what allowed
a cancelled ride to still look bookable.

No demo or fake data is created by `schema.sql`. Auth users are created through
Supabase Auth; a `profiles` row is created automatically when a user signs up.

## Environment variables

The frontend needs only public values (see `.env.example`):

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_AUTH_REDIRECT_URL=https://your-app.example.com/auth/callback   # optional
VITE_VAPID_PUBLIC_KEY=<65-byte base64url P-256 point>                # optional
```

Never put the service-role key in a `VITE_` variable - anything prefixed that
way is bundled into the client and shipped to every browser. The service-role
key, the VAPID private key and the push dispatch secret are set with
`supabase secrets set` and are only ever read by the Edge Function.

---

## How to apply `schema.sql`

The script is idempotent: every object is created with an `if not exists` or a
`drop ... if exists` guard, so it can be applied to a new project, to the
existing project, and re-applied after edits without cleanup.

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and select your
   project.
2. Go to **SQL Editor** and click **New query**.
3. Open `supabase/schema.sql` from this repository, paste the whole file into
   the editor, and click **Run**.
4. Confirm it finishes with no errors. Running it twice in a row must also
   succeed.

Equivalent alternatives:

- **CLI:** `supabase db push` (linked project) or
  `supabase db execute --file supabase/schema.sql` for an existing project.
- **psql:** `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql`

After applying, confirm the result:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

All nine tables must report `rowsecurity = true`.

### Frontend configuration

The browser client is set up in `src/services/supabase.ts` and reads two public
values from Vite env:

| Variable                                | Where to find it                          |
| --------------------------------------- | ----------------------------------------- |
| `VITE_SUPABASE_URL`                     | Project Settings -> API -> Project URL    |
| `VITE_SUPABASE_PUBLISHABLE_KEY`         | Project Settings -> API -> Publishable key |

Copy `.env.example` to `.env` and fill them in. **Never** put the
`service_role` / secret key in `.env`, in `src/`, or in any bundled frontend
code. `src/services/supabase.ts` refuses to build a client when the configured
key looks like a secret key or a legacy JWT.

---

## Tables

| Table             | Purpose                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `profiles`        | App-level user record, one row per `auth.users` entry. Name, phone, avatar, bio, role, aggregate rating, trip count. |
| `vehicles`        | Vehicles owned by a profile. `seats` is 1-12, `plate` is unique, at most one `is_default` per owner.     |
| `rides`           | A driver's ride: origin/destination coordinates and labels, `departure_at`, seat counts, distance, duration, base fare, contribution, status. |
| `ride_stops`      | Ordered waypoints for a ride, unique per `(ride_id, stop_order)`.                                          |
| `bookings`        | A rider's seat request with `seats` and `status`.                                                          |
| `messages`        | Ride chat. Only the driver and the ride's active riders can read or write.                                 |
| `notifications`   | In-app notifications, one recipient per row (`user_id`).                                                   |
| `ratings`         | Post-trip ratings. Unique per `(ride_id, reviewer_id, reviewee_id)`, so duplicates are impossible.          |
| `safety_contacts` | Emergency contacts, private to the owner.                                                                 |

### Enums

- `ride_status`: `upcoming`, `active`, `completed`, `cancelled`
- `booking_status`: `pending`, `confirmed`, `rejected`, `cancelled`, `completed`

`upcoming` is new relative to the current IndexedDB build, which only uses
`active`, `cancelled`, and `completed`. Treat a ride as bookable when it is
`upcoming` or `active` and `departure_at` is still in the future.

---

## Row Level Security

RLS is enabled on every table. `authenticated` is the only role granted table
privileges; `anon` has none, so the anon key cannot read or write anything.

| Table             | select                  | insert                                 | update                                 | delete                                 |
| ----------------- | ----------------------- | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| `profiles`        | any signed-in user      | own row                                | own row                                | own row                                |
| `vehicles`        | any signed-in user      | `owner_id = auth.uid()`                | owner                                  | owner                                  |
| `rides`           | any signed-in user      | `driver_id = auth.uid()`               | driver                                 | driver                                 |
| `ride_stops`      | any signed-in user      | driver of the ride                     | driver of the ride                     | driver of the ride                     |
| `bookings`        | rider or ride driver    | `rider_id = auth.uid()`                | rider or ride driver                   | rider or ride driver                   |
| `messages`        | ride participants       | sender is a participant                | -                                      | -                                      |
| `notifications`   | own rows                | own rows                               | own rows                               | own rows                               |
| `ratings`         | any signed-in user      | completed-ride participant, not self   | -                                      | -                                      |
| `safety_contacts` | own rows                | own rows                               | own rows                               | own rows                               |

Rides, vehicles, and profiles are world-readable to signed-in users so that
"Find Ride" and driver profiles work. Bookings, messages, notifications, and
safety contacts are private to the people involved.

Participation is resolved by `SECURITY DEFINER` helpers with an empty
`search_path`, which return booleans only and never expose underlying rows:

- `is_ride_driver(ride_id)`
- `has_ride_booking(ride_id)`
- `is_ride_participant(ride_id)` - driver or rider with a `pending` / `confirmed` / `completed` booking
- `is_completed_ride_participant(ride_id)`
- `ride_has_participant(ride_id, user_id)`

These functions are revoked from `public` and `anon`, and granted only to
`authenticated`. The same applies to the trigger functions, with one exception:
`handle_new_user()` is also granted to `supabase_auth_admin`, because Supabase's
auth role - not an end-user role - fires the trigger on `auth.users`. That grant
is skipped automatically on a plain Postgres install where the role does not
exist.

### Extra database-level guarantees

- **Duplicate active bookings** - the partial unique index
  `bookings_one_active_per_rider` allows only one `pending` / `confirmed` /
  `completed` booking per `(ride_id, rider_id)`. A rider who cancels or gets
  rejected may request again.
- **Duplicate ratings** - `ratings_ride_reviewer_reviewee_key` plus
  `ratings_not_self`, and an RLS policy that only allows a completed-ride
  participant to rate another participant of the same ride.
- **No self-booking** - a `before insert or update` trigger rejects a booking
  where `rider_id` is the ride's `driver_id`.
- **Safe chat** - messages can only be inserted when `sender_id = auth.uid()`
  and the sender is a participant, and messages have no update or delete policy.

---

## Booking and seat accounting

`rides.seats_available` is maintained by the database, never by the client.

- A booking **consumes** seats when its status is `confirmed` or `completed`.
  `pending`, `rejected`, and `cancelled` consume nothing.
- The `bookings_apply_seat_change` trigger fires after insert, update of
  `status` / `seats` / `ride_id`, and delete. It locks the ride row with
  `SELECT ... FOR UPDATE`, then decrements or restores
  `seats_available` (`least(total_seats, ...)` on restore).
- If a confirmation would exceed the free seats, the trigger raises
  `check_violation` and the whole statement is rolled back. Because the row lock
  is held for the transaction, two drivers confirming at the same instant cannot
  both pass the check, so overbooking is not possible.
- The trigger runs `SECURITY DEFINER` so that riders can trigger seat changes
  without holding an UPDATE policy on `rides`.
- A new ride always starts with every seat free (`rides_init_seats`), and
  lowering `total_seats` recomputes free seats from existing bookings and fails
  if it would drop below what is already booked (`rides_sync_total_seats`).
- Deleting a ride cascades to its bookings, stops, messages, ratings, and
  notifications; the seat trigger no-ops when the ride row is already gone.

The mirrored client-side rules still apply: a rider cannot book their own ride,
seats must be between 1 and 12, and a ride cannot be completed while any
booking is still `pending`.

---

## Frontend / database mapping

The frontend uses camelCase and a few nested shapes. The database is
snake_case and flat.

| Frontend (`src/types.ts`) | Database column(s)                                             | Notes                                                        |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------ |
| `User.id`                | `profiles.id`                                                  | Equals `auth.users.id`                                       |
| `User.name`              | `profiles.full_name`                                           | Seeded from `full_name` / `name` user metadata on sign-up    |
| `User.email`             | -                                                              | Lives in `auth.users`, read with `auth.getUser()`            |
| `User.phone`             | `profiles.phone`                                               |                                                              |
| `User.avatar`            | `profiles.avatar_url`                                          |                                                              |
| `User.role`              | `profiles.role`                                                |                                                              |
| `User.bio`               | `profiles.bio`                                                 |                                                              |
| `User.rating`            | `profiles.rating`                                              | `numeric(3,2)`, 0-5                                          |
| `User.tripCount`         | `profiles.trip_count`                                          |                                                              |
| `User.joinedAt`          | `profiles.created_at`                                          |                                                              |
| `Vehicle.userId`         | `vehicles.owner_id`                                            |                                                              |
| `Vehicle.isDefault`      | `vehicles.is_default`                                          | One default per owner, enforced by index                     |
| `Ride.origin`            | `rides.origin_label`, `rides.origin_lat`, `rides.origin_lon`   | `{ lat, lon, label }` is flattened                           |
| `Ride.destination`       | `rides.destination_label`, `rides.destination_lat`, `rides.destination_lon` |                                     |
| `Ride.waypoints`         | `ride_stops` rows ordered by `stop_order`                      | `label`, `lat`, `lon` per row                                |
| `Ride.departureDate` + `departureTime` | `rides.departure_at`                    | Combine into a local timestamp on write, split on read        |
| `Ride.availableSeats`    | `rides.seats_available`                                        | Read only; maintained by the trigger                         |
| `Ride.totalSeats`        | `rides.total_seats`                                            |                                                              |
| `Ride.distanceKm`        | `rides.distance_km`                                            |                                                              |
| `Ride.durationMinutes`   | `rides.duration_minutes`                                       |                                                              |
| `Ride.baseFare`          | `rides.base_fare`                                              | Stored, not derived: `round(distance_km * 9)`, enforced by `rides_base_fare_matches_distance` |
| `Ride.contribution`      | `rides.contribution`                                           | Whole rupees; the ±10 band around the base fare is enforced by the `rides_contribution_fare_band` CHECK |
| `Message.text`           | `messages.content`                                             |                                                              |
| `AppNotification.read`   | `notifications.is_read`                                        |                                                              |
| `Booking.seats`          | `bookings.seats`                                               |                                                              |
| `Rating.stars`           | `ratings.stars`                                                | 1-5 integer                                                  |
| `SafetyContact.userId`   | `safety_contacts.user_id`                                      |                                                              |

All primary keys are `uuid` with `gen_random_uuid()` defaults, so the
camelCase `crypto.randomUUID()` ids used by IndexedDB do not need to be
preserved.

---

## Manual verification

Run these in the Supabase SQL Editor after applying the schema. Use two real
signed-up accounts (`user_a`, `user_b`) and replace the UUIDs with their
profile ids from `select id, full_name from public.profiles;`.

1. **Profile trigger** - sign up through Supabase Auth, then confirm
   `select * from public.profiles;` contains a row for the new user.
2. **RLS is on** - the query at the top of this file returns
   `rowsecurity = true` for all nine tables.
3. **Anonymous is locked out** - from the browser console with the anon key, a
   `select * from profiles` must fail or return nothing.
4. **Ride creation sets seats** - insert a ride for `user_a` with
   `total_seats = 3` and `seats_available = 0`; the stored value must become
   `3`.
5. **Booking request** - `user_b` inserts a `pending` booking. It must not change
   `seats_available`.
6. **Confirm** - `user_a` updates the booking to `confirmed`.
   `seats_available` must drop by the booked seats.
7. **Overbooking is rejected** - confirm a second booking that exceeds the
   remaining seats; the statement must fail with
   `Not enough seats left on this ride to confirm N seat(s)` and
   `seats_available` must be unchanged.
8. **Cancel restores seats** - set the booking to `cancelled`;
   `seats_available` must go back up and never exceed `total_seats`.
9. **Duplicate active booking** - `user_b` tries a second `pending` booking for
   the same ride; the unique index must reject it.
10. **Self-booking is rejected** - `user_a` inserts a booking on their own ride;
    the trigger must raise `Drivers cannot book a seat on their own ride`.
11. **Chat privacy** - `user_b` inserts a message on a ride they are booked on
    (succeeds). A third account inserts a message on the same ride (fails).
12. **Notifications privacy** - `user_b` selects from `notifications`; only their
    own rows are returned.
13. **Ratings** - after marking the ride `completed`, the rider rates the driver
    (succeeds). A second rating for the same pair fails on the unique index, and
    a self-rating fails the `ratings_not_self` check.
14. **Vehicle ownership** - `user_b` attempts to update or delete `user_a`'s
    vehicle; RLS must block it.

Re-run `schema.sql` at any point to confirm idempotency: it must complete
without errors and leave existing data intact.

---

## Frontend auth verification

Run these in the browser after `npm run dev` with a valid `.env`.

| # | Action | Expected |
|---|--------|----------|
| A | Open `/find` while signed out | Redirects to `/login`; no app shell or map renders. |
| B | Sign up with a new email and a weak password | Inline "at least 8 characters" / "one letter and one number" message; no network call. |
| C | Sign up with an email that already exists | Friendly duplicate-account message; no raw Postgres text. |
| D | Sign up with a valid new email | If email confirmation is on, the "Check your inbox" state appears. Otherwise the app lands on `/complete-profile`. |
| E | Submit an incomplete profile | Redirects back to `/complete-profile`; the app stays unreachable. |
| F | Complete the profile, then reload the page | Session is restored without a re-login; the profile is intact. |
| G | Sign out | Returns to `/login`; back/forward and a hard reload cannot re-enter the app. |
| H | `/login` -> "Forgot password?" -> submit an email | "Check your inbox" state naming the address; no password field anywhere. |
| I | Open the emailed link, set a new password | `/reset-password` accepts it, signs you out, and returns to `/login`. |
| J | Log in with the new password | Succeeds. The old password no longer works. |
| K | Re-open the same recovery link | Reports the link as expired or already used, with a way to request a new one. |
| L | Open `/auth/callback` with no session | Real error screen with "Try signing in again"; not a 404. |
| M | Sign in with Google, existing complete profile | Returns through `/auth/callback` and lands on Home. |
| N | Sign in with Google, brand-new account | `handle_new_user()` seeds the profile; an incomplete one lands on `/complete-profile`. |

Also confirm: no password or token is written to `localStorage`/`sessionStorage`
by app code, and no route is reachable without a Supabase session.

---

## Google sign-in

Email/password works with no extra setup. To add Google:

1. Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client
   (type "Web application").
2. Add your Supabase callback URL as an authorised redirect URI. Supabase shows
   it under Authentication -> URL Configuration as
   `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase Dashboard -> Authentication -> Providers -> Google: paste the client
   id and secret and enable it.
4. Supabase Dashboard -> Authentication -> URL Configuration: add your app's
   callback page to the redirect allow-list, e.g.
   `https://your-app.example.com/auth/callback`.

The browser calls `signInWithOAuth({ provider: "google" })` on the single
centralised client and returns to `VITE_AUTH_REDIRECT_URL`, or to
`<current origin>/auth/callback` when that variable is unset (which is what
local development wants). `/auth/callback` is a real route: it waits for the
session Supabase returns in the URL fragment, then forwards to `/`, where the
existing `RequireCompleteProfile` guard sends a complete profile to Home and an
incomplete one to Complete Profile. The Google button only renders when a
Supabase URL and publishable key are configured, so a misconfigured deployment
shows the email form instead of a button that cannot work.

---

## Password recovery

No dashboard setup is required - `resetPasswordForEmail` works on a fresh
project. The flow is:

1. `/login` -> "Forgot password?" -> `/forgot-password` collects the email and
   calls `client.auth.resetPasswordForEmail(email, { redirectTo })`.
2. Supabase emails a single-use link to `<origin>/reset-password`.
3. That route exchanges the token from the link's URL fragment for a session
   during client startup. An expired, already-used or foreign-device link simply
   produces no session, which the page reports as an expired link with a way to
   request a new one.
4. `client.auth.updateUser({ password })` sets the new password. Supabase requires
   a session for this call, which is why step 3 has to happen first.
5. The member is signed out and returned to `/login` to prove the new password
   works.

Only two origins are derived at runtime, both from `window.location.origin`, so
no deployment URL is hard-coded. `VITE_AUTH_REDIRECT_URL` is specific to the
OAuth callback and is deliberately **not** reused here - doing so would drop the
member on the sign-in screen instead of the password form.

**Redirect URLs to allow-list** (Authentication -> URL Configuration) - add both
for every origin you deploy to, including `http://localhost:5173`:

| URL | Purpose |
| --- | --- |
| `https://your-app.example.com/auth/callback` | Google / OAuth return |
| `https://your-app.example.com/reset-password` | password recovery email |

If your project has email confirmation enabled, the confirmation link uses the
Site URL instead, so also set Site URL to your app's origin.

Passwords are never written to `localStorage`, `sessionStorage`, IndexedDB, the
URL or any log. The new password is passed directly to Supabase Auth and dropped.

---

## Realtime

`schema.sql` adds `rides`, `bookings`, `messages`, `notifications`, `vehicles`,
`profiles`, `ratings` and `safety_contacts` to the `supabase_realtime`
publication. The client subscribes to Postgres changes and **refetches** rather
than trusting the event payload, so what a member sees is exactly what the
database holds. Events are coalesced into a single trailing refetch, because one
booking confirmation can fire several changes in quick succession and each
`applySnapshot` is a batch of parallel queries.

The wider table list is what makes "change something on one device, see it on the
other" true for profile edits, vehicle changes, ratings and safety contacts, not
just for the booking and chat flows.

If the publication does not exist yet, the guarded `DO` block creates it; if it
cannot, it raises a notice instead of failing the whole schema run. Enable it
manually with:

```sql
alter publication supabase_realtime
  add table rides, bookings, messages, notifications,
            vehicles, profiles, ratings, safety_contacts;
```

Realtime honours RLS, so a client is only pushed rows it may `SELECT` - a rider
is not pushed someone else's notifications, and non-participants are not pushed
ride chat.

---

## Profile photos (Storage)

`schema.sql` creates a public `avatars` bucket and locks writes down: the first
path segment must equal `auth.uid()`, so a member can only write inside their own
folder and can only update or delete their own objects. The bucket is public
because avatars are shown on driver profiles and ride cards to other members.

The service worker never caches `*.supabase.co` responses, so one member cannot
see another's rides through a cached API response on a shared device.

---

## Web Push

Push is optional. Without it the app is fully functional; members just have to
have the app open to see a new notification.

### Where the configuration lives

Three different places, and confusing them is the most common way to end up with
a half-configured deployment. Nothing in the first column may ever be written to
the second or third.

| Value | Belongs in | Visible to the browser? |
| --- | --- | --- |
| `VITE_VAPID_PUBLIC_KEY` | `.env` / `.env.example` / Cloudflare Pages env | **Yes** - it is a public key by design |
| `VAPID_PUBLIC_KEY_X` | `supabase secrets set` | No |
| `VAPID_PUBLIC_KEY_Y` | `supabase secrets set` | No |
| `VAPID_PRIVATE_KEY` | `supabase secrets set` | No |
| `VAPID_SUBJECT` | `supabase secrets set` | No |
| `PUSH_DISPATCH_SECRET` | `supabase secrets set` **and** Vault `push_dispatch_secret` | No |
| `push_function_url` | Vault only | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge secrets, auto-provisioned | No |

The VAPID pair is a single key pair split across two representations, which is
the easiest thing to get wrong here:

- the **browser** needs the uncompressed P-256 point `0x04 || x || y`
  (65 bytes, base64url) as `VITE_VAPID_PUBLIC_KEY`;
- the **function** needs the JWK's `x`, `y` and `d` coordinates separately,
  because that is the form `jose` can import.

`VITE_VAPID_PUBLIC_KEY` is the only push value the frontend ever reads. A
subscription row in `push_subscriptions` holds the *receiver's* public key
(`p256dh`) and auth secret for that one device; neither is a VAPID key and
neither can sign a request.

### 1. Generate a VAPID key pair

```bash
deno run --allow-env supabase/functions/send-push/generate-vapid.ts
```

The printed `VITE_VAPID_PUBLIC_KEY` is the **uncompressed P-256 point**
(`0x04 || x || y`, 65 bytes, base64url). This is not the same as the bare `x`
coordinate the JWK exposes, and it matters: `PushManager.subscribe()` rejects
anything that is not a valid curve point, so using `x` on its own means every
subscription silently fails.

### 2. Set the secrets and the client value

```bash
supabase secrets set VAPID_PUBLIC_KEY_X=<x>
supabase secrets set VAPID_PUBLIC_KEY_Y=<y>
supabase secrets set VAPID_PRIVATE_KEY=<d>
supabase secrets set VAPID_SUBJECT=mailto:you@example.com
supabase secrets set PUSH_DISPATCH_SECRET=$(openssl rand -hex 32)
```

`SUPABASE_SERVICE_ROLE_KEY` is provisioned automatically for Edge Functions on a
linked project; you only need to set it by hand for a self-hosted runtime.

Put the public key in `.env` as `VITE_VAPID_PUBLIC_KEY`. Rotating any part of the
pair invalidates every existing browser subscription, because the push service
checks the key that signed it.

### 3. Wire the database to the function

The notification triggers write `public.notifications` rows, and a statement
trigger forwards each new row to the Edge Function over `pg_net`, one request per
row, carrying the row's own `id`. The endpoint URL and the shared secret live in
Vault, not in `schema.sql`:

```sql
create extension if not exists pg_net;
select vault.create_secret('<the PUSH_DISPATCH_SECRET value>', 'push_dispatch_secret');
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/send-push',
  'push_function_url'
);
```

If either secret is missing the trigger records the reason in
`public.push_dispatch_failures`, logs a warning, and the notification row is still
written - the row is the source of truth, push is best-effort.

### 4. What the Settings screen is allowed to claim

The browser can see its own subscription; it cannot see whether anything is
listening on the other end. `public.push_service_status()` closes that gap by
returning two presence-only booleans (`dispatch_secret_set`, `function_url_set`)
read from Vault. It is `SECURITY DEFINER` because no client role may read
`vault.decrypted_secrets`, and it returns only `exists` results - never a value.

The toggle therefore reports one of three distinct states rather than a single
"enabled":

| State | What the member is told |
| --- | --- |
| No `VITE_VAPID_PUBLIC_KEY` | Push is not available in this deployment yet |
| Subscription saved, Vault empty | Subscribed on this device, **delivery is unavailable** |
| Subscription saved, Vault wired | Push is on for this device |

A saved subscription is **not** evidence that delivery works, and the UI must not
imply otherwise. Note the remaining blind spot: the Edge Function's own VAPID
secrets live in Supabase Edge secrets, which SQL cannot read, so
`push_service_status()` cannot report them. A deployment with a valid subscription
and full Vault wiring can still be waiting on an unconfigured function. That is
what step 6 below is for - the gap is closed by a manual check, not by a guess in
the client.

### 5. Why the function is locked down

`send-push` holds the VAPID private key **and** uses the service role to read any
member's subscription rows, so anyone who can call it can notify arbitrary
members. It therefore:

- requires `Authorization: Bearer <PUSH_DISPATCH_SECRET>`, compared in constant
  time, and fails closed when the secret is unset;
- serves no CORS headers, because it is not a browser endpoint;
- validates `title`, `body` and `url` lengths, and rejects any `url` that is not
  an in-app path, so a notification click cannot be used as an open redirect;
- only sends to `https:` endpoints, so a poisoned subscription row cannot make the
  function issue signed requests at an internal address;
- derives the VAPID `aud` from the origin of the endpoint being called, and signs
  with the combined public key.

Encryption is RFC 8291 `aes128gcm`, derived explicitly with ECDH + HKDF rather
than by importing the receiver's 65-byte public key as an AES key (which would
fail with an invalid-key-length error). The record's `keyid` is the base64url
*text* of the receiver's auth secret, so `idlen` is 22, not 16.

### 6. Duplicate suppression

A member may have a phone, a tablet and a laptop, each with its own row in
`push_subscriptions`; all of them are targeted on every event, and the unique
constraint on `endpoint` means one browser is never targeted twice. Re-sending is
suppressed on `notifications.id`:

- the function **claims** the id by inserting into `push_deliveries` *before*
  sending, and a unique-violation (`23505`) means this call is a duplicate of work
  already in flight or already done, so it returns `skipped` without sending;
- a claim that delivered nothing is **deleted** afterwards, so a transient push
  service 5xx is retried rather than being permanently suppressed by its own
  de-duplication row;
- the claim is released on the "no subscriptions" path for the same reason.

The dispatch trigger iterates the inserted rows by id rather than grouping by
recipient. Grouping by recipient alone - as an earlier version did - also
collapsed genuinely different notifications aimed at the same member inside one
statement, so a member could be sent a booking request and silently never hear
about the cancellation that followed it in the same transaction.

Realtime events and page refreshes are not dispatch sources at all: notifications
are created by database triggers, and a reload reads rows rather than writing
them. So neither can produce a duplicate push.

### 7. Verify

```bash
supabase functions deploy send-push
```

Then check the delivery path is actually complete:

```sql
select * from public.push_service_status();      -- both columns must be true
select count(*) from public.push_dispatch_failures;  -- must be 0
```

With the app closed, have another member request a seat. The
`notifications_dispatch_push` trigger fires, the function logs one line per
device, and a `signatureRejected` count above zero means the deployed
`VAPID_*` secrets do not match `VITE_VAPID_PUBLIC_KEY`. Endpoints that answer
404/410 are deleted automatically.

The multi-device path is: driver publishes a ride, a second browser profile signed
in as the rider requests a seat, and both browsers have push enabled. Every step -
request, confirm, reject, cancel, chat, complete, rate - must produce exactly one
OS notification on the *other* member's devices and none on the actor's.

---


## Deployment

`npm run build` produces a static `dist/`. It can be served from any static host
as long as unknown paths fall back to `index.html`, because the app uses real
paths (`/find`, `/rides/:id`, `/auth/callback`, `/reset-password`) and a hard
refresh or a shared link would otherwise 404. That matters for the auth routes
in particular: an emailed recovery link and a Google return both land on real
paths that must survive a cold load.

### Cloudflare Workers Static Assets

`wrangler.jsonc` is the deployment config:

```jsonc
{
  "name": "ridetogether",
  "compatibility_date": "2026-09-26",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

Deploy with `npx wrangler deploy`. The `name` must match the Worker the dashboard
has already created, or a second Worker is created.

**There is intentionally no `_redirects` file.** A catch-all
`/*  /index.html  200` is rejected by Cloudflare with error **100324**, "Infinite
loop detected in this rule": the rewrite target `/index.html` is itself matched
by `/*`, so the engine strips `.html` to canonicalise the URL to `/index` and
re-enters the same rule. `not_found_handling: "single-page-application"` gives the
same behaviour natively - existing assets are served, and anything else returns
`/index.html` with a 200 - as a fallback rather than a rewrite, so the browser URL
never changes and there is no rule to loop.

Notes for any host:

- Set the `VITE_*` variables in the platform's environment, not in a committed file.
- Serve over HTTPS: service workers, Web Push and Google OAuth all require it.

`public/sw.js` is copied into `dist/` as-is and precaches the app shell plus the
offline page. Map tiles are cached opportunistically, and Supabase traffic is
never cached.

## Static schema checks

```bash
npm run check:schema
```

Verifies, without a database connection, that `$$` quoting is balanced, that every
`REVOKE`/`GRANT` names a function that exists with the same argument types, that
every trigger fires a declared function, that no `SECURITY DEFINER` function is
granted to `authenticated`, and that the `pg_net` dispatch trigger uses a
transition table. It does **not** replace applying the schema to a real project:
grants written through `execute format(...)` are invisible to it, and RLS
behaviour is only provable against live data.
