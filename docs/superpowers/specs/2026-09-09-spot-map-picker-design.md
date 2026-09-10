# Spot Map Picker — Design Spec

**Date:** 2026-09-09  
**Status:** Draft  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Session Watchlist](./2026-09-08-session-watchlist-design.md), [Sport Selector](./2026-09-09-sport-selector-design.md)

## Goal

Add an **inline interactive map** next to the spot search bar so users can discover spots visually, favorite existing ones, and create **Windmate-local custom spots** at arbitrary coordinates — without leaving the dashboard.

The map shows **both iGetwind-synced spots and Windmate manual spots** from the same `spots` table.

## User story

> "I know there's a launch spot across the lake but it's not in my favorites. I open the map, pan over, tap the pin, done — it's in my list."

> "There's no spot for my secret grass launch. I double-click the map, Nominatim suggests 'Parc-nature du Cap-Saint-Jacques', I tweak the name, save — spot created and favorited."

> "I type 'Hudson' in search while the map is open and hit Enter — the map flies to Hudson and shows every spot there. If nothing matches, I can double-click to add one."

## Decisions

| Topic | Choice |
|---|---|
| Spot creation | Windmate-local (`igetwind_id = NULL`); sync must **not** delete manual spots |
| Future iGetwind API | May ask iGetwind owner for official create endpoint later |
| Map library | **Leaflet** via CDN (Approach 1) |
| Layout | Inline expand below search bar |
| Name on create | Nominatim reverse geocode → editable before save |
| Initial center | Fit bounds of favorites; fallback home → browser GPS |
| Favorited markers | ★ icon, name tooltip, **not clickable** |
| Non-favorited markers | ● dot, name tooltip, **click → add to favorites** |
| Map data | iGetwind **and** Windmate spots (unified `spots` table) |

## Scope

### In scope (v1)

- **Map toggle button** to the right of the spot search input
- **Inline map panel** (~280 px mobile / ~360 px desktop) expands below search row
- **Leaflet** map with Carto Voyager tiles (consistent with `spotMap.js`)
- Viewport-based spot loading (`GET /api/spots/bbox`)
- Click non-favorite pin → favorite (reuse `toggleFavorite` / `persistFavorites`)
- Double-click empty map → create manual spot dialog → auto-favorite
- **Enter in search box** (when map open) → geocode / focus map on location
- Preserve manual spots across iGetwind sync
- Toast feedback on favorite add

### Out of scope

- iGetwind spot creation API integration (future)
- Unfavorite from map (favorited pins are not clickable)
- Spot editing / deletion UI
- Marker clustering (revisit if bbox cap is hit often)
- Offline map tiles

## UI layout

```
┌─────────────────────────────────────────────────────┐
│ [Search spots to add & favorite…    ] [Close map ✕] │  ← toggle label when open
├─────────────────────────────────────────────────────┤
│  Tap a spot to favorite · Double-click to add one  [✕]│  ← panel header + close
│  ┌───────────────────────────────────────────────┐  │
│  │  ★ Lac St-Louis    ● Oka    ● Hudson         │  │
│  │         (Leaflet map, inline panel)           │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Search row

- Wrap input + button in a flex row (`spot-search-row`).
- **Map toggle button** (`#spot-map-toggle`):
  - Closed: icon + label **"Map"**
  - Open: icon + label **"Close map"** (or chevron-up); emerald active border
  - `aria-expanded` tied to panel; `aria-controls="spot-map-panel"`
- Dropdown results still anchor below the full row (above map panel when open).

### Map panel

- `#spot-map-panel` — `hidden` by default; toggled by Map button, panel close button, or **Escape**.
- **Panel header** (compact, one line above map):
  - Hint: *"Tap a spot to favorite · Double-click to add one"*
  - **Close button** (`#spot-map-close`, ✕) — top-right; same action as toggle; `aria-label="Close map"`
- `#spot-map-container` — Leaflet mounts here; `min-height` 280 px (mobile) / 360 px (desktop).
- Closing the map:
  - Destroys or pauses Leaflet tile requests (call `map.remove()` or `map.stop()` on close to free memory)
  - Cancels in-progress bbox / geocode requests
  - Dismisses open create-spot dialog if any
  - Does **not** clear search input or favorites
