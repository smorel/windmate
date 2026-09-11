const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map();

function cacheKey(lat, lng) {
  const rLat = Math.round(lat * 20) / 20;
  const rLng = Math.round(lng * 20) / 20;
  return `${rLat},${rLng}`;
}

async function fetchTimezoneIdFromOpenMeteo(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    timezone: 'auto',
    forecast_days: '1',
    hourly: 'temperature_2m',
  });
  const response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo timezone lookup failed (${response.status})`);
  }
  const data = await response.json();
  const tz = data.timezone;
  if (!tz || tz === 'GMT') return null;
  return tz;
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string | null>}
 */
async function resolvePlaceTimezoneId(lat, lng) {
  const key = cacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.timezone_id;
  }
  const timezone_id = await fetchTimezoneIdFromOpenMeteo(lat, lng);
  cache.set(key, { at: Date.now(), timezone_id });
  return timezone_id;
}

function shouldReResolveTimezone(place, lat, lng) {
  if (!place?.timezone_id) return true;
  const dLat = Math.abs((place.lat ?? 0) - lat);
  const dLng = Math.abs((place.lng ?? 0) - lng);
  return dLat > 0.05 || dLng > 0.05;
}

module.exports = {
  resolvePlaceTimezoneId,
  shouldReResolveTimezone,
  fetchTimezoneIdFromOpenMeteo,
};
