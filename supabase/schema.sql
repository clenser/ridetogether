-- =============================================================================
-- RideTogether - Supabase schema
-- =============================================================================
-- Applies to: a new Supabase project, or the existing project (safe to re-run).
--
-- Design notes
--   * Auth is owned by Supabase (`auth.users`); `public.profiles` holds the
--     app-level user record and is created automatically by a trigger.
--   * Row Level Security is enabled on every application table and only
--     `authenticated` is granted table privileges. `anon` gets nothing.
--   * No demo/fake data is inserted by this file.
--   * Every object is created with an "if not exists" / "drop if exists" guard so
--     the script can be applied repeatedly.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'ride_status' and n.nspname = 'public'
  ) then
    create type public.ride_status as enum (
      'upcoming',
      'active',
      'completed',
      'cancelled'
    );
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'booking_status' and n.nspname = 'public'
  ) then
    create type public.booking_status as enum (
      'pending',
      'confirmed',
      'rejected',
      'cancelled',
      'completed'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- App-level user record, one row per Supabase auth user.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  avatar_url text,
  bio text not null default '',
  role text not null default '',
  rating numeric(3, 2) not null default 0,
  trip_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 80),
  constraint profiles_phone_length check (char_length(phone) <= 32),
  constraint profiles_rating_range check (rating >= 0 and rating <= 5),
  constraint profiles_trip_count_non_negative check (trip_count >= 0)
);

-- Vehicles owned by a profile.
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  make text not null,
  model text not null,
  color text not null default '',
  plate text not null,
  seats integer not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_plate_key unique (owner_id, plate),
  constraint vehicles_name_not_blank check (char_length(btrim(name)) > 0),
  constraint vehicles_seats_range check (seats between 1 and 12)
);

-- Per-device Web Push endpoints (see supabase/functions/send-push).
-- `endpoint` is the browser-generated push service URL and is globally unique;
-- a user may register several (phone, laptop) and may re-register the same
-- endpoint after a browser rotation.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_keys_not_blank check (
    char_length(btrim(p256dh_key)) > 0 and char_length(btrim(auth_key)) > 0
  )
);

-- Rides offered by a driver.
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  origin_label text not null,
  origin_lat double precision not null,
  origin_lon double precision not null,
  destination_label text not null,
  destination_lat double precision not null,
  destination_lon double precision not null,
  departure_at timestamptz not null,
  total_seats integer not null,
  seats_available integer not null default 0,
  distance_km double precision not null,
  duration_minutes integer not null,
  -- ₹9/km, rounded to the nearest whole rupee. Stored (not derived at read
  -- time) so the fare a rider agreed to is auditable even if FARE_PER_KM
  -- changes later. `rides_base_fare_matches_distance` keeps it honest.
  base_fare integer not null,
  contribution integer not null,
  status public.ride_status not null default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rides_origin_label_not_blank check (char_length(btrim(origin_label)) > 0),
  constraint rides_destination_label_not_blank check (char_length(btrim(destination_label)) > 0),
  constraint rides_lat_range check (
    origin_lat between -90 and 90
    and destination_lat between -90 and 90
  ),
  constraint rides_lon_range check (
    origin_lon between -180 and 180
    and destination_lon between -180 and 180
  ),
  constraint rides_total_seats_range check (total_seats between 1 and 12),
  constraint rides_seats_available_range check (
    seats_available >= 0 and seats_available <= total_seats
  ),
  constraint rides_distance_positive check (distance_km > 0),
  constraint rides_duration_positive check (duration_minutes > 0),
  constraint rides_base_fare_positive check (base_fare >= 0),
  constraint rides_contribution_positive check (contribution >= 0),
  -- Fare rule, enforced by the database so a client cannot bypass it:
  --   base fare = round(distance_km * 9) rupees (₹9/km)
  --   contribution must fall within base - 10 .. base + 10
  -- `round(double precision)` is immutable, so this is valid in a CHECK.
  constraint rides_base_fare_matches_distance check (
    base_fare = round(distance_km * 9)
  ),
  constraint rides_contribution_fare_band check (
    contribution between
      greatest(0, round(distance_km * 9) - 10)
      and round(distance_km * 9) + 10
  )
);

-- Ordered waypoints between origin and destination.
create table if not exists public.ride_stops (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  stop_order integer not null,
  label text not null,
  lat double precision not null,
  lon double precision not null,
  created_at timestamptz not null default now(),
  constraint ride_stops_ride_order_key unique (ride_id, stop_order),
  constraint ride_stops_label_not_blank check (char_length(btrim(label)) > 0),
  constraint ride_stops_order_non_negative check (stop_order >= 0),
  constraint ride_stops_lat_range check (lat between -90 and 90),
  constraint ride_stops_lon_range check (lon between -180 and 180)
);

-- Seat requests made by riders.
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade,
  seats integer not null default 1,
  status public.booking_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_seats_positive check (seats > 0),
  constraint bookings_seats_max check (seats <= 12)
);

-- Ride chat. Read and written only by ride participants.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  constraint messages_content_not_blank check (char_length(btrim(content)) > 0),
  constraint messages_content_length check (char_length(content) <= 2000)
);

-- In-app notifications, one recipient per row.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ride_id uuid references public.rides (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_type_not_blank check (char_length(btrim(type)) > 0),
  constraint notifications_title_not_blank check (char_length(btrim(title)) > 0)
);

-- Post-trip ratings. One rating per (ride, reviewer, reviewee).
create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  stars integer not null,
  comment text not null default '',
  created_at timestamptz not null default now(),
  constraint ratings_stars_range check (stars between 1 and 5),
  constraint ratings_not_self check (reviewer_id <> reviewee_id),
  constraint ratings_ride_reviewer_reviewee_key unique (ride_id, reviewer_id, reviewee_id)
);

-- Emergency contacts, private to their owner.
create table if not exists public.safety_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  phone text not null,
  relationship text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_contacts_name_not_blank check (char_length(btrim(name)) > 0),
  constraint safety_contacts_phone_not_blank check (char_length(btrim(phone)) > 0)
);

-- -----------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------

create index if not exists rides_driver_departure_idx
  on public.rides (driver_id, departure_at desc);
create index if not exists rides_departure_idx
  on public.rides (departure_at);
create index if not exists rides_status_idx
  on public.rides (status);
create index if not exists ride_stops_ride_idx
  on public.ride_stops (ride_id, stop_order);
create index if not exists bookings_ride_idx
  on public.bookings (ride_id);
create index if not exists bookings_rider_created_idx
  on public.bookings (rider_id, created_at desc);
create index if not exists messages_ride_created_idx
  on public.messages (ride_id, created_at);
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists ratings_ride_idx
  on public.ratings (ride_id);
create index if not exists ratings_reviewee_idx
  on public.ratings (reviewee_id);
create index if not exists vehicles_owner_idx
  on public.vehicles (owner_id);
create index if not exists safety_contacts_user_idx
  on public.safety_contacts (user_id);

-- Push subscriptions are always looked up by owner and by endpoint.
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- Supports the Find Ride query, which filters on status + departure window and
-- requires at least N free seats.
create index if not exists rides_status_departure_seats_idx
  on public.rides (status, departure_at, seats_available);

-- -----------------------------------------------------------------------------
-- 3b. Constraint upgrades
--     `create table if not exists` is a no-op on an existing table, so any
--     constraint added after a project's first run is applied here instead.
-- -----------------------------------------------------------------------------

-- `base_fare` is a stored column, so an existing table needs it added and
-- backfilled before any fare CHECK can be enforced.
alter table public.rides add column if not exists base_fare integer;

update public.rides
   set base_fare = round(distance_km * 9)::integer
 where base_fare is null;

alter table public.rides alter column base_fare set not null;

-- A project created before the fare band existed can hold contributions
-- outside it, which would make the ADD CONSTRAINT below fail. Clamp those rows
-- to the base fare first so this script stays re-runnable. Rows created after
-- the band was introduced are already inside it and are not touched.
update public.rides
   set contribution = round(distance_km * 9)::integer
 where contribution < greatest(0, round(distance_km * 9) - 10)
    or contribution > round(distance_km * 9) + 10;

alter table public.rides drop constraint if exists rides_base_fare_matches_distance;
alter table public.rides add constraint rides_base_fare_matches_distance check (
  base_fare = round(distance_km * 9)
);

alter table public.rides drop constraint if exists rides_base_fare_positive;
alter table public.rides add constraint rides_base_fare_positive check (base_fare >= 0);

alter table public.rides drop constraint if exists rides_contribution_fare_band;
alter table public.rides add constraint rides_contribution_fare_band check (
  contribution between
    greatest(0, round(distance_km * 9) - 10)
    and round(distance_km * 9) + 10
);

-- A rider may hold at most one active booking per ride.
create unique index if not exists bookings_one_active_per_rider
  on public.bookings (ride_id, rider_id)
  where status in ('pending', 'confirmed', 'completed');

-- A profile may have at most one default vehicle.
create unique index if not exists vehicles_one_default_per_owner
  on public.vehicles (owner_id)
  where is_default;

-- The plate rule is per owner, not global: two members of the community may
-- legitimately share or replace the same car, and a global unique plate made
-- "Add vehicle" fail for reasons the user cannot act on.
alter table public.vehicles drop constraint if exists vehicles_plate_key;
alter table public.vehicles add constraint vehicles_plate_key unique (owner_id, plate);

-- -----------------------------------------------------------------------------
-- 4. Trigger functions
-- -----------------------------------------------------------------------------

-- Keeps `updated_at` honest on every table that carries one.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Creates `public.profiles` automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- A brand new ride always starts with every seat free.
create or replace function public.init_ride_seats()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.seats_available := new.total_seats;
  return new;
end;
$$;

-- Recomputes free seats whenever the driver changes the seat capacity.
create or replace function public.sync_ride_total_seats()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  booked integer;
begin
  select coalesce(sum(b.seats), 0)
    into booked
    from public.bookings b
   where b.ride_id = new.id
     and b.status in ('confirmed', 'completed');

  if new.total_seats < booked then
    raise exception
      'Cannot reduce total seats to % because % seat(s) are already booked',
      new.total_seats, booked
      using errcode = 'check_violation';
  end if;

  new.seats_available := new.total_seats - booked;
  return new;
end;
$$;

-- Drivers may not book a seat on their own ride.
create or replace function public.prevent_self_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.rides r
     where r.id = new.ride_id
       and r.driver_id = new.rider_id
  ) then
    raise exception 'Drivers cannot book a seat on their own ride'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Seat accounting. Runs `security definer` so that confirming a booking can
-- update `public.rides` even though riders have no UPDATE policy on rides.
-- The ride row is locked with `FOR UPDATE`, so two concurrent confirmations
-- cannot both pass the availability check.
create or replace function public.apply_booking_seat_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ride_id uuid;
  previously_taken integer := 0;
  newly_taken integer := 0;
  ride_total integer;
  ride_available integer;
begin
  target_ride_id := case
    when tg_op = 'DELETE' then old.ride_id
    else new.ride_id
  end;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.status in ('confirmed', 'completed') then
      previously_taken := old.seats;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.status in ('confirmed', 'completed') then
      newly_taken := new.seats;
    end if;
  end if;

  if newly_taken <> previously_taken then
    select r.total_seats, r.seats_available
      into ride_total, ride_available
      from public.rides r
     where r.id = target_ride_id
       for update;

    if found then
      if newly_taken > previously_taken then
        if ride_available < (newly_taken - previously_taken) then
          raise exception
            'Not enough seats left on this ride to confirm % seat(s)',
            newly_taken - previously_taken
            using errcode = 'check_violation';
        end if;

        update public.rides
           set seats_available = seats_available - (newly_taken - previously_taken)
         where id = target_ride_id;
      else
        update public.rides
           set seats_available = least(
             ride_total,
             ride_available + (previously_taken - newly_taken)
           )
         where id = target_ride_id;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4b. Notification + rating fan-out