- **Escape** key closes panel when open (and map has focus or panel is visible); does not close create dialog if that is open (Escape on dialog cancels create first).

### Markers

| State | Visual | Interaction |
|---|---|---|
| Not favorited | Emerald ● dot (`spot-map-marker`) | Click → `toggleFavorite(id)` → toast "Added {name}" → re-render as ★ |
| Favorited | ★ (`spot-map-marker--favorite`) | Tooltip only (`title` / Leaflet tooltip); `pointer-events` disabled |

Both iGetwind and Windmate spots use the same marker rules. Source does not change interaction.

### Create-spot dialog

On double-click (empty map, not on a marker):

1. Drop a temporary pin at coordinates.
2. `GET /api/geocode/reverse?lat=&lng=` → suggested name.
3. Modal / inline form: name input (pre-filled), lat/lng read-only, **Save** / **Cancel**.
4. **Save** → `POST /api/spots` → `toggleFavorite(newId)` → refresh markers → toast.
5. **Cancel** → remove temp pin.

## Search + map integration (Enter key)

When the map panel is **open**, pressing **Enter** in `#spot-search-input`:

```
query = trimmed search text
if query.length < 2 → no-op

1. Spot name match (fast path)
   GET /api/spots/search?q=query&lat=&lng=&limit=15
   if results.length > 0:
     fly map to fitBounds(all result coordinates), zoom max 13
     refresh bbox markers
     return

2. Place geocode (fallback)
   GET /api/geocode/search?q=query
   if result:
     fly map to { lat, lng }, zoom 12
     refresh bbox markers
     show hint: "No spots here yet — double-click to add one"
   else:
     toast: "Couldn't find that location"
```

When the map is **closed**, Enter keeps current behavior (no map action; dropdown selection unchanged).

Selecting a dropdown result while map is open also flies to that spot (single-marker focus, zoom 14).

## Data model

No schema migration required. Existing `spots` table:

```
spots: id, name, latitude, longitude, ideal_directions, source_url, igetwind_id
```

| Source | `igetwind_id` | `source_url` |
|---|---|---|
| iGetwind | Mongo `_id` string | `https://igetwind.com/spots#{uname}` |
| Windmate manual | `NULL` | `NULL` |

Response field `source: "igetwind" | "windmate"` is computed at read time (`igetwind_id != null`).

### Sync change

`src/services/igetwindSync.js` — **remove** the line:

```js
db.prepare('DELETE FROM spots WHERE igetwind_id IS NULL')
```

Manual spots survive every sync. iGetwind upsert logic unchanged.

## API

### `GET /api/spots/bbox`

Query: `north`, `south`, `east`, `west`, optional `limit` (default 300), optional `sport` (for favorite flags).

```json
{
  "spots": [
    {
      "id": "uuid",
      "name": "Oka Beach",
      "latitude": 45.47,
      "longitude": -74.08,
      "source": "igetwind",
      "is_favorite": false
    }
  ],
  "bounds": { "north": 45.6, "south": 45.4, "east": -73.4, "west": -73.7 }
}
```

Selection: `latitude BETWEEN south AND north AND longitude BETWEEN west AND east` (handle antimeridian later if needed). If over limit, return favorites in bbox first, then fill by distance to bbox center.

### `POST /api/spots`

Body: `{ name, latitude, longitude }`

Validation:
- `name`: 1–120 chars, trimmed
- `latitude`: -90..90, `longitude`: -180..180
- Reject if another spot within **50 m** (haversine) — return 409 with nearest spot id

Response: `201` + created spot object.

Creates row with `igetwind_id = NULL`, `ideal_directions = '[]'`.

### `GET /api/geocode/reverse?lat=&lng=`

