# Windmate — Design Spec (MVP + Core Pipeline)

**Date:** 2026-09-08  
**Status:** Approved

## Goal

Build a wind alert and spot tracker for sailors, wingfoilers, and kitesurfers. Wind is personified as **your mate** — all user-facing text (website, emails, warnings) is written in a casual, direct, second-person tone. MVP dashboard with GPS-based spot discovery, Open-Meteo forecasts, user wind thresholds, scheduled rideability checks, and email alerts. Montreal seed spots; works anywhere via browser GPS.

## User priorities

These drive product decisions beyond the MVP checklist:

1. **Don't drive out on a false forecast** — the worst outcome is forecast looks rideable but live conditions don't match. Realtime comparison to forecast is not decorative; it is how users decide whether to go.
2. **Session watchlist** — mark a spot on a particular day (a planned session) and keep it at the forefront of the Horizon Planner until the session passes.
3. **Session-day live validation** — on the day of a watched session, live conditions matter more than forecast-only green blocks. Surface go/no-go clearly when actual wind diverges from what was promised.
4. **Ground-truth enrichment (later)** — webcam feeds at the spot and community chatter (social posts, local reports on conditions or nearby spots) would strongly improve confidence before leaving home.
5. **Session spot ranking** — rank spots for a given day using wind **plus** user preferences (avoid offshore, flat vs small vs big waves), proximity, **water quality** (e.g. cyanobacteria on Quebec lakes), and **water level** for foiling depth — not rideable hours alone.

## Scope

### In scope (v1)

- Express monolith serving REST API + static SPA
- SQLite persistence (`spots`, `user_preferences`, `forecast_cache`)
- Browser geolocation + Haversine distance filtering
- Open-Meteo hourly wind/gust forecast proxy with cache
- Rideability engine: `wind_speed >= min_wind AND gusts <= max_gust`
- `node-cron` every 3 hours → email alert on rideable windows
- Dark dashboard: Horizon Planner (7-day, blur days 4–7) + Rideability Matrix
- Montreal seed spots (~8)

### Out of scope (later)

- Supabase/PostgreSQL
- Web Push notifications
- Automated provincial water-quality ingestion (manual cache first — see Session Ranking spec)

### Planned (post-MVP)

See dedicated specs for detail:

- [Session Watchlist & Ground Truth](./2026-09-08-session-watchlist-design.md) — pin planned sessions in the planner, session-day go/no-go, webcams, community signals
- [Session Spot Ranking](./2026-09-08-session-ranking-design.md) — offshore/wave prefs, water quality, water level, composite score per day
- Reddit/Google forum scraper + Gemini structured parsing (community condition reports)
- Spot webcams (Windy Webcams API or per-spot URLs)

### Related specs

- [Realtime Wind Observations](./2026-09-08-realtime-wind-design.md) — live wind overview per spot, forecast vs actual curve, mismatch warnings
- [Session Watchlist & Ground Truth](./2026-09-08-session-watchlist-design.md) — watched sessions, planner prominence, session-day validation
- [Session Spot Ranking](./2026-09-08-session-ranking-design.md) — rank spots per session day by wind, prefs, distance, water quality, level

## Architecture

```
Browser (GPS + Dashboard)
        │  JSON REST
        ▼
Express Server
  ├── /api/spots          → Haversine filter by user lat/lng
  ├── /api/forecast       → Open-Meteo proxy + cache
  ├── /api/rideability    → threshold matching + session rank
  ├── /api/preferences    → sport + wind limits
  └── public/             → SPA

SQLite
node-cron (every 3h) → rideability → SMTP email
```

## Tech stack

- **Runtime:** Node.js 20+
- **Server:** Express 4
- **Database:** SQLite via `better-sqlite3`
- **Scheduler:** `node-cron`
- **Frontend:** HTML5, Tailwind CSS (CDN), vanilla JS
- **External APIs:** Open-Meteo Forecast, SMTP (via nodemailer)

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default 3000) |
| `SMTP_HOST` | No* | SMTP server hostname |
| `SMTP_PORT` | No | SMTP port (default 587) |
| `SMTP_SECURE` | No | TLS on port 465 when `true` |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `ALERT_EMAIL_FROM` | No | Sender address |
| `ALERT_EMAIL_TO` | No* | Alert recipient |

*Email alerts skipped gracefully if unset.

## Data model

### `spots`

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | PK |
| name | TEXT | |
| latitude | REAL | |
| longitude | REAL | |
| ideal_directions | TEXT | JSON array, e.g. `["W","WNW"]` |
| onshore_directions | TEXT | JSON array — dirs that blow onshore (for offshore detection); see [Session Ranking spec](./2026-09-08-session-ranking-design.md) |
| shore_exposure | TEXT | `sheltered` · `moderate` · `open` |
| water_body_type | TEXT | `lake` · `river` · `estuary` · `coastal` |
| water_body_id | TEXT | nullable — hydrometric station id |
| min_launch_depth_m | REAL | nullable — min depth to launch foil at spot |
| quality_region_id | TEXT | nullable — bloom/advisory region |
| source_url | TEXT | nullable |

### `user_preferences`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK (single row, id=1) |
| sport | TEXT | `wingfoiling`, `sailing`, `kitesurfing` |
| min_wind_knots | INTEGER | |
| max_gust_knots | INTEGER | |
| min_air_temp_c | REAL | nullable — no gate when null |
| min_water_temp_c | REAL | nullable — no gate when null; only enforced when water temp data exists |
| offshore_wind_ok | INTEGER | 0/1 — default 0 (avoid offshore); see [Session Ranking spec](./2026-09-08-session-ranking-design.md) |
| wave_preference | TEXT | `flat` · `small` · `any` · `big` |
| min_foil_depth_cm | INTEGER | nullable — mast + margin for water level checks |

