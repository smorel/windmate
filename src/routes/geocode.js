const express = require('express');
const { reverseGeocode, searchGeocode } = require('../services/nominatim');

function createGeocodeRouter() {
  const router = express.Router();

  router.get('/reverse', async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'lat and lng query parameters are required' });
      }

      const result = await reverseGeocode(lat, lng);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message ?? 'Reverse geocode failed' });
    }
  });

  router.get('/search', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) {
        return res.status(400).json({ error: 'q must be at least 2 characters' });
      }

      const results = await searchGeocode(q);
      res.json({ results });
    } catch (err) {
      res.status(502).json({ error: err.message ?? 'Geocode search failed' });
    }
  });

  return router;
}

module.exports = { createGeocodeRouter };
