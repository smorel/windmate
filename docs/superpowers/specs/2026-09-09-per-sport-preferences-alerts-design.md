# Per-Sport Preferences & Horizon Alerts — Design Spec

**Date:** 2026-09-09  
**Status:** Draft (requirements captured; implementation after session ranking v1 + watchlist v1)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Spot Ranking](./2026-09-08-session-ranking-design.md), [Session Watchlist](./2026-09-08-session-watchlist-design.md), [Departure Planner](./2026-09-09-departure-planner-design.md)

## Goal

Users practice more than one sport with **different thresholds, travel radius, session length, ranking priorities, and notification timing**. Windmate should store a **profile per sport** and send **horizon alerts** only when a qualifying session appears on a day the user cares about for that sport.

Example:

- **Wingfoil** — alert on **any day** in the next 7 days when a good session appears (flexible schedule).
- **Sailing** — alert only when a good session falls on a **weekend** within the horizon (weekday sailor who only goes Sat/Sun).

Anyone may mix presets and custom rules per sport.

## User story

> "I wingfoil after work any day the wind cooperates — ping me whenever something decent shows up this week. Sailing is my weekend thing: only tell me if Saturday or Sunday looks worth rigging the dinghy. Wing needs 12 kt and a 2 h window within 40 km; sailing I'll drive 80 km for 3 h on the water. And rank wing spots by proximity first; for sailing I care more about wind and waves."

## Problem with today

`user_preferences` is a **single row** with one `sport`, one wind range, one `radius_km`, one `rank_criteria_order`, and one `min_rideable_window_hours`. Changing sport in settings **overwrites** the previous sport's thresholds. Cron emails use that single profile and only scan **today** — no per-sport scheduling or horizon lookahead.

## Scope

### In scope (v1 — sport profiles)

