# Session Excitement Stickers — Design Spec

**Date:** 2026-09-10  
**Status:** Implemented (v1)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Ranking](./2026-09-08-session-ranking-design.md), [Session Watchlist](./2026-09-08-session-watchlist-design.md)

## Goal

Celebrate sessions that are **clearly better than** the user’s minimum bar with playful **illustrated stickers** on Horizon day cards, Rideability Matrix session cards, and watchlist cards. Sessions that merely meet settings — or sit just above the floor — are **standard**: rideable, ranked, **no sticker**. Stickers use **settings-based min/max scoring** (not “best spot that day” normalization) plus optional **per-axis flair** when duration and power tell different stories (e.g. short but punchy).

## User stories

> "Thursday’s horizon card shows **Amazing** — I didn’t have to open every spot to feel hyped."

> "L’anse à l’orme is #1 with **Epic!** and a **Quick hit** flair — short window but wind is cranking; that’s my lunch-break fantasy."

> "Tuesday at Verdun hits my 2 h / 12 kt bar — matrix looks normal, **no sticker**. That’s a standard session."

> "Saturday watchlist shows **Nice session** — clearly more wind and a longer window than my floor; that’s worth the hype sticker."

> "Wednesday’s horizon card says no rideable wind — **😢** in the corner. Fair."

## Decisions (locked)

| Topic | Choice |
|---|---|
| Horizon day value | **Best go/no-go excitement** among spots in the current dashboard set for that day |
| Primary sticker art | **Bold diagonal text** (tier color + white stroke) for now; illustrated assets later |
| Scoring core | **(1) Synthetic min/max anchors** on go/no-go composite score |
| Extra tags | **(3) Per-axis flair** alongside primary tier when axes diverge |
| No rideable wind | **😢** emoji sticker (not WebP), same corner — overrides standard / excitement |

## Concepts

| Term | Meaning |
|---|---|
| **Go/no-go score** | `computeSessionGoNoGoScore` — same criteria weights as ranking, **proximity omitted**, factors from `computeRawMetrics` (absolute `max_gust_knots` caps) |
| **Anchor min** | Synthetic “barely qualifies” session from settings |
| **Anchor max** | Synthetic “dream day” session from settings |
| **Linear `t`** | `(rawScore − minScore) / (maxScore − minScore)` before any display curve |
| **Standard session** | `t < STICKER_FLOOR` — rideable / ranked as today, **no stickers** |
| **Excitement `t'`** | Renormalized + gamma-boosted score in `[0, 1]` driving the **primary** sticker tier (only when not standard) |
| **Axis scores** | Separate normalized **power** and **duration** values for flair only |
| **Primary sticker** | One of: Cool day · Nice session · Amazing · Epic! (never shown for standard sessions) |
| **Flair** | Optional axis flavor (Quick hit · Marathon · Glass) — **not** a second badge; merges into one **combo sticker** |
| **Sticker key** | `tier` or `tier--flair` (e.g. `amazing--quick-hit`) — one asset per key |
| **Bust sticker** | **😢** when nothing rideable is planned — mutually exclusive with excitement tiers |

## Scoring

### Resolution order

Evaluate in this order for each card’s spot + day (or whole horizon day):

```text
1. If no rideable session is planned → tier = bust (😢), no flair, skip scoring
2. Else if t < STICKER_FLOOR → tier = none (standard session)
3. Else → excitement tier + optional flair
```

**No rideable wind planned** uses the same rules as the Horizon “No rideable wind” block and matrix filtering:

- **Per spot / day:** `consensusRideableWindowHours < min_rideable_window_hours` (equivalently `rideableCount === 0` from `longestConsensusWindowLength`).
- **Horizon day card:** `rideableMax <= 0` from `getDayRideableWindowRange` across the dashboard spot set (no spot has a qualifying shared window that day).

Bust is **not** used when wind exists but fails other gates only (offshore-only, temp, gust cap) if those hours are already non-`rideable` in the model — same as today’s rideability pipeline.

## Scoring (excitement)

### Factor source

Use the same scalar factors already produced by `computeRawMetrics` (server and client implementations must stay aligned):

- `rideability`, `bestWindow` (`min(1, consensusWindowHours / 8)`), `wind`, `gust`, `onshore`, `waveMatch`
- **Do not** use matrix ranking’s per-day relative wind/gust normalization for stickers.

