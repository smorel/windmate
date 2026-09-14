# Spot Intel — Gemini, Day Brief & Field Provenance

**Date:** 2026-09-14  
**Status:** Draft (pending user review)  
**Parent:** [Spot Local Intel](./2026-09-09-spot-local-intel-design.md)  
**Related:** [Inferred Spot Wind Direction](./2026-09-13-inferred-spot-wind-direction-design.md) (OSM shore-normal — primary geometry complement to iGetwind)

## Goal

1. **Regional spot catalog** — Gemini + Search discovers launches missing from iGetwind / manual spots.  
2. **Spot profile** — Slow-changing facts (depth, parking, hazards, community reputation, wind reference links).  
3. **Day brief** — Per planner `session_date`: headline, “today at the spot”, and `IntelSignal`s for ranking.  
4. **Provenance on every displayed field** — Each intel block shows a small **(i)** control so riders can verify where data came from.

Later: **social/API fetchers** supply raw posts for “today”; Gemini **classifies and summarizes** (not open-ended search) into the day brief.

## Non-goals

- Auto-moving spot pins from Gemini coordinates without admin review  
- Using Gemini wind directions for ranking when `DIRECTION_INFERENCE_MODE=shadow` (show as reference only)  
- Scraping behind login walls

---

## Architecture

```text
                    ┌─────────────────────┐
                    │ Prompt 1: Catalog   │  admin / rare cron
                    │ Search (+ Maps)     │  → staging → dedupe → spots
                    └─────────────────────┘

┌──────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
│ Fetchers v2  │───▶│ Day context pack    │───▶│ Prompt 2: Day brief  │
│ Reddit, HTML │    │ posts + static prof │    │ Gemini parser        │
└──────────────┘    │ + Windmate snippet  │    └──────────┬───────────┘
                    └─────────────────────┘               │
                                                          ▼
              spot_intel_profile (static)     spot_intel_day_cache (per date)
                          │                              │
                          └──────────┬───────────────────┘
                                     ▼
                          GET /api/spots/:id/intel?date=
                                     ▼
                          Spot Details drawer (+ (i) per section)
```

| Job | Trigger | Cache | Ranking |
|-----|---------|-------|---------|
| Catalog | Script / admin | Staging JSON | No |
| Profile | After spot approve; refresh monthly | `spot_intel_profile` | Soft (launch depth copy) |
| Day brief | Drawer expand + `date` | `spot_intel_day_cache` | Yes via `signals` |

**Search grounding:** Use on catalog and on day brief **only when fetchers return no posts**. When `fetched_posts[]` is non-empty, Gemini must cite those URLs in provenance.

---

## Data model

### `spot_intel_profile` (1:1 `spots`)

| Column | Type | Notes |
|--------|------|--------|
| `spot_id` | TEXT | PK, FK → spots |
| `profile` | TEXT | JSON `SpotIntelProfile` |
| `fetched_at` | INTEGER | Unix ms |
| `profile_version` | INTEGER | Bump when schema changes |

### `spot_intel_day_cache` (per spot + date)

| Column | Type | Notes |
|--------|------|--------|
| `spot_id` | TEXT | FK |
| `session_date` | TEXT | ISO date |
| `headline` | TEXT | Mate one-liner |
| `overall_level` | TEXT | `ok` · `caution` · `closed` · `unknown` |
| `day` | TEXT | JSON `SpotIntelDayBrief` |
| `signals` | TEXT | JSON `IntelSignal[]` (ranking) |
| `fetched_at` | INTEGER | Unix ms |
| PK | | `(spot_id, session_date)` |

Keep **`spot_intel_cache.media_gallery`** as today (or move media to profile later). Do not overload a single `valid_for_date` row for all planner days.

### `FieldProvenance` (required on every UI field)

Every user-visible string (or structured value) in profile and day brief is wrapped or paired with provenance:

```json
{
  "source_kind": "official_feed",
  "source_label": "Parc national d'Oka — Horaires",
  "source_url": "https://www.sepaq.com/...",
  "citations": [
    { "url": "https://...", "title": "...", "snippet": "optional" }
  ],
  "published_at": "2026-05-01T00:00:00-04:00",
  "fetched_at": "2026-09-14T14:00:00-04:00",
  "extracted_by": "parser",
  "confidence": "high",
  "model": "gemini-2.5-flash",
  "derivation": null
}
```

When the value is **inferred or synthesized** (not a single copy-paste from one page), `derivation` is **required** — see below.

