const {
  parseMinRideableWindowHours,
  hourTimeKey,
  longestRideableWindowSpan,
} = require('../utils/rideableWindow');
const { isElapsedLocalDayHour, localDateString } = require('../utils/forecastTime');
const { longestConsensusWindowLength, getModelDayHours } = require('./sessionRank');
const { readMeteoForecastProbability } = require('../utils/forecastProbabilityHour');

/** Beaufort palette bands for forecast probability (0–1). */
const PROBABILITY_BAND_COLORS = {
  low: '#c64e36',
  midLow: '#3d70b6',
  midHigh: '#8a4a90',
  high: '#60a059',
};

function colorForProbability(probability) {
  const p = Math.max(0, Math.min(1, Number(probability) || 0));
  if (p < 0.25) return PROBABILITY_BAND_COLORS.low;
  if (p < 0.5) return PROBABILITY_BAND_COLORS.midLow;
  if (p < 0.75) return PROBABILITY_BAND_COLORS.midHigh;
  return PROBABILITY_BAND_COLORS.high;
}

function indexModelsByHour(entry, dateStr) {
  const modelIds = Object.entries(entry.models ?? {})
    .filter(([, model]) => !model.error)
    .map(([id]) => id);

  return modelIds
    .map((modelId) => {
      const hours = getModelDayHours(entry, modelId, dateStr);
      if (!hours?.length) return null;
      const byKey = new Map();
      for (const hour of hours) byKey.set(hourTimeKey(hour.time), hour);
      return byKey;
    })
    .filter(Boolean);
}

function hourModelAgreement(indexedByKey, key, options) {
  const today = options?.today;
  const now = options?.now ?? new Date();
  let reporting = 0;
  let rideable = 0;

  for (const byKey of indexedByKey) {
    const hour = byKey.get(key);
    if (!hour) continue;
    if (today && isElapsedLocalDayHour(key, today, now) && hour.windOk === false) {
      continue;
    }
    reporting += 1;
    if (hour.rideable) rideable += 1;
  }

  if (reporting === 0) return null;
  return rideable / reporting;
}

function modelQuorumProbability(entry, dateStr, prefs) {
  const minWindow = parseMinRideableWindowHours(prefs?.min_rideable_window_hours);
  const models = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
  if (!models.length) return 1;

  let reporting = 0;
  let supporting = 0;

  for (const [, model] of models) {
    const day = model.days?.find((d) => d.date === dateStr);
    const hours = day?.hours ?? [];
    if (!hours.length) continue;
    reporting += 1;
    const span = longestRideableWindowSpan(hours, minWindow);
    if (span.length >= minWindow) supporting += 1;
  }

  if (reporting === 0) return 0;
  return supporting / reporting;
}

/**
 * Forecast confidence for a spot-day session.
 * Uses explicit `hour.forecastProbability` when every model hour in the quorum has it;
 * otherwise the fraction of models with a qualifying rideable window.
 */
function sessionForecastProbability(entry, dateStr, prefs) {
  const minWindow = parseMinRideableWindowHours(prefs?.min_rideable_window_hours);
  if (longestConsensusWindowLength(entry, dateStr, minWindow) < minWindow) return 0;

  const models = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
  const meteoOnRideable = [];
  for (const [, model] of models) {
    const day = model.days?.find((d) => d.date === dateStr);
    for (const hour of day?.hours ?? []) {
      if (!hour.rideable) continue;
      const p = readMeteoForecastProbability(hour);
      if (p != null) meteoOnRideable.push(p);
    }
  }
  if (meteoOnRideable.length > 0) {
    return meteoOnRideable.reduce((sum, p) => sum + p, 0) / meteoOnRideable.length;
  }

  return modelQuorumProbability(entry, dateStr, prefs);
}

/** Highest session probability among spots with a qualifying consensus window that day. */
function maxSessionProbabilityForDay(spots, dateStr, prefs) {
  const minWindow = parseMinRideableWindowHours(prefs?.min_rideable_window_hours);
  let best = 0;

  for (const entry of spots ?? []) {
    const windowLen = longestConsensusWindowLength(entry, dateStr, minWindow);
    if (windowLen < minWindow) continue;
    const probability = sessionForecastProbability(entry, dateStr, prefs);
    if (probability > best) best = probability;
  }

  return best;
}

module.exports = {
  PROBABILITY_BAND_COLORS,
  colorForProbability,
  hourModelAgreement,
  modelQuorumProbability,
  sessionForecastProbability,
  maxSessionProbabilityForDay,
};
