# Windmate — Design Spec (MVP + Core Pipeline)

**Date:** 2026-09-08  
**Status:** Approved

## Goal

Build a wind alert and spot tracker for wingfoilers, sailors, kitesurfers, windsurfers, kitefoilers, and parawing riders. Wind is personified as **your mate** — all user-facing text (website, emails, warnings) is written in a casual, direct, second-person tone. MVP dashboard with GPS-based spot discovery, Open-Meteo forecasts, user wind thresholds, scheduled rideability checks, and email alerts. Montreal seed spots; works anywhere via browser GPS.

## User priorities

These drive product decisions beyond the MVP checklist:

1. **Don't drive out on a false forecast** — the worst outcome is forecast looks rideable but live conditions don't match. Realtime comparison to forecast is not decorative; it is how users decide whether to go.
2. **Session watchlist** — mark a spot on a particular day (a planned session) and keep it at the forefront of the Horizon Planner through session day; **daily email** on whether it is still on track or degrading; **auto-remove** after the date passes.
3. **Session-day live validation** — on the day of a watched session, live conditions matter more than forecast-only green blocks. Surface go/no-go clearly when actual wind diverges from what was promised.
4. **Ground-truth enrichment (later)** — webcam feeds at the spot and community chatter (social posts, photos, videos, local reports) would strongly improve confidence before leaving home.
5. **Session spot ranking** — rank spots for a given day using wind **plus** user preferences (avoid offshore, flat vs small vs big waves), proximity, **water quality** (health advisories and **long algae** nuisance for wingfoil), and **water level** — shallow launch / walk-out appeal for foil; **kite launch room** when high on a tight beach — not rideable hours alone.
6. **Local intel beyond forecast** — parking (free vs paid, open on session day), road/site access (seasonal floods, municipal closures), and broader **water conditions** (debris, launch flooding, ice) should **lower rank with a clear explanation**, sourced from official city/park pages and social signals when available.
7. **Leave-home timing** — for a chosen day, combine the best qualifying rideable window (`min_rideable_window_hours` + **`rank_criteria_order`**), **traffic-aware drive time** (Google Maps), and rigging buffer so the spot card shows **when to leave** to be on the water when conditions match your setup — not hours early.
8. **Per-sport setup & alerts** — each sport has its own wind range, radius, session length, ranking order, and **when to email** (e.g. wing any day on the horizon; sailing weekends only).

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
- [Spot Local Intel](./2026-09-09-spot-local-intel-design.md) — social feed, live cams, water hazards, parking, seasonal access; rank lower + explain
- [Departure Planner](./2026-09-09-departure-planner-design.md) — leave-by time from home using rideable window + Google Maps drive duration
- [Per-Sport Preferences & Horizon Alerts](./2026-09-09-per-sport-preferences-alerts-design.md) — independent profiles per sport; horizon email when a good session appears on eligible days
- Reddit/Google forum scraper + Gemini structured parsing (community condition reports)
- Spot webcams (Windy Webcams API or per-spot URLs)

### Related specs

- [Realtime Wind Observations](./2026-09-08-realtime-wind-design.md) — live wind overview per spot, forecast vs actual curve, mismatch warnings
- [Session Watchlist & Ground Truth](./2026-09-08-session-watchlist-design.md) — watched sessions, planner prominence, session-day validation
- [Session Spot Ranking](./2026-09-08-session-ranking-design.md) — rank spots per session day by wind, prefs, distance, water quality, level
- [Spot Local Intel](./2026-09-09-spot-local-intel-design.md) — parking, access, social/official ground truth, ranking penalties
- [Departure Planner](./2026-09-09-departure-planner-design.md) — when to leave home for the best window
- [Per-Sport Preferences & Horizon Alerts](./2026-09-09-per-sport-preferences-alerts-design.md) — sport profiles, per-sport ranking/thresholds, horizon alert scheduling

## Architecture