Server-side proxy to [Nominatim](https://nominatim.org/release-docs/develop/api/Reverse/) reverse API.

- Cache results in memory (LRU, ~500 entries, 24 h TTL) to respect rate limits
- `User-Agent: Windmate/1.0` header per Nominatim policy
- Returns `{ name, display_name, lat, lng }` — `name` is short label (e.g. neighbourhood, park, road)

### `GET /api/geocode/search?q=`

Forward geocode proxy (Nominatim search). Returns `{ results: [{ name, lat, lng, display_name }] }`, max 5.

Used by Enter-key map focus when spot name search returns no hits.

## Client architecture

New module: `public/js/spotMapPicker.js` (`WindmateSpotMapPicker`)

| Export | Role |
|---|---|
| `init(container, { onFavorite, getFavorites, getHome })` | Mount Leaflet, wire events |
| `open()` / `close()` / `isOpen()` | Panel toggle; `close()` tears down Leaflet instance |
| `flyTo(lat, lng, zoom?)` | Pan map |
| `fitBounds(spots)` | Fit multiple spots |
| `refreshMarkers()` | Re-fetch bbox |

`app.js` responsibilities:
- Map button toggle
- Pass `toggleFavorite`, `favoriteSpotIds`, home coords
- Enter-key handler on search input (only when map open)
- Load Leaflet CSS/JS from CDN in `index.html`

### Leaflet setup

- Tiles: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` (labels on — helps placement)
- Attribution: Carto + OSM + Leaflet
- `moveend` / `zoomend` → debounced bbox fetch (300 ms)
- `dblclick` on map (not marker) → create flow
- Disable default double-click zoom (`doubleClickZoom: false`) to avoid conflict; use scroll/pinch zoom

### Initial view on open

```
favorites = spots matching favoriteSpotIds with valid coords
if favorites.length >= 1:
  fitBounds(favorites), maxZoom 11
else if home_lat/lng set:
  setView(home, zoom 10)
else:
  browser geolocation → setView(zoom 10) or Montreal default
```

## Error handling

| Case | Behavior |
|---|---|
| Bbox fetch fails | Keep existing markers; subtle error in hint line |
| Geocode fails on create | Empty name field; user must type |
| Geocode fails on Enter | Toast "Couldn't find that location" |
| POST spot 409 (too close) | Show existing spot name; offer "Favorite it instead?" button |
| Favorite limit (50) | Toast existing copy; block favorite |
| Leaflet CDN unavailable | Map button disabled; search still works |

## Files to touch

| File | Change |
|---|---|
| `public/index.html` | Search row layout, map panel, Leaflet CDN |
| `public/css/styles.css` | `.spot-search-row`, `.spot-map-panel`, marker styles |
| `public/js/spotMapPicker.js` | **New** — Leaflet map module |
| `public/js/app.js` | Map toggle, Enter handler, init picker |
| `public/js/copy.js` | Map hint, toast, dialog copy |
| `src/routes/spots.js` | `GET /bbox`, `POST /` |
| `src/routes/geocode.js` | **New** — reverse + search proxies |
| `src/services/nominatim.js` | **New** — fetch + cache |
| `src/services/igetwindSync.js` | Stop deleting manual spots |
| `src/server.js` | Mount geocode router |
| `test/spots.test.js` | Bbox, create, duplicate guard |

## Testing

- [ ] Bbox returns iGetwind and manual spots in viewport
- [ ] Manual spot survives `syncIgetwindSpots()`
- [ ] POST rejects duplicate within 50 m
- [ ] Click non-favorite marker → favorite persisted per sport
- [ ] Favorite marker not clickable
- [ ] Double-click → reverse geocode → create → auto-favorite
- [ ] Enter with map open: spot match → fly; no match → forward geocode → fly
- [ ] Enter with map closed → no map side effect
- [ ] Map toggle `aria-expanded` correct
- [ ] Close via toggle, panel ✕, and Escape; Leaflet torn down on close

## Future

- **iGetwind create API** — if owner exposes endpoint, `POST /api/spots` can optionally mirror to iGetwind and store returned `igetwind_id`
- Marker clustering at low zoom
- Distinguish Windmate custom spots visually (dashed ring)
- Unfavorite via map popup (v2)
