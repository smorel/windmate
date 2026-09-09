const express = require('express');

function createLocationRouter() {
  const router = express.Router();

  router.get('/ip', async (_req, res) => {
    try {
      const response = await fetch('http://ip-api.com/json/?fields=status,message,lat,lon,city,regionName,country');
      if (!response.ok) {
        return res.status(502).json({ error: 'IP location lookup failed' });
      }
      const data = await response.json();
      if (data.status !== 'success') {
        return res.status(502).json({ error: data.message ?? 'IP location lookup failed' });
      }
      const label = [data.city, data.regionName, data.country].filter(Boolean).join(', ');
      res.json({
        lat: data.lat,
        lng: data.lon,
        label,
        source: 'ip',
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createLocationRouter };
