# Windmate — Spec Implementation Status

**Last reviewed:** 2026-09-09

Use this alongside the design specs. Legend: ✅ Done · 🟡 Partial · ❌ Not done

---

## Summary

| Spec | Overall |
|------|---------|
| [windwatch-design](./2026-09-08-windwatch-design.md) (MVP) | **~85%** — core pipeline shipped |
| [realtime-wind-design](./2026-09-08-realtime-wind-design.md) | **~75%** — observations live; go/no-go UX missing |
| [session-ranking-design](./2026-09-08-session-ranking-design.md) | **~40%** — client rank + banners; server + env factors missing |
| [session-watchlist-design](./2026-09-08-session-watchlist-design.md) | **~5%** — favorites only; no spot+date watchlist |
| [spot-local-intel-design](./2026-09-09-spot-local-intel-design.md) | **0%** — spec only (social, parking, access, water hazards) |
| [departure-planner-design](./2026-09-09-departure-planner-design.md) | **0%** — spec only (leave-by + Google Maps drive) |
| [per-sport-preferences-alerts](./2026-09-09-per-sport-preferences-alerts-design.md) | **0%** — spec only (sport profiles, horizon alerts) |
| [sport-selector](./2026-09-09-sport-selector-design.md) | **0%** — spec only (dashboard dropdown + horizon dots) |
| [session-lift-share](./2026-09-09-session-lift-share-design.md) | **0%** — spec only (watched-session lift matching + email intro) |

**Also shipped (not in original MVP):** settings modal, auto-save prefs, spot search, favorites (incl. out-of-radius), customizable radius, Beaufort matrix colors, 3-band wind/gust/wave blocks, session warning time fix.

---

## 1. MVP — `2026-09-08-windwatch-design.md`

### ✅ Done

- Express + SQLite + static SPA
- Geolocation, Haversine, manual coords, IP fallback
- Open-Meteo + mixed models (iGetwind LAM/HRRR/GFS)
- Rideability (wind, gust, rain/storm, air/water temp)
- Session-end warnings (storm / wind fade)
- Cron email alerts (3h)
- Horizon Planner (7-day, blur 4–7)
- Rideability Matrix (multi-model rows, transparent non-rideable hours)
- APIs: `/api/spots`, `/api/spots/search`, `/api/forecast`, `/api/rideability`, `/api/observations`, `/api/preferences`, `/api/health`
- Mate-tone copy (`copy.js`)

### 🟡 Partial

- **Session ranking on matrix** — client `sessionRank.js` only; not in API response
- **Mate's picks** — uses ranking; not full spec hero (flat/onshore/bloom context)
- **Spot metadata** — `ideal_directions` only; missing offshore/onshore, shore exposure, water body, quality region
- **User priority #1 (false forecast)** — observations exist; go/no-go pill not wired

### ❌ Not done

- Session watchlist (spot + date) → see watchlist spec
- Offshore gating in rideability
- Water quality / water level ranking
- Web Push, Supabase, Reddit/Gemini parser, spot webcams

---

## 2. Realtime Wind — `2026-09-08-realtime-wind-design.md`

### ✅ Done

- `GET /api/observations` (parallel with rideability)
- Live strip on matrix cards (all days)
- Forecast vs actual SVG curve + expand toggle
- iGetwind station → Open-Meteo → Windy fallback chain
- `observation_cache` (5 min TTL), stale fallback
- Comparison stats (hours compared, avg delta, rideable counts)
- Hazard gate, session warnings in UI + email
- Air/water temp on hours, tooltips, live strip
- Source badges, live dots, storm-hour matrix outline
- Module layout per spec (`observations.js`, `weatherHazards.js`, etc.)

### 🟡 Partial

- **Forecast vs actual mismatch** — data computed; no `go` / `caution` / `no_go` state machine
- **Go/no-go pill** on live strip — not built
- Temp-below-min distinct matrix block style (blue tint) — tooltip/dot only
- Loading skeleton per live strip
- Windy weather warnings supplement

### ❌ Not done

- Watched-session escalation (2 min TTL, planner banners) — needs watchlist
- Session-day morning mismatch email for watched sessions
- Multi-model curve overlay (spec: out of scope — OK)

