const { INFERENCE_ALGO_VERSION } = require('./constants');
const { computeShoreNormalDirections } = require('./compute');

function parseInferenceColumn(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pinsMatch(cached, lat, lng) {
  if (!cached?.pin) return false;
  const eps = 1e-6;
  return Math.abs(cached.pin.lat - lat) < eps && Math.abs(cached.pin.lng - lng) < eps;
}

function cacheIsFresh(cached, lat, lng) {
  if (!cached) return false;
  if (cached.confidence === 'failed') return false;
  if (cached.algo_version !== INFERENCE_ALGO_VERSION) return false;
  if (!pinsMatch(cached, lat, lng)) return false;

  const ttlMs = parseInt(process.env.INFERENCE_CACHE_TTL_MS ?? '0', 10);
  if (ttlMs > 0 && cached.computed_at) {
    const age = Date.now() - Date.parse(cached.computed_at);
    if (age > ttlMs) return false;
  }
  return true;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, latitude: number, longitude: number, direction_inference?: object | null }} spot
 * @param {{ fetchBoundary?: Function, force?: boolean }} [options]
 */
async function ensureSpotDirectionInference(db, spot, options = {}) {
  const lat = spot.latitude;
  const lng = spot.longitude;
  let cached =
    spot.direction_inference ??
    parseInferenceColumn(
      db.prepare('SELECT direction_inference FROM spots WHERE id = ?').get(spot.id)?.direction_inference
    );

  if (!options.force && cacheIsFresh(cached, lat, lng)) {
    return cached;
  }

  const computed = await computeShoreNormalDirections(spot, {
    fetchBoundary: options.fetchBoundary,
  });

  db.prepare('UPDATE spots SET direction_inference = ? WHERE id = ?').run(
    JSON.stringify(computed),
    spot.id
  );

  return computed;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ fetchBoundary?: Function }} [options]
 */
async function backfillAllSpotDirectionInference(db, options = {}) {
  const rows = db.prepare('SELECT id, latitude, longitude FROM spots').all();
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await ensureSpotDirectionInference(db, row, { force: true, fetchBoundary: options.fetchBoundary });
      ok++;
    } catch {
      failed++;
    }
  }
  return { total: rows.length, ok, failed };
}

module.exports = {
  ensureSpotDirectionInference,
  backfillAllSpotDirectionInference,
  cacheIsFresh,
  parseInferenceColumn,
};
