# Per-Sport Favorites-Only Spots — Design Spec

**Date:** 2026-09-11  
**Status:** Approved (requirements locked; implementation pending)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Per-Sport Preferences & Alerts](./2026-09-09-per-sport-preferences-alerts-design.md), [Planner Full-Day Forecast](./2026-09-11-planner-full-day-forecast-design.md), [Spot Map Picker](./2026-09-09-spot-map-picker-design.md)

## Goal

Some sports are practiced only at specific places (e.g. sailing at a club). For those sports, users should not load forecasts, planner context, ranking, or alert scans for every spot in radius — only **starred spots for that sport**.

A **per-sport** setting limits dashboard data to favorites while **search and map** stay open for discovery.

## User stories

> "I only sail at my club — I don't care if it's windy 30 km away at a kite beach."

> "Wingfoil stays normal; sailing profile only shows my two starred harbors."

> "I turned on favorites-only for sailing before starring anything — tell me to star a spot instead of showing random nearby launches."

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Scope | **Per sport** on `sport_profiles` (Settings tab per sport) |
| Default | **Off** (`0`) — current radius + limit + out-of-radius favorites behavior |
| Discovery | **Unchanged** — `/api/spots/search`, bbox, map picker still show the wider catalog |
| Dashboard data | Rideability, observations, horizon planner, matrix ranking, sport-selector dots, horizon **email** cron |
| Favorite source | That sport's `favorite_spot_ids` (not global `user_preferences.favorite_spot_ids`) |
| Zero favorites when ON | **Empty dashboard** for that sport; **no** weather API calls; dedicated empty copy |
| Enable gate | User **may** turn ON with zero favorites (empty state, not blocked in Settings) |
| Full-day planner toggle | **No change** — global `planner_full_day_forecast`; with favorites-only, all loaded spots are favorites |
| Watchlist | **Out of scope** — watched sessions may reference any spot user chose earlier |

## UI

### Placement

Settings modal → active sport tab → directly under **Search radius (km)** (`index.html`):

```text
Search radius (km)     [____]
  Nearby spots within this range; favorites can be farther

[ ] Only starred spots
    Forecast and planner ignore other spots — star your club on the map.
```

- Control: checkbox, auto-saved with other sport fields (`PUT /api/preferences/sports/:sport`).
- When OFF, existing radius hint unchanged.

### Copy (`copy.js`)

| Key | Suggested text |
|-----|----------------|
| `settings.favoritesOnly` | Only starred spots |
| `settings.favoritesOnlyHint` | Forecast and planner ignore other spots — star your club on the map. |
| `empty.favoritesOnlyNoSpots` | Star at least one spot for this sport to see forecasts — use search or the map. |

Use `empty.favoritesOnlyNoSpots` when `preferences.favorites_only` is on and rideability returns `spots: []`. Keep `empty.noSpotsNearby` for radius mode with no spots.

## Data model

### SQLite migration (`db.js` init)

```sql
ALTER TABLE sport_profiles
  ADD COLUMN favorites_only INTEGER NOT NULL DEFAULT 0;
```

Parse in `parseSportProfileRow` as `favorites_only: row.favorites_only ? 1 : 0`. Include in `updateSportProfile` when `body.favorites_only` is present.

### API

| Method | Path | Field |
|--------|------|--------|
| GET | `/api/preferences` | Each `sport_profiles[]` entry includes `favorites_only`: `0` \| `1` |
| PUT | `/api/preferences/sports/:sport` | `favorites_only`: boolean or `0`/`1` |
| GET | `/api/rideability` | Active profile merged via `getPreferences()` includes `favorites_only` |

## Spot selection

### New helper (`src/utils/spotSelection.js`)

```text
selectSpotsForProfile(allSpots, lat, lng, profile, limit) → spots[]
```

| `profile.favorites_only` | Behavior |
|--------------------------|----------|
| `0` | `selectDashboardSpots(allSpots, lat, lng, profile.radius_km, limit, profile.favorite_spot_ids)` — unchanged |
| `1` | `selectFavoriteOnlySpots(allSpots, lat, lng, profile.radius_km, profile.favorite_spot_ids)` |

### `selectFavoriteOnlySpots`

- Parse `favorite_spot_ids`; if empty → `[]`.
- For each id that exists in `allSpots`, attach `distance_km` (haversine from user lat/lng) and `outside_radius: distance_km > radiusKm`.
- Sort by `distance_km` ascending.
- **Do not** add in-radius non-favorites; **do not** apply `RIDEABILITY_SPOT_LIMIT` cap (user's starred set is the full list).

Replace direct `selectDashboardSpots` calls in:

- `src/routes/rideability.js`
- `src/routes/observations.js`
- `src/routes/sports.js` (`horizon-summary`)
- `src/cron/horizonAlertScheduler.js`

Pass full `profile` (or `favorites_only` + fields) so each sport in horizon-summary uses its own flag and favorites.

### Bug fix bundled

`horizon-summary` and horizon alert cron currently pass `global.favorite_spot_ids` into `selectDashboardSpots`. After this change they must always use **`profile.favorite_spot_ids`** in radius mode as well, so multi-sport dots and emails match each sport's stars.

## Client behavior

### Settings (`app.js`)

- Bind checkbox `#favorites-only` (or similar id) in `loadSettingsFormForSport` / `buildSportProfilePayload`.
- On toggle, auto-save and `refreshDashboard` like other sport prefs.

### Empty states

- `renderHorizonPlanner` / matrix empty paths: if `data.preferences.favorites_only` and `!data.spots.length`, use `empty.favoritesOnlyNoSpots`.
- No client-side spot filtering required when server returns the correct list.

### Horizon planner & ranking

- Day cards and `rankSpotsForDay` operate on `rideabilityData.spots` only; no new filters.
- `plannedHorizonSpots` / far-favorite curiosity logic unchanged within the reduced set.

## Interaction with planner full-day

When global full-day is ON and favorites-only is ON:

- Matrix spot list is already all favorites (any rideability).
- `filterMatrixSpotsForDay` union with rideable non-favorites is a no-op for non-favorite strangers (they are not in the payload).
- No spec change to full-day toggle placement or persistence.

## Tests

`test/spotSelection.test.js` (or new file):

- Radius mode unchanged (regression).
- Favorites-only: returns only starred spots, correct `outside_radius`.
- Favorites-only: empty favorites → `[]`.
- Favorites-only: unknown ids in JSON skipped safely.

Optional route-level test: rideability with `favorites_only` and empty favorites returns `spots: []` without calling weather (mock/spy if present).

## Acceptance checklist

- [ ] Sailing (or any sport) with favorites-only ON loads forecasts **only** for that sport's starred spots.
- [ ] Same sport with toggle OFF still loads radius + out-of-radius favorites as today.
- [ ] Toggle ON + zero favorites: empty planner/matrix copy, no forecast fetch for that sport.
- [ ] Map search and bbox unchanged; starring a spot then refresh includes it.
- [ ] Sport switcher horizon dots respect per-sport `favorites_only` and per-sport favorites.
- [ ] Horizon email cron uses same spot set as dashboard for each profile.
- [ ] Setting persists across reload; independent per sport profile.

## Files (expected touch)

| Area | Files |
|------|--------|
| DB | `src/db.js` |
| Selection | `src/utils/spotSelection.js` |
| Routes / cron | `rideability.js`, `observations.js`, `sports.js`, `horizonAlertScheduler.js`, `preferences.js` |
| UI | `public/index.html`, `public/js/app.js`, `public/js/copy.js` |
| Tests | `test/spotSelection.test.js` |
