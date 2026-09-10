/** Normalize provider wind probability to 0–1, or null when not usable. */
function normalizeMeteoProbability(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v <= 1) return v;
  if (v <= 10) return v / 10;
  if (v <= 100) return v / 100;
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

/**
 * v2 forecast_cache stored iGetwind 0–10 WINDP divided by 100 (e.g. 0.0735 for raw 7.35).
 * Idempotent for values already on the 0–1 scale above the legacy band.
 */
function repairLegacyStoredWindProbability(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > 0.11) return raw;
  return Math.min(1, v * 10);
}

function repairLegacyWindProbabilityHourly(hourly) {
  if (!hourly?.wind_probability_10m) return hourly;
  return {
    ...hourly,
    wind_probability_10m: hourly.wind_probability_10m.map((p) =>
      p == null ? p : repairLegacyStoredWindProbability(p)
    ),
  };
}

module.exports = {
  normalizeMeteoProbability,
  readMeteoForecastProbability,
  hasMeteoForecastProbability,
  repairLegacyStoredWindProbability,
  repairLegacyWindProbabilityHourly,
};
