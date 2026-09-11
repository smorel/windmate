# Saved Planning Locations — Design Spec

**Date:** 2026-09-11  
**Status:** Draft (user decisions locked)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Departure Planner](./2026-09-09-departure-planner-design.md), [Spot Map Picker](./2026-09-09-spot-map-picker-design.md), [Per-Sport Preferences & Alerts](./2026-09-09-per-sport-preferences-alerts-design.md), [Per-Sport Favorites-Only](./2026-09-11-sport-favorites-only-design.md)

## Goal

Let users save **one or more planning origins** (home, trip base, etc.) as **coordinates + a nickname only** — no stored street address — switch the **active** place at any time, and have that choice drive **all** location-aware product behavior (horizon, matrix, ranking proximity, departure, server horizon alerts).

On app launch, when device GPS is available, **pick the saved place closest to GPS** as the active planning location when you're physically near that place — never silently move pin coordinates; manual place choice in-session is respected until the next launch.

## User stories

> "I live in Verdun but I'm planning a week in Hood River. I add a trip place on the map, switch active to it, and my horizon and emails are about sessions near there — then I switch back to Home."

> "I only want Windmate to store lat/lng and a label I type — not my address."

> "I land in Tarifa and open Windmate; GPS snaps active planning to my **Tarifa** saved place and my Tarifa stars — no tapping through settings."

> "I'm in Montreal at 11 p.m. planning Hood River for tomorrow. Horizon and watch cards should treat **their** evening/morning — not my laptop clock — and I want a hint that local time there is different."

> "My wing spots in Montreal aren't my wing spots in Tarifa. When I switch planning place, my stars should switch too — per sport."

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Single source of truth | **Active saved place** drives horizon, rideability spot set, matrix ranking proximity, departure origin, horizon alert cron |
| **Planning time** | **Active place IANA timezone** drives calendar "today", planner default day, elapsed vs future hours, session/watch "today" logic, departure local times — **not** device GPS timezone |
| TZ mismatch UI | When planning TZ **materially differs** from device TZ, show **time at location** (`HH:mm`) in the forecast refresh chrome |
| Live GPS default | **Not** the planning origin for coords/radius; GPS used to **auto-select which saved place is active** on launch (see below) |
| Storage | **lat, lng, nickname** per place only — no `address`, no persisted geocode strings |
| Geocode / search | **Ephemeral** — moves map pin during edit; query and formatted address are **not** saved |
| Display | User nickname (default suggestion **"Home"** for first place) |
| Launch GPS | **Auto-switch active saved place** to nearest place within snap radius; optional prompt only when GPS is far from **all** saved places |
| Alert cron | Use **active place** coords from persisted prefs (replaces `ALERT_ORIGIN_LAT/LNG` for per-user deploys) |
| Departure planner | Supersedes ad-hoc `home_lat/lng` as separate concept — active place **is** departure origin ([Departure Planner](./2026-09-09-departure-planner-design.md) updated at implementation time) |
| **Favorites** | **Per planning place × per sport** — starring/unstarring updates the list for `(active_location_id, active_sport)` only |
| Sport prefs (radius, wind, …) | **Global per sport** (unchanged) — only `favorite_spot_ids` gains a location dimension in v1 |
| Watchlist | **Global** (spot + date + sport) — not scoped to planning place; user may watch a Tarifa session while active place is Montreal |

## Scope

### In scope (v1)

- CRUD for **saved places** (add, edit pin, rename, delete) with map-first editor
- **Active place** selector in dashboard location UI (dropdown or equivalent)
- Client: all `userLocation` consumers use **active place** coords (not continuous GPS re-centering)
- Persist places + `active_location_id` via `/api/preferences` (SQLite)
- **Launch GPS → nearest saved place** selection (once per session; see below)
- Horizon alert scheduler reads origin from global prefs, not env-only
- Privacy copy in Settings
- **Planning timezone** resolution, caching, and client/server calendar helpers
- **Location clock** in refresh countdown banner when TZ differs from device
- **`location_sport_favorites`** — migrate from `sport_profiles.favorite_spot_ids`; all favorite UI/API paths keyed by active place + sport

