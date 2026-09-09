const OBSERVATION_CACHE_TTL_MS = parseInt(process.env.OBSERVATION_CACHE_TTL_MS ?? '300000', 10);

const { fetchNearestStation } = require('./igetwind');
const { fetchOpenMeteoObservations } = require('./openMeteoObservations');
const { fetchWindyObservations } = require('./windyObservations');
const { compareToday, currentForecastDelta } = require('./observationCompare');
const { fetchOpenMeteoContext } = require('./openMeteoContext');
const { buildContextByTime, buildTempSummary } = require('./temperature');
const { buildDaylightByDate } = require('./daylight');
const { analyzeHourlyRideability, computeSessionWarnings } = require('./rideability');
const { getPrimaryHourlyForecast } = require('./weather');
const { hazardLabel } = require('./weatherHazards');
const { todayFromHourlyTimes } = require('../utils/forecastTime');

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, latitude: number, longitude: number, name: string, distance_km: number }} spot
 * @param {object} prefs
 * @param {object} forecast
 */
async function fetchSpotObservations(db, spot, prefs, forecast) {
  const cached = db.prepare(
    'SELECT fetched_at, data FROM observation_cache WHERE spot_id = ?'
  ).get(spot.id);

  if (cached && Date.now() - cached.fetched_at < OBSERVATION_CACHE_TTL_MS) {
    return { ...JSON.parse(cached.data), cached: true };
  }

  try {
    const obs = await buildSpotObservation(db, spot, prefs, forecast);
    db.prepare(`
      INSERT INTO observation_cache (spot_id, fetched_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(spot_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data
    `).run(spot.id, Date.now(), JSON.stringify(obs));
    return { ...obs, cached: false };
  } catch (err) {
    if (cached) {
      return { ...JSON.parse(cached.data), cached: true, stale: true };
    }
    throw err;
  }
}

async function buildSpotObservation(db, spot, prefs, forecast) {
  let current = null;
  let actual = [];
  let source = null;

  const station = await fetchNearestStation(spot.latitude, spot.longitude);
  if (station) {
    current = station;
    source = 'station';
  }

  if (!current) {
    try {
      const openMeteo = await fetchOpenMeteoObservations(spot.latitude, spot.longitude);
      current = openMeteo.current;
      actual = openMeteo.actual;
      source = openMeteo.source;
    } catch {
      if (process.env.WINDY_API_KEY) {
        const windy = await fetchWindyObservations(spot.latitude, spot.longitude);
        current = windy.current;
        actual = windy.actual;
        source = windy.source;
      }
    }
  } else if (!actual.length) {
    try {
      const openMeteo = await fetchOpenMeteoObservations(spot.latitude, spot.longitude);
      actual = openMeteo.actual;
    } catch {
      /* station current only */
    }
  }

  const contextData = await fetchOpenMeteoContext(db, spot.id, spot);
  const contextByTime = buildContextByTime(contextData);
  const daylightByDate = buildDaylightByDate(contextData);
  const primary = getPrimaryHourlyForecast(forecast);
  const today = todayFromHourlyTimes(primary);
  const forecastHours = primary
    ? analyzeHourlyRideability(primary, prefs, [], contextByTime, daylightByDate).filter((h) =>
        h.time.startsWith(today)
      )
    : [];

  const warnings = computeSessionWarnings(forecastHours, prefs);
  const rideableHours = forecastHours.filter((h) => h.rideable);
  const summary = {
    ...compareToday(actual, forecastHours, prefs),
    tempSummary: buildTempSummary(rideableHours),
  };

  if (current && contextByTime.size) {
    const ctx =
      contextByTime.get(current.observedAt?.slice(0, 16)) ??
      contextByTime.get(`${new Date().toISOString().slice(0, 13)}:00`) ??
      {};
    current.airTempC = current.airTempC ?? ctx.airTempC ?? null;
    current.waterTempC = ctx.waterTempC ?? null;
  }

  if (current) {
    current.source = source ?? current.source;
    current.deltaKt = currentForecastDelta(current, forecastHours);

    const nowHour = forecastHours.find((h) => {
      const hour = new Date(h.time).getHours();
      const obsHour = new Date(current.observedAt).getHours();
      return hour === obsHour;
    });
    if (nowHour && !nowHour.weatherOk) {
      current.hazardLabel = hazardLabel(nowHour);
    }
  }

  return {
    spot: {
      id: spot.id,
      name: spot.name,
      distance_km: spot.distance_km,
    },
    current,
    today: {
      actual,
      forecast: forecastHours,
      warnings,
      summary,
    },
  };
}

module.exports = {
  fetchSpotObservations,
  OBSERVATION_CACHE_TTL_MS,
};