```
Browser (GPS + Dashboard)
        │  JSON REST
        ▼
Express Server
  ├── /api/spots          → Haversine filter by user lat/lng
  ├── /api/forecast       → Open-Meteo proxy + cache
  ├── /api/rideability    → threshold matching + session rank
  ├── /api/preferences    → active sport + global prefs + sport profiles
  └── public/             → SPA

SQLite
node-cron (every 3h) → horizon scan per sport profile → SMTP digest email
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
| min_launch_depth_m | REAL | nullable — depth at launch line (shore), not whole riding area |
| walk_to_foil_m | REAL | nullable — typical walk/paddle to adequate depth at reference level (wingfoil) |
| launch_beach_size | TEXT | `tight` · `moderate` · `wide` — rigging beach at reference level (kitesurfing) |
| reference_water_level_m | REAL | nullable — hydrometric datum for "normal" beach |
| beach_width_m | REAL | nullable — dry beach width at reference level |
| quality_region_id | TEXT | nullable — bloom/advisory region |
| source_url | TEXT | nullable |

### `user_preferences` (global)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK (single row, id=1) |
| `active_sport` | TEXT | Dashboard default — see [Supported sports](#supported-sports) |
| `favorite_spot_ids` | TEXT | JSON array |
| `alerts_master_enabled` | INTEGER | 0/1 — master switch for horizon emails |

Sport-specific thresholds, radius, window hours, rank order, and alert schedule live on **`sport_profiles`** — see [Per-Sport Preferences & Horizon Alerts](./2026-09-09-per-sport-preferences-alerts-design.md).

### `sport_profiles` (per sport)

| Column | Type | Notes |
|---|---|---|
| sport | TEXT | PK — see [Supported sports](#supported-sports) |
| min_wind_knots, max_gust_knots | INTEGER | Per-sport rideability |
| min_air_temp_c, min_water_temp_c | REAL | nullable |
| offshore_wind_ok | INTEGER | 0/1 |
| wave_preference | TEXT | `flat` · `small` · `any` · `big` |
| min_foil_depth_cm | INTEGER | nullable |
| radius_km | INTEGER | Search + alert scan radius |
| min_rideable_window_hours | INTEGER | Min consecutive rideable hours |
| rank_criteria_order | TEXT | JSON — see [Session Ranking](./2026-09-08-session-ranking-design.md) |
| alert_enabled | INTEGER | 0/1 |
| alert_schedule | TEXT | JSON — horizon days, eligible weekdays |

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
| GET | `/api/preferences` | Global prefs + all sport profiles |
| PUT | `/api/preferences` | Update global fields (`active_sport`, favorites, …) |
| PUT | `/api/preferences/sports/:sport` | Update one sport profile |
| GET | `/api/health` | Health check |

## Rideability logic

A hour is **rideable** when wind thresholds are met **and** weather is safe:

```
windOk     = wind_speed >= min_wind AND gusts <= max_gust
weatherOk  = NOT (precipitation > 0.1 mm OR weather_code in rain/storm set)
tempOk     = airTempC >= min_air_temp_c (when set)
             AND (waterTempC unknown OR waterTempC >= min_water_temp_c (when set))
daylightOk = hour start >= sunrise AND < sunset (Open-Meteo daily, spot-local TZ)
rideable   = windOk AND weatherOk AND tempOk AND daylightOk [AND directionOk when offshore gate on]
```

Night hours stay **transparent** in the matrix and do **not** count toward rideable hours or shared windows.

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

**Horizon digest (v2)** — per [Per-Sport Preferences & Horizon Alerts](./2026-09-09-per-sport-preferences-alerts-design.md): one email listing qualifying sessions per sport (e.g. wing Thursday + sailing Saturday), each evaluated with that sport's thresholds, radius, window length, and rank score. Only on **eligible days** per sport (`any day` vs `weekends only`, etc.).

**Today / legacy** — subject: `Mate, [Spot Name] is on today 🌬️`

```
Hey mate — it's blowing at [Spot Name].
[Wind Speed] kts from [Direction], [Start Hour]–[End Hour].
Worth a look.
[Air Temp]°C air[ / [Water Temp]°C water].

⚠️ [Optional] Heads up mate — storm around [Time]. Be off the water by [Finish By].
⚠️ [Optional] Wind's dying below [Min] kt around [Time]. Wrap up by [Finish By] or you'll be stuck.
```

Superseded by horizon digest when per-sport alerts ship; kept when `today_alerts` is on and today matches the sport's day filter.

## UI design

- **Tagline:** "Your wind mate — spots, sessions, and heads-ups"
- **Palette:** `#0b0f19` background, `#0f1422` cards, accent by sport
- **Horizon Planner:** 7-day forecast cards; CSS `blur()` increases on days 4–7
- **Rideability Matrix:** good hours use 3 bands — Beaufort wind (top), gust (mid), waves flat/small/big (bottom); wave height in tooltip; empty = not good; **window stats line** on each spot card — min–max wind, gust, and wave (m) during the solid opaque shared window only (not faded isolated hours)
- **Sport switcher:** dashboard dropdown with horizon dots — see [Sport Selector](./2026-09-09-sport-selector-design.md); sets `active_sport` profile for matrix + planner
- **Preferences panel:** tab per sport — min wind, max gust, min air/water temp, **offshore toggle**, **wave preference**, optional **foil depth**, **radius**, **min window hours**, **rank criteria order**, **alert schedule** (horizon + eligible days)
- **Spot ranking:** matrix sorted by composite [session score](./2026-09-08-session-ranking-design.md) (#1 = best for your prefs that day), not raw rideable hours alone
- **Location:** browser Geolocation with manual lat/lng fallback

## Supported sports

Canonical slugs (DB, API, UI): `wingfoiling` · `sailing` · `kitesurfing` · `windsurfing` · `kitefoiling` · `parawing`

| Slug | Display | Accent |
|---|---|---|
| `wingfoiling` | Wingfoiling | Emerald |
| `sailing` | Sailing | Teal |
| `kitesurfing` | Kitesurfing | Blue |
| `windsurfing` | Windsurfing | Cyan |
| `kitefoiling` | Kitefoiling | Violet |
| `parawing` | Parawing | Amber |

Source of truth for defaults and colours: `src/utils/sports.js`.

## Default preferences by sport

| Sport | Min wind (kt) | Max gust (kt) | Min air (°C) | Min water (°C) | Waves (default) |
|---|---|---|---|---|---|
| wingfoiling | 12 | 25 | 10 | 8 | flat |
| sailing | 8 | 30 | 5 | — | any |
| kitesurfing | 14 | 28 | 12 | 10 | small |
| windsurfing | 10 | 28 | 8 | 8 | small |
| kitefoiling | 12 | 25 | 10 | 8 | flat |
| parawing | 10 | 22 | 10 | 8 | flat |

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
