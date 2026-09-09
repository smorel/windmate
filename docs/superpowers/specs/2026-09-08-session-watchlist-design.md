# Session Watchlist & Ground Truth — Design Spec

**Date:** 2026-09-08  
**Status:** Draft (user priorities captured; implementation after realtime wind v1)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Depends on:** [Realtime Wind Observations](./2026-09-08-realtime-wind-design.md)

## Goal

Let users **mark a planned session** (spot + date) and keep it visible **through session day only**. While a session is on the watchlist, send **daily status emails** so users know whether it is still on track or conditions are degrading. On session day, combine live observations with forecast comparison so users **don't drive out when conditions don't match what was promised**. After session day ends, the watch **expires and is removed** — past sessions are not kept. Later, enrich watched sessions with **webcam feeds** and **community reports** from social networks or local forums.

## User story

> "I saw Lac Saint-Louis looks good Thursday in the planner. I star it Monday. Tuesday's email says still on track. Wednesday it says degrading — wind forecast dropped and the window shrank to 90 minutes. Thursday morning it stays pinned at the top; live shows 9 kt when forecast said 16 — Windmate tells me not to bother. Friday it's gone from my list — session's over."

## Scope

### In scope (v1 — watchlist core)

- Add/remove **watched sessions** (spot + calendar date)
- **Pin watched sessions** to the top of the Horizon Planner (above the 7-day blur cards)
- **Session-day panel** — expanded card for today's watched sessions with live strip, go/no-go pill, and forecast vs actual curve inline
- **Mismatch banners** — consume [Forecast vs actual mismatch](./2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch) states; escalate on watched session day
- **Daily watchlist status email** — once per day per watched session (future + today) while `notify_email = 1`; mate-tone summary: on track, degrading, or no longer valid
- **Session-day email** — same daily job on session day; includes live mismatch when `session_date === today`
- **Auto-expire** — delete watched sessions when `session_date < today` (end of session day in user local TZ); no past-watch history in UI or DB
- SQLite persistence; no auth (single-user local app, same as preferences)

### In scope (v2 — ground truth enrichment)

