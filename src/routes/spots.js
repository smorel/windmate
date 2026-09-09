const express = require('express');
const { haversineKm } = require('../utils/geo');
const { getAllSpots, getPreferences } = require('../db');
const { searchSpots } = require('../utils/spotSelection');

function createSpotsRouter(db) {
  const router = express.Router();

  router.get('/search', (req, res) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      const limit = parseInt(req.query.limit ?? '15', 10);
      const query = String(req.query.q ?? '');

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'lat and lng query parameters are required' });
      }

      const prefs = getPreferences(db) ?? { favorite_spot_ids: [] };
      const spots = searchSpots(getAllSpots(db), query, lat, lng, limit, prefs.favorite_spot_ids);

      res.json({
        query: query.trim(),
        spots,
        center: { lat, lng },
      });
    } catch (err) {
      res.status(500).json({ error: err.message ?? 'Spot search failed' });
    }
  });

  router.get('/', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius ?? process.env.DEFAULT_RADIUS_KM ?? 50);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const spots = getAllSpots(db)
      .map((spot) => ({
        ...spot,
        distance_km: haversineKm(lat, lng, spot.latitude, spot.longitude),
      }))
      .filter((spot) => spot.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json({ spots, radius_km: radius, center: { lat, lng } });
  });

  return router;
}

module.exports = { createSpotsRouter };