### Anchor min (floor session)

Derived only from `user_preferences` / sport profile:

| Factor | Min anchor value |
|---|---|
| `bestWindow` | `min(1, min_rideable_window_hours / 8)` |
| `rideability` | `min(1, min_rideable_window_hours / 24)` |
| `wind` | `min_wind_knots / max_gust_knots` |
| `gust` | `min_wind_knots / max_gust_knots` (same ratio — gust at floor wind) |
| `onshore` | `0.5` |
| `waveMatch` | `estimateWaveMatch` at synthetic flat/small waves implied by **min wind** heuristic (same formula as ranking, single synthetic hour at `min_wind_knots`) |

### Anchor max (ceiling session)

| Factor | Max anchor value |
|---|---|
| `bestWindow` | `1` (8+ h consensus window) |
| `rideability` | `1` |
| `wind` | `1` |
| `gust` | `1` |
| `onshore` | `1` |
| `waveMatch` | `1` |

### Composite score

```text
weights = weightsFromOrder(rank_criteria_order) with proximity removed
minScore = dot(weights, anchorMinFactors)
maxScore = dot(weights, anchorMaxFactors)
rawScore = dot(weights, actualFactors)   // from real session metrics

t = clamp((rawScore - minScore) / max(maxScore - minScore, ε), 0, 1)
```

If `maxScore - minScore < ε` and rideable window exists, treat as no excitement sticker (degenerate prefs). Bust still applies when step 1 of resolution order matches.

### Standard session (no sticker)

Most rideable days should **not** get a sticker. Only sessions **meaningfully above** the synthetic floor are “exciting.”

```text
STICKER_FLOOR = 0.20   // linear t; tunable constant

if t < STICKER_FLOOR:
  tier = none, flair = none   // standard session — UI unchanged except existing rank / GO·NO-GO
```

Interpretation: at `t ≈ 0` the session matches the anchor minimum; from `0` up to `STICKER_FLOOR` is “a bit better than minimum” but still **ordinary** — no gamification.

### Excitement curve (tiers only)

For `t ≥ STICKER_FLOOR`, renormalize then apply γ so strong sessions reach Epic without needing a perfect max anchor:

```text
u = (t - STICKER_FLOOR) / (1 - STICKER_FLOOR)
t' = u^γ     // default γ = 0.6
```

### Primary sticker tiers

| `t'` | Sticker | Tooltip lead |
|---|---|---|
| *(standard)* | *(none)* | `t < STICKER_FLOOR` |
| `0.00 – 0.35` | **Cool day** | Clearly above your minimum |
| `0.35 – 0.55` | **Nice session** | Solid window and juice |
| `0.55 – 0.75` | **Amazing** | Worth planning around |
| `≥ 0.75` | **Epic!** | Clear the calendar |

Tooltip body (all tiers): excitement **%** = `round(t' × 100)`, plus one line from consensus window + peak wind/gust when available.

### Per-axis normalization (flair only)

Compute axis scores with the **same min/max anchors** but restricted factor sets:

**Duration axis** — factors `bestWindow`, `rideability` (re-normalize weights to sum to 1 over this subset only):

```text
d = clamp((durationScore - durationMin) / (durationMax - durationMin), 0, 1)
d' = d^γ
```

**Power axis** — factors `wind`, `gust`, `waveMatch` (same subset re-normalization):

```text
p = clamp((powerScore - powerMin) / (powerMax - powerMin), 0, 1)
p' = p^γ
```

### Flair rules (v1)

At most **one** flair. Flair does **not** add a second badge — it selects a **combo sticker** (`stickerKey = tier--flair`, e.g. `nice--glass`). With no flair, `stickerKey = tier` only.

| Condition | Flair | Copy |
|---|---|---|
| `p' ≥ 0.55` **and** `d' < 0.35` **and** `t ≥ STICKER_FLOOR` **and** primary tier set | **Quick hit** | Short window, strong wind — squeeze it in |
| `d' ≥ 0.65` **and** `p' < 0.45` **and** `t ≥ STICKER_FLOOR` **and** primary tier set | **Marathon** | Long rideable day — pace yourself |
| `waveMatch` factor ≥ 0.9 **and** `p' ≥ 0.5` **and** user `wave_preference` is `flat` or `small` **and** primary tier set | **Glass** | Flat / friendly water for your setup |

