const express = require('express');
const { getAllSpots, getPreferences, getSpotById, planningTodayIsoDate, getPlanningTimezoneId } = require('../db');
const { haversineKm } = require('../utils/geo');
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
const { selectSpotsForProfile, filterRideabilityIncludeSpotIds } = require('../utils/spotSelection');
const { attachSessionGoNoGoByDate } = require('../services/sessionGoNoGo');
const { localDateString } = require('../utils/forecastTime');
const {
  buildSpotDirectionFields,
  idealDirectionsForRideability,
  scheduleSpotDirectionInference,
} = require('../utils/spotDirectionApi');
const { mapWithConcurrency } = require('../utils/mapWithConcurrency');

const RIDEABILITY_SPOT_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.RIDEABILITY_SPOT_CONCURRENCY ?? '4', 10) || 4
);

function createRideabilityRouter(db) {
  const router = express.Router();

  function planningContext() {
    return { today: planningTodayIsoDate(db), timezoneId: getPlanningTimezoneId(db) };
  }

  router.get('/', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const sport = req.query.sport;
    const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const prefs = getPreferences(db, sport);
    if (!prefs) return res.status(500).json({ error: 'Preferences not configured' });

    const effectiveRadius =
      req.query.radius != null && req.query.radius !== ''
        ? parseFloat(req.query.radius)
        : prefs.radius_km;
    const sportColor = SPORT_COLORS[prefs.sport] ?? SPORT_COLORS.wingfoiling;

    let nearbySpots = selectSpotsForProfile(
      getAllSpots(db),
      lat,
      lng,
      prefs,
      effectiveRadius
    );

    const includeSpotIds = filterRideabilityIncludeSpotIds(
      prefs,
      String(req.query.includeSpotIds ?? '').split(',')
    );
    if (includeSpotIds.length) {
      const included = new Set(nearbySpots.map((s) => s.id));
      for (const spotId of includeSpotIds) {
        if (included.has(spotId)) continue;
        const spot = getSpotById(db, spotId);
        if (!spot) continue;
        const distance_km = haversineKm(lat, lng, spot.latitude, spot.longitude);
        nearbySpots.push({
          ...spot,
          distance_km,
          outside_radius: distance_km > effectiveRadius,
        });
        included.add(spotId);
      }
    }

    if (nearbySpots.length === 0) {
      return res.json({
        preferences: prefs,
        sportColor,
        modelColors: MODEL_COLORS,
        weatherProvider: getProvider(),
        radius_km: effectiveRadius,
        center: { lat, lng },
        spots: [],
        nearby_spot_count: 0,
        forecast_failures: 0,
        forecast_unavailable: false,
      });
    }

    try {
      for (const spot of nearbySpots) {
        scheduleSpotDirectionInference(db, spot);
      }

      const settled = await mapWithConcurrency(
        nearbySpots,
        RIDEABILITY_SPOT_CONCURRENCY,
        async (spot) => {
          try {
            const freshSpot = getSpotById(db, spot.id) ?? spot;
            const idealDirections = idealDirectionsForRideability(freshSpot);
            const directionFields = buildSpotDirectionFields(freshSpot);

            const forecast = await fetchForecast(db, spot.id, spot, { skipCache });
            const contextData = await fetchOpenMeteoContext(db, spot.id, spot, { skipCache });
            const contextByTime = buildContextByTime(contextData);
            const daylightByDate = buildDaylightByDate(contextData);

            const spotInfo = {
              id: freshSpot.id,
              name: freshSpot.name,
              latitude: freshSpot.latitude,
              longitude: freshSpot.longitude,
              distance_km: spot.distance_km,
              outside_radius: Boolean(spot.outside_radius),
              source_url: freshSpot.source_url,
              ...directionFields,
            };

            if (forecast.models) {
              const mixed = analyzeMixedRideability(
                forecast,
                prefs,
                idealDirections,
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
                status: 'fulfilled',
                value: {
                  spot: spotInfo,
                  primaryModel: mixed.primaryModel,
                  models: mixed.models,
                  today: mixed.today,
                  days,
                  rideableToday: mixed.rideableToday,
                  warnings: mixed.warnings,
                  tempSummary: mixed.tempSummary,
                  sessionGoNoGoByDate: attachSessionGoNoGoByDate(rideEntry, prefs, planningContext()),
                },
              };
            }

            const primary = getPrimaryHourlyForecast(forecast) ?? forecast;
            const hourly = analyzeHourlyRideability(
              primary,
              prefs,
              idealDirections,
              contextByTime,
              daylightByDate
            );
            const days = summarizeByDay(hourly);
            const today = localDateString();
            const todayHours = hourly.filter((h) => h.time.startsWith(today));
            const rideableTodayHours = todayHours.filter((h) => h.rideable);

            const rideEntry = {
              spot: spotInfo,
              primaryModel: forecast.model ?? 'open-meteo',
              models: {},
              days,
            };
            return {
              status: 'fulfilled',
              value: {
                spot: spotInfo,
                primaryModel: forecast.model ?? 'open-meteo',
                models: {},
                today: todayHours,
                days,
                rideableToday: rideableTodayHours.length,
                warnings: computeSessionWarnings(todayHours, prefs),
                tempSummary: buildTempSummary(rideableTodayHours),
                sessionGoNoGoByDate: attachSessionGoNoGoByDate(rideEntry, prefs, planningContext()),
              },
            };
          } catch (err) {
            return { status: 'rejected', reason: err };
          }
        }
      );

      const results = settled
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);

      const forecastFailures = settled.filter((result) => result.status === 'rejected').length;
      for (const failure of settled) {
        if (failure.status === 'rejected') {
          console.warn('[rideability] spot forecast failed:', failure.reason?.message ?? failure.reason);
        }
      }

      const nearbySpotCount = nearbySpots.length;
      const forecastUnavailable = nearbySpotCount > 0 && results.length === 0;

      res.json({
        preferences: prefs,
        sportColor,
        modelColors: MODEL_COLORS,
        weatherProvider: getProvider(),
        radius_km: effectiveRadius,
        center: { lat, lng },
        spots: results,
        nearby_spot_count: nearbySpotCount,
        forecast_failures: forecastFailures,
        forecast_unavailable: forecastUnavailable,
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRideabilityRouter };
