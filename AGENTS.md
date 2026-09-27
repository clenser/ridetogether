# RideTogether Agent Instructions

RideTogether is a production-oriented carpooling application. Work on the existing
architecture. Do not replace working systems with simplified demo implementations.

## 1. Core Stack

- React 19
- TypeScript
- Vite
- React Router
- Supabase Auth
- Supabase Postgres
- Supabase Realtime
- Supabase Storage
- Supabase Edge Functions
- MapLibre GL JS
- OpenFreeMap Liberty
- Valhalla routing
- Lucide React
- Capacitor Android
- PWA / Service Worker
- Playwright E2E tests

Do NOT introduce:

- Firebase
- IndexedDB as the application database
- Leaflet
- Google Maps
- fake maps
- fake routes
- public Nominatim autocomplete
- a second routing implementation
- a second authentication system
- a second database layer

IndexedDB/localStorage may only be used for appropriate client-side concerns such
as drafts, preferences, cached UI state, or PWA behavior. Persistent application
data belongs in Supabase.

---

# 2. Architecture Rules

The application follows this general architecture:

UI
→ React pages/components
→ AppContext/hooks
→ services
→ repositories
→ Supabase

Keep business logic out of page components whenever it belongs in a service or
repository.

Use the existing repository/service architecture instead of querying Supabase
directly from pages.

Important existing services include:

- authentication
- routing
- matching
- pickup/drop-off calculation
- fare calculation
- payments
- push notifications
- PWA
- theme
- drafts
- journey parameters
- native Android authentication

Important repositories include:

- rides
- bookings
- profiles
- vehicles
- payments
- notifications
- messages/chat
- ride series

Before creating a new service or repository, check whether an existing one already
handles the same responsibility.

Do not duplicate:

- location search
- routing
- matching
- map rendering
- authentication
- theme handling
- notification handling
- Supabase access

---

# 3. Database Authority

Supabase Postgres is authoritative for application state.

Do not implement frontend-only versions of database state machines.

The database controls important lifecycle and integrity rules including:

- ride status
- booking status
- seat accounting
- booking transitions
- permissions
- ownership
- payment state
- ride completion
- cancellation rules

Frontend code should request the appropriate repository operation and display the
result.

Do not bypass database constraints simply to make a UI action appear to work.

If a database transition rejects an operation:

1. inspect the repository/service error handling,
2. understand the actual database rule,
3. fix the correct layer,
4. do not weaken the database constraint.

---

# 4. Authentication

Authentication uses Supabase Auth.

Supported flows include:

- email/password
- Google OAuth
- password recovery
- profile completion
- Android native OAuth callback

Do not create alternative authentication state.

Use the existing:

- AuthContext
- AuthGuards
- nativeAuth service
- Supabase client
- profile repository

Android OAuth uses the application's native callback/deep-link flow.

Do not replace the existing Android callback mechanism with localhost redirects.

---

# 5. User Profiles

Profiles are stored in Supabase.

Do not create fake users in production application state.

Demo/test data must remain clearly separated from real authenticated data.

The application currently supports profile information such as:

- name
- avatar
- bio
- phone/contact information where appropriate
- role
- rating
- trip count

Private payment information such as a user's UPI identifier must remain private
and must never be exposed through public profile queries.

---

# 6. Vehicles

Vehicles belong to authenticated users.

Users can:

- add vehicles
- edit their vehicles
- delete eligible vehicles
- select a default vehicle

Never allow one user to modify another user's vehicle.

Vehicle ownership must be enforced by Supabase as well as the frontend.

Do not put vehicle ownership logic only in the UI.

---

# 7. Maps

Use:

- MapLibre GL JS
- OpenFreeMap Liberty

The map must use real map tiles and real coordinates.

Support:

- zoom
- pan
- origin marker
- destination marker
- waypoint markers
- route geometry
- route fitting
- pickup/drop-off visualization
- live driver location where applicable

Do not add:

- fake map backgrounds
- decorative fake routes
- debug markers
- unnecessary plus markers
- permanent development markers

Always clean up MapLibre instances when components unmount.

If routing fails:

- keep the map visible,
- show an honest error/state,
- do not draw a fake route.

---

# 8. Location Search

Use the existing reusable location search component.

Do not create page-specific location search implementations.

Location results must provide:

- latitude
- longitude
- human-readable label