Flair is suppressed when it would duplicate the primary message (e.g. no **Marathon** if primary is already **Epic!** and `d' ≥ 0.75`).

Priority if multiple match: **Quick hit** > **Glass** > **Marathon** (first match wins).

## Module layout

| File | Role |
|---|---|
| `src/services/sessionExcitement.js` | `computeExcitement({ metrics, prefs })`, anchor builders, tier + flair resolution |
| `public/js/sessionExcitement.js` | Browser mirror (same exports and constants) |
| `test/sessionExcitement.test.js` | Anchor math, γ curve, tier boundaries, flair precedence |

**Inputs:**

- **Matrix / horizon (client):** after `computeRawMetrics` for each spot/day, or reuse go/no-go metrics from rideability payload when exposed.
- **Watchlist (server):** attach `excitement: { tier, flair, tPrime, tooltip }` in `evaluateWatchlistStatus` (`tier` may be `bust` | `cool` | `nice` | `amazing` | `epic` | `null`) so strip matches matrix without re-fetching full rideability.

**Constants** (`STICKER_FLOOR`, `EXCITEMENT_GAMMA`, tier breakpoints, flair thresholds) live in one exported object for tuning.

## UI

### Placement

- Card root: `position: relative`
- `.session-excitement-stack` — `top: 0`, `right: 10px`, `translateY(-50%)` so sticker **vertical center** sits on the card top edge; **horizontal** text, **right-aligned** to the inset

### Surfaces

| Surface | Excitement source |
|---|---|
| **Horizon day card** | If `rideableMax <= 0` → **😢**. Else among spots with `rideableCount > 0`, max `t` (must be `≥ STICKER_FLOOR` for excitement); flair from **that spot’s** axes. If rideable but every spot standard → **no sticker** |
| **Matrix session card** | Spot + selected planner day (cards with `rideableCount === 0` are usually hidden; if shown, **😢**) |
| **Watchlist card** | Server `excitement` on watch payload (client may recompute if missing for offline dev); **😢** when watched day has no qualifying window |

Horizon **Today** label unchanged. On narrow cards, stickers may overlap date row slightly — acceptable if `alt` / tooltip carry meaning.

### Assets (interim)

CSS text stickers: horizontal bold uppercase; **fill** from Beaufort (`colorForExcitementTier`). **Chip**: `rgba(15,20,34,0.94)` rounded rect padding (matches `base-card`), no text stroke. Bust **😢** in same chip.

Future: replace with `public/img/stickers/{stickerKey}.webp` when art is ready (`renderStickers` can switch on a flag).

`copy.js` — `stickerLabel`, `tierLabel`, `flairLabel` for tooltips / `aria-label`.

### Accessibility

- Illustrated tiers: `img` with meaningful `alt` (= sticker name)
- Bust: `role="img"` + `aria-label` (not alt on emoji alone)
- `title` or `aria-describedby` for tooltip line + % (excitement tiers only)
- Stickers are decorative for ranking; **rank order unchanged**

## Edge cases

| Case | Behavior |
|---|---|
| No qualifying rideable window | **😢** bust sticker (horizon, watch, any visible spot card) |
| `t < STICKER_FLOOR` but rideable | Standard — no sticker |
| Degenerate anchors | No stickers |
| Distant favorite with window | Stickers allowed (no proximity in score) |
| Multiple spots tie on horizon | Pick highest `t'`, then longer `rideableCount`, then nearer spot |

## Out of scope (v1)

- Stickers as ranking inputs or alert qualification changes
- Per-user custom tier names or uploaded art
- Animated stickers
- Exact score shown in UI beyond tooltip %
- More than one flair per card

## Testing

- Unit: zero consensus window → `tier === 'bust'`; anchor-min rideable → `tier === none`; modest above-min → still `none` until `t ≥ STICKER_FLOOR`; `t'` monotonic when wind/window increase
- Flair: synthetic metrics triggering Quick hit vs Marathon vs none
- Client/server parity: same fixtures in `sessionExcitement.test.js` run against both modules (or shared test vectors file)

## Environment / config

No env vars v1. Future: `EXCITEMENT_GAMMA` override for dogfooding.

## Rollout

1. Ship `sessionExcitement` + tests (server + client)
2. Matrix + horizon rendering + CSS
3. Watchlist API field + strip UI
4. Art pass on sticker PNGs/WebP (placeholder silhouettes OK for first PR)