--     Notifications are produced in the database rather than by the browser
--     that performed the action, so a rider who requested a seat from their
--     phone still notifies the driver who is signed in on a laptop. Every
--     insert bypasses RLS via `security definer`, and only ever names a
--     recipient resolved from the ride itself - never from client input.
-- -----------------------------------------------------------------------------

-- Shorthand for a notification row.
create or replace function public.push_notification(
  target_user_id uuid,
  notification_type text,
  notification_title text,
  notification_body text,
  target_ride_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, ride_id, type, title, body)
  values (target_user_id, target_ride_id, notification_type, notification_title, notification_body);
$$;

-- Booking lifecycle: request -> confirmation / rejection / cancellation,
-- plus a rating prompt once the ride is completed.
create or replace function public.notify_booking_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ride_id uuid;
  driver uuid;
  rider uuid;
  seats integer;
  previous_status text;
  next_status text;
  origin_label text;
  destination_label text;
begin
  target_ride_id := case when tg_op = 'DELETE' then old.ride_id else new.ride_id end;
  seats := case when tg_op = 'DELETE' then old.seats else new.seats end;
  previous_status := case when tg_op = 'INSERT' then null else old.status end;
  next_status := case when tg_op = 'DELETE' then 'cancelled' else new.status end;

  select r.driver_id, r.origin_label, r.destination_label
    into driver, origin_label, destination_label
    from public.rides r
   where r.id = target_ride_id;

  if driver is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    rider := old.rider_id;
  else
    rider := new.rider_id;
  end if;

  -- A new request tells the driver.
  if previous_status is null and next_status = 'pending' then
    perform public.push_notification(
      driver, 'booking-request',
      'New seat request',
      format('%s requested %s seat(s) on %s to %s.',
        (select coalesce(full_name, 'A rider') from public.profiles where id = rider),
        seats, origin_label, destination_label),
      target_ride_id
    );
  -- Confirmations, rejections and cancellations go back to the rider.
  elsif next_status = 'confirmed' and previous_status is distinct from 'confirmed' then
    perform public.push_notification(
      rider, 'booking-confirmed',
      'Your seat is confirmed',
      format('Your seat on %s to %s is confirmed.', origin_label, destination_label),
      target_ride_id
    );
  elsif next_status = 'rejected' and previous_status is distinct from 'rejected' then
    perform public.push_notification(
      rider, 'booking-rejected',
      'Seat request declined',
      format('Your request for %s to %s was declined. Try another ride.',
        origin_label, destination_label),
      target_ride_id
    );
  elsif next_status = 'cancelled' and previous_status is distinct from 'cancelled' then
    perform public.push_notification(
      rider, 'booking-cancelled',
      'Booking cancelled',
      format('Your booking on %s to %s was cancelled.', origin_label, destination_label),
      target_ride_id
    );
  end if;

  -- `OLD` is unassigned during INSERT and `NEW` is unassigned during DELETE.
  -- Referencing either raises `record "old" is not assigned yet`, which would
  -- abort the caller's INSERT/UPDATE/DELETE and make every seat request fail
  -- with a misleading "not found". Pick the row by operation instead of
  -- coalescing the two records together.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
-- A completed ride asks both sides to rate each other.
--
-- Only people who were actually in the car are asked. `finalize_ride_completion`
-- runs before this trigger (Postgres fires same-timing triggers in name order,
-- and `rides_finalize_completion` sorts first), so anyone who was picked up has
-- already become `completed` and anyone who never got in is a `no_show` by now.
create or replace function public.notify_ride_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  partner record;
begin
  if tg_op = 'UPDATE' and (new.status::text <> 'completed' or old.status::text = 'completed') then
    return new;
  end if;

  for partner in
    select b.rider_id as participant
      from public.bookings b
     where b.ride_id = new.id
       and b.status::text in ('picked_up', 'completed')
  union
    select new.driver_id as participant
  loop
    if partner.participant <> new.driver_id then
      perform public.push_notification(
        partner.participant, 'rating-request',
        'Rate your trip',
        format('How was your ride on %s to %s?',
          new.origin_label, new.destination_label),
        new.id
      );
    end if;
  end loop;

  -- Everyone with a confirmed seat also hears that the ride finished.
  perform public.push_notification(
    new.driver_id, 'ride-completed',
    'Ride completed',
    format('%s to %s is now marked completed.', new.origin_label, new.destination_label),
    new.id
  );

  return new;
end;
$$;

-- A new chat message notifies the other participants.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  for recipient in
    select r.driver_id as participant
      from public.rides r
     where r.id = new.ride_id
    union
    select b.rider_id
      from public.bookings b
     where b.ride_id = new.ride_id
       and b.status in ('pending', 'confirmed', 'completed')
  loop
    if recipient.participant <> new.sender_id then
      perform public.push_notification(
        recipient.participant, 'message',
        format('New message from %s',
          coalesce((select full_name from public.profiles where id = new.sender_id), 'A participant')),
        left(new.content, 160),
        new.ride_id
      );
    end if;
  end loop;

  return new;
end;
$$;

-- Keeps `profiles.rating` and `profiles.trip_count` honest from cloud data.
create or replace function public.sync_profile_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
begin
  -- Guarded by `tg_op`: `OLD` is unassigned on INSERT and `NEW` is unassigned on
  -- DELETE, and touching an unassigned record raises an error that would abort
  -- the rating write instead of updating the profile average.
  if tg_op = 'DELETE' then
    target_user := old.reviewee_id;
  else
    target_user := new.reviewee_id;
  end if;

  update public.profiles p
     set rating = coalesce((
           select round(avg(r.stars)::numeric, 2)
             from public.ratings r
            where r.reviewee_id = target_user
         ), 0),
         trip_count = (
           select count(*)
             from public.bookings b
             join public.rides r on r.id = b.ride_id
            where b.rider_id = target_user
              and b.status in ('confirmed', 'completed')
              and r.status = 'completed'
         )
   where p.id = target_user;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4b. RPC functions (called by the app, not fired by a trigger)
-- -----------------------------------------------------------------------------

-- Promotes one vehicle to be the owner's default.
--
-- `vehicles_one_default_per_owner` is a partial unique index on (owner_id)
-- where is_default, so a client cannot demote-then-promote in two statements:
-- the promote would collide with the still-set old default. Doing both writes
-- in one function makes the swap atomic and safe under concurrent taps.
--
-- Deliberately NOT `security definer`: it runs as the caller, so the ordinary
-- `vehicles_update_own` RLS policy still applies and the function cannot be
-- used to reach another user's rows.
create or replace function public.set_default_vehicle(target_vehicle_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.vehicles
     where id = target_vehicle_id
       and owner_id = auth.uid()
  ) then
    raise exception 'You can only set one of your own vehicles as the default'
      using errcode = 'insufficient_privilege';
  end if;

  update public.vehicles
     set is_default = false
   where owner_id = auth.uid()
     and is_default
     and id <> target_vehicle_id;

  update public.vehicles
     set is_default = true
   where id = target_vehicle_id
     and owner_id = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS helper functions
--    SECURITY DEFINER so policies can evaluate participation without exposing
--    raw rows. They return booleans only and set an empty search_path.
-- -----------------------------------------------------------------------------

create or replace function public.is_ride_driver(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride_id
       and r.driver_id = auth.uid()
  );
$$;

create or replace function public.has_ride_booking(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.bookings b
     where b.ride_id = target_ride_id
       and b.rider_id = auth.uid()
       and b.status in ('pending', 'confirmed', 'completed')
  );
$$;

