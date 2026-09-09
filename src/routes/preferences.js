const express = require('express');

const { getPreferences, updatePreferences } = require('../db');

const { SPORT_DEFAULTS } = require('../utils/sports');
const { parseRankCriteriaOrder, VALID_RANK_CRITERIA } = require('../utils/rankCriteria');
const { parseFavoriteSpotIds } = require('../utils/favoriteSpots');
const { parseSearchRadiusKm } = require('../utils/searchRadius');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');



const VALID_SPORTS = Object.keys(SPORT_DEFAULTS);



function parseNullableFloat(value) {

  if (value === null || value === undefined || value === '') return null;

  const n = parseFloat(value);

  return Number.isNaN(n) ? null : n;

}



function createPreferencesRouter(db) {

  const router = express.Router();



  router.get('/', (_req, res) => {

    res.json(getPreferences(db));

  });



  router.put('/', (req, res) => {

    const current = getPreferences(db);

    const sport = req.body.sport ?? current.sport;

    const sportChanged = sport !== current.sport;



    if (!VALID_SPORTS.includes(sport)) {

      return res.status(400).json({ error: `sport must be one of: ${VALID_SPORTS.join(', ')}` });

    }



    const defaults = SPORT_DEFAULTS[sport];

    const min_wind_knots = parseInt(

      req.body.min_wind_knots ?? (sportChanged ? defaults.min_wind_knots : current.min_wind_knots),

      10

    );

    const max_gust_knots = parseInt(

      req.body.max_gust_knots ?? (sportChanged ? defaults.max_gust_knots : current.max_gust_knots),

      10

    );



    const min_air_temp_c =

      req.body.min_air_temp_c !== undefined

        ? parseNullableFloat(req.body.min_air_temp_c)

        : sportChanged

          ? defaults.min_air_temp_c

          : current.min_air_temp_c;



    const min_water_temp_c =

      req.body.min_water_temp_c !== undefined

        ? parseNullableFloat(req.body.min_water_temp_c)

        : sportChanged

          ? defaults.min_water_temp_c

          : current.min_water_temp_c;



    if (Number.isNaN(min_wind_knots) || Number.isNaN(max_gust_knots)) {

      return res.status(400).json({ error: 'min_wind_knots and max_gust_knots must be integers' });

    }

    if (min_wind_knots < 0 || max_gust_knots < min_wind_knots) {

      return res.status(400).json({ error: 'Invalid wind thresholds' });

    }

    let rank_criteria_order = parseRankCriteriaOrder(current.rank_criteria_order);
    if (req.body.rank_criteria_order !== undefined) {
      rank_criteria_order = parseRankCriteriaOrder(req.body.rank_criteria_order);
      if (rank_criteria_order.length !== VALID_RANK_CRITERIA.size) {
        return res.status(400).json({ error: 'rank_criteria_order must include each ranking criterion once' });
      }
    }

    let favorite_spot_ids = parseFavoriteSpotIds(current.favorite_spot_ids);
    if (req.body.favorite_spot_ids !== undefined) {
      favorite_spot_ids = parseFavoriteSpotIds(req.body.favorite_spot_ids);
    }

    let radius_km = parseSearchRadiusKm(current.radius_km);
    if (req.body.radius_km !== undefined) {
      radius_km = parseSearchRadiusKm(req.body.radius_km);
    }

    let offshore_wind_ok = current.offshore_wind_ok ? 1 : 0;
    if (req.body.offshore_wind_ok !== undefined) {
      offshore_wind_ok = req.body.offshore_wind_ok ? 1 : 0;
    } else if (sportChanged) {
      offshore_wind_ok = defaults.offshore_wind_ok ? 1 : 0;
    }

    let min_rideable_window_hours = parseMinRideableWindowHours(current.min_rideable_window_hours);
    if (req.body.min_rideable_window_hours !== undefined) {
      min_rideable_window_hours = parseMinRideableWindowHours(req.body.min_rideable_window_hours);
    }

    const updated = updatePreferences(db, {

      sport,

      min_wind_knots,

      max_gust_knots,

      min_air_temp_c,

      min_water_temp_c,

      rank_criteria_order,

      favorite_spot_ids,

      radius_km,

      offshore_wind_ok,

      min_rideable_window_hours,

    });

    res.json(updated);

  });



  return router;

}



module.exports = { createPreferencesRouter };

