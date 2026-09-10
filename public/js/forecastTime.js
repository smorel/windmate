/** Open-Meteo hourly times are wall-clock at the spot — never use toISOString(). */
const WindmateForecastTime = (() => {
  const FORECAST_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

  function parseForecastParts(isoTime) {
    const match = String(isoTime).match(FORECAST_TIME_RE);
    if (!match) return null;
    return {
      y: Number(match[1]),
      mo: Number(match[2]),
      d: Number(match[3]),
      h: Number(match[4]),
      mi: Number(match[5]),
    };
  }

  function formatForecastClock(isoTime) {
    const parts = parseForecastParts(isoTime);
    if (!parts) return String(isoTime);
    return `${String(parts.h).padStart(2, '0')}:${String(parts.mi).padStart(2, '0')}`;
  }

  function shiftForecastMinutes(isoTime, minutes) {
    const parts = parseForecastParts(isoTime);
    if (!parts) return isoTime;
    const ts = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi) + minutes * 60 * 1000;
    const shifted = new Date(ts);
    const y = shifted.getUTCFullYear();
    const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    const h = String(shifted.getUTCHours()).padStart(2, '0');
    const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${mi}`;
  }

  function subtractForecastMinutes(isoTime, minutes) {
    return shiftForecastMinutes(isoTime, -minutes);
  }

  function addForecastMinutes(isoTime, minutes) {
    return shiftForecastMinutes(isoTime, minutes);
  }

  function formatWindowTimeRange(windowHours) {
    if (!windowHours?.length) return '';
    const start = formatForecastClock(windowHours[0].time);
    const end = formatForecastClock(addForecastMinutes(windowHours[windowHours.length - 1].time, 60));
    return ` (${start}–${end})`;
  }

  function sessionWarningMessage(warning, prefs, bufferMin = 30) {
    if (!warning?.eventTime) return warning?.message ?? '';
    const minWind = prefs?.min_wind_knots ?? 12;
    const eventLabel = formatForecastClock(warning.eventTime);
    const finishLabel = formatForecastClock(
      subtractForecastMinutes(warning.eventTime, bufferMin)
    );
    if (warning.type === 'storm_approaching') {
      return `Heads up mate — storm around ${eventLabel}. Be off the water by ${finishLabel}.`;
    }
    if (warning.type === 'wind_fading') {
      return `Wind's dying below ${minWind} kt around ${eventLabel}. Wrap up by ${finishLabel} or you'll be stuck.`;
    }
    return warning.message ?? '';
  }

  /** Local calendar date — never use toISOString() (UTC rolls over early evening in NA). */
  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  /** Calendar today in the browser — matches watchlist / GO·NO-GO (not days[0], which can be yesterday). */
  function forecastTodayFromRideability(_data) {
    return localDateString();
  }

  function defaultPlannerDayDate(days) {
    const today = localDateString();
    if (days?.some((d) => d.date === today)) return today;
    return days?.[0]?.date ?? today;
  }

  return {
    formatForecastClock,
    addForecastMinutes,
    subtractForecastMinutes,
    formatWindowTimeRange,
    sessionWarningMessage,
    localDateString,
    forecastTodayFromRideability,
    defaultPlannerDayDate,
  };
})();
