const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOverpassUserAgent() {
  const candidates = [
    process.env.OVERPASS_USER_AGENT,
    process.env.WINDMATE_USER_AGENT,
    process.env.NOMINATIM_USER_AGENT,
  ];
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  return 'Windmate/1.0 (direction-inference; set WINDMATE_USER_AGENT in .env)';
}

const OVERPASS_USER_AGENT = resolveOverpassUserAgent();

const minIntervalMs = parseInt(process.env.OVERPASS_MIN_INTERVAL_MS ?? '2500', 10);
const retryDelayMs = parseInt(process.env.OVERPASS_RETRY_DELAY_MS ?? '30000', 10);
const maxAttempts = parseInt(process.env.OVERPASS_MAX_ATTEMPTS ?? '3', 10);

let lastRequestAt = 0;
/** Serializes Overpass calls (public instance: one client, rate-limited). */
let requestChain = Promise.resolve();

/**
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function enqueueOverpassRequest(fn) {
  const run = requestChain.then(async () => {
    const gap = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();
    return fn();
  });
  requestChain = run.catch(() => {});
  return run;
}

function formatFetchError(err) {
  if (!err) return 'fetch failed';
  const code = err.cause?.code ?? err.code;
  if (code) return `${err.message ?? 'fetch failed'} (${code})`;
  return err.message ?? 'fetch failed';
}

/**
 * @param {string} query
 * @returns {Promise<object>}
 */
async function postOverpassQuery(query) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (res.status === 429 || res.status === 406 || res.status === 503 || res.status === 502) {
        lastErr = new Error(`Overpass HTTP ${res.status}`);
        if (attempt < maxAttempts - 1) {
          await sleep(retryDelayMs);
          continue;
        }
        throw lastErr;
      }

      if (!res.ok) {
        throw new Error(`Overpass HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      lastErr = err;
      const msg = err.message ?? '';
      const retryable =
        msg.includes('Overpass HTTP 429') ||
        msg.includes('Overpass HTTP 406') ||
        msg.includes('Overpass HTTP 503') ||
        msg.includes('Overpass HTTP 502') ||
        err.cause?.code === 'ETIMEDOUT' ||
        err.cause?.code === 'ECONNRESET' ||
        err.cause?.code === 'ENOTFOUND';

      if (retryable && attempt < maxAttempts - 1) {
        await sleep(retryDelayMs);
        continue;
      }
      throw new Error(formatFetchError(err));
    }
  }
  throw new Error(formatFetchError(lastErr));
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusM
 * @returns {Promise<{ lat: number, lng: number }[][]>}
 */
async function fetchLandWaterBoundaryPolylines(lat, lng, radiusM = 2000) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const dLat = radiusM / mPerDegLat;
  const dLng = radiusM / mPerDegLng;
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;

  const query = `
[out:json][timeout:25];
(
  way["natural"="coastline"](${south},${west},${north},${east});
  way["waterway"="riverbank"](${south},${west},${north},${east});
  way["natural"="water"]["water"~"^(lake|pond|reservoir)$"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;
`;

  const json = await enqueueOverpassRequest(() => postOverpassQuery(query));

  const nodes = new Map();
  const ways = [];

  for (const el of json.elements ?? []) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    } else if (el.type === 'way' && Array.isArray(el.nodes)) {
      ways.push(el);
    }
  }

  const polylines = [];
  for (const way of ways) {
    const line = [];
    for (const nodeId of way.nodes) {
      const n = nodes.get(nodeId);
      if (n) line.push(n);
    }
    if (line.length >= 2) polylines.push(line);
  }

  return polylines;
}

/**
 * Flatten polylines to one point list (dedupe consecutive) for geometry when segments are sparse.
 * @param {{ lat: number, lng: number }[][]} polylines
 */
function mergePolylinesForCompute(polylines) {
  const points = [];
  for (const line of polylines) {
    for (const pt of line) {
      const last = points[points.length - 1];
      if (!last || last.lat !== pt.lat || last.lng !== pt.lng) {
        points.push(pt);
      }
    }
  }
  return points;
}

module.exports = { fetchLandWaterBoundaryPolylines, mergePolylinesForCompute, OVERPASS_URL };
