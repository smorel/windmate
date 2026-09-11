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
/** Canonical hourly key from Open-Meteo / iGetwind (`YYYY-MM-DDTHH:MM`). */
function normalizeHourlyTimestamp(isoTime) {
  return String(isoTime).replace(' ', 'T').slice(0, 16);
}

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

/** False for elapsed hours when `sessionDate` is the local calendar today (still rideable on future days). */
function isSessionPlanningHour(timeKey, sessionDate, date = new Date()) {
  if (sessionDate !== localDateString(date)) return true;
  return !isElapsedLocalDayHour(timeKey, sessionDate, date);
}

/** First session hour you can be on the water after drive, rig, and leave buffer (floor to hour). */
function earliestFeasibleOnWaterStartKey(
  now = new Date(),
  driveMinutes = 0,
  rigMinutes = 0,
  bufferMinutes = 0
) {
  const leadMs = (driveMinutes + rigMinutes + bufferMinutes) * 60 * 1000;
  const ready = new Date(now.getTime() + leadMs);
  const y = ready.getFullYear();
  const mo = String(ready.getMonth() + 1).padStart(2, '0');
  const d = String(ready.getDate()).padStart(2, '0');
  const h = ready.getHours();
  return `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:00`;
}

/** Leave-time hint for traffic lookup before the departure window is chosen. */
function bootstrapDepartureIso(dateStr, now = new Date()) {
  if (dateStr !== localDateString(now)) {
    return `${dateStr}T08:00`;
  }
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function partsInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
}

function partValue(parts, type) {
  return parts.find((p) => p.type === type)?.value;
}

/** @param {Date} [now] @param {string} timezoneId */
function calendarDateStringInTz(now = new Date(), timezoneId) {
  if (!timezoneId) return localDateString(now);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneId,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = partValue(parts, 'year');
  const mo = partValue(parts, 'month');
  const d = partValue(parts, 'day');
  return `${y}-${mo}-${d}`;
}

/** @param {Date} [now] @param {string} timezoneId */
function wallClockInTz(now = new Date(), timezoneId) {
  if (!timezoneId) {
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${mi}`;
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezoneId,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = partValue(parts, 'hour');
  const mi = partValue(parts, 'minute');
  return `${h}:${mi}`;
}

/** Same convention as `Date.getTimezoneOffset()` for the given IANA zone at `now`. */
function timezoneOffsetMinutesAt(now = new Date(), timezoneId) {
  if (!timezoneId) return now.getTimezoneOffset();
  const parts = partsInTimeZone(now, timezoneId);
  const y = Number(partValue(parts, 'year'));
  const mo = Number(partValue(parts, 'month'));
  const d = Number(partValue(parts, 'day'));
  const h = Number(partValue(parts, 'hour'));
  const mi = Number(partValue(parts, 'minute'));
  const sec = Number(partValue(parts, 'second'));
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, sec);
  return Math.round((asUtc - now.getTime()) / 60000);
}

function planningDiffersFromDevice(timezoneId, now = new Date()) {
  if (!timezoneId) return false;
  const deviceToday = localDateString(now);
  const planningToday = calendarDateStringInTz(now, timezoneId);
  if (deviceToday !== planningToday) return true;
  const deviceOffset = now.getTimezoneOffset();
  const planningOffset = timezoneOffsetMinutesAt(now, timezoneId);
  return Math.abs(deviceOffset - planningOffset) >= 60;
}

function currentHourStartKeyInTz(now = new Date(), timezoneId) {
  if (!timezoneId) return currentLocalHourStartKey(now);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneId,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const y = partValue(parts, 'year');
  const mo = partValue(parts, 'month');
  const d = partValue(parts, 'day');
  const h = partValue(parts, 'hour');
  return `${y}-${mo}-${d}T${h}:00`;
}

function isElapsedDayHourInTz(timeKey, today, now = new Date(), timezoneId) {
  const key = String(timeKey).replace(' ', 'T').slice(0, 16);
  if (!key.startsWith(today)) return false;
  return key < currentHourStartKeyInTz(now, timezoneId);
}

function isSessionPlanningHourInTz(timeKey, sessionDate, now = new Date(), timezoneId) {
  const today = timezoneId ? calendarDateStringInTz(now, timezoneId) : localDateString(now);
  if (sessionDate !== today) return true;
  return !isElapsedDayHourInTz(timeKey, sessionDate, now, timezoneId);
}

module.exports = {
  parseForecastParts,
  formatForecastClock,
  addForecastMinutes,
  subtractForecastMinutes,
  normalizeHourlyTimestamp,
  localDateString,
  todayFromHourlyTimes,
  currentLocalHourStartKey,
  isElapsedLocalDayHour,
  isSessionPlanningHour,
  earliestFeasibleOnWaterStartKey,
  bootstrapDepartureIso,
  calendarDateStringInTz,
  wallClockInTz,
  timezoneOffsetMinutesAt,
  planningDiffersFromDevice,
  currentHourStartKeyInTz,
  isElapsedDayHourInTz,
  isSessionPlanningHourInTz,
};
