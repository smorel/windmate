const { fetchForecast } = require('./weather');
const { fetchOpenMeteoContext } = require('./openMeteoContext');
const { buildContextByTime } = require('./temperature');
const { buildDaylightByDate } = require('./daylight');
const { analyzeMixedRideability, analyzeHourlyRideability, summarizeByDay } = require('./rideability');
const { getPrimaryHourlyForecast } = require('./weather');
const { computeSessionScore, longestConsensusWindowLength } = require('./sessionRank');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { localDateString } = require('../utils/forecastTime');

function todayIsoDate() {
  return localDateString();
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

function weekdayForDate(isoDate) {
  return new Date(`${isoDate}T12:00:00`).getDay();
}

/**
 * @param {object} profile sport profile with alert_schedule
 * @param {object[]} spots dashboard spots with distance_km
 * @param {Map<string, object>} rideabilityBySpotId precomputed rideability entries
 * @param {string} [today]
 * @param {{ forAlerts?: boolean }} [options] when true, honour alert_schedule.days_of_week (email cron)
 */
function hasHorizonOpportunity(
  profile,
  spots,
  rideabilityBySpotId,
  today = todayIsoDate(),
  options = {}
) {
  const forAlerts = Boolean(options.forAlerts);
  const schedule = profile.alert_schedule ?? {};
  const horizonDays = schedule.horizon_days ?? 7;
  const daysOfWeek = schedule.days_of_week ?? [0, 1, 2, 3, 4, 5, 6];
  const todayAlerts = schedule.today_alerts !== false;
  const minScore = schedule.min_session_score ?? 0.55;
  const minWindow = parseMinRideableWindowHours(profile.min_rideable_window_hours);

  for (let offset = 0; offset <= horizonDays; offset++) {
    const sessionDate = addDays(today, offset);
    if (!todayAlerts && sessionDate === today) continue;
    if (forAlerts && !daysOfWeek.includes(weekdayForDate(sessionDate))) continue;

    let bestScore = 0;
    for (const spot of spots) {
      if (spot.outside_radius) continue;
      const entry = rideabilityBySpotId.get(spot.id);
      if (!entry) continue;
      const windowHours = longestConsensusWindowLength(entry, sessionDate, minWindow);
      if (windowHours < minWindow) continue;
      const { score } = computeSessionScore(entry, sessionDate, profile, profile.radius_km);
      bestScore = Math.max(bestScore, score);
    }
    if (bestScore >= minScore) return true;
  }
  return false;
}

/**
 * Build rideability entry for a spot (shared by horizon summary and alerts).
 * @param {import('better-sqlite3').Database} db
 */
async function buildSpotRideabilityEntry(db, spot, prefs, options = {}) {
  const forecast = await fetchForecast(db, spot.id, spot, options);
  const contextData = await fetchOpenMeteoContext(db, spot.id, spot, options);
  const contextByTime = buildContextByTime(contextData);
  const daylightByDate = buildDaylightByDate(contextData);

  const spotInfo = {
    id: spot.id,
    name: spot.name,
    latitude: spot.latitude,
    longitude: spot.longitude,
    distance_km: spot.distance_km,
    ideal_directions: spot.ideal_directions,
    source_url: spot.source_url,
  };

  if (forecast.models) {
    const mixed = analyzeMixedRideability(
      forecast,
      prefs,
      spot.ideal_directions,
      contextByTime,
      daylightByDate
    );
    return {
      spot: spotInfo,
      primaryModel: mixed.primaryModel,
      models: mixed.models,
      today: mixed.today,
      days: mixed.consensusDays.length ? mixed.consensusDays : mixed.days,
    };
  }

  const primary = getPrimaryHourlyForecast(forecast) ?? forecast;
  const hourly = analyzeHourlyRideability(
    primary,
    prefs,
    spot.ideal_directions,
    contextByTime,
    daylightByDate
  );
  const days = summarizeByDay(hourly);
  return {
    spot: spotInfo,
    primaryModel: forecast.model ?? 'open-meteo',
    models: {},
    days,
  };
}

module.exports = {
  hasHorizonOpportunity,
  buildSpotRideabilityEntry,
  addDays,
  weekdayForDate,
};