Autocomplete must use the application's configured geocoding/search provider.

Do NOT use public Nominatim autocomplete.

Location search is used by:

- Home
- Find Ride
- Offer Ride
- Add Stop
- pickup/drop-off workflows where applicable

---

# 9. Routing

Use Valhalla through the existing routing service.

Routes must support:

- origin
- destination
- waypoints

Route results provide:

- geometry
- distance
- duration

Persist the actual calculated route geometry when publishing a ride.

Never silently replace failed road routing with:

- straight-line geometry
- haversine distance presented as route distance
- fake route geometry

If routing cannot be calculated, explain the failure to the user.

---

# 10. Fare Rules

The current fare system is based on the application's fare service.

Default base contribution is approximately:

`₹9/km`

The user-facing contribution may be adjusted within the application's configured
allowed range.

Do not hard-code fare logic inside pages.

Use the existing fare service and repository/database validation.

The database remains authoritative for fare validation.

Do not implement real payment processing yet.

Payment functionality is currently a placeholder workflow.

Never claim that real money was transferred when only the placeholder payment flow
was used.

---

# 11. Find Ride

Find Ride must support:

- origin
- destination
- date
- time
- seats

The search workflow should:

1. query eligible rides from Supabase,
2. filter by date/seats/state,
3. evaluate route compatibility,
4. calculate pickup/drop-off candidates,
5. measure detours when required,
6. rank compatible rides,
7. show the relevant route and ride information.

The existing matching service is authoritative for route matching behavior.

Do NOT replace route matching with simple:

`distance(origin1, origin2) < X`

logic.

The existing matching system considers:

- route corridor
- pickup proximity
- drop-off proximity
- route direction/order
- shared route overlap
- detour
- departure time
- available seats

Keep the matching logic explainable.

A match score must not be presented as a probability.

---

# 12. Pickup and Drop-off

Pickup/drop-off points must correspond to locations the driver can reasonably
reach on their route.

Use the existing pickup service.

The system should consider:

- route corridor
- walking distance
- driver detour
- route order
- pickup feasibility
- drop-off feasibility

Do not create arbitrary pickup points without route validation.

Store the agreed pickup/drop-off information with the booking where appropriate.

---

# 13. Offer Ride

Offer Ride supports:

- origin
- destination
- stops/waypoints
- date
- time
- seats
- contribution
- vehicle
- recurring rides

The workflow is:

1. select locations,
2. calculate real Valhalla route,
3. review route/distance/duration,
4. calculate fare,
5. choose vehicle,
6. configure seats,
7. optionally configure recurring rides,
8. review,
9. publish.

Do not publish a ride without a valid route distance/duration.

Persist route geometry.

Do not calculate route geometry separately from the existing routing service.

---

# 14. Ride Lifecycle

The authoritative ride lifecycle is:

`upcoming`
→ `in_progress`
→ `completed`

or:

`upcoming`
→ `cancelled`

The frontend may use different presentation labels such as "Active",
"On the way", etc., but must map them correctly to the database states.

Use existing ride repository operations:

- start ride
- complete ride
- cancel ride

Do not directly update ride status from arbitrary UI code.

Only the driver/host may perform driver-controlled lifecycle operations.

---

# 15. Booking Lifecycle

The authoritative booking lifecycle includes:

`pending`
→ `payment_pending`
→ `confirmed`
→ `picked_up`
→ `completed`

and terminal states such as:

- rejected
- cancelled
- no_show

Seat accounting is database-controlled.

Important rule:

Accepting a booking moves it into the payment-pending stage and holds the seat.

Do not bypass this by directly changing a booking to `confirmed`.

Use named repository operations such as:

- request booking
- accept booking
- reject booking
- cancel booking
- mark picked up
- mark no-show
- resolve payment
- complete booking through ride lifecycle

Do not introduce a generic unrestricted:

`setBookingStatus(id, arbitraryStatus)`

helper.

---

# 16. Payments

Payment is currently a placeholder.

The application must clearly distinguish:

- payment opened
- payment pending
- payment confirmed/received

from actual financial settlement.

No real gateway should be introduced unless explicitly requested.

Do not claim a successful financial transaction without an actual payment
provider response.

Keep payment logic isolated so a future gateway can replace the placeholder
without rewriting booking logic.

---

# 17. Chat

Chat is ride-scoped.