create or replace function public.is_ride_participant(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_ride_driver(target_ride_id)
      or public.has_ride_booking(target_ride_id);
$$;

create or replace function public.is_completed_ride_participant(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride_id
       and r.status = 'completed'
       and (
         r.driver_id = auth.uid()
         or exists (
           select 1
             from public.bookings b
            where b.ride_id = r.id
              and b.rider_id = auth.uid()
              and b.status in ('confirmed', 'completed')
         )
       )
  );
$$;

create or replace function public.ride_has_participant(
  target_ride_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride_id
       and (
         r.driver_id = target_user_id
         or exists (
           select 1
             from public.bookings b
            where b.ride_id = r.id
              and b.rider_id = target_user_id
              and b.status in ('confirmed', 'completed')
         )
       )
  );
$$;

-- -----------------------------------------------------------------------------
-- 6. Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

drop trigger if exists rides_set_updated_at on public.rides;
create trigger rides_set_updated_at
  before update on public.rides
  for each row execute function public.set_updated_at();

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

drop trigger if exists safety_contacts_set_updated_at on public.safety_contacts;
create trigger safety_contacts_set_updated_at
  before update on public.safety_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists rides_init_seats on public.rides;
create trigger rides_init_seats
  before insert on public.rides
  for each row execute function public.init_ride_seats();

-- `seats_available` is derived, so it is recomputed on *every* write, not only
-- when `total_seats` happens to be in the SET list.
--
-- The trigger used to be `before update of total_seats`, which left a hole: a
-- driver could issue `update rides set seats_available = total_seats` on its own
-- ride, the trigger would not fire, and the `rides_seats_available_range` check
-- would accept it because the value is still within bounds. That inflated the
-- advertised seat count with no booking behind it, and the next real booking
-- then either drove the column negative or let a host confirm a seat that was
-- never there.
--
-- Firing on every update makes the column database-owned by construction, which
-- is what the booking rules require: `total_seats` is what a host may change,
-- `seats_available` is always the result. Re-running the booked-seat sum on
-- unrelated updates (`setRideStatus`, the internal decrement in
-- `apply_booking_seat_change`) is harmless - the booking rows are already
-- committed by then, so the recomputed value is the same one the incremental
-- arithmetic arrived at - and the "cannot reduce total seats" guard can only
-- fire in a state that is already forbidden.
drop trigger if exists rides_sync_total_seats on public.rides;
create trigger rides_sync_total_seats
  before update on public.rides
  for each row execute function public.sync_ride_total_seats();

drop trigger if exists bookings_prevent_self_booking on public.bookings;
create trigger bookings_prevent_self_booking
  before insert or update of ride_id, rider_id on public.bookings
  for each row execute function public.prevent_self_booking();

drop trigger if exists bookings_apply_seat_change on public.bookings;
create trigger bookings_apply_seat_change
  after insert or update of status, seats, ride_id or delete on public.bookings
  for each row execute function public.apply_booking_seat_change();

drop trigger if exists bookings_notify_participants on public.bookings;
create trigger bookings_notify_participants
  after insert or update of status or delete on public.bookings
  for each row execute function public.notify_booking_change();

drop trigger if exists rides_notify_completion on public.rides;
create trigger rides_notify_completion
  after update of status on public.rides
  for each row execute function public.notify_ride_completion();

drop trigger if exists messages_notify_recipients on public.messages;
create trigger messages_notify_recipients
  after insert on public.messages
  for each row execute function public.notify_new_message();

drop trigger if exists ratings_sync_profile on public.ratings;
create trigger ratings_sync_profile
  after insert or update of stars or delete on public.ratings
  for each row execute function public.sync_profile_rating();

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6b. Web Push dispatch
-- -----------------------------------------------------------------------------
-- The triggers above write `public.notifications` rows. Writing the row is what
-- the app reads, but a member with the app closed only finds out if the push
-- actually leaves the database, so new rows are forwarded to the `send-push`
-- Edge Function over pg_net.
--
-- This is a statement-level trigger with a transition table on purpose: the
-- fan-out triggers can insert several notifications for one event, and grouping
-- by recipient here sends one HTTP request per member instead of one per row.
--
-- Setup, all of which is deployment-specific and so not part of the schema:
--   create extension pg_net;                       -- net.http_post sender
--   select vault.create_secret('<shared>', 'push_dispatch_secret');
--   select vault.create_secret('<edge-fn-url>', 'push_function_url');
-- Both secrets are read from Vault rather than stored in this file, and the
-- dispatch secret is the same value the Edge Function requires in its
-- Authorization header, so a leaked database URL alone cannot be used to send
-- arbitrary notifications.

create extension if not exists pg_net;

-- Every dispatch that could not be handed to pg_net, so a broken configuration
-- is visible without tailing server logs. Kept deliberately small and pruned by
-- the same statement that inserts into it.
create table if not exists public.push_dispatch_failures (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  reason text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists push_dispatch_failures_recent_idx
on public.push_dispatch_failures (created_at desc);

-- What the Edge Function has already sent, so a replayed trigger or a retried
-- HTTP request cannot notify a member twice. The primary key on notification_id
-- is the guarantee: the second insert raises, the function skips, and the member
-- sees one notification per event however many times the database replays it.
create table if not exists public.push_deliveries (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delivered integer not null default 0,
  attempted integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists push_deliveries_created_idx
on public.push_deliveries (created_at desc);

alter table public.push_deliveries enable row level security;

drop policy if exists push_deliveries_read_own on public.push_deliveries;
create policy push_deliveries_read_own
on public.push_deliveries for select to authenticated
using (user_id = auth.uid());

alter table public.push_dispatch_failures enable row level security;

drop policy if exists push_dispatch_failures_read_own on public.push_dispatch_failures;
create policy push_dispatch_failures_read_own
on public.push_dispatch_failures for select to authenticated
using (user_id is null or user_id = auth.uid());

/**
 * Records one dispatch failure, and can never itself fail.
 *
 * This runs inside the transaction that created the notification, so an error
 * here would abort a seat request or a chat message to report a *push* problem.
 * Every statement is therefore guarded, and a nested exception block is used
 * rather than an outer one because an exception raised inside a block already
 * being run for an exception rolls back to the implicit savepoint at the start of
 * that block - which would discard the failure row along with the error.
 */
create or replace function public.record_push_dispatch_failure(
  target_user_id uuid,
  failure_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.push_dispatch_failures (user_id, reason, detail)
    values (target_user_id, left(coalesce(failure_reason, 'unknown'), 200), '')
    on conflict do nothing;
  exception when others then
    null;
  end;
end;
$$;

comment on function public.record_push_dispatch_failure(uuid, text) is
  'Appends a Web Push dispatch failure. Never raises, so it cannot fail the write that triggered it.';

/**
 * Whether the database side of Web Push is wired up, as plain booleans.
 *
 * The Settings screen has to tell three states apart: the browser has a
 * subscription, the server can actually deliver, and delivery is broken. Without
 * this it can only see its own half and would have to claim push works the moment
 * a subscription row exists, which is precisely the false confirmation this
 * function exists to prevent.
 *
 * It reports *presence only*. The values themselves stay in Vault, readable
 * solely by `security definer` code, and the function is granted to `authenticated`
 * so no client role can read `vault.decrypted_secrets` directly.
 *
 * It cannot report the Edge Function's own VAPID secrets, which live in Supabase
 * Edge secrets rather than Vault and are invisible from SQL. A member whose
 * subscription is stored and whose Vault wiring is present can therefore still
 * be waiting on an unconfigured function; that gap is closed by the deployment
 * check in supabase/README.md, not by guessing here.
 */
create or replace function public.push_service_status()
returns table (
  dispatch_secret_set boolean,
  function_url_set boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from vault.decrypted_secrets where name = 'push_dispatch_secret'),
    exists (select 1 from vault.decrypted_secrets where name = 'push_function_url')
    and exists (
      select 1 from vault.decrypted_secrets
      where name = 'push_function_url' and btrim(decrypted_secret) <> ''
    );
$$;

comment on function public.push_service_status() is
  'Presence-only booleans for the Vault half of Web Push, so the UI never claims delivery works when the server is unwired.';

create or replace function public.dispatch_push_for_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_target record;
begin
  -- The whole body is guarded, and that is the point of the function.
  --
  -- This trigger runs INSIDE the transaction that wrote the notification, which
  -- for a seat request is the rider's own INSERT into public.bookings. A push
  -- integration is not allowed to be able to fail that write, and the previous
  -- version read `vault.decrypted_secrets` before the only exception handler, so
  -- on any project where the vault schema was not resolvable the read raised
  -- `42P01 relation "vault.decrypted_secrets" does not exist`, the booking
  -- transaction rolled back, and the rider was told "The app is not in sync with
  -- the database" - a message that points at the app rather than at the push
  -- feature that actually broke.
  --
  -- `3F000` is the same class of failure (a missing `vault` schema) and is called
  -- out separately so the recorded reason says which one it was.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;

    if v_secret is null then
      -- Fail quietly: the notification row is already stored and still shows up
      -- in the app, so a missing secret must not break the write that created it.
      -- Recorded rather than merely warned, because a deployment that is missing
      -- this secret looks healthy from the app's point of view forever otherwise.
      perform public.record_push_dispatch_failure(
        null, 'push_dispatch_secret is not set in Vault; Web Push delivery skipped');
      return null;
    end if;

    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'push_function_url' limit 1;

    if v_url is null or btrim(v_url) = '' then
      perform public.record_push_dispatch_failure(
        null, 'push_function_url is not set in Vault; Web Push delivery skipped');
      return null;
    end if;

    -- Grouped by the notification id, which is exact: one dispatch per row the
    -- triggers actually created. The Edge Function records what it has delivered
    -- and refuses to send the same id twice, so a replayed trigger statement or a
    -- retried HTTP request cannot produce a second notification on a member's
    -- phone. Grouping by recipient instead - as an earlier version did - also
    -- collapsed genuinely different notifications addressed to the same member
    -- inside one statement, so a member could be sent a booking request and
    -- silently never hear about the cancellation that followed it in the same
    -- transaction.
    --
    -- The target path is built from the row rather than read from a column. The
    -- previous version selected `url` from `inserted`, and public.notifications has
    -- no `url` column: the query raised `42703 column "url" does not exist`, which
    -- is not one of the missing-feature conditions handled below, so the error left
    -- the function and aborted the trigger. That rolled back the notification
    -- insert - and with it the booking or chat message that produced it - so push
    -- delivered nothing at all while the write that should have carried it failed.
    -- Only the notification's own columns can be used here, so the in-app route is
    -- derived from them: a chat alert opens its conversation, anything else opens
    -- the notification list.
    for v_target in
      select id,
             user_id::text,
             title,
             body,
             case
               when type = 'message' and ride_id is not null
                 then '/chat/' || ride_id::text
               else '/notifications'
             end as path
        from inserted
       order by user_id, created_at
    loop
      -- net.http_post queues the request and returns immediately, after the
      -- surrounding transaction commits, so a rolled-back notification is never
      -- delivered. Guarded per target as well as by the outer block, so one bad
      -- endpoint cannot cost the member their notification to the other devices.
      begin
        perform net.http_post(
          url := v_url,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
          ),
          body := jsonb_build_object(
            'notification_id', v_target.id,
            'user_id', v_target.user_id,
            'title', coalesce(v_target.title, 'RideTogether'),
            'body', coalesce(v_target.body, ''),
            'url', v_target.path
          ),
          timeout_milliseconds := 5000
        );
      exception when others then
        raise warning 'Web Push dispatch failed for notification to %: %',
          v_target.user_id, sqlerrm;
        perform public.record_push_dispatch_failure(
          v_target.user_id::uuid, sqlerrm);
      end;
    end loop;

    -- One row per dispatch statement is enough for a support question; the history
    -- of a busy deployment is not interesting and an unbounded table in the same
    -- transaction path is a liability.
    delete from public.push_dispatch_failures
     where created_at < now() - interval '7 days';

    -- The delivery log only exists to be de-duplicated against, so it is trimmed
    -- on the same path. Long enough that a replayed trigger - which happens within
    -- a transaction retry, not days later - still finds its row.
    delete from public.push_deliveries
     where created_at < now() - interval '30 days';

    return null;
  exception
    when undefined_function or undefined_table or invalid_schema_name or undefined_column then
      -- The push feature is not installed on this project: no vault schema, no
      -- pg_net, no matching column, or a mix of those. That is a deployment gap,
      -- and it must not take the rider's seat request down with it. The
      -- notification row is already written by the time we get here, and the
      -- warning names the actual cause instead of letting a raw 42P01/42703 reach
      -- a member.
      --
      -- `undefined_column` is here for the same reason as the other three: the
      -- dispatch query reads the `inserted` transition table, so any column it
      -- names that the table does not have raised out of the trigger and rolled
      -- back the notification with the write behind it. A push feature that cannot
      -- find its own data is still only a push feature.
      raise warning 'Web Push is not configured on this database (%); delivery skipped', sqlerrm;
      perform public.record_push_dispatch_failure(
        null, 'push integration unavailable: ' || left(sqlerrm, 180));
  end;
end;
$$;

comment on function public.dispatch_push_for_notifications() is
  'Forwards new notifications to the send-push Edge Function via pg_net.';

drop trigger if exists notifications_dispatch_push on public.notifications;
create trigger notifications_dispatch_push
  after insert on public.notifications
  referencing new table as inserted
  for each statement execute function public.dispatch_push_for_notifications();

-- -----------------------------------------------------------------------------
-- 7. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.rides enable row level security;
alter table public.ride_stops enable row level security;
alter table public.bookings enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.ratings enable row level security;
alter table public.safety_contacts enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles -------------------------------------------------------------------

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles for select to authenticated using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
  on public.profiles for delete to authenticated using (id = auth.uid());

-- vehicles -------------------------------------------------------------------

drop policy if exists vehicles_select_authenticated on public.vehicles;
create policy vehicles_select_authenticated
  on public.vehicles for select to authenticated using (true);

drop policy if exists vehicles_insert_own on public.vehicles;
create policy vehicles_insert_own
  on public.vehicles for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists vehicles_update_own on public.vehicles;
create policy vehicles_update_own
  on public.vehicles for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists vehicles_delete_own on public.vehicles;
create policy vehicles_delete_own
  on public.vehicles for delete to authenticated using (owner_id = auth.uid());

-- rides ----------------------------------------------------------------------

drop policy if exists rides_select_authenticated on public.rides;
create policy rides_select_authenticated
  on public.rides for select to authenticated using (true);

drop policy if exists rides_insert_own on public.rides;
create policy rides_insert_own
  on public.rides for insert to authenticated with check (driver_id = auth.uid());

-- Ownership cannot be transferred or orphaned by this policy even though it
-- grants a blanket UPDATE: `with check` is evaluated on the row *after* the
-- write, so a driver who sends a different (or null) `driver_id` fails the
-- check. The derived `seats_available` column is writable in the payload but
-- `rides_sync_total_seats` overwrites it on every update, so it is not a hole -
-- see that trigger. What remains writable is the host's own itinerary, pricing
-- and lifecycle state, and lifecycle order is still `enforce_ride_status_transition`.
drop policy if exists rides_update_own on public.rides;
create policy rides_update_own
  on public.rides for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists rides_delete_own on public.rides;
create policy rides_delete_own
  on public.rides for delete to authenticated using (driver_id = auth.uid());

-- ride_stops -----------------------------------------------------------------

drop policy if exists ride_stops_select_authenticated on public.ride_stops;
create policy ride_stops_select_authenticated
  on public.ride_stops for select to authenticated using (true);

drop policy if exists ride_stops_insert_driver on public.ride_stops;
create policy ride_stops_insert_driver
  on public.ride_stops for insert to authenticated
  with check (public.is_ride_driver(ride_id));

drop policy if exists ride_stops_update_driver on public.ride_stops;
create policy ride_stops_update_driver
  on public.ride_stops for update to authenticated
  using (public.is_ride_driver(ride_id))
  with check (public.is_ride_driver(ride_id));

drop policy if exists ride_stops_delete_driver on public.ride_stops;
create policy ride_stops_delete_driver
  on public.ride_stops for delete to authenticated
  using (public.is_ride_driver(ride_id));

-- bookings -------------------------------------------------------------------

drop policy if exists bookings_select_involved on public.bookings;
create policy bookings_select_involved
  on public.bookings for select to authenticated
  using (rider_id = auth.uid() or public.is_ride_driver(ride_id));

-- A booking can only ever be *created* as `pending`.
--
-- `bookings_enforce_status` is a `before update of status` trigger, so it never
-- sees an INSERT. Without the status predicate below, a rider could skip the
-- entire accept -> payment_pending -> confirmed sequence by inserting a booking
-- that is already `confirmed`, which would also hand them the seat via
-- `bookings_apply_seat_change` and let them reach a driver's chat and live map
-- through `is_ride_passenger`. The database has to own that sequence, so the
-- insert is pinned to the one state a rider is allowed to originate.
drop policy if exists bookings_insert_own on public.bookings;
create policy bookings_insert_own
  on public.bookings for insert to authenticated
  with check (rider_id = auth.uid() and status = 'pending');

drop policy if exists bookings_update_involved on public.bookings;
create policy bookings_update_involved
  on public.bookings for update to authenticated
  using (rider_id = auth.uid() or public.is_ride_driver(ride_id))
  with check (rider_id = auth.uid() or public.is_ride_driver(ride_id));

drop policy if exists bookings_delete_involved on public.bookings;
create policy bookings_delete_involved
  on public.bookings for delete to authenticated
  using (rider_id = auth.uid() or public.is_ride_driver(ride_id));

-- messages -------------------------------------------------------------------

drop policy if exists messages_select_participants on public.messages;
create policy messages_select_participants
  on public.messages for select to authenticated
  using (public.is_ride_participant(ride_id));

drop policy if exists messages_insert_participants on public.messages;
create policy messages_insert_participants
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_ride_participant(ride_id));

-- notifications --------------------------------------------------------------

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own
  on public.notifications for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own
  on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ratings --------------------------------------------------------------------

drop policy if exists ratings_select_authenticated on public.ratings;
create policy ratings_select_authenticated
  on public.ratings for select to authenticated using (true);

drop policy if exists ratings_insert_participants on public.ratings;
create policy ratings_insert_participants
  on public.ratings for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and public.is_completed_ride_participant(ride_id)
    and public.ride_has_participant(ride_id, reviewee_id)
  );

-- safety_contacts ------------------------------------------------------------

drop policy if exists safety_contacts_select_own on public.safety_contacts;
create policy safety_contacts_select_own
  on public.safety_contacts for select to authenticated using (user_id = auth.uid());

drop policy if exists safety_contacts_insert_own on public.safety_contacts;
create policy safety_contacts_insert_own
  on public.safety_contacts for insert to authenticated with check (user_id = auth.uid());

drop policy if exists safety_contacts_update_own on public.safety_contacts;
create policy safety_contacts_update_own
  on public.safety_contacts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists safety_contacts_delete_own on public.safety_contacts;
create policy safety_contacts_delete_own
  on public.safety_contacts for delete to authenticated using (user_id = auth.uid());

-- push_subscriptions ---------------------------------------------------------
--     A device endpoint is as sensitive as a password: anyone holding it can
--     push to that browser. Rows are therefore private to their owner, and the
--     WITH CHECK stops a client from registering an endpoint under someone
--     else's id. Delivery is done by the `send-push` Edge Function, which uses
--     the service role and never runs from the browser.

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 8. Grants
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

revoke all on all tables in schema public from anon;

-- Helper functions clients may call. Note that the trigger functions below are
-- deliberately *not* granted: `security definer` functions that the browser can
-- invoke directly are an escalation path, and these are only ever fired by the
-- database. `push_notification()` is in the same category and is revoked below.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_ride_driver(uuid)',
    'public.has_ride_booking(uuid)',
    'public.is_ride_participant(uuid)',
    'public.is_completed_ride_participant(uuid)',
    'public.ride_has_participant(uuid,uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;

-- Trigger-only functions: never executable by a client role.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.set_updated_at()',
    'public.handle_new_user()',
    'public.init_ride_seats()',
    'public.sync_ride_total_seats()',
    'public.prevent_self_booking()',
    'public.apply_booking_seat_change()',
    'public.notify_booking_change()',
    'public.notify_ride_completion()',
    'public.notify_new_message()',
    'public.sync_profile_rating()',
    'public.push_notification(uuid,text,text,text,uuid)',
    'public.dispatch_push_for_notifications()',
    'public.record_push_dispatch_failure(uuid,text)'
  ]
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
  end loop;
