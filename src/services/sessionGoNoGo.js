const {
  computeSessionScore,
  longestConsensusWindow,
  getDayHours,
} = require('./sessionRank');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { resolveWaveHeight } = require('./waves');
const { computeSessionWarnings } = require('./weatherHazards');
const { todayIsoDate } = require('../db');
const { formatForecastClock, addForecastMinutes } = require('../utils/forecastTime');

const ON_TRACK_MIN_SCORE = parseFloat(process.env.WATCHLIST_STATUS_ON_TRACK_MIN_SCORE ?? '0.55');

const SEVERITY_RANK = { unknown: 0, go: 1, caution: 2, no_go: 3 };

function hourTimeKey(time) {
  return String(time).slice(0, 16);
}

function hoursInWindowSpan(allHours, windowSpan) {
  if (!windowSpan?.start || !windowSpan?.end) return [];
  const startKey = hourTimeKey(windowSpan.start);
  const endKey = hourTimeKey(windowSpan.end);
  return allHours.filter((hour) => {
    const key = hourTimeKey(hour.time);
    return key >= startKey && key <= endKey;
  });
}

function formatWaveRange(minM, maxM, estimated) {
  const lo = minM.toFixed(1);
  const hi = maxM.toFixed(1);
  const range = lo === hi ? lo : `${lo}–${hi}`;
  return estimated ? `${range} m est.` : `${range} m`;
}

function windowStatsRange(windowHours) {
  if (!windowHours.length) return null;

  let minWind = Infinity;
  let maxWind = -Infinity;
  let minGust = Infinity;
  let maxGust = -Infinity;
  let minWave = Infinity;
  let maxWave = -Infinity;
  let waveEstimated = false;

  for (const hour of windowHours) {
    const wind = hour.windSpeed ?? 0;
    const gust = hour.gusts ?? wind;
    if (wind < minWind) minWind = wind;
    if (wind > maxWind) maxWind = wind;
    if (gust < minGust) minGust = gust;
    if (gust > maxGust) maxGust = gust;

    const wave = resolveWaveHeight(hour.waveHeightM, wind);
    if (wave.waveSource === 'estimated') waveEstimated = true;
    if (wave.waveHeightM < minWave) minWave = wave.waveHeightM;
    if (wave.waveHeightM > maxWave) maxWave = wave.waveHeightM;
  }

  return {
    windMin: Math.round(minWind),
    windMax: Math.round(maxWind),
    gustMin: Math.round(minGust),
    gustMax: Math.round(maxGust),
    waveMin: minWave,
    waveMax: maxWave,
    waveEstimated,
  };
}

function rideableWindRange(hours) {
  const rideable = hours.filter((h) => h.rideable);
  if (!rideable.length) return null;

  let minWind = Infinity;
  let maxWind = -Infinity;
  let minGust = Infinity;
  let maxGust = -Infinity;

  for (const hour of rideable) {
    const wind = hour.windSpeed ?? 0;
    const gust = hour.gusts ?? wind;
    if (wind < minWind) minWind = wind;
    if (wind > maxWind) maxWind = wind;
    if (gust < minGust) minGust = gust;
    if (gust > maxGust) maxGust = gust;
  }

  return {
    min: Math.round(minWind),
    max: Math.round(maxWind),
    gustMin: Math.round(minGust),
    gustMax: Math.round(maxGust),
  };
}

function formatWindowTimeRange(windowSpan) {
  if (!windowSpan?.start || !windowSpan?.end) return '';
  const start = formatForecastClock(windowSpan.start);
  const end = formatForecastClock(addForecastMinutes(windowSpan.end, 60));
  return ` (${start}–${end})`;
}

function formatForecastSummary(windowHours, windowStats, windowSpan) {
  const timeRange = formatWindowTimeRange(windowSpan);
  if (!windowStats) {
    return `${windowHours} h rideable window${timeRange} in forecast`;
  }
  const wavePart =
    Number.isFinite(windowStats.waveMin) && Number.isFinite(windowStats.waveMax)
      ? ` · waves ${formatWaveRange(windowStats.waveMin, windowStats.waveMax, windowStats.waveEstimated)}`
      : '';
  return `${windowHours} h window${timeRange} · ${windowStats.windMin}–${windowStats.windMax} kt wind · ${windowStats.gustMin}–${windowStats.gustMax} kt gusts${wavePart}`;
}

function worseState(a, b) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function pickPrimaryHazardReason(warnings) {
  if (!warnings?.length) return null;
  const storm = warnings.find((w) => w.type === 'storm_approaching');
  if (storm) return storm.message;
  const fade = warnings.find((w) => w.type === 'wind_fading');
  if (fade) return fade.message;
  return warnings[0].message;
}

function liveMismatchReason(mismatch, current) {
  if (!mismatch) return null;
  if (mismatch.state === 'no_go') {
    return 'Live wind below what forecast promised — session oversold';
  }
  if (mismatch.state === 'caution') {
    const forecastKt =
      current?.deltaKt != null
        ? Math.round((current.windSpeed - current.deltaKt) * 10) / 10
        : '?';
    return `Live ${Math.round(current?.windSpeed ?? 0)} kt vs forecast ${forecastKt} kt — thinner than expected`;
  }
  if (mismatch.state === 'unknown') {
    return 'No live reading — trust the day forecast with caution';
  }
  return null;
}

/**
 * Session-level go / caution / no_go for a watched date (forecast + hazards + live on today).
 * @param {object} params
 * @param {object} params.rideEntry
 * @param {string} params.sessionDate ISO date
 * @param {object} params.prefs sport profile
 * @param {object|null} [params.observation]
 */
function computeSessionGoNoGo({
  rideEntry,
  sessionDate,
  prefs,
  observation = null,
  omitHazardFromBanner = null,
}) {
  const minWindow = parseMinRideableWindowHours(prefs.min_rideable_window_hours);
  const hours = getDayHours(rideEntry, sessionDate);
  const windowSpan = longestConsensusWindow(rideEntry, sessionDate, minWindow);
  const windowHours = windowSpan.length;
  const { score } = computeSessionScore(rideEntry, sessionDate, prefs, prefs.radius_km ?? 50);
  const windRange = rideableWindRange(hours);
  const windowHourList = hoursInWindowSpan(hours, windowSpan);
  const windowStats = windowStatsRange(windowHourList);
  const warnings = computeSessionWarnings(hours, prefs);
  const isToday = sessionDate === todayIsoDate();
  const omitDuplicateLiveDetail =
    omitHazardFromBanner ?? (isToday && observation != null);

  let state = 'go';
  const reasons = [];

  if (!hours.length) {
    state = 'unknown';
    reasons.push('Forecast unavailable for this session');
  } else if (windowHours < minWindow) {
    const scatteredRideable = hours.filter((h) => h.rideable).length;
    if (windowHours > 0) {
      state = 'no_go';
      reasons.push(`Only ${windowHours} h rideable window — need ${minWindow} h for your setup`);
    } else if (scatteredRideable > 0) {
      state = 'caution';
      reasons.push(`Rideable hours don't form a ${minWindow} h window`);
    } else {
      state = 'no_go';
      reasons.push('No rideable wind in the forecast for this session');
    }
  } else {
    if (windowHours <= minWindow) {
      state = 'caution';
      reasons.push(`Window barely meets your ${minWindow} h minimum`);
    }
    if (score < ON_TRACK_MIN_SCORE) {
      state = worseState(state, 'caution');
      reasons.push('Marginal session score for your setup');
    }
  }

  if (warnings?.length) {
    state = worseState(state, 'caution');
    const hazardReason = pickPrimaryHazardReason(warnings);
    if (hazardReason && !omitDuplicateLiveDetail) {
      reasons.push(hazardReason);
    }
  }

  const mismatch = observation?.today?.summary?.mismatch;
  if (isToday && mismatch) {
    const liveReason = liveMismatchReason(mismatch, observation.current);
    if (mismatch.state === 'no_go') {
      state = 'no_go';
      if (liveReason && !omitDuplicateLiveDetail) reasons.unshift(liveReason);
    } else if (mismatch.state === 'caution') {
      state = worseState(state, 'caution');
      if (liveReason && !omitDuplicateLiveDetail) reasons.push(liveReason);
    } else if (mismatch.state === 'unknown') {
      state = worseState(state, 'caution');
      if (liveReason && !omitDuplicateLiveDetail) reasons.push(liveReason);
    }
  }

  if (state === 'go') {
    reasons.push(formatForecastSummary(windowHours, windowStats, windowSpan));
  } else if (windowStats && windowHours > 0) {
    reasons.push(formatForecastSummary(windowHours, windowStats, windowSpan));
  }

  const uniqueReasons = [...new Set(reasons.filter(Boolean))];

  return {
    state,
    reason: uniqueReasons.join(' · '),
    windowHours,
    windowSpan,
    score,
    windRange,
    warnings,
  };
}

/**
 * @param {{ primaryModel: string, models: object, days: object[] }} rideEntry
 * @param {object} prefs
 */
function attachSessionGoNoGoByDate(rideEntry, prefs) {
  const sessionGoNoGoByDate = {};
  for (const day of rideEntry.days ?? []) {
    sessionGoNoGoByDate[day.date] = computeSessionGoNoGo({
      rideEntry,
      sessionDate: day.date,
      prefs,
      omitHazardFromBanner: day.date === todayIsoDate(),
    });
  }
  return sessionGoNoGoByDate;
}

module.exports = { computeSessionGoNoGo, rideableWindRange, attachSessionGoNoGoByDate };