Only users who are legitimately associated with the ride may access its chat.

Use the existing chat/message repository and realtime infrastructure.

Chat must support:

- conversation list
- ride-specific conversation
- message persistence
- realtime updates
- unread state
- mobile layout
- desktop split-view layout

Do not expose historical ride chat to unrelated users.

---

# 18. Notifications

Notifications are stored in Supabase.

Notification types include events such as:

- booking request
- booking acceptance
- booking confirmation
- booking rejection
- booking cancellation
- ride cancellation
- ride start
- ride reminder
- driver approaching
- payment state
- messages
- rating requests
- ride completion

Use the existing notification infrastructure.

Web Push uses the existing VAPID/Supabase Edge Function implementation.

Do not create a second notification transport.

Notification delivery failure must not cause the primary booking/ride transaction
to fail.

---

# 19. Realtime

Use Supabase Realtime for live application updates where already implemented.

Realtime subscriptions must:

- be cleaned up correctly,
- avoid duplicate subscriptions,
- avoid unnecessary channels,
- update the correct user's data,
- not leak listeners after navigation.

If realtime is unavailable, do not invent fake live state.

Where appropriate, provide a controlled refresh/fallback strategy.

---

# 20. Live Ride Tracking

Live ride tracking is limited to participants who are authorized for the ride.

Driver location must:

- be associated with the active ride,
- update through the existing location service,
- be scoped to authorized participants,
- become stale when updates stop,
- not be presented as current when it is stale.

Do not continually refit the map viewport on every GPS update.

---

# 21. PWA

The application supports PWA behavior.

Maintain:

- service worker
- install prompt
- standalone layout behavior
- push notification support where supported
- responsive mobile navigation

Do not break browser functionality while optimizing the PWA.

---

# 22. Android / Capacitor

Android uses Capacitor with the existing React application.

Do NOT rewrite the application as native Kotlin.

Maintain:

- Capacitor configuration
- Android project
- native OAuth callback
- deep links
- push architecture as currently implemented
- mobile viewport behavior

Production Android OAuth callback must not fall back to localhost.

When changing native configuration, verify both:

1. browser/PWA authentication
2. Android authentication

---

# 23. UI / Design System

RideTogether uses a polished green/white carpooling visual language.

Primary brand green:

`#159447`

Design characteristics:

- clean typography
- rounded cards
- subtle borders
- restrained shadows
- green accents
- clear hierarchy
- responsive layouts
- polished hover/press states
- smooth but restrained animations

Both themes are first-class:

- light
- dark

Do not design dark mode as an afterthought.

Every component must remain readable and visually coherent in both themes.

Prefer shared design tokens and reusable components.

Avoid adding another large page-specific CSS system when an existing component
or design token can solve the problem.

---

# 24. Responsive Design

The application must work across:

- large desktop
- laptop
- tablet
- mobile
- installed PWA
- Android

Important approximate breakpoints to test:

- 1440px
- 1280px
- 1024px
- 768px
- 480px
- 390px
- 360px

Do not simply shrink desktop layouts onto mobile.

Mobile layouts may require:

- stacked cards
- bottom navigation
- mobile sheets
- simplified headers
- full-width actions
- compact metadata
- separate mobile chat navigation
- touch-friendly controls

No content should be hidden simply to make a layout fit unless there is an
intentional mobile UX replacement.

---

# 25. Navigation

Main application navigation includes:

- Home
- Find Ride
- Offer Ride
- My Rides
- My Bookings
- Chat
- Notifications
- Profile
- Vehicles
- Safety
- Settings

Desktop uses the application shell/sidebar.

Mobile uses the responsive mobile navigation.

Keep navigation state consistent with the current route.

Avoid duplicate navigation implementations.

---

# 26. Loading / Error / Empty States

Every asynchronous workflow should have an appropriate:

- loading state
- success state
- empty state
- actionable error state

Do not show generic error banners when the affected data is optional.

Do not claim that data is stale unless the application actually knows that the
data failed to refresh.

Errors should explain what the user can do next where possible.

Never leave a spinner running indefinitely.

---

# 27. Draft Persistence

The application supports persisted drafts for appropriate workflows.

Drafts may be stored locally.

Use the existing draft service.

Relevant workflows include:

- Offer Ride
- Find Ride
- Vehicle forms
- Chat composer
- other explicitly supported forms

