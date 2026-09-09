const cron = require('node-cron');
const { getGlobalPreferences, getSportProfiles } = require('../db');
const { getAllSpots } = require('../db');
const { selectDashboardSpots } = require('../utils/spotSelection');
const { hasHorizonOpportunity, buildSpotRideabilityEntry } = require('../services/alertQualification');
const { SPORT_DISPLAY_NAMES } = require('../utils/sports');
const { sendAlert, isConfigured } = require('../services/email');

function startHorizonAlertScheduler(db) {
  const schedule = process.env.CRON_SCHEDULE ?? '0 */3 * * *';
  cron.schedule(schedule, async () => {
    console.log('[cron] Running horizon alert scan...');
    try {
      await runHorizonAlertScan(db);
    } catch (err) {
      console.error('[cron] Horizon alert scan failed:', err.message);
    }
  });
}

/** @param {import('better-sqlite3').Database} db */
async function runHorizonAlertScan(db) {
  const global = getGlobalPreferences(db);
  if (!global?.alerts_master_enabled) return;

  const profiles = getSportProfiles(db).filter((p) => p.enabled && p.alert_enabled);
  if (!profiles.length) return;

  const lat = parseFloat(process.env.ALERT_ORIGIN_LAT ?? '45.5017');
  const lng = parseFloat(process.env.ALERT_ORIGIN_LNG ?? '-73.5673');
  const candidates = [];

  for (const profile of profiles) {
    const spots = selectDashboardSpots(
      getAllSpots(db),
      lat,
      lng,
      profile.radius_km,
      parseInt(process.env.RIDEABILITY_SPOT_LIMIT ?? '12', 10),
      global.favorite_spot_ids
    );

    const rideabilityBySpotId = new Map();
    await Promise.all(
      spots.map(async (spot) => {
        rideabilityBySpotId.set(spot.id, await buildSpotRideabilityEntry(db, spot, profile));
      })
    );

    if (hasHorizonOpportunity(profile, spots, rideabilityBySpotId, undefined, { forAlerts: true })) {
      candidates.push(SPORT_DISPLAY_NAMES[profile.sport] ?? profile.sport);
    }
  }

  if (!candidates.length) return;

  const subject =
    candidates.length === 1
      ? `Mate, ${candidates[0]} looks good on the horizon 🌬️`
      : `Mate — ${candidates.join(' + ')} on the horizon 🌬️`;
  const text = `Hey mate — sessions on the horizon for: ${candidates.join(', ')}.\n\nOpen Windmate`;
  const html = `<p>Hey mate — sessions on the horizon for: <strong>${candidates.join(', ')}</strong>.</p><p>Open Windmate</p>`;

  if (isConfigured()) {
    await sendAlert({ subject, text, html });
    console.log(`[cron] Sent horizon alert: ${candidates.join(', ')}`);
  } else {
    console.log(`[cron] Would email horizon alert: ${candidates.join(', ')}`);
  }
}

module.exports = { startHorizonAlertScheduler, runHorizonAlertScan };
