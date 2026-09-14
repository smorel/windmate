const { INFERENCE_ALGO_VERSION } = require('./constants');
const { computeFromBoundaryLatLng } = require('./geometry');
const { fetchLandWaterBoundaryPolylines, mergePolylinesForCompute } = require('./osmOverpass');

/**
 * @param {{ latitude: number, longitude: number }} spot
 * @param {{ fetchBoundary?: (lat: number, lng: number) => Promise<{ lat: number, lng: number }[][]> }} [deps]
 */
async function computeShoreNormalDirections(spot, deps = {}) {
  const lat = spot.latitude;
  const lng = spot.longitude;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return failedPayload(spot, 'missing_coordinates');
  }

  const fetchBoundary = deps.fetchBoundary ?? fetchLandWaterBoundaryPolylines;

  try {
    const polylines = await fetchBoundary(lat, lng);
    const boundary = mergePolylinesForCompute(polylines);
    if (boundary.length < 2) {
      return failedPayload(spot, 'no_osm_boundary');
    }

    const geom = computeFromBoundaryLatLng(lat, lng, boundary, { lat, lng });
    if (geom.confidence === 'low' && !geom.directions) {
      return {
        algo_version: INFERENCE_ALGO_VERSION,
        directions: [],
        bearing_deg: geom.bearing_deg ?? null,
        confidence: 'low',
        source: 'osm_shore_normal',
        computed_at: new Date().toISOString(),
        pin: { lat, lng },
        P: geom.P ?? null,
        smoothing: geom.smoothing ?? null,
        error: geom.error ?? 'low_confidence',
      };
    }

    return {
      algo_version: INFERENCE_ALGO_VERSION,
      directions: geom.directions ?? [],
      bearing_deg: geom.bearing_deg,
      confidence: geom.confidence,
      source: 'osm_shore_normal',
      computed_at: new Date().toISOString(),
      pin: { lat, lng },
      P: geom.P,
      smoothing: geom.smoothing,
      error: geom.error ?? null,
    };
  } catch (err) {
    return failedPayload(spot, err.message ?? 'inference_failed');
  }
}

function failedPayload(spot, error) {
  const lat = spot.latitude;
  const lng = spot.longitude;
  return {
    algo_version: INFERENCE_ALGO_VERSION,
    directions: [],
    bearing_deg: null,
    confidence: 'failed',
    source: 'osm_shore_normal',
    computed_at: new Date().toISOString(),
    pin: lat != null && lng != null ? { lat, lng } : null,
    P: null,
    smoothing: null,
    error,
  };
}

module.exports = { computeShoreNormalDirections };
