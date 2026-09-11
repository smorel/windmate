const { isSessionPlanningHour } = require('./forecastTime');
const { resolveWaveHeight } = require('../services/waves');

function hourTimeKey(time) {
  return String(time).slice(0, 16);
}

function formatWaveRange(minM, maxM, estimated) {
  const lo = minM.toFixed(1);
  const hi = maxM.toFixed(1);
  const range = lo === hi ? lo : `${lo}–${hi}`;
  return estimated ? `${range} m est.` : `${range} m`;
}

function formatTempRangeC(minC, maxC) {
  const lo = Math.round(minC);
  const hi = Math.round(maxC);
  return lo === hi ? `${lo}°C` : `${lo}–${hi}°C`;
}

/** Session planning hours shown in the matrix (excludes night / elapsed). */
function filterMatrixPlanningHours(hours, sessionDate) {
  return (hours ?? []).filter((hour) => {
    if (hour?.daylightOk === false) return false;
    return isSessionPlanningHour(hourTimeKey(hour.time), sessionDate);
  });
}

function buildPlanningHourConditionStats(hours) {
  if (!hours?.length) return null;

  let minWind = Infinity;
  let maxWind = -Infinity;
  let minGust = Infinity;
  let maxGust = -Infinity;
  let minWave = Infinity;
  let maxWave = -Infinity;
  let waveEstimated = false;
  let minAir = Infinity;
  let maxAir = -Infinity;

  for (const hour of hours) {
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

    if (hour.airTempC != null) {
      if (hour.airTempC < minAir) minAir = hour.airTempC;
      if (hour.airTempC > maxAir) maxAir = hour.airTempC;
    }
  }

  if (!Number.isFinite(minWind)) return null;

  const stats = {
    windMin: Math.round(minWind),
    windMax: Math.round(maxWind),
    gustMin: Math.round(minGust),
    gustMax: Math.round(maxGust),
    waveMin: minWave,
    waveMax: maxWave,
    waveEstimated,
  };

  if (Number.isFinite(minAir)) {
    stats.airMin = minAir;
    stats.airMax = maxAir;
  }

  return stats;
}

function formatPlanningHourConditionSummary(stats) {
  if (!stats) return '';
  const parts = [
    `${stats.windMin}–${stats.windMax} kt wind`,
    `${stats.gustMin}–${stats.gustMax} kt gusts`,
  ];
  if (Number.isFinite(stats.waveMin) && Number.isFinite(stats.waveMax)) {
    parts.push(`waves ${formatWaveRange(stats.waveMin, stats.waveMax, stats.waveEstimated)}`);
  }
  if (Number.isFinite(stats.airMin) && Number.isFinite(stats.airMax)) {
    parts.push(`${formatTempRangeC(stats.airMin, stats.airMax)} air`);
  }
  return parts.join(' · ');
}

function hourHasMatrixConditionData(hour) {
  if (hour == null) return false;
  return hour.windSpeed != null || hour.gusts != null || hour.waveHeightM != null;
}

function showMatrixCriterionSegment(hour, elapsed, fullDayMode) {
  if (hour == null) return false;
  if (elapsed) return hourHasMatrixConditionData(hour);
  if (fullDayMode) return hourHasMatrixConditionData(hour);
  return Boolean(hour.rideable);
}

/** Matrix slot shows forecast swatches for curiosity only (full-day, not rideable). */
  /** Probability row: only hours inside a qualifying rideable window (not isolated bust hours). */
  function matrixSlotShowsProbability(slot) {
    return Boolean(slot?.inRideableWindow);
  }

  function matrixSlotShowsFullDayCuriosity(modelHoursAtSlot, elapsed, fullDayMode) {
  if (!fullDayMode || elapsed) return false;
  const present = (modelHoursAtSlot ?? []).filter((hour) => hour != null);
  if (!present.length) return false;
  if (present.some((hour) => hour.rideable)) return false;
  return present.some((hour) => showMatrixCriterionSegment(hour, false, true));
}

function filterMatrixSpotsForDay(rankedRows, favoriteSpotIds, fullDayMode) {
  if (!fullDayMode) {
    return rankedRows.filter((row) => row.rideableCount > 0);
  }
  const favorites = new Set(favoriteSpotIds ?? []);
  return rankedRows.filter(
    (row) => row.rideableCount > 0 || favorites.has(row.entry?.spot?.id)
  );
}

module.exports = {
  hourHasMatrixConditionData,
    showMatrixCriterionSegment,
    matrixSlotShowsProbability,
    matrixSlotShowsFullDayCuriosity,
  filterMatrixSpotsForDay,
  filterMatrixPlanningHours,
  buildPlanningHourConditionStats,
  formatPlanningHourConditionSummary,
};
