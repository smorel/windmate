const { v4: uuidv4 } = require('uuid');
const { haversineKm } = require('../utils/geo');
const { findSpotWithinRadius } = require('../utils/spotBbox');
const { geminiEnabled, generateJson } = require('./gemini/geminiClient');
const { WATERSPORTS_SYSTEM, buildCatalogAgentContext } = require('./gemini/windmateAgentContext');
const {
  getDiscoveryRegion,
  upsertDiscoveryRegion,
  insertDiscoveredSpot,
  getAllSpots,
} = require('../db');
const { scheduleSpotDirectionInference } = require('../utils/spotDirectionApi');
const { normalizeCompassDirections } = require('../utils/compassDirections');

const DISCOVERY_TTL_MS = parseInt(process.env.SPOT_DISCOVERY_TTL_MS ?? String(7 * 24 * 3600 * 1000), 10);
const MIN_BBOX_SPAN_KM = parseFloat(process.env.SPOT_DISCOVERY_MIN_SPAN_KM ?? '25');
const DUPLICATE_KM = 0.05;

const inFlight = new Map();

function bboxCenterAndRadius(north, south, east, west) {
  const centerLat = (north + south) / 2;
  const centerLng = (east + west) / 2;
  const radiusKm = Math.max(
    haversineKm(centerLat, centerLng, north, centerLng),
    haversineKm(centerLat, centerLng, south, centerLng),
    haversineKm(centerLat, centerLng, centerLat, east),
    haversineKm(centerLat, centerLng, centerLat, west)
  );
  return { centerLat, centerLng, radiusKm };
}

function regionKey(centerLat, centerLng, radiusKm) {
  const lat = Math.round(centerLat * 20) / 20;
  const lng = Math.round(centerLng * 20) / 20;
  const r = Math.max(5, Math.round(radiusKm / 10) * 10);
  return `${lat},${lng},${r}`;
}

function discoveryEnabled() {
  return geminiEnabled('GEMINI_CATALOG_ENABLED', false);
}

function catalogUseSearchGrounding() {
  if (!discoveryEnabled()) return false;
  const raw = process.env.GEMINI_CATALOG_USE_SEARCH;
  if (raw == null || raw === '') return true;
  return raw === '1' || raw.toLowerCase() === 'true';
}

async function fetchCatalogCandidates(userText) {
  const useSearch = catalogUseSearchGrounding();
  const baseOpts = {
    systemInstruction: WATERSPORTS_SYSTEM,
    userText,
    tools: useSearch ? [{ google_search: {} }] : undefined,
  };

  try {
    const { data } = await generateJson(baseOpts);
    return { data, mode: useSearch ? 'search' : 'no_search' };
  } catch (err) {
    if (useSearch && err?.status === 429) {
      console.warn(
        '[spotCatalog] Search grounding hit quota — retrying this region with generateContent only (no search)'
      );
      const { data } = await generateJson({
        systemInstruction: WATERSPORTS_SYSTEM,
        userText,
      });
      return { data, mode: 'no_search_fallback' };
    }
    throw err;
  }
}

function shouldAttemptDiscovery(north, south, east, west) {
  const { radiusKm } = bboxCenterAndRadius(north, south, east, west);
  return radiusKm >= MIN_BBOX_SPAN_KM;
}

function knownSpotsPayload(allSpots, centerLat, centerLng, radiusKm) {
  return allSpots
    .filter((s) => haversineKm(centerLat, centerLng, s.latitude, s.longitude) <= radiusKm * 1.2)
    .slice(0, 120)
    .map((s) => ({
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      igetwind_id: s.igetwind_id ?? undefined,
    }));
}

/**
 * @param {import('better-sqlite3').Database} db
 */
async function runCatalogDiscovery(db, north, south, east, west, activeSport = 'wingfoiling') {
  const { centerLat, centerLng, radiusKm } = bboxCenterAndRadius(north, south, east, west);
  const key = regionKey(centerLat, centerLng, radiusKm);
  const existing = getDiscoveryRegion(db, key);
  if (existing?.fetched_at && Date.now() - existing.fetched_at < DISCOVERY_TTL_MS) {
    return { region_key: key, status: 'cached', inserted: 0 };
  }

  const allSpots = getAllSpots(db);
  const agent = buildCatalogAgentContext({
    centerLat,
    centerLng,
    radiusKm,
    knownSpots: knownSpotsPayload(allSpots, centerLat, centerLng, radiusKm),
    activeSport,
  });

  const userText = `Regional watersports launch catalog — ONE compact JSON response for map + session scoring.

Context:
${JSON.stringify(agent, null, 2)}

Find launch sites within radius_km not duplicating known_spots (~200 m). Max 12 candidates.

Return ONLY fields needed for the map and rideability scoring (no parking prose, no day brief):
{
  "candidates": [
    {
      "name": "string",
      "latitude": number,
      "longitude": number,
      "ideal_directions": ["W","NW"],
      "onshore_direction": "NW",
      "confidence": "high" | "medium" | "low",
      "source_urls": ["https://..."],
      "water_body": "optional short label"
    }
  ]
}

Rules:
- ideal_directions: 16-point compass (N, NE, …) only when a guide or iGetwind documents them; [] if unknown.
- Launch pin coordinates, not park office unless that is the beach.
- confidence low if coordinates or wind sectors uncertain — we skip low confidence inserts.
- Watersports launches only. No long descriptions.`;

  const { data } = await fetchCatalogCandidates(userText);

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  let inserted = 0;

  for (const cand of candidates) {
    const lat = parseFloat(cand.latitude);
    const lng = parseFloat(cand.longitude);
    const name = String(cand.name ?? '').trim();
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    if (cand.confidence === 'low') continue;

    const dup = findSpotWithinRadius(allSpots, lat, lng, DUPLICATE_KM * 1000);
    if (dup) continue;

    const sourceUrl = Array.isArray(cand.source_urls) ? cand.source_urls[0] : null;
    const idealDirections = normalizeCompassDirections(cand.ideal_directions);
    const spot = insertDiscoveredSpot(db, {
      id: uuidv4(),
      name,
      latitude: lat,
      longitude: lng,
      source_url: sourceUrl,
      ideal_directions: idealDirections,
    });
    allSpots.push(spot);
    if (idealDirections.length === 0) {
      scheduleSpotDirectionInference(db, spot);
    }
    inserted++;
  }

  upsertDiscoveryRegion(db, {
    region_key: key,
    center_lat: centerLat,
    center_lng: centerLng,
    radius_km: radiusKm,
    fetched_at: Date.now(),
    candidate_count: candidates.length,
    inserted_count: inserted,
  });

  return { region_key: key, status: 'completed', inserted, candidate_count: candidates.length };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function scheduleCatalogDiscovery(db, north, south, east, west, activeSport = 'wingfoiling') {
  if (!discoveryEnabled()) return { scheduled: false, reason: 'disabled' };
  if (!shouldAttemptDiscovery(north, south, east, west)) {
    return { scheduled: false, reason: 'bbox_too_small' };
  }

  const { centerLat, centerLng, radiusKm } = bboxCenterAndRadius(north, south, east, west);
  const key = regionKey(centerLat, centerLng, radiusKm);
  const existing = getDiscoveryRegion(db, key);
  if (existing?.fetched_at && Date.now() - existing.fetched_at < DISCOVERY_TTL_MS) {
    return { scheduled: false, reason: 'fresh', region_key: key };
  }

  if (inFlight.has(key)) {
    return { scheduled: true, region_key: key, status: 'in_flight' };
  }

  inFlight.set(key, true);
  void runCatalogDiscovery(db, north, south, east, west, activeSport)
    .then((result) => {
      console.log(
        `[spotCatalog] region ${key}: ${result.status}, inserted ${result.inserted ?? 0}`
      );
    })
    .catch((err) => {
      if (err?.status === 429) {
        console.warn(`[spotCatalog] region ${key} skipped (quota):`, err.message);
      } else {
        console.warn(`[spotCatalog] region ${key} failed:`, err.message);
      }
    })
    .finally(() => {
      inFlight.delete(key);
    });

  return { scheduled: true, region_key: key, status: 'started' };
}

function getDiscoveryStatus(db, north, south, east, west) {
  const { centerLat, centerLng, radiusKm } = bboxCenterAndRadius(north, south, east, west);
  const key = regionKey(centerLat, centerLng, radiusKm);
  const row = getDiscoveryRegion(db, key);
  const inProgress = inFlight.has(key);
  return {
    region_key: key,
    in_progress: inProgress,
    fetched_at: row?.fetched_at ?? null,
    inserted_count: row?.inserted_count ?? 0,
  };
}

module.exports = {
  discoveryEnabled,
  catalogUseSearchGrounding,
  scheduleCatalogDiscovery,
  getDiscoveryStatus,
  runCatalogDiscovery,
  bboxCenterAndRadius,
  regionKey,
};