### Out of scope (v1)

- Multiple simultaneous alert regions (home + trip at once)
- Continuous GPS geofencing while app is open (launch-time snap only)
- Sync across devices (until accounts; same as other prefs)
- Storing or displaying reverse-geocoded addresses

## UI

### Active location control

Replace or extend the current location row (`#location-status`, **Use my location**) with:

```text
Planning from: [ Home ▾ ]

  ● Home
  ○ Hood River — July
  ─────────────────
  + Add place…
  Edit active place…
```

- Selecting a row sets `active_location_id` and refreshes horizon, matrix, watchlist strip, departure lines, and **reloads favorite stars** for each sport at that place.
- Manual override: user can always pick another place from the list; that choice sticks for the **rest of the session** (no second auto-snap until next visit).
- One-line hint when opening map/search (optional): *"Stars are saved for **{place}** and the current sport."*

### Add / edit place

Settings section **Planning places** (or modal sheet):

- Compact **Leaflet** map (~240–320 px), draggable marker (reuse tile + patterns from [Spot Map Picker](./2026-09-09-spot-map-picker-design.md))
- **Nickname** text input (required, max ~40 chars)
- Optional **Search area** (geocode) — flies map only
- Advanced: lat/lng number inputs (same as today's manual fallback)
- **Save** persists place; if first place, auto-select active

### Launch GPS → nearest saved place

**When:** Once per app visit, after prefs load and the first acceptable `getCurrentPosition` fix (skip if user already **manually** changed active place this session).

**Ignore bad fixes:** `gps_fix.accuracy_m > MAX_ACCURACY_M` (default **500**) → keep persisted `active_location_id`.

**Algorithm:**

```text
nearest = saved place with minimum haversine(gps, place.lat/lng)
d_nearest = distance_km(gps, nearest)
```

| Condition | Action |
|-----------|--------|
| `d_nearest <= AUTO_SELECT_KM` and `nearest.id !== active_location_id` | Set **active** to `nearest`, persist `active_location_id`, refresh dashboard. Optional subtle toast: "Planning from **{nickname}** — you're nearby." |
| `d_nearest <= AUTO_SELECT_KM` and already active | No-op |
| `d_nearest > AUTO_SELECT_KM` for **every** saved place | **Keep** last active (supports planning a distant trip from the couch). Optional prompt (v1 nice-to-have): GPS is far from all saved places → **Add place at GPS** / **Stay on {active}** / **Move pin for {active}** |
| Two places within `AUTO_SELECT_KM` | Pick **closest**; if within 2 km of each other, pick closest (tie-break: lower `created_at`) |

Suggested default: `AUTO_SELECT_KM = 40` (~local metro / coast strip; tune via `LOCATION_AUTO_SELECT_KM`).

**Never on launch (without explicit user action):**

- Change stored **lat/lng** of a saved place
- Run auto-select on every `watchPosition` tick

**Manual pin update:** Settings → edit place → drag pin or **Use GPS for this pin** (explicit).

**Tradeoff (documented):** Opening the app at home after a Tarifa trip auto-selects **Home** when GPS is near Home, even if you last had **Tarifa** active — switch back in the dropdown for remote planning. Manual selection blocks re-snap until next launch.

### Planning timezone & location clock

**Problem today:** `WindmateForecastTime.localDateString()` and friends use the **browser** timezone. Matrix **day/night shading** per hour uses each **spot's** Open-Meteo sunrise/sunset (spot-local), but **which day is "today"**, which hours are **elapsed**, watchlist **session-day** panels, horizon day selection, and departure `tzOffset` follow the device — wrong when planning a distant trip from home.

**Rule:** The **active saved place** defines the **planning timezone** (`timezone_id`, IANA e.g. `America/Los_Angeles`). All **planning calendar** logic uses "now" and "today" in that zone.

| Still spot-local (unchanged) | Uses planning TZ |
|------------------------------|------------------|
| Hourly forecast timestamps & wind blocks | Calendar **today** (`YYYY-MM-DD`) |
| Per-spot `daylightOk` / matrix night styling for that spot's sun times | Default selected planner day |
| Open-Meteo fetch `timezone: auto` at spot lat/lng | `isSessionPlanningHour`, elapsed hour greying |
| | Watchlist "today" / session-day expansion / GO·NO-GO "as of now" |
| | Horizon planner "today" highlight and blur-day window |
| | Departure leave-by / `tzOffset` for Google traffic (replace `Date.getTimezoneOffset()`) |
| | Server watchlist purge & horizon cron "today" (read active place TZ from prefs) |

**Resolving `timezone_id`:**

1. On create/update place (or first dashboard load for active coords), call Open-Meteo with `timezone=auto` at **place** lat/lng (minimal `forecast_days=1` is enough); persist `timezone_id` from response `timezone` field.
2. Re-resolve when lat/lng changes by more than ~0.05° (~5 km) or when `timezone_id` is null.
3. Expose on `active_location` in GET `/api/preferences` and in client planning context.

**Shared helpers** (client `forecastTime.js` + server `src/utils/forecastTime.js`):

```text
calendarDateStringInTz(now, timezoneId) → 'YYYY-MM-DD'
wallClockInTz(now, timezoneId) → 'HH:mm'
timezoneOffsetMinutesAt(now, timezoneId) → same convention as Date.getTimezoneOffset()
planningDiffersFromDevice(timezoneId) → boolean
```

Implement with `Intl.DateTimeFormat` + `formatToParts` (no new dependency) or `Temporal` if project std allows.

**Location clock indicator** (refresh countdown banner `#refresh-countdown`):

Show when `planningDiffersFromDevice` is true. Suggested rule:

- Planning calendar date ≠ device calendar date, **or**
- UTC offset at `now` differs by **≥ 60 minutes** (covers most cross-TZ trips; same offset edge cases hide the chip).

Layout (single pill, existing styles):

```text
Forecast refresh  04:32  ·  Hood River  14:32
```

- Left segment: existing countdown (`WindmateCopy.refreshCountdown`).
- Right segment: `{nickname} {HH:mm}` with `aria-label` "Local time at Hood River, 2:32 p.m."
- Update location clock every **60 s** (same timer as countdown tick or shared interval).
- When TZ matches device, **omit** the right segment (no clutter at home).

Optional subtle suffix on `#location-status`: "· Pacific time" when indicator is visible (v1: banner only is enough).

### Privacy copy

Settings blurb:

> Windmate stores only a name you choose and map coordinates for each place. We don't save your street address.

## Data model

### `saved_locations` (new table)

| Column | Type | Notes |
|--------|------|--------|
| id | TEXT | UUID PK |
| nickname | TEXT NOT NULL | User-typed only |
| lat | REAL NOT NULL | |
| lng | REAL NOT NULL | |
| timezone_id | TEXT | nullable — IANA; filled from Open-Meteo `timezone` at place coords |
| created_at | INTEGER | Unix ms |
| updated_at | INTEGER | Unix ms |

Order: `ORDER BY created_at ASC` or explicit `sort_order` (v1: creation order).

### `user_preferences` extension

| Column | Type | Default | Notes |
|--------|------|---------|--------|
| `active_location_id` | TEXT | nullable | FK → `saved_locations.id`; null → legacy behavior until first place created |

**Migration from departure spec:** If `home_lat` / `home_lng` / `home_label` were added in a branch, migrate one row into `saved_locations` and set `active_location_id`. If never shipped, skip.

**Deprecate** standalone `home_lat`, `home_lng`, `home_label` in favor of saved places (single model).

### `location_sport_favorites` (new table)

One row per **(planning place, sport)**. Replaces `sport_profiles.favorite_spot_ids` as the source of truth when `saved_locations` exist.

| Column | Type | Notes |
|--------|------|--------|
| location_id | TEXT | FK → `saved_locations.id` ON DELETE CASCADE |
| sport | TEXT | FK → sport key (`wingfoiling`, …) |
| favorite_spot_ids | TEXT NOT NULL | JSON array of spot UUIDs, same format as today |
| updated_at | INTEGER | Unix ms |

**PK:** `(location_id, sport)`.

**Read path:** `getFavoriteSpotIds(db, locationId, sport)` — used by rideability, search, bbox, map picker, matrix partition, [favorites-only](./2026-09-11-sport-favorites-only-design.md) selection.

**Write path:** `PUT /api/preferences/sports/:sport` with `favorite_spot_ids` writes to **active** `location_id` (400 if no active place and legacy mode).

**New place:** On `POST …/locations`, seed empty favorite arrays for all enabled sports (no spots starred until user adds).

**Delete place:** CASCADE removes all favorite rows for that location.

**Migration (one-time):**

1. Create default saved place **Home** from current planning coords (or Montreal default).
2. For each `sport_profiles` row, `INSERT INTO location_sport_favorites` copying `favorite_spot_ids` into **Home** only.
3. Stop reading/writing `sport_profiles.favorite_spot_ids` (column retained empty or dropped in later migration).

**Legacy (no saved places yet):** Continue using `sport_profiles.favorite_spot_ids` until user creates first place, then run migration step 2 for that moment's lists.

### API

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/preferences` | Include `saved_locations[]`, `active_location_id`, resolved `active_location`; each `sport_profiles[]` includes `favorite_spot_ids` **for active location** (merged server-side) |
| GET | `/api/location/timezone` | Query `lat`, `lng` → `{ timezone_id }` (Open-Meteo proxy, cached 7d per rounded coord) |
| PUT | `/api/preferences` | Patch `active_location_id` |
| POST | `/api/preferences/locations` | Create place `{ nickname, lat, lng }` |
| PUT | `/api/preferences/locations/:id` | Update nickname and/or lat/lng |
| DELETE | `/api/preferences/locations/:id` | Remove; if was active, fall back to first remaining or prompt user |

Client mirrors in `localStorage` only if offline-first is required later; v1 server prefs match existing settings pattern.

## Integration (active place drives everything)

| Consumer | Change |
|----------|--------|
| `userLocation` in `app.js` | Set from `active_location` after prefs load; GPS does not overwrite without user action |
| `/api/sports/horizon-summary` | `lat`, `lng` from active place |
| `/api/rideability`, spot search bias | Active place |
| Matrix ranking proximity | Active place |
| `departure.js` / `/api/departure` | Origin = active place; label = nickname |
| `spotMapPicker` `getHome()` | Active place |
| `horizonAlertScheduler.js` | `getActiveLocation(db)` instead of `ALERT_ORIGIN_*` env (env as deploy fallback only when no places) |
| Watchlist strip / far-away copy | Active place |
| `WindmateForecastTime.localDateString` | **`planningToday()`** — active `timezone_id`, else device (legacy) |
| `watchlist.js` today / purge hints | Planning today |
| `departure.js` `clientTzOffsetMinutes` | Offset from **planning** TZ at session date |
| `sessionRank.js` / server rank "today" | Planning today when evaluating active dashboard date |
| Refresh countdown banner | Append location clock when `planningDiffersFromDevice` |
| `favoriteSpotIds` / toggle favorite in `app.js` | Read/write via active `location_id` + `active_sport` |
| `GET /api/rideability`, `/api/spots/*` | Resolve favorites with `getPreferences(db, sport, activeLocationId)` |
| Map picker ★ markers | Favorite set for active place + sport |
| Horizon alert cron | Active place coords + per-sport favorites at that place for spot selection |

## Environment variables

| Variable | Notes |
|----------|--------|
| `ALERT_ORIGIN_LAT` / `ALERT_ORIGIN_LNG` | **Fallback** when no `active_location_id` and no saved places (dev / first-run) |
| `LOCATION_AUTO_SELECT_KM` | Max distance GPS → saved place to auto-set active (default `40`) |
| `LOCATION_GPS_MAX_ACCURACY_M` | Ignore fixes worse than this (default `500`) |

## Copy (`copy.js`) — suggestions

| Key | Text |
|-----|------|
| `location.planningFrom` | Planning from: {name} |
| `location.addPlace` | Add place… |
| `location.editPlace` | Edit place |
| `location.privacyBlurb` | (see Privacy copy above) |
| `location.autoSelectedPlace` | Planning from **{name}** — you're nearby. |
| `location.farFromAllPlacesTitle` | GPS isn't near any saved place |
| `location.farFromAllPlacesBody` | Add a place here or keep planning from **{name}**. |
| `location.addNewPlace` | Add new place… |
| `location.stayOnPlace` | Stay on {name} |
| `location.useGpsForPin` | Set pin to GPS |
| `location.timeAtPlace` | {name} {time} |
| `location.timeAtPlaceAria` | Local time at {name}, {time} |
| `location.favoritesScoped` | Stars are saved for **{place}** and this sport. |
| `favorites.switchedPlace` | Switched to **{place}** — your starred spots for here are showing. |

## Phasing

### v1 (this spec)

Saved places, active selector, map editor, planning TZ + location clock, **per-location per-sport favorites**, full client + cron wiring, launch mismatch prompt.

### v2

- "Duplicate place" for trip template (optional: **copy favorite lists** from another place)
- Settings list reorder
- Account sync of `saved_locations`

## Testing checklist

- [ ] No saved places → behavior matches today (Montreal default / GPS / IP / manual until first save)
- [ ] Create Home, switch active → horizon and matrix use Home coords
- [ ] Add second place, switch → data refreshes for new origin
- [ ] Delete active place → sane fallback + user message
- [ ] GPS near Tarifa saved place, active was Home → auto-switch to Tarifa + refresh favorites
- [ ] GPS near Home, already active Home → no toast, no extra PUT
- [ ] GPS in Montreal, active Tarifa, all places far → **stay** on Tarifa (couch trip planning)
- [ ] Manual switch to Tarifa after launch → no second auto-snap same session
- [ ] **Use GPS for pin** in editor updates lat/lng only for that place
- [ ] Geocode search during edit does not appear in GET preferences response as address
- [ ] Cron alert scan uses active place lat/lng
- [ ] Departure leave-by uses active place origin
- [ ] Active place in US, device in Canada: planning **today** follows US west coast date at local midnight boundary
- [ ] Matrix elapsed hours grey using planning today, not device
- [ ] Watchlist session-day panel uses planning today for watched `session_date === today`
- [ ] TZ differs → refresh banner shows `{nickname} HH:mm`; TZ same → hidden
- [ ] Switch active place → today + countdown clock update without full reload
- [ ] Server cron / purge uses stored `timezone_id` for active place
- [ ] Star spot in Montreal + Home active → same sport at Tarifa active shows empty stars until user stars Tarifa spots
- [ ] Switch place → matrix/map stars update without losing other place's lists
- [ ] `favorites_only` sport uses favorites for **active place** only
- [ ] Migration: existing per-sport stars appear under default Home place

## Open questions

None for v1 — user confirmed active drives everything, **launch nearest-place auto-select**, planning TZ, and **per-place per-sport favorites**.

**Later (not v1):** per-location overrides for `radius_km` or alert schedule (e.g. larger radius on vacation); filter watchlist by active place.
