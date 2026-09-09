# Session Watcher Count — Design Spec

**Date:** 2026-09-09  
**Status:** Draft  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Depends on:** [Session Watchlist](./2026-09-08-session-watchlist-design.md) (cloud `watched_sessions`), [Session Lift Share — Accounts](./2026-09-09-session-lift-share-design.md#accounts-login--security) (multi-user cloud rows)  
**Related:** [Session Lift Share](./2026-09-09-session-lift-share-design.md) (same session key: spot + date)

## Goal

Show **how many users are watching a planned session** (spot + calendar date) so riders get lightweight social proof — *others think this day is worth going*. Surface banded labels on **Rideability Matrix** spot cards for the selected day, including sessions the user has **not** starred yet.

Windmate shows **bands only** (no exact counts, no identities) to reinforce confidence without exposing who is watching or feeling lonely when counts are low.

## User stories

> "Thursday Lac Saint-Louis looks good in the matrix. The card says **A few watching** — other riders are planning the same session. Worth pinning."

> "Hudson Saturday shows **Popular** — the community is onto this one. I'll watch it and check the live strip on the day."

> "I browse without an account. I still see **A few watching** on matrix cards — aggregate signal only, no login required."

## Scope

### In scope (v1)

- **Session key:** `spot_id` + `session_date` (ISO `YYYY-MM-DD`) — **sport ignored** for counting
- **Data source:** cloud `watched_sessions` rows only (signed-in users with server-persisted watches)
- **Count eligibility:** rows where watcher has `email_verified_at` set (reduces signup spam inflating badges)
- **Banded labels** (server maps raw count → band):
  - `0–1` → no badge (hidden)
  - `2–4` → `few` → UI: **"A few watching"**
  - `5+` → `popular` → UI: **"Popular"**
- **UI surface:** Rideability Matrix spot cards for the **selected planner day** only
- **API:** separate `GET /api/sessions/watcher-counts` — decoupled from `/api/rideability`; client merges on render
- **Anonymous-readable** — no auth required to read aggregate bands
- **Graceful degradation** — matrix renders without badges if counts request fails or feature disabled

### In scope (v2)

- Same badge on **watchlist strip** cards and star / add-to-watchlist confirmation
- Optional include in watchlist digest email line ("Popular with riders this week")

### Out of scope

- Exact numeric counts in UI
- Per-sport breakdown ("3 wingfoil, 2 kite")
- User identities, avatars, or "friends watching"
- Real-time WebSocket updates (dashboard refresh is enough for v1)
- Counting **local-only** browser watches (`localStorage` — invisible to server by design)
- Using watcher count as a **ranking factor** (social proof is display-only in v1)

## Concepts

| Term | Meaning |
|---|---|
| **Session** | One `spot_id` + `session_date` pair |
| **Watcher** | User with an active cloud `watched_sessions` row for that session |
| **Band** | Privacy-preserving label derived from total watcher count (`few`, `popular`, or absent) |
| **Active watch** | `session_date >= today` (same purge window as [watchlist expiry](./2026-09-08-session-watchlist-design.md#expiry--purge)) |

## Data model

No new tables in v1. Reads from existing `watched_sessions` (watchlist spec) joined to `users` for verified-email filter.

```sql
SELECT ws.spot_id, ws.session_date, COUNT(*) AS n
FROM watched_sessions ws
INNER JOIN users u ON u.id = ws.user_id
WHERE ws.spot_id IN (:spotIds)
  AND ws.session_date IN (:dates)
  AND ws.session_date >= :today
  AND u.email_verified_at IS NOT NULL
GROUP BY ws.spot_id, ws.session_date
```

Application maps `n` → band via env thresholds (see [Environment variables](#environment-variables)).

**Future (if scale requires):** materialized `session_watcher_counts` updated on watch POST/DELETE — not v1.

## API

### `GET /api/sessions/watcher-counts`

**Auth:** none required (public aggregate).

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `spotIds` | yes | Comma-separated spot ids (max **50** per request — matches rideability spot limit) |
| `dates` | yes | Comma-separated ISO dates `YYYY-MM-DD` (max **7** — horizon length) |

**Response:**

```json
{
  "bands": {
    "lac-saint-louis|2026-09-12": "few",
    "hudson-beach|2026-09-12": "popular"
  },
  "meta": {
    "today": "2026-09-09",
    "enabled": true
  }
}
```

- Keys: `{spotId}|{sessionDate}`
- Values: `"few"` | `"popular"` only — omit key when band would be hidden (`0–1` watchers)
- When `WATCHER_COUNTS_ENABLED=0`: `{ "bands": {}, "meta": { "enabled": false } }`

**Errors:**

| Code | When |
|---|---|
| `400` | Missing/invalid `spotIds` or `dates`, or over limit |
| `503` | Feature disabled + client requested anyway (optional; prefer empty `bands` with `enabled: false`) |

**Caching:** `Cache-Control: public, max-age=300` (5 min) — counts are not real-time critical.

### Client integration

On dashboard load (and when user changes selected planner day):

1. `GET /api/rideability?...` (existing)
2. `GET /api/observations?...` (existing, parallel)
3. `GET /api/sessions/watcher-counts?spotIds=...&dates={selectedDayDate}` (parallel with 1–2)

Extract `spotIds` from rideability `spots[].id`. Pass **only** `selectedDayDate` in v1 (single date) to minimize payload; v2 may request full 7-day horizon in one call when planner also shows bands.

If step 3 fails: log warning, render matrix without watcher badges (no user-facing error).

## Band mapping

| Raw count (verified cloud watches) | Band | UI label |
|---|---|---|
| 0–1 | _(omit)_ | _(hidden)_ |
| 2–4 | `few` | A few watching |
| 5+ | `popular` | Popular |

Thresholds configurable via env. Server returns band strings only — client does not re-derive bands from counts.

## UI design

### Rideability Matrix — spot card

Placement: subtle line below spot title / rank banners, above window stats and live strip.

```
#2 Lac Saint-Louis ★                    [Closest]
👥 A few watching
3.2 h best window · 14–18 kt · 12.4 km
```

```
#1 Hudson Beach
🔥 Popular
...
```

| Element | Spec |
|---|---|
| Icon | `few` → 👥 or users icon; `popular` → 🔥 or trending icon |
| Typography | `text-xs text-slate-400` — secondary to rank banners and go/no-go |
| Visibility | Render only when band present for `(spot.id, selectedDayDate)` |
| Day change | Re-fetch counts when `selectedDayDate` changes (same hook as matrix re-render) |

### Copy (`copy.js`)

| Key | Text |
|---|---|
| `watchers.few` | `A few watching` |
| `watchers.popular` | `Popular` |

Mate tone — short, factual, not hype.

## Privacy & abuse

| Concern | Mitigation |
|---|---|
| Exposing who watches | Bands only; no user ids in API |
| Low counts feel empty | Hide at 0–1 |
| Exact count inference | No numbers in v1; bands widen at scale |
| Spam signups inflating counts | Count only `email_verified_at` watchers |
| Stalking / targeting | No per-user data; read-only aggregate |
| Local watches leaking | Local stars never sent to server unless user syncs to cloud |

## Integration

| Feature | Behavior |
|---|---|
| [Session Watchlist](./2026-09-08-session-watchlist-design.md) | Source of truth for counts; same `spot_id` + `session_date` key; purge aligned |
| [Session Lift Share](./2026-09-09-session-lift-share-design.md) | Same session pool (watchers on spot+date); lift is separate opt-in |
| [Rideability Matrix](./2026-09-08-windwatch-design.md) | Host UI; fetches counts separately |
| Self-hosted single-user | Set `WATCHER_COUNTS_ENABLED=0` — no query, no badges |

## Services (planned)

| File | Responsibility |
|---|---|
| `src/services/sessionWatcherCounts.js` | SQL aggregate, band mapping, env gates |
| `src/routes/sessionWatcherCounts.js` | `GET /api/sessions/watcher-counts` handler |
| `public/js/sessionWatchers.js` | Fetch, cache key by day, `bandFor(spotId, date)` helper |
| `public/js/app.js` | Parallel fetch on refresh; pass bands into `renderRideabilityMatrix` |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WATCHER_COUNTS_ENABLED` | `1` | `0` disables endpoint work and badges |
| `WATCHER_BAND_FEW_MIN` | `2` | Minimum count for `few` band |
| `WATCHER_BAND_POPULAR_MIN` | `5` | Minimum count for `popular` band |
| `WATCHER_COUNTS_MAX_SPOT_IDS` | `50` | Request size cap |
| `WATCHER_COUNTS_MAX_DATES` | `7` | Request size cap |

## Build order

Ship **after** Session Watchlist v1 cloud storage (item **2** in [STATUS build order](./STATUS.md#recommended-build-order-user-priorities)). Can land in same release as watchlist or immediately after — no lift-share dependency.

| Order | Prerequisite |
|---|---|
| 1 | `watched_sessions` table + cloud POST/DELETE |
| 2 | Optional auth + `email_verified_at` (or count all cloud rows if auth ships later — document temporary rule) |
| 3 | This feature: API + matrix badge |

## Testing checklist

- [ ] 0 verified watches → key absent, no badge
- [ ] 1 verified watch → key absent, no badge
- [ ] 2–4 watches → `few` / "A few watching"
- [ ] 5+ watches → `popular` / "Popular"
- [ ] Unverified-only watches → not counted
- [ ] Local-only watch on client → does not affect server band
- [ ] `session_date < today` → not counted (purge aligned)
- [ ] Different sports same spot+date → same aggregate count
- [ ] Counts request fails → matrix still renders, no badge
- [ ] `WATCHER_COUNTS_ENABLED=0` → empty bands, no SQL
- [ ] Day tab change → new fetch for new `selectedDayDate`
- [ ] Over-limit `spotIds` → `400`

## Open questions

1. **Pre-auth launch** — if watcher counts ship before email verification exists, count all cloud `watched_sessions` rows temporarily; switch to verified-only when auth lands.
2. **v2 planner** — fetch 7 dates in one counts call when horizon cells also show bands?
3. **Popular icon** — 🔥 vs neutral users icon for `popular` (avoid "hype" tone conflict with mate voice)?
