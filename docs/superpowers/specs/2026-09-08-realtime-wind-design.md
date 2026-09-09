# Realtime Wind Observations — Design Spec

**Date:** 2026-09-08  
**Status:** Approved  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)

## Goal

On session day, give sailors a quick read of **what wind is actually doing** at each nearby spot so they can validate the forecast before driving out. **The core user fear is driving to a spot that looked good on forecast but isn't blowing live** — this feature exists to prevent that mistake.

Each spot card shows a live wind overview; expanding reveals a **forecast vs actual** curve for today. When forecast and actual diverge, the UI must say so plainly (not bury the delta in a chart tooltip). Watched sessions (see [Session Watchlist spec](./2026-09-08-session-watchlist-design.md)) get stronger mismatch surfacing on their session day.

## User decisions

| Question | Choice |
|---|---|
| Data source | **Station first**, then model-analysis fallbacks via [Open-Meteo](https://open-meteo.com/) and optionally [Windy Point Forecast](https://api.windy.com/) |
| Daily curve | **Forecast vs actual** overlay for today |
| API shape | **Separate `/api/observations` endpoint**; chart on expand |
| Storm / rain | **Hard block** on rideable hours during precip/storms; **warning** when hazards follow a rideable window |
| Wind fade | **Warning** when wind drops below min threshold after a rideable window — don't get stuck on the water |
| Temperature | **Show air + water temp** at rideable hours; **optional min temp settings** gate rideability when set |

## Scope

### In scope (v1)

- `GET /api/observations?lat=&lng=&radius=` — parallel fetch with rideability
- Per-spot **live strip** on rideability matrix cards (current wind, gusts, direction, source)
- **Expand toggle** per spot → today's forecast-vs-actual wind curve
- Station data from iGetwind nearest wx station (when within 15 km)
- Model-analysis fallbacks (no API key required first, Windy optional):
  - **Open-Meteo** — `current` + today's elapsed hourly via `past_hours`
  - **Windy Point Forecast** — optional when `WINDY_API_KEY` is set; nearest recent timestep as last-resort fallback
- Forecast comparison from cached primary model (`forecast_cache`)
- `observation_cache` table, 5 min TTL
- Summary stats: hours compared, avg delta, rideable hour counts (forecast vs actual)
- **Weather hazard gate** — rain/storm hours excluded from rideable counts (see [Session hazards](#session-hazards))
- **Session-end warnings** on rideable windows — storm/rain approaching **or** wind fading below minimum
- **Temperature** — air and water temp on rideable hours; user-configurable minimums (see [Temperature](#temperature))

### Out of scope (v1)

- Historical days beyond today
- Multi-model forecast overlay on the curve (primary model only)
- Persisting observation history in SQLite
- Session watchlist pinning and session-day go/no-go banners (see [Session Watchlist spec](./2026-09-08-session-watchlist-design.md))
- Webcam embeds and social/community condition feeds (see Session Watchlist spec — Ground truth enrichment)
- Windy Map Forecast / Webcams APIs (v1); per-spot webcam URLs planned later
- METAR or other third-party station networks (future if iGetwind station API unavailable)

## Architecture

```
Browser (Rideability Matrix)
        │  parallel JSON REST
        ├─ GET /api/rideability   → forecast + rideability (existing)
        └─ GET /api/observations  → live wind + today comparison (new)
                │
                ▼
        Express Server
          ├── observations.js (route)
          ├── observations.js (service)
          │     ├── igetwind station lookup (preferred)
          │     ├── openMeteoObservations.js (fallback 1)
          │     ├── windyObservations.js (fallback 2, optional)
          │     └── compareToday() — align forecast vs actual
          └── observation_cache (SQLite, 5 min TTL)

Data sources (priority order per spot):
  1. iGetwind nearest wx station  (≤ 15 km)     → source: "station"
  2. Open-Meteo current + past hourly            → source: "open-meteo"
  3. Windy Point Forecast (if API key configured)  → source: "windy"
```

## External providers

| Provider | API | Auth | Best for in Windmate | Realtime? |
|---|---|---|---|---|
| **iGetwind** | Internal station API (TBD) | None (existing integration) | Nearest anemometer to spot | Yes — physical station readings |
| **[Open-Meteo](https://open-meteo.com/)** | `GET /v1/forecast` | None (free, 10k calls/day non-commercial) | Current conditions + today's elapsed hourly | Analysis — model state ingesting station/radar/satellite obs |
| **[Windy](https://api.windy.com/)** | `POST /api/point-forecast/v2` | `WINDY_API_KEY` (free tier available) | Last-resort current wind when Open-Meteo fails | No — forecast model output (`canHrdps`, `hrrrConus`, `gfs`, etc.) |

**Important distinction:** Open-Meteo and Windy both expose excellent wind APIs, but only iGetwind stations deliver true on-site anemometer data. Open-Meteo's `current` and `past_hours` fields represent observation-informed analysis at the coordinate — good enough to validate "is it roughly as windy as forecast?" on session day. Windy's Point Forecast returns model timesteps (wind, windGust as u/v components); useful as a redundant fallback, not as ground truth.

## Data sources

### 1. Station (preferred) — iGetwind

- Query iGetwind for nearest weather station to spot coordinates.
- Endpoint pattern mirrors existing `spotnear` integration; exact path confirmed during implementation.
- Accept station if within **15 km** of spot.
- Return station name, distance, and latest reading timestamp.
- If station API is down or no station in range → fall through to Open-Meteo.

### 2. Model analysis (fallback 1) — Open-Meteo

Primary analysis fallback. Already used elsewhere in Windmate for forecasts; no extra API key.

**Endpoint:** `https://api.open-meteo.com/v1/forecast`

**Parameters:**

```
latitude, longitude
current=wind_speed_10m,wind_gusts_10m,wind_direction_10m
hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m
past_hours=24
wind_speed_unit=kn
timezone=auto
```

- `current` → live strip (wind, gusts, direction, `observedAt`)
- Filter `hourly.time` to today's elapsed hours → `today.actual` curve points
- Label source as `"open-meteo"` in the response.
- On failure → fall through to Windy (if configured).

### 3. Model forecast (fallback 2) — Windy Point Forecast

Optional last-resort when Open-Meteo is unavailable and `WINDY_API_KEY` is set.

**Endpoint:** `POST https://api.windy.com/api/point-forecast/v2`

**Request body (Quebec example):**

```json
{
  "lat": 45.45,
  "lon": -73.75,
  "model": "canHrdps",
  "parameters": ["wind", "windGust"],
  "levels": ["surface"],
  "key": "<WINDY_API_KEY>"
}
```

**Model selection by region** (mirror rideability primary model):

| Region | Windy model |
|---|---|
| Quebec / Canada | `canHrdps` |
| US continental | `hrrrConus` |
| Default global | `gfs` |

- Parse `wind_u-surface` / `wind_v-surface` → speed + direction; `gust-surface` → gusts.
- Use the timestep closest to now for `current`.
- Use timesteps from start of today through now for `today.actual`.
- Label source as `"windy"`.
- **Note:** This is still model output, not observations. UI badge must say `Windy model`, not `Live`.

### Forecast for comparison

- Reuse cached primary model hourly data from `forecast_cache` (same source as rideability matrix — iGetwind LAM/HRRR/GFS or Open-Meteo).
- Align timestamps for today (local timezone).
- Only compare hours where actual data exists (past hours through current hour).
- Windy is **not** used for the forecast line on the curve — only iGetwind/Open-Meteo cached forecasts.

### Weather hazard data (precip / storms)

Used to gate rideability and generate storm-approaching warnings. Fetched alongside wind from **Open-Meteo** (primary — no extra key):

```
hourly=precipitation,weather_code,temperature_2m,apparent_temperature
current=precipitation,weather_code,temperature_2m
```

Water temperature (when available) via [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api):

```
GET https://marine-api.open-meteo.com/v1/marine
hourly=sea_surface_temperature
```

For inland lakes/rivers where marine SST is unavailable, fall back to forecast API surface-water proxy:

```
hourly=soil_temperature_0cm
cell_selection=sea
```

Label proxy values `waterTempSource: "estimated"` in the response.

Optional Windy supplement when `WINDY_API_KEY` is set: `precip`, `cape`, `weatherWarnings`, `temp` parameters.

## Forecast vs actual mismatch

Forecast-only rideability is unreliable on session day. This section defines how Windmate surfaces **"forecast said go, live says no"** (and the reverse).

### Mismatch signals

| Signal | Computation | Typical threshold |
|---|---|---|
| **Current hour delta** | `actual.windSpeed − forecast.windSpeed` at current hour | Warn if `\|delta\| ≥ 4 kt` |
| **Day average delta** | `today.summary.avgDeltaKt` | Warn if `\|avgDeltaKt\| ≥ 3 kt` |
| **Rideable hour gap** | `forecastRideableHours − actualRideableHours` (elapsed hours only) | Warn if gap ≥ 2 h |
| **Forecast rideable, actual not** | Forecast hour was rideable, matching actual hour is not | **High** severity on watched session day |

Negative delta (actual weaker than forecast) is the primary go/no-go concern. Positive delta (stronger than forecast) is informational unless gusts exceed `max_gust_knots`.

### Go / no-go states (live strip)

| State | Condition | Copy direction (mate tone) |
|---|---|---|
| **`go`** | Current hour rideable on **actual** data | "Looking good mate — 14 kt, forecast nailed it." |
| **`caution`** | `\|current delta\| ≥ 4 kt` OR rideable on forecast but not on actual | "Forecast said 16 kt — only seeing 10. Might be thin." |
| **`no_go`** | Forecast had rideable window today but actual rideable hours so far are 0 and current wind is below min | "Don't bother mate — forecast oversold it." |
| **`unknown`** | `current: null` | "Can't tell you what's happening right now — don't trust forecast alone." |

These states appear as a pill on the live strip. On **watched session days**, `caution` and `no_go` also render a banner above the spot card in the planner (see Session Watchlist spec).

### Watched-session escalation

When a spot+date is on the user's watchlist and `session_date === today`:

- Poll observations on a **shorter TTL** (2 min vs 5 min default) for watched spots only
- Mismatch warnings use **high** severity regardless of delta band
- Optional morning email: "You marked Lac Saint-Louis for today — live is 8 kt, forecast said 14. Reconsider?"

Implementation of watchlist storage and planner pinning is in [Session Watchlist spec](./2026-09-08-session-watchlist-design.md). Mismatch logic lives here and is consumed by both the rideability matrix and the watchlist UI.

## Session hazards

Extends the core rideability rule in the [parent spec](./2026-09-08-windwatch-design.md#rideability-logic). Wind alone is not enough — rain, storms, and dying wind all affect whether a session is safe or practical.

### Hazard detection (per hour)

**Weather-blocked** — hour is not rideable regardless of wind:

| Signal | Source | Threshold |
|---|---|---|
| Hourly precipitation | Open-Meteo `precipitation` | > **0.1 mm** |
| Weather code | Open-Meteo `weather_code` (WMO) | Rain `61–67`, showers `80–82`, thunderstorm `95–99` |
| Significant weather | Windy `weatherwarnings-surface` | Codes ≥ 61 (rain) or thunderstorm codes `95–96` |

**Wind-blocked** — hour fails on wind alone (already in rideability rule):

| Signal | Threshold |
|---|---|
| Wind speed | < `min_wind_knots` |
| Gusts | > `max_gust_knots` |

### Revised rideability rule

```
windOk     = wind_speed >= min_wind AND gusts <= max_gust
weatherOk  = NOT weatherBlocked(hour)
rideable   = windOk AND weatherOk
```

- A hour can be `windOk` but still not rideable due to weather → **transparent** in matrix (tooltip explains why), not colored.
- Currently weather-blocked → live strip uses **red dot** and hazard label (e.g. `⛈ Thunderstorm` or `🌧 Rain`).

### Session-end warnings

When a **contiguous rideable window** is followed by deteriorating conditions within a lookahead buffer, attach a warning so the user knows to finish **before** getting caught in a storm or stuck with no wind.

**Shared logic:**

1. Build rideable windows from today's hourly data (same as email alerts).
2. For each window end hour `T_end`, scan forward up to `SESSION_WARNING_HOURS` (default **3 h**).
3. On the **first** hazard hour `T_hazard` found, emit a warning (at most one per window — whichever hazard comes first).
4. Suggested finish time = `T_hazard − SESSION_FINISH_BUFFER_MIN` (default **30 min**).

**Hazard types scanned (in time order):**

| Type | Trigger | `type` value |
|---|---|---|
| Storm / rain | First weather-blocked hour after `T_end` | `storm_approaching` |
| Wind fade | First hour where `wind_speed < min_wind_knots` after `T_end` | `wind_fading` |

Wind fade is the mirror of storm warnings: good wind now, but forecast shows it dying soon — plan your exit before you can't get back to shore or stay on foil.

**Example — storm:**

```json
{
  "type": "storm_approaching",
  "severity": "high",
  "eventTime": "2026-09-08T18:00",
  "suggestedFinishBy": "2026-09-08T17:30",
  "message": "Heads up mate — storm around 18:00. Be off the water by 17:30.",
  "afterWindowEnd": "2026-09-08T17:00"
}
```

**Example — wind fading:**

```json
{
  "type": "wind_fading",
  "severity": "medium",
  "eventTime": "2026-09-08T16:00",
  "suggestedFinishBy": "2026-09-08T15:30",
  "message": "Wind's dying below 12 kt around 16:00. Wrap up by 15:30 or you'll be stuck.",
  "afterWindowEnd": "2026-09-08T15:00",
  "windAtEvent": 9
}
```

**Severity:**

| Condition | Severity |
|---|---|
| Thunderstorm (`95–99`) | `high` |
| Heavy rain / showers | `medium` |
| Light rain (`61–63`, precip ≤ 1 mm) | `low` |
| Wind fade (below `min_wind_knots`) | `medium` |
| Wind fade (below `min_wind_knots − 3`) | `high` — critically light |

Warnings appear in:

- Rideability matrix spot card (below model rows)
- Live strip when current hour is in a rideable window with an approaching hazard
- Expanded today's curve — vertical marker at hazard onset time (red = storm, amber = wind fade)
- Email alerts (append warning line when window has a session-end warning)

## Temperature

Air and water temperature matter for session comfort and gear choice (wetsuit thickness, hypothermia risk). Shown at rideable hours; optional user minimums can gate rideability.

### Data sources

| Reading | Source | API | Notes |
|---|---|---|---|
| **Air temp** | Open-Meteo Forecast | `temperature_2m` | °C at 2 m; always available |
| **Feels-like** | Open-Meteo Forecast | `apparent_temperature` | Wind-chill / humidity adjusted; shown in tooltips |
| **Water temp** | Open-Meteo Marine | `sea_surface_temperature` | Best for St. Lawrence, coastal spots |
| **Water temp (fallback)** | Open-Meteo Forecast | `soil_temperature_0cm` + `cell_selection=sea` | Surface-water proxy for lakes/rivers; label as estimated |

Water temp may be `null` when neither source returns a value for the spot. Rideability never blocked on missing water temp — only when a reading exists and is below the user's minimum.

### User preferences

Extend `user_preferences` (see parent spec):

| Field | Type | Default (wingfoil) | Gate when |
|---|---|---|---|
| `min_air_temp_c` | REAL, nullable | `10` | `airTempC < min_air_temp_c` |
| `min_water_temp_c` | REAL, nullable | `8` | `waterTempC` known AND `waterTempC < min_water_temp_c` |

- Set to `null` (or toggle off in UI) to disable that gate — temperature still displayed, not enforced.
- Changing sport resets to sport defaults (user can override after).

**Sport defaults:**

| Sport | Min air (°C) | Min water (°C) |
|---|---|---|
| wingfoiling | 10 | 8 |
| sailing | 5 | null (often dressed for cold) |
| kitesurfing | 12 | 10 |

### Rideability extension

```
tempOk     = airTempC >= min_air_temp_c (when set)
             AND (waterTempC IS NULL OR waterTempC >= min_water_temp_c (when set))
rideable   = windOk AND weatherOk AND tempOk
```

- Hour with good wind but cold temps → transparent block; tooltip shows temp reason.
- `tempOk: false` with `windOk: true` → show temps on tooltip so user can judge override.

### Display at rideable hours

**Live strip** — append when current hour is rideable or wind-OK:

```
[LIVE] 14 kt WSW · gusts 18 kt · 18°C air · 12°C water · updated 12 min ago
```

**Rideable window summary** — below spot name when ≥1 rideable hour today:

```
Best window 14:00–17:00 · 16–19°C air · 11–13°C water
```

Use min–max range across rideable hours in that window. Omit water segment when `waterTempC` unavailable.

**Hour block tooltips:**

```
14:00 — 14 kt WSW, gusts 18 kt · 18°C air (feels 15°C) · 12°C water · rideable
```

**Expanded curve** — optional secondary Y-axis or footer row with air/water temp bands under the wind chart (v1: temp row below chart, no dual axis).

### API fields

Hourly rideability objects gain:

```json
{
  "time": "2026-09-08T14:00",
  "airTempC": 18.2,
  "apparentTempC": 15.1,
  "waterTempC": 12.4,
  "waterTempSource": "marine",
  "tempOk": true
}
```

`waterTempSource`: `"marine"` | `"estimated"` | `null`

Spot-level `today.summary` gains:

```json
"tempSummary": {
  "rideableAirMin": 16,
  "rideableAirMax": 19,
  "rideableWaterMin": 11,
  "rideableWaterMax": 13,
  "waterTempAvailable": true
}
```

`current` object gains `airTempC`, `waterTempC` for the live strip.

## Data model

### `observation_cache`

| Column | Type | Notes |
|---|---|---|
| spot_id | TEXT | PK, FK → spots |
| fetched_at | INTEGER | Unix ms |
| data | TEXT | JSON blob (full observation payload for spot) |

TTL: **5 minutes** (shorter than `forecast_cache` 30 min).

## API

### `GET /api/observations?lat=&lng=&radius=`

Returns live wind and today's comparison for nearby spots (same radius/filter logic as `/api/spots`).

**Response:**

```json
{
  "spots": [
    {
      "spot": {
        "id": "uuid",
        "name": "Lac Saint-Louis",
        "distance_km": 12.4
      },
      "current": {
        "windSpeed": 14.2,
        "gusts": 18.0,
        "direction": "WSW",
        "directionDeg": 250,
        "observedAt": "2026-09-08T15:00",
        "source": "station",
        "stationName": "Lachine Marina",
        "stationDistance_km": 3.2
      },
      "today": {
        "actual": [
          { "time": "2026-09-08T08:00", "windSpeed": 10, "gusts": 14, "direction": "W" }
        ],
        "forecast": [
          {
            "time": "2026-09-08T08:00",
            "windSpeed": 12,
            "gusts": 16,
            "direction": "WSW",
            "airTempC": 14,
            "apparentTempC": 11,
            "waterTempC": 10,
            "waterTempSource": "estimated",
            "rideable": true,
            "windOk": true,
            "weatherOk": true,
            "tempOk": true
          }
        ],
        "warnings": [
          {
            "type": "wind_fading",
            "severity": "medium",
            "eventTime": "2026-09-08T16:00",
            "suggestedFinishBy": "2026-09-08T15:30",
            "message": "Wind's dying below 12 kt around 16:00. Wrap up by 15:30 or you'll be stuck.",
            "afterWindowEnd": "2026-09-08T15:00",
            "windAtEvent": 9
          }
        ],
        "summary": {
          "hoursCompared": 8,
          "avgDeltaKt": -2.3,
          "forecastRideableHours": 6,
          "actualRideableHours": 4,
          "tempSummary": {
            "rideableAirMin": 14,
            "rideableAirMax": 19,
            "rideableWaterMin": 10,
            "rideableWaterMax": 13,
            "waterTempAvailable": true
          }
        }
      }
    }
  ],
  "radius_km": 80,
  "center": { "lat": 45.5, "lng": -73.5 }
}
```

**Field notes:**

- `current.source`: `"station"` | `"open-meteo"` | `"windy"`
- `current` may be `null` if all sources fail for a spot.
- `today.forecast` includes all hours for today (past + future); `today.actual` only past/elapsed hours.
- `today.summary.avgDeltaKt`: mean of `(actual.windSpeed - forecast.windSpeed)` over compared hours.
- `today.summary.mismatch`: `{ state, currentDeltaKt, severity }` — go/no-go pill (see [Forecast vs actual mismatch](#forecast-vs-actual-mismatch)).
- Rideable counts use user preferences (`min_wind_knots`, `max_gust_knots`) **and** weather hazard gate.
- Hourly objects include `windOk`, `weatherOk`, `tempOk`, `rideable`, `airTempC`, `apparentTempC`, `waterTempC`, and optional `weatherCode` / `precipitation`.
- `warnings[]` — session-end alerts (`storm_approaching` or `wind_fading`) for today's rideable windows (may be empty).

### Errors

| Case | HTTP | Behavior |
|---|---|---|
| Missing lat/lng | 400 | `{ "error": "lat and lng required" }` |
| All sources fail globally | 502 | `{ "error": "..." }` |
| Single spot unavailable | 200 | Spot included with `current: null`, empty `today.actual` |

## UI design

### Live strip (always visible on spot card)

Rendered above existing forecast model rows in the rideability matrix:

```
[LIVE] 14 kt WSW · gusts 18 kt · 18°C air · 12°C water · Lachine Marina (3 km) · updated 12 min ago
       Forecast said 16 kt — ▼ 2 kt
```

- Non-rideable hours are transparent; only rideable hours show Beaufort fill.

- **Green dot** — currently rideable (wind + weather OK)
- **Amber dot** — wind OK but weather blocked, or close on wind thresholds
- **Red dot** — active rain/storm now
- **Gray dot** — not rideable (wind)
- **Source badge** — small pill: `Station`, `Open-Meteo`, or `Windy model`
- **Delta line** — current actual vs forecast for the current hour; hidden if no forecast
- **Go/no-go pill** — `go` | `caution` | `no_go` | `unknown` from `today.summary.mismatch`; amber/red background on `caution`/`no_go`
- **Hazard line** — when `warnings` present (mate tone — see parent [Writing style](./2026-09-08-windwatch-design.md#writing-style)), e.g.:
  - `⚠️ Heads up mate — storm around 18:00. Off the water by 17:30.` (red)
  - `⚠️ Wind's dying around 16:00. Wrap up by 15:30.` (amber)

### Expand toggle: "Today's curve"

- Collapsed by default; click to reveal chart per spot.
- **Solid line** — actual wind speed (station or analysis)
- **Dashed line** — primary model forecast
- **Shaded band** — rideable range (between min wind and max gust thresholds)
- X-axis: 00:00–23:00 local; Y-axis: knots
- Past hours show both lines; future hours show forecast only
- **Vertical dashed marker** at first hazard onset after a rideable window (red = storm, amber = wind fade)
- Weather-blocked hours shaded red/purple on the time axis (behind rideable band)
- Gusts shown as a secondary faint line or tooltip on hover (v1: tooltip only to keep chart simple)

### Rideability matrix (hour blocks)

Each hour block uses the **Beaufort wind scale** for color: top half = sustained wind, bottom half = gusts (Bf 0–12). See parent spec UI design.

| Block style | Meaning |
|---|---|
| **Beaufort fill** (wind top / gust bottom) | Rideable |
| **Transparent** (outline only) | Not rideable |
| **Red border** on transparent | Thunderstorm hour, not rideable |

**Preferences panel** — add inputs below wind thresholds:

- Min air temp (°C) — number input + "No limit" toggle
- Min water temp (°C) — number input + "No limit" toggle (hint: "Only enforced when water data available")

Below model rows, show warning banner when any session-end warning exists for today:

```
⚠️ Good until ~15:00 — wind's dying below 12 kt at 16:00. Wrap up by 15:30 mate.
⚠️ Good until ~17:00 — storm around 18:00. Be off the water by 17:30.
```

Multiple warnings may appear if different windows have different hazards.

### Loading & empty states

- Observations load in parallel with rideability; live strip shows skeleton until ready.
- `current: null` → "Can't tell you what's happening right now — forecast's still below"
- No compared hours yet (early morning) → strip shows current only; curve shows forecast line until actual hours accumulate.

## Service modules

| File | Responsibility |
|---|---|
| `src/services/observations.js` | Orchestrate station → analysis fallback, cache read/write, per-spot payload |
| `src/services/openMeteoObservations.js` | Open-Meteo `current` + `past_hours` hourly fetch |
| `src/services/windyObservations.js` | Windy Point Forecast fetch + u/v → speed/direction conversion |
| `src/services/igetwind.js` | Add `fetchNearestStation(lat, lng)` (extend existing module) |
| `src/services/observationCompare.js` | Align timestamps, compute summary stats |
| `src/services/weatherHazards.js` | Precip/storm detection, rideability gate, session-end warnings (storm + wind fade) |
| `src/services/temperature.js` | Fetch air/water temps, tempOk gate, rideable-window temp summaries |
| `src/routes/observations.js` | Express router |
| `public/js/observations.js` | Live strip render, expand/collapse, SVG curve chart |

## Error handling

| Case | Behavior |
|---|---|
| iGetwind station API down | Fall back to Open-Meteo silently |
| No station within 15 km | Use Open-Meteo; badge shows `Open-Meteo` |
| Open-Meteo down | Try Windy if `WINDY_API_KEY` set; else `current: null` |
| Windy down or no API key | `current: null` for affected spots; forecast matrix unaffected |
| Stale observation cache | Serve stale with `stale: true` flag if refresh fails |
| Spot has no forecast cache | Comparison hidden; current wind still shown if available |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OBSERVATION_CACHE_TTL_MS` | `300000` (5 min) | Observation cache TTL |
| `STATION_MAX_DISTANCE_KM` | `15` | Max distance to accept a wx station |
| `WINDY_API_KEY` | _(unset)_ | Windy Point Forecast API key; omit to skip Windy fallback |
| `WINDY_MODEL` | `canHrdps` | Windy model for observation fallback (override per region in code) |
| `SESSION_WARNING_HOURS` | `3` | Lookahead after rideable window end for session-end warnings |
| `SESSION_FINISH_BUFFER_MIN` | `30` | Minutes before hazard onset for suggested finish time |
| `PRECIP_BLOCK_MM` | `0.1` | Hourly precipitation above this blocks rideability |

## Testing checklist

- [ ] Spot with nearby station returns `source: "station"` and station metadata
- [ ] Spot without station returns `source: "open-meteo"`
- [ ] Open-Meteo failure with `WINDY_API_KEY` set falls back to `source: "windy"`
- [ ] Open-Meteo failure without Windy key returns `current: null`
- [ ] `today.summary` counts match manual calculation for a known day
- [ ] Cache hit within 5 min avoids external API calls
- [ ] Stale cache served when upstream fails
- [ ] UI live strip renders rideable indicator correctly
- [ ] `today.summary.mismatch.state` is `no_go` when forecast promised rideable hours but actual elapsed rideable count is 0 and current below min
- [ ] Go/no-go pill shows amber on `caution`, red on `no_go`
- [ ] Expand toggle shows forecast vs actual curve with correct past/future split
- [ ] Parallel fetch does not block rideability matrix render
- [ ] Hour with rain/storm is not rideable even when wind thresholds met
- [ ] Rideable window followed by storm within 3 h emits `storm_approaching` warning
- [ ] Rideable window followed by wind below min within 3 h emits `wind_fading` warning
- [ ] First hazard wins when both storm and wind fade are within buffer
- [ ] Non-rideable hours render transparent; rideable hours show Beaufort colors
- [ ] Live strip shows red dot and hazard label during active storm/rain
- [ ] Rideable hours show air temp in tooltip; water temp when available
- [ ] Hour below `min_air_temp_c` is not rideable (blue-tinted when wind OK)
- [ ] `min_water_temp_c` gates only when `waterTempC` is present
- [ ] Preferences save/load `min_air_temp_c` and `min_water_temp_c`
