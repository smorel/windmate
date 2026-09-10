const NOMINATIM_BASE = process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT ?? 'Windmate/1.0';
const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, { value: unknown, at: number }>} */
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { value, at: Date.now() });
}

async function nominatimFetch(path) {
  const response = await fetch(`${NOMINATIM_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }
  return response.json();
}

/** @param {Record<string, string>} address */
function shortNameFromAddress(address) {
  if (!address) return 'Unnamed spot';
  return (
    address.leisure ||
    address.natural ||
    address.waterway ||
    address.beach ||
    address.park ||
    address.neighbourhood ||
    address.suburb ||
    address.village ||
    address.town ||
    address.city ||
    address.road ||
    'Unnamed spot'
  );
}

/**
 * @param {number} lat
 * @param {number} lng
 */
async function reverseGeocode(lat, lng) {
  const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await nominatimFetch(
    `/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`
  );

  const result = {
    name: shortNameFromAddress(data.address),
    display_name: data.display_name ?? '',
    lat: parseFloat(data.lat),
    lng: parseFloat(data.lon),
  };

  cacheSet(key, result);
  return result;
}

/**
 * @param {string} query
 */
async function searchGeocode(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];

  const key = `search:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await nominatimFetch(
    `/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`
  );

  const results = (Array.isArray(data) ? data : []).map((row) => ({
    name: row.name || shortNameFromAddress(row.address) || row.display_name?.split(',')[0] || q,
    lat: parseFloat(row.lat),
    lng: parseFloat(row.lon),
    display_name: row.display_name ?? '',
  }));

  cacheSet(key, results);
  return results;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  reverseGeocode,
  searchGeocode,
  shortNameFromAddress,
  clearCache,
};
