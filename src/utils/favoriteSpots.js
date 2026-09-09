const MAX_FAVORITE_SPOTS = 50;

function parseFavoriteSpotIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const id of value) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_FAVORITE_SPOTS) break;
  }
  return result;
}

module.exports = {
  parseFavoriteSpotIds,
  MAX_FAVORITE_SPOTS,
};
