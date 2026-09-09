const { parseMinRideableWindowHours, longestRideableWindow } = require('../utils/rideableWindow');
const { parseRankCriteriaOrder } = require('../utils/rankCriteria');
const { SPORT_WAVE_DEFAULTS } = require('../utils/sports');

const DEFAULT_ORDER = [
  'rideability',
  'bestWindow',
  'proximity',
  'wind',
  'onshore',
  'waveMatch',
];

function normalizeOrder(order) {
  const seen = new Set();
  const result = [];
  for (const key of order ?? []) {
    if (!DEFAULT_ORDER.includes(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  for (const key of DEFAULT_ORDER) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}

function weightsFromOrder(order) {
  const normalized = normalizeOrder(order);
  const n = normalized.length;
  const rawSum = (n * (n + 1)) / 2;
  const weights = {};
  normalized.forEach((key, i) => {
    weights[key] = (n - i) / rawSum;
  });
  return weights;
}

function getDayHours(entry, dateStr) {
  const primary = entry.primaryModel;
  if (entry.models?.[primary]?.days) {
    const day = entry.models[primary].days.find((d) => d.date === dateStr);
    if (day?.hours?.length) return day.hours;
  }
  const day = (entry.days ?? []).find((d) => d.date === dateStr);
  return day?.hours ?? [];
}

function getModelDayHours(entry, modelId, dateStr) {
  const day = entry.models?.[modelId]?.days?.find((d) => d.date === dateStr);
  return day?.hours ?? [];
}

function longestConsensusWindowLength(entry, dateStr, minWindowHours) {
  const modelEntries = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
  if (!modelEntries.length) {
    const hours = getDayHours(entry, dateStr);
    return longestRideableWindow(hours.filter((h) => h.rideable), minWindowHours);
  }

  const timelines = modelEntries.map(([, model]) => {
    const day = model.days?.find((d) => d.date === dateStr);
    return day?.hours ?? [];
  });
  const timeKeys = [
    ...new Set(timelines.flatMap((hours) => hours.map((h) => h.time.slice(0, 16)))),
  ].sort();

  let best = 0;
  let current = 0;
  for (const key of timeKeys) {
    const allRideable = timelines.every((hours) => {
      const hour = hours.find((h) => h.time.slice(0, 16) === key);
      return hour?.rideable === true;
    });
    if (allRideable) {
      current += 1;
    } else {
      if (current >= minWindowHours) best = Math.max(best, current);
      current = 0;
    }
  }
  if (current >= minWindowHours) best = Math.max(best, current);
  return best;
}

function estimateWaveMatch(rideableHours, wavePreference) {
  if (!rideableHours.length) return 0;
  const heights = rideableHours.map((h) => {
    if (h.waveHeightM != null) return h.waveHeightM;
    const kts = h.windSpeed ?? 0;
    return Math.min(2.5, 0.0016 * kts * kts);
  });
  const avgH = heights.reduce((sum, v) => sum + v, 0) / heights.length;

  switch (wavePreference) {
    case 'flat':
      return avgH < 0.3 ? 1 : Math.max(0, 1 - (avgH - 0.3) / 0.7);
    case 'small':
      return avgH <= 1.0 ? 1 : Math.max(0, 1 - (avgH - 1.0) / 1.0);
    case 'big':
      return Math.min(1, avgH / 1.0);
    default:
      return 0.85;
  }
}

function wavePreferenceFromPrefs(prefs) {
  return prefs?.wave_preference ?? SPORT_WAVE_DEFAULTS[prefs?.sport] ?? 'flat';
}

function computeRawMetrics(entry, dateStr, prefs, radiusKm) {
  const hours = getDayHours(entry, dateStr);
  const minWindowHours = parseMinRideableWindowHours(prefs?.min_rideable_window_hours);
  const rideableHours = hours.filter((h) => h.rideable);
  const viableHours = hours.filter((h) => h.windOk && h.weatherOk && h.tempOk);
  const directionOkViable = viableHours.filter((h) => !h.offshoreBlocked);
  const rideableCount = longestConsensusWindowLength(entry, dateStr, minWindowHours);
  const idealDirections = entry.spot?.ideal_directions ?? [];
  const maxRideableWind = rideableHours.length
    ? Math.max(...rideableHours.map((h) => h.windSpeed ?? 0))
    : 0;
  const maxDirectionWind = directionOkViable.length
    ? Math.max(...directionOkViable.map((h) => h.windSpeed ?? 0))
    : 0;
  const maxWind = hours.length ? Math.max(...hours.map((h) => h.windSpeed ?? 0)) : 0;
  const directionAligned = (h) =>
    h.windExposure === 'onshore' ||
    h.windExposure === 'cross' ||
    (h.windExposure == null && h.idealWind);

  const onshoreHours = viableHours.filter(directionAligned).length;
  const wavePreference = wavePreferenceFromPrefs(prefs);
  const dist = entry.spot?.distance_km ?? radiusKm ?? 50;

  return {
    rideability: rideableHours.length / Math.max(hours.length, 1),
    bestWindow: Math.min(1, rideableCount / 8),
    proximity: Math.max(0, 1 - dist / Math.max(radiusKm ?? 50, 1)),
    wind: Math.min(1, maxRideableWind / Math.max(prefs.max_gust_knots, 1)),
    onshore:
      viableHours.length > 0
        ? onshoreHours / viableHours.length
        : idealDirections.length
          ? 0.3
          : 0.5,
    waveMatch: estimateWaveMatch(rideableHours, wavePreference),
    rideableCount,
    maxWind,
    maxDirectionWind,
  };
}

function computeSessionScore(entry, dateStr, prefs, radiusKm) {
  const order = parseRankCriteriaOrder(prefs.rank_criteria_order);
  const weights = weightsFromOrder(order);
  const metrics = computeRawMetrics(entry, dateStr, prefs, radiusKm);
  let score = 0;
  for (const key of Object.keys(weights)) {
    score += (metrics[key] ?? 0) * weights[key];
  }
  return { score: Math.round(score * 1000) / 1000, metrics };
}

module.exports = {
  computeSessionScore,
  computeRawMetrics,
  longestConsensusWindowLength,
  getDayHours,
  getModelDayHours,
};