end
$$;

-- Read-only, presence-only status for the signed-in Settings screen. The values
-- stay in Vault; this exposes booleans, and only to a member who is signed in.
do $$
begin
  execute 'revoke execute on function public.push_service_status() from public';
  execute 'revoke execute on function public.push_service_status() from anon';
  execute 'grant execute on function public.push_service_status() to authenticated';
end
$$;

-- The auth.users trigger is fired by Supabase's auth role, not by an
-- end-user role, so it needs its own grant. Skipped outside Supabase.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end
$$;

-- Client-callable RPCs. `set_default_vehicle` must stay invokable from the
-- browser; every other SECURITY DEFINER function is revoked above.
revoke execute on function public.set_default_vehicle(uuid) from public;
revoke execute on function public.set_default_vehicle(uuid) from anon;
grant execute on function public.set_default_vehicle(uuid) to authenticated;

-- =============================================================================
-- 9. Storage: profile photos
-- =============================================================================

-- Public bucket: avatar images are shown on ride cards and driver profiles to
-- other signed-in members, so the objects must be readable by URL. Writes are
-- still locked down by the policies below - the first path segment must be the
-- authenticated user's own id.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- `<auth.uid()>/...` only. The `(storage.foldername(name))[1] = auth.uid()::text`
-- check is what stops a user writing into someone else's folder.
drop policy if exists "users manage their own avatar" on storage.objects;
create policy "users manage their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update their own avatar" on storage.objects;
create policy "users update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- 10. Realtime
--     Only the tables the app actually subscribes to. Realtime honours RLS, so
--     a client only receives rows it is allowed to SELECT - a rider is not
--     pushed someone else's notifications, and non-participants are not pushed
--     ride chat.
--
--     `alter publication ... add table` errors if the table is already a
--     member, so each is guarded.
-- =============================================================================

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'messages',
    'notifications',
    'bookings',
    'rides',
    'vehicles',
    'profiles',
    'ratings',
    'safety_contacts'
  ]
  loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      continue;
    end if;
    execute format('alter publication supabase_realtime add table public.%I', tbl);
  end loop;
exception
  when undefined_object then
    -- The publication does not exist on this project (not a Supabase host).
    -- Realtime must then be enabled per table in the dashboard.
    raise notice 'supabase_realtime publication not found; enable Realtime manually for messages, notifications, bookings, rides, vehicles, profiles, ratings, safety_contacts';
end
$$;

