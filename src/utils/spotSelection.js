const { haversineKm } = require('./geo');
const { parseFavoriteSpotIds } = require('./favoriteSpots');

/** Starred spots only (used when sport profile has favorites_only). */
function selectFavoriteOnlySpots(allSpots, lat, lng, radiusKm, favoriteSpotIds) {
  const favSet = new Set(parseFavoriteSpotIds(favoriteSpotIds));
  if (favSet.size === 0) return [];

  const byId = new Map(allSpots.map((spot) => [spot.id, spot]));
  const selected = [];
  for (const id of favSet) {
    const spot = byId.get(id);
    if (!spot) continue;
    const distance_km = haversineKm(lat, lng, spot.latitude, spot.longitude);
    selected.push({
      ...spot,
      distance_km,
      outside_radius: distance_km > radiusKm,
    });
  }
  selected.sort((a, b) => a.distance_km - b.distance_km);
  return selected;
}

/**
 * @param {object[]} allSpots
 * @param {number} lat
 * @param {number} lng
 * @param {{ favorites_only?: number, radius_km: number, favorite_spot_ids: string[] }} profile
 * @param {number} limit
 * @param {number} [radiusKmOverride]
 */
function selectSpotsForProfile(allSpots, lat, lng, profile, limit, radiusKmOverride) {
  const radiusKm = radiusKmOverride ?? profile.radius_km;
  if (profile.favorites_only) {
    return selectFavoriteOnlySpots(allSpots, lat, lng, radiusKm, profile.favorite_spot_ids);
  }
  return selectDashboardSpots(
    allSpots,
    lat,
    lng,
    radiusKm,
    limit,
    profile.favorite_spot_ids
  );
}

/**
 * Nearby spots (radius + limit) plus favorited spots outside the radius.
 */
function selectDashboardSpots(allSpots, lat, lng, radiusKm, limit, favoriteSpotIds) {
  const favSet = new Set(parseFavoriteSpotIds(favoriteSpotIds));
  const withDistance = allSpots.map((spot) => ({
    ...spot,
    distance_km: haversineKm(lat, lng, spot.latitude, spot.longitude),
  }));

  const nearby = withDistance
    .filter((s) => s.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, Math.max(1, limit))
    .map((s) => ({ ...s, outside_radius: false }));

  const included = new Set(nearby.map((s) => s.id));
  const extras = withDistance
    .filter((s) => favSet.has(s.id) && !included.has(s.id))
    .sort((a, b) => a.distance_km - b.distance_km)
    .map((s) => ({ ...s, outside_radius: s.distance_km > radiusKm }));

  return [...nearby, ...extras];
}

/**
 * @param {object[]} allSpots
 * @param {string} query
 * @param {number} lat
 * @param {number} lng
 * @param {number} limit
 * @param {string[]} favoriteSpotIds
 */
function searchSpots(allSpots, query, lat, lng, limit, favoriteSpotIds) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];

  const favSet = new Set(parseFavoriteSpotIds(favoriteSpotIds));
  const max = Math.min(Math.max(1, limit), 40);

  return allSpots
    .map((spot) => ({
      id: spot.id,
      name: spot.name,
      latitude: spot.latitude,
      longitude: spot.longitude,
      source_url: spot.source_url,
      distance_km: haversineKm(lat, lng, spot.latitude, spot.longitude),
      favorite: favSet.has(spot.id),
    }))
    .filter((spot) => spot.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.distance_km - b.distance_km;
    })
    .slice(0, max);
}

module.exports = {
  selectDashboardSpots,
  selectFavoriteOnlySpots,
  selectSpotsForProfile,
  searchSpots,
};