- **`sport_profiles`** table — one row per [supported sport](./2026-09-08-windwatch-design.md#supported-sports)
- **Per-sport rideability & ranking prefs** — wind, gust, air/water temp, offshore, waves, foil depth, radius, min window hours, `rank_criteria_order`
- **`active_sport`** on `user_preferences` — which profile drives the dashboard matrix/planner (quick switcher in header)
- **Settings UI** — tab per sport; edit and auto-save independently
- **Migration** — seed six profiles from current single row + [sport defaults](./2026-09-08-windwatch-design.md#default-preferences-by-sport)

### In scope (v2 — horizon alerts)

- **Per-sport alert schedule** — horizon length, eligible days of week, enable/disable
- **Cron horizon scan** — evaluate each enabled sport profile against forecast for matching days; email digest of opportunities
- **Alert qualification** — uses that sport's thresholds + `min_rideable_window_hours` + session rank (not raw rideable hour count alone)
- **Mate-tone digest email** — one email combining all sports, or per-sport sections in one send

### In scope (v3 — polish)

- **Per-sport favorites** (optional) — different starred spots per sport; default global favorites with sport override
- **Snooze / quiet hours** — don't email between 22:00–07:00 local
- **"New since last alert"** — only notify when a qualifying day newly enters horizon or score crosses threshold (reduce repeat mail)

### Out of scope

- Multi-user accounts / per-user SMTP (still single-user local app)
- Push notifications (email only; same as parent spec)
- Calendar sync (Google Calendar export is a later nice-to-have)
- Paid alert tiers or SMS

## Data model

### `user_preferences` (global — slimmed)

Keeps **app-wide** settings. Sport-specific fields **move** to `sport_profiles`.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK (single row, id=1) |
| `active_sport` | TEXT | Dashboard default — see [Supported sports](./2026-09-08-windwatch-design.md#supported-sports) |
| `favorite_spot_ids` | TEXT | JSON array — global favorites (v1); per-sport override in v3 |
| `home_lat` / `home_lng` / `home_label` | REAL/TEXT | Departure planner origin — see [Departure Planner](./2026-09-09-departure-planner-design.md) |
| `rig_minutes` | INTEGER | default 20 |
| `departure_buffer_minutes` | INTEGER | default 5 |
| `alerts_master_enabled` | INTEGER | 0/1 — master kill switch for all horizon emails (default 1) |

**Removed from global row** (live on `sport_profiles`): `sport`, `min_wind_knots`, `max_gust_knots`, `min_air_temp_c`, `min_water_temp_c`, `offshore_wind_ok`, `wave_preference`, `min_foil_depth_cm`, `rank_criteria_order`, `radius_km`, `min_rideable_window_hours`.

### `sport_profiles`

One row per sport. User may disable sports they don't practice (`enabled = 0` hides tab; no alerts).

| Column | Type | Default | Notes |
|---|---|---|---|
| `sport` | TEXT | PK | See [Supported sports](./2026-09-08-windwatch-design.md#supported-sports) |
| `enabled` | INTEGER | 1 | User practices this sport |
| `min_wind_knots` | INTEGER | per sport defaults | |
| `max_gust_knots` | INTEGER | per sport defaults | |
| `min_air_temp_c` | REAL | nullable | |
| `min_water_temp_c` | REAL | nullable | |
| `offshore_wind_ok` | INTEGER | per sport defaults | |
| `wave_preference` | TEXT | per sport defaults | `flat` · `small` · `any` · `big` |
| `min_foil_depth_cm` | INTEGER | nullable | wingfoil / optional kite |
| `radius_km` | INTEGER | 50 | Search + alert scan radius for this sport |
| `min_rideable_window_hours` | INTEGER | 2 | Min consecutive rideable hours for a qualifying session |
| `rank_criteria_order` | TEXT | JSON array | Same keys as [Session Ranking](./2026-09-08-session-ranking-design.md#user-preferences-new-fields) |
| `alert_enabled` | INTEGER | 1 | Send horizon emails for this sport |
| `alert_schedule` | TEXT | JSON | See [Alert schedule](#alert-schedule) |

Default `rank_criteria_order` may differ by sport (seed at migration):

| Sport | Suggested default order (top = most important) |
|---|---|
| wingfoiling | `proximity`, `rideability`, `bestWindow`, `wind`, `onshore`, `waveMatch` |
| parawing | `proximity`, `rideability`, `bestWindow`, `wind`, `onshore`, `waveMatch` |
| kitefoiling | `rideability`, `proximity`, `bestWindow`, `onshore`, `wind`, `waveMatch` |
| kitesurfing | `rideability`, `proximity`, `bestWindow`, `onshore`, `wind`, `waveMatch` |
| windsurfing | `rideability`, `proximity`, `bestWindow`, `onshore`, `wind`, `waveMatch` |
| sailing | `wind`, `bestWindow`, `waveMatch`, `rideability`, `proximity`, `onshore` |

### `alert_schedule` JSON

```json
{
  "horizon_days": 7,
  "days_of_week": [0, 1, 2, 3, 4, 5, 6],
  "today_alerts": true,
  "min_session_score": 0.55
}
```

| Field | Type | Description |
|---|---|---|
| `horizon_days` | integer | How far ahead to scan (1–14; default 7) |
| `days_of_week` | int[] | **Eligible session days** — `0` = Sunday … `6` = Saturday (JS `getDay()`). Only alert when a qualifying session falls on one of these days |
| `today_alerts` | boolean | Include **today** in horizon scan (replaces legacy "today only" cron behaviour when true) |
| `min_session_score` | number | 0–1 — best spot on that day must meet this [session score](./2026-09-08-session-ranking-design.md) to trigger alert (default 0.55) |

**Presets** (UI shortcuts; stored as expanded `days_of_week`):

| Preset | `days_of_week` | Typical use |
|---|---|---|
| **Any day** | `[0,1,2,3,4,5,6]` | Wingfoil — flexible schedule |
| **Weekends only** | `[0, 6]` | Sailing — Sat/Sun sailor |
| **Weekdays only** | `[1,2,3,4,5]` | After-work sessions |
| **Custom** | user picks | Shift workers, fixed club nights |

**Example profiles:**

```json
// wingfoiling — alert any day this week
{
  "horizon_days": 7,
  "days_of_week": [0, 1, 2, 3, 4, 5, 6],
  "today_alerts": true,
  "min_session_score": 0.5
}

// sailing — weekends only within horizon
{
  "horizon_days": 7,
  "days_of_week": [0, 6],
  "today_alerts": true,
  "min_session_score": 0.6
}
```

### `alert_sent_log` (v2 — dedupe)

| Column | Type | Notes |
|---|---|---|
| id | TEXT | PK |
| sport | TEXT | |
| spot_id | TEXT | nullable — null when digest-only |
| session_date | TEXT | ISO date |
| sent_at | INTEGER | Unix ms |
| fingerprint | TEXT | hash(sport + date + spot_id + score_bucket) — skip duplicate sends |

TTL: prune rows older than 14 days.

## Alert qualification logic

For each `sport_profile` where `enabled = 1` AND `alert_enabled = 1` AND global `alerts_master_enabled = 1`:

1. Resolve user origin (home coords or last GPS).
2. For each `session_date` from today through `today + horizon_days`:
   - Skip if `session_date`'s weekday ∉ `days_of_week`.
3. For each spot within `radius_km` (Haversine from origin):
   - Compute rideability hours using **this sport's** thresholds.
   - Find best window ≥ `min_rideable_window_hours`.
   - Compute `sessionScore` for that day using **this sport's** `rank_criteria_order` and ranking factors ([Session Ranking](./2026-09-08-session-ranking-design.md)).
4. If best spot's `sessionScore >= min_session_score` and qualifying window exists → **candidate**.
5. Dedupe against `alert_sent_log`; group candidates by sport; send digest.

**Today vs horizon:** `today_alerts: false` still allows tomorrow+ in horizon; use when user only wants advance notice (unusual).

**Watchlist emails** ([Session Watchlist — daily digest](./2026-09-08-session-watchlist-design.md#email-daily-watchlist-digest)) remain separate — daily status for **starred spot + date** until session day ends, not sport-profile horizon discovery.

## Email format

### Horizon digest (v2)

**Subject:** `Mate — wing Thu + sailing Sat looking good 🌬️` (dynamic from candidates)

**Body:**

```
Hey mate — sessions on the horizon:

🪽 Wingfoil — Thursday
   Lac Saint-Louis · 14–18 kt · 14:00–17:00 · 12 km
   Best window 3 h · ranked #1 for your wing setup

⛵ Sailing — Saturday
   Hudson Beach · 10–14 kt · 11:00–15:00 · 68 km
   Best window 4 h · ranked #1 for your sailing setup

[ Open Windmate ]

Only days you asked for — wing any day, sailing weekends.
```

Single sport → shorter subject: `Mate, wingfoil looks good Thursday 🌬️`

Copy via `src/utils/copy.js`; sport icons/colours from `SPORT_COLORS`.

### Legacy today-only alert

Current cron (`Mate, [Spot] is on today`) becomes a **subset** when `today_alerts: true` and today ∈ `days_of_week`. Prefer horizon digest once v2 ships; keep today path for users with `horizon_days: 0` deprecated or `today_only` preset (v1 compat).

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/preferences` | Global prefs + `active_sport` + all `sport_profiles` |
| PUT | `/api/preferences` | Update global fields (`active_sport`, home, alerts_master_enabled, favorites) |
| PUT | `/api/preferences/sports/:sport` | Update one `sport_profiles` row (thresholds, radius, window, rank order, alert schedule) |
| GET | `/api/alerts/preview` | Dev/admin — candidates for next cron run without sending |

**Breaking change (v1):** `PUT /api/preferences` no longer accepts `min_wind_knots` etc. at top level — clients must use `/api/preferences/sports/:sport`.

**Rideability / ranking APIs:** accept optional `?sport=` query param; default to `active_sport`. Server uses matching `sport_profiles` row for thresholds and rank weights.

## UI design

### Sport switcher (header)

Quick toggle: **Wing** · **Sail** · **Kite** — sets `active_sport`, reloads matrix/planner with that profile's radius and ranking. Accent colour follows sport.

### Settings — per-sport tabs

```
Settings
[Wingfoil] [Sailing] [Kite] [Windsurf] [Kitefoil] [Parawing]

── Rideability ──
Min wind · Max gust · Min air/water temp
Offshore OK · Waves · Foil depth (wing/kite)

── Session ──
Search radius (km) · Min consecutive hours

── Ranking ──
Drag criteria order (same UX as today)

── Alerts ──
[✓] Email me when a good session appears
Horizon: [7 days ▼]
Days: (•) Any day  ( ) Weekends only  ( ) Weekdays  ( ) Custom…
[✓] Include today
Min quality: [Good ▼]  → maps to min_session_score
```

Disabled sport tab: "Don't practice this" toggle at bottom of tab.

### Matrix / planner

All rideability, ranking, and distance labels reflect **active sport** profile. Tooltip: "Using your wingfoil settings — switch sport in header."

## Services (planned)

| File | Responsibility |
|---|---|
| `src/services/sportProfiles.js` | Load/merge profile; defaults; validation |
| `src/cron/horizonAlertScheduler.js` | Scan horizon per sport; dedupe; send digest |
| `src/services/alertQualification.js` | Given sport profile + date + spots → candidates |
| `src/db/migrations/00x_sport_profiles.js` | Split `user_preferences` → profiles |

Refactor existing `alertScheduler.js` to call `horizonAlertScheduler` or merge.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CRON_SCHEDULE` | `0 */3 * * *` | Unchanged — horizon scan cadence |
| `ALERT_QUIET_START_HOUR` | _(unset)_ | v3 — no send after this hour (local) |
| `ALERT_QUIET_END_HOUR` | _(unset)_ | v3 — no send before this hour |
| `ALERT_DIGEST_MAX_SPORTS` | `6` | Cap sections in one email |

Existing `ALERT_EMAIL_FROM` / `ALERT_EMAIL_TO` unchanged.

## Migration

1. Create `sport_profiles` with six rows from `SPORT_DEFAULTS` + current `user_preferences` values copied to **active sport** row only; other sports get defaults.
2. Set `user_preferences.active_sport` = former `sport` column.
3. Drop moved columns from `user_preferences` (or leave nullable deprecated one release).
4. Default alert schedules: foil sports (wing, kitefoil, parawing) and twin-tip kite/windsurf **any day**; sailing **weekends only** — user can change immediately in settings.

## Phasing

| Phase | Deliverable |
|---|---|
| **v1** | `sport_profiles` table; API split; settings tabs; dashboard sport switcher; rideability/rank use active profile |
| **v2** | `alert_schedule` per sport; horizon cron + digest email; `alert_sent_log` dedupe |
| **v3** | Quiet hours; "new since last alert"; optional per-sport favorites |

## Testing checklist

- [ ] Six sport profiles seed on fresh DB; migration preserves current user's thresholds on correct sport row
- [ ] Changing wing min wind does not change sailing profile
- [ ] `active_sport` switch updates matrix radius, rank order, and wind gates without page reload (or with clear refresh)
- [ ] Sailing `days_of_week: [0,6]` — alert fires for Saturday candidate, not Thursday
- [ ] Wing `any day` — alert fires for first qualifying weekday in horizon
- [ ] `min_session_score` blocks alert when wind ok but rank poor (offshore, water closed, etc.)
- [ ] `alerts_master_enabled: 0` suppresses all sends; per-sport `alert_enabled: 0` suppresses one sport only
- [ ] Digest combines wing + sailing in one email when both qualify same cron tick
- [ ] Duplicate cron run does not resend same sport+date+spot (fingerprint log)
- [ ] `GET /api/rideability?sport=sailing` uses sailing profile even when active is wingfoil

## Open questions

1. **Per-sport favorites** — v1 global only, or ship sport-scoped stars in v1?
2. **Digest vs separate emails** — one combined mail (recommended) or one per sport?
3. **Horizon blur** — should planner blur days 4–7 use active sport only, or show best sport per day (complex)?
4. **Score threshold UI** — slider vs preset labels (Fair / Good / Great)?
5. **Timezone** — alert `days_of_week` in user local TZ vs spot TZ when spots span zones?
