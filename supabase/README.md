# RideTogether - Supabase

Server-side schema for RideTogether. **Supabase Auth is now the live sign-in
mechanism**: users create an account with an email address, a `profiles` row is
created automatically, and the authenticated `auth.users.id` is the identity the
whole app runs on. The demo user switcher has been removed as an auth path.

Ride, booking, chat, vehicle, safety, and notification data still lives in
IndexedDB for now. `schema.sql` is the server-side target the data layer
migrates to next, and it deliberately does not touch the local IndexedDB code.

No demo or fake data is created by `schema.sql`. Auth users are created through
Supabase Auth; a `profiles` row is created automatically when a user signs up.

## Environment variables

The frontend needs only the two public values below (see `.env.example`):

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put the service-role key in a `VITE_` variable - anything prefixed that
way is bundled into the client and shipped to every browser.

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
| `rides`           | A driver's ride: origin/destination coordinates and labels, `departure_at`, seat counts, distance, duration, contribution, status. |
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
| `Ride.contribution`      | `rides.contribution`                                           | Whole rupees; the ±10 band around `9 x distance_km` stays a client rule |
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

Also confirm: no password or token is written to `localStorage`/`sessionStorage`
by app code, and no route is reachable without a Supabase session.