- **Webcam embed** per spot when URL or Windy Webcam ID is known
- **Community signals** — curated links or lightweight aggregation of recent posts about the spot or nearby spots (see [Community signals](#community-signals))
- Manual "I was there" notes (optional, user-entered) as a bridge before automated social ingestion

### Out of scope

- Multi-user accounts / shared watchlists
- Push notifications (email only in v1 watchlist)
- Automated scraping without user-configured sources (legal/ToS review required)
- Booking or calendar sync (Google Calendar export is a possible later nice-to-have)

## Data model

### `watched_sessions`

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | PK |
| spot_id | TEXT | FK → spots |
| session_date | TEXT | ISO date `YYYY-MM-DD` (user local TZ — see [Open questions](#open-questions)) |
| sport | TEXT | Sport profile used when watching — see [Supported sports](./2026-09-08-windwatch-design.md#supported-sports); default `active_sport` at create time |
| note | TEXT | nullable — e.g. "Morning foil with Alex" |
| created_at | INTEGER | Unix ms |
| notify_email | INTEGER | 0/1 — daily status + session-day emails (default 1) |
| last_status | TEXT | `on_track` · `degrading` · `at_risk` · `no_go` · `unknown` — last computed forecast/live status |
| last_status_at | INTEGER | Unix ms — when `last_status` was last evaluated |
| last_notified_at | INTEGER | nullable — Unix ms — last daily email sent for this row |
| status_snapshot | TEXT | nullable — JSON blob of last evaluation (session score, window hours, rank, intel badges) for trend detection |

Unique constraint: `(spot_id, session_date)`.

**Lifecycle:** only `session_date >= today` (user local date) exist in `watched_sessions`. A daily purge job **deletes** rows where `session_date < today` — no archive, no "past watched" UI.

### `spots` extension (v2)

| Column | Type | Notes |
|---|---|---|
| webcam_url | TEXT | nullable — direct embed URL (YouTube live, Windy iframe, municipal cam) |
| windy_webcam_id | TEXT | nullable — Windy Webcams API id |
| community_sources | TEXT | nullable — JSON array of `{ type, url, label }` e.g. Reddit subreddit search, Facebook group |

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/watchlist` | Active watched sessions only (`session_date >= today`); includes `status`, `statusTrend`, spot metadata; flag `isToday` |
| POST | `/api/watchlist` | Body: `{ spotId, sessionDate, sport?, note?, notifyEmail? }` |
| DELETE | `/api/watchlist/:id` | Remove watched session |
| GET | `/api/watchlist/today` | Today's watched sessions + full observation payload (parallel fetch) |

Response merges rideability forecast for `session_date` with live observations when `session_date === today`. Evaluation uses the watched session's **`sport`** profile ([Per-Sport Preferences](./2026-09-09-per-sport-preferences-alerts-design.md)). Spots are ranked by [session score](./2026-09-08-session-ranking-design.md) for that date.

`statusTrend`: `improving` · `stable` · `degrading` · `new` — compare current `status_snapshot` to previous day's snapshot (or `created_at` baseline).

## UI design

### Horizon Planner — watchlist strip

Above the 7-day forecast row:

```
★ WATCHING
┌─────────────────────────────────────────────────────────┐
│ Thu 12 Sep · Lac Saint-Louis (#1)     [★ Watched] [×] │
│ Forecast 14–18 kt · flat · onshore · 12 km            │
│ ● On track — 3 h window · ranked #2 for wingfoil      │
│ (on session day: live strip + go/no-go pill inline)     │
└─────────────────────────────────────────────────────────┘
```

Status pill colours: green `on_track`, amber `degrading` / `at_risk`, red `no_go`.

- **Star icon** on any day/spot cell in planner → adds to watchlist (picker confirms date if ambiguous; stores current `active_sport` unless user picks another)
- Watched entries sort by `session_date` ascending; **today's sessions first**, then future only — **no past rows**
- On non-session days, card shows forecast summary + status pill; live data loads on session day
- After midnight local on the day after `session_date`, entry **disappears** from planner (purge job)

### Session-day panel (today only)

For each watched session where `session_date === today`:

1. **Go/no-go banner** — full width, mate tone (see realtime spec mismatch copy)
2. **Live strip** — same as rideability matrix
3. **Today's curve** — expanded by default (not collapsed)
4. **Best window reminder** — from forecast, crossed out or struck when `no_go`
5. **Leave-by time** — on session day, [Departure Planner](./2026-09-09-departure-planner-design.md) line: drive + rig → when to leave home

### Webcam block (v2)

When `webcam_url` or `windy_webcam_id` present:

```
📷 Live cam — Lac Saint-Louis
[ embedded player or thumbnail + link ]
Stale cam indicator if feed errors
```

Prefer lazy-load iframe on expand to avoid autoplay noise. Fallback: thumbnail + "Open cam" external link.

### Community signals (v2)

Lightweight, honest about source freshness. Full data model, ingestion phasing, and ranking rules: **[Spot Local Intel spec](./2026-09-09-spot-local-intel-design.md)** (social feed, photos/videos, parking, access, water hazards).

```
💬 Latest from the spot
• Instagram — choppy but rideable (3 h ago) [photo]
• Facebook — "road still flooded" (1 h ago)
• City of Oka — Beach opens May 15 (official)
```

**Approaches (pick at implementation):**

| Approach | Pros | Cons |
|---|---|---|
| **Curated links only** | No scraping, no API keys | User clicks out; no inline summary |
| **Reddit JSON API** | Structured, search by spot keywords | Rate limits; needs keyword tuning per spot |
| **Official municipal parse** | Authoritative parking/access hours | Per-site parsers |
| **Gemini summarize** | Readable mate-tone blurbs from fetched snippets | Cost; latency; needs allowlist |
| **Manual notes** | Immediate value | Not scalable |

Recommendation: **v2a curated links + manual `spot_intel_cache`**; **v2b official pages + Reddit**; **v2c Gemini + social thumbnails** for Montreal seed spots.

## Integration with realtime wind

| Concern | Owner spec |
|---|---|
| Live wind, forecast vs actual curve | [Realtime Wind](./2026-09-08-realtime-wind-design.md) |
| Mismatch thresholds, go/no-go states | [Realtime Wind — Forecast vs actual mismatch](./2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch) |
| Shorter poll TTL for watched spots on session day | Realtime (`OBSERVATION_CACHE_TTL_MS` override per spot) |
| Planner pin order, star UX, webcam UI | This spec |
| Session rank for day (wind, waves, quality, level) | [Session Spot Ranking](./2026-09-08-session-ranking-design.md) |

## Watchlist status evaluation

Computed daily (and on planner load) per watched session using that row's **`sport`** profile and [session score](./2026-09-08-session-ranking-design.md) for `session_date`. Merge [Spot Local Intel](./2026-09-09-spot-local-intel-design.md) hard blocks (`access: closed`, water `closed`, parking `closed`) into status.

| `last_status` | Meaning | Typical triggers |
|---|---|---|
| `on_track` | Still a good session for your setup | Qualifying window ≥ `min_rideable_window_hours`; score ≥ threshold; no hard intel block |
| `degrading` | Worse than yesterday or since you starred it | Score dropped ≥ 0.1, window shortened ≥ 30 min, gust ceiling exceeded more hours, new intel `caution` |
| `at_risk` | Marginal — might not be worth it | Window barely meets min hours; score near threshold; heavy rain added to forecast |
| `no_go` | No longer valid | No qualifying window; hard intel block; offshore gate removes all hours; below min wind for sport |
| `unknown` | Forecast stale or fetch failed | Retry next cron; don't delete watch |

**Session day:** when `session_date === today`, overlay [Forecast vs actual mismatch](./2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch) (`go` / `caution` / `no_go`) on the email and UI. Live mismatch **wins** over forecast-only status when observations exist.

**Trend:** compare `status_snapshot` to previous evaluation; set `statusTrend` to `degrading` when status rank worsens (on_track → degrading → at_risk → no_go).

Persist `last_status`, `last_status_at`, and `status_snapshot` on each evaluation (cron + API read path).

## Email (daily watchlist digest)

One **daily job** at **08:00 local** (configurable) for all active watched sessions where `notify_email = 1`. Prefer **one digest email** listing every watched session; skip rows unchanged since yesterday unless `last_status` worsened (always email on degradation).

### Future session day (before today)

**Subject:** `Mate — Thursday at Lac Saint-Louis still on track` / `...conditions degrading` / `...might be off`

**Body (degrading example):**

```
Hey mate — your watched sessions:

📅 Thu 12 Sep · Lac Saint-Louis (wingfoil)
   Was: 14–18 kt, 3 h window · ranked #1
   Now: 11–15 kt, 1.5 h window · ranked #4
   Status: degrading — wind forecast dropped mate.

📅 Sat 14 Sep · Hudson Beach (sailing)
   Still on track — 10–14 kt, 4 h window · ranked #1

[ Open Windmate ]
```

### Session day (today)

**Subject:** `Mate, Lac Saint-Louis is today — worth a look?` (on_track/go) / `...forecast might be off` (degrading/caution) / `...probably skip it` (no_go)

**Body (session day + live mismatch):**

```
Hey mate — you marked Lac Saint-Louis for today (wingfoil).

Forecast: 14–18 kt, best 14:00–17:00
Live now: 9 kt WSW — forecast oversold it a bit.
Status: caution

[ Open Windmate ] — check the curve before you drive.
```

### Send rules

| Rule | Behaviour |
|---|---|
| First watch | Send confirmation line in next digest ("Added to watchlist") |
| Status worsens | Always send (even if digest already sent that day) |
| Status stable `on_track` | Send daily summary (user expects daily ping while watching) |
| `no_go` for future date | Send + suggest removing watch or picking another spot |
| User dismissed banner | Skip **repeat** session-day emails for 24 h (optional v2); still show in UI |
| After `session_date` | Stop sending — row purged at end of day |

Distinct from [horizon sport alerts](./2026-09-09-per-sport-preferences-alerts-design.md) — those discover **new** sessions; watchlist emails track **sessions you already starred**.

## Expiry & purge

| Event | Behaviour |
|---|---|
| `session_date === today` | Full session-day UX; included in daily email |
| End of `session_date` (local midnight) | Cron deletes row: `DELETE FROM watched_sessions WHERE session_date < :today` |
| Manual remove | `DELETE /api/watchlist/:id` anytime before expiry |
| API `GET /api/watchlist` | Never returns `session_date < today` |

No history table in v1. Optional `watched_sessions_archive` is out of scope unless analytics are needed later.

## Services (planned)

| File | Responsibility |
|---|---|
| `src/services/watchlistStatus.js` | Evaluate status, trend, snapshot; merge intel + live mismatch |
| `src/cron/watchlistDigest.js` | Daily status email + purge expired rows |
| `src/cron/watchlistPurge.js` | Optional separate midnight job if digest hour ≠ purge time |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WATCHLIST_DIGEST_EMAIL_HOUR` | `8` | Local hour for daily watchlist status digest |
| `WATCHLIST_PURGE_HOUR` | `0` | Local hour to delete `session_date < today` (default midnight) |
| `WATCHLIST_STATUS_ON_TRACK_MIN_SCORE` | `0.55` | Session score floor for `on_track` |
| `WATCHLIST_DEGRADING_SCORE_DELTA` | `0.1` | Score drop triggering `degrading` |
| `WATCHED_OBSERVATION_TTL_MS` | `120000` (2 min) | Observation cache TTL for watched spots on session day |
| `WINDY_WEBCAM_API_KEY` | _(unset)_ | Windy Webcams API (v2) |

`WATCHLIST_SESSION_DAY_EMAIL_HOUR` — **deprecated alias** for `WATCHLIST_DIGEST_EMAIL_HOUR` (same job handles session day).

## Testing checklist

- [ ] POST watchlist creates row; duplicate spot+date returns 409 or upserts; stores `sport` from active profile
- [ ] Watched session appears pinned above 7-day planner with status pill
- [ ] Daily digest email lists all watched sessions; degrading status triggers mate copy with before/now delta
- [ ] `degrading` detected when score drops or window shortens vs previous `status_snapshot`
- [ ] On session day, go/no-go banner reflects live mismatch; email includes live strip summary
- [ ] Purge job deletes rows where `session_date < today`; GET watchlist never returns them
- [ ] At local midnight after session day, watched entry gone from planner without manual delete
- [ ] DELETE removes pin and row before expiry
- [ ] `no_go` future session email suggests user review watchlist
- [ ] Webcam embed loads lazily; broken URL shows fallback link (v2)
- [ ] Community links render without blocking planner load (v2)

## Open questions

1. **Timezone for `session_date` and purge** — user browser TZ vs spot-local (Quebec spots span same TZ today; purge at user-local midnight recommended).
2. **Dismiss snooze** — "Still going anyway" hides banner for N hours without removing watchlist?
3. **Windy Webcam licensing** — confirm embed terms before v2.
4. **Digest vs per-session emails** — one combined daily mail (recommended) or one email per watched session?
5. **Stable on_track spam** — send every day while watching, or only on change + weekly reminder?
