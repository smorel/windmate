# Session Lift Share — Design Spec

**Date:** 2026-09-09  
**Status:** Draft  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Depends on:** [Session Watchlist](./2026-09-08-session-watchlist-design.md), [Departure Planner](./2026-09-09-departure-planner-design.md)  
**Prerequisite:** Optional accounts with secure login when using **cloud sync**, **email notifications**, or **lift share** (see [Accounts, login & security](#accounts-login--security))

## Goal

When a user is **watching a planned session** (spot + date) and needs a ride, connect them with **other users watching the same session** who are **nearby** and have opted in to **offer a lift**. Drivers see open requests for that session; the first accept wins. Windmate sends both parties each other's **email addresses** so they can arrange pickup details themselves. Once matched, the request **disappears** from every other driver's list.

Windmate is a **matchmaker**, not a ride-hailing platform — no in-app chat, GPS tracking, or payment in v1.

## User stories

> "I'm watching Lac Saint-Louis for Thursday wingfoil but my car's in the shop. I tap **Need a lift** — Windmate shows my request to other watchers on the same day who said they're OK sharing a ride and live near me. Alex accepts; we both get an email with each other's addresses and we sort out pickup on WhatsApp."

> "I use Windmate without logging in for daily forecasts. Thursday I need a lift to Lac Saint-Louis — I create an account, my starred session syncs to the cloud, and nearby drivers watching the same day can accept."

> "I'm driving to Hudson Saturday anyway and have a spare seat. In settings I turn on **Offer lifts for watched sessions**. When someone nearby also watching Hudson Saturday asks for a lift, I see them in my list, accept, and we get connected by email."

> "Two people offered lifts on my session. Marie accepts first — her request disappears from the other driver's inbox so nobody double-books."

## Scope

### In scope (v1 — session-scoped matching)

- **Optional secure login** — only when user opts into cloud sync, email notifications, or lift share (see [Accounts, login & security](#accounts-login--security))
- **Driver opt-in** in settings: `offer_lift_for_watched_sessions`
- **Lift request** tied to one `watched_session` row (spot + date the requester is watching)
- **Matching pool:** users who (1) watch the **same** `spot_id` + `session_date`, (2) have driver opt-in on, (3) are within **lift radius** of the requester
- **Driver inbox** per watched session — list of open lift requests visible only to eligible drivers
- **First accept wins** — atomic match; request status → `matched`; hidden from other drivers
- **Email introduction** to requester + matched driver with both contact emails
- **Requester cancel** while `open`
- **Auto-expire** open requests when `session_date` passes (same purge window as watchlist)
- **Mate-tone copy** for empty states, match confirmation, and safety reminder

### In scope (v2 — richer context)

- Optional **pickup note** on request ("Verdun metro", "Can do 13:30")
- Show **approximate distance band** on driver list (`~8 km`, not exact address)
- **Departure alignment hint** — compare requester's leave-by vs driver's leave-by from [Departure Planner](./2026-09-09-departure-planner-design.md) when both have home coords
- Email to drivers when a **new nearby request** arrives (opt-in)
- Requester marks match **done** / driver marks **cancelled after contact** (cleanup only; no re-open)

### Out of scope

- OAuth / social login (Google, Apple) — v2 candidate only
- SMS or phone-based contact
- Real-time GPS tracking or live map of drivers
- Payments, insurance, or liability handling
- Lifts for **non-watched** sessions (planner browse only — no watchlist row)
- Public lift board across all spots (requests are **session-scoped** only)
- Rating / reputation system
- Guaranteed seat count or vehicle type verification

## Accounts, login & security

**Login is optional.** Windmate stays fully usable **without an account** — forecasts, rideability matrix, horizon planner, and **local** watchlist + settings (same device / anonymous single-user mode as today).

An account is required **only** when the user chooses one of:

| Opt-in feature | Why login |
|---|---|
| **Email notifications** | Verified address to receive watchlist digests, horizon sport alerts, session-day heads-ups |
| **Lift share** | Same verified email for contact intro; server must see who watches the same session |
| **Cloud sync** | Persist watchlist + sport profiles + preferences on the server; restore on another device |

Users who never sign up never see forced login walls on browse/planner flows. **In-app** watchlist pins and UI alerts work locally without an account; **server-sent email** does not.

### Local vs cloud data

| Data | Local (no account) | Cloud (signed in) |
|---|---|---|
| Sport profiles & prefs | Anonymous `user_preferences` row or browser storage | Per-user rows keyed by `user_id` |
| Watched sessions | Browser `localStorage` — UI pins only, **not visible to other users** | Server `watched_sessions` with `user_id` — eligible for lift matching |
| Lift share | Unavailable | Requires verified email + **cloud** watchlist row |
| Email notifications | Off (no SMTP to anonymous user) | Watchlist digest, horizon alerts → user's **verified** email |
| Self-host dev | Env `ALERT_EMAIL_TO` may still target one operator inbox — not a product path for hosted multi-user |

**Lift share rule:** a lift request must reference a **cloud** `watched_sessions` row (`user_id` set). Local-only stars must be **promoted** to cloud on signup or when user taps **Need a lift** (prompt account + one-time merge).

Hosted lift matching runs on the **shared server** (HTTPS). Self-hosted single-user installs can skip auth entirely if lift share is disabled.

### Registration & login (v1)

| Flow | Behaviour |
|---|---|
| **Register** | Email, password, optional display name → account created **unverified**; verification email sent; optional **import local watchlist + prefs** |
| **Verify email** | One-time token link (24 h TTL) → `email_verified_at` set; required before **any outbound notification**, lift request, or driver opt-in |
| **Login** | Email + password → server session (see below) |
| **Logout** | Invalidate server session + clear cookie; **local** prefs/watchlist remain on device unless user chose cloud-only |
| **Forgot password** | Email reset link (1 h TTL, single use) → set new password |

**Unverified users** who signed up for cloud sync may use cloud APIs read/write with a banner, but **cannot** receive notification emails, create lift requests, opt in as driver, or appear in matching pools until verified.

**Anonymous users** use existing `/api/preferences` and local watchlist paths with no session cookie.

### Password policy

| Rule | Value |
|---|---|
| Minimum length | **12** characters |
| Complexity | At least one letter and one number (no forced special char — NIST-aligned) |
| Blocklist | Reject top ~10k breached/common passwords (e.g. `zxcvbn` score or HIBP k-anonymity prefix check on register/reset) |
| Storage | **Never** plaintext; **Argon2id** preferred (memory-hard), **bcrypt** (cost ≥ 12) acceptable fallback |
| Pepper | Optional server-side `AUTH_PASSWORD_PEPPER` env secret mixed before hash |

Use a well-maintained library (`argon2`, `@node-rs/argon2`, or `bcrypt`) — do not roll custom crypto.

### Sessions

| Setting | Recommendation |
|---|---|
| Transport | **HTTPS only** in production; `Secure` cookies |
| Cookie | `httpOnly`, `SameSite=Lax` (or `Strict` if no cross-site needs), name e.g. `windmate_session` |
| Server store | `user_sessions` table: session id (random 256-bit), `user_id`, `expires_at`, `created_at`, `ip_hash`, `user_agent_hash` |
| TTL | **14 days** sliding window; refresh `expires_at` on authenticated activity |
| Rotation | New session id on login; invalidate all sessions on password change |
| Alternative | Signed JWT in httpOnly cookie with server-side denylist for logout — only if session table is undesirable; **prefer server-side sessions** for easier revocation |

**No JWT in `localStorage`** — XSS would steal tokens and lift/contact data.

### Encryption & data protection

| Layer | Approach |
|---|---|
| **In transit** | TLS 1.2+ everywhere; HSTS on production host |
| **Passwords** | One-way hash only (Argon2id/bcrypt); never encrypt/decrypt |
| **Email (at rest)** | Stored plaintext in DB **behind app auth** — required for SMTP intro emails and login lookup. Protect with DB access controls + **encryption at rest** on the host volume (or SQLCipher / PostgreSQL TDE if using managed DB). Optional v2: envelope encryption for `users.email` with `AUTH_DATA_KEY` — only if compliance requires; adds key-management ops |
| **Session tokens** | Random opaque ids in DB, not reversible secrets |
| **Reset / verify tokens** | Store **SHA-256 hash** of token only; raw token sent once in email link |
| **Logs** | Never log passwords, reset tokens, or full session ids; redact email in debug logs where possible |
| **Backups** | Same at-rest protection as primary DB; restrict access |

### Authorization

| Route group | Anonymous (local) | Authenticated (cloud) | Lift share |
|---|---|---|---|
| `/api/forecast`, `/api/rideability`, `/api/observations` | ✅ | ✅ | — |
| `/api/preferences` (read/write) | ✅ anonymous row | ✅ per-user cloud row | — |
| `/api/watchlist` | ✅ local client storage **or** optional anonymous API | ✅ cloud rows | cloud rows only for matching |
| `/api/lift/*` | ❌ | ❌ until verified | ✅ verified email required |
| Cron email jobs | ❌ skip anonymous | ✅ only `email_verified_at` set | lift intro + user alerts |

- Row-level: cloud users read/write **only their own** prefs, watches, and lift requests.
- Notification cron iterates **verified** cloud users only — never `ALERT_EMAIL_TO` blast in hosted mode.
- Drivers see **open** lift requests for shared sessions only (no email until accept).
- Intro email + `contact` block: requester and matched driver only.

### Abuse prevention

| Control | Default |
|---|---|
| Login rate limit | 5 failures / 15 min per email + IP |
| Register rate limit | 3 / hour per IP |
| Reset / verify email | 3 requests / hour per email |
| Constant-time compare | Password verify and token lookup — avoid timing leaks |
| Account lockout | Optional soft lock after 10 failures (unlock via reset email) |

### Auth API (platform)

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password, displayName? }` → 201; sends verify email |
| POST | `/api/auth/login` | `{ email, password }` → sets session cookie; `403` if email unverified for lift actions (login still ok with banner) |
| POST | `/api/auth/logout` | Clears session |
| GET | `/api/auth/me` | `{ id, email, displayName, emailVerified, ... }` — no password fields |
| POST | `/api/auth/verify-email` | `{ token }` or GET link `?token=` |
| POST | `/api/auth/forgot-password` | `{ email }` — always 200 (no email enumeration) |
| POST | `/api/auth/reset-password` | `{ token, newPassword }` |
| PUT | `/api/auth/password` | Authenticated; `{ currentPassword, newPassword }` → invalidates other sessions |

### UI — auth gates

Login prompts appear **only** on explicit opt-in — never on first visit.

| Trigger | UI |
|---|---|
| **Request lift** | "Sign in or create an account — lift share needs a verified email and cloud watchlist." → register/login → merge local stars → verify email |
| **Offer lifts** toggle | Same gate + verify banner if unverified |
| **Enable email alerts** (master, sport, or watchlist `notify_email`) | "Sign in to get heads-ups by email — we'll verify your address." → register/login → verify |
| **Settings → Save to cloud** | "Sync watchlist and settings across devices" → register/login |
| **Settings → Account** (when signed in) | Change password, verify email, log out, delete account (v2) |

No account section required in settings until user opens cloud/lift options. Header: optional **Sign in** link; when logged in, show display name + **Cloud sync on** indicator.

### Migration: local → cloud

1. User registers or logs in from lift, notification, or cloud-sync prompt.
2. Client POST `/api/sync/import` (or register body flag) uploads local watchlist + prefs snapshot.
3. Server merges into `user_id` rows; client clears duplicate local keys or marks `storageMode: cloud`.
4. Lift actions use cloud `watched_session_id` only.

Existing anonymous `user_preferences` (id=1) remains for non-account users; cloud users get new rows — no forced migration of the whole install.

**Hard dependency:** [Session Watchlist v1](./2026-09-08-session-watchlist-design.md) with **local + cloud** storage modes before lift share.

Storage: PostgreSQL recommended for concurrent lift accepts + multi-user cloud data; SQLite acceptable for early prototype with WAL on a single host.

## Concepts

| Term | Meaning |
|---|---|
| **Watched session (cloud)** | User's pinned spot + date on server (`watched_sessions.user_id`) — required for lift matching |
| **Watched session (local)** | Same UX, stored on device only — invisible to lift pool |
| **Driver** | User with `offer_lift_for_watched_sessions = 1` who watches the same session |
| **Requester** | User watching the session who created an open lift request |
| **Lift request** | One row: requester needs a ride for a specific watched session |
| **Match** | Driver accepted; both emails exchanged; request no longer visible to others |
| **Nearby** | Haversine distance between requester and driver **home/pickup coords** ≤ `lift_radius_km` |

### Request lifecycle

```
                    ┌─────────────┐
     create         │    open     │◄── cancel (requester)
  ───────────────►  │  (visible   │
                    │  to drivers)│
                    └──────┬──────┘
                           │ first driver accept (atomic)
                           ▼
                    ┌─────────────┐
                    │   matched   │──► intro emails sent
                    │ (hidden from│──► optional: mark done (v2)
                    │ other drivers)│
                    └──────┬──────┘
                           │ session_date < today (purge job)
                           ▼
                    ┌─────────────┐
                    │   expired   │
                    └─────────────┘
```

**Rules:**

- At most **one open request** per `(user_id, watched_session_id)`.
- At most **one matched request** per watched session per requester (re-request only after cancel or expire).
- Accept is **idempotent** for the winning driver; concurrent accepts → one wins (DB transaction / unique partial index on `matched_driver_id` where status = matched).
- Drivers **cannot** accept their own request.

## Matching rules

A lift request is visible to driver **D** when **all** hold:

1. **D** watches the same `spot_id` and `session_date` on a **cloud** watchlist row.
2. **D** has `offer_lift_for_watched_sessions = 1`.
3. **D** is not the requester.
4. Request status is `open`.
5. `distance(D.home, R.home) ≤ lift_radius_km` — default **25 km**, overridable in settings (separate from sport search radius).
6. Optional v2: **D** has spare capacity flag `seats_available ≥ 1` (default 1).

**Location source priority:** persisted `home_lat/lng` → last saved browser coords → request-time coords (requester only, for one-off pickup area). Drivers without coords **do not** appear in matching pool and see a settings prompt.

**Privacy on driver list:** show requester **display name** (or email local-part), **distance band** (`~12 km`), optional pickup note — **never** exact lat/lng in list UI.

## Data model

### `users` (new)

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | PK |
| email | TEXT | UNIQUE, normalized lowercase |
| email_verified_at | INTEGER | nullable — Unix ms; required for lift share |
| password_hash | TEXT | Argon2id or bcrypt; never expose via API |
| display_name | TEXT | nullable — e.g. "Alex" |
| home_lat | REAL | nullable |
| home_lng | REAL | nullable |
| home_label | TEXT | nullable |
| failed_login_count | INTEGER | default 0 — abuse tracking |
| locked_until | INTEGER | nullable — Unix ms |
| created_at | INTEGER | Unix ms |
| updated_at | INTEGER | Unix ms |
| last_seen_at | INTEGER | nullable |

### `user_sessions`

| Column | Type | Notes |
|---|---|---|
| id | TEXT | PK — opaque session token (256-bit random, hex) |
| user_id | TEXT | FK → users |
| expires_at | INTEGER | Unix ms |
| created_at | INTEGER | Unix ms |
| ip_hash | TEXT | nullable — SHA-256 of IP for audit |
| user_agent_hash | TEXT | nullable |

Index on `(user_id)`, purge expired rows daily.

### `auth_tokens` (verify email + password reset)

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | PK |
| user_id | TEXT | FK → users |
| type | TEXT | `email_verify` · `password_reset` |
| token_hash | TEXT | SHA-256 of raw token |
| expires_at | INTEGER | Unix ms |
| used_at | INTEGER | nullable — single-use |

Partial unique: one active unused token per `(user_id, type)` optional — or allow multiple with newest wins.

### `user_lift_preferences` (new, 1:1 with user)

| Column | Type | Default | Notes |
|---|---|---|---|
| user_id | TEXT | — | PK, FK → users |
| offer_lift_for_watched_sessions | INTEGER | 0 | Driver opt-in |
| lift_radius_km | INTEGER | 25 | Max distance to see/be seen for lift matching |
| notify_new_lift_request | INTEGER | 1 | Email when nearby open request (v2) |
| seats_available | INTEGER | 1 | v2 — informational only |

### `watched_sessions` extension

| Column | Type | Notes |
|---|---|---|
| user_id | TEXT | FK → users — **required**; cloud watchlist only |
| storage | TEXT | `cloud` — local watches stay client-side, not in this table |

Unique constraint becomes `(user_id, spot_id, session_date)`.

### `lift_requests`

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | PK |
| watched_session_id | TEXT | FK → watched_sessions |
| requester_user_id | TEXT | FK → users |
| spot_id | TEXT | Denormalized for queries |
| session_date | TEXT | ISO `YYYY-MM-DD` |
| status | TEXT | `open` · `matched` · `cancelled` · `expired` |
| pickup_note | TEXT | nullable — v2 |
| requester_lat | REAL | Snapshot at create (fallback if no home) |
| requester_lng | REAL | |
| matched_driver_user_id | TEXT | nullable, FK → users |
| matched_at | INTEGER | nullable — Unix ms |
| created_at | INTEGER | Unix ms |
| updated_at | INTEGER | Unix ms |

Partial unique index: **one** row with `status = 'open'` per `(requester_user_id, watched_session_id)`.

Index for driver inbox: `(spot_id, session_date, status)` + application-side distance filter.

**Lifecycle:** purge job sets `status = 'expired'` (or DELETE) for rows where `session_date < today`, same schedule as [Watchlist expiry](./2026-09-08-session-watchlist-design.md#expiry--purge).

## API

**Lift routes:** authenticated session required (`401` if missing). **Email verified** required for lift create/accept/opt-in (`403` with code `EMAIL_NOT_VERIFIED`).

### Lift routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/lift/preferences` | Current user's lift settings |
| PUT | `/api/lift/preferences` | Body: `{ offerLift?, liftRadiusKm?, notifyNewLiftRequest?, seatsAvailable? }` |
| POST | `/api/lift/requests` | Body: `{ watchedSessionId, pickupNote?, lat?, lng? }` — creates open request |
| GET | `/api/lift/requests/mine` | Requester's requests for active watched sessions |
| DELETE | `/api/lift/requests/:id` | Cancel if `open` and owned by caller |
| GET | `/api/lift/requests/inbox` | Query: `watchedSessionId` — open requests this user can accept as driver |
| POST | `/api/lift/requests/:id/accept` | Driver accept → match + emails; `409` if already matched |
| GET | `/api/lift/requests/:id` | Requester or matched driver only — full detail incl. contact after match |

### Inbox response shape (driver)

```json
{
  "watchedSessionId": "...",
  "spotName": "Lac Saint-Louis",
  "sessionDate": "2026-09-12",
  "requests": [
    {
      "id": "...",
      "requesterDisplayName": "Sam",
      "distanceKm": 8.2,
      "distanceLabel": "~8 km",
      "pickupNote": "Verdun — can leave 12:45",
      "createdAt": "2026-09-10T14:22:00-04:00"
    }
  ]
}
```

### Match response (accept)

```json
{
  "id": "...",
  "status": "matched",
  "matchedAt": "2026-09-10T15:01:00-04:00",
  "contact": {
    "requester": { "displayName": "Sam", "email": "sam@example.com" },
    "driver": { "displayName": "Alex", "email": "alex@example.com" }
  }
}
```

Contact block returned **only** to requester and matched driver.

## UI design

### Settings — Lift share section

```
LIFT SHARE
┌─────────────────────────────────────────────────────────┐
│ [ ] Offer lifts for sessions I'm watching               │
│     Other nearby watchers can send you lift requests.   │
│                                                         │
│ Lift matching radius          [ 25 km ▼ ]             │
│ Home / pickup area            Verdun  [ Change ]      │
│ (uses same home as departure planner when set)          │
└─────────────────────────────────────────────────────────┘
```

When driver opt-in off, hide driver inbox entry points.

### Watched session card — requester

On a watched session row (planner pin or session-day panel):

```
Thu 12 Sep · Lac Saint-Louis · wingfoil
...
🚗 Need a lift?  [ Request lift ]
```

States:

| State | UI |
|---|---|
| No request | Button **Request lift** |
| Open | "Waiting for a driver — 2 nearby offers enabled" + **Cancel request** |
| Matched | "Matched with Alex — check your email" + contact reminder |
| No drivers nearby | "No one nearby offering lifts yet — we'll show your request when someone opts in" |

**Need a lift** requires a **cloud** watch on that spot+date. Local-only star → signup/sync prompt first.

### Settings — Cloud sync (optional, no lift)

```
SYNC
┌─────────────────────────────────────────────────────────┐
│ Save watchlist & settings to the cloud                  │
│ Use the same setup on your phone and laptop.            │
│                              [ Sign in / Create account ]│
└─────────────────────────────────────────────────────────┘
```

When signed in: "Cloud sync on · last synced 2 min ago" + **Sign out** (local copy retained on device).

### Driver inbox — watched session

Badge on watched session when `offer_lift = 1` and inbox count > 0:

```
★ WATCHING · Lac Saint-Louis · Thu 12 Sep     [ Lifts (2) ]
```

Inbox drawer:

```
LIFT REQUESTS — Lac Saint-Louis · Thu 12 Sep
┌─────────────────────────────────────────────────────────┐
│ Sam · ~8 km away                                          │
│ "Verdun — can leave 12:45"                                │
│                              [ Accept lift ]              │
├─────────────────────────────────────────────────────────┤
│ Jo · ~15 km                                               │
│                              [ Accept lift ]              │
└─────────────────────────────────────────────────────────┘
```

After accept, row removed for all other drivers on next poll. Accepting driver sees confirmation + email sent copy.

### Mate-tone copy (`copy.js`)

- `lift.requestCreated`: "Request sent mate — nearby drivers watching this session can accept."
- `lift.matched`: "You're matched with {name}. Check your email — sort out pickup between you."
- `lift.noDrivers`: "Nobody nearby offering lifts for this session yet."
- `lift.alreadyMatched`: "Someone already accepted this one."
- `lift.safety`: "Windmate only connects you by email — agree pickup details yourselves and stay safe."

## Email

### Introduction (on match)

**To:** requester + driver  
**Subject:** `Mate — lift sorted for Lac Saint-Louis Thu 12 Sep`

```
Hey mate — you're connected for a lift to Lac Saint-Louis on Thu 12 Sep.

Sam (requester): sam@example.com
Alex (driver): alex@example.com

Pickup note from Sam: "Verdun — can leave 12:45"

Sort out time and place between you. Windmate doesn't track the ride — just the intro.

[ Open session in Windmate ]
```

### New request notify (v2, driver opt-in)

**Subject:** `Mate — someone near you needs a lift to Lac Saint-Louis Thu`

One email per new open request within radius; throttle max **3 per session per day** per driver.

Uses existing SMTP config (`ALERT_EMAIL_FROM`, etc.).

## Privacy and safety

- **Login optional** for core app; **required** only for lift share and cloud sync.
- **Login required** for all lift share actions; verified email required before sharing contact info.
- Emails shared **only after** explicit driver accept.
- No phone numbers stored or shared by Windmate v1.
- Display name optional; email always used for intro.
- Users can cancel open requests anytime; matched users arrange offline.
- Short **safety footer** in intro email: arrange in a public place, confirm identity by email name, Windmate not liable for rides.
- **Block/report** — out of scope v1; document support contact in footer.
- Password reset and verify links expire quickly; invalidate all sessions on password change.

## Integration

| Feature | Behavior |
|---|---|
| [Session Watchlist](./2026-09-08-session-watchlist-design.md) | Cloud watchlist + `notify_email`; digest cron requires verified account; lift requests FK to `watched_sessions`; purge aligned |
| [Departure Planner](./2026-09-09-departure-planner-design.md) | Shared `home_lat/lng`; v2 leave-by alignment hint on inbox rows |
| [Per-Sport Preferences & Alerts](./2026-09-09-per-sport-preferences-alerts-design.md) | Horizon digest requires verified account; watchlist row stores `sport` for lift UI |
| Go/no-go (session day) | Optional banner: "Conditions look off — still need that lift?" (v2, non-blocking) |

## Services (planned)

| File | Responsibility |
|---|---|
| `src/services/auth.js` | Register, login, password hash/verify, session CRUD |
| `src/services/authTokens.js` | Verify + reset token issue/validate |
| `src/middleware/requireAuth.js` | Session lookup, attach `req.user` |
| `src/middleware/requireVerifiedEmail.js` | Block lift routes if unverified |
| `src/services/liftMatching.js` | Eligible drivers, distance filter, inbox assembly |
| `src/services/liftMatch.js` | Atomic accept, status transitions, intro email |
| `src/routes/lift.js` | REST handlers |
| `src/cron/liftPurge.js` | Expire open/matched rows past `session_date` |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AUTH_SESSION_TTL_DAYS` | `14` | Sliding session lifetime |
| `AUTH_PASSWORD_PEPPER` | _(unset)_ | Optional secret mixed into password hash |
| `AUTH_ARGON2_MEMORY_KB` | `65536` | Argon2id memory cost |
| `AUTH_ARGON2_TIME` | `3` | Argon2id iterations |
| `AUTH_BCRYPT_ROUNDS` | `12` | If using bcrypt instead |
| `APP_BASE_URL` | — | HTTPS base for verify/reset links in email |
| `LIFT_DEFAULT_RADIUS_KM` | `25` | Default matching radius |
| `LIFT_MAX_RADIUS_KM` | `80` | Server cap on user setting |
| `LIFT_INTRO_EMAIL_FROM` | `ALERT_EMAIL_FROM` | Sender for intro emails |
| `LIFT_DRIVER_NOTIFY_MAX_PER_DAY` | `3` | v2 throttle per driver per session |

## Scope phasing

### v1 (MVP)

- Optional auth: register, login, logout, email verify, forgot/reset password (no forced login on browse)
- Local watchlist + prefs unchanged for anonymous users
- Cloud sync opt-in: import local data on signup
- Lift share (verified account + cloud watchlist only): driver opt-in, request, inbox, accept, intro email
- First-accept-wins concurrency; purge with cloud watchlist expiry

### v2

- OAuth (Google) as optional login — links to existing email account
- Pickup note, distance bands, new-request driver email
- Leave-by alignment hint when departure planner data exists
- Mark match done

### v3 (if demand)

- `seats_available` > 1 with multiple concurrent matches per driver (different requesters) — **only if** product validates need; v1 is strictly one requester ↔ one driver per request

## Testing checklist

### Auth & security

- [ ] Anonymous user can use planner, matrix, local watchlist without login prompt
- [ ] Enabling alert toggle without login → signup + verify prompt; no cron send until verified
- [ ] Lift request without login → signup prompt; no API call until authenticated
- [ ] Cloud sync toggle without login → signup prompt
- [ ] Local watchlist import on register merges stars into cloud rows
- [ ] Local-only watched session cannot POST lift request (`403` / client gate)
- [ ] Password stored as Argon2id/bcrypt hash; never returned in API or logs
- [ ] Unverified user cannot POST lift request or enable driver opt-in
- [ ] Verify email link works once; expired/used token rejected
- [ ] Login rate limit triggers after repeated failures
- [ ] Reset password invalidates old sessions; new password required
- [ ] Session cookie is httpOnly + Secure (in prod) + SameSite
- [ ] Logout clears server session and cookie
- [ ] `/api/auth/forgot-password` returns 200 even for unknown email

### Lift share

- [ ] Driver opt-in off → user not in matching pool; inbox hidden
- [ ] Requester without watch on session → `403` or prompt to watch first
- [ ] Two drivers same session; first accept → second gets `409` on accept; inbox empty for both except winner sees matched state
- [ ] Concurrent double-accept → exactly one match in DB
- [ ] Driver cannot accept own request
- [ ] Distance filter: 8 km requester, driver at 30 km with radius 25 → not in inbox
- [ ] Cancel open request → disappears from driver inbox
- [ ] Intro email sent to both parties with correct addresses
- [ ] After `session_date` purge, open requests expired; matched rows cleaned per policy
- [ ] User without home coords: driver not listed; requester prompted to set pickup area
- [ ] Duplicate open request same watched session → `409`

## Open questions

1. **Hosted deployment** — single shared Windmate instance for a region (Montreal wing community) vs multi-tenant; lift share implies **shared** deployment with HTTPS.
2. **Database** — PostgreSQL from day one vs SQLite + migration when concurrent lift accepts matter.
3. **Radius default** — 25 km vs reuse sport `radius_km` from active profile.
4. **Request before drivers exist** — keep open request visible when zero drivers (notify when first driver opts in) vs require ≥1 driver online.
5. **Matched row retention** — delete at session expiry or keep 7-day audit for support disputes.
6. **Display name** — require at signup or default to email local-part.
7. **2FA** — TOTP for account security v2/v3 if community grows.
8. **Field-level email encryption** — needed for compliance or host at-rest encryption sufficient?
