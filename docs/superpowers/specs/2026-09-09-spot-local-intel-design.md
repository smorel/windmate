# Spot Local Intel — Design Spec

**Date:** 2026-09-09  
**Status:** Draft (requirements captured; implementation after session watchlist v1 + ranking v2)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Watchlist](./2026-09-08-session-watchlist-design.md), [Session Spot Ranking](./2026-09-08-session-ranking-design.md)

## Goal

Wind and waves alone are not enough to pick a session. Users also need **local ground truth** before leaving home:

- What are people **posting from the spot** right now (photos, videos, comments)?
- What does the **spot look like** — photos and videos (ideally people doing **your sport** — see [Supported sports](./2026-09-08-windwatch-design.md#supported-sports))?
- Is there a **live cam**?
- Are **water conditions** safe and pleasant — not just rideable wind-wise (algae, debris, flooding at launch, ice, murky water)?
- Is **parking** public or paid, and **open on the session day**?
- Is the spot **reachable** — roads and lots flooded or closed at season start/end?

When intel says avoid a spot, Windmate should **rank it lower** and explain why in mate tone — same pattern as water quality and offshore wind.

## User story

> "Thursday Oka and Hudson both look rideable. Oka has a bloom advisory and the main lot is paid — I need to know if it's even open before May long weekend. Hudson's access road floods every spring; someone always posts on Facebook when you can't get through. I'd rather Windmate tells me Hudson is a no-go and ranks Verdun higher for my setup."

## Problem space (beyond wind/waves)

| Concern | User question | Affects ranking? |
|---|---|---|
| **Social feed** | What's the latest news from people at the spot? | Indirect — parsed signals feed access/water/parking |
| **Spot media** | What does the launch/water look like? Anyone riding my sport there? | No — visual context; does not change score |
| **Live cam** | Can I see the launch and water myself? | No — confidence booster; does not change score |
| **Water conditions** | Safe to touch / foil / kite? (algae, toxins, debris, launch flooding) | Yes — see [Water conditions](#water-conditions) |
| **Parking** | Free vs paid? Open today? Seasonal lot closure? | Yes — see [Parking](#parking) |
| **Access / roads** | Can I actually get to the launch? (floods, construction, park closure) | Yes — see [Access](#access-roads-and-site-closure) |

Forecast-only rideability cannot answer these. They require **community signals**, **official municipal/provincial sources**, and **curated spot metadata**.

## Scope

### In scope (v1 — curated proof)

- **`spot_intel_cache`** per spot — manual or admin-seeded JSON for Montreal seed spots
- **Intel panel** on spot card / watched session: latest summary, source links, freshness timestamp
- **Ranking penalties** when intel level is `caution` or `closed` (access, parking, water)
- **Spot metadata** for stable facts: parking type, official hours URL, access bulletin URL
- **Mate-tone explanations** on rank badges — e.g. "Main lot closed until May 15 — check the city page"
- **Google Images/Videos link-out** — sport-aware search URLs per spot (no inline thumbnails yet)

### In scope (v2 — automated ingestion)

- **Social aggregation** — recent public posts mentioning spot name, hashtags, or geo (see [Social feed](#social-feed))
- **Official feeds** — parse city/park/agency pages for hours, seasonal opening, road/lot closures
- **Structured extraction** — Gemini (or similar) turns posts and HTML bulletins into `{ category, level, summary, valid_until }`
- **Live cam** — per [Session Watchlist — Webcam block](./2026-09-08-session-watchlist-design.md#webcam-block-v2)
- **Photo/video thumbnails** in intel panel when embeddable (link out when not)
- **Spot media gallery** — Google Images & Videos results for the spot, biased toward the user's selected sport (see [Spot media](#spot-media-google-images--videos))

### In scope (v3 — session-day freshness)

- Shorter TTL for watched spots on session day (align with `WATCHED_OBSERVATION_TTL_MS`)
- Re-rank when new social or official signal arrives (WebSocket or poll — product choice at implementation)
- Optional alert: "You marked Oka for today — city says main parking closed"

### Out of scope

- Scraping behind login walls (private Facebook groups without user-provided link only)
- Paid parking payment / reservation booking
- Turn-by-turn navigation
- Legal review of each platform ToS — **curated links + official APIs first**; automated scraping only for allowlisted sources

## Data model

### `spots` extension

| Column | Type | Notes |
|---|---|---|
| `parking_type` | TEXT | `free` · `paid` · `mixed` · `street` · `unknown` |
| `parking_notes` | TEXT | nullable — e.g. "Pay station, ~$12/day" |
| `parking_hours_url` | TEXT | nullable — city/park page for lot hours and seasonal opening |
| `access_bulletin_url` | TEXT | nullable — road closure, flood, park status page |
| `intel_sources` | TEXT | nullable — JSON array of `{ type, url, label }` — see below |
| `webcam_url` | TEXT | nullable — shared with watchlist spec |
| `windy_webcam_id` | TEXT | nullable |

`intel_sources` examples:

```json
[
  { "type": "facebook_group", "url": "https://facebook.com/groups/hudsonwing", "label": "Hudson wing group" },
  { "type": "instagram_hashtag", "url": "https://instagram.com/explore/tags/lacstlouis", "label": "#lacstlouis" },
  { "type": "municipal", "url": "https://ville.oka.qc.ca/...", "label": "Ville d'Oka — plage" },
  { "type": "reddit_search", "url": "https://reddit.com/search/?q=oka+beach+kite", "label": "Reddit" },
  { "type": "google_media", "url": "https://www.google.com/search?tbm=isch&q=Plage+d%27Oka+wingfoil", "label": "Spot photos" }
]
```

### `spot_intel_cache`

One row per spot; refreshed by cron or on-demand. Holds **merged** intel from all sources.

| Column | Type | Notes |
|---|---|---|
| spot_id | TEXT | PK, FK → spots |
| fetched_at | INTEGER | Unix ms |
| signals | TEXT | JSON array of `IntelSignal` (see below) |
| headline | TEXT | mate-tone one-liner for card subtitle |
| overall_level | TEXT | `ok` · `caution` · `closed` · `unknown` |
| valid_for_date | TEXT | ISO date nullable — when signal is date-specific (e.g. "lot closed May 12") |
| media_gallery | TEXT | nullable — JSON `MediaGallery` per sport (v2); v1 may omit and build link-out client-side |

#### `IntelSignal` shape

```json
{
  "category": "access",
  "level": "closed",
  "summary": "Access road underwater — multiple posts this morning",
  "source": "facebook_group",
  "source_url": "https://...",
  "media": [{ "type": "image", "url": "https://...", "thumbnail_url": "https://..." }],
  "published_at": "2026-05-12T09:30:00-04:00",
  "confidence": "high",
  "extracted_by": "manual"
}
```

`category`: `water` · `access` · `parking` · `social` · `general`  
`level`: `ok` · `caution` · `closed`  
`extracted_by`: `manual` · `parser` · `official_feed`

**Merge rule:** worst level wins per category; `overall_level` = max severity across `access`, `parking`, `water` (ignore pure `social`/`general` for rank unless they imply access/water/parking).

### Relationship to existing caches

| Existing | This spec |
|---|---|
| `spot_quality_cache` (algae) | `category: water` signals merge in; quality cache can seed water signals until unified |
| `spot_level_cache` (depth) | Hydrometric level stays separate; **launch-area flooding** is `access` or `water` via intel |
| Watchlist `community_sources` | Same JSON shape — consolidate into `intel_sources` on `spots` |

## Social feed

### What to show

**"Latest from the spot"** strip:

```
📸 Latest from the spot
• Instagram — choppy but rideable, parking half full (3 h ago) [photo]
• Facebook — "road still flooded, turned back" (1 h ago)
• City of Oka — Beach opens May 15 (official)
```

Prefer **thumbnail + link** over full embeds. Video: poster frame + "Watch" link.

### Ingestion approaches

| Approach | Pros | Cons |
|---|---|---|
| **Curated links only (v1)** | No ToS risk, ships fast | User clicks out; no inline summary |
| **Official RSS/HTML parse** | Authoritative for parking/access | Per-site parsers; brittle |
| **Reddit JSON API** | Structured, keyword search | Rate limits; not all spots |
| **Instagram/Facebook public** | Rich media | API restrictions; often link-only |
| **Gemini structured extract** | Unified mate-tone summaries | Cost, latency, needs allowlist |

**Recommendation:** v1 **curated links + manual `spot_intel_cache`** for 5–8 seed spots. v2 **official municipal pages + Reddit** for Montreal region. v3 **Gemini parser** on allowlisted HTML and Reddit JSON; Instagram/Facebook as **link + optional oEmbed thumbnail** where permitted.

### Search keywords per spot

Store in `intel_sources` or spot seed data:

- Spot name variants ("Oka Beach", "Plage d'Oka", "Lac des Deux Montagnes")
- Local nicknames, iOS/Android map pin names
- Activity hashtags (`#wingfoil`, `#kitesurf`) combined with place

## Live cam

Unchanged from [Session Watchlist — Webcam block](./2026-09-08-session-watchlist-design.md#webcam-block-v2):

- Municipal cams, YouTube live, Windy Webcam ID
- Lazy-load on expand; stale/error → "Open cam" external link
- Cam does **not** change rank; increases confidence alongside go/no-go pill

## Water conditions

Extends [Session Ranking — Water quality](./2026-09-08-session-ranking-design.md#water-quality) to cover **all reasons to avoid the water**, not only algae:

| Sub-type | Examples | Typical level |
|---|---|---|
| **Bloom / toxins** | Cyanobacteria, E. coli advisory | `advisory` / `closed` |
| **Debris / hazards** | Logs after flood, broken docks, weed mats | `caution` / `closed` |
| **Launch flooding** | Beach underwater, no rigging area | `caution` / `closed` |
| **Launch room (kite)** | High water + small beach — tricky or impossible to rig/launch | `caution` / `closed` |
| **Ice / unsafe surface** | Early/late season ice edge | `closed` |
| **Visibility / comfort** | Heavy mud, pollen scum — foiling nuisance | `caution` |
| **Long algae / weeds** | Filamentous mats — foil drag; can walk through but spot less appealing | `caution` (nuisance; see ranking spec) |
| **Shallow launch** | Low water at beach; deep enough further out after walk/paddle | `caution` (appeal; not a hard block) |

### Ranking impact (water category)

| Level | Session score multiplier (water factor) | UI |
|---|---|---|
| `ok` | 1.0 | — |
| `caution` | 0.6–0.8 | Yellow badge + mate explanation |
| `closed` | 0.0 (hard block, rank last) | Red strikethrough + link to source |

Merge with existing `spot_quality_cache.level` — take **worse** of quality cache and intel water signals.

**Copy examples:**

- caution: "Water's rough mate — debris reported after last week's flood."
- closed: "Launch is underwater — skip it today."

### Long algae & shallow launch (wingfoil appeal)

Wingfoilers often care about **session quality**, not just safety. Two common intel signals:

| Signal | Typical source | Ranking effect |
|---|---|---|
| Long algae along shore / riding area | Instagram, Facebook, cam, seasonal spot notes | `nuisance_level` light → heavy ([Session Ranking](./2026-09-08-session-ranking-design.md#nuisance-algae-wingfoil-appeal)) |
| "Walk out before you foil" / shallow ramp | Social, local knowledge, low level + spot `walk_to_foil_m` | `walk_short` or `walk_long` adequacy — **rank below** easier launches |

These are **soft penalties** — the spot may still be worth it if wind is clearly best. Mate copy should explain the tradeoff:

- "Saint-Timothée ranks ok on wind but there's long algae — Lac Saint-Louis is cleaner for your setup today."
- "Bit shallow at the beach mate — you'll be walking out before you lift."

Parser keywords (FR/EN): `algues`, `algae`, `weeds`, `herbiers`, `walk`, `marche`, `shallow`, `peu profond`, `foil`, `mast`.

### Launch room (kitesurfing)

Some spots are fine at normal level but **unlaunchable for kites** when the river or lake is up — especially where the beach is already narrow (river walls, small park strips). This overlaps hydrometric ranking in [Session Ranking — Kite launch beach](./2026-09-08-session-ranking-design.md#kite--launch-beach-level-too-high); intel adds **ground truth** when models and gauges lag reality.

| Signal | Source | Effect |
|---|---|---|
| "No beach left" / "can't rig" | Social posts, same day | Bump launch constraint to `launch_blocked` |
| Cam shows water at grass/trees | Webcam | `caution` minimum |
| Official high-water bulletin | CEHQ, city | `caution` or `closed` |

**Copy examples:**

- caution: "Beach is pretty tight mate — river's up, kiting will be sketchy."
- closed: "No room to launch — water's right up the bank. Pick a wider spot."

Parser keywords (FR/EN): `plage`, `beach`, `lancement`, `launch`, `trop haut`, `no room`, `inondé`, `flood`.

## Spot media (Google Images & Videos)

Users want to **see the spot** before committing — launch layout, water colour, crowd level, and ideally **someone doing their sport** at that location. Google Images and Google Videos are a practical fallback when social feeds are quiet or link-only.

### What to show

**"Spot photos & videos"** strip in the intel drawer — separate from the real-time social feed:

```
📷 Spot photos & videos · wingfoil
[thumb] [thumb] [thumb] [thumb]  →  More on Google
```

- **6–8 thumbnails** per tab (`Images` · `Videos`), horizontal scroll on mobile
- Each tile: thumbnail, optional duration badge (video), **link out** to source page (never hotlink full-res in-app)
- **Sport-aware query** — uses user's active sport profile to bias results toward people riding that discipline at this spot
- **Fallback** when API unavailable or quota exceeded: prominent **"Search Google Images"** / **"Search Google Videos"** buttons with the same pre-built query (opens new tab)

### Sport query terms

| `sport` | Primary terms (EN) | FR variants (Montreal seed) |
|---|---|---|
| `wingfoiling` | wingfoil, wing foil, wingfoiling | wing, foil, aile |
| `kitesurfing` | kitesurf, kiteboarding, kite | kitesurf, cerf-volant |
| `sailing` | sailing, sailboat, dinghy | voile, dériveur |
| `windsurfing` | windsurf, windsurfing, windsurfer | planche à voile, windsurf |
| `kitefoiling` | kitefoil, kite foil, kitefoiling | foil kite, kitefoil |
| `parawing` | parawing, paraglide wing, parawing foil | aile parapente, parawing |

**Query template** (built server-side, URL-encoded for fallback links):

```
"{spot_name}" ({sport_terms}) {region_hint}
```

Example for Oka + wingfoil: `"Plage d'Oka" (wingfoil OR wing foil) Lac des Deux Montagnes`

`region_hint` comes from spot seed (`region`, `water_body`, or lat/lon city name) to disambiguate common names.

### Ingestion approaches

| Approach | Pros | Cons |
|---|---|---|
| **Link-out only (v1)** | No API key, no quota, ships with curated spots | User leaves app; no inline thumbnails |
| **Google Custom Search JSON API** | Structured image/video results + thumbnails | Daily quota (100 free/day); needs Programmable Search Engine setup |
| **Cache thumbnails in `spot_intel_cache`** | Fast drawer open; respects API limits | Stale media; storage of third-party thumb URLs |

**Recommendation:** v1 **pre-built Google search links** per spot + sport (stored in `intel_sources` or generated from spot name). v2 **Custom Search API** for inline thumbnails; cache in `spot_intel_cache` with same TTL as other intel. Re-fetch on session day when spot is watched (v3).

### API & data

Extend `IntelSignal` or add parallel `media_gallery` on `spot_intel_cache`:

```json
{
  "sport": "wingfoiling",
  "images": [
    { "thumbnail_url": "https://...", "source_url": "https://...", "title": "Wingfoil at Oka beach" }
  ],
  "videos": [
    { "thumbnail_url": "https://...", "source_url": "https://...", "title": "...", "duration": "2:14" }
  ],
  "google_images_url": "https://www.google.com/search?tbm=isch&q=...",
  "google_videos_url": "https://www.google.com/search?tbm=vid&q=..."
}
```

`intel_sources` entry type: `google_media` — optional override URL if a spot needs a hand-tuned query.

**Ranking:** none. Media is **confidence and appeal** only — same as live cam.

### UX notes

- Default tab matches user sport; user can switch sport tab to compare (e.g. kite launch room vs wing conditions)
- Empty results → mate copy: "No photos turned up mate — try the live cam or check the Facebook group."
- Do not imply copyright ownership; attribution via link to source page only

## Parking

### Static metadata

- `parking_type` on spot — shown in intel panel and spot detail
- `parking_notes` — price hint, "arrive early on weekends"

### Dynamic (session-day)

| State | Meaning | Ranking impact |
|---|---|---|
| `open` | Lot expected open (official hours or no contrary signal) | neutral |
| `limited` | Partial lot, pay station broken, very full (social) | −0.1; badge |
| `closed` | Seasonal closure, special event, flood | −0.5; strong warning |
| `unknown` | No data | neutral; "Check parking" link |

**Session date awareness:** when user picks a planner day, evaluate `valid_for_date` and official **seasonal open/close dates** parsed from `parking_hours_url`.

**Copy examples:**

- limited: "Paid lot — reports say it's packed by 10 am."
- closed: "Main parking closed until May 15 — city page."

## Access (roads and site closure)

Seasonal floods at Quebec launches are common (spring snowmelt, fall storms). Users learn via Facebook groups long before forecast models update.

| State | Meaning | Ranking impact |
|---|---|---|
| `open` | No closure signal | neutral |
| `caution` | Soft sand, partial flood, 4×4 suggested | −0.3 |
| `closed` | Road/lot/site unreachable | **Hard block** (same as water `closed`) |
| `unknown` | No recent signal | neutral; link to `access_bulletin_url` |

**Sources (priority):**

1. Official — city, Sépaq, NCC, Transport Québec road status
2. Park agency — seasonal opening calendars
3. Social — multiple corroborating posts within 24 h → `confidence: high`
4. Single social post → `caution` unless official confirms

**Copy examples:**

- caution: "Access road might be soft — couple of posts mention mud."
- closed: "Can't reach the launch — road flooded per city alert."

## Ranking integration

Add factors to [Session Spot Ranking](./2026-09-08-session-ranking-design.md):

| Factor | Default weight | Notes |
|---|---|---|
| `access` | 0.05 | From intel access category |
| `parking` | 0.03 | Session-date parking state |
| `waterIntel` | merged into `waterQuality` | Single water factor after merge |

**Hard blocks:** `access.level === 'closed'` OR `water` merged level `closed` OR `parking.level === 'closed'` → `sessionScore = 0`, `rankLast = true`.

**Badge on matrix row:**

```json
{
  "type": "access",
  "level": "closed",
  "message": "Road flooded — ranked lower mate."
}
```

Re-rank order in `rank_criteria_order` UI: user may deprioritize proximity over access when they drag criteria (existing mechanism).

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/spots/:spotId/intel` | Cached intel + sources + cam URL + `media_gallery` (sport query param optional) |
| GET | `/api/rideability` | Extend payload: `intel.headline`, `intel.badges`, factor weights |

Optional: `POST /api/intel/refresh/:spotId` (admin/dev) to force fetch.

## UI design

### Spot card / matrix row

Below wind summary:

```
⚠️ Road flooded — ranked #4 today (wind was #1)
[Parking: paid · usually opens May 15] [Check city page]
```

### Intel drawer (expand on spot row)

```
LOCAL INTEL · updated 12 min ago
─────────────────────────────────
🚗 Parking — Paid, $12/day · closed until May 15 [city link]
🛣️ Access — Road flooded (city + 3 posts) [photos]
💧 Water — Algae watch [MELCC link]
📷 Live cam [expand]
📸 Latest posts [thumbnails → links]
🖼️ Spot photos & videos · wingfoil [Images | Videos tabs → Google]
```

### Watched session day

Intel drawer **open by default** when any `caution` or `closed` signal exists for today.

## Services (planned)

| File | Responsibility |
|---|---|
| `src/services/spotIntel.js` | Merge signals, overall level, headline copy |
| `src/services/intelSources/official.js` | Fetch/parse allowlisted municipal pages |
| `src/services/intelSources/reddit.js` | Keyword search, normalize posts |
| `src/services/intelSources/social.js` | oEmbed thumbnails, link metadata |
| `src/services/intelSources/googleMedia.js` | Sport-aware query build; Custom Search fetch + cache (v2) |
| `src/services/intelParser.js` | Gemini structured extraction (v2) |
| `src/cron/intelRefresh.js` | TTL refresh per spot; faster for watched session days |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `INTEL_CACHE_TTL_MS` | `3600000` (1 h) | Default intel cache TTL |
| `INTEL_SESSION_DAY_TTL_MS` | `900000` (15 min) | TTL for watched spots on session day |
| `INTEL_PARSER_ENABLED` | `false` | Enable Gemini extraction |
| `GEMINI_API_KEY` | _(unset)_ | For structured parsing (v2) |
| `GOOGLE_CSE_API_KEY` | _(unset)_ | Custom Search JSON API (v2 spot media) |
| `GOOGLE_CSE_CX` | _(unset)_ | Programmable Search Engine ID (image + video search) |

## Phasing

| Phase | Deliverable |
|---|---|
| **v1** | `spot_intel_cache` manual seed for 5–8 spots; intel panel; rank penalties; parking/access metadata columns; Google Images/Videos link-out (sport-aware) |
| **v2** | Official URL parsers (2–3 cities); Reddit search; webcam embed; merge water quality; Google Custom Search inline thumbnails |
| **v3** | Gemini parser; social thumbnails; session-day media refresh for watched spots + optional email line in watchlist mail |

## Testing checklist

- [ ] Manual `closed` access signal forces spot to bottom of matrix with explanation
- [ ] `caution` water intel reduces score but does not hard-block
- [ ] Parking seasonal date in future does not mark today `closed`
- [ ] Intel panel loads async; matrix render not blocked
- [ ] Worst-of merge: quality `watch` + intel water `closed` → `closed`
- [ ] Cam embed lazy-loads; broken URL shows fallback
- [ ] `headline` uses mate tone from `copy.js`
- [ ] Google media links include user's sport terms; switching sport rebuilds query
- [ ] v2: thumbnail grid loads async; API quota failure falls back to link-out only
- [ ] Video tiles show duration when available; all tiles open source in new tab

## Open questions

1. **Facebook groups** — link-only vs user-supplied group URL with public preview?
2. **Corroboration** — how many social posts before `access: closed` without official source?
3. **Bilingual official pages** — parse FR/EN; summarize in user's locale?
4. **iGetwind spots worldwide** — intel only for curated seed spots until source templates exist?
5. **Google CSE quota** — cache per spot+sport globally, or fetch on drawer open only for watched spots?
6. **Sport tab override** — always show user's sport first, or remember last-selected tab per spot?
