const { VALID_SPORTS } = require('../../utils/sports');

const WATERSPORTS_SYSTEM = `Windmate is a wind and watersports app. The user cares about launch sites for:
wingfoiling, kitesurfing, kitefoiling, windsurfing, sailing, and parawing.

When coordinates are provided, treat them as the authoritative launch location
(rigging / beach entry). Search and reason about THIS point on the shoreline —
not the town center, park office, or a namesake place elsewhere.

Focus intel on: launch layout, depth and walk-out, wind exposure, parking and
access for a session, water quality and hazards for riding, live cams and wind
graphs, and community reports from riders.

De-prioritize or exclude: unrelated boat marinas, fishing-only access, swimming-only
beaches with no wind-sport use, and inland venues with no suitable launch unless
documented for kite/wing.`;

/**
 * @param {object} params
 * @param {object} [params.spot]
 * @param {string} [params.activeSport]
 * @param {string} [params.locale]
 */
function buildWindmateAgentContext({ spot, activeSport = 'wingfoiling', locale = 'en-CA' }) {
  const ctx = {
    app: 'windmate',
    domain: 'wind_and_watersports_session_planning',
    supported_sports: [...VALID_SPORTS],
    active_sport: activeSport,
    locale,
  };

  if (spot?.latitude != null && spot?.longitude != null) {
    ctx.spot = {
      spot_id: spot.id ?? null,
      name: spot.name,
      latitude: spot.latitude,
      longitude: spot.longitude,
      coordinate_precision: 'spot_pin',
      location_anchor_text: `${spot.name} launch pin (${spot.latitude}, ${spot.longitude})`,
      water_body: spot.water_body ?? null,
      region_id: spot.region_id ?? null,
    };
  } else if (spot) {
    ctx.spot = {
      spot_id: spot.id ?? null,
      name: spot.name,
      coordinate_precision: 'unknown',
    };
  }

  return ctx;
}

function buildCatalogAgentContext({ centerLat, centerLng, radiusKm, knownSpots, activeSport, locale }) {
  return {
    ...buildWindmateAgentContext({ activeSport, locale }),
    catalog: {
      center: { latitude: centerLat, longitude: centerLng },
      radius_km: radiusKm,
      known_spots: knownSpots,
    },
  };
}

module.exports = {
  WATERSPORTS_SYSTEM,
  buildWindmateAgentContext,
  buildCatalogAgentContext,
};
