const express = require('express');
const { getSpotById, getPreferences } = require('../db');
const { fetchForecast } = require('../services/weather');
const { fetchOpenMeteoContext } = require('../services/openMeteoContext');
const { buildContextByTime } = require('../services/temperature');
const { buildDaylightByDate } = require('../services/daylight');
const { analyzeMixedRideability, analyzeHourlyRideability, summarizeByDay } = require('../services/rideability');
const { getPrimaryHourlyForecast } = require('../services/weather');
const { buildDeparturePlan, DEFAULT_RIG_MINUTES } = require('../services/departurePlanner');
const { haversineKm } = require('../utils/geo');

function createDepartureRouter(db) {
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

  router.get('/', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const spotId = req.query.spotId;
    const date = req.query.date;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }
    if (!spotId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'spotId and date (YYYY-MM-DD) are required' });
    }

    const spot = getSpotById(db, spotId);
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    const prefs = getPreferences(db, req.query.sport);
    if (!prefs) return res.status(500).json({ error: 'Preferences not configured' });

    const tzRaw = req.query.tzOffset;
    const tzOffsetMinutes =
      tzRaw != null && tzRaw !== '' && Number.isFinite(Number(tzRaw))
        ? Number(tzRaw)
        : undefined;

    const origin = {
      lat,
      lng,
      label: req.query.originLabel ?? 'Home',
    };
    const distance_km = haversineKm(lat, lng, spot.latitude, spot.longitude);
    const spotWithDistance = { ...spot, distance_km };

    try {
      const rideEntry = await buildRideEntry(spotWithDistance, prefs);
      const result = await buildDeparturePlan(db, {
        origin,
        spot: spotWithDistance,
        dateStr: date,
        rideEntry,
        prefs,
        tzOffsetMinutes,
      });

      if (result.status === 'no_window') {
        return res.json({
          spotId,
          date,
          origin,
          minRideableWindowHours: prefs.min_rideable_window_hours,
          rigMinutes: DEFAULT_RIG_MINUTES,
          plan: null,
          alternate: null,
          status: 'no_window',
        });
      }

      res.json({
        spotId,
        date,
        origin,
        minRideableWindowHours: prefs.min_rideable_window_hours,
        rigMinutes: DEFAULT_RIG_MINUTES,
        plan: result.plan,
        alternate: null,
        status: result.status,
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createDepartureRouter };
