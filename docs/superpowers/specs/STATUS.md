# Windmate — Spec Implementation Status

**Last reviewed:** 2026-09-09 (evening pass — watchlist, favorites, go/no-go, per-sport)

Use this alongside the design specs. Legend: ✅ Done · 🟡 Partial · ❌ Not done

---

## Summary

| Spec | Overall |
|------|---------|
| [windwatch-design](./2026-09-08-windwatch-design.md) (MVP) | **~90%** — core pipeline + watchlist + go/no-go shipped |
| [realtime-wind-design](./2026-09-08-realtime-wind-design.md) | **~88%** — observations + go/no-go pill wired |
| [session-ranking-design](./2026-09-08-session-ranking-design.md) | **~55%** — client rank + offshore gating; server rank + env factors missing |
| [session-watchlist-design](./2026-09-08-session-watchlist-design.md) | **~88%** — v1 shipped; email/auth + planner day-cell pending |
| [spot-local-intel-design](./2026-09-09-spot-local-intel-design.md) | **0%** — spec only (social, parking, access, water hazards) |
| [departure-planner-design](./2026-09-09-departure-planner-design.md) | **0%** — spec only (leave-by + Google Maps drive) |
| [per-sport-preferences-alerts](./2026-09-09-per-sport-preferences-alerts-design.md) | **~90%** — profiles, tabs, horizon cron, per-sport favorites; no auth gate for email |
| [sport-selector](./2026-09-09-sport-selector-design.md) | **~90%** — dropdown + horizon-summary API; v2 day label pending |
| [session-lift-share](./2026-09-09-session-lift-share-design.md) | **0%** — spec only (watched-session lift matching + email intro) |
| [session-watcher-count](./2026-09-09-session-watcher-count-design.md) | **0%** — spec only (banded social proof on matrix cards) |

**Also shipped (not in original MVP):** settings modal, auto-save prefs, spot search, **per-sport favorites** (incl. out-of-radius), customizable radius, Beaufort matrix colors, 3-band wind/gust/wave blocks, session warning time fix, **sport-scoped watchlist** (spot + date + sport), watchlist card navigation, eye icon for watch vs ★ for favorite, per-sport horizon alert cron.

---

## 1. MVP — `2026-09-08-windwatch-design.md`

### ✅ Done

- Express + SQLite + static SPA
- Geolocation, Haversine, manual coords, IP fallback
- Open-Meteo + mixed models (iGetwind LAM/HRRR/GFS)
- Rideability (wind, gust, rain/storm, air/water temp, **offshore gating**)
- Session-end warnings (storm / wind fade)
- Per-sport horizon alert cron (`horizonAlertScheduler.js`; legacy 3h `alertScheduler.js` not started)
- Horizon Planner (7-day, blur 4–7)
- Rideability Matrix (multi-model rows, transparent non-rideable hours)
- APIs: `/api/spots`, `/api/spots/search`, `/api/forecast`, `/api/rideability`, `/api/observations`, `/api/preferences`, `/api/sports`, `/api/watchlist`, `/api/health`
- Mate-tone copy (`copy.js`)
- Go/no-go mismatch pill on live strip (see Realtime spec)
- Session watchlist v1 (see Watchlist spec)

### 🟡 Partial

- **Session ranking on matrix** — client `sessionRank.js` only; not in API response
- **Mate's picks** — uses ranking; not full spec hero (flat/onshore/bloom context)
- **Spot metadata** — `ideal_directions` only; missing dedicated onshore sectors, shore exposure, water body, quality region

### ❌ Not done

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
- **Go/no-go state machine** (`mismatch.js`) — `go` / `caution` / `no_go` / `unknown`
- **Go/no-go pill** on live strip + escalated banner for watched sessions

### 🟡 Partial

- Temp-below-min distinct matrix block style (blue tint) — tooltip/dot only
- Loading skeleton per live strip
- Windy weather warnings supplement
- Dedicated session-day morning mismatch email (digest includes live line when SMTP configured)

### ❌ Not done

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
- **`offshore_wind_ok`** per sport profile + settings UI
- **`src/services/offshore.js`** — wind exposure classification + rideability gate
- Offshore matrix hour styling + direction legend (`offshore-hour`, `matrix-direction--offshore`)

### 🟡 Partial

- **Wave preference** — stored per sport profile in DB; inferred from sport in JS; no settings UI
- **Onshore scoring** — uses `idealWind` / `ideal_directions`; not full onshore sector model from spec
- **Wave in best window** — averages all rideable hours, not longest window max
- **Proximity** — works in score; no dedicated pref flag
- **`sessionRank` in API** — client-only on matrix; server `sessionRank.js` used in alert/watchlist qualification
- **`min_foil_depth_cm`** — column on `sport_profiles`; no settings UI or ranking hook

### ❌ Not done

- Spot columns: `onshore_directions`, `shore_exposure`, `water_body_*`, `quality_region_id`, …
- `spot_quality_cache` + `waterQuality.js`
- `spot_level_cache` + `waterLevel.js`
- Server `sessionRank` payload on `/api/rideability`
- Water quality hard-block (`closed`)
- Live session-day score multiplier
- Manual quality cache for seed spots (v1 proof)
- Automated tests for ranking

---

## 4. Session Watchlist — `2026-09-08-session-watchlist-design.md`

### ✅ Done

- `watched_sessions` table (single-user local install)
- Unique constraint **`(spot_id, session_date, sport)`** — same spot+day watchable per sport
- `GET/POST/DELETE /api/watchlist`, `GET /api/watchlist/today`
- Eye-icon watch on matrix card (spot + selected day + **active sport**)
- Pin strip above Horizon Planner with status pills
- **Clickable watch cards** — navigate to spot + day (+ sport switch)
- Session-day live strip + go/no-go banner (escalated mismatch)
- `watchlistStatus.js` — `last_status`, `status_snapshot`, trend detection
- Daily watchlist digest cron + midnight purge (`watchlistDigest.js`)
- `sport` per watched session; 2 min observation TTL for watched spots on session day
- Env: `WATCHLIST_DIGEST_EMAIL_HOUR`, `WATCHLIST_PURGE_HOUR`, `WATCHED_OBSERVATION_TTL_MS`

**Related (not watchlist):** per-sport favorites (`sport_profiles.favorite_spot_ids`), search, out-of-radius inclusion via favorites.

### 🟡 Partial

- Email requires SMTP + verified account not yet wired (local digest logs to console)
- Planner day-cell watch control (matrix eye icon only today)
- Watched spot with 0 rideable hours may not appear in matrix when navigating from strip

### ❌ Not done (v1 gaps)

- Cloud sync / multi-user `user_id` on watched sessions

### ❌ Not done (v2 ground truth)

- Webcam embed (`webcam_url`, `windy_webcam_id`)
- Community signals (Reddit, Gemini, manual notes)
- Lazy-load webcam iframe

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

## 7. Per-Sport Preferences & Alerts — `2026-09-09-per-sport-preferences-alerts-design.md`

### ✅ Done

- `sport_profiles` table — one row per sport
- Per-sport rideability prefs (wind, gust, temp, offshore, radius, min window, rank order)
- `active_sport` on `user_preferences` + dashboard sport switcher
- Settings UI — tab per sport, auto-save via `PUT /api/preferences/sports/:sport`
- Migration from legacy single-row prefs
- Per-sport alert schedule (`alert_enabled`, `alert_schedule` with `days_of_week`, horizon days)
- `horizonAlertScheduler.js` — per-sport horizon scan + email digest
- `alertQualification.js` + `sessionRank.js` for alert qualification
- **`favorite_spot_ids` per sport profile** (shipped ahead of spec v3)

### 🟡 Partial

- Email requires SMTP; no account / email-verify gate before enabling alerts
- `alerts_master_enabled` in DB; limited UI exposure
- Snooze / quiet hours, "new since last alert" dedup — not done

### ❌ Not done

- Cloud multi-user alert routing (`users.email`)
- Push notifications

---

## 8. Sport Selector — `2026-09-09-sport-selector-design.md`

