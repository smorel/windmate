const express = require('express');
const { getGlobalPreferences, getSportProfiles } = require('../db');
const { getAllSpots } = require('../db');
const { selectDashboardSpots } = require('../utils/spotSelection');
const { SPORT_COLORS, SPORT_DISPLAY_NAMES } = require('../utils/sports');
const { hasHorizonOpportunity, buildSpotRideabilityEntry } = require('../services/alertQualification');

function createSportsRouter(db) {
  const router = express.Router();

  router.get('/horizon-summary', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const global = getGlobalPreferences(db);
    const profiles = getSportProfiles(db).filter((p) => p.enabled);

    try {
      const sports = [];

      for (const profile of profiles) {
        const spots = selectDashboardSpots(
          getAllSpots(db),
          lat,
          lng,
          profile.radius_km,
          parseInt(process.env.RIDEABILITY_SPOT_LIMIT ?? '12', 10),
          global.favorite_spot_ids
        );

        const rideabilityBySpotId = new Map();
        await Promise.all(
          spots.map(async (spot) => {
            const entry = await buildSpotRideabilityEntry(db, spot, profile);
            rideabilityBySpotId.set(spot.id, entry);
          })
        );

        const color = SPORT_COLORS[profile.sport]?.hex ?? SPORT_COLORS.wingfoiling.hex;
        sports.push({
          sport: profile.sport,
          display_name: SPORT_DISPLAY_NAMES[profile.sport] ?? profile.sport,
          color,
          enabled: true,
          has_opportunity: hasHorizonOpportunity(profile, spots, rideabilityBySpotId),
        });
      }

      sports.sort((a, b) => a.display_name.localeCompare(b.display_name));

      res.json({
        active_sport: global.active_sport,
        sports,
        computed_at: Date.now(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSportsRouter };
