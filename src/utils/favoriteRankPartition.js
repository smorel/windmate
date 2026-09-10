/**
 * Order ranked spots: in-radius favorites, other in-radius spots, then distant favorites.
 * Each bucket keeps the score order from the incoming list.
 */
function partitionRankedSpots(ranked, radiusKm, favoriteSpotIds, getSpot = (row) => row.entry?.spot) {
  const favorites = new Set(favoriteSpotIds ?? []);
  const radius = radiusKm ?? Infinity;
  const inRadiusFavorites = [];
  const inRadiusOthers = [];
  const distantFavorites = [];

  for (const row of ranked) {
    const spot = getSpot(row);
    const dist = spot?.distance_km ?? 0;
    const isFavorite = favorites.has(spot?.id);
    if (isFavorite && dist > radius) {
      distantFavorites.push(row);
    } else if (isFavorite) {
      inRadiusFavorites.push(row);
    } else {
      inRadiusOthers.push(row);
    }
  }

  return [...inRadiusFavorites, ...inRadiusOthers, ...distantFavorites];
}

module.exports = { partitionRankedSpots };
