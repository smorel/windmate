const express = require('express');
const { getSpotById } = require('../db');
const { fetchForecast } = require('../services/weather');
const { analyzeMixedRideability, analyzeHourlyRideability, summarizeByDay } = require('../services/rideability');
const { getPrimaryHourlyForecast } = require('../services/weather');

function createForecastRouter(db) {
  const router = express.Router();

  router.get('/:spotId', async (req, res) => {
    const spot = getSpotById(db, req.params.spotId);
    if (!spot) {
      return res.status(404).json({ error: 'Spot not found' });
    }

    try {
      const forecast = await fetchForecast(db, spot.id, spot);
      const prefs = db.prepare(
        'SELECT min_wind_knots, max_gust_knots FROM user_preferences WHERE id = 1'
      ).get();

      if (forecast.models) {
        const mixed = analyzeMixedRideability(forecast, prefs, spot.ideal_directions);
        return res.json({
          spot,
          forecast: {
            cached: forecast.cached ?? false,
            stale: forecast.stale ?? false,
            provider: forecast.provider,
            primaryModel: mixed.primaryModel,
            models: mixed.models,
            days: mixed.consensusDays,
          },
        });
      }

      const primary = getPrimaryHourlyForecast(forecast) ?? forecast;
      const hourly = analyzeHourlyRideability(primary, prefs, spot.ideal_directions);
      const days = summarizeByDay(hourly);

      res.json({
        spot,
        forecast: {
          cached: forecast.cached ?? false,
          stale: forecast.stale ?? false,
          hourly,
          days,
        },
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createForecastRouter };
