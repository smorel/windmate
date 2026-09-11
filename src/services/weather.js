const CACHE_TTL_MS = 30 * 60 * 1000;
/** Bump when hourly parsing changes so SQLite forecast_cache is refetched. */
const FORECAST_CACHE_VERSION = 4;
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

const { fetchModelForecast, normalizeWindData, repairIgetwindHourly, delay } = require('./igetwind');
const { getModelsForLocation, getPrimaryModel, getModelLabel } = require('../utils/models');
const { mergeForecastElapsedToday } = require('./forecastMerge');
const { repairLegacyWindProbabilityHourly } = require('../utils/forecastProbabilityHour');

function getProvider() {
  return (process.env.WEATHER_PROVIDER ?? 'mixed').toLowerCase();
}

async function fetchOpenMeteoForecast(spot) {
  const params = new URLSearchParams({
    latitude: String(spot.latitude),
    longitude: String(spot.longitude),
    hourly: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    wind_speed_unit: 'kn',
    timezone: 'auto',
    forecast_days: '7',
  });

  const response = await fetch(`${OPEN_METEO_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo error: ${response.status}`);
  }
  const data = await response.json();
  return { ...data, provider: 'open-meteo', model: 'open-meteo' };
}

async function fetchSingleModel(spot, modelId) {
  if (modelId === 'open-meteo') {
    return fetchOpenMeteoForecast(spot);
  }
  const block = await fetchModelForecast(spot.latitude, spot.longitude, modelId);
  return normalizeWindData(block, modelId);
}

async function fetchMixedForecast(spot) {
  const modelIds = getModelsForLocation(spot.latitude, spot.longitude);
  const primaryModel = getPrimaryModel(spot.latitude, spot.longitude);
  const models = {};

  for (const modelId of modelIds) {
    try {
      models[modelId] = {
        label: getModelLabel(modelId),
        ...await fetchSingleModel(spot, modelId),
        error: null,
      };
    } catch (err) {
      models[modelId] = { label: getModelLabel(modelId), error: err.message };
    }
    if (modelId !== modelIds[modelIds.length - 1]) {
      await delay(120);
    }
  }

  const available = modelIds.filter((id) => models[id]?.hourly);
  if (available.length === 0) {
    throw new Error('All forecast models failed');
  }

  return {
    provider: 'mixed',
    primaryModel: available.includes(primaryModel) ? primaryModel : available[0],
    models,
    cached: false,
  };
}

/** Extract primary hourly series from cached mixed or legacy forecast blob. */
function sanitizeIgetwindHourly(hourly, cacheVersion) {
  let repaired = repairIgetwindHourly(hourly);
  if ((cacheVersion ?? 0) < 3) {
    repaired = repairLegacyWindProbabilityHourly(repaired);
  }
  return repaired;
}

function sanitizeForecastBlob(data) {
  if (!data) return data;

  const sourceVersion = data.cacheVersion ?? 0;
  const out = { ...data, cacheVersion: FORECAST_CACHE_VERSION };

  if (out.models) {
    out.models = { ...out.models };
    for (const [modelId, model] of Object.entries(out.models)) {
      if (!model?.hourly || modelId === 'open-meteo') continue;
      out.models[modelId] = {
        ...model,
        hourly: sanitizeIgetwindHourly(model.hourly, sourceVersion),
      };
    }
  } else if (out.hourly && out.provider === 'igetwind') {
    out.hourly = sanitizeIgetwindHourly(out.hourly, sourceVersion);
  }

  return out;
}

function isForecastCacheFresh(cached) {
  if (!cached) return false;
  if (Date.now() - cached.fetched_at >= CACHE_TTL_MS) return false;
  try {
    const parsed = JSON.parse(cached.data);
    return parsed.cacheVersion === FORECAST_CACHE_VERSION;
  } catch {
    return false;
  }
}

function getPrimaryHourlyForecast(forecast) {
  if (forecast.models) {
    const primary = forecast.models[forecast.primaryModel];
    if (primary?.hourly) return primary;
    const first = Object.values(forecast.models).find((m) => m.hourly);
    if (first) return first;
  }
  if (forecast.hourly) return forecast;
  return null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} spotId
 * @param {{ latitude: number, longitude: number }} spot
 */
async function fetchForecast(db, spotId, spot, options = {}) {
  const skipCache = Boolean(options.skipCache);
  const cached = db.prepare(
    'SELECT fetched_at, data FROM forecast_cache WHERE spot_id = ?'
  ).get(spotId);

  if (!skipCache && isForecastCacheFresh(cached)) {
    return sanitizeForecastBlob(JSON.parse(cached.data));
  }

  const provider = getProvider();
  try {
    let data;
    if (provider === 'mixed') {
      data = await fetchMixedForecast(spot);
    } else if (provider === 'open-meteo') {
      data = await fetchOpenMeteoForecast(spot);
    } else {
      const model = getPrimaryModel(spot.latitude, spot.longitude);
      data = await fetchSingleModel(spot, model);
    }

    const previousData =
      cached && JSON.parse(cached.data).cacheVersion === FORECAST_CACHE_VERSION
        ? JSON.parse(cached.data)
        : null;
    const merged = sanitizeForecastBlob(mergeForecastElapsedToday(previousData, data));

    db.prepare(`
      INSERT INTO forecast_cache (spot_id, fetched_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(spot_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data
    `).run(spotId, Date.now(), JSON.stringify(merged));

    return { ...merged, cached: false };
  } catch (err) {
    if (cached) {
      const stale = sanitizeForecastBlob(JSON.parse(cached.data));
      return { ...stale, cached: true, stale: true };
    }
    throw err;
  }
}

module.exports = {
  fetchForecast,
  fetchMixedForecast,
  getPrimaryHourlyForecast,
  sanitizeForecastBlob,
  getProvider,
  CACHE_TTL_MS,
  FORECAST_CACHE_VERSION,
};
