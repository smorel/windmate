const express = require('express');
const { getAllSpots, getPreferences } = require('../db');
const { fetchForecast } = require('../services/weather');
const { fetchSpotObservations } = require('../services/observations');
const { selectDashboardSpots } = require('../utils/spotSelection');

function createObservationsRouter(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius ?? process.env.DEFAULT_RADIUS_KM ?? 50);
    const limit = parseInt(req.query.limit ?? process.env.RIDEABILITY_SPOT_LIMIT ?? '12', 10);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng required' });
    }

    const prefs = getPreferences(db);
    const nearbySpots = selectDashboardSpots(
      getAllSpots(db),
      lat,
      lng,
      radius,
      limit,
      prefs.favorite_spot_ids
    );

    if (!nearbySpots.length) {
      return res.json({
        spots: [],
        radius_km: radius,
        center: { lat, lng },
      });
    }

    try {
      const results = await Promise.all(
        nearbySpots.map(async (spot) => {
          try {
            const forecast = await fetchForecast(db, spot.id, spot);
            return await fetchSpotObservations(db, spot, prefs, forecast);
          } catch {
            return {
              spot: {
                id: spot.id,
                name: spot.name,
                distance_km: spot.distance_km,
              },
              current: null,
              today: {
                actual: [],
                forecast: [],
                warnings: [],
                summary: {
                  hoursCompared: 0,
                  avgDeltaKt: null,
                  forecastRideableHours: 0,
                  actualRideableHours: 0,
                  tempSummary: null,
                },
              },
            };
          }
        })
      );

      res.json({
        spots: results,
        radius_km: radius,
        center: { lat, lng },
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createObservationsRouter };
