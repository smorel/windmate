const DEFAULT_SEARCH_RADIUS_KM = parseInt(process.env.DEFAULT_RADIUS_KM ?? '80', 10);
const MIN_SEARCH_RADIUS_KM = 5;
const MAX_SEARCH_RADIUS_KM = 300;

function parseSearchRadiusKm(value, fallback = DEFAULT_SEARCH_RADIUS_KM) {
  const n = parseInt(value ?? fallback, 10);
  if (Number.isNaN(n)) return DEFAULT_SEARCH_RADIUS_KM;
  return Math.min(MAX_SEARCH_RADIUS_KM, Math.max(MIN_SEARCH_RADIUS_KM, n));
}

module.exports = {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_SEARCH_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
  parseSearchRadiusKm,
};