-- =============================================================================
-- 9. Carpool workflow lifecycle
--
-- Everything in this section is additive and re-runnable. It extends the state
-- machines that already exist in section 1 rather than replacing them:
--
--   ride_status      upcoming -> in_progress -> completed   (+ cancelled)
--                    `upcoming` is what the database already defaulted to and
--                    what section 4 already treats as "open to booking". The
--                    legacy `active` label is kept so pre-existing rows keep
--                    loading; the app writes `upcoming` from now on.
--
--   booking_status   pending -> payment_pending -> confirmed -> picked_up
--                                                          -> completed
--                    (+ rejected, cancelled, no_show)
--
-- Seats are HELD from `payment_pending` onwards, not from `confirmed`. Once a
-- host has accepted a request the seat is gone: leaving it free until payment
-- would let a second rider take it and strand the first. That is what makes
-- "host accepts a request after another request consumed the last seat" a
-- database-level refusal rather than a UI race.
--
-- A note on `::text`: PostgreSQL refuses to use a value added by
-- `ALTER TYPE ... ADD VALUE` until the surrounding transaction commits, so an
-- index predicate or trigger body that names a brand new enum label fails with
-- "unsafe use of new value" when this file is applied in one transaction.
-- Casting the enum to text is immutable and compares against plain literals,
-- which keeps this script applicable in a single pass.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 9a. Enum values
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'ride_status'
       and n.nspname = 'public'
       and e.enumlabel = 'in_progress'
  ) then
    alter type public.ride_status add value 'in_progress';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'booking_status'
       and n.nspname = 'public'
       and e.enumlabel = 'payment_pending'
  ) then
    alter type public.booking_status add value 'payment_pending';
  end if;

  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'booking_status'
       and n.nspname = 'public'
       and e.enumlabel = 'picked_up'
  ) then
    alter type public.booking_status add value 'picked_up';
  end if;

  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'booking_status'
       and n.nspname = 'public'
       and e.enumlabel = 'no_show'
  ) then
    alter type public.booking_status add value 'no_show';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'payment_status'
       and n.nspname = 'public'
  ) then
    create type public.payment_status as enum (
      'pending',
      'success',
      'failed',
      'refunded'
    );
  end if;

  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'settlement_status'
       and n.nspname = 'public'
  ) then
    create type public.settlement_status as enum (
      'not_due',
      'pending',
      'complete'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 9b. New columns
-- -----------------------------------------------------------------------------

-- The host's calculated road route. Find Ride treats this polyline - not the
-- straight line between origin and destination - as the corridor a passenger's
-- journey has to join, so it has to survive the browser that calculated it.
alter table public.rides add column if not exists route_geometry jsonb;
alter table public.rides add column if not exists series_id uuid;
alter table public.rides add column if not exists occurrence_index integer;
alter table public.rides add column if not exists started_at timestamptz;
alter table public.rides add column if not exists ended_at timestamptz;
-- Set once by `claim_departure_reminders`. The timestamp is the whole
-- deduplication mechanism: the sweep can run every few minutes forever and each
-- ride is still reminded about exactly one time.
alter table public.rides add column if not exists reminder_sent_at timestamptz;

-- Recurring schedules. A series is a template; each date is its own row in
-- `rides` pointing back at it, so cancelling one occurrence touches one ride
-- and leaves the rest of the schedule intact.
-- `cardinality(x) = count(distinct ...)` cannot be written inline: PostgreSQL
-- forbids subqueries in CHECK constraints. This immutable helper is the
-- supported way to express "no repeated weekdays", and because it is a plain
-- SQL function with no privileges it needs no grants and no SECURITY DEFINER.
create or replace function public.array_has_no_duplicates(input_values smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select count(distinct value) = cardinality($1)
    from unnest($1) as value;
$$;

comment on function public.array_has_no_duplicates(smallint[]) is
  'True when the array has no repeated elements. Used by the ride_series weekday CHECK.';

create table if not exists public.ride_series (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  origin_label text not null,
  origin_lat double precision not null,
  origin_lon double precision not null,
  destination_label text not null,
  destination_lat double precision not null,
  destination_lon double precision not null,
  departure_time text not null,
  days_of_week smallint[] not null,
  valid_from date not null,
  valid_until date,
  total_seats integer not null,
  base_fare integer not null,
  contribution integer not null,
  distance_km double precision not null,
  duration_minutes integer not null,
  route_geometry jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_series_origin_label_not_blank check (char_length(btrim(origin_label)) > 0),
  constraint ride_series_destination_label_not_blank check (char_length(btrim(destination_label)) > 0),
  constraint ride_series_departure_time_format check (departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint ride_series_days_not_empty check (cardinality(days_of_week) between 1 and 7),
  constraint ride_series_days_in_range check (
    days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint ride_series_days_unique check (public.array_has_no_duplicates(days_of_week)),
  constraint ride_series_valid_range check (valid_until is null or valid_until >= valid_from),
  constraint ride_series_seats_range check (total_seats between 1 and 12),
  constraint ride_series_fare_non_negative check (base_fare >= 0 and contribution >= 0),
  constraint ride_series_distance_positive check (distance_km > 0),
  constraint ride_series_duration_positive check (duration_minutes > 0)
);

create index if not exists ride_series_driver_idx
  on public.ride_series (driver_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rides_series_fkey'
  ) then
    alter table public.rides
      add constraint rides_series_fkey
      foreign key (series_id) references public.ride_series (id) on delete set null;
  end if;
end
$$;

create index if not exists rides_series_idx
  on public.rides (series_id) where series_id is not null;

-- Pickup and dropoff live on the booking, not on `ride_stops`: `ride_stops` is
-- readable by every signed-in member, and a passenger's pickup point is not
-- everyone's business. `bookings_select_involved` already limits these columns
-- to the rider and the driver.
alter table public.bookings add column if not exists pickup_label text;
alter table public.bookings add column if not exists pickup_lat double precision;
alter table public.bookings add column if not exists pickup_lon double precision;
alter table public.bookings add column if not exists dropoff_label text;
alter table public.bookings add column if not exists dropoff_lat double precision;
alter table public.bookings add column if not exists dropoff_lon double precision;
alter table public.bookings add column if not exists walk_distance_km double precision;
alter table public.bookings add column if not exists pickup_detour_km double precision;
alter table public.bookings add column if not exists pickup_detour_minutes integer;
alter table public.bookings add column if not exists dropoff_detour_km double precision;
alter table public.bookings add column if not exists dropoff_detour_minutes integer;
alter table public.bookings add column if not exists fare_amount integer;
alter table public.bookings add column if not exists match_score numeric(6, 2);
alter table public.bookings add column if not exists picked_up_at timestamptz;
alter table public.bookings add column if not exists no_show_at timestamptz;
-- Set exactly once, by the database, the first time the driver comes within the
-- approach threshold. A plain timestamp is the whole deduplication mechanism:
-- the notification can fire on every location update and still be delivered once.
alter table public.bookings add column if not exists driver_approaching_notified_at timestamptz;

-- `drop ... if exists` before every `add` so the script stays re-runnable, the
-- same way section 3 does it. These constraints are all new names, so dropping
-- one that was never created is a no-op.
alter table public.bookings drop constraint if exists bookings_fare_non_negative;
alter table public.bookings add constraint bookings_fare_non_negative
  check (fare_amount is null or fare_amount >= 0);
alter table public.bookings drop constraint if exists bookings_pickup_pair;
alter table public.bookings add constraint bookings_pickup_pair check (
  (pickup_lat is null) = (pickup_lon is null)
);
alter table public.bookings drop constraint if exists bookings_dropoff_pair;
alter table public.bookings add constraint bookings_dropoff_pair check (
  (dropoff_lat is null) = (dropoff_lon is null)
);
alter table public.bookings drop constraint if exists bookings_lat_range;
alter table public.bookings add constraint bookings_lat_range check (
  (pickup_lat is null or pickup_lat between -90 and 90)
  and (dropoff_lat is null or dropoff_lat between -90 and 90)
);
alter table public.bookings drop constraint if exists bookings_lon_range;
alter table public.bookings add constraint bookings_lon_range check (
  (pickup_lon is null or pickup_lon between -180 and 180)
  and (dropoff_lon is null or dropoff_lon between -180 and 180)
);
-- A pickup that is only half-specified would silently be read as "no pickup
-- agreed", so the labels travel with the coordinates.
alter table public.bookings drop constraint if exists bookings_pickup_label;
alter table public.bookings add constraint bookings_pickup_label check (
  pickup_label is null or btrim(pickup_label) <> ''
);
alter table public.bookings drop constraint if exists bookings_dropoff_label;
alter table public.bookings add constraint bookings_dropoff_label check (
  dropoff_label is null or btrim(dropoff_label) <> ''
);
alter table public.bookings drop constraint if exists bookings_detour_non_negative;
alter table public.bookings add constraint bookings_detour_non_negative check (
  (pickup_detour_km is null or pickup_detour_km >= 0)
  and (dropoff_detour_km is null or dropoff_detour_km >= 0)
  and (walk_distance_km is null or walk_distance_km >= 0)
);
alter table public.bookings drop constraint if exists bookings_match_score_range;
alter table public.bookings add constraint bookings_match_score_range check (
  match_score is null or (match_score between 0 and 100)
);

-- A rider may hold at most one live booking per ride. The old index is replaced
-- because `create unique index if not exists` would keep the narrower predicate
-- and let a rider request a second seat while a payment was still pending.
drop index if exists public.bookings_one_active_per_rider;

create unique index if not exists bookings_one_active_per_rider
  on public.bookings (ride_id, rider_id)
  where status in (
    'pending',
    'payment_pending',
    'confirmed',
    'picked_up',
    'completed'
  );

-- Live location, one row per ride. The host writes it; confirmed passengers of
-- that same ride read it. There is no policy that lets anyone else select it, so
-- the host's position is never broadcast.
create table if not exists public.ride_locations (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  driver_id uuid not null references public.profiles (id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  heading double precision,
  speed_kph double precision,
  accuracy_meters double precision,
  recorded_at timestamptz not null default now(),
  constraint ride_locations_lat_range check (lat between -90 and 90),
  constraint ride_locations_lon_range check (lon between -180 and 180),
  constraint ride_locations_heading_range check (heading is null or heading between 0 and 360),
  constraint ride_locations_accuracy_non_negative check (accuracy_meters is null or accuracy_meters >= 0)
);

create index if not exists ride_locations_recorded_idx
  on public.ride_locations (recorded_at desc);

-- Payment placeholder. One row per booking. No real money moves through this
-- table: it records the lifecycle so a gateway can be dropped in later without
-- the booking logic having to change. `provider` and `provider_ref` exist so the
-- real integration has somewhere to put its identifiers.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  ride_id uuid not null references public.rides (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null,
  currency text not null default 'INR',
  status public.payment_status not null default 'pending',
  settlement public.settlement_status not null default 'not_due',
  provider text not null default 'placeholder',
  provider_ref text,
  failure_reason text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_non_negative check (amount >= 0),
  constraint payments_currency_not_blank check (char_length(btrim(currency)) > 0),
  constraint payments_booking_key unique (booking_id)
);

create index if not exists payments_ride_idx on public.payments (ride_id);
create index if not exists payments_settlement_idx
  on public.payments (settlement) where settlement <> 'not_due';

-- Optional UPI ID, in its own table on purpose. `profiles` is readable by every
-- signed-in member (see `profiles_select_authenticated`), so a UPI handle added
-- as a column there would be readable by everyone, which is the opposite of
-- "never expose it publicly by default". A dedicated table with owner-only
-- policies satisfies that without touching the existing profile policies.
create table if not exists public.profile_payment_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  upi_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_payment_details_upi_format check (
    upi_id is null
    or (
      btrim(upi_id) ~ '^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{0,31}$'
    )
  )
);

-- -----------------------------------------------------------------------------
-- 9c. Seat accounting now starts at acceptance
-- -----------------------------------------------------------------------------

-- The states that hold a seat. Kept in one place because three different places
-- need to agree on it: this trigger, `sync_ride_total_seats`, and the
-- participation helpers.
create or replace function public.booking_holds_seat(target_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select target_status in ('payment_pending', 'confirmed', 'picked_up', 'completed');
$$;

create or replace function public.apply_booking_seat_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ride_id uuid;
  previously_taken integer := 0;
  newly_taken integer := 0;
  ride_total integer;
  ride_available integer;
begin
  target_ride_id := case
    when tg_op = 'DELETE' then old.ride_id
    else new.ride_id
  end;

  if tg_op in ('UPDATE', 'DELETE') then
    if public.booking_holds_seat(old.status::text) then
      previously_taken := old.seats;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if public.booking_holds_seat(new.status::text) then
      newly_taken := new.seats;
    end if;
  end if;

  if newly_taken <> previously_taken then
    -- `for update` is the whole reason two hosts confirming at the same instant
    -- cannot both take the last seat: the second statement blocks here until the
    -- first commits, then reads the already-decremented `seats_available`.
    select r.total_seats, r.seats_available
      into ride_total, ride_available
      from public.rides r
     where r.id = target_ride_id
       for update;

    if found then
      if newly_taken > previously_taken then
        if ride_available < (newly_taken - previously_taken) then
          raise exception
            'Not enough seats left on this ride to confirm % seat(s)',
            newly_taken - previously_taken
            using errcode = 'check_violation';
        end if;

        update public.rides
           set seats_available = seats_available - (newly_taken - previously_taken)
         where id = target_ride_id;
      else
        update public.rides
           set seats_available = least(
             ride_total,
             ride_available + (previously_taken - newly_taken)
           )
         where id = target_ride_id;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.sync_ride_total_seats()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  booked integer;
begin
  select coalesce(sum(b.seats), 0)
    into booked
    from public.bookings b
   where b.ride_id = new.id
     and public.booking_holds_seat(b.status::text);

  if new.total_seats < booked then
    raise exception
      'Cannot reduce total seats to % because % seat(s) are already booked',
      new.total_seats, booked
      using errcode = 'check_violation';
  end if;

  new.seats_available := new.total_seats - booked;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9d. State transition guards
--     These are the reason the UI cannot put a ride or a booking into a state
--     the workflow does not allow, whatever it sends.
-- -----------------------------------------------------------------------------

create or replace function public.enforce_ride_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  from_status text;
  to_status text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  from_status := old.status::text;
  to_status := new.status::text;

  if from_status = to_status then
    return new;
  end if;

  -- Only the host may move their own ride. `auth.uid()` is null for the
  -- SECURITY DEFINER service paths, which are the only other writer.
  if auth.uid() is not null and auth.uid() <> old.driver_id then
    raise exception 'Only the host can change this ride''s status'
      using errcode = 'insufficient_privilege';
  end if;

  if from_status in ('completed', 'cancelled') then
    raise exception 'A % ride cannot change status', from_status
      using errcode = 'check_violation';
  end if;

  if to_status not in ('upcoming', 'in_progress', 'completed', 'cancelled') then
    raise exception '% is not a valid ride status', to_status
      using errcode = 'check_violation';
  end if;

  -- A finished or cancelled ride may not be started, and a ride that already
  -- ran may not be reopened.
  if to_status = 'in_progress' and from_status not in ('upcoming', 'active') then
    raise exception 'Only a published ride can be started'
      using errcode = 'check_violation';
  end if;

  if to_status = 'completed' and from_status <> 'in_progress' then
    raise exception 'Only a ride that is in progress can be completed'
      using errcode = 'check_violation';
  end if;

  if to_status = 'upcoming' and from_status = 'in_progress' then
    raise exception 'A ride that is in progress cannot go back to published'
      using errcode = 'check_violation';
  end if;

  if to_status = 'in_progress' then
    new.started_at := coalesce(new.started_at, now());
  end if;

  if to_status = 'completed' then
    new.ended_at := coalesce(new.ended_at, now());
  end if;

  if to_status = 'cancelled' then
    new.ended_at := coalesce(new.ended_at, now());
  end if;

  return new;
end;
$$;

create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  from_status text;
  to_status text;
  is_driver boolean;
  ride_state text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  from_status := old.status::text;
  to_status := new.status::text;

  if from_status = to_status then
    return new;
  end if;

  select r.status::text, exists (
    select 1 from public.rides r2
     where r2.id = r.id and r2.driver_id = auth.uid()
  )
    into ride_state, is_driver
    from public.rides r
   where r.id = old.ride_id;

  -- The payment trigger and the ride-cancellation cascade run as SECURITY
  -- DEFINER with no signed-in user, so `auth.uid()` is null for them and the
  -- authority check is skipped for exactly those paths.
  if auth.uid() is not null and not is_driver and auth.uid() <> old.rider_id then
    raise exception 'You cannot change this booking'
      using errcode = 'insufficient_privilege';
  end if;

  if from_status in ('rejected', 'cancelled', 'completed', 'no_show') then
    raise exception 'A % booking cannot change status', from_status
      using errcode = 'check_violation';
  end if;

  if to_status not in (
    'pending', 'payment_pending', 'confirmed', 'picked_up',
    'completed', 'rejected', 'cancelled', 'no_show'
  ) then
    raise exception '% is not a valid booking status', to_status
      using errcode = 'check_violation';
  end if;

  if from_status = 'pending' and to_status not in ('payment_pending', 'rejected', 'cancelled') then
    raise exception 'A requested seat must be accepted before it can be %', to_status
      using errcode = 'check_violation';
  end if;

  if from_status = 'payment_pending' and to_status not in ('confirmed', 'cancelled') then
    raise exception 'A seat awaiting payment can only be confirmed or cancelled'
      using errcode = 'check_violation';
  end if;

  if from_status = 'confirmed' and to_status not in ('picked_up', 'cancelled', 'no_show') then
    raise exception 'A confirmed seat can only be picked up, cancelled or marked as a no-show'
      using errcode = 'check_violation';
  end if;

  if from_status = 'picked_up' and to_status not in ('completed', 'no_show', 'cancelled') then
    raise exception 'A passenger who is in the vehicle can only complete the trip, be marked as a no-show, or have the ride cancelled'
      using errcode = 'check_violation';
  end if;

  if ride_state is null then
    raise exception 'That ride no longer exists'
      using errcode = 'foreign_key_violation';
  end if;

  -- Collecting a passenger describes something that happens at the kerbside while
  -- the trip is running, so it is impossible while the ride is still parked.
  -- Without this a host could collect a passenger days before departure.
  --
  -- A no-show is also reachable once the ride has finished, because that is
  -- exactly what `finalize_ride_completion` does with everyone still waiting at
  -- the kerb when the trip ends. It is not reachable from a ride that is merely
  -- published: that is a trip that has not started.
  if to_status = 'picked_up' and ride_state is distinct from 'in_progress' then
    raise exception 'Start the ride before you can collect a passenger'
      using errcode = 'check_violation';
  end if;

  if to_status = 'no_show' and ride_state not in ('in_progress', 'completed', 'cancelled') then
    raise exception 'Start the ride before you can write off a passenger'
      using errcode = 'check_violation';
  end if;

  -- Authority per transition. A rider may withdraw; only the host may accept,
  -- confirm, collect, or write off a seat. Without this the permissive
  -- `bookings_update_involved` policy would let a rider confirm their own seat.
  if auth.uid() is not null and to_status <> 'cancelled' and not is_driver then
    raise exception 'Only the host can accept, confirm or update this seat'
      using errcode = 'insufficient_privilege';
  end if;

  if to_status = 'payment_pending' and new.seats < 1 then
    raise exception 'A booking must hold at least one seat'
      using errcode = 'check_violation';
  end if;

  -- The amount the rider owes is computed here, from the host's own contribution
  -- for the seats being held, and overwrites whatever the client sent. Acceptance
  -- is the moment the price becomes binding, so this is where it is fixed: a
  -- client cannot name its own price, and the host cannot quietly change a price
  -- that was already agreed for a seat that is already being paid.
  if to_status = 'payment_pending' then
    new.fare_amount := (
      select r.contribution * new.seats
        from public.rides r
       where r.id = new.ride_id
    );

    if new.fare_amount is null then
      raise exception 'That ride no longer exists'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if to_status = 'picked_up' then
    new.picked_up_at := coalesce(new.picked_up_at, now());
  end if;

  if to_status = 'no_show' then
    new.no_show_at := coalesce(new.no_show_at, now());
  end if;

  -- A seat is only collectable from someone who actually has one.
  if to_status in ('picked_up', 'completed') and new.picked_up_at is null then
    raise exception 'A passenger must be picked up before the trip is completed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Cancelling a ride has to take its bookings with it, otherwise confirmed
-- passengers keep a seat on a ride that is not running and the host's seats stay
-- consumed forever.
create or replace function public.cascade_ride_cancellation()
returns trigger
  language plpgsql
security definer
set search_path = ''
as $$
declare
  affected record;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status::text <> 'cancelled' or old.status::text = 'cancelled' then
    return new;
  end if;

  for affected in
    select b.id, b.rider_id
      from public.bookings b
     where b.ride_id = new.id
       and b.status::text in ('pending', 'payment_pending', 'confirmed', 'picked_up')
     for update
  loop
    update public.bookings
       set status = 'cancelled'
     where id = affected.id;
  end loop;

  -- A cancelled ride has no live position to share.
  delete from public.ride_locations where ride_id = new.id;

  return new;
end;
$$;

-- Ending a ride retires the location stream and settles each confirmed
-- passenger's placeholder payout. No money moves; the row only records that the
-- obligation exists and is complete, so a real gateway has somewhere to write.
create or replace function public.finalize_ride_completion()
returns trigger
  language plpgsql
security definer
set search_path = ''
as $$
declare
  affected record;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status::text <> 'completed' or old.status::text = 'completed' then
    return new;
  end if;

  delete from public.ride_locations where ride_id = new.id;

  -- Requests the host never answered, and seats accepted but never paid for, are
  -- closed rather than left open on a trip that has already finished. They are
  -- kept as `cancelled` rows, not deleted, so the rider still sees the outcome
  -- and the host's history still shows the request - but `enforce_booking_status_transition`
  -- now makes them terminal, so a `payment_pending` seat can no longer be
  -- confirmed onto a completed ride and hold a seat nobody will drive.
  for affected in
    select b.id
      from public.bookings b
     where b.ride_id = new.id
       and b.status::text in ('pending', 'payment_pending')
     for update
  loop
    update public.bookings
       set status = 'cancelled'
     where id = affected.id;
  end loop;

  -- Anyone still waiting at the kerb when the trip ends did not get picked up.
  for affected in
    select b.id
      from public.bookings b
     where b.ride_id = new.id
       and b.status::text = 'confirmed'
     for update
  loop
    update public.bookings
       set status = 'no_show'
     where id = affected.id;
  end loop;

  for affected in
    select b.id
      from public.bookings b
     where b.ride_id = new.id
       and b.status::text = 'picked_up'
     for update
  loop
    update public.bookings
       set status = 'completed'
     where id = affected.id;
  end loop;

  update public.payments
     set settlement = 'pending',
         settled_at = null
   where ride_id = new.id
     and status = 'success'
     and settlement = 'not_due';

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9e. Payment placeholder lifecycle
-- -----------------------------------------------------------------------------

-- Opening a placeholder payment is allowed only from `payment_pending`, which is
-- the state the host's acceptance put the booking in.
create or replace function public.guard_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_status text;
  rider uuid;
  seats integer;
begin
  select b.status::text, b.rider_id, b.seats
    into booking_status, rider, seats
    from public.bookings b
   where b.id = new.booking_id;

  if booking_status is null then
    raise exception 'That booking no longer exists'
      using errcode = 'foreign_key_violation';
  end if;

  if auth.uid() is not null and auth.uid() <> rider then
    raise exception 'You can only pay for your own booking'
      using errcode = 'insufficient_privilege';
  end if;

  if booking_status <> 'payment_pending' then
    raise exception 'This seat is not awaiting payment'
      using errcode = 'check_violation';
  end if;

  new.ride_id := (select b.ride_id from public.bookings b where b.id = new.booking_id);
  new.rider_id := rider;
  -- The amount is the host's contribution for the seats held, never a
  -- client-supplied number.
  new.amount := (select r.contribution * seats from public.rides r where r.id = new.ride_id);

  return new;
end;
$$;

-- The placeholder is a two-state machine the **host** drives:
-- `pending` -> `success` or `failed`. The rider opens it; the driver is the one
-- who has the money in hand and marks it received. Letting the payer resolve
-- their own payment would make "confirmed" a self-issued fact, so the rider is
-- refused here. A real gateway replaces this with a service-role call, which
-- the `auth.uid() is null` branch already allows.
--
-- The one exception is a booking that has been closed. `pending -> failed` and
-- `success -> refunded` are then the *only* legal moves, and they exist so the
-- database can void a charge nobody is entitled to keep rather than leaving a
-- payment row claiming money is owed for a seat that no longer exists. That is
-- not a loophole for a client: the branch is unreachable while the seat is open,
-- which is exactly when the host's own choice above is meaningful.
create or replace function public.guard_payment_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_state text;
begin
  if new.status::text = old.status::text then
    return new;
  end if;

  select b.status::text into booking_state
    from public.bookings b
   where b.id = new.booking_id;

  if booking_state in ('cancelled', 'rejected') then
    if new.status::text = 'refunded' then
      if old.status::text <> 'success' then
        raise exception 'Only a payment that succeeded can be refunded'
          using errcode = 'check_violation';
      end if;

      -- Nothing is owed, so the payout obligation is withdrawn rather than
      -- settled. `provider_ref` is deliberately left in place: it is the handle a
      -- real gateway would need to find and reverse the original charge.
      new.settlement := 'not_due';
      new.settled_at := null;
      return new;
    end if;

    if new.status::text = 'failed' then
      if old.status::text <> 'pending' then
        raise exception 'This payment has already been resolved'
          using errcode = 'check_violation';
      end if;

      new.failure_reason := coalesce(
        new.failure_reason,
        'The seat was cancelled before the payment was resolved.'
      );
      return new;
    end if;

    raise exception 'A payment for a cancelled seat can only be voided or refunded'
      using errcode = 'check_violation';
  end if;

  if auth.uid() is not null and not public.is_ride_driver(new.ride_id) then
    raise exception 'Only the driver can mark this payment as received'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status::text <> 'pending' then
    raise exception 'This payment has already been resolved'
      using errcode = 'check_violation';
  end if;

  if new.status::text not in ('success', 'failed') then
    raise exception 'A pending payment can only succeed or fail'
      using errcode = 'check_violation';
  end if;

  if new.status::text = 'failed' and new.failure_reason is null then
    new.failure_reason := 'The driver recorded this payment as not received.';
  end if;

  return new;
end;
$$;

-- A cancelled seat has no money obligation left in it.
--
-- Two cases, both decided here rather than by whichever client happened to do the
-- cancelling, so a rider withdrawing and a host cancelling a ride leave the
-- payment history identical:
--
--   success -> refunded   the charge is reversed (as a placeholder)
--   pending -> failed     the charge was never resolved and cannot be
--
-- A `failed` payment is left alone: `apply_payment_outcome` already cancelled the
-- booking, and a second write would be a no-op that exists only to confuse.
create or replace function public.release_refund_for_closed_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status::text <> 'cancelled' or old.status::text = 'cancelled' then
    return new;
  end if;

  update public.payments
     set status = case
       when status::text = 'success' then 'refunded'::public.payment_status
       else 'failed'::public.payment_status
     end
   where booking_id = new.id
     and status::text in ('pending', 'success');

  return new;
end;
$$;

comment on function public.release_refund_for_closed_booking() is
  'Reverses the placeholder charge for a booking that was cancelled, so no payment row is left claiming money is owed for a seat that no longer exists.';

drop trigger if exists bookings_release_refund on public.bookings;
create trigger bookings_release_refund
  after update of status on public.bookings
  for each row execute function public.release_refund_for_closed_booking();

-- Turns the payment outcome into the booking transition. Success confirms the
-- seat; failure releases it rather than leaving a seat held by a booking that
-- can never be paid for.
create or replace function public.apply_payment_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = old.status::text then
    return new;
  end if;

  if new.status::text = 'success' then
    update public.bookings
       set status = 'confirmed'
     where id = new.booking_id
       and status::text = 'payment_pending';
  elsif new.status::text = 'failed' then
    update public.bookings
       set status = 'cancelled'
     where id = new.booking_id
       and status::text = 'payment_pending';
  end if;

  return new;
end;
$$;

-- The third leg of the placeholder money lifecycle.
--
--   payment_success -> settlement_pending -> settlement_complete
--
-- `finalize_ride_completion` moves a successful payment to `settlement_pending`
-- when the trip ends, because the host is owed from the moment the passenger has
-- actually travelled. Nothing pays out: this function only records that the host
-- has acknowledged the obligation, which is where a real gateway's payout call
-- would sit. Swapping in that gateway is a change to this function alone, and the
-- ride lifecycle never learns which one it is talking to.
--
-- Host-only and scoped to rides they drive, so it cannot mark somebody else's
-- payout as settled. The `settlement = 'pending'` predicate is also the
-- concurrency guard: a second, overlapping call finds no rows and returns 0
-- rather than settling the same payout twice.
--
-- Deliberately NOT `security definer`. It runs as the caller, so
-- `payments_update_involved` and the explicit driver check below both apply, and
-- a browser cannot use it to reach a payment it is not part of. It is the same
-- reasoning as `set_default_vehicle`.
create or replace function public.record_payout_placeholders()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  acknowledged integer := 0;
begin
  update public.payments p
     set settlement = 'complete',
         settled_at = now()
   where p.settlement = 'pending'
     and p.status = 'success'
     and public.is_ride_driver(p.ride_id)
     and exists (
       select 1
         from public.rides r
        where r.id = p.ride_id
          and r.driver_id = auth.uid()
     );

  get diagnostics acknowledged = row_count;
  return acknowledged;
end;
$$;

comment on function public.record_payout_placeholders() is
  'Marks the signed-in host''s own due placeholder payouts as settled. Moves no money; it records the step a real gateway payout would occupy. Returns how many payouts were recorded.';

revoke all on function public.record_payout_placeholders() from public, anon;
grant execute on function public.record_payout_placeholders() to authenticated;

-- -----------------------------------------------------------------------------
-- 9f. Live location and the approaching notification
-- -----------------------------------------------------------------------------

-- The approach threshold lives here and nowhere else. Changing it changes the
-- behaviour of the single trigger below.
create or replace function public.approach_threshold_meters()
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 400.0::double precision;
$$;

comment on function public.approach_threshold_meters() is
  'Single source of truth for how close the host must be to a pickup point '
  'before the passenger is told the driver is approaching. Battery- and '
  'spam-conscious: one notification per booking, enforced by '
  'bookings.driver_approaching_notified_at.';

-- A ride only streams location while it is actually running.
create or replace function public.guard_ride_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ride_status text;
  driver uuid;
begin
  select r.status::text, r.driver_id
    into ride_status, driver
    from public.rides r
   where r.id = new.ride_id;

  if ride_status is null then
    raise exception 'That ride no longer exists'
      using errcode = 'foreign_key_violation';
  end if;

  if ride_status <> 'in_progress' then
    raise exception 'Location is only shared while a ride is in progress'
      using errcode = 'check_violation';
  end if;

  if auth.uid() is not null and auth.uid() <> driver then
    raise exception 'Only the host can share their location for this ride'
      using errcode = 'insufficient_privilege';
  end if;

  new.driver_id := driver;
  new.recorded_at := now();
  return new;
end;
$$;

create or replace function public.notify_driver_approaching()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting record;
  threshold double precision := public.approach_threshold_meters();
  distance_meters double precision;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Not a fresh fix, so nothing to re-evaluate.
  if new.recorded_at is not distinct from old.recorded_at then
    return new;
  end if;

  for waiting in
    select b.id, b.rider_id, b.pickup_lat, b.pickup_lon
      from public.bookings b
     where b.ride_id = new.ride_id
       and b.status::text = 'confirmed'
       and b.pickup_lat is not null
       -- The deduplication guard. Once this is set the rider is never told
       -- again about this booking, no matter how often the driver moves.
       and b.driver_approaching_notified_at is null
  loop
    distance_meters := 6371000.0 * 2.0 * asin(
      least(1.0, sqrt(
        power(sin(radians(waiting.pickup_lat - new.lat) / 2.0), 2)
        + cos(radians(waiting.pickup_lat)) * cos(radians(new.lat))
        * power(sin(radians(waiting.pickup_lon - new.lon) / 2.0), 2)
      ))
    );

    if distance_meters <= threshold then
      update public.bookings
         set driver_approaching_notified_at = now()
       where id = waiting.id;

      perform public.push_notification(
        waiting.rider_id,
        'driver-approaching',
        'Your driver is approaching',
        'Your driver is close to your pickup point. Please be ready.',
        new.ride_id
      );
    end if;
  end loop;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9g. Participation helpers now include the new live states
-- -----------------------------------------------------------------------------

create or replace function public.has_ride_booking(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.bookings b
     where b.ride_id = target_ride_id
       and b.rider_id = auth.uid()
       and b.status::text in ('pending', 'payment_pending', 'confirmed', 'picked_up', 'completed')
  );
$$;

-- Riders on board right now. This is the set allowed to read live location, and
-- it is deliberately narrower than `has_ride_booking`.
create or replace function public.is_ride_passenger(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.bookings b
     where b.ride_id = target_ride_id
       and b.rider_id = auth.uid()
       and b.status::text in ('confirmed', 'picked_up', 'completed')
  );
$$;

create or replace function public.is_completed_ride_participant(target_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride_id
       and r.status::text = 'completed'
       and (
         r.driver_id = auth.uid()
         or exists (
           select 1
             from public.bookings b
            where b.ride_id = r.id
              and b.rider_id = auth.uid()
              and b.status::text in ('confirmed', 'picked_up', 'completed')
         )
       )
  );
$$;

create or replace function public.ride_has_participant(
  target_ride_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride_id
       and (
         r.driver_id = target_user_id
         or exists (
           select 1
             from public.bookings b
            where b.ride_id = r.id
              and b.rider_id = target_user_id
              and b.status::text in ('confirmed', 'picked_up', 'completed')
         )
       )
  );
$$;

-- -----------------------------------------------------------------------------
-- 9h. Notification fan-out for the new events
-- -----------------------------------------------------------------------------

create or replace function public.notify_ride_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status::text = old.status::text then
    return new;
  end if;

  if new.status::text = 'in_progress' then
    for recipient in
      select b.rider_id as participant
        from public.bookings b
       where b.ride_id = new.id
         and b.status::text in ('confirmed', 'picked_up')
    loop
      perform public.push_notification(
        recipient.participant, 'ride-started',
        'Your ride has started',
        format('Your driver has started the trip from %s to %s.',
          new.origin_label, new.destination_label),
        new.id
      );
    end loop;
  elsif new.status::text = 'cancelled' then
    for recipient in
      select b.rider_id as participant
        from public.bookings b
       where b.ride_id = new.id
         and b.status::text in ('pending', 'payment_pending', 'confirmed', 'picked_up')
    loop
      perform public.push_notification(
        recipient.participant, 'ride-cancelled',
        'Ride cancelled',
        format('The ride from %s to %s was cancelled by the host.',
          new.origin_label, new.destination_label),
        new.id
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.notify_booking_journey()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  driver uuid;
  rider uuid;
  origin_label text;
  destination_label text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status::text = old.status::text then
    return new;
  end if;

  select r.driver_id, r.origin_label, r.destination_label
    into driver, origin_label, destination_label
    from public.rides r
   where r.id = new.ride_id;

  if driver is null then
    return new;
  end if;
  rider := new.rider_id;

  if new.status::text = 'payment_pending' then
    perform public.push_notification(
      rider, 'booking-accepted',
      'Request accepted',
      format('Your seat on %s to %s was accepted. Complete payment to confirm it.',
        origin_label, destination_label),
      new.ride_id
    );
  elsif new.status::text = 'no_show' then
    -- Only the host needs telling here: the host is the one who marked it, and
    -- the rider is told by the cancellation that follows a host cancellation or
    -- by the booking state itself.
    perform public.push_notification(
      driver, 'booking-no-show',
      'Passenger did not show up',
      format('A passenger on %s to %s was marked as a no-show and their seat is free again.',
        origin_label, destination_label),
      new.ride_id
    );
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9i. Trigger wiring
-- -----------------------------------------------------------------------------

drop trigger if exists rides_enforce_status on public.rides;
create trigger rides_enforce_status
  before update of status on public.rides
  for each row execute function public.enforce_ride_status_transition();

drop trigger if exists rides_cascade_cancellation on public.rides;
create trigger rides_cascade_cancellation
  after update of status on public.rides
  for each row execute function public.cascade_ride_cancellation();

drop trigger if exists rides_finalize_completion on public.rides;
create trigger rides_finalize_completion
  after update of status on public.rides
  for each row execute function public.finalize_ride_completion();

drop trigger if exists rides_notify_lifecycle on public.rides;
create trigger rides_notify_lifecycle
  after update of status on public.rides
  for each row execute function public.notify_ride_lifecycle();

drop trigger if exists bookings_enforce_status on public.bookings;
create trigger bookings_enforce_status
  before update of status on public.bookings
  for each row execute function public.enforce_booking_status_transition();

drop trigger if exists bookings_notify_journey on public.bookings;
create trigger bookings_notify_journey
  after update of status on public.bookings
  for each row execute function public.notify_booking_journey();

drop trigger if exists payments_guard_insert on public.payments;
create trigger payments_guard_insert
  before insert on public.payments
  for each row execute function public.guard_payment_insert();

drop trigger if exists payments_guard_transition on public.payments;
create trigger payments_guard_transition
  before update on public.payments
  for each row execute function public.guard_payment_transition();

drop trigger if exists payments_apply_outcome on public.payments;
create trigger payments_apply_outcome
  after update on public.payments
  for each row execute function public.apply_payment_outcome();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

drop trigger if exists ride_series_set_updated_at on public.ride_series;
create trigger ride_series_set_updated_at
  before update on public.ride_series
  for each row execute function public.set_updated_at();

drop trigger if exists profile_payment_details_set_updated_at
  on public.profile_payment_details;
create trigger profile_payment_details_set_updated_at
  before update on public.profile_payment_details
  for each row execute function public.set_updated_at();

drop trigger if exists ride_locations_guard on public.ride_locations;
create trigger ride_locations_guard
  before insert or update on public.ride_locations
  for each row execute function public.guard_ride_location();

drop trigger if exists ride_locations_notify_approaching on public.ride_locations;
create trigger ride_locations_notify_approaching
  after update on public.ride_locations
  for each row execute function public.notify_driver_approaching();

-- -----------------------------------------------------------------------------
-- 9j. The vehicle a ride is published with must be the host's own
--     `rides_insert_own` / `rides_update_own` only check `driver_id`, so without
--     this a caller could attach somebody else's vehicle to a ride they drive
--     and show its plate, model and colour to every passenger. The app already
--     only offers the host's own vehicles; this is what makes that a rule rather
--     than a convention.
-- -----------------------------------------------------------------------------

create or replace function public.guard_ride_vehicle_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vehicle_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = new.vehicle_id
       and v.owner_id = new.driver_id
  ) then
    raise exception 'You can only offer a ride using one of your own vehicles'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function public.guard_ride_vehicle_ownership() is
  'Stops a ride (or a recurring series) from being published with a vehicle its driver does not own.';

drop trigger if exists rides_guard_vehicle on public.rides;
create trigger rides_guard_vehicle
  before insert or update of vehicle_id, driver_id on public.rides
  for each row execute function public.guard_ride_vehicle_ownership();

drop trigger if exists ride_series_guard_vehicle on public.ride_series;
create trigger ride_series_guard_vehicle
  before insert or update of vehicle_id, driver_id on public.ride_series
  for each row execute function public.guard_ride_vehicle_ownership();

-- -----------------------------------------------------------------------------
-- 9k. Departure reminders
-- -----------------------------------------------------------------------------

-- Writes one reminder per ride that is about to leave, then stamps the ride so
-- it is never reminded about twice.
--
-- Idempotency is the `update ... where reminder_sent_at is null` claim, not a
-- separate lock: whoever wins the row update owns the notification fan-out, so
-- two overlapping calls send the reminder once between them rather than once
-- each. Returns the number of rides claimed, which is what a scheduler logs.
--
-- Only rides with somebody actually travelling are claimed. A driver with an
-- empty car has nothing to be reminded about, and claiming such a ride would
-- burn its one reminder on a notification saying "your passengers are waiting"
-- when there are none.
--
-- The message deliberately carries no clock time. `departure_at` is stored in
-- UTC and every member reads it in their own zone, so a time formatted here
-- would be right for exactly one of them and wrong for the rest. The app shows
-- the local time; the notification just says the trip is imminent.
create or replace function public.claim_departure_reminders(
  lead_minutes integer default 60,
  max_claims integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed record;
  reminder record;
  reminded integer := 0;
begin
  if lead_minutes is null or lead_minutes < 0 then
    raise exception 'lead_minutes must not be negative'
      using errcode = 'invalid_parameter_value';
  end if;

  for claimed in
    update public.rides r
       set reminder_sent_at = now()
     where r.reminder_sent_at is null
       and r.status::text in ('upcoming', 'active')
       and r.departure_at > now()
       and r.departure_at <= now() + make_interval(mins => lead_minutes)
       and exists (
         select 1 from public.bookings b
          where b.ride_id = r.id
            and b.status::text in ('payment_pending', 'confirmed', 'picked_up')
       )
       and r.id in (
         select id from public.rides
          where reminder_sent_at is null
            and status::text in ('upcoming', 'active')
            and departure_at > now()
            and departure_at <= now() + make_interval(mins => lead_minutes)
            and exists (
              select 1 from public.bookings b
               where b.ride_id = rides.id
                 and b.status::text in ('payment_pending', 'confirmed', 'picked_up')
            )
          order by departure_at
          limit greatest(1, least(max_claims, 1000))
       )
    returning r.id, r.driver_id, r.origin_label, r.destination_label,
              (select array_agg(b.rider_id)
                 from public.bookings b
                where b.ride_id = r.id
                  and b.status::text in ('payment_pending', 'confirmed', 'picked_up')) as riders
  loop
    -- Guaranteed non-empty by the `exists` above; asserted because a null array
    -- would silently turn this loop into a no-op and the driver into a recipient
    -- of a message about nobody.
    if claimed.riders is null then
      continue;
    end if;

    for reminder in
      select unnest(claimed.riders) as participant
    loop
      perform public.push_notification(
        reminder.participant,
        'ride-reminder',
        'Your ride leaves soon',
        format('%s to %s departs shortly. Open RideTogether for your pickup details.',
          claimed.origin_label, claimed.destination_label),
        claimed.id
      );
    end loop;

    perform public.push_notification(
      claimed.driver_id,
      'ride-reminder',
      'Your ride leaves soon',
      format('%s to %s departs shortly. Your passengers are waiting.',
        claimed.origin_label, claimed.destination_label),
      claimed.id
    );

    reminded := reminded + 1;
  end loop;

  return reminded;
end;
$$;

comment on function public.claim_departure_reminders(integer, integer) is
  'Sends one departure reminder per soon-to-depart ride that has passengers, and returns how many rides were claimed. Safe to call repeatedly and concurrently.';

revoke all on function public.claim_departure_reminders(integer, integer) from public, anon, authenticated;

-- The sweep needs a clock. `pg_cron` is the one that is available, so the
-- schedule is created when the extension is and the function is left callable
-- by hand when it is not. Either way the reminder logic itself is in the
-- database and is not duplicated anywhere in the app.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled; call claim_departure_reminders() from your own scheduler for departure reminders';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'ride-departure-reminders') then
    perform cron.unschedule('ride-departure-reminders');
  end if;

  perform cron.schedule(
    'ride-departure-reminders',
    '*/10 * * * *',
    $cron$select public.claim_departure_reminders(60, 200)$cron$
  );
exception
  when insufficient_privilege then
    raise notice 'Not permitted to manage cron jobs; call claim_departure_reminders() from your own scheduler for departure reminders';
end
$outer$;

-- -----------------------------------------------------------------------------
-- 9l. RLS for the new tables
--     Nothing here widens an existing policy. The only change to an old policy
--     is `bookings`, whose update policy gains the host-only transition guard's
--     counterpart in the database rather than in the browser.
-- -----------------------------------------------------------------------------

alter table public.ride_series enable row level security;
alter table public.ride_locations enable row level security;
alter table public.payments enable row level security;
alter table public.profile_payment_details enable row level security;

-- ride_series ------------------------------------------------------------------

drop policy if exists ride_series_select_authenticated on public.ride_series;
create policy ride_series_select_authenticated
  on public.ride_series for select to authenticated using (true);

drop policy if exists ride_series_insert_own on public.ride_series;
create policy ride_series_insert_own
  on public.ride_series for insert to authenticated with check (driver_id = auth.uid());

drop policy if exists ride_series_update_own on public.ride_series;
create policy ride_series_update_own
  on public.ride_series for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists ride_series_delete_own on public.ride_series;
create policy ride_series_delete_own
  on public.ride_series for delete to authenticated using (driver_id = auth.uid());

-- ride_locations ---------------------------------------------------------------
-- Read is limited to the host and to passengers actually on this ride. There is
-- no policy for anyone else, so a location row is invisible outside the ride.

drop policy if exists ride_locations_select_participants on public.ride_locations;
create policy ride_locations_select_participants
  on public.ride_locations for select to authenticated
  using (driver_id = auth.uid() or public.is_ride_passenger(ride_id));

drop policy if exists ride_locations_insert_driver on public.ride_locations;
create policy ride_locations_insert_driver
  on public.ride_locations for insert to authenticated
  with check (driver_id = auth.uid() and public.is_ride_driver(ride_id));

drop policy if exists ride_locations_update_driver on public.ride_locations;
create policy ride_locations_update_driver
  on public.ride_locations for update to authenticated
  using (driver_id = auth.uid() and public.is_ride_driver(ride_id))
  with check (driver_id = auth.uid() and public.is_ride_driver(ride_id));

-- Without this, `clearRideLocation` deleted nothing: with RLS enabled and no
-- DELETE policy, Postgres returns zero deleted rows and no error, so the caller
-- believed it had stopped sharing while the last known position stayed on the
-- row and kept being read by every passenger on the ride.
drop policy if exists ride_locations_delete_driver on public.ride_locations;
create policy ride_locations_delete_driver
  on public.ride_locations for delete to authenticated
  using (driver_id = auth.uid() and public.is_ride_driver(ride_id));

-- payments ---------------------------------------------------------------------
-- A payment is readable by the rider who owes it and the host who is owed. The
-- rider opens it, the host resolves it, and `guard_payment_transition` is what
-- keeps those two apart - the policies below only decide which rows a caller can
-- touch at all, not which transitions they may make.

drop policy if exists payments_select_involved on public.payments;
create policy payments_select_involved
  on public.payments for select to authenticated
  using (rider_id = auth.uid() or public.is_ride_driver(ride_id));

drop policy if exists payments_insert_own on public.payments;
create policy payments_insert_own
  on public.payments for insert to authenticated
  with check (rider_id = auth.uid());

-- The rider and the host can both see the row and attempt the write; which of
-- them may actually resolve it is decided in the guard trigger, which is
-- SECURITY DEFINER and therefore re-checks the real driver of the ride rather
-- than trusting what the browser sent.
drop policy if exists payments_update_involved on public.payments;
create policy payments_update_involved
  on public.payments for update to authenticated
  using (rider_id = auth.uid() or public.is_ride_driver(ride_id))
  with check (rider_id = auth.uid() or public.is_ride_driver(ride_id));

-- profile_payment_details ------------------------------------------------------
-- Owner only, in both directions. Nothing here is readable by another member,
-- which is the reason this is a separate table rather than a `profiles` column.

drop policy if exists profile_payment_details_select_own
  on public.profile_payment_details;
create policy profile_payment_details_select_own
  on public.profile_payment_details for select to authenticated
  using (user_id = auth.uid());

drop policy if exists profile_payment_details_insert_own
  on public.profile_payment_details;
create policy profile_payment_details_insert_own
  on public.profile_payment_details for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profile_payment_details_update_own
  on public.profile_payment_details;
create policy profile_payment_details_update_own
  on public.profile_payment_details for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists profile_payment_details_delete_own
  on public.profile_payment_details;
create policy profile_payment_details_delete_own
  on public.profile_payment_details for delete to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 9m. Grants and realtime for the new objects
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
revoke all on all tables in schema public from anon;

-- `is_ride_passenger` is a boolean-presence helper, exactly like the ones already
-- granted above, and is needed by the location policy.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_ride_passenger(uuid)',
    'public.booking_holds_seat(text)',
    'public.approach_threshold_meters()'
  ]
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;

-- Trigger-only: the guards and the fan-out. A SECURITY DEFINER function the
-- browser can call directly is an escalation path, so these are never granted.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.enforce_ride_status_transition()',
    'public.enforce_booking_status_transition()',
    'public.cascade_ride_cancellation()',
    'public.finalize_ride_completion()',
    'public.guard_payment_insert()',
    'public.guard_payment_transition()',
    'public.apply_payment_outcome()',
    'public.guard_ride_location()',
    'public.guard_ride_vehicle_ownership()',
    'public.release_refund_for_closed_booking()',
    'public.notify_driver_approaching()',
    'public.notify_ride_lifecycle()',
    'public.notify_booking_journey()'
  ]
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
  end loop;
end
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'ride_series',
    'ride_locations',
    'payments',
    'profile_payment_details'
  ]
  loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = tbl) then
      continue;
    end if;
    execute format('alter publication supabase_realtime add table public.%I', tbl);
  end loop;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found; enable Realtime manually for ride_series, ride_locations, payments, profile_payment_details';
end
$$;

