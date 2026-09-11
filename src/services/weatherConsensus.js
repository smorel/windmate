const {
  hasForecastRain,
  isWeatherBlocked,
  isStormWeatherCode,
  PRECIP_BLOCK_MM,
} = require('./weatherHazards');
const { normalizeHourlyTimestamp } = require('../utils/forecastTime');

/** Strict majority: more than half of reporting sources (ties → no). */
function majorityRequired(reporting) {
  return Math.floor(reporting / 2) + 1;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function isFullHourTimeKey(key) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(key));
}

/**
 * @param {Map<string, object>} contextByTime
 */
function openMeteoVoteAt(time, contextByTime) {
  const ctx =
    contextByTime.get(time) ??
    contextByTime.get(time.slice(0, 16)) ??
    contextByTime.get(`${time.slice(0, 16)}:00`);
  if (!ctx || (ctx.precipitation == null && ctx.weatherCode == null)) return null;

  const hour = {
    precipitation: ctx.precipitation ?? 0,
    weatherCode: ctx.weatherCode ?? 0,
  };
  return {
    sourceId: 'open-meteo',
    rainy: hasForecastRain(hour),
    blocked: isWeatherBlocked(hour),
    storm: isStormWeatherCode(hour.weatherCode),
    precipMm: hour.precipitation ?? 0,
    weatherCode: hour.weatherCode ?? 0,
  };
}

/**
 * @param {object} mixedForecast
 * @returns {[string, { hourly: object }][]}
 */
function iterModelHourlies(mixedForecast) {
  if (mixedForecast?.models) {
    return Object.entries(mixedForecast.models).filter(
      ([modelId, model]) => modelId !== 'open-meteo' && model?.hourly?.time?.length
    );
  }
  if (mixedForecast?.hourly?.time?.length) {
    const id = mixedForecast.model ?? mixedForecast.provider ?? 'primary';
    if (id === 'open-meteo') return [];
    return [[String(id), { hourly: mixedForecast.hourly }]];
  }
  return [];
}

function modelPrecipVoteAt(time, hourly) {
  if (!hourly?.precipitation) return null;
  const key = normalizeHourlyTimestamp(time);
  const index = hourly.time.findIndex((t) => normalizeHourlyTimestamp(t) === key);
  if (index < 0) return null;
  const mm = hourly.precipitation[index];
  if (mm == null) return null;

  return {
    rainy: mm > 0,
    blocked: mm > PRECIP_BLOCK_MM,
    storm: false,
    precipMm: mm,
  };
}

function collectTimelineTimes(contextByTime, modelEntries) {
  const set = new Set();
  for (const key of contextByTime.keys()) {
    if (isFullHourTimeKey(key)) set.add(key);
  }
  for (const [, model] of modelEntries) {
    for (const t of model.hourly.time) {
      set.add(normalizeHourlyTimestamp(t));
    }
  }
  return [...set].sort();
}

/**
 * @param {object} mixedForecast
 * @param {Map<string, object>} contextByTime
 * @returns {Map<string, object>}
 */
function buildWeatherConsensusByTime(mixedForecast, contextByTime = new Map()) {
  const modelEntries = iterModelHourlies(mixedForecast);
  const times = collectTimelineTimes(contextByTime, modelEntries);
  const out = new Map();

  for (const time of times) {
    const votes = [];

    const om = openMeteoVoteAt(time, contextByTime);
    if (om) votes.push(om);

    for (const [modelId, model] of modelEntries) {
      const vote = modelPrecipVoteAt(time, model.hourly);
      if (!vote) continue;
      votes.push({ ...vote, sourceId: modelId });
    }

    if (!votes.length) continue;

    const reporting = votes.length;
    const rainy = votes.filter((v) => v.rainy).length;
    const blocked = votes.filter((v) => v.blocked).length;
    const storm = votes.some((v) => v.storm);
    const need = majorityRequired(reporting);
    const openMeteoVote = votes.find((v) => v.sourceId === 'open-meteo');

    out.set(time, {
      weatherOk: !storm && blocked < need,
      hasForecastRain: rainy >= need,
      precipitation: median(votes.map((v) => v.precipMm)),
      weatherCode: openMeteoVote?.weatherCode ?? 0,
      weatherConsensus: {
        reporting,
        rainy,
        blocked,
        storm: storm ? 1 : 0,
      },
    });
  }

  return out;
}

function lookupWeatherConsensus(weatherConsensusByTime, time) {
  if (!weatherConsensusByTime?.size) return null;
  const key = normalizeHourlyTimestamp(time);
  return (
    weatherConsensusByTime.get(key) ??
    weatherConsensusByTime.get(time) ??
    weatherConsensusByTime.get(time.slice(0, 16)) ??
    null
  );
}

module.exports = {
  buildWeatherConsensusByTime,
  lookupWeatherConsensus,
  majorityRequired,
  median,
};
