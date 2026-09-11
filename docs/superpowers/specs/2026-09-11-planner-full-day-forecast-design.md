# Planner Full-Day Forecast — Design Spec

**Date:** 2026-09-11  
**Status:** Implemented (v1)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Ranking](./2026-09-08-session-ranking-design.md), [Session Excitement Stickers](./2026-09-10-session-excitement-stickers-design.md)

## Goal

Let users inspect **full-day forecast context** on “bust” planner days — rain, temperature, wind trends — especially at **favorite spots** (e.g. sailing club) when nothing meets rideability. A **global, persisted** toggle turns on a planner mode where non-rideable days remain useful: selectable day cards, favorite spots still listed (ranked), rideable spots still listed, and matrix rows show **session-hour** wind/gust/wave (and existing hazard styling) even when hours are not rideable.

Horizon day cards and excitement stickers **do not change meaning** when the toggle is on; only downstream matrix behavior and spot inclusion change.

## User stories

> "Sunday says no rideable wind, but I’m still going to the club — I need rain and air temp for the whole day at St-Placide."

> "I turned on full-day at favorites once; it stays on when I come back tomorrow."

> "Tuesday is rideable at other spots; with the toggle on I still see my favorite club spot ranked even if it’s 0 rideable hours."

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Persistence | **Global** on `user_preferences` (not per sport) |
| Default | **Off** (`0`) — current rideable-only matrix behavior |
| Horizon day cards | **Unchanged** — still show bust / no rideable wind / far-curiosity cards |
| Spot list when ON | **Union:** in-dashboard favorites (any rideability) **+** spots with `rideableCount > 0` |
| Ranking | Same `rankSpotsForDay` order; filter only removes rows when OFF |
| Matrix segments | Show Beaufort-colored wind/gust/wave for **all session planning hours** with forecast data when ON |
| Rideable styling | **Unchanged** — `.rideable`, `.rideable-isolated`, rain/storm/offshore classes still apply on top |
| Probability row | **Unchanged** — still rideable-only segments (no fake probability on bust hours) |
| Tooltips when ON | Show wind/gust/wave values for non-rideable hours; append existing `modelHourStatus` reason |
| Alerts / cron | **No change** — emails and excitement still use rideability only |

## UI

### Placement

Horizon Planner section header (`index.html`): flex row with title left, control right (per mockup annotation).

```text
Horizon Planner                    [ ] Full day at favorites
                                   hint: rain, temp & wind even when not rideable
```

- Control: accessible toggle (`role="switch"`, `aria-checked`, label from copy).
- Optional short hint under or beside label on `sm+` breakpoints; full text in `title` on compact layouts.

### Copy (`copy.js`)

| Key | Suggested text |
|-----|----------------|
| `planner.fullDayToggle` | Full day at favorites |
| `planner.fullDayToggleHint` | See rain, temp, and wind for the whole day even when nothing’s rideable. |
| `planner.fullDayToggleAria` | Show full-day forecast at favorite spots when the day is not rideable |
| `empty.noRideableHoursForDay` | *(unchanged when toggle off)* |
| `empty.noRideableHoursForDayFullDay` | Nothing rideable and no favorites to show for this day — pick another day or favorite a spot. |

When toggle is **on** and the filtered spot list is empty, use `noRideableHoursForDayFullDay`.

## Data model

### SQLite migration (`db.js` init)

```sql
ALTER TABLE user_preferences
  ADD COLUMN planner_full_day_forecast INTEGER NOT NULL DEFAULT 0;
```

### API

| Method | Path | Field |
|--------|------|--------|
| GET | `/api/preferences` | `planner_full_day_forecast`: `0` \| `1` |
| PUT | `/api/preferences` | `planner_full_day_forecast`: boolean or `0`/`1` |

Also expose on active sport payload from `getPreferences()` (merged from global, same as `alerts_master_enabled`) so `/api/rideability` `preferences` object includes the flag for client consistency without an extra round trip.

### Client state

