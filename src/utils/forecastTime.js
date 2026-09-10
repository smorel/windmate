/** Open-Meteo hourly times are wall-clock at the spot — never use toISOString(). */
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

/** Local calendar date — avoid toISOString() UTC rollover in the evening (Americas). */
function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function todayFromHourlyTimes(hourly) {
  const first = hourly?.time?.[0];
  if (first) return String(first).slice(0, 10);
  return localDateString();
}

/** Start of the current local clock hour, e.g. `2026-09-10T09:00`. */
function currentLocalHourStartKey(date = new Date()) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:00`;
}

/** True for timeline slots on `today` that started before the current local hour. */
function isElapsedLocalDayHour(timeKey, today, date = new Date()) {
  const key = String(timeKey).replace(' ', 'T').slice(0, 16);
  if (!key.startsWith(today)) return false;
  return key < currentLocalHourStartKey(date);
}

module.exports = {
  parseForecastParts,
  formatForecastClock,
  addForecastMinutes,
  subtractForecastMinutes,
  localDateString,
  todayFromHourlyTimes,
  currentLocalHourStartKey,
  isElapsedLocalDayHour,
};
