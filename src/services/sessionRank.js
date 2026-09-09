const {
  parseMinRideableWindowHours,
  longestRideableWindow,
  longestRideableWindowSpan,
  hourTimeKey,
} = require('../utils/rideableWindow');
const { parseRankCriteriaOrder } = require('../utils/rankCriteria');
const { SPORT_WAVE_DEFAULTS } = require('../utils/sports');

const DEFAULT_ORDER = [
  'rideability',
  'bestWindow',
  'proximity',
  'wind',
  'gust',
  'onshore',
  'waveMatch',
];

const DEPARTURE_WINDOW_CRITERIA = ['wind', 'gust', 'onshore', 'waveMatch'];

function normalizeOrder(order) {
  const seen = new Set();
  const result = [];
  for (const key of order ?? []) {
    if (!DEFAULT_ORDER.includes(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  for (const key of DEFAULT_ORDER) {
    if (seen.has(key)) continue;
    if (key === 'gust' && seen.has('wind')) {
      result.splice(result.indexOf('wind') + 1, 0, key);
    } else {
      result.push(key);
    }
    seen.add(key);
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

function departureWindowOrder(userOrder) {
  const normalized = normalizeOrder(userOrder);
  let filtered = normalized.filter((key) => DEPARTURE_WINDOW_CRITERIA.includes(key));
  if (!filtered.length) return [...DEPARTURE_WINDOW_CRITERIA];

  if (!filtered.includes('gust')) {
    const windIndex = filtered.indexOf('wind');
    filtered.splice(windIndex >= 0 ? windIndex + 1 : 0, 0, 'gust');
  }

  for (const key of DEPARTURE_WINDOW_CRITERIA) {
    if (!filtered.includes(key)) filtered.push(key);
  }

  return filtered;
}

function weightsForDepartureWindow(userOrder) {
  const order = departureWindowOrder(userOrder);
  const tiers = [];

  for (const key of order) {
    if (key === 'gust') continue;
    if (key === 'wind') {
      tiers.push(['wind', 'gust']);
      continue;
    }
    tiers.push([key]);
  }

  const n = tiers.length;
  const rawSum = (n * (n + 1)) / 2;
  const weights = {};
  tiers.forEach((keys, tierIndex) => {
    const tierWeight = (n - tierIndex) / rawSum;
    const share = tierWeight / keys.length;
    for (const key of keys) weights[key] = share;
  });
  return weights;
}

function getDayHours(entry, dateStr) {
  const models = entry.models ?? {};
  const modelOrder = [
    entry.primaryModel,
    'gfs',
    'open-meteo',
    'hrrr',
    'lam',
    'nam5',
    'nam12',
    'ecmwf9',
    'icon',
    ...Object.keys(models),
  ].filter(Boolean);

  const seen = new Set();
  for (const modelId of modelOrder) {
    if (seen.has(modelId) || models[modelId]?.error) continue;
    seen.add(modelId);
    const day = models[modelId]?.days?.find((d) => d.date === dateStr);
    if (day?.hours?.length) return day.hours;
  }

  const day = (entry.days ?? []).find((d) => d.date === dateStr);
  return day?.hours ?? [];
}

function getModelDayHours(entry, modelId, dateStr) {
  const day = entry.models?.[modelId]?.days?.find((d) => d.date === dateStr);
  return day?.hours ?? [];
}

function longestConsensusWindow(entry, dateStr, minWindowHours) {
  const modelEntries = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
  if (!modelEntries.length) {
    const hours = getDayHours(entry, dateStr);
    return longestRideableWindowSpan(hours, minWindowHours);
  }

  const timelines = modelEntries.map(([, model]) => {
    const day = model.days?.find((d) => d.date === dateStr);
    return day?.hours ?? [];
  });
  const timeKeys = [
    ...new Set(timelines.flatMap((hours) => hours.map((h) => h.time.slice(0, 16)))),
  ].sort();

  let best = { length: 0, start: null, end: null };
  let current = 0;
  let runStart = null;
  let runEnd = null;

  for (const key of timeKeys) {
    const allRideable = timelines.every((hours) => {
      const hour = hours.find((h) => h.time.slice(0, 16) === key);
      return hour?.rideable === true;
    });
    if (allRideable) {
      if (current === 0) runStart = key;
      current += 1;
      runEnd = key;
    } else if (current > 0) {
      if (current >= minWindowHours && current > best.length) {
        best = { length: current, start: runStart, end: runEnd };
      }
      current = 0;
      runStart = null;
      runEnd = null;
    }
  }
  if (current >= minWindowHours && current > best.length) {
    best = { length: current, start: runStart, end: runEnd };
  }
  return best;
}

function longestConsensusWindowLength(entry, dateStr, minWindowHours) {
  return longestConsensusWindow(entry, dateStr, minWindowHours).length;
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
  const maxRideableGust = rideableHours.length
    ? Math.max(...rideableHours.map((h) => h.gusts ?? h.windSpeed ?? 0))
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
    gust: Math.min(1, maxRideableGust / Math.max(prefs.max_gust_knots, 1)),
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

const WINDOW_REASON_LABELS = {
  rideability: 'Most good hours',
  bestWindow: 'Longest window',
  wind: 'Best wind',
  gust: 'Best gusts',
  onshore: 'Ideal direction',
  waveMatch: 'Best waves',
};

function buildRunFromHours(hours) {
  const start = hourTimeKey(hours[0].time);
  const end = hourTimeKey(hours[hours.length - 1].time);
  return { start, end, length: hours.length, hours };
}

function enumerateRunsFromHours(hours, minWindowHours) {
  const runs = [];
  let current = [];

  for (const hour of hours) {
    if (hour.rideable) {
      current.push(hour);
    } else if (current.length > 0) {
      if (current.length >= minWindowHours) runs.push(buildRunFromHours(current));
      current = [];
    }
  }
  if (current.length >= minWindowHours) runs.push(buildRunFromHours(current));
  return runs;
}

/** All contiguous min-length windows inside rideable blocks (sliding). */
function enumerateMinLengthWindows(hours, minWindowHours) {
  const blocks = enumerateRunsFromHours(hours, minWindowHours);
  const windows = [];
  for (const block of blocks) {
    for (let i = 0; i <= block.hours.length - minWindowHours; i += 1) {
      windows.push(buildRunFromHours(block.hours.slice(i, i + minWindowHours)));
    }
  }
  return windows;
}

function longestRideableBlockLength(hours, minWindowHours) {
  return Math.max(...enumerateRunsFromHours(hours, minWindowHours).map((run) => run.length), 0);
}

function buildConsensusHours(entry, dateStr, timelineHours) {
  const timeline = timelineHours ?? getDayHours(entry, dateStr);
  const modelEntries = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
  if (!modelEntries.length || !timeline.length) {
    return timeline;
  }

  const indexed = modelEntries.map(([, model]) => {
    const day = model.days?.find((d) => d.date === dateStr);
    const hours = day?.hours ?? [];
    const byKey = new Map();
    for (const hour of hours) byKey.set(hourTimeKey(hour.time), hour);
    return byKey;
  });

  return timeline.map((slot) => {
    const key = hourTimeKey(slot.time);
    const allRideable = indexed.every((byKey) => byKey.get(key)?.rideable === true);
    const sample = indexed.map((byKey) => byKey.get(key)).find(Boolean) ?? slot;
    return { ...sample, time: key, rideable: allRideable };
  });
}

function enumerateConsensusRuns(entry, dateStr, minWindowHours) {
  const consensusHours = buildConsensusHours(entry, dateStr);
  return enumerateRunsFromHours(consensusHours, minWindowHours);
}

function dayWindGustNorms(dayHours) {
  const rideable = (dayHours ?? []).filter((h) => h.rideable);
  const dayMaxWind = rideable.length
    ? Math.max(...rideable.map((h) => h.windSpeed ?? 0))
    : 1;
  const dayMaxGust = rideable.length
    ? Math.max(...rideable.map((h) => h.gusts ?? h.windSpeed ?? 0))
    : dayMaxWind;

  return {
    windNorm: Math.max(dayMaxWind, 1),
    gustNorm: Math.max(dayMaxGust, 1),
  };
}

function computeWindowRunMetrics(runHours, dayHours, prefs, longestBlockLength, minWindowHours) {
  const viableHours = runHours.filter((h) => h.windOk && h.weatherOk && h.tempOk);
  const directionAligned = (h) =>
    h.windExposure === 'onshore' ||
    h.windExposure === 'cross' ||
    (h.windExposure == null && h.idealWind);
  const onshoreHours = viableHours.filter(directionAligned).length;
  const maxRideableWind = runHours.length
    ? Math.max(...runHours.map((h) => h.windSpeed ?? 0))
    : 0;
  const maxGust = runHours.length
    ? Math.max(...runHours.map((h) => h.gusts ?? h.windSpeed ?? 0))
    : 0;
  const { windNorm, gustNorm } = dayWindGustNorms(dayHours);
  const wavePreference = wavePreferenceFromPrefs(prefs);
  const normLength = Math.max(longestBlockLength, minWindowHours, 1);

  return {
    rideability: 1,
    bestWindow: minWindowHours / normLength,
    wind: Math.min(1, maxRideableWind / windNorm),
    gust: Math.min(1, maxGust / gustNorm),
    onshore:
      viableHours.length > 0
        ? onshoreHours / viableHours.length
        : (entryHasIdealDirections(dayHours) ? 0.3 : 0.5),
    waveMatch: estimateWaveMatch(runHours, wavePreference),
  };
}

function entryHasIdealDirections(dayHours) {
  return dayHours.some((h) => h.idealWind != null);
}

function topReasonsForWindowMetrics(metrics, order) {
  const reasons = [];
  for (const key of order) {
    if (key === 'proximity') continue;
    const value = metrics[key] ?? 0;
    if (value <= 0) continue;
    if (key === 'onshore' && value < 0.5) continue;
    const label = WINDOW_REASON_LABELS[key];
    if (label) reasons.push(label);
    if (reasons.length >= 2) break;
  }
  return reasons;
}

function scoreWindowRun(run, consensusHours, prefs, longestBlockLength, minWindowHours, weights) {
  const metrics = computeWindowRunMetrics(
    run.hours,
    consensusHours,
    prefs,
    longestBlockLength,
    minWindowHours
  );
  let score = 0;
  for (const key of Object.keys(weights)) {
    if (key === 'proximity') continue;
    score += (metrics[key] ?? 0) * weights[key];
  }
  return {
    run,
    rawScore: score,
    windowScore: Math.round(score * 1000) / 1000,
    metrics,
  };
}

function displayWindowScore(rawScore) {
  return Math.round(rawScore * 100) / 100;
}

function isBetterWindowPick(candidate, current) {
  if (!current) return true;
  const displayC = displayWindowScore(candidate.rawScore);
  const displayCur = displayWindowScore(current.rawScore);
  if (displayC !== displayCur) return displayC > displayCur;
  if (candidate.rawScore !== current.rawScore) return candidate.rawScore > current.rawScore;
  return candidate.run.start < current.run.start;
}

function fillTrailingHourScores(byStartTime, consensusHours, minWindowHours) {
  const blocks = enumerateRunsFromHours(consensusHours, minWindowHours);
  const tailCount = Math.max(0, minWindowHours - 1);

  for (const block of blocks) {
    const hours = block.hours;
    for (let t = 0; t < tailCount; t += 1) {
      const index = hours.length - 1 - t;
      if (index < 0) break;

      const endKey = hourTimeKey(hours[index].time);
      if (byStartTime.has(endKey)) continue;

      const startIndex = index - minWindowHours + 1;
      if (startIndex < 0) continue;

      const startKey = hourTimeKey(hours[startIndex].time);
      const scored = byStartTime.get(startKey);
      if (scored) byStartTime.set(endKey, scored);
    }
  }
}

function pickBestDepartureWindow(scored, byStartTime) {
  if (!scored.length) return null;

  let best = null;
  let bestSum = -Infinity;

  for (const item of scored) {
    const sum = item.run.hours.reduce((total, hour) => {
      const hourScored = byStartTime.get(hourTimeKey(hour.time));
      return total + (hourScored ? displayWindowScore(hourScored.windowScore) : 0);
    }, 0);

    if (
      !best ||
      sum > bestSum ||
      (sum === bestSum && item.run.start.localeCompare(best.run.start) < 0)
    ) {
      best = item;
      bestSum = sum;
    }
  }

  return best;
}

function pickBestQualifyingWindow(entry, dateStr, prefs, timelineHours) {
  const minWindowHours = parseMinRideableWindowHours(prefs?.min_rideable_window_hours);
  const consensusHours = buildConsensusHours(entry, dateStr, timelineHours);
  const windows = enumerateMinLengthWindows(consensusHours, minWindowHours);
  if (!windows.length) return null;

  const longestBlockLength = longestRideableBlockLength(consensusHours, minWindowHours);
  const order = departureWindowOrder(prefs.rank_criteria_order);
  const weights = weightsForDepartureWindow(prefs.rank_criteria_order);

  const scored = windows.map((run) =>
    scoreWindowRun(run, consensusHours, prefs, longestBlockLength, minWindowHours, weights)
  );
  const byStartTime = new Map(scored.map((item) => [item.run.start, item]));
  fillTrailingHourScores(byStartTime, consensusHours, minWindowHours);
  const best = pickBestDepartureWindow(scored, byStartTime);
  if (!best) return null;

  return {
    run: best.run,
    windowScore: best.windowScore,
    metrics: best.metrics,
    topReasons: topReasonsForWindowMetrics(best.metrics, order),
    sessionWindowHours: minWindowHours,
  };
}

module.exports = {
  computeSessionScore,
  computeRawMetrics,
  longestConsensusWindow,
  longestConsensusWindowLength,
  getDayHours,
  getModelDayHours,
  weightsFromOrder,
  departureWindowOrder,
  weightsForDepartureWindow,
  enumerateConsensusRuns,
  enumerateMinLengthWindows,
  buildConsensusHours,
  pickBestQualifyingWindow,
  scoreWindowRun,
  computeWindowRunMetrics,
};
