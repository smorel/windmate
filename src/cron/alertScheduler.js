const cron = require('node-cron');
const { getAllSpots, getPreferences } = require('../db');
const { fetchForecast } = require('../services/weather');
const { fetchOpenMeteoContext } = require('../services/openMeteoContext');
const { buildContextByTime } = require('../services/temperature');
const {
  analyzeForecastRideability,
  groupRideableWindows,
  computeSessionWarnings,
} = require('../services/rideability');
const { sendAlert, formatAlert, isConfigured } = require('../services/email');
const { localDateString } = require('../utils/forecastTime');

/**
 * @param {import('better-sqlite3').Database} db
 */
function startAlertScheduler(db) {
  const schedule = process.env.CRON_SCHEDULE ?? '0 */3 * * *';

  cron.schedule(schedule, async () => {
    console.log('[cron] Running rideability alert check...');
    try {
      await runAlertCheck(db);
    } catch (err) {
      console.error('[cron] Alert check failed:', err.message);
    }
  });

  console.log(`[cron] Alert scheduler started (${schedule})`);
  if (!isConfigured()) {
    console.warn('[cron] Email not configured — alerts will be logged only');
  }
}

/** @param {import('better-sqlite3').Database} db */
async function runAlertCheck(db) {
  const prefs = getPreferences(db);
  const spots = getAllSpots(db);
  const today = localDateString();

  for (const spot of spots) {
    const forecast = await fetchForecast(db, spot.id, spot);
    const contextData = await fetchOpenMeteoContext(db, spot.id, spot);
    const hourly = analyzeForecastRideability(forecast, prefs, spot.ideal_directions, contextData);
    const todayHours = hourly.filter((h) => h.time.startsWith(today));
    const warnings = computeSessionWarnings(todayHours, prefs);
    const windows = groupRideableWindows(hourly, today, prefs.min_rideable_window_hours);

    for (const window of windows) {
      const warning = warnings.find((w) => w.afterWindowEnd === window.endTime) ?? null;
      const alert = formatAlert(spot.name, { ...window, warning });
      if (isConfigured()) {
        await sendAlert(alert);
        console.log(`[cron] Sent email alert for ${spot.name}`);
      } else {
        console.log(`[cron] Would email: ${alert.text}`);
      }
    }
  }
}

module.exports = { startAlertScheduler, runAlertCheck };
