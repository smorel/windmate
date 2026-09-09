const express = require('express');
const { getAllSpots, getPreferences } = require('../db');
const { fetchForecast, getProvider, getPrimaryHourlyForecast } = require('../services/weather');
const { fetchOpenMeteoContext } = require('../services/openMeteoContext');
const { buildContextByTime, buildTempSummary } = require('../services/temperature');
const { buildDaylightByDate } = require('../services/daylight');
const {
  analyzeMixedRideability,
  analyzeHourlyRideability,
  summarizeByDay,
  computeSessionWarnings,
} = require('../services/rideability');
const { SPORT_COLORS } = require('../utils/sports');
const { MODEL_COLORS } = require('../utils/models');
const { selectDashboardSpots } = require('../utils/spotSelection');
const { attachSessionGoNoGoByDate } = require('../services/sessionGoNoGo');

function createRideabilityRouter(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = parseInt(req.query.limit ?? process.env.RIDEABILITY_SPOT_LIMIT ?? '12', 10);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const sport = req.query.sport;
    const prefs = getPreferences(db, sport);
    if (!prefs) return res.status(500).json({ error: 'Preferences not configured' });

    const effectiveRadius =
      req.query.radius != null && req.query.radius !== ''
        ? parseFloat(req.query.radius)
        : prefs.radius_km;
    const sportColor = SPORT_COLORS[prefs.sport] ?? SPORT_COLORS.wingfoiling;

    const nearbySpots = selectDashboardSpots(
      getAllSpots(db),
      lat,
      lng,
      effectiveRadius,
      limit,
      prefs.favorite_spot_ids
    );

    if (nearbySpots.length === 0) {
      return res.json({
        preferences: prefs,
        sportColor,
        modelColors: MODEL_COLORS,
        weatherProvider: getProvider(),
        radius_km: effectiveRadius,
        center: { lat, lng },
        spots: [],
      });
    }

    try {
      const results = await Promise.all(
        nearbySpots.map(async (spot) => {
          const forecast = await fetchForecast(db, spot.id, spot);
          const contextData = await fetchOpenMeteoContext(db, spot.id, spot);
          const contextByTime = buildContextByTime(contextData);
          const daylightByDate = buildDaylightByDate(contextData);

          const spotInfo = {
            id: spot.id,
            name: spot.name,
            latitude: spot.latitude,
            longitude: spot.longitude,
            distance_km: spot.distance_km,
            ideal_directions: spot.ideal_directions,
            source_url: spot.source_url,
          };

          if (forecast.models) {
            const mixed = analyzeMixedRideability(
              forecast,
              prefs,
              spot.ideal_directions,
              contextByTime,
              daylightByDate
            );
            const days = mixed.consensusDays.length ? mixed.consensusDays : mixed.days;
            const rideEntry = {
              spot: spotInfo,
              primaryModel: mixed.primaryModel,
              models: mixed.models,
              days,
            };
            return {
              spot: spotInfo,
              primaryModel: mixed.primaryModel,
              models: mixed.models,
              today: mixed.today,
              days,
              rideableToday: mixed.rideableToday,
              warnings: mixed.warnings,
              tempSummary: mixed.tempSummary,
              sessionGoNoGoByDate: attachSessionGoNoGoByDate(rideEntry, prefs),
            };
          }

          const primary = getPrimaryHourlyForecast(forecast) ?? forecast;
          const hourly = analyzeHourlyRideability(
            primary,
            prefs,
            spot.ideal_directions,
            contextByTime,
            daylightByDate
          );
          const days = summarizeByDay(hourly);
          const today = days[0]?.date ?? new Date().toISOString().slice(0, 10);
          const todayHours = hourly.filter((h) => h.time.startsWith(today));
          const rideableTodayHours = todayHours.filter((h) => h.rideable);

          const rideEntry = {
            spot: spotInfo,
            primaryModel: forecast.model ?? 'open-meteo',
            models: {},
            days,
          };
          return {
            spot: spotInfo,
            primaryModel: forecast.model ?? 'open-meteo',
            models: {},
            today: todayHours,
            days,
            rideableToday: rideableTodayHours.length,
            warnings: computeSessionWarnings(todayHours, prefs),
            tempSummary: buildTempSummary(rideableTodayHours),
            sessionGoNoGoByDate: attachSessionGoNoGoByDate(rideEntry, prefs),
          };
        })
      );

      res.json({
        preferences: prefs,
        sportColor,
        modelColors: MODEL_COLORS,
        weatherProvider: getProvider(),
        radius_km: effectiveRadius,
        center: { lat, lng },
        spots: results,
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRideabilityRouter };
