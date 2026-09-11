# Windmate — Spec Implementation Status

**Last reviewed:** 2026-09-09 (late evening — spot map picker, departure v1, ranking/favorites, go/no-go date fixes)

Use this alongside the design specs. Legend: ✅ Done · 🟡 Partial · ❌ Not done

---

## Summary

| Spec | Overall |
|------|---------|
| [windwatch-design](./2026-09-08-windwatch-design.md) (MVP) | **~92%** — core pipeline + watchlist + go/no-go + map picker shipped |
| [realtime-wind-design](./2026-09-08-realtime-wind-design.md) | **~90%** — observations + go/no-go pill + session verdict on rideability |
| [session-ranking-design](./2026-09-08-session-ranking-design.md) | **~65%** — client rank + favorite partition + departure window scoring; env factors missing |
| [session-watchlist-design](./2026-09-08-session-watchlist-design.md) | **~92%** — v1 shipped; go/no-go banner fixes; email/auth + planner day-cell pending |
| [spot-map-picker-design](./2026-09-09-spot-map-picker-design.md) | **~95%** — inline Leaflet map, bbox, manual spots, geocode; v2 unfavorite pending |
| [spot-local-intel-design](./2026-09-09-spot-local-intel-design.md) | **~15%** — matrix intel drawer + spot media strip/lightbox + manual cache seed |
| [departure-planner-design](./2026-09-09-departure-planner-design.md) | **~70%** — leave-by v1 + haversine/Google drive; home/rig prefs UI pending |
| [per-sport-preferences-alerts](./2026-09-09-per-sport-preferences-alerts-design.md) | **~90%** — profiles, tabs, horizon cron, per-sport favorites; no auth gate for email |
| [sport-selector](./2026-09-09-sport-selector-design.md) | **~90%** — dropdown + horizon-summary API; v2 day label pending |
| [session-lift-share](./2026-09-09-session-lift-share-design.md) | **0%** — spec only (watched-session lift matching + email intro) |
| [session-watcher-count](./2026-09-09-session-watcher-count-design.md) | **0%** — spec only (banded social proof on matrix cards) |
| [planner-full-day-forecast](./2026-09-11-planner-full-day-forecast-design.md) | **~95%** — global toggle + matrix; spec acceptance unchecked |
| [weather-consensus](./2026-09-11-weather-consensus-design.md) | **0%** — spec draft; majority rain vote (Open-Meteo + iGetwind APCP) |

**Also shipped (not in original MVP):** settings modal, auto-save prefs, spot search, **per-sport favorites** (incl. out-of-radius), customizable radius, Beaufort matrix colors, 3-band wind/gust/wave blocks, session warning time fix, **sport-scoped watchlist** (spot + date + sport), watchlist card navigation, eye icon for watch vs ★ for favorite, per-sport horizon alert cron, **inline spot map picker** (Leaflet, manual spots, Nominatim), **departure leave-by line** on matrix + watchlist cards, **local calendar date** (no UTC “today” rollover), **favorite-aware matrix ranking** (in-radius favorites first, distant favorites last), **session go/no-go on rideability payload** (`sessionGoNoGoByDate`).

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
- APIs: `/api/spots`, `/api/spots/search`, `/api/spots/bbox`, `POST /api/spots`, `/api/geocode`, `/api/forecast`, `/api/rideability`, `/api/observations`, `/api/departure`, `/api/preferences`, `/api/sports`, `/api/watchlist`, `/api/health`
- Mate-tone copy (`copy.js`)
- Go/no-go mismatch pill on live strip (see Realtime spec)
- Session watchlist v1 (see Watchlist spec)
- Spot map picker v1 (see Spot Map Picker spec)

### 🟡 Partial

- **Session ranking on matrix** — client `sessionRank.js`; `sessionGoNoGoByDate` on rideability API; full `sessionRank` payload not on API
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
- **`sessionGoNoGoByDate`** on `/api/rideability` per spot/day (forecast verdict without live mismatch on future days)

### 🟡 Partial

- Temp-below-min distinct matrix block style (blue tint) — tooltip/dot only
- Loading skeleton per live strip
- Windy weather warnings supplement
- Dedicated session-day morning mismatch email (digest includes live line when SMTP configured)
- Live mismatch only when observation hours match session calendar day (`observationCoversSessionDay`)

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
- **Favorite-aware matrix order** — in-radius favorites first (score order within group), other in-radius spots, then distant favorites (`favoriteRankPartition.js` + `sessionRank.js`)
- **Out-of-radius favorites** included in dashboard via `selectDashboardSpots`; `outside_radius` flag only when truly beyond search radius (not spot-limit overflow)
- **`offshore_wind_ok`** per sport profile + settings UI
- **`src/services/offshore.js`** — wind exposure classification + rideability gate
- Offshore matrix hour styling + direction legend (`offshore-hour`, `matrix-direction--offshore`)
- **Departure window scoring** — `pickBestQualifyingWindow` uses rank criteria (proximity omitted); tests in `departurePlanner.test.js`
- **Go/no-go score** — `computeSessionGoNoGoScore` excludes proximity; hazards after consensus window ignored (`warningsWithinWindow`)
- Automated tests: `rankCriteria`, `departurePlanner`, `favoriteRankPartition`, `sessionGoNoGo`, `spotSelection`

### 🟡 Partial

- **Wave preference** — stored per sport profile in DB; inferred from sport in JS; no settings UI
- **Onshore scoring** — uses `idealWind` / `ideal_directions`; not full onshore sector model from spec
- **Wave in best window** — averages all rideable hours, not longest window max
- **Proximity** — works in score; no dedicated pref flag
- **`sessionRank` in API** — client-only on matrix; server `sessionRank.js` used in alert/watchlist/departure qualification
- **`min_foil_depth_cm`** — column on `sport_profiles`; no settings UI or ranking hook
- Distant favorites with 0 consensus window (e.g. Tarifa when models disagree) still hidden from matrix (`rideableCount > 0` filter)

### ❌ Not done

- Spot columns: `onshore_directions`, `shore_exposure`, `water_body_*`, `quality_region_id`, …
- `spot_quality_cache` + `waterQuality.js`
- `spot_level_cache` + `waterLevel.js`
- Server `sessionRank` payload on `/api/rideability`
- Water quality hard-block (`closed`)
- Live session-day score multiplier
- Manual quality cache for seed spots (v1 proof)

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
- **Go/no-go banner UX** — green forecast summary separate from caution/no-go reason line
- **Local calendar date** for `isToday`, purge, and watchlist enrichment (fixes evening UTC rollover applying live mismatch to tomorrow's sessions)
- **Departure leave-by line** on watchlist cards (`departure.js`)

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

- **`spot_intel_cache`** table + manual media seed for Montreal proof spots (proximity/name match)
- **`GET /api/spots/:spotId/intel`** — returns `media_gallery` with sport-aware Google link-out fallback
- **Matrix intel drawer** — collapsible “Local intel” section on rideability matrix cards
- **Spot photos & videos strip** — horizontal 5–10 tile strip, lazy-loaded async
- **Media lightbox** — prev/next overlay, Escape / backdrop close, source link-out
- `googleMedia.js` + `spotIntel.js` (server + client) + tests (`spotIntel.test.js`)

### 🟡 Partial

- **Spot media data** — manual seed thumbnails only; Google Custom Search API (v2) not wired
- **Intel drawer scope** — matrix cards only; watchlist cards + parking/access/cam/social blocks pending
- **Water quality in ranking spec** — algae/advisory levels defined in session-ranking; not wired in app
- **Webcam / community in watchlist spec** — design only; overlaps this spec

### ❌ Not done

- `intel_sources`, parking/access spot columns
- Full intel panel (social thumbnails, cam, parking, access summaries)
- Access/parking ranking factors + hard blocks
- Official municipal page parsers
- Social aggregation (Reddit, Instagram/Facebook links, Gemini extract)
- Session-day intel TTL + watchlist email line

---

## 6. Departure Planner — `2026-09-09-departure-planner-design.md`

### ✅ Done

- `GET /api/departure` — leave-by plan for spot + date + origin coords
- `departurePlanner.js` — best qualifying window via `pickBestQualifyingWindow`, hazard-trimmed window end
- `travelTime.js` — Google Routes API (when `GOOGLE_MAPS_API_KEY` set) + Haversine fallback
- `travel_time_cache` table + 15-min departure bucket cache
- `departure.js` — leave-by line on matrix cards + watchlist strip; Google Maps link
- Session states: `planned`, `leave_now`, `in_window`, `passed`
- `leave_by` = arrive − drive − rig − buffer (rig/buffer from env defaults)
- Tests: `departurePlanner.test.js` (window pick, leave-by math, haversine drive)
- Matrix departure window highlight + connector stroke UI

### 🟡 Partial

- **`min_rideable_window_hours`** — in DB, settings, window marking (`rideableWindow.js`); shared with departure
- **User lat/lng** — browser GPS / manual coords per request; no persisted `home_lat/lng` prefs yet
- **`rig_minutes`** — `DEFAULT_RIG_MINUTES` env only; no settings UI
- Alternate windows within 0.05 score — not shown
- Leave-by strike-through when watchlist `no_go` — partial (`checkLive` caution copy)

### ❌ Not done

- `home_lat/lng/label` persisted in settings UI
- `rig_minutes` + departure buffer in settings UI
- Dedicated mate copy for all edge cases in spec

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
- **Home coords / Haversine** — same primitives as spots + departure planner

### ❌ Not done

- Multi-user auth (`users`, `user_sessions`, `auth_tokens`) — email/password, Argon2id, verify + reset flows
- Per-user `watched_sessions.user_id`
- `user_lift_preferences`, `lift_requests` tables
- Lift settings UI (driver opt-in, radius)
- Request / inbox / accept API + first-accept-wins match
- Watched session "Need a lift" + driver inbox UI
- Intro email on match; purge with watchlist expiry

---

## 10. Spot Map Picker — `2026-09-09-spot-map-picker-design.md`

### ✅ Done

- **Map toggle** next to spot search (`#spot-map-toggle`, label stays "Map" / "Close map")
- **Inline Leaflet panel** below search row (Carto Voyager tiles)
- `GET /api/spots/bbox` — viewport spots with favorite flags; favorites prioritized when over limit
- `POST /api/spots` — Windmate-local manual spots (`igetwind_id = NULL`)
- `GET /api/geocode` — Nominatim reverse + forward search proxy
- `nominatim.js` — fetch + cache
- Click non-favorite pin → favorite + toast
- Double-click map → create-spot modal (reverse geocode name) → auto-favorite
- Enter in search while map open → focus/geocode location on map
- Favorited markers: ★, tooltip only, not clickable
- `igetwindSync.js` — manual spots no longer deleted on sync
- `spotMapPicker.js`, styles, copy strings
- Tests: `spots.test.js` (bbox, create, duplicate guard, manual spot persistence), `spotSelection.test.js`

### 🟡 Partial

- Initial map center — favorites bounds / home / GPS (verify on all edge cases)
- Close via toggle, panel ✕, Escape — implemented; manual QA checklist in spec not fully ticked

### ❌ Not done (v2)

- Unfavorite from map popup
- Marker clustering at low zoom
- Visual distinction for Windmate custom spots (dashed ring)
- iGetwind create API mirror

---

## Recommended build order (user priorities)

Aligns with [user priorities](./2026-09-08-windwatch-design.md#user-priorities). Items **1–13** are shipped; **11** is partial; **14–16** are next.

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
| **9** | Spot local intel v1 (manual cache, parking/access metadata, rank penalties) | [Local Intel](./2026-09-09-spot-local-intel-design.md) | 🟡 media strip shipped |
| **10** | Official + social ingestion, Gemini parser | Local Intel v2–v3 | ❌ |
| **11** | Departure planner v1 (leave-by, drive time, spot card) | [Departure Planner](./2026-09-09-departure-planner-design.md) | 🟡 v1 shipped; home/rig prefs + alternates pending |
| **12** | Per-sport profiles (DB, API, settings tabs) | [Per-Sport Prefs](./2026-09-09-per-sport-preferences-alerts-design.md) | ✅ |
| **13** | Dashboard sport selector + `GET /api/sports/horizon-summary` | [Sport Selector](./2026-09-09-sport-selector-design.md) | ✅ |
| **14** | Spot map picker (inline Leaflet, manual spots, geocode) | [Spot Map Picker](./2026-09-09-spot-map-picker-design.md) | ✅ |
| **15** | Optional auth (local default) | [Lift Share](./2026-09-09-session-lift-share-design.md) | ❌ |
| **16** | Session lift share v1 (opt-in, request, accept, email intro) | [Session Lift Share](./2026-09-09-session-lift-share-design.md) | ❌ |
| **17** | Session watcher count bands on matrix cards | [Session Watcher Count](./2026-09-09-session-watcher-count-design.md) | ❌ |

---

## Quick reference — cross-cutting features

| Feature | Status |
|---------|--------|
| Matrix 3-band (wind/gust/wave) | ✅ |
| Transparent non-rideable blocks | ✅ |
| Settings modal + auto-save | ✅ |
| Search spots + favorite star | ✅ |
| **Per-sport favorites** | ✅ |
| **Out-of-radius favorites in dashboard** | ✅ |
| **Favorite matrix order** (in-radius first, distant last) | ✅ |
| Custom radius (per sport) | ✅ |
| Live strip (all matrix days) | ✅ |
| Session warnings (storm/fade) | ✅ |
| Go/no-go pill | ✅ |
| **Session go/no-go per day on rideability** | ✅ |
| **Local calendar date** (server + client) | ✅ |
| Offshore gating + matrix styling | ✅ |
| Water quality / level ranking | ❌ |
| Server `sessionRank` on `/api/rideability` | 🟡 `sessionGoNoGoByDate` only |
| Webcams / community | ❌ |
| Spot local intel (parking, access, social) | 🟡 matrix media strip + manual cache only |
| **Departure planner (leave-by + drive time)** | 🟡 v1; Google optional |
| **Spot map picker (Leaflet inline)** | ✅ |
| **Manual Windmate spots** | ✅ |
| Min consecutive hours (settings) | ✅ |
| Per-sport profiles + horizon alerts | ✅ |
| Dashboard sport selector + horizon dots | ✅ |
| Session watchlist (spot + date + sport) | ✅ |
| Session lift share | ❌ |
| Session watcher count bands | ❌ |
| Planner full-day at favorites (global toggle) | ✅ |
| Automated test suite (`npm test`, 40 tests) | ✅ |
