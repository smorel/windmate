# Inferred Spot Wind Direction (Shore-Normal) — Design Spec

**Date:** 2026-09-13  
**Status:** Draft (pending user review)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Spot Ranking](./2026-09-08-session-ranking-design.md), [Spot Map Picker](./2026-09-09-spot-map-picker-design.md), [Gemini spot intel & wind_hints](./2026-09-14-spot-intel-gemini-provenance-design.md#wind-direction--complementing-igetwind), `src/services/offshore.js`, `public/js/spotMap.js`

## Goal

Compute **onshore** compass sectors from shoreline geometry for **every** spot, compare to stored `ideal_directions`, and surface mismatches on the matrix **spot map** so the algorithm can be validated before it drives ranking or offshore blocking.

Inference uses the **shore-normal** at the closest point on the land/water boundary: tangent along the **smoothed** separation line; onshore axis **from water toward land** (meteorological “wind from” direction).

## User stories

> "This spot has seed directions from iGetwind — I still want Windmate to compute what the shore says and warn me when they disagree."

> "On the little map I want to see **both** wedges — stored vs computed — until we trust the algo."

> "Once we're confident, flip a switch to use computed directions and keep them cached on the spot so we don't hit OSM every request."

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Compute | **Always** run inference when spot has coordinates (insert, update, backfill, cache miss/stale) |
| Ranking / offshore (now) | **`shadow` mode** — rideability, alerts, and rank still use **stored** `ideal_directions`; empty stored → optional gap-fill from cached inference only when confidence **high** (same as today for empty spots) |
| Ranking / offshore (later) | **`authoritative` mode** (env or product flag) — use cached inference when confidence **high**, else fall back to stored |
| Mismatch | When stored non-empty **and** computed confidence **high** **and** sectors disagree → **warning** on matrix card + **dual wedges** on spot map |
| Cache | Persist full result in `spots.direction_inference`; reuse until pin moves, algo version bumps, or validation-phase TTL expires |
| Geometry | Closest **P** on smoothed boundary; chord tangent; inward normal water → land |
| Data source | OSM land/water boundary (not matrix thumbnail CV) |

## Phased behavior

```text
                    ┌─────────────────────────────────────┐
                    │  computeShoreNormalDirections(spot) │
                    └─────────────────┬───────────────────┘
                                      │
                         persist direction_inference (cache)
                                      │
              ┌───────────────────────┴───────────────────────┐
              │ compare stored ideal_directions vs computed      │
              └───────────────────────┬───────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
    no stored                   match (high)                  mismatch (high)
         │                            │                            │
  gap-fill if high              no warning                 warning + dual map
  for rideability               dual map OK                wedges
         │                            │                            │
         └────────────────────────────┴────────────────────────────┘
                                      │
              effectiveIdealDirections(spot)  ← mode-dependent
                 shadow: stored (gap-fill if empty)
                 authoritative: computed if high else stored
```

## Scope

### In scope (validation release)

- Shore-normal inference service + smoothing pipeline + unit tests
- `direction_inference` JSON column + cache read/write
- Always compute on spot create/update/sync; backfill all spots
- Compare stored vs computed; expose on API:
  - `ideal_directions` (stored, unchanged)
  - `direction_inference` (cached computed payload)
  - `direction_validation`: `{ status, stored, computed, message? }`
- Matrix spot map: **two** sector layers (stored + computed) + mismatch callout
- `DIRECTION_INFERENCE_MODE` env: `shadow` (default) | `authoritative`
- Cache invalidation: lat/lng change, `inference_algo_version` bump, optional TTL during validation

### Out of scope (validation release)

- Auto-overwriting `ideal_directions` in DB when mismatch
- Admin bulk-approve tool
- Dedicated `onshore_directions` column (future ranking spec)
- River-specific along-channel model

## Geometry

(Unchanged from prior draft — summary.)

1. Clip OSM boundary within **R_clip** (default 2000 m).
2. Simplify (Douglas–Peucker, **ε** ~ 10 m).
3. Closest point **P** on smoothed polyline to pin.
4. Tangent via chord **A–B** at **±L** arc length (default **L = 120 m**).
5. Inward normal (water → land, half-plane contains pin).
6. Bearing → 16-pt compass center + **±1 sector** expansion → `computed.directions`.

See **Shoreline smoothing** and **Confidence** below.

## Shoreline smoothing (required)

OSM vertices are noisy; tangent must use the **smoothed** polyline and **120 m chord**, not adjacent micro-segments.

| Step | Action |
|------|--------|
| 1 | Local clip to **R_clip** |
| 2 | Simplify (**ε_simplify** ~ 10 m) |
| 3 | Chord tangent at **P** with half-length **L** (80–250 m); require ≥ 40 m arc each side for **high** |
| 4 | Optional single Chaikin pass if still overly dense |

Parameters: `R_clip`, `ε_simplify`, `L`, `max_pin_to_P` (250 m), `max_normal_vs_pin` (45°).

## Confidence

| Level | Use |
|-------|-----|
| **high** | Compare to stored; show computed wedge; eligible for gap-fill / future authoritative mode |
| **low** | Cache result; no mismatch warning; do not gap-fill |
| **failed** | Cache error; no computed wedge |

## Match / mismatch

Only evaluate when **stored** `ideal_directions.length > 0` **and** computed **confidence === 'high'**.

**Primary bearings:** center sector of each set (middle label of 3-sector expansion, or sole label if one).

| `direction_validation.status` | Condition |
|-------------------------------|-----------|
| `no_stored` | Stored empty |
| `no_computed` | Not high confidence |
| `match` | Overlap: stored set intersects computed set **or** angular distance between primary bearings ≤ **22.5°** |
| `mismatch` | High computed + non-empty stored + not `match` |

API example:

```json
"direction_validation": {
  "status": "mismatch",
  "stored": ["SW", "W", "WNW"],
  "computed": ["W", "WNW", "NW"],
  "primary_bearing_stored_deg": 270,
  "primary_bearing_computed_deg": 292.5
}
```

## Effective directions (rideability / rank / alerts)

```text
function effectiveIdealDirections(spot, mode):
  stored = parse(spot.ideal_directions)
  computed = spot.direction_inference  // cached

  if mode === 'authoritative' && computed.confidence === 'high':
    return computed.directions

  if stored.length > 0:
    return stored

  if computed.confidence === 'high':
    return computed.directions   // gap-fill only in shadow

  return []
```

Default **`mode = shadow`**. Single helper; all server paths call it.

**Do not** write computed sectors into `ideal_directions` until a deliberate migration / product decision after validation.

## Data model

### `spots.direction_inference` (TEXT JSON, nullable)

Cached compute result — **always** populated when inference succeeds (including low/failed with reason).

```json
{
  "algo_version": 1,
  "directions": ["W", "WNW", "NW"],
  "bearing_deg": 285.2,
  "confidence": "high",
  "source": "osm_shore_normal",
  "computed_at": "2026-09-13T21:00:00.000Z",
  "pin": { "lat": 45.1, "lng": -73.2 },
  "P": { "lat": 45.101, "lng": -73.205 },
  "smoothing": { "R_clip_m": 2000, "epsilon_m": 10, "tangent_half_length_m": 120 },
  "error": null
}
```

### Cache policy

| Event | Action |
|-------|--------|
| Spot created / lat\|lng updated | Recompute; replace cache |
| Cache hit, same pin + `algo_version` | Skip OSM fetch |
| Validation phase (optional) | `INFERENCE_CACHE_TTL_MS` (e.g. 7d) forces refresh for tuning |
| Algo stable | Set TTL to 0 / omit — cache until pin or version change |

Store **`algo_version`** in JSON; bump constant when smoothing or match logic changes → automatic recompute on next spot touch or backfill job.

### API (rideability / forecast spot object)

| Field | Meaning |
|-------|---------|
| `ideal_directions` | Stored DB value (source of truth for shadow mode) |
| `direction_inference` | Cached computed payload |
| `direction_validation` | Match result for UI |

## UI — matrix spot map (`spotMap.js`)

When `direction_inference.confidence === 'high'` and `directions.length`:

| Layer | CSS class | When |
|-------|-----------|------|
| Stored sectors | `spot-map-ideal-sector spot-map-ideal-sector--stored` | Stored non-empty |
| Computed sectors | `spot-map-ideal-sector spot-map-ideal-sector--inferred` | Always show in validation (distinct color / dashed stroke) |

When stored empty, show **inferred** wedge only (label in legend: "Computed onshore").

When **`direction_validation.status === 'mismatch'`**:

- Callout above or below map (matrix panel): short warning — e.g. *"Stored ideal direction doesn't match shoreline inference — check wedges."*
- Optional compact legend: **solid** = stored, **dashed** = computed
- `aria-label` mentions both when mismatch

Copy keys in `copy.js` (`WindmateCopy.map.directionMismatch`, legend strings).

No blocking modal; informational for developers / power users until authoritative mode.

## Integration

| Module | Change |
|--------|--------|
| `src/services/directionInference/` (new) | OSM fetch, smooth, compute, compare |
| `src/utils/effectiveIdealDirections.js` | Mode + gap-fill |
| `src/db.js` | Column + invalidate on coordinate update |
| `src/services/rideability.js`, rank, alerts, departure | `effectiveIdealDirections` |
| Rideability JSON | Include inference + validation |
| `public/js/spotMap.js` | Dual wedges + mismatch callout |
| `public/js/app.js` | Pass validation into map render |
| `public/css/styles.css` | `--stored` / `--inferred` sector styles |
| `igetwindSync`, `POST /api/spots` | Trigger inference async or inline (fail soft) |

## OSM / runtime

- Regional extract or Overpass with per-spot cache in DB (not per HTTP request).
- Inference failure must not block spot save or rideability response.
- Background backfill job for all spots.

## Testing

- Synthetic polylines: noise, bay, straight shore — bearing stability.
- Match/mismatch unit tests on sector pairs.
- Fixture: stored matches computed → `status: match`, no warning flag.
- Fixture: seed Montreal spot with intentional wrong stored → mismatch.
- Shadow mode: rideability unchanged vs stored despite computed different.

## Acceptance

- [ ] Every spot with coords gets `direction_inference` cached after backfill or save.
- [ ] Second rideability request does not refetch OSM (cache hit).
- [ ] Mismatch spot shows **two** wedges + warning on matrix map.
- [ ] Match spot with stored data shows both wedges (or stored + faint computed overlay — product choice: **both visible whenever high computed** for easier eyeballing).
- [ ] `DIRECTION_INFERENCE_MODE=shadow` + mismatch → offshore/rank still follow **stored**.
- [ ] `DIRECTION_INFERENCE_MODE=authoritative` + high computed → rank/offshore follow **computed** (flag documented, off by default).
- [ ] Pin move invalidates and recomputes cache.

## Future

- After validation: default `authoritative`, optional one-time copy computed → `ideal_directions`
- `onshore_directions` separate from sport "ideal"
- Precomputed shoreline tiles for footprint
- Spot editor: "Accept computed directions"
