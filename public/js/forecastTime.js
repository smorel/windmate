/** Open-Meteo hourly times are wall-clock at the spot — never use toISOString(). */
const WindmateForecastTime = (() => {
  const FORECAST_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
  let planningTimezoneId = null;
  let planningPlaceNickname = null;

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

  function partValue(parts, type) {
    return parts.find((p) => p.type === type)?.value;
  }

  function calendarDateStringInTz(now, timezoneId) {
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

  function wallClockInTz(now, timezoneId) {
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
    return `${partValue(parts, 'hour')}:${partValue(parts, 'minute')}`;
  }

  function timezoneOffsetMinutesAt(now, timezoneId) {
    if (!timezoneId) return now.getTimezoneOffset();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const y = Number(partValue(parts, 'year'));
    const mo = Number(partValue(parts, 'month'));
    const d = Number(partValue(parts, 'day'));
    const h = Number(partValue(parts, 'hour'));
    const mi = Number(partValue(parts, 'minute'));
    const sec = Number(partValue(parts, 'second'));
    const asUtc = Date.UTC(y, mo - 1, d, h, mi, sec);
    return Math.round((asUtc - now.getTime()) / 60000);
  }

  function planningDiffersFromDevice(now = new Date()) {
    if (!planningTimezoneId) return false;
    if (localDateString(now) !== calendarDateStringInTz(now, planningTimezoneId)) return true;
    return (
      Math.abs(now.getTimezoneOffset() - timezoneOffsetMinutesAt(now, planningTimezoneId)) >= 60
    );
  }

  function setPlanningContext(place) {
    planningTimezoneId = place?.timezone_id ?? null;
    planningPlaceNickname = place?.nickname ?? null;
  }

  function getPlanningPlaceNickname() {
    return planningPlaceNickname;
  }

  function getPlanningTimezoneId() {
    return planningTimezoneId;
  }

  /** Local calendar date — never use toISOString() (UTC rolls over early evening in NA). */
  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  function planningToday(date = new Date()) {
    return planningTimezoneId ? calendarDateStringInTz(date, planningTimezoneId) : localDateString(date);
  }

  /** Calendar today for planning — watchlist / GO·NO-GO / matrix elapsed hours. */
  function forecastTodayFromRideability(_data) {
    return planningToday();
  }

  function defaultPlannerDayDate(days) {
    const today = planningToday();
    if (days?.some((d) => d.date === today)) return today;
    return days?.[0]?.date ?? today;
  }

  function currentLocalHourStartKey(date = new Date()) {
    if (planningTimezoneId) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: planningTimezoneId,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const y = partValue(parts, 'year');
      const mo = partValue(parts, 'month');
      const d = partValue(parts, 'day');
      const h = partValue(parts, 'hour');
      return `${y}-${mo}-${d}T${h}:00`;
    }
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:00`;
  }

  function isElapsedLocalDayHour(timeKey, today, date = new Date()) {
    const key = String(timeKey).replace(' ', 'T').slice(0, 16);
    if (!key.startsWith(today)) return false;
    return key < currentLocalHourStartKey(date);
  }

  function isSessionPlanningHour(timeKey, sessionDate, date = new Date()) {
    const today = planningToday(date);
    if (sessionDate !== today) return true;
    return !isElapsedLocalDayHour(timeKey, sessionDate, date);
  }

  function fractionalHourFromForecastTime(isoTime) {
    const parts = parseForecastParts(isoTime);
    if (!parts) return 0;
    return parts.h + parts.mi / 60;
  }

  function fractionalHourSlotCenter(isoTime) {
    const parts = parseForecastParts(isoTime);
    if (!parts) return 0;
    const start = parts.h + parts.mi / 60;
    const onHourMark = parts.mi === 0;
    return onHourMark ? start + 0.5 : start;
  }

  function earliestFeasibleOnWaterStartKey(
    now = new Date(),
    driveMinutes = 0,
    rigMinutes = 0,
    bufferMinutes = 0
  ) {
    const leadMs = (driveMinutes + rigMinutes + bufferMinutes) * 60 * 1000;
    const ready = new Date(now.getTime() + leadMs);
    if (planningTimezoneId) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: planningTimezoneId,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(ready);
      const y = partValue(parts, 'year');
      const mo = partValue(parts, 'month');
      const d = partValue(parts, 'day');
      const h = partValue(parts, 'hour');
      return `${y}-${mo}-${d}T${h}:00`;
    }
    const y = ready.getFullYear();
    const mo = String(ready.getMonth() + 1).padStart(2, '0');
    const d = String(ready.getDate()).padStart(2, '0');
    const h = ready.getHours();
    return `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:00`;
  }

  return {
    parseForecastParts,
    formatForecastClock,
    addForecastMinutes,
    subtractForecastMinutes,
    formatWindowTimeRange,
    sessionWarningMessage,
    fractionalHourFromForecastTime,
    fractionalHourSlotCenter,
    localDateString,
    planningToday,
    forecastTodayFromRideability,
    defaultPlannerDayDate,
    currentLocalHourStartKey,
    isElapsedLocalDayHour,
    isSessionPlanningHour,
    earliestFeasibleOnWaterStartKey,
    setPlanningContext,
    getPlanningPlaceNickname,
    getPlanningTimezoneId,
    wallClockInTz,
    planningDiffersFromDevice,
    timezoneOffsetMinutesAt,
  };
})();
