# RideTogether

Build RideTogether as a polished responsive carpooling web app.

## Stack
- React
- TypeScript
- Vite
- React Router
- IndexedDB
- MapLibre GL JS
- OpenFreeMap Liberty map
- Valhalla routing
- Lucide icons

Do NOT use:
- Android/Kotlin
- Firebase
- Leaflet
- WebView maps
- Google Maps
- fake maps
- fake routes
- public Nominatim autocomplete

## UI

Use a modern green/white carpooling design.

Primary green: #159447

Use:
- rounded cards
- clean typography
- subtle borders
- subtle shadows
- consistent spacing
- responsive desktop/mobile layout

Keep the UI polished and consistent.

## Main Pages

Implement:

- Home
- Find Ride
- Offer Ride
- My Rides
- My Bookings
- Ride Details
- Chat
- Notifications
- Profile
- Vehicles
- Safety
- Settings

Use React Router.

## Users

Create demo users:

Rahul Sharma
Sreemanta Barman
Ananya Das

Add a demo user switcher.

Persist the active user.

Changing users must update all user-specific data.

## Database

Use IndexedDB.

Store:

- users
- vehicles
- rides
- bookings
- messages
- notifications
- ratings
- safety contacts

Seed demo data only on first launch.

## Map

Use MapLibre GL JS.

Use OpenFreeMap Liberty:

https://tiles.openfreemap.org/styles/liberty

The map must show real streets and places.

It must support:

- zoom
- pan
- origin marker
- destination marker
- waypoint markers
- route line
- fit route to viewport

Do not show useless + markers or debug markers.

Map must remain visible even if routing fails.

Clean up MapLibre instances when components unmount.

## Location Search

Create one reusable location search component.

Use autocomplete with debounce.

Return:

lat
lon
label

Use the same location search in:

- Find Ride
- Offer Ride
- Add Stop

Do not use public Nominatim autocomplete.

## Routing

Use Valhalla.

Support:

Origin
Destination
Waypoints

Return:

- route geometry
- distance
- duration

Never create fake routes when routing fails.

Show a proper error instead.

## Find Ride

Allow:

- From
- To
- Date
- Time
- Seats

Show the actual route on the map.

Search locally stored rides.

Match rides using:

- date
- available seats
- origin proximity
- destination proximity
- route compatibility

Show:

- driver
- rating
- route
- departure
- seats
- contribution
- vehicle
- distance
- duration

## Offer Ride

Allow:

- From
- To
- Add Stop
- Date
- Time
- Seats
- Contribution
- Vehicle

Use the SAME location search and routing system as Find Ride.

Show the real route.

Allow stops to be added and removed.

Publish the ride into IndexedDB.

The newly published ride must be visible to other demo users.

## Bookings

Rider can request a seat.

Booking starts as:

Pending

Driver can:

- Confirm
- Reject

When confirmed:

- decrease available seats

Prevent overbooking.

Support cancellation and seat restoration.

## My Rides

Show rides created by the current user.

Allow:

- view
- manage requests
- confirm
- reject
- cancel
- complete

## My Bookings

Show bookings belonging to the current user.

## Chat

Implement local ride-based chat.

Persist messages.

## Notifications

Create notifications for:

- booking requests
- booking confirmation
- booking rejection
- ride cancellation
- messages
- rating requests

Persist notifications.

## Ratings

After completed rides:

- 1-5 star rating
- optional comment

Prevent duplicate ratings.

## Vehicles

Users can:

- add
- edit
- delete
- select vehicles

Users can only manage their own vehicles.

## Profile

Show:

- name
- avatar
- contact information
- role
- rating
- trip count
- vehicles
- safety

Persist profile changes.

## Safety

Implement:

- emergency contacts
- add/edit/delete contacts
- safety information
- SOS demo interface

Do not claim that the demo actually contacts emergency services.

## Settings

Implement:

- notifications
- appearance
- privacy
- help
- about

Avoid dead buttons.

## Code Quality

Use reusable components.

Do not create one giant component.

Keep business logic in services/repositories instead of UI components.

Use strict TypeScript.

Do not use @ts-ignore as a quick fix.

Do not duplicate location, routing or map implementations.

## Important

This is an implementation task.

Do not only create a plan.

Actually build the application.

Run:

npm install
npm run build

Fix all errors.

The final application must be runnable.