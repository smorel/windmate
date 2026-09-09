const cron = require('node-cron');
const {
  getWatchedSessions,
  updateWatchedSessionStatus,
  purgeExpiredWatchedSessions,
  getPreferences,
  getSpotById,
  todayIsoDate,
} = require('../db');
const { fetchForecast } = require('../services/weather');
const { fetchOpenMeteoContext } = require('../services/openMeteoContext');
const { buildContextByTime } = require('../services/temperature');
const { buildDaylightByDate } = require('../services/daylight');
const { analyzeMixedRideability, analyzeHourlyRideability, summarizeByDay } = require('../services/rideability');
const { getPrimaryHourlyForecast } = require('../services/weather');
const { fetchSpotObservations } = require('../services/observations');
const { evaluateWatchlistStatus } = require('../services/watchlistStatus');
const { sendAlert, isConfigured } = require('../services/email');

function startWatchlistJobs(db) {
  const digestHour = parseInt(process.env.WATCHLIST_DIGEST_EMAIL_HOUR ?? '8', 10);
  const purgeHour = parseInt(process.env.WATCHLIST_PURGE_HOUR ?? '0', 10);

  cron.schedule(`0 ${purgeHour} * * *`, () => {
    const removed = purgeExpiredWatchedSessions(db);
    if (removed > 0) console.log(`[watchlist] Purged ${removed} expired session(s)`);
  });

  cron.schedule(`0 ${digestHour} * * *`, async () => {
    console.log('[watchlist] Running daily digest...');
    try {
      await runWatchlistDigest(db);
    } catch (err) {
      console.error('[watchlist] Digest failed:', err.message);
    }
  });

  console.log(`[watchlist] Digest at ${digestHour}:00, purge at ${purgeHour}:00`);
}

async function buildRideEntry(db, spot, prefs) {
  const forecast = await fetchForecast(db, spot.id, spot);
  const contextData = await fetchOpenMeteoContext(db, spot.id, spot);
  const contextByTime = buildContextByTime(contextData);
  const daylightByDate = buildDaylightByDate(contextData);

  if (forecast.models) {
    const mixed = analyzeMixedRideability(
      forecast,
      prefs,
      spot.ideal_directions,
      contextByTime,
      daylightByDate
    );
    return {
      spot,
      primaryModel: mixed.primaryModel,
      models: mixed.models,
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
  return { spot, primaryModel: forecast.model ?? 'open-meteo', models: {}, days: summarizeByDay(hourly) };
}

/** @param {import('better-sqlite3').Database} db */
async function runWatchlistDigest(db) {
  const sessions = getWatchedSessions(db).filter((s) => s.notify_email);
  if (!sessions.length) return;

  const lines = [];
  const today = todayIsoDate();

  for (const session of sessions) {
    const prefs = getPreferences(db, session.sport);
    const spot = getSpotById(db, session.spot_id);
    if (!spot || !prefs) continue;

    const rideEntry = await buildRideEntry(db, spot, prefs);
    let observation = null;
    if (session.session_date === today) {
      const forecast = await fetchForecast(db, spot.id, spot);
      observation = await fetchSpotObservations(db, { ...spot, distance_km: 0 }, prefs, forecast, {
        escalated: true,
      });
    }

    const evaluation = evaluateWatchlistStatus(session, rideEntry, prefs, observation);
    const worsened =
      session.last_status &&
      evaluation.status !== session.last_status &&
      evaluation.statusTrend === 'degrading';

    updateWatchedSessionStatus(db, session.id, {
      last_status: evaluation.status,
      last_status_at: Date.now(),
      last_notified_at: Date.now(),
      status_snapshot: evaluation.snapshot,
    });

    const dateLabel = session.session_date;
    const wind =
      evaluation.summary.windRange
        ? `${evaluation.summary.windRange.min}–${evaluation.summary.windRange.max} kt`
        : 'wind TBD';
    const windowH = evaluation.summary.windowHours;

    const verdict = evaluation.sessionGoNoGo?.state ?? evaluation.status;
    let line = `📅 ${dateLabel} · ${spot.name} (${session.sport})\n   ${wind}, ${windowH} h window · ${verdict}`;
    if (evaluation.sessionGoNoGo?.reason) {
      line += `\n   ${evaluation.sessionGoNoGo.reason}`;
    } else if (worsened && session.status_snapshot) {
      const prev = session.status_snapshot;
      line += `\n   Was score ${prev.score?.toFixed?.(2) ?? '?'} — now ${evaluation.summary.score.toFixed(2)}`;
    }
    lines.push(line);
  }

  if (!lines.length) return;

  const subject =
    sessions.some((s) => s.session_date === today)
      ? 'Mate — your watched sessions today'
      : 'Mate — your watched sessions update';

  const text = `Hey mate — your watched sessions:\n\n${lines.join('\n\n')}\n\nOpen Windmate`;
  const html = `<p>Hey mate — your watched sessions:</p><pre>${lines.join('\n\n')}</pre><p>Open Windmate</p>`;

  if (isConfigured()) {
    await sendAlert({ subject, text, html });
    console.log(`[watchlist] Sent digest (${lines.length} session(s))`);
  } else {
    console.log(`[watchlist] Would email digest:\n${text}`);
  }
}

module.exports = { startWatchlistJobs, runWatchlistDigest };
