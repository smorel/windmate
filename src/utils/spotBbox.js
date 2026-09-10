const { haversineKm } = require('./geo');
const { parseFavoriteSpotIds } = require('./favoriteSpots');

/** @param {object} spot */
function spotSource(spot) {
  return spot.igetwind_id ? 'igetwind' : 'windmate';
}

/**
 * @param {object} spot
 * @param {Set<string>} favoriteIds
 */
function formatSpotForMap(spot, favoriteIds) {
  return {
    id: spot.id,
    name: spot.name,
    latitude: spot.latitude,
    longitude: spot.longitude,
    source: spotSource(spot),
    is_favorite: favoriteIds.has(spot.id),
  };
}

/**
 * @param {object[]} allSpots
 * @param {number} north
 * @param {number} south
 * @param {number} east
 * @param {number} west
 * @param {number} limit
 * @param {string[]} favoriteSpotIds
 */
function selectSpotsInBbox(allSpots, north, south, east, west, limit, favoriteSpotIds) {
  const favSet = new Set(parseFavoriteSpotIds(favoriteSpotIds));
  const max = Math.min(Math.max(1, limit), 500);
  const centerLat = (north + south) / 2;
  const centerLng = (east + west) / 2;

  const inBbox = allSpots.filter(
    (spot) =>
      spot.latitude >= south &&
      spot.latitude <= north &&
      spot.longitude >= west &&
      spot.longitude <= east
  );

  if (inBbox.length <= max) {
    return inBbox.map((spot) => formatSpotForMap(spot, favSet));
  }

  return inBbox
    .map((spot) => ({
      spot,
      is_favorite: favSet.has(spot.id),
      dist: haversineKm(centerLat, centerLng, spot.latitude, spot.longitude),
    }))
    .sort((a, b) => {
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
      return a.dist - b.dist;
    })
    .slice(0, max)
    .map(({ spot }) => formatSpotForMap(spot, favSet));
}

const DUPLICATE_SPOT_RADIUS_M = 50;

/**
 * @param {object[]} allSpots
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusM]
 */
function findSpotWithinRadius(allSpots, lat, lng, radiusM = DUPLICATE_SPOT_RADIUS_M) {
  const radiusKm = radiusM / 1000;
  let nearest = null;
  let nearestDist = Infinity;

  for (const spot of allSpots) {
    const dist = haversineKm(lat, lng, spot.latitude, spot.longitude);
    if (dist <= radiusKm && dist < nearestDist) {
      nearest = spot;
      nearestDist = dist;
    }
  }

  return nearest;
}

/**
 * @param {object} body
 * @returns {{ ok: true, data: { name: string, latitude: number, longitude: number } } | { ok: false, error: string }}
 */
function validateCreateSpotBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 120) {
    return { ok: false, error: 'name must be 1–120 characters' };
  }

  const latitude = parseFloat(body?.latitude);
  const longitude = parseFloat(body?.longitude);
  if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    return { ok: false, error: 'latitude must be between -90 and 90' };
  }
  if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false, error: 'longitude must be between -180 and 180' };
  }

  return { ok: true, data: { name, latitude, longitude } };
}

module.exports = {
  spotSource,
  formatSpotForMap,
  selectSpotsInBbox,
  findSpotWithinRadius,
  validateCreateSpotBody,
  DUPLICATE_SPOT_RADIUS_M,
};
