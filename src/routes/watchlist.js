const express = require('express');
const { randomUUID } = require('crypto');
const {
  getGlobalPreferences,
  getPreferences,
  getWatchedSessions,
  getWatchedSessionById,
  insertWatchedSession,
  deleteWatchedSession,
  updateWatchedSessionStatus,
  getSpotById,
  todayIsoDate,
} = require('../db');
const { fetchForecast } = require('../services/weather');
const { fetchOpenMeteoContext } = require('../services/openMeteoContext');
const { buildContextByTime } = require('../services/temperature');
const { buildDaylightByDate } = require('../services/daylight');
const { analyzeMixedRideability, analyzeHourlyRideability, summarizeByDay } = require('../services/rideability');
const { getPrimaryHourlyForecast } = require('../services/weather');
const { fetchSpotObservations, OBSERVATION_CACHE_TTL_MS } = require('../services/observations');
const { evaluateWatchlistStatus } = require('../services/watchlistStatus');
const { VALID_SPORTS } = require('../utils/sports');
const { haversineKm } = require('../utils/geo');

const WATCHED_OBSERVATION_TTL_MS = parseInt(
  process.env.WATCHED_OBSERVATION_TTL_MS ?? '120000',
  10
);

function createWatchlistRouter(db) {
  const router = express.Router();

  async function buildRideEntry(spot, prefs) {
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

  async function enrichSession(session) {
    const prefs = getPreferences(db, session.sport);
    const spot = getSpotById(db, session.spot_id);
    if (!spot || !prefs) {
      return { ...session, status: 'unknown', statusTrend: 'new' };
    }

    const global = getGlobalPreferences(db);
    const distance_km =
      global?.lat != null && global?.lng != null
        ? haversineKm(global.lat, global.lng, spot.latitude, spot.longitude)
        : prefs.radius_km ?? 50;
    const spotWithDistance = { ...spot, distance_km };
    const rideEntry = await buildRideEntry(spotWithDistance, prefs);
    let observation = null;
    if (session.session_date === todayIsoDate()) {
      const forecast = await fetchForecast(db, spot.id, spot);
      observation = await fetchSpotObservations(db, spotWithDistance, prefs, forecast, {
        ttlMs: WATCHED_OBSERVATION_TTL_MS,
        escalated: true,
      });
    }

    const evaluation = evaluateWatchlistStatus(session, rideEntry, prefs, observation);
    updateWatchedSessionStatus(db, session.id, {
      last_status: evaluation.status,
      last_status_at: Date.now(),
      status_snapshot: evaluation.snapshot,
    });

    return {
      ...session,
      status: evaluation.status,
      statusTrend: evaluation.statusTrend,
      summary: evaluation.summary,
      sessionGoNoGo: evaluation.sessionGoNoGo,
      excitement: evaluation.excitement,
      observation: session.session_date === todayIsoDate() ? observation : null,
    };
  }

  router.get('/', async (_req, res) => {
    try {
      const sessions = getWatchedSessions(db);
      const enriched = await Promise.all(sessions.map((s) => enrichSession(s)));
      res.json({ sessions: enriched });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.get('/today', async (_req, res) => {
    try {
      const today = todayIsoDate();
      const sessions = getWatchedSessions(db).filter((s) => s.session_date === today);
      const enriched = await Promise.all(sessions.map((s) => enrichSession(s)));
      res.json({ sessions: enriched, date: today });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.post('/', (req, res) => {
    const spotId = req.body.spotId;
    const sessionDate = req.body.sessionDate;
    if (!spotId || !sessionDate) {
      return res.status(400).json({ error: 'spotId and sessionDate are required' });
    }
    if (sessionDate < todayIsoDate()) {
      return res.status(400).json({ error: 'Cannot watch past session dates' });
    }

    const spot = getSpotById(db, spotId);
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    const global = getGlobalPreferences(db);
    const sport = req.body.sport ?? global.active_sport;
    if (!VALID_SPORTS.includes(sport)) {
      return res.status(400).json({ error: 'Invalid sport' });
    }

    const existing = db
      .prepare(
        'SELECT id FROM watched_sessions WHERE spot_id = ? AND session_date = ? AND sport = ?'
      )
      .get(spotId, sessionDate, sport);
    if (existing) {
      return res.status(409).json({
        error: 'Already watching this spot, date, and sport',
        id: existing.id,
      });
    }

    const id = randomUUID();
    const session = insertWatchedSession(db, {
      id,
      spot_id: spotId,
      session_date: sessionDate,
      sport,
      note: req.body.note ?? null,
      created_at: Date.now(),
      notify_email: req.body.notifyEmail !== false ? 1 : 0,
    });

    res.status(201).json(session);
  });

  router.delete('/:id', (req, res) => {
    const ok = deleteWatchedSession(db, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Watch not found' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createWatchlistRouter };