Do not create ad-hoc localStorage draft implementations.

---

# 28. Accessibility

Maintain:

- semantic HTML
- accessible labels
- keyboard navigation
- visible focus states
- appropriate button semantics
- dialog accessibility
- sufficient text/background contrast
- screen-reader-friendly status updates

Do not use clickable `<div>` elements where a button or link is appropriate.

Icons that are purely decorative should not create unnecessary screen-reader noise.

---

# 29. Security

Never expose:

- Supabase service-role keys
- VAPID private keys
- push dispatch secrets
- private payment information
- private user information

Only public client-safe environment variables may be exposed to the frontend.

Do not weaken RLS policies to make frontend functionality work.

If an RLS policy appears incorrect, fix the policy deliberately and verify the
security implications.

---

# 30. Code Quality

Use strict TypeScript.

Do not use:

- `@ts-ignore`
- `any` as a quick fix
- duplicated business logic
- duplicated map/routing implementations
- arbitrary database writes from pages
- silent fallback behavior that hides failures

Prefer:

- typed services
- typed repositories
- reusable components
- small focused functions
- explicit state transitions
- existing utilities

Do not rewrite working architecture merely for stylistic reasons.

---

# 31. Agent Workflow

When working on the repository:

1. Inspect the relevant existing implementation.
2. Identify the smallest correct change.
3. Change only the required files.
4. Run the relevant build/type checks.
5. Run the relevant E2E test if one exists.
6. Report what changed and what was verified.

Do not perform broad audits unless explicitly requested.

Do not rewrite unrelated files.

Do not refactor large sections while fixing a small bug.

Do not create temporary diagnostic files unless necessary.

Do not start development servers unless the task specifically requires them.

Do not run indefinitely.

If investigation becomes blocked or ambiguous:

- stop after a reasonable attempt,
- report what was checked,
- explain the blocker,
- do not repeatedly retry the same approach.

---

# 32. Testing

At minimum, after meaningful code changes run:

`npm run build`

When database schema changes are involved:

`npm run check:schema`

When relevant, run targeted Playwright tests.

Existing E2E coverage includes areas such as:

- boot
- session continuity
- driver rides
- bookings
- drafts
- chat routes
- push
- PWA
- realtime
- loading UX
- theme tokens

Do not modify tests merely to make failing behavior disappear.

Fix the underlying implementation unless the test itself is demonstrably obsolete.

---

# 33. Before Modifying Existing Systems

Before changing:

- authentication
- Supabase repositories
- database schema
- booking lifecycle
- ride lifecycle
- matching
- routing
- push notifications
- Android OAuth

inspect the existing implementation and its tests first.

These systems already contain significant production logic.

Do not replace them with simplified implementations.

---

# 34. Git Discipline

Do not commit or push unless explicitly requested by the user.

When asked to commit:

1. inspect `git status`,
2. inspect the diff,
3. run the relevant checks,
4. stage only intended files,
5. create a focused commit,
6. push only when explicitly requested.

Do not include unrelated files in a commit.

---

# 35. Current Product Direction

RideTogether is moving from private beta toward a commercially usable carpooling
platform.

The target experience is:

Driver:

`Offer Ride`
→ choose route
→ calculate real road route
→ schedule trip
→ choose vehicle/seats/contribution
→ publish
→ receive booking request
→ accept
→ payment placeholder
→ confirm passenger
→ chat
→ start ride
→ live location
→ pickup
→ destination
→ complete ride
→ rating

Rider:

`Find Ride`
→ choose origin/destination
→ choose date/time/seats
→ route-compatible matches
→ inspect driver/route/pickup/detour/contribution
→ request seat
→ host accepts
→ payment placeholder
→ booking confirmed
→ chat
→ receive departure/approach notifications
→ follow live trip
→ pickup
→ destination
→ rating

Preserve this workflow when modifying the application.

---

# 36. Most Important Rule

Do not simplify RideTogether back into a demo application.

The current repository already contains real:

- Supabase persistence
- authentication
- RLS
- route calculation
- route geometry
- corridor matching
- pickup/drop-off logic
- booking state management
- seat accounting
- payment placeholder
- realtime
- push notifications
- live tracking
- PWA
- Android integration

Build on these systems.

If a requested change can be implemented by improving an existing service,
repository, component, or design token, do that instead of creating a parallel
system.