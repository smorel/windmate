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
  filterMatrixSpotsForDay,
};
