# Departure Planner — Design Spec

**Date:** 2026-09-09  
**Status:** Draft  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Watchlist](./2026-09-08-session-watchlist-design.md), [Session Spot Ranking](./2026-09-08-session-ranking-design.md), [Realtime Wind](./2026-09-08-realtime-wind-design.md)

## Goal

When a spot has a good rideable window on a chosen day, tell the user **when to leave home** so they:

1. Arrive as the **best consecutive window for your setup** starts — ranked by your **`rank_criteria_order`** (rideability, longest window, wind, onshore, waves, …), not raw wind speed alone.
2. Get at least their **minimum consecutive rideable hours** on the water (`min_rideable_window_hours` in settings).
3. Account for **real drive time** at that time of day (Google Maps traffic), not straight-line distance alone.

Show this on the **spot card** for the selected planner day (and on watched sessions).

## User story

> "Thursday Lac Saint-Louis has a 14:00–18:00 window — my best block for onshore + longest window — and I need at least 2 consecutive hours. It's 55 minutes from home at that hour with traffic. Tell me to leave by 12:50 so I'm rigged when that window starts — not 11:00 because I guessed."

> "Oka and Hudson both work Saturday. Hudson ranks higher for my criteria (onshore + flat) but it's an extra 40 minutes — show me leave times for both so I can pick."

## Inputs

| Input | Source | Notes |
|---|---|---|
| Home origin | `user_preferences.home_lat/lng` or browser GPS / manual coords | Persisted home beats ephemeral GPS for planning |
| Spot destination | `spots.latitude`, `spots.longitude` | |
| Session date | Horizon Planner selected day or watchlist `session_date` | |
| Rideable hours | Forecast + rideability rules for that day | Same pipeline as matrix |
| Min consecutive hours | `user_preferences.min_rideable_window_hours` (existing) | Default 2 |
| **Ranking criteria order** | `user_preferences.rank_criteria_order` (existing) | Same drag-order as matrix — picks **which** qualifying window is "best" |
| Rig/setup buffer | `user_preferences.rig_minutes` or constant | Time from parking → on the water; default **20 min** |
| Drive duration | Google Maps **Routes API** or **Distance Matrix API** | `departure_time` = proposed leave time (traffic-aware) |

## Rideable windows

Reuse existing window logic (`src/utils/rideableWindow.js`, consensus across models when mixed):

1. Build hourly rideable timeline for the session date (wind, gust, weather, temp, offshore gate when enabled).
2. Find all **maximal consecutive runs** where every hour is rideable and length ≥ `min_rideable_window_hours`.
3. If multiple runs qualify, score each run with the same **session-ranking factors** as the matrix ([Session Spot Ranking](./2026-09-08-session-ranking-design.md)), computed **only over hours in that run**:

| Factor | Per-window computation |
|---|---|
| `rideability` | All hours in run are rideable → 1.0 (run already filtered) |
| `bestWindow` | `run.length / 24` (or vs longest run that day for normalization) |
| `wind` | Peak or avg wind in run vs day max (same as matrix) |
| `onshore` | Share of run hours onshore / ideal direction |
| `waveMatch` | Wave band match averaged over run hours |
| `proximity` | **Omitted** — same spot; does not discriminate between windows |

Apply user `rank_criteria_order` weights (`weightsFromOrder` — top criterion = highest weight). **Highest `windowScore` wins.**

**Tie-break:** later start (minimize waiting on the beach) when scores within **0.02**.

The winning run is the **target window** for leave-time calculation. This is **not** "pick the windiest block" unless `wind` is your top-ranked criterion.

```js
windowScore = Σ weight[criterion] × factor[criterion](runHours)
// criteria & weights from rank_criteria_order; proximity skipped
```

