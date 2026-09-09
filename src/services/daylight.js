/**
 * Daylight windows from Open-Meteo daily sunrise/sunset (spot-local timezone).
 * Night hours are not effectively rideable.
 */

/**
 * @param {string} iso
 * @returns {number} minutes from local midnight
 */
function localMinutesFromIso(iso) {
  const match = String(iso).match(/T(\d{2}):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * @param {object} data Open-Meteo forecast payload with optional daily sunrise/sunset
 * @returns {Map<string, { sunrise: string, sunset: string }>}
 */
function buildDaylightByDate(data) {
  const daily = data?.daily;
  if (!daily?.time?.length) return new Map();

  const map = new Map();
  for (let i = 0; i < daily.time.length; i++) {
    const sunrise = daily.sunrise?.[i];
    const sunset = daily.sunset?.[i];
    if (!sunrise || !sunset) continue;
    map.set(daily.time[i], { sunrise, sunset });
  }
  return map;
}

/**
 * Hour block starts at HH:00 local — daylight when start >= sunrise and < sunset.
 * @param {string} hourTime
 * @param {Map<string, { sunrise: string, sunset: string }>} daylightByDate
 */
function isDaylightOk(hourTime, daylightByDate) {
  if (!daylightByDate?.size) return true;

  const date = hourTime.slice(0, 10);
  const day = daylightByDate.get(date);
  if (!day) return true;

  const hourMin = localMinutesFromIso(hourTime);
  const riseMin = localMinutesFromIso(day.sunrise);
  const setMin = localMinutesFromIso(day.sunset);
  return hourMin >= riseMin && hourMin < setMin;
}

module.exports = {
  buildDaylightByDate,
  isDaylightOk,
  localMinutesFromIso,
};
