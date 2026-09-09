# Session Spot Ranking — Design Spec

**Date:** 2026-09-08  
**Status:** Draft  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Watchlist](./2026-09-08-session-watchlist-design.md), [Realtime Wind](./2026-09-08-realtime-wind-design.md)

## Goal

Rank nearby spots for a **particular day (session)** using more than wind speed alone. Users declare what they want — no offshore wind, flat vs small vs big waves — and Windmate scores each spot using **rideability**, **proximity**, **wind direction safety**, **wave conditions**, **water quality**, and **water level / launch constraints** (foil depth when level is low; kite rigging room when level is high on a tight beach).

The Horizon Planner and rideability matrix today sort mainly by rideable hours or distance. This spec replaces that with a **session score** so the best spot for *your* preferences floats to the top.

## User story

> "Thursday I want flat water, no offshore, and I'm foiling — don't send me to Beauharnois if the Ottawa River spot is closer, flat, and onshore. Also Oka had a cyanobacteria bloom last week; don't rank it #1 if there's still an advisory. And Verdun needs enough water depth for my 85 cm mast."

> "Saturday I'm kiting. Verdun has the wind but the river's high and the beach is tiny — rigging is a nightmare when the water's up the bank. Rank a wider beach like Oka higher even if wind's a touch lighter."

> "Sunday I'm wingfoiling. Saint-Timothée has the wind but the water's a bit low — I can walk out and paddle before I lift, it's just a pain. Lac Saint-Louis is shallower too but no long algae mats this week. Rank the cleaner, easier launch higher even if wind's similar."

## User preferences (new fields)

Extend `user_preferences`:

