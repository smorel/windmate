const express = require('express');
const { getClientIp, isPublicIp } = require('../utils/clientIp');
const { resolvePlaceTimezoneId } = require('../services/placeTimezone');

const IP_API_FIELDS = 'status,message,lat,lon,city,regionName,country,query';

function createLocationRouter() {
  const router = express.Router();

  router.get('/ip', async (req, res) => {
    try {
      const clientIp = getClientIp(req);
      const path =
        clientIp && isPublicIp(clientIp)
          ? `http://ip-api.com/json/${encodeURIComponent(clientIp)}?fields=${IP_API_FIELDS}`
          : `http://ip-api.com/json/?fields=${IP_API_FIELDS}`;
      const response = await fetch(path);
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
        ip: data.query ?? clientIp ?? null,
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.get('/timezone', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng query params are required' });
    }
    try {
      const timezone_id = await resolvePlaceTimezoneId(lat, lng);
      res.json({ timezone_id });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createLocationRouter };