- Module-level `plannerFullDayForecast` (boolean), initialized from `GET /api/preferences` / `applyFullPreferences`.
- On toggle: update local state → `PUT /api/preferences` → `renderHorizonPlanner` + `renderRideabilityMatrix` (no full forecast refetch required).
- Do **not** use `localStorage` for this flag.

## Behavior

### Day selection

Day cards are already clickable when bust; no change. Toggle only affects matrix content after `selectDay`.

### Spot list (`renderRideabilityMatrix`)

```text
ranked = sortSpotsForDay(spots, selectedDayDate, prefs, radiusKm)

if planner_full_day_forecast:
  favorites = Set(prefs.favorite_spot_ids)
  visible = ranked.filter(row =>
    row.rideableCount > 0 || favorites.has(row.entry.spot.id))
else:
  visible = ranked.filter(row => row.rideableCount > 0)
```

- **Distant favorites** remain in `ranked` (partitioned last); they appear when favorited and toggle is on, even at 0 rideable hours.
- Spots outside favorites with 0 rideable hours stay hidden when toggle is on (avoid dumping the full radius list).

### Matrix rendering

Introduce a single gate used by criterion segment rendering:

```text
function showMatrixCriterionSegment(hour, elapsed, fullDayMode):
  if hour == null: false
  if elapsed: return hourHasMatrixConditionData(hour)   // unchanged
  if fullDayMode: return hourHasMatrixConditionData(hour)
  return hour.rideable
```

Apply in `renderCriterionSegments` (wind, gust, wave rows). Direction row: if it currently hides non-rideable arrows, align with the same gate for consistency.

**Tooltips** (`criterionTooltipLines`): when `fullDayMode` and hour is not rideable but has data, emit model lines with values (same `criterionValueLine` as rideable) instead of `—`, then status line from `modelHourStatus`.

**Card chrome:** Keep `N rideable hrs` in header; optional future enhancement — show air temp range — out of scope v1.

### Visual distinction for non-rideable filled hours

v1 **does not** add a new matrix swatch tier. Non-rideable hours with segments use the same Beaufort colors; rideable window outlines / isolated / transparency rules still differentiate “in window” vs model disagreement. If usability testing shows confusion, v2 may add a subtle `.hour-block--curiosity` opacity on segments where `!hour.rideable && fullDayMode`.

## Pure helpers (testable)

Extract from `app.js` into shared module or test mirror:

```text
filterMatrixSpotsForDay(rankedRows, favoriteSpotIds, fullDayMode) → rows[]
showMatrixCriterionSegment(hour, elapsed, fullDayMode) → boolean
```

Unit tests in `test/plannerFullDayForecast.test.js` (or extend `horizonPlanner.test.js`).

## Out of scope

- Changing horizon alert cron or email content
- Showing every spot in radius on bust days
- Per-sport toggle or settings-modal duplicate control
- New legend row (unless v2 visual tier added)

## Acceptance criteria

- [ ] Toggle visible in Horizon Planner header; default off for new/existing users after migration
- [ ] Toggle state survives server restart (SQLite)
- [ ] Toggle state survives sport switch (global)
- [ ] OFF: matrix unchanged (rideable-only spots and segments)
- [ ] ON, bust day, ≥1 in-dashboard favorite: matrix lists favorites in rank order with full session-hour criterion segments
- [ ] ON, day with rideable spots: union of rideable spots + favorites (no duplicate cards)
- [ ] ON: tooltips on non-rideable hours show wind/gust/wave where data exists
- [ ] ON: rideable hours still show window highlighting and existing legend semantics
- [ ] OFF: empty state copy unchanged; ON: distinct empty when no favorites and no rideable

## Implementation notes

| Area | Files |
|------|--------|
| Migration + read/write | `src/db.js` |
| PUT validation | `src/routes/preferences.js` |
| Header + toggle | `public/index.html`, `public/css/styles.css` |
| Logic | `public/js/app.js`, `public/js/copy.js` |
| Tests | `test/plannerFullDayForecast.test.js` |
| Status | `docs/superpowers/specs/STATUS.md` |