---

## 3. Session Ranking — `2026-09-08-session-ranking-design.md`

### ✅ Done

- `rank_criteria_order` in DB + API + settings UI (drag reorder, auto-save)
- Client composite score (6 factors) + matrix sort
- Rank `#N` + top-reason banners (“Closest”, “Best wind”, …)
- Wave height in tooltips + matrix bottom third (marine + wind estimate)
- Wave band scoring (flat/small/big)
- **Favorites** sort first (preserve relative rank within groups)

### 🟡 Partial

- **Wave preference** — inferred from sport in JS; not in DB/UI
- **Onshore scoring** — uses `idealWind` / `ideal_directions`; not true offshore/onshore model
- **Wave in best window** — averages all rideable hours, not longest window max
- **Proximity** — works in score; no dedicated pref flag
- **`sessionRank` in API** — client-only today

### ❌ Not done

- `offshore_wind_ok`, `min_foil_depth_cm` prefs + UI
- Spot columns: `onshore_directions`, `shore_exposure`, `water_body_*`, `quality_region_id`, …
- `src/services/offshore.js` + striped offshore matrix blocks
- `spot_quality_cache` + `waterQuality.js`
- `spot_level_cache` + `waterLevel.js`
- Server `sessionRank.js` + payload on `/api/rideability`
- Water quality hard-block (`closed`)
- Live session-day score multiplier
- Manual quality cache for seed spots (v1 proof)
- Automated tests for ranking

---

## 4. Session Watchlist — `2026-09-08-session-watchlist-design.md`

### ✅ Done

- *(none for watchlist core)*

**Related (not watchlist):** favorites (`favorite_spot_ids`), search, out-of-radius inclusion via favorites.

### 🟡 Partial

- Live strip on matrix today — not tied to watched session dates
- Favorites pin spots in matrix — not planner date pins

### ❌ Not done (v1)

- `watched_sessions` table
- `GET/POST/DELETE /api/watchlist`, `GET /api/watchlist/today`
- Star on planner day → add watch
- Pin strip above Horizon Planner
- Session-day expanded panel
- Mismatch banners escalated for watched sessions
- Daily watchlist status digest email (on track / degrading / no_go)
- `last_status`, `status_snapshot`, trend detection
- Auto-purge rows when `session_date < today` (no past watches)
- `sport` per watched session; status pill on planner card
- Env: `WATCHLIST_DIGEST_EMAIL_HOUR`, `WATCHLIST_PURGE_HOUR`, `WATCHED_OBSERVATION_TTL_MS`

### ❌ Not done (v2 ground truth)

- Webcam embed (`webcam_url`, `windy_webcam_id`)
- Community signals (Reddit, Gemini, manual notes)
- Lazy-load webcam iframe

---

## Recommended build order (user priorities)