### `forecast_cache`

| Column | Type | Notes |
|---|---|---|
| spot_id | TEXT | PK, FK → spots |
| fetched_at | INTEGER | Unix ms |
| data | TEXT | JSON blob from Open-Meteo |

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/spots?lat=&lng=&radius=` | Nearby spots sorted by distance |
| GET | `/api/forecast/:spotId` | Cached hourly forecast |
| GET | `/api/rideability?lat=&lng=&radius=` | Rideable hours per nearby spot, sorted by [session rank](./2026-09-08-session-ranking-design.md) |
| GET | `/api/preferences` | Current user preferences |
| PUT | `/api/preferences` | Update sport + thresholds |
| GET | `/api/health` | Health check |

## Rideability logic

A hour is **rideable** when wind thresholds are met **and** weather is safe:

```
windOk     = wind_speed >= min_wind AND gusts <= max_gust
weatherOk  = NOT (precipitation > 0.1 mm OR weather_code in rain/storm set)
tempOk     = airTempC >= min_air_temp_c (when set)
             AND (waterTempC unknown OR waterTempC >= min_water_temp_c (when set))
rideable   = windOk AND weatherOk AND tempOk
```

**Weather-blocked codes** (Open-Meteo WMO): rain `61–67`, showers `80–82`, thunderstorm `95–99`.

Ideal wind direction is shown as a UI highlight when direction matches `ideal_directions`; not a hard gate in v1. **Offshore** hours are gated per user preference — see [Session Spot Ranking](./2026-09-08-session-ranking-design.md#offshore-detection).

### Session-end warnings

When a rideable window is followed by deteriorating conditions within **3 hours**, surface a warning so users plan to finish before getting caught in a storm or stuck with no wind:

- **`storm_approaching`** — rain/thunderstorm forecast after the window
- **`wind_fading`** — wind dropping below `min_wind_knots` after the window

See [Realtime Wind spec — Session hazards](./2026-09-08-realtime-wind-design.md#session-hazards) for full rules, UI, and API fields.

### Temperature

Air and water temperature shown at rideable hours. Optional `min_air_temp_c` and `min_water_temp_c` preferences gate rideability when set. See [Realtime Wind spec — Temperature](./2026-09-08-realtime-wind-design.md#temperature).

## Writing style

Windmate speaks as **your wind mate** — written copy only (no speech/audio). The wind is personified as a session buddy who texts you heads-ups.

**Tone:** casual, direct, second person (`you`), occasional `mate`. Confident but not hypey. Short sentences.

**Do:**
- "Hey mate — it's blowing at Lac Saint-Louis."
- "Bit quiet round here — no spots in range."
- "Heads up — storm around 18:00. Be off the water by 17:30."

**Don't:**
- Corporate: "Automated wind alert notification"
- Alarmist: "🚨 CRITICAL WIND EVENT"
- Robotic: "Rideability matrix data unavailable"

**Centralized copy:**
- Server emails: `src/utils/copy.js`
- Website UI: `public/js/copy.js`

All new user-facing strings go through these modules so tone stays consistent.

## Email alert format

Subject: `Mate, [Spot Name] is on today 🌬️`

Body:
```
Hey mate — it's blowing at [Spot Name].
[Wind Speed] kts from [Direction], [Start Hour]–[End Hour].
Worth a look.
[Air Temp]°C air[ / [Water Temp]°C water].

⚠️ [Optional] Heads up mate — storm around [Time]. Be off the water by [Finish By].
⚠️ [Optional] Wind's dying below [Min] kt around [Time]. Wrap up by [Finish By] or you'll be stuck.
```

Sent when cron finds ≥1 rideable hour today for a spot.

## UI design

- **Tagline:** "Your wind mate — spots, sessions, and heads-ups"
- **Palette:** `#0b0f19` background, `#0f1422` cards, accent by sport
- **Horizon Planner:** 7-day forecast cards; CSS `blur()` increases on days 4–7
- **Rideability Matrix:** good hours use 3 bands — Beaufort wind (top), gust (mid), waves flat/small/big (bottom); wave height in tooltip; empty = not good
- **Preferences panel:** sport selector, min wind, max gust, min air/water temp, **offshore toggle**, **wave preference**, optional **foil depth**
- **Spot ranking:** matrix sorted by composite [session score](./2026-09-08-session-ranking-design.md) (#1 = best for your prefs that day), not raw rideable hours alone
- **Location:** browser Geolocation with manual lat/lng fallback

## Default preferences by sport

| Sport | Min wind (kt) | Max gust (kt) | Min air (°C) | Min water (°C) |
|---|---|---|---|---|
| wingfoiling | 12 | 25 | 10 | 8 |
| sailing | 8 | 30 | 5 | — |
| kitesurfing | 14 | 28 | 12 | 10 |

(— = no default water temp gate)

## Montreal seed spots

1. Lac Saint-Louis (Lachine)
2. Baie-de-Valois (Salaberry-de-Valois)
3. Hudson Beach
4. Oka Beach
5. Carillon (Ottawa River)
6. Beauharnois
7. Saint-Timothée
8. Verdun Waterfront
9. Venise-en-Québec
10. Plattsburgh (Cumberland Bay)
11. Anse-à-l'Orme
12. Saint-Placide
13. Pointe-du-Lac (Trois-Rivières)

## Error handling

- Missing email config: log warning, skip alerts
- Open-Meteo failure: return 502 with message, serve stale cache if available
- GPS denied: show manual coordinate inputs
- Empty nearby spots: show message suggesting wider radius