| Field | Type | Default (wingfoil) | Description |
|---|---|---|---|
| `offshore_wind_ok` | INTEGER 0/1 | `0` | When `0`, penalize or block hours where wind is **offshore** for the spot |
| `wave_preference` | TEXT | `flat` | `flat` · `small` · `any` · `big` — see [Wave bands](#wave-bands) |
| `min_foil_depth_cm` | INTEGER | nullable | User mast + margin; used when spot has level data. Default sport suggestion: **85** cm all-in (mast + fuselage) for wingfoil |
| `rank_by_proximity` | INTEGER 0/1 | `1` | Include distance in session score (always on for v1 ranking) |
| `rank_criteria_order` | TEXT (JSON) | see default below | Ordered list of criterion keys — **top = most important** |

Default `rank_criteria_order`:

```json
["rideability", "bestWindow", "proximity", "wind", "onshore", "waveMatch"]
```

Weights derived from position: rank 1 gets `6/21`, rank 2 gets `5/21`, … rank 6 gets `1/21`.

**UI (Preferences panel):**

- **Offshore wind:** toggle — "Offshore OK" vs "Avoid offshore" (default avoid)
- **Waves:** radio — Flat · Small (≤ 1 m) · Any · Big waves preferred
- **Foil depth:** optional cm input — "Min water depth for my setup" (hint: mast length + ~15 cm margin)

Changing sport resets wave/offshore defaults:

| Sport | `offshore_wind_ok` | `wave_preference` | Notes |
|---|---|---|---|
| wingfoiling | 0 | `flat` | Offshore + chop is worst case for foil |
| kitesurfing | 0 | `small` | Offshore is dangerous; **launch beach** constraints apply when level is high |
| sailing | 1 | `any` | Dinghy sailors often accept more chop |

## Spot metadata (extensions)

Extend `spots`:

| Column | Type | Notes |
|---|---|---|
| `onshore_directions` | TEXT | JSON array — compass dirs that blow **onshore** at this launch (e.g. `["W","WNW"]`). Complement ≈ offshore |
| `shore_exposure` | TEXT | `sheltered` · `moderate` · `open` — baseline chop expectation when wave model is coarse |
| `water_body_type` | TEXT | `lake` · `river` · `estuary` · `coastal` |
| `water_body_id` | TEXT | nullable — FK key for hydrometric / quality feed (see below) |
| `min_launch_depth_m` | REAL | nullable — depth at launch line (shore); not whole riding area |
| `walk_to_foil_m` | REAL | nullable — typical walk/paddle to adequate foil depth at reference level |
| `launch_beach_size` | TEXT | `tight` · `moderate` · `wide` — dry beach for rigging at **reference** level; kitesurfing |
| `reference_water_level_m` | REAL | nullable — hydrometric datum when beach is "normal"; used with current level |
| `beach_width_m` | REAL | nullable — typical dry beach width at reference level (optional; improves estimates) |
| `quality_region_id` | TEXT | nullable — provincial bloom/advisory region slug |

Seed Montreal spots with `onshore_directions` aligned to existing `ideal_directions` where they represent onshore wind; document exceptions (e.g. river spots where "ideal" is cross-shore).

## Wave bands

Forecast source: Open-Meteo Marine `wave_height` (or `swell_wave_height` + `wind_wave_height` where available). For sheltered inland spots with no marine cell, infer from `shore_exposure` + wind speed heuristic (label `waveSource: "estimated"`).

| User `wave_preference` | Preferred wave height (m) | Score peak |
|---|---|---|
| `flat` | 0 – 0.3 | 1.0 at 0 m; falls off above 0.3 m |
| `small` | 0 – 1.0 | 1.0 at 0–0.5 m; acceptable to 1.0 m |
| `any` | — | neutral (1.0) unless extreme (> 2 m → slight penalty for foil) |
| `big` | 1.0+ | reward heights ≥ 1 m (mainly sailing/wave spots) |

Use **max wave height in the spot's best rideable window** for that session day, not single-hour noise.

## Offshore detection

For each rideable hour:

```
offshore = wind direction NOT in spot.onshore_directions
           AND NOT in cross_shore_tolerance (±1 compass sector from onshore edge)
```

| `offshore_wind_ok` | Behavior |
|---|---|
| `0` | Hour is **not rideable for ranking** if offshore (same severity as weather block for score); show striped **offshore** block in matrix |
| `1` | Offshore hours rideable but score −0.2 vs onshore |

**UI:** offshore hour with good wind → amber striped block + tooltip: "Offshore — you said you prefer onshore."

Onshore alignment with `ideal_directions` remains a **bonus** (+0.1) when both match.

## Water quality

Canadian lakes and rivers (especially Quebec) can have **cyanobacteria (blue-green algae)** blooms and general algae that make foiling unpleasant or unsafe (skin irritation, toxins, visible scum, foil clogging).

Wingfoilers care about two distinct things:

1. **Health / safety** — official bloom advisories, toxins, closures (hard gates when severe).
2. **Nuisance algae** — long filamentous algae, weed mats, scum you can **technically** foil through but would rather not. No advisory required; still **lowers appeal** vs other spots with similar wind.

### Health advisory levels

| Level | Meaning | Ranking impact |
|---|---|---|
| `none` | No known issue | neutral |
| `watch` | Elevated algae possible | −0.15 score; show yellow badge |
| `advisory` | Bloom confirmed — avoid contact | −0.4 score; banner on spot card |
| `closed` | Official closure / toxic bloom | **Hard block** for session rank (spot pinned bottom, strikethrough) |

### Nuisance algae (wingfoil appeal)

Separate from health advisories — detected via social posts, cams, manual intel, or seasonal spot notes. Stored as `nuisance_level` alongside `level` in quality/intel cache.

| `nuisance_level` | Meaning | Wingfoil ranking impact |
|---|---|---|
| `none` | Clean or normal | neutral |
| `light` | Some weeds / short algae near shore | −0.1; subtle badge |
| `moderate` | Long algae mats — walk through or foil with drag | −0.25; "Long algae mate — foil'll feel gunky" |
| `heavy` | Thick mats, constant clogging, unpleasant session | −0.4; prefer other spots; **not** a hard block unless paired with `advisory` |

**Sport weighting:** apply full nuisance penalty for `wingfoiling`; half penalty for `kitesurfing` (lines/launch); minimal for `sailing`.

Kitesurfing and sailing still use **health** levels fully; nuisance is wingfoil-first.

### Data sources (implementation order)

1. **Manual / curated** — JSON or admin update on `spot_quality_cache` for seed spots (fastest for MVP ranking)
2. **Quebec MELCC / provincial open data** — swim advisory or bloom bulletins by water body (parse RSS/CSV where available)
3. **Environment Canada** — linked bulletins; no unified lake API today
4. **Community signals** — cross-link [Spot Local Intel](./2026-09-09-spot-local-intel-design.md) for algae, debris, launch flooding, and access
5. **Parking & access** — seasonal lot closure and flooded roads lower rank; see [Spot Local Intel — Parking](./2026-09-09-spot-local-intel-design.md#parking) and [Access](./2026-09-09-spot-local-intel-design.md#access-roads-and-site-closure)

### `spot_quality_cache`

| Column | Type | Notes |
|---|---|---|
| spot_id | TEXT | PK |
| fetched_at | INTEGER | Unix ms |
| level | TEXT | `none` · `watch` · `advisory` · `closed` — health/safety |
| nuisance_level | TEXT | `none` · `light` · `moderate` · `heavy` — long algae / weed mats (appeal) |
| nuisance_summary | TEXT | nullable — e.g. "Long algae along the shore — walk out or deal with it" |
| summary | TEXT | mate-tone one-liner (health or combined) |
| source_url | TEXT | link to official bulletin |
| valid_until | TEXT | ISO date nullable |

TTL: **6 h** during bloom season (Jun–Oct), **24 h** otherwise.

**Copy examples:**

- watch: "Algae possible at Oka — keep an eye out mate."
- advisory: "Bloom at Oka — I'd skip foiling there today."
- closed: "Oka's closed for contact — don't go in."
- nuisance moderate: "Long algae at Saint-Timothée — you'll be walking through it mate."
- nuisance light: "Bit of weed near shore at Verdun — not the end of the world."

## Water level & launch constraints

Water level affects sports differently:

| Sport | Primary risk | Spot metadata |
|---|---|---|
| **Wingfoil / foil** | Too **low** at launch — walk/paddle out before foiling; still **less appealing** than a deep launch | `min_launch_depth_m`, user `min_foil_depth_cm`, `walk_to_foil_m` |
| **Kitesurfing** | Too **high** on a **tight beach** — no room to rig, lines in trees/obstacles, sketchy launch | `launch_beach_size`, `reference_water_level_m`, optional `beach_width_m` |
| **Sailing** | Usually launch from deeper water or ramp; level matters less unless spot-specific | optional depth fields |

Rivers and lakes vary seasonally (spring freshet, dam releases). A spot with great wind can be a bad session when the bank is underwater or the beach is gone.

### Wingfoil — depth & launch appeal (level too low)

| Field | Use |
|---|---|
| `min_launch_depth_m` on spot | Depth at the **launch line** (shore/ramp), not the whole riding area |
| User `min_foil_depth_cm` | User's required depth (mast setup) |
| `walk_to_foil_m` | nullable — typical distance to adequate depth at **reference** level (walk or knee-paddle) |

Effective minimum depth: `max(spot.min_launch_depth_m, user.min_foil_depth_cm / 100)` when both set.

**Important:** a spot can be **rideable** but **unappealing** — launch is shallow yet deeper water exists 20–80 m out. Users can walk or paddle before lifting; Windmate should still **rank it below** spots with wind + depth at the beach.

**Estimated walk today** (when `walk_to_foil_m` and level data exist):

```
walk_multiplier = 1 + max(0, (required_depth - launch_depth_m) / 0.1) × 0.5
effective_walk_m = walk_to_foil_m × walk_multiplier   // rough; tune at implementation
```

When launch depth unknown but level is `shallow_marginal`, assume `walk_short`. Social intel ("long walk to deep water") overrides estimates.

| State | Condition | Wingfoil ranking impact |
|---|---|---|
| `ok` | Adequate depth at launch | neutral |
| `walk_short` | Shallow launch; ~10–30 m to foil (or `effective_walk_m` in range) | −0.15; "Walk out a bit before you foil" |
| `walk_long` | ~30–80 m walk/paddle before adequate depth | −0.3; "Shallow launch — you'll be walking mate" |
| `shallow_marginal` | Within 0.2 m of required at launch; short walk likely | −0.2 |
| `shallow` | Below required at launch and long walk or bottom risk near shore | −0.45; strongly prefer other spots |
| `unknown` | no level data | neutral |

These are **appeal penalties**, not hard blocks — unless depth is so low that foiling near shore is unsafe (`shallow` + user depth margin violated).

### Kite — launch beach (level too high)

Kites need **dry beach** (or very shallow margin) to lay out lines and launch. When level rises above reference, usable beach shrinks — painful first on `tight` spots (river walls, narrow park strips, Verdun-style launches).

**Estimated usable beach** (when `beach_width_m` and `reference_water_level_m` set):

```
level_delta_m     = current_level_m - reference_water_level_m
usable_beach_m    = max(0, beach_width_m - level_delta_m)
```

When only `launch_beach_size` is set (no numeric width), use category thresholds vs `level_delta_m`:

| `launch_beach_size` | `level_delta` caution | `level_delta` severe |
|---|---|---|
| `tight` | ≥ 0.3 m above reference | ≥ 0.6 m |
| `moderate` | ≥ 0.6 m | ≥ 1.0 m |
| `wide` | ≥ 1.0 m | ≥ 1.5 m |

Default `min_kite_launch_beach_m` = **20 m** usable dry beach (tunable constant). Below that → launch constraint applies for `sport === kitesurfing`.

**Social / intel override:** posts like "no beach left" or cam showing water at the grass → bump to `severe` even if hydrometric math says `caution` (see [Spot Local Intel — launch room](./2026-09-09-spot-local-intel-design.md#launch-room-kitesurfing)).

### Hydrometric data

| Source | Coverage | Fields |
|---|---|---|
| Environment Canada Water Office (`wateroffice.ec.gc.ca`) | Rivers, some lakes | `water_level_m`, trend |
| Quebec CEHQ / Hydro-Québec | St. Lawrence, Ottawa, Richelieu | level, flow |

Link spot → station via `water_body_id` (station ID).

### Level adequacy (sport-aware)

Computed per user `sport`. Store raw hydrometrics in cache; derive `adequacy` + `constraint` at read time.

| State | Condition | Sports | Ranking impact |
|---|---|---|---|
| `ok` | Depth OK at launch; launch beach OK | all | neutral / +0.05 if comfortably above reference |
| `walk_short` | Shallow launch; adequate depth after short walk/paddle | **wingfoiling** | −0.15; see [Wingfoil depth](#wingfoil--depth--launch-appeal-level-too-low) |
| `walk_long` | Shallow launch; long walk/paddle before foiling | **wingfoiling** | −0.3 |
| `shallow_marginal` | Within 0.2 m of required at launch | **wingfoiling** | −0.2 |
| `shallow` | Unsafe or impractical depth at launch | **wingfoiling** | −0.45 |
| `launch_tight` | High level + tight/moderate beach; usable beach marginal | **kitesurfing** | −0.3; badge "Beach is tight — tricky kite launch" |
| `launch_blocked` | High level; usable beach below minimum or `tight` + severe delta | **kitesurfing** | −0.5; strongly discourage; prefer other spots |
| `unknown` | no station or stale data | all | neutral; "Level unknown" — do not block |

For **St. Lawrence / tidal influence**, use forecast tide + river level composite (v2); v1 static threshold vs current level only.

Non-kite sports **ignore** `launch_tight` / `launch_blocked`. Non-wingfoil sports **ignore** `walk_short` / `walk_long` unless user sets foil depth.

### `spot_level_cache`

| Column | Type | Notes |
|---|---|---|
| spot_id | TEXT | PK |
| fetched_at | INTEGER | Unix ms |
| water_level_m | REAL | |
| level_delta_m | REAL | vs spot `reference_water_level_m` when set |
| usable_beach_m | REAL | nullable — computed when `beach_width_m` set |
| trend | TEXT | `rising` · `falling` · `stable` |
| adequacy | TEXT | `ok` · `walk_short` · `walk_long` · `shallow` · `shallow_marginal` · `launch_tight` · `launch_blocked` · `unknown` |
| effective_walk_m | REAL | nullable — estimated walk/paddle to foil depth (wingfoil) |
| constraint | TEXT | `none` · `depth` · `walk_out` · `launch_beach` — which rule fired |
| station_name | TEXT | |

TTL: **1 h**.

**Copy examples (wingfoil):**

- walk_short: "A bit shallow at the beach — short walk before you foil."
- walk_long: "Low water mate — you'll be walking out before you lift."
- shallow: "Pretty shallow at the launch — other spots might be easier today."

**Copy examples (kite):**

- launch_tight: "River's up mate — Verdun's beach is pretty tight for kiting today."
- launch_blocked: "No room to rig at Verdun — water's too high. Try a wider beach."

## Session score (per spot, per day)

Computed for each spot for a given **session date** (today or planner day). Used to sort the rideability matrix and "best spot today" hero.

### Inputs

| Factor | Weight | Range | Notes |
|---|---|---|---|
| **Rideability** | 0.35 | 0–1 | Fraction of day's hours that are rideable (wind + weather + temp + offshore gate) |
| **Best window quality** | 0.20 | 0–1 | Duration × avg wind in best contiguous window, normalized |
| **Proximity** | 0.15 | 0–1 | `1 − (distance_km / radius_km)` clamped |
| **Wave match** | 0.10 | 0–1 | From [Wave bands](#wave-bands) |
| **Onshore / direction** | 0.10 | 0–1 | Share of rideable hours onshore; bonus if matches `ideal_directions` |
| **Water quality** | 0.05 | 0–1 | Health: 1.0 none → 0.0 closed; **nuisance algae** (wingfoil) stacked separately −0.1…−0.4; merge [intel](./2026-09-09-spot-local-intel-design.md#water-conditions) |
| **Water level** | 0.05 | 0–1 | Sport-aware: wingfoil walk_short/long/shallow; kite launch_tight/blocked; ok=1; unknown=0.8 |
| **Access** | 0.05 | 0–1 | From [spot intel](./2026-09-09-spot-local-intel-design.md#access-roads-and-site-closure); closed = hard block |
| **Parking** | 0.03 | 0–1 | Session-day lot state; closed = strong penalty |

Weights are defaults; stored in code constants (`SESSION_RANK_WEIGHTS`) for tuning.

### Formula (conceptual)

```
sessionScore = Σ (weight_i × factor_i)
if quality.level == 'closed' → sessionScore = 0, rankLast = true
if !any rideable hour → sessionScore *= 0.3  (still show for "next best" but sort low)
```

**Live session day:** when observations available, replace rideability fraction for **elapsed hours** with actual rideable fraction and apply [forecast mismatch](./2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch) multiplier:

```
sessionScoreLive = sessionScore × mismatchMultiplier
  go: 1.0
  caution: 0.7
  no_go: 0.2
  unknown: 0.85
```

### API response fields

`GET /api/rideability` and planner payloads gain per spot:

```json
{
  "sessionRank": {
    "score": 0.82,
    "rank": 1,
    "factors": {
      "rideability": 0.9,
      "bestWindow": 0.85,
      "proximity": 0.72,
      "waveMatch": 1.0,
      "onshore": 0.95,
      "waterQuality": 1.0,
      "waterLevel": 0.5
    },
    "badges": [
      { "type": "water_level", "level": "shallow_marginal", "message": "Shallow — check your 85 cm mast" },
      { "type": "water_level", "level": "launch_tight", "message": "Beach is tight — tricky kite launch" },
      { "type": "water_quality", "level": "watch", "message": "Algae possible — keep an eye out" }
    ],
    "offshoreHoursBlocked": 3
  }
}
```

Sort order: `rank` ascending (1 = best). Watched sessions stay **pinned** above the list per [Session Watchlist spec](./2026-09-08-session-watchlist-design.md); their score still shown.

## UI design

### Preferences panel (additions)

Below wind/temp thresholds:

```
Offshore wind     [ Avoid offshore ▼ ]   (Avoid · OK with offshore)
Waves             [ Flat water ▼ ]       (Flat · Small ≤1 m · Any · Big)
Min foil depth    [ 85 ] cm              (optional)
```

### Rideability matrix

- Column header: **# rank** from session score
- **Top-reason banner** next to spot name — category where the spot leads (e.g. `Best wind`, `Closest`)
- **User ranking order** in Your setup — drag to reorder criteria; top = highest weight (linear decay across 6 items)
- Spot row subtitle: distance · good hours · model
- Offshore-blocked hours: transparent (not rideable); tooltip explains
- Closed water quality: row grayed, score 0, link to advisory (v2)

### Horizon Planner / session day

Hero copy uses ranked #1:

```
Best for you today: Lac Saint-Louis (#1) — 14–18 kt, flat, 12 km, onshore all afternoon
```

When #1 has quality/level warning:

```
Best wind is Beauharnois, but Lac Saint-Louis (#1 for you) is closer, flat launch, and no long algae.
```

### Tooltips

Combine wind + water context:

```
14:00 — 14 kt WSW · rideable · onshore · waves 0.2 m · level OK · no algae advisory
15:00 — 16 kt W · offshore (avoid) · wind OK otherwise
16:00 — 15 kt SW · rideable · launch tight (kite) · river +0.5 m
```

## Service modules (planned)

| File | Responsibility |
|---|---|
| `src/services/sessionRank.js` | Composite score, sort, badge generation |
| `src/services/offshore.js` | Offshore hour detection vs `onshore_directions` |
| `src/services/waves.js` | Marine API fetch, wave band scoring |
| `src/services/waterQuality.js` | Advisory fetch/cache, level mapping |
| `src/services/waterLevel.js` | Hydrometric fetch, adequacy vs foil depth |
| `src/routes/rideability.js` | Attach `sessionRank` to existing response |

## Scope phasing

### v1 — ranking core (preferences + static spot data)

- User prefs: offshore, wave preference, foil depth
- Spot fields: `onshore_directions`, `shore_exposure`, `min_launch_depth_m`, `launch_beach_size`, `reference_water_level_m`
- Score: rideability, window, proximity, offshore, wave (estimated if no marine)
- Sort matrix by `sessionRank.score`
- Manual `spot_quality_cache` for 2–3 seed spots as proof

### v2 — water intelligence

- Hydrometric `spot_level_cache` for river spots (Carillon, Beauharnois, Verdun)
- Provincial quality feed or scheduled manual updates for Oka, Saint-Timothée, etc.
- Marine wave_height for St. Lawrence / Plattsburgh coastal spots

### v3 — live ranking on session day

- Mismatch multiplier from realtime observations
- Re-rank hourly as live data shifts go/no-go

## Testing checklist

- [ ] `offshore_wind_ok = 0` removes offshore hours from rideable count and adds `offshoreHoursBlocked`
- [ ] `wave_preference = flat` ranks sheltered 0.2 m spot above open 0.8 m spot with equal wind
- [ ] Proximity breaks tie when scores within 0.05
- [ ] `quality.level = closed` forces rank last regardless of wind
- [ ] `adequacy = shallow` with user foil depth penalizes below `min_launch_depth_m`
- [ ] `walk_long` ranks below `walk_short` at equal wind; neither hard-blocks
- [ ] `nuisance_level = moderate` penalizes wingfoil more than kitesurfing at same wind
- [ ] `sport = kitesurfing` + high level + `launch_beach_size = tight` → `launch_tight` or `launch_blocked`
- [ ] `sport = wingfoiling` ignores `launch_tight`; uses walk_out / nuisance algae instead
- [ ] Rising trend bumps kite launch constraint one step (optional v2)
- [ ] Unknown level/quality does not crash score; badges omitted
- [ ] Preferences persist and sport change resets offshore/wave defaults
- [ ] UI shows rank # and factor chips on spot rows

## Open questions

1. **Cross-shore tolerance** — treat ENE as onshore when onshore is `["E","SE"]`? Default ±22.5° from nearest onshore sector.
2. **Bilingual advisories** — Quebec bulletins in French; summarize in mate English or mirror locale?
3. **Kite vs foil depth** — kitesurfing ignores `min_foil_depth_cm` unless user sets it; uses launch beach constraints instead.
4. **Seed spot beach data** — which Montreal spots are `tight` (Verdun, Lachine wall, Carillon ramp)?