### ✅ Done

- Dashboard sport dropdown (`sportSelector.js`)
- `GET /api/sports/horizon-summary` — per-sport opportunity dots
- Horizon dots honour rideability thresholds; **weekday filter only for email cron** (`forAlerts: true`), not selector dots
- Sport switch reloads matrix, favorites, and watch state for active sport

### 🟡 Partial

- v2 day label on selector (e.g. "Sat" on weekend dot) — pending

### ❌ Not done

- Per-sport favorites in switcher tooltip (favorites work; no count badge in dropdown)

---

## 9. Session Lift Share — `2026-09-09-session-lift-share-design.md`

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

## Recommended build order (user priorities)

Aligns with [user priorities](./2026-09-08-windwatch-design.md#user-priorities). Items **1–13** are shipped; **14–16** are next.

| Order | Work | Spec | Status |
|-------|------|------|--------|
| **1** | Go/no-go mismatch state + pill on live strip | Realtime | ✅ |
| **2** | Session watchlist v1 (DB, API, planner pin, session-day panel) | Watchlist | ✅ |
| **3** | Mismatch escalation + daily watchlist status digest + midnight purge | Watchlist + Realtime | ✅ |
| **4** | Offshore pref + detection + matrix stripes | Ranking | ✅ |
| **5** | Wave preference in settings + `sessionRank` on API | Ranking | 🟡 wave pref DB only |
| **6** | Water quality manual cache (2–3 Quebec lakes) | Ranking | ❌ |
| **7** | Water level — wingfoil walk-out + kite launch beach; nuisance algae | Ranking | ❌ |
| **8** | Webcams + community signals | Watchlist v2 | ❌ |
| **9** | Spot local intel v1 (manual cache, parking/access metadata, rank penalties) | [Local Intel](./2026-09-09-spot-local-intel-design.md) | ❌ |
| **10** | Official + social ingestion, Gemini parser | Local Intel v2–v3 | ❌ |
| **11** | Departure planner v1 (leave-by, Google Maps, spot card) | [Departure Planner](./2026-09-09-departure-planner-design.md) | ❌ |
| **12** | Per-sport profiles (DB, API, settings tabs) | [Per-Sport Prefs](./2026-09-09-per-sport-preferences-alerts-design.md) | ✅ |
| **13** | Dashboard sport selector + `GET /api/sports/horizon-summary` | [Sport Selector](./2026-09-09-sport-selector-design.md) | ✅ |
| **14** | Optional auth (local default) | [Lift Share](./2026-09-09-session-lift-share-design.md) | ❌ |
| **15** | Session lift share v1 (opt-in, request, accept, email intro) | [Session Lift Share](./2026-09-09-session-lift-share-design.md) | ❌ |
| **16** | Session watcher count bands on matrix cards | [Session Watcher Count](./2026-09-09-session-watcher-count-design.md) | ❌ |

---

## Quick reference — cross-cutting features

| Feature | Status |
|---------|--------|
| Matrix 3-band (wind/gust/wave) | ✅ |
| Transparent non-rideable blocks | ✅ |
| Settings modal + auto-save | ✅ |
| Search spots + favorite star | ✅ |
| **Per-sport favorites** | ✅ |
| Custom radius (per sport) | ✅ |
| Live strip (all matrix days) | ✅ |
| Session warnings (storm/fade) | ✅ |
| Go/no-go pill | ✅ |
| Offshore gating + matrix styling | ✅ |
| Water quality / level ranking | ❌ |
| Server `sessionRank` on `/api/rideability` | 🟡 used in alert/watchlist qualification only |
| Webcams / community | ❌ |
| Spot local intel (parking, access, social) | ❌ |
| Departure planner (leave-by + drive time) | ❌ |
| Min consecutive hours (settings) | ✅ |
| Per-sport profiles + horizon alerts | ✅ |
| Dashboard sport selector + horizon dots | ✅ |
| Session watchlist (spot + date + sport) | ✅ |
| Session lift share | ❌ |
| Session watcher count bands | ❌ |