| `source_kind` | Meaning |
|---------------|---------|
| `manual` | Admin seed / JSON import |
| `official_feed` | Municipal, Sépaq, NCC, CEHQ allowlist HTML |
| `social_api` | Reddit (etc.) API result cited in `citations` |
| `community_guide` | Third-party article (e.g. kite shop spot page) |
| `gemini_search` | Gemini + Google Search grounding |
| `gemini_parser` | Gemini on provided fetcher text only |
| `windmate` | Internal computed (hydro, forecast, shore-normal wind) — **must** include `derivation` explaining the calculation |
| `igetwind` | iGetwind spot page |
| `unknown` | **Do not show in UI** except as "We don't have a source yet" |

| `extracted_by` | `manual` · `parser` · `official_feed` · `windmate` |

### `derivation` (inference & synthesis)

Use when the UI cannot be honest with a single hyperlink alone — e.g. Gemini summary of multiple posts, Windmate ranking factor, merged official + social, or Search-grounded paraphrase.

```json
{
  "summary": "Two posts today mention low water; we matched that to shallow-entry notes for wingfoil.",
  "steps": [
    {
      "kind": "social_api",
      "label": "Facebook — Hudson wing group",
      "url": "https://facebook.com/...",
      "detail": "“Water’s low at the beach” (9:12 am)"
    },
    {
      "kind": "windmate_metric",
      "label": "CEHQ level at Oka",
      "url": "https://...",
      "detail": "Gauge 21.8 m — within normal band; launch still walk-heavy per spot profile."
    },
    {
      "kind": "model_reasoning",
      "label": "Classified as water / caution",
      "detail": "Parser keywords: bas, marche, foil; no official closure."
    }
  ]
}
```

| `steps[].kind` | Typical use |
|----------------|-------------|
| `citation` | One grounded web page (prefer `url` on the step) |
| `social_api` | Reddit / FB / IG fetcher item |
| `official_feed` | Parsed municipal HTML snippet |
| `windmate_metric` | Hydro, obs station, forecast window, quality cache |
| `windmate_geometry` | Shore-normal / `direction_inference` — link to algo version in `detail` |
| `model_reasoning` | How Gemini mapped inputs → this field (short, auditable) |
| `manual_note` | Admin seed rationale |

**When `derivation` is required**

| Situation | `derivation` |
|-----------|----------------|
| Single official page, text lightly edited | Optional; `source_url` + clickable citation enough |
| `gemini_parser` day headline / `community_today` | **Required** — cite every post used in `steps` |
| `gemini_search` paraphrase | **Required** — `citations` + `summary` of what was combined |
| `source_kind: windmate` | **Required** — metrics, thresholds, spot id, cache timestamps in `steps` |
| Multiple `citations` merged into one field | **Required** |

**Validation on ingest (server):**

- If `confidence` is `low` or `source_kind` is `unknown` → field may display with **unverified** styling; **must not** drive ranking penalties.  
- Ranking-affecting `IntelSignal`s require `source_url` **or** (`extracted_by: windmate` with complete `derivation`).  
- Synthesized fields (e.g. `community_today` from 3 posts) → `citations[]` length ≥ 1 **and** `derivation.steps` listing each input; prefer `confidence: high` only when ≥2 agreeing posts or official + social agree.

### `AttributedField<T>`

```json
{
  "value": "Payant (~7 $ à 11 $/jour…)",
  "provenance": { /* FieldProvenance */ }
}
```

Section-level provenance is allowed when **one** source covers the whole block (e.g. entire parking section from one city page). Do not merge unrelated sources without listing each in `citations`.

### `SpotIntelProfile` (static)

Maps from Gemini example payload:

| Section | Fields | Notes |
|---------|--------|--------|
| `meta` | `region_id`, `body_of_water` | |
| `launch` | `water_depth_description`, `sport_notes` | `sport_notes` keyed by sport |
| `access_and_hours` | `summary`, `level` | |
| `parking` | `summary`, `type` | `type`: free · paid · mixed · street · unknown |
| `water` | `quality_summary`, `algae_and_hazards`, `level` | Merge with `spot_quality_cache` for rank |
| `media` | `has_live_water_view`, `webcam_url`, `wind_reference` | `wind_reference.type`, `url` — spot-specific URL required |
| `community` | `all_time`, `last_month` | Each attributed |
| `wind_hints` | See [Wind direction — complementing iGetwind](#wind-direction--complementing-igetwind) | Community / guide sectors; not auto-ranked until merged |

### `SpotIntelDayBrief`

| Field | Notes |
|-------|--------|
| `session_date` | ISO date |
| `community_today` | `AttributedField<string>` |
| `headline` | `AttributedField<string>` |
| `fetched_posts_count` | For debug / empty state |

`signals[]` reuse [IntelSignal](./2026-09-09-spot-local-intel-design.md#intelsignal-shape); each signal **must** include `source_url` (or windmate label).

---

## Wind direction — complementing iGetwind

### Problem

[iGetwind sync](../../src/services/igetwindSync.js) imports **name + coordinates** but sets `ideal_directions` to `[]` unless [Montreal proximity seed](../../src/db.js) (`seedMontrealIdealDirections`, ≤12 km) fills a handful of locals. Many iGetwind pins therefore have **no reliable onshore sectors** for offshore blocking and session ranking, even when the community or iGetwind’s own spot page documents “best in W–NW”.

Windmate already computes **shore-normal sectors** from OSM ([direction inference](./2026-09-13-inferred-spot-wind-direction-design.md)). Gemini profile enrichment adds a **third lane**: documented **community / guide** wind directions with citations (spot articles, forums, iGetwind profile text when fetchable).

### Three sources — roles

| Source | Field | Used for ranking today | Notes |
|--------|--------|----------------------|--------|
| **Stored** | `spots.ideal_directions` | Yes (`effectiveIdealDirections` shadow mode) | Canonical until product flips authoritative inference |
| **Windmate geometry** | `spots.direction_inference` | Gap-fill when stored empty + confidence **high**; authoritative mode when enabled | Pin + shoreline; not “what locals say” |
| **Gemini / guides** | `spot_intel_profile.wind_hints` | **No** until merged | `ideal_directions[]`, `onshore_direction`, narrative; full provenance |

**Goal:** Complement iGetwind spots so riders see **consistent wind sectors** (map wedges + mate copy) and admins can **promote** trusted directions into `ideal_directions` when stored data is missing or wrong.

### `wind_hints` shape (profile)

```json
{
  "ideal_directions": {
    "value": ["W", "NW"],
    "provenance": { "source_kind": "community_guide", "source_url": "https://...", "confidence": "high" }
  },
  "onshore_direction": {
    "value": "NW",
    "provenance": { "source_kind": "igetwind", "source_url": "https://igetwind.com/...", "confidence": "medium" }
  },
  "narrative": {
    "value": "Spot works best with wind from the west quadrant; NE is offshore into trees.",
    "provenance": { "source_kind": "gemini_search", "derivation": { "summary": "...", "steps": [] } }
  },
  "suggested_merge": {
    "ideal_directions": ["W", "NW", "WNW"],
    "reason": "Matches iGetwind page sectors; OSM inference center WNW within one sector.",
    "agreement": { "igetwind_page": true, "direction_inference_high": true, "community_guide": true }
  }
}
```

`ideal_directions` values use the same **16-point compass** labels as the rest of Windmate (`N`, `NE`, …).

### Gemini — wind section (part of Prompt 2 profile)

With **`WindmateAgentContext.spot` lat/lng** and watersports system instruction, ask explicitly:

```text
Research onshore / rideable wind for THIS launch pin (not the region generally).

Return wind_hints:
- ideal_directions: compass sectors when locals or iGetwind document them
- onshore_direction: single best onshore label if stated
- narrative: short FR/EN note (offshore directions, wind shadows, river thermals)

Check in order:
1) iGetwind spot page for this location (if source_url or igetwind_id known)
2) Regional spot guides (kite/wing shops, kiteforce-style pages)
3) Forum posts naming this beach

If only geometry is knowable and no community source exists, say so — do NOT
guess sectors; leave ideal_directions empty and note that Windmate OSM inference
is the fallback.

Include provenance per field; suggested_merge only when ≥2 independent source
kinds agree (e.g. guide + iGetwind, or guide + direction_inference_high).
```

Pass into the prompt when available:

```json
{
  "current_ideal_directions": [],
  "direction_inference": { "directions": ["WNW", "NW", "N"], "confidence": "high", "bearing_deg": 295 },
  "direction_validation": { "status": "mismatch" },
  "igetwind": { "igetwind_id": "...", "source_url": "https://igetwind.com/..." }
}
```

So Gemini **complements** rather than replaces OSM: it can explain disagreements in `narrative` + `derivation`.

### Merge policy (stored `ideal_directions`)

| Condition | Action |
|-----------|--------|
| `ideal_directions` empty, inference **high** | Rideability already gap-fills via `effectiveIdealDirections`; show computed wedge on map |
| `ideal_directions` empty, Gemini `wind_hints` + **high** provenance, inference low/ missing | Show community wedge as **reference** layer; queue `suggested_merge` for admin |
| Stored non-empty, mismatch with inference **high** | Keep stored for rank (shadow); show dual wedges + Gemini narrative if fetched |
| `suggested_merge.agreement` ≥2 true | Admin script may `UPDATE spots SET ideal_directions = ?` with audit log |
| Auto-write `ideal_directions` from Gemini alone | **Out of scope** until validation phase completes — always provenance + optional admin |

### UI

- Spot map: **stored** + **computed** (existing inference spec) + optional **community** wedge from `wind_hints` (distinct color, legend “Guide / iGetwind”).
- Spot Details **Wind** section with (i): show `narrative`, links to iGetwind page and guides, and “Windmate computed from shoreline” when `direction_inference` present (`source_kind: windmate`, `derivation` with algo version).

### iGetwind import improvement (optional, non-Gemini)

If iGetwind API or spot HTML exposes sector metadata later, import into `ideal_directions` on sync **before** Gemini; Gemini then only fills gaps. Until then, profile Prompt 2 + OSM inference is the complement path.

---

## Agent context — precise location & watersports focus

Every Gemini call (catalog, profile, day brief) must include a shared **`WindmateAgentContext`** so the model anchors on the **exact launch pin**, not just the place name, and stays on **wind/water sports** — not generic recreation, marinas, or swimming beaches unless they are used for kite/wing launch.

### When coordinates are known (required)

Windmate stores **`spots.latitude`** / **`spots.longitude`** for catalog spots, iGetwind imports, and user-pinned custom spots. If both are present, the server **must** pass them on every per-spot request:

| Field | Format | Notes |
|-------|--------|--------|
| `latitude` | decimal degrees, ≥4 decimal places | e.g. `45.4568` — use DB value, do not round for the prompt |
| `longitude` | decimal degrees | e.g. `-73.9576` |
| `coordinate_precision` | `"spot_pin"` | Tells the model this is the launch/rigging point Windmate uses for distance & maps |
| `location_anchor_text` | string | e.g. `"Launch pin at Parc-nature de l'Anse-à-l'Orme (Pierrefonds), Lac des Deux Montagnes, QC"` |

**System instruction (include in all prompts):**

```text
Windmate is a wind and watersports app. The user cares about launch sites for:
wingfoiling, kitesurfing, kitefoiling, windsurfing, sailing, and parawing.

When coordinates are provided, treat them as the authoritative launch location
( rigging / beach entry ). Search and reason about THIS point on the shoreline —
not the town center, park office, or a namesake place elsewhere.

Focus intel on: launch layout, depth and walk-out, wind exposure, parking and
access for a session, water quality and hazards for riding, live cams and wind
graphs, and community reports from riders.

De-prioritize or exclude: unrelated boat marinas, fishing-only access, swimming-only
beaches with no wind-sport use, and inland venues with no suitable launch unless
documented for kite/wing.
```

Pass **`active_sport`** (user’s sport profile) and **`supported_sports`** list so depth/parking copy can be sport-aware (e.g. kite beach room vs wing foil walk).

Canonical slugs: `wingfoiling` · `sailing` · `kitesurfing` · `windsurfing` · `kitefoiling` · `parawing` ([Supported sports](./2026-09-08-windwatch-design.md#supported-sports)).

### Regional catalog (Prompt 1)

- **Center** `lat`/`lng` + `radius_km` defines the search disk.  
- **`known_spots`**: include `{ name, latitude, longitude, igetwind_id? }` so the model does not duplicate pins already in Windmate.  
- Candidates must return launch coordinates; if Search only finds a park centroid, set `confidence: low` and note in `notes`.

### When coordinates are missing

Catalog candidates may omit pin until verified. Profile/day calls should not run without a pin unless admin is geocoding — pass `coordinate_precision: "unknown"` and require the agent to avoid fabricating lat/lng.

### `WindmateAgentContext` (shared JSON fragment)

Attach to every request body (merged into `DayContextPack` or catalog input):

```json
{
  "app": "windmate",
  "domain": "wind_and_watersports_session_planning",
  "supported_sports": [
    "wingfoiling", "kitesurfing", "kitefoiling",
    "windsurfing", "sailing", "parawing"
  ],
  "active_sport": "wingfoiling",
  "spot": {
    "spot_id": "uuid",
    "name": "Parc-nature de l'Anse-à-l'Orme (Pierrefonds)",
    "latitude": 45.4568,
    "longitude": -73.9576,
    "coordinate_precision": "spot_pin",
    "location_anchor_text": "Launch pin on Lac des Deux Montagnes …",
    "water_body": "Lac des Deux Montagnes",
    "region_id": "montreal_ca"
  },
  "locale": "fr-CA"
}
```

Enable **Google Maps grounding** when available — pass the same `latitude`/`longitude` as the map anchor so Search/Maps align with the Windmate pin.

---

## Gemini prompts

### Prompt 1 — Regional catalog

**Input:** `WindmateAgentContext` (center for disk search, no single spot) + `radius_km` + `known_spots[]` with lat/lng.

Output: `{ "candidates": [...] }` with coordinates, `source_urls[]`, `confidence`. No profile prose. Human/script dedupe vs iGetwind + DB.

### Prompt 2 — Profile enrichment (optional third call)

**Input:** full `WindmateAgentContext` with **spot pin** required.

Output: full `SpotIntelProfile` with **every** `value` wrapped in `AttributedField` or section-level `provenance`. Depth/hazard copy should mention implications for `active_sport` where relevant. Include **`wind_hints`** per [Wind direction — complementing iGetwind](#wind-direction--complementing-igetwind); pass current `ideal_directions`, `direction_inference`, and `igetwind` URLs in the prompt.

### Prompt 3 — Day brief (expand + date)

**Input:** `DayContextPack`

```json
{
  "windmate": { /* WindmateAgentContext — spot.lat/lng required */ },
  "session_date": "2026-09-14",
  "static_profile": { /* SpotIntelProfile or subset */ },
  "fetched_posts": [
    { "platform": "reddit", "text", "url", "published_at", "media": [] }
  ],
  "official_snippets": [],
  "windmate_context": { "hydro_level_m", "obs_summary" }
}
```

Fetcher keyword queries should include **spot name + coordinates** (or water body from anchor text) and sport terms (`wingfoil`, `kitesurf`, …) to reduce homonym noise.

**System rules:**

- Output JSON only matching schema.  
- Honor **spot pin** coordinates for disambiguation in Search and in `derivation` when citing location-specific posts.  
- **Every** displayed field includes `provenance` with at least one citation URL when content is factual.  
- If no fetcher data: may use Search grounding; set `source_kind: gemini_search` and populate `citations` from grounding metadata.  
- Do not invent prices, hours, or closures without a citation.  
- Mate tone for `headline` and summaries.  
- Any synthesized or inferred field **must** include `derivation.summary` and `derivation.steps` (one step per input post, gauge, or rule applied).

**Gemini `model_reasoning` step:** Plain-language, 1–2 sentences — e.g. “Marked parking caution because one post said the pay station was broken; no city page contradicted it.”

**Output:** `{ "day": SpotIntelDayBrief, "signals": IntelSignal[] }`

---

## API

```http
GET /api/spots/:spotId/intel?sport=wingfoiling&date=2026-09-14
```

Response:

```json
{
  "spot_id": "...",
  "session_date": "2026-09-14",
  "fetched_at": 123,
  "profile": { /* SpotIntelProfile | null */ },
  "day": { /* SpotIntelDayBrief | null */ },
  "signals": [],
  "overall_level": "ok",
  "headline": "...",
  "media_gallery": { }
}
```

Provenance objects are returned **verbatim** for the client popover. Do not strip URLs.

Optional: `POST /api/intel/refresh/:spotId?date=` (admin) forces fetchers + Gemini.

---

## UI — Source (i) on every block

Extend Spot Details drawer ([local intel UI](./2026-09-09-spot-local-intel-design.md#intel-drawer-expand-on-spot-row)):

```
┌ Launch & depth ───────────────────────────── (i) ┐
│ Haut-fond massif jusqu'à 200 m…                  │
└──────────────────────────────────────────────────┘
```

- **(i)** = `button` top-right of each section header (`aria-label`: "Source for Launch & depth").  
- **Click / tap** opens popover or bottom sheet (not hover-only on mobile).

### Popover modes

**A — Direct source** (`derivation` null, single URL):**

1. `source_label` (bold)  
2. **Primary link** — `source_url` rendered as a real `<a href="…" target="_blank" rel="noopener">` (full URL visible or domain + “Open link”). Every entry in `citations[]` with a `url` is also a **clickable link** (title as link text when present).  
3. Optional `snippet` under a citation (plain text, not a link).  
4. Footer: `source_kind` label, `fetched_at` (“Updated …”), `confidence` badge.

**B — Inference / synthesis** (`derivation` present):**

1. **“How we know this”** heading + `derivation.summary` (mate-readable paragraph).  
2. **Steps list** — for each `derivation.steps[]` item:
   - If `url` set → **clickable link** using `label` as anchor text (same tab rules as above).  
   - If no `url` → `label` as plain text + `detail` below (e.g. Windmate metric, model reasoning).  
3. Still show top-level `source_url` / `citations` when they exist (all clickable).  
4. `confidence` + `fetched_at` as in mode A.

**Rules**

- Never show a URL as dead text — if we store it, it must be tappable (accessibility: links are focusable, ≥44px touch target where possible).  
- **`source_kind: windmate`**: always mode B; no bare “trust us” — `derivation.steps` must name the dataset (e.g. “CEHQ station 12345”, “HRDPS vs obs at YUL”).  
- **`low` confidence**: show `sourceUnverified` copy at top of popover; links still clickable so the user can judge.  
- **Missing provenance**: gray (i) → "No source on file yet — we're still collecting intel."

Sections (each with own provenance):

1. Day headline / Today at the spot  
2. Launch & depth (sport-aware)  
3. Access & hours  
4. Parking  
5. Water quality & hazards  
6. Live (cam / wind graph)  
7. Riders say (all-time / last month)  
8. Wind reference (community vs map wedges)  
9. Photos & videos (existing strip — provenance: `wikimedia_commons` / `google_cse` / link-out)

Matrix row: optional small (i) next to intel badge linking to same popover for that badge’s signal provenance.

### Copy keys (`copy.js`)

- `spotIntel.sourceTitle` — "Source"  
- `spotIntel.sourceHowWeKnow` — "How we know this"  
- `spotIntel.sourceOpen` — "Open source"  
- `spotIntel.sourceOpenLink` — (label) when link text is the title  
- `spotIntel.sourceUpdated` — (relative)  
- `spotIntel.sourceUnverified` — low confidence warning  
- `spotIntel.sourceKind.*` — labels per `source_kind`  
- `spotIntel.sourceStepKind.*` — labels per `derivation.steps[].kind`

---

## Phasing

| Phase | Deliverable |
|-------|-------------|
| **A** | Spec + seed JSON (Montreal examples) with full provenance |
| **B** | DB tables + API returns profile/day stubs; drawer sections + (i) popover |
| **C** | Gemini profile + day (Search bridge); **wind_hints** for iGetwind pins missing sectors |
| **D** | Reddit/official fetchers → day context pack → `gemini_parser` |
| **E** | Admin merge `suggested_merge` → `ideal_directions` when agreement rules pass |

---

## Testing checklist

- [ ] Per-spot Gemini requests include DB `latitude`/`longitude` and `active_sport` when pin exists  
- [ ] Catalog `known_spots` includes coordinates for dedupe  
- [ ] iGetwind spot with empty `ideal_directions` gets `wind_hints` or high-confidence inference on map  
- [ ] Gemini does not auto-update `ideal_directions` without admin / agreement rule  
- [ ] Wind section (i) links iGetwind page when cited; inference shows windmate derivation  
- [ ] Every seeded profile field has non-`unknown` provenance  
- [ ] (i) popover shows URL and opens in new tab  
- [ ] Every `url` in provenance / citations / derivation steps is a clickable `<a>`  
- [ ] Windmate or Gemini-synthesized fields show `derivation` (mode B), not link-only  
- [ ] Low-confidence field does not change rank  
- [ ] Day cache keyed by `(spot_id, session_date)` — switching planner day refetches or serves correct row  
- [ ] `community_today` with 0 posts shows honest empty copy, no fabricated provenance  
- [ ] Gemini ingest rejects ranking signals without `source_url` (unless windmate)

## Open questions

1. Popover vs full-width bottom sheet on narrow phones?  
2. Show `model` name to users or only in admin debug?  
3. Bilingual provenance: store FR source pages with EN UI labels only?
