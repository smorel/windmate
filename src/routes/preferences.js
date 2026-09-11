const express = require('express');
const {
  getFullPreferences,
  getPreferences,
  updateGlobalPreferences,
  updateSportProfile,
  getSportProfile,
  getActiveLocation,
  createSavedLocation,
  updateSavedLocation,
  deleteSavedLocation,
  setActiveLocationId,
} = require('../db');
const { SPORT_DEFAULTS, VALID_SPORTS } = require('../utils/sports');
const { parseRankCriteriaOrder, VALID_RANK_CRITERIA } = require('../utils/rankCriteria');
const { parseFavoriteSpotIds } = require('../utils/favoriteSpots');
const { parseSearchRadiusKm } = require('../utils/searchRadius');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { clearObservationCache } = require('../services/observations');
const {
  resolvePlaceTimezoneId,
  shouldReResolveTimezone,
} = require('../services/placeTimezone');

function parseNullableFloat(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

async function ensurePlaceTimezone(db, place) {
  if (!place || !shouldReResolveTimezone(place, place.lat, place.lng)) return place;
  try {
    const timezone_id = await resolvePlaceTimezoneId(place.lat, place.lng);
    if (timezone_id) {
      return updateSavedLocation(db, place.id, { timezone_id });
    }
  } catch (err) {
    console.warn('[prefs] timezone resolve failed:', err.message);
  }
  return place;
}

function createPreferencesRouter(db) {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const active = getActiveLocation(db);
      if (active) await ensurePlaceTimezone(db, active);
      res.json(getFullPreferences(db));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.put('/', (req, res) => {
    try {
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

      if (req.body.active_location_id !== undefined) {
        setActiveLocationId(db, req.body.active_location_id);
      }

      const activeSport = req.body.active_sport ?? current.active_sport;
      if (req.body.favorite_spot_ids !== undefined) {
        const locationId = current.active_location_id;
        if (!locationId && getActiveLocation(db) == null && getFullPreferences(db).saved_locations?.length) {
          return res.status(400).json({ error: 'No active planning place' });
        }
        updateSportProfile(db, activeSport, {
          favorite_spot_ids: parseFavoriteSpotIds(req.body.favorite_spot_ids),
        });
      }

      updateGlobalPreferences(db, {
        active_sport: activeSport,
        alerts_master_enabled:
          req.body.alerts_master_enabled !== undefined
            ? req.body.alerts_master_enabled
            : current.alerts_master_enabled,
        planner_full_day_forecast:
          req.body.planner_full_day_forecast !== undefined
            ? req.body.planner_full_day_forecast
            : current.planner_full_day_forecast,
      });

      res.json(getFullPreferences(db));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/locations', async (req, res) => {
    try {
      const { nickname, lat, lng } = req.body ?? {};
      let timezone_id = null;
      try {
        timezone_id = await resolvePlaceTimezoneId(Number(lat), Number(lng));
      } catch {
        /* optional */
      }
      createSavedLocation(db, { nickname, lat, lng, timezone_id });
      res.status(201).json(getFullPreferences(db));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/locations/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const current = getFullPreferences(db).saved_locations?.find((p) => p.id === id);
      if (!current) return res.status(404).json({ error: 'Place not found' });

      const patch = {};
      if (req.body.nickname !== undefined) patch.nickname = req.body.nickname;
      if (req.body.lat !== undefined) patch.lat = req.body.lat;
      if (req.body.lng !== undefined) patch.lng = req.body.lng;

      const lat = patch.lat ?? current.lat;
      const lng = patch.lng ?? current.lng;
      if (
        shouldReResolveTimezone(
          { ...current, lat: patch.lat ?? current.lat, lng: patch.lng ?? current.lng },
          lat,
          lng
        )
      ) {
        try {
          patch.timezone_id = await resolvePlaceTimezoneId(lat, lng);
        } catch {
          patch.timezone_id = null;
        }
      }

      const updated = updateSavedLocation(db, id, patch);
      if (!updated) return res.status(404).json({ error: 'Place not found' });
      res.json(getFullPreferences(db));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/locations/:id', (req, res) => {
    try {
      const result = deleteSavedLocation(db, req.params.id);
      if (!result.deleted) return res.status(404).json({ error: 'Place not found' });
      res.json(getFullPreferences(db));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
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

      if (body.favorite_spot_ids !== undefined && !getActiveLocation(db)) {
        const locations = getFullPreferences(db).saved_locations;
        if (locations?.length) {
          return res.status(400).json({ error: 'No active planning place' });
        }
      }

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
        favorites_only: body.favorites_only,
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
