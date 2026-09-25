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
    return coalesce(new, old);
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

  return coalesce(new, old);
end;
$$;

-- A completed ride asks both sides to rate each other.
create or replace function public.notify_ride_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  partner record;
begin
  if tg_op = 'UPDATE' and (new.status <> 'completed' or old.status = 'completed') then
    return new;
  end if;

  for partner in
    select b.rider_id as participant
      from public.bookings b
     where b.ride_id = new.id
       and b.status in ('confirmed', 'completed')
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
  target_user := coalesce(new.reviewee_id, old.reviewee_id);

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

  return coalesce(new, old);
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

drop trigger if exists rides_sync_total_seats on public.rides;
create trigger rides_sync_total_seats
  before update of total_seats on public.rides
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
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;

  if v_secret is null then
    -- Fail quietly: the notification row is already stored and still shows up
    -- in the app, so a missing secret must not break the write that created it.
    raise warning 'push_dispatch_secret is not set in Vault; Web Push delivery skipped';
    return null;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'push_function_url' limit 1;

  if v_url is null or v_url = '' then
    raise warning 'push_function_url is not set in Vault; Web Push delivery skipped';
    return null;
  end if;

  for v_target in
    select distinct on (user_id) user_id::text, title, body, url
      from inserted
     order by user_id, created_at
  loop
    -- net.http_post queues the request and returns immediately, after the
    -- surrounding transaction commits, so a rolled-back notification is never
    -- delivered. Failures are surfaced in the Edge Function logs rather than
    -- here, because raising would roll back the notification row itself.
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object(
        'user_id', v_target.user_id,
        'title', coalesce(v_target.title, 'RideTogether'),
        'body', coalesce(v_target.body, ''),
        'url', coalesce(v_target.url, '/notifications')
      ),
      timeout_milliseconds := 5000
    );
  end loop;

  return null;
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

drop policy if exists bookings_insert_own on public.bookings;
create policy bookings_insert_own
  on public.bookings for insert to authenticated with check (rider_id = auth.uid());

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
    'public.dispatch_push_for_notifications()'
  ]
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
  end loop;
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

