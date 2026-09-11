const PRECIP_BLOCK_MM = parseFloat(process.env.PRECIP_BLOCK_MM ?? '0.3');
const SESSION_WARNING_HOURS = parseInt(process.env.SESSION_WARNING_HOURS ?? '3', 10);
const SESSION_FINISH_BUFFER_MIN = parseInt(process.env.SESSION_FINISH_BUFFER_MIN ?? '30', 10);

const {
  formatForecastClock,
  subtractForecastMinutes,
} = require('../utils/forecastTime');

const RAIN_CODES = new Set([61, 62, 63, 64, 65, 66, 67, 80, 81, 82]);
const STORM_CODES = new Set([95, 96, 97, 98, 99]);

/**
 * @param {{ precipitation?: number, weatherCode?: number }} hour
 */
function isWeatherBlocked(hour) {
  const precip = hour.precipitation ?? 0;
  const code = hour.weatherCode ?? 0;
  if (precip > PRECIP_BLOCK_MM) return true;
  if (RAIN_CODES.has(code) || STORM_CODES.has(code)) return true;
  return false;
}

/** Any forecast rain — used for visual overlays (lighter rain may still be rideable). */
function hasForecastRain(hour) {
  const precip = hour.precipitation ?? 0;
  const code = hour.weatherCode ?? 0;
  if (precip > 0) return true;
  if (RAIN_CODES.has(code) || STORM_CODES.has(code)) return true;
  return false;
}

function hazardLabel(hour) {
  const code = hour.weatherCode ?? 0;
  if (STORM_CODES.has(code)) return '⛈ Thunderstorm';
  if (RAIN_CODES.has(code) || (hour.precipitation ?? 0) > PRECIP_BLOCK_MM) return '🌧 Rain';
  return null;
}

function isThunderstorm(code) {
  return STORM_CODES.has(code ?? 0);
}

function isStormWeatherCode(code) {
  return STORM_CODES.has(code ?? 0);
}

function severityForStorm(code, precip) {
  if (isThunderstorm(code)) return 'high';
  if (precip > 1 || [64, 65, 66, 67, 81, 82].includes(code)) return 'medium';
  return 'low';
}

function severityForWindFade(windSpeed, minWind) {
  if (windSpeed < minWind - 3) return 'high';
  return 'medium';
}

function buildSessionWarningMessage(type, eventTime, prefs) {
  const eventLabel = formatForecastClock(eventTime);
  const finishLabel = formatForecastClock(
    subtractForecastMinutes(eventTime, SESSION_FINISH_BUFFER_MIN)
  );
  if (type === 'storm_approaching') {
    return `Heads up mate — storm around ${eventLabel}. Be off the water by ${finishLabel}.`;
  }
  return `Wind's dying below ${prefs.min_wind_knots} kt around ${eventLabel}. Wrap up by ${finishLabel} or you'll be stuck.`;
}

/**
 * @param {object[]} hours today's hourly rideability objects (sorted by time)
 * @param {{ min_wind_knots: number }} prefs
 */
function computeSessionWarnings(hours, prefs) {
  const rideable = hours.filter((h) => h.rideable);
  if (!rideable.length) return [];

  const windows = [];
  let start = rideable[0];
  let end = rideable[0];

  for (let i = 1; i < rideable.length; i++) {
    const prevIdx = hours.indexOf(rideable[i - 1]);
    const currIdx = hours.indexOf(rideable[i]);
    if (currIdx === prevIdx + 1) {
      end = rideable[i];
    } else {
      windows.push({ start, end });
      start = rideable[i];
      end = rideable[i];
    }
  }
  windows.push({ start, end });

  const warnings = [];
  for (const window of windows) {
    const endIdx = hours.indexOf(window.end);
    const lookahead = hours.slice(endIdx + 1, endIdx + 1 + SESSION_WARNING_HOURS);
    let warning = null;

    for (const hour of lookahead) {
      if (isWeatherBlocked(hour)) {
        const finishBy = subtractForecastMinutes(hour.time, SESSION_FINISH_BUFFER_MIN);
        warning = {
          type: 'storm_approaching',
          severity: severityForStorm(hour.weatherCode, hour.precipitation ?? 0),
          eventTime: hour.time,
          suggestedFinishBy: finishBy,
          message: buildSessionWarningMessage('storm_approaching', hour.time, prefs),
          afterWindowEnd: window.end.time,
        };
        break;
      }
      if (hour.windSpeed < prefs.min_wind_knots) {
        const finishBy = subtractForecastMinutes(hour.time, SESSION_FINISH_BUFFER_MIN);
        warning = {
          type: 'wind_fading',
          severity: severityForWindFade(hour.windSpeed, prefs.min_wind_knots),
          eventTime: hour.time,
          suggestedFinishBy: finishBy,
          message: buildSessionWarningMessage('wind_fading', hour.time, prefs),
          afterWindowEnd: window.end.time,
          windAtEvent: Math.round(hour.windSpeed),
        };
        break;
      }
    }

    if (warning) warnings.push(warning);
  }

  return warnings;
}

module.exports = {
  isWeatherBlocked,
  hasForecastRain,
  hazardLabel,
  isThunderstorm,
  isStormWeatherCode,
  computeSessionWarnings,
  buildSessionWarningMessage,
  PRECIP_BLOCK_MM,
  SESSION_WARNING_HOURS,
  SESSION_FINISH_BUFFER_MIN,
};
