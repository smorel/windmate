const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { haversineKm } = require('../utils/geo');
const {
  getAllSpots,
  getSpotById,
  getPreferences,
  getSpotsByIds,
  insertManualSpot,
} = require('../db');
const { getSpotIntel } = require('../services/spotIntel');
const { searchSpots } = require('../utils/spotSelection');
const { parseFavoriteSpotIds } = require('../utils/favoriteSpots');
const {
  selectSpotsInBbox,
  findSpotWithinRadius,
  validateCreateSpotBody,
  formatSpotForMap,
} = require('../utils/spotBbox');

function createSpotsRouter(db) {
  const router = express.Router();

  router.get('/search', (req, res) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      const limit = parseInt(req.query.limit ?? '15', 10);
      const query = String(req.query.q ?? '');
      const sport = req.query.sport;

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'lat and lng query parameters are required' });
      }

      const prefs = getPreferences(db, sport) ?? { favorite_spot_ids: [] };
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

  router.get('/bbox', (req, res) => {
    try {
      const north = parseFloat(req.query.north);
      const south = parseFloat(req.query.south);
      const east = parseFloat(req.query.east);
      const west = parseFloat(req.query.west);
      const limit = parseInt(req.query.limit ?? '300', 10);
      const sport = req.query.sport;

      if ([north, south, east, west].some(Number.isNaN)) {
        return res.status(400).json({ error: 'north, south, east, and west are required' });
      }
      if (north < south) {
        return res.status(400).json({ error: 'north must be >= south' });
      }
      if (east < west) {
        return res.status(400).json({ error: 'east must be >= west' });
      }

      const prefs = getPreferences(db, sport) ?? { favorite_spot_ids: [] };
      const spots = selectSpotsInBbox(
        getAllSpots(db),
        north,
        south,
        east,
        west,
        limit,
        prefs.favorite_spot_ids
      );

      res.json({
        spots,
        bounds: { north, south, east, west },
      });
    } catch (err) {
      res.status(500).json({ error: err.message ?? 'Bbox spot query failed' });
    }
  });

  router.get('/favorites', (req, res) => {
    try {
      const sport = req.query.sport;
      const prefs = getPreferences(db, sport) ?? { favorite_spot_ids: [] };
      const favIds = parseFavoriteSpotIds(prefs.favorite_spot_ids);
      const favSet = new Set(favIds);
      const spots = getSpotsByIds(db, favIds).map((spot) => formatSpotForMap(spot, favSet));
      res.json({ spots });
    } catch (err) {
      res.status(500).json({ error: err.message ?? 'Favorite spots query failed' });
    }
  });

  router.post('/', (req, res) => {
    try {
      const parsed = validateCreateSpotBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }

      const { name, latitude, longitude } = parsed.data;
      const duplicate = findSpotWithinRadius(getAllSpots(db), latitude, longitude);
      if (duplicate) {
        return res.status(409).json({
          error: 'A spot already exists near these coordinates',
          spot: {
            id: duplicate.id,
            name: duplicate.name,
            latitude: duplicate.latitude,
            longitude: duplicate.longitude,
          },
        });
      }

      const id = uuidv4();
      const created = insertManualSpot(db, { id, name, latitude, longitude });
      const sport = req.body.sport;
      const prefs = getPreferences(db, sport) ?? { favorite_spot_ids: [] };
      const favSet = new Set(parseFavoriteSpotIds(prefs.favorite_spot_ids));

      res.status(201).json(formatSpotForMap(created, favSet));
    } catch (err) {
      res.status(500).json({ error: err.message ?? 'Spot creation failed' });
    }
  });

  router.get('/:spotId/intel', async (req, res) => {
    try {
      const spot = getSpotById(db, req.params.spotId);
      if (!spot) {
        return res.status(404).json({ error: 'Spot not found' });
      }
      const sport = req.query.sport ?? getPreferences(db)?.sport ?? 'wingfoiling';
      const intel = await getSpotIntel(db, spot.id, sport);
      res.json(intel);
    } catch (err) {
      res.status(500).json({ error: err.message ?? 'Spot intel failed' });
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
