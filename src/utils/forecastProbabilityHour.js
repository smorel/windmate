/** Normalize provider wind probability to 0–1, or null when not usable. */
function normalizeMeteoProbability(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v > 1 && v <= 100) return v / 100;
  if (v <= 1) return v;
  return null;
}

/** Meteo probability on a rideability hour, when the model supplied it. */
function readMeteoForecastProbability(hour) {
  if (!hour) return null;
  return normalizeMeteoProbability(hour.forecastProbability);
}

function hasMeteoForecastProbability(hour) {
  return readMeteoForecastProbability(hour) != null;
}

module.exports = {
  normalizeMeteoProbability,
  readMeteoForecastProbability,
  hasMeteoForecastProbability,
};
