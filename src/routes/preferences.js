const express = require('express');
const {
  getFullPreferences,
  getPreferences,
  updateGlobalPreferences,
  updateSportProfile,
  getSportProfile,
} = require('../db');
const { SPORT_DEFAULTS, VALID_SPORTS } = require('../utils/sports');
const { parseRankCriteriaOrder, VALID_RANK_CRITERIA } = require('../utils/rankCriteria');
const { parseFavoriteSpotIds } = require('../utils/favoriteSpots');
const { parseSearchRadiusKm } = require('../utils/searchRadius');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { clearObservationCache } = require('../services/observations');

function parseNullableFloat(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function createPreferencesRouter(db) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json(getFullPreferences(db));
  });

  router.put('/', (req, res) => {
    const current = getFullPreferences(db);

    if (req.body.active_sport !== undefined) {
      if (!VALID_SPORTS.includes(req.body.active_sport)) {
        return res.status(400).json({ error: `active_sport must be one of: ${VALID_SPORTS.join(', ')}` });
      }
      const profile = getSportProfile(db, req.body.active_sport);
      if (!profile?.enabled) {
        return res.status(400).json({ error: 'Cannot activate a disabled sport' });
      }
    }

    const activeSport = req.body.active_sport ?? current.active_sport;
    if (req.body.favorite_spot_ids !== undefined) {
      updateSportProfile(db, activeSport, {
        favorite_spot_ids: parseFavoriteSpotIds(req.body.favorite_spot_ids),
      });
    }

    const updated = updateGlobalPreferences(db, {
      active_sport: activeSport,
      alerts_master_enabled:
        req.body.alerts_master_enabled !== undefined
          ? req.body.alerts_master_enabled
          : current.alerts_master_enabled,
    });

    res.json(updated);
  });

  router.put('/sports/:sport', (req, res) => {
    const sport = req.params.sport;
    if (!VALID_SPORTS.includes(sport)) {
      return res.status(400).json({ error: `Invalid sport: ${sport}` });
    }

    const current = getSportProfile(db, sport);
    if (!current) return res.status(404).json({ error: 'Sport profile not found' });

    const defaults = SPORT_DEFAULTS[sport];
    const body = req.body;

    if (body.rank_criteria_order !== undefined) {
      const order = parseRankCriteriaOrder(body.rank_criteria_order);
      if (order.length !== VALID_RANK_CRITERIA.size) {
        return res.status(400).json({ error: 'rank_criteria_order must include each ranking criterion once' });
      }
    }

    const min_wind_knots = body.min_wind_knots !== undefined
      ? parseInt(body.min_wind_knots, 10)
      : current.min_wind_knots;
    const max_gust_knots = body.max_gust_knots !== undefined
      ? parseInt(body.max_gust_knots, 10)
      : current.max_gust_knots;

    if (Number.isNaN(min_wind_knots) || Number.isNaN(max_gust_knots)) {
      return res.status(400).json({ error: 'min_wind_knots and max_gust_knots must be integers' });
    }
    if (min_wind_knots < 0 || max_gust_knots < min_wind_knots) {
      return res.status(400).json({ error: 'Invalid wind thresholds' });
    }

    try {
      const windPrefsChanged =
        min_wind_knots !== current.min_wind_knots ||
        max_gust_knots !== current.max_gust_knots ||
        (body.min_rideable_window_hours !== undefined &&
          parseMinRideableWindowHours(body.min_rideable_window_hours) !==
            current.min_rideable_window_hours);

      updateSportProfile(db, sport, {
        enabled: body.enabled,
        min_wind_knots,
        max_gust_knots,
        min_air_temp_c:
          body.min_air_temp_c !== undefined ? parseNullableFloat(body.min_air_temp_c) : current.min_air_temp_c,
        min_water_temp_c:
          body.min_water_temp_c !== undefined ? parseNullableFloat(body.min_water_temp_c) : current.min_water_temp_c,
        offshore_wind_ok: body.offshore_wind_ok,
        wave_preference: body.wave_preference,
        min_foil_depth_cm: body.min_foil_depth_cm,
        radius_km: body.radius_km !== undefined ? parseSearchRadiusKm(body.radius_km) : current.radius_km,
        min_rideable_window_hours:
          body.min_rideable_window_hours !== undefined
            ? parseMinRideableWindowHours(body.min_rideable_window_hours)
            : current.min_rideable_window_hours,
        rank_criteria_order: body.rank_criteria_order,
        alert_enabled: body.alert_enabled,
        alert_schedule: body.alert_schedule,
        favorite_spot_ids: body.favorite_spot_ids,
      });
      if (windPrefsChanged) clearObservationCache(db);
      res.json(getFullPreferences(db));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPreferencesRouter, getPreferencesForSport: getPreferences };
