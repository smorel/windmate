const { isWeatherBlocked } = require('./weatherHazards');
const { isTempOk } = require('./temperature');

/**
 * @param {object[]} actual
 * @param {object[]} forecastHours today's forecast hourly rideability objects
 * @param {{ min_wind_knots: number, max_gust_knots: number, min_air_temp_c?: number|null, min_water_temp_c?: number|null }} prefs
 */
function compareToday(actual, forecastHours, prefs) {
  const forecastByTime = new Map(forecastHours.map((h) => [h.time.slice(0, 16), h]));
  const deltas = [];
  let forecastRideable = 0;
  let actualRideable = 0;

  for (const point of actual) {
    const key = point.time.slice(0, 16);
    const forecast = forecastByTime.get(key);
    if (forecast) {
      deltas.push(point.windSpeed - forecast.windSpeed);
      if (forecast.rideable) forecastRideable++;
    }

    const windOk = point.windSpeed >= prefs.min_wind_knots && point.gusts <= prefs.max_gust_knots;
    const weatherOk = forecast ? forecast.weatherOk : true;
    const tempOk = forecast ? forecast.tempOk : true;
    if (windOk && weatherOk && tempOk) actualRideable++;
  }

  const avgDeltaKt = deltas.length
    ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10
    : null;

  return {
    hoursCompared: deltas.length,
    avgDeltaKt,
    forecastRideableHours: forecastRideable,
    actualRideableHours: actualRideable,
  };
}

/**
 * @param {object|null} current
 * @param {object[]} forecastHours
 */
function currentForecastDelta(current, forecastHours) {
  if (!current) return null;
  const now = new Date();
  const hourKey = `${now.toISOString().slice(0, 13)}:00`;
  const match = forecastHours.find((h) => h.time.startsWith(hourKey.slice(0, 13)));
  if (!match) return null;
  return Math.round((current.windSpeed - match.windSpeed) * 10) / 10;
}

module.exports = { compareToday, currentForecastDelta };