**Session-end warnings** (storm / wind fade) may trim the effective end of the window — departure plan uses the **safe** end hour (finish before hazard), consistent with [Realtime Wind — Session hazards](./2026-09-08-realtime-wind-design.md#session-hazards).

## Leave-time algorithm

```
target_window     = best qualifying consecutive run [start, end]
on_water_start    = target_window.start          // e.g. 14:00
on_water_end      = target_window.end            // exclusive hour boundary
rideable_hours    = count of rideable hours in run (≥ min_rideable_window_hours)

ready_at_shore    = on_water_start - rig_minutes   // e.g. 13:40
desired_arrival   = ready_at_shore                 // at parking / launch

// Traffic-aware drive (iterate once if needed)
leave_guess       = desired_arrival - haversine_drive_estimate(origin, dest)
drive_minutes     = google_maps_duration(origin, dest, departure_time=leave_guess)
leave_by          = desired_arrival - drive_minutes

// Optional safety buffer (settings, default 5 min)
leave_by          = leave_by - buffer_minutes
```

**Google Maps call:**

- Prefer **Routes API** `computeRoutes` with `routingPreference: TRAFFIC_AWARE` and `departureTime` (Unix timestamp for session date + `leave_guess`).
- Fallback: **Distance Matrix** with `departure_time` and `traffic_model=best_guess`.
- Cache result keyed by `(origin_grid, dest_grid, departure_15min_bucket)` — see [Caching](#caching).

**Without API key:** fall back to Haversine distance ÷ average speed (no traffic); label `"~X min (no traffic data)"`.

### Multiple qualifying windows

When a second window's `windowScore` is within **0.05** of the best, optionally show **alternate**:

```
Leave by 12:50 → on the water 14:00–17:00 (3 h) · 52 min drive
Also: leave 15:40 → 17:00–19:00 (2 h) if morning doesn't work
```

### Session day states

| State | Spot card copy |
|---|---|
| **Future day** | "Leave by 12:50 Thu — 52 min drive — 14:00–17:00 (3 h)" |
| **Today, before leave_by** | Same + countdown optional |
| **Today, after leave_by, before window** | "Leave now mate — window starts 14:00" |
| **Today, in window** | "You're in the window — 2 h left if you launch now" |
| **Today, window passed** | Hide or "Window's over for today" |
| **No qualifying window** | No departure line; existing matrix only |

## UI — spot card

Below best-window summary (or merged into it):

```
🚗 Leave by 12:50 · 52 min drive (traffic)
   On the water 14:00–17:00 · 3 h rideable · models agree
```

**Expanded detail (tooltip or drawer):**

```
Home → Lac Saint-Louis
Drive: 52 min via A-20 (traffic at 12:50)
Rig: 20 min · arrive shore 13:40 · foil by 14:00
Window: 14–17 h · best for your setup (onshore, flat) · min 2 h met ✓
Top reason: Longest window · 14–18 kt in block
[ Open in Google Maps ]
```

**Horizon Planner day tap:** departure line updates per spot row for that date.

**Watched session:** pin shows leave time on session day; refresh drive time every 30 min until user leaves (optional v2).

### Mate-tone copy (`copy.js`)

- `departure.leaveBy`: "Leave by {time} mate — {drive} min drive."
- `departure.leaveNow`: "Go now — window starts {time}."
- `departure.noWindow`: "No {min}h window that day."
- `departure.noTraffic`: "~{drive} min — no live traffic data."

## Data model

### `user_preferences` extension

| Column | Type | Default | Notes |
|---|---|---|---|
| `home_lat` | REAL | nullable | Persisted home; falls back to last browser coords |
| `home_lng` | REAL | nullable | |
| `home_label` | TEXT | nullable | e.g. "Home — Verdun" (display only) |
| `rig_minutes` | INTEGER | `20` | Parking → on the water |
| `departure_buffer_minutes` | INTEGER | `5` | Extra slack before drive |

`min_rideable_window_hours` already exists.

### `travel_time_cache`

| Column | Type | Notes |
|---|---|---|
| origin_lat | REAL | Rounded to ~3 decimals in key |
| origin_lng | REAL | |
| dest_lat | REAL | |
| dest_lng | REAL | |
| departure_bucket | TEXT | ISO datetime rounded to 15 min |
| duration_seconds | INTEGER | |
| distance_m | INTEGER | nullable |
| route_summary | TEXT | nullable — e.g. "A-20 E" |
| fetched_at | INTEGER | Unix ms |
| source | TEXT | `google` · `haversine` |

PK: composite of rounded origin, dest, `departure_bucket`.

TTL: **30 min** for departure within 24 h; **6 h** for future days (traffic less critical).

## API

### `GET /api/departure`

Query: `spotId`, `date` (ISO `YYYY-MM-DD`), `lat`, `lng` (origin override).

Response:

```json
{
  "spotId": "...",
  "date": "2026-09-12",
  "origin": { "lat": 45.48, "lng": -73.57, "label": "Home" },
  "minRideableWindowHours": 2,
  "rigMinutes": 20,
  "plan": {
    "leaveBy": "2026-09-12T12:50:00-04:00",
    "driveMinutes": 52,
    "driveSource": "google",
    "routeSummary": "A-20 E",
    "readyAtShore": "2026-09-12T13:40:00-04:00",
    "onWaterStart": "2026-09-12T14:00:00-04:00",
    "onWaterEnd": "2026-09-12T17:00:00-04:00",
    "rideableHours": 3,
    "windowScore": 0.84,
    "topReasons": ["Longest window", "Onshore"],
    "status": "planned",
    "mapsUrl": "https://www.google.com/maps/dir/?api=1&..."
  },
  "alternate": null
}
```

`status`: `planned` · `leave_now` · `in_window` · `passed` · `no_window`

### Rideability embed (optional)

`GET /api/rideability` may include `departurePlan` per spot for the **selected planner date** when `?date=` is passed — avoids extra round-trip. Same shape as `plan` above.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | No* | Routes or Distance Matrix; haversine fallback if unset |
| `TRAVEL_CACHE_TTL_MS` | No | Default `1800000` (30 min) |
| `DEFAULT_RIG_MINUTES` | No | Default `20` |

*Departure times still work without Google; traffic accuracy is the main loss.

## Integration

| Feature | Behavior |
|---|---|
| **Min consecutive hours** | Existing setting gates which runs qualify |
| **Session ranking** | Proximity still sorts spots; departure shows **actual** drive time for chosen day/time |
| **Watchlist** | Session-day card shows leave time prominently |
| **Go/no-go (today)** | If `no_go`, strike through departure or show "Check live before you leave" |
| **Local intel** | Closed access/parking → warning on departure line: "Lot closed — verify before you go" |

## Scope phasing

### v1

- `GET /api/departure` with Google Maps + haversine fallback
- Home coords from request lat/lng (browser) or prefs
- Spot card + planner day departure line
- Best single qualifying window only

### v2

- Persisted `home_lat/lng` in settings UI
- `rig_minutes` in settings
- Alternate window hint
- Embed in `/api/rideability?date=`
- Compare leave times across top 3 ranked spots (planner hero)

### v3

- Re-fetch drive time on session morning (cron or client poll)
- "Leave now" push/email for watched sessions
- Multi-stop (coffee, shop) — out of scope unless requested

## Testing checklist

- [ ] 3 h window, min 2 h, 50 min drive → `leave_by` = start − 50 − rig − buffer
- [ ] Window shorter than `min_rideable_window_hours` → `no_window`
- [ ] Two windows → higher `windowScore` per `rank_criteria_order`; tie → later start
- [ ] User with `wind` last in order → afternoon onshore block beats morning windy offshore block
- [ ] No `GOOGLE_MAPS_API_KEY` → haversine estimate + `driveSource: haversine`
- [ ] Cache hit avoids second Google call for same 15 min bucket
- [ ] Session hazard trims `onWaterEnd` before storm hour
- [ ] Timezone: leave times in user or spot local TZ (document choice at implementation)

## Open questions

1. **Home location** — auto-save browser coords as home on first visit, or explicit "Set as home" button?
2. **Arrival strategy** — always "just in time" or user toggle "I like to arrive 15 min early"?
3. **Google API product** — Routes API vs Distance Matrix (cost / ToS)?
4. **Server-side vs client-side** — Google key on server only (recommended); never expose unrestricted key in SPA.
