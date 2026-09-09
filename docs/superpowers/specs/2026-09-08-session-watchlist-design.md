# Session Watchlist & Ground Truth — Design Spec

**Date:** 2026-09-08  
**Status:** Draft (user priorities captured; implementation after realtime wind v1)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Depends on:** [Realtime Wind Observations](./2026-09-08-realtime-wind-design.md)

## Goal

Let users **mark a planned session** (spot + date) and keep it visible until the day passes. On session day, combine live observations with forecast comparison so users **don't drive out when conditions don't match what was promised**. Later, enrich watched sessions with **webcam feeds** and **community reports** from social networks or local forums.

## User story

> "I saw Lac Saint-Louis looks good Thursday in the planner. I star it. Thursday morning it stays pinned at the top. Forecast says 16 kt but live shows 9 kt — Windmate tells me not to bother. If there were a webcam and a few posts from people already on the water, I'd know for sure."

## Scope

### In scope (v1 — watchlist core)

- Add/remove **watched sessions** (spot + calendar date)
- **Pin watched sessions** to the top of the Horizon Planner (above the 7-day blur cards)
- **Session-day panel** — expanded card for today's watched sessions with live strip, go/no-go pill, and forecast vs actual curve inline
- **Mismatch banners** — consume [Forecast vs actual mismatch](./2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch) states; escalate on watched session day
- **Optional session-day email** — morning heads-up when watched spot mismatch is `caution` or `no_go`
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
| session_date | TEXT | ISO date `YYYY-MM-DD` (local timezone of spot or user — TBD at implementation; default user browser TZ) |
| note | TEXT | nullable — e.g. "Morning foil with Alex" |
| created_at | INTEGER | Unix ms |
| notify_email | INTEGER | 0/1 — send session-day mismatch email (default 1) |

Unique constraint: `(spot_id, session_date)`.

Expired sessions (`session_date < today`) remain in DB for history but **unpin automatically** from planner (collapsed "Past watched" section optional in v2).

### `spots` extension (v2)

| Column | Type | Notes |
|---|---|---|
| webcam_url | TEXT | nullable — direct embed URL (YouTube live, Windy iframe, municipal cam) |
| windy_webcam_id | TEXT | nullable — Windy Webcams API id |
| community_sources | TEXT | nullable — JSON array of `{ type, url, label }` e.g. Reddit subreddit search, Facebook group |

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/watchlist` | All watched sessions with spot metadata; flag `isToday`, `isPast` |
| POST | `/api/watchlist` | Body: `{ spotId, sessionDate, note?, notifyEmail? }` |
| DELETE | `/api/watchlist/:id` | Remove watched session |
| GET | `/api/watchlist/today` | Today's watched sessions + full observation payload (parallel fetch) |

Response merges rideability forecast for `session_date` with live observations when `session_date === today`. Spots are ranked by [session score](./2026-09-08-session-ranking-design.md) for that date (proximity, offshore, waves, water quality, level).

## UI design

### Horizon Planner — watchlist strip

Above the 7-day forecast row:

```
★ WATCHING
┌─────────────────────────────────────────────────────────┐
│ Thu 12 Sep · Lac Saint-Louis (#1)     [★ Watched] [×] │
│ Forecast 14–18 kt · flat · onshore · 12 km            │
│ (on session day: live strip + go/no-go pill inline)     │
└─────────────────────────────────────────────────────────┘
```

- **Star icon** on any day/spot cell in planner → adds to watchlist (picker confirms date if ambiguous)
- Watched entries sort by `session_date` ascending; **today's sessions first**, then future, then past (hidden by default)
- On non-session days, card shows forecast summary only; live data loads on session day

### Session-day panel (today only)

For each watched session where `session_date === today`:

1. **Go/no-go banner** — full width, mate tone (see realtime spec mismatch copy)
2. **Live strip** — same as rideability matrix
3. **Today's curve** — expanded by default (not collapsed)
4. **Best window reminder** — from forecast, crossed out or struck when `no_go`

### Webcam block (v2)

When `webcam_url` or `windy_webcam_id` present:

```
📷 Live cam — Lac Saint-Louis
[ embedded player or thumbnail + link ]
Stale cam indicator if feed errors
```

Prefer lazy-load iframe on expand to avoid autoplay noise. Fallback: thumbnail + "Open cam" external link.

### Community signals (v2)

Lightweight, honest about source freshness:

```
💬 What people are saying
• r/wingfoil — "Lachine was dead until noon" (2 h ago) [link]
• Windy spot chat — "Hudson picking up SW" (45 min ago) [link]
```

**Approaches (pick at implementation):**

| Approach | Pros | Cons |
|---|---|---|
| **Curated links only** | No scraping, no API keys | User clicks out; no inline summary |
| **Reddit JSON API** | Structured, search by spot keywords | Rate limits; needs keyword tuning per spot |
| **Gemini summarize** | Readable mate-tone blurbs from fetched snippets | Cost; latency; needs parent spec parser |
| **Manual notes** | Immediate value | Not scalable |

Recommendation: **v2a curated links + manual notes**; **v2b Reddit search + Gemini summary** for Montreal seed spots only.

## Integration with realtime wind

| Concern | Owner spec |
|---|---|
| Live wind, forecast vs actual curve | [Realtime Wind](./2026-09-08-realtime-wind-design.md) |
| Mismatch thresholds, go/no-go states | [Realtime Wind — Forecast vs actual mismatch](./2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch) |
| Shorter poll TTL for watched spots on session day | Realtime (`OBSERVATION_CACHE_TTL_MS` override per spot) |
| Planner pin order, star UX, webcam UI | This spec |
| Session rank for day (wind, waves, quality, level) | [Session Spot Ranking](./2026-09-08-session-ranking-design.md) |

## Email (session day)

Optional send at **08:00 local** (configurable) for watched sessions where `notify_email = 1`:

**Subject:** `Mate, you marked [Spot] for today — worth a look?` (go) / `...forecast might be off` (caution/no_go)

**Body (caution example):**

```
Hey mate — you marked Lac Saint-Louis for today.

Forecast: 14–18 kt, best 14:00–17:00
Live now: 9 kt WSW — forecast oversold it a bit.

[ Open Windmate ] — check the curve before you drive.
```

Skip send if `no_go` and user dismissed banner in last 24 h (optional v2).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WATCHLIST_SESSION_DAY_EMAIL_HOUR` | `8` | Local hour to send session-day email |
| `WATCHED_OBSERVATION_TTL_MS` | `120000` (2 min) | Observation cache TTL for watched spots on session day |
| `WINDY_WEBCAM_API_KEY` | _(unset)_ | Windy Webcams API (v2) |

## Testing checklist

- [ ] POST watchlist creates row; duplicate spot+date returns 409 or upserts
- [ ] Watched session appears pinned above 7-day planner
- [ ] On session day, go/no-go banner reflects mismatch state from observations API
- [ ] Past session_date unpins from default planner view
- [ ] DELETE removes pin and row
- [ ] Session-day email sends on caution/no_go; skips on go (or sends positive — product choice at implementation)
- [ ] Webcam embed loads lazily; broken URL shows fallback link (v2)
- [ ] Community links render without blocking planner load (v2)

## Open questions

1. **Timezone for `session_date`** — user browser TZ vs spot-local (Quebec spots span same TZ today; document for future coastal trips).
2. **Dismiss snooze** — "Still going anyway" hides banner for N hours without removing watchlist?
3. **Windy Webcams licensing** — confirm embed terms before v2.