Aligns with [user priorities](./2026-09-08-windwatch-design.md#user-priorities):

| Order | Work | Spec | Why |
|-------|------|------|-----|
| **1** | Go/no-go mismatch state + pill on live strip | Realtime | Priority #1 — finish before driving out |
| **2** | Session watchlist v1 (DB, API, planner pin, session-day panel) | Watchlist | Priority #2–3 |
| **3** | Mismatch escalation + daily watchlist status digest + midnight purge | Watchlist + Realtime | Priority #3 |
| **4** | Offshore pref + detection + matrix stripes | Ranking | Safety before distance/waves |
| **5** | Wave preference in settings + `sessionRank` on API | Ranking | Persist ranking; enable non-JS clients |
| **6** | Water quality manual cache (2–3 Quebec lakes) | Ranking | Priority #5, v1 manual proof |
| **7** | Water level — wingfoil walk-out + kite launch beach; nuisance algae | Ranking | Appeal vs other spots; not just hard blocks |
| **8** | Webcams + community signals | Watchlist v2 | Priority #4 ground truth |
| **9** | Spot local intel v1 (manual cache, parking/access metadata, rank penalties) | [Local Intel](./2026-09-09-spot-local-intel-design.md) | Priority #6 — don't drive to closed lot/flooded road |
| **10** | Official + social ingestion, Gemini parser | Local Intel v2–v3 | Richer feed; corroborated access/water signals |
| **11** | Departure planner v1 (leave-by, Google Maps, spot card) | [Departure Planner](./2026-09-09-departure-planner-design.md) | Priority #7 — leave time for min hours + best window per `rank_criteria_order` |
| **12** | Per-sport profiles (DB, API, settings tabs) | [Per-Sport Prefs](./2026-09-09-per-sport-preferences-alerts-design.md) | Prerequisite for sport selector + horizon alerts |
| **13** | Dashboard sport selector + `GET /api/sports/horizon-summary` | [Sport Selector](./2026-09-09-sport-selector-design.md) | Switch sports without Settings; glance at horizon per sport |
| **14** | Optional auth (local default) | [Lift Share](./2026-09-09-session-lift-share-design.md) | Login only for cloud sync, **email notifications**, or lift share; verified email for all outbound mail |
| **15** | Session lift share v1 (opt-in, request, accept, email intro) | [Session Lift Share](./2026-09-09-session-lift-share-design.md) | Connect nearby watchers on same session day |

---

## 6. Departure Planner — `2026-09-09-departure-planner-design.md`

### ✅ Done

- *(none)*

### 🟡 Partial

- **`min_rideable_window_hours`** — in DB, settings, window marking (`rideableWindow.js`)
- **Best window display** — matrix consensus windows; no leave-by line yet
- **User lat/lng** — browser GPS / manual coords; no persisted `home_*` prefs

### ❌ Not done

- `GET /api/departure`, `travel_time_cache`
- Google Maps Routes / Distance Matrix integration
- `rig_minutes`, `home_lat/lng` prefs + settings UI
- Spot card "Leave by …" line
- Session-day `leave_now` / `in_window` states
- Haversine drive fallback + mate copy

---

## 5. Spot Local Intel — `2026-09-09-spot-local-intel-design.md`

### ✅ Done

- *(none)*

### 🟡 Partial

- **Water quality in ranking spec** — algae/advisory levels defined in session-ranking; not wired in app
- **Webcam / community in watchlist spec** — design only; overlaps this spec

### ❌ Not done

- `spot_intel_cache`, `intel_sources`, parking/access spot columns
- `GET /api/spots/:spotId/intel`
- Intel panel UI (social thumbnails, cam, parking, access)
- Access/parking ranking factors + hard blocks
- Official municipal page parsers
- Social aggregation (Reddit, Instagram/Facebook links, Gemini extract)
- Session-day intel TTL + watchlist email line

---

## 7. Session Lift Share — `2026-09-09-session-lift-share-design.md`

### ✅ Done

- *(none)*

### 🟡 Partial

- **SMTP email** — existing nodemailer path reusable for intro emails
- **Home coords / Haversine** — same primitives as spots + departure planner (when shipped)

### ❌ Not done

- Multi-user auth (`users`, `user_sessions`, `auth_tokens`) — email/password, Argon2id, verify + reset flows
- Per-user `watched_sessions.user_id`
- `user_lift_preferences`, `lift_requests` tables
- Lift settings UI (driver opt-in, radius)
- Request / inbox / accept API + first-accept-wins match
- Watched session "Need a lift" + driver inbox UI
- Intro email on match; purge with watchlist expiry

---

## Quick reference — cross-cutting features

| Feature | Status |
|---------|--------|
| Matrix 3-band (wind/gust/wave) | ✅ |
| Transparent non-rideable blocks | ✅ |
| Settings modal + auto-save | ✅ |
| Search spots + favorite star | ✅ |
| Custom radius | ✅ |
| Live strip (all matrix days) | ✅ |
| Session warnings (storm/fade) | ✅ |
| Watchlist (spot + date) | ❌ |
| Go/no-go pill | ❌ |
| Offshore / water quality / level | ❌ |
| Server `sessionRank` | ❌ |
| Webcams / community | ❌ |
| Spot local intel (parking, access, social) | ❌ |
| Departure planner (leave-by + drive time) | ❌ |
| Min consecutive hours (settings) | ✅ |
| Per-sport profiles | ❌ |
| Dashboard sport selector + horizon dots | ❌ |
| Session lift share (driver opt-in, request, accept, email intro) | ❌ |
