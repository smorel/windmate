/** Client-side rain / storm helpers (mirrors server weatherHazards.js). */
const WindmateWeatherHazards = (() => {
  const RAIN_CODES = new Set([61, 62, 63, 64, 65, 66, 67, 80, 81, 82]);
  const STORM_CODES = new Set([95, 96, 97, 98, 99]);

  function hasForecastRain(hour) {
    const precip = hour.precipitation ?? 0;
    const code = hour.weatherCode ?? 0;
    if (precip > 0) return true;
    if (RAIN_CODES.has(code) || STORM_CODES.has(code)) return true;
    return false;
  }

  return { hasForecastRain };
})();
