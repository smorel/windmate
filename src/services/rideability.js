const { degreesToCompass, isIdealDirection } = require('../utils/geo');

const { getModelLabel, getModelColor } = require('../utils/models');

const { getPrimaryHourlyForecast } = require('./weather');

const { isWeatherBlocked, computeSessionWarnings } = require('./weatherHazards');

const { isTempOk, buildTempSummary, buildContextByTime, enrichHourWithContext } = require('./temperature');

const { resolveWaveHeight } = require('./waves');

const { classifyWindExposure, isOffshoreBlocked } = require('./offshore');

const { parseMinRideableWindowHours, markInRideableWindow } = require('../utils/rideableWindow');

/**
 * @param {{ hourly: object }} forecast

 * @param {{ min_wind_knots: number, max_gust_knots: number, min_air_temp_c?: number|null, min_water_temp_c?: number|null, offshore_wind_ok?: number|boolean }} prefs

 * @param {string[]} idealDirections

 * @param {Map<string, object>} [contextByTime]

 */

function analyzeHourlyRideability(forecast, prefs, idealDirections, contextByTime = new Map()) {

  const hourly = forecast.hourly;

  if (!hourly?.time) return [];



  return hourly.time.map((time, i) => {

    const windSpeed = hourly.wind_speed_10m[i] ?? 0;

    const gusts = hourly.wind_gusts_10m[i] ?? 0;

    const directionDeg = hourly.wind_direction_10m[i] ?? 0;

    const direction = degreesToCompass(directionDeg);

    const context = enrichHourWithContext(time, contextByTime);

    const wave = resolveWaveHeight(context.waveHeightM, windSpeed);



    const windOk = windSpeed >= prefs.min_wind_knots && gusts <= prefs.max_gust_knots;

    const weatherOk = !isWeatherBlocked(context);

    const tempOk = isTempOk(prefs, context);

    const idealWind = isIdealDirection(direction, idealDirections);

    const windExposure = classifyWindExposure(direction, idealDirections);

    const offshoreBlocked = isOffshoreBlocked(windExposure, prefs);

    const directionOk = !offshoreBlocked;

    const rideable = windOk && weatherOk && tempOk && directionOk;



    return {

      time,

      windSpeed,

      gusts,

      direction,

      directionDeg,

      windOk,

      weatherOk,

      tempOk,

      directionOk,

      rideable,

      idealWind,

      windExposure,

      offshoreBlocked,

      waveHeightM: wave.waveHeightM,

      waveSource: wave.waveSource,

      ...context,

    };

  });

}



/**

 * @param {object} mixedForecast

 * @param {{ min_wind_knots: number, max_gust_knots: number, min_air_temp_c?: number|null, min_water_temp_c?: number|null, offshore_wind_ok?: number|boolean }} prefs

 * @param {string[]} idealDirections

 * @param {Map<string, object>} [contextByTime]

 */

function analyzeMixedRideability(mixedForecast, prefs, idealDirections, contextByTime = new Map()) {

  const primaryModel = mixedForecast.primaryModel;

  const modelResults = {};



  for (const [modelId, modelData] of Object.entries(mixedForecast.models ?? {})) {

    if (!modelData.hourly) {

      modelResults[modelId] = {

        label: modelData.label ?? getModelLabel(modelId),

        color: getModelColor(modelId),

        error: modelData.error ?? 'Unavailable',

        today: [],

        days: [],

        rideableToday: 0,

        warnings: [],

        tempSummary: null,

      };

      continue;

    }



    const hourly = analyzeHourlyRideability(modelData, prefs, idealDirections, contextByTime);

    const days = summarizeByDay(hourly);

    const today = days[0]?.date ?? new Date().toISOString().slice(0, 10);

    const todayHours = hourly.filter((h) => h.time.startsWith(today));

    const rideableTodayHours = todayHours.filter((h) => h.rideable);



    modelResults[modelId] = {

      label: modelData.label ?? getModelLabel(modelId),

      color: getModelColor(modelId),

      today: todayHours,

      days,

      rideableToday: rideableTodayHours.length,

      warnings: computeSessionWarnings(todayHours, prefs),

      tempSummary: buildTempSummary(rideableTodayHours),

    };

  }



  const primary = modelResults[primaryModel] ?? Object.values(modelResults).find((m) => m.today?.length);

  const consensusDays = buildConsensusDays(modelResults);



  return {

    primaryModel,

    models: modelResults,

    today: primary?.today ?? [],

    days: primary?.days ?? [],

    rideableToday: primary?.rideableToday ?? 0,

    consensusDays,

    warnings: primary?.warnings ?? [],

    tempSummary: primary?.tempSummary ?? null,

  };

}



function buildConsensusDays(modelResults) {

  const dayMap = new Map();



  for (const result of Object.values(modelResults)) {

    if (!result.days) continue;

    for (const day of result.days) {

      if (!dayMap.has(day.date)) {

        dayMap.set(day.date, {
          date: day.date,
          modelRideable: [],
          maxWind: 0,
          rideableWindStats: [],
        });

      }

      const entry = dayMap.get(day.date);

      entry.modelRideable.push(day.rideableCount);

      entry.maxWind = Math.max(entry.maxWind, day.maxWind);

      if (day.rideableWind) entry.rideableWindStats.push(day.rideableWind);

    }

  }



  return [...dayMap.values()]

    .sort((a, b) => a.date.localeCompare(b.date))

    .slice(0, 7)

    .map((day) => {

      const counts = day.modelRideable;

      const avgRideable = counts.length

        ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length)

        : 0;

      const agreeing = counts.filter((c) => c > 0).length;

      return {

        date: day.date,

        maxWind: day.maxWind,

        rideableCount: avgRideable,

        rideableWind: aggregateRideableWindStats(day.rideableWindStats),

        modelsAgreeing: agreeing,

        modelCount: counts.length,

      };

    });

}



/** @param {ReturnType<typeof analyzeHourlyRideability>} hours */

function groupRideableWindows(hours, datePrefix, minWindowHours = 1) {

  const dayHours = hours.filter((h) => h.time.startsWith(datePrefix) && h.rideable);

  if (dayHours.length === 0) return [];

  const minHours = parseMinRideableWindowHours(minWindowHours, 1);

  const windows = [];

  let windowStart = dayHours[0];

  let windowEnd = dayHours[0];

  let runCount = 1;

  let maxWind = dayHours[0].windSpeed;

  let dominantDirection = dayHours[0].direction;

  let airTemps = dayHours[0].airTempC != null ? [dayHours[0].airTempC] : [];

  let waterTemps = dayHours[0].waterTempC != null ? [dayHours[0].waterTempC] : [];

  function pushWindowIfLongEnough() {
    if (runCount < minHours) return;
    windows.push(buildWindow(windowStart, windowEnd, maxWind, dominantDirection, airTemps, waterTemps));
  }

  for (let i = 1; i < dayHours.length; i++) {

    const prevIdx = hours.indexOf(dayHours[i - 1]);

    const currIdx = hours.indexOf(dayHours[i]);

    if (currIdx === prevIdx + 1) {

      windowEnd = dayHours[i];

      runCount += 1;

      if (dayHours[i].windSpeed > maxWind) {

        maxWind = dayHours[i].windSpeed;

        dominantDirection = dayHours[i].direction;

      }

      if (dayHours[i].airTempC != null) airTemps.push(dayHours[i].airTempC);

      if (dayHours[i].waterTempC != null) waterTemps.push(dayHours[i].waterTempC);

    } else {

      pushWindowIfLongEnough();

      windowStart = dayHours[i];

      windowEnd = dayHours[i];

      runCount = 1;

      maxWind = dayHours[i].windSpeed;

      dominantDirection = dayHours[i].direction;

      airTemps = dayHours[i].airTempC != null ? [dayHours[i].airTempC] : [];

      waterTemps = dayHours[i].waterTempC != null ? [dayHours[i].waterTempC] : [];

    }

  }

  pushWindowIfLongEnough();

  return windows;

}



function buildWindow(start, end, maxWind, direction, airTemps, waterTemps) {

  return {

    startHour: formatHour(start.time),

    endHour: formatHour(end.time),

    maxWind: Math.round(maxWind),

    direction,

    airTempMin: airTemps.length ? Math.round(Math.min(...airTemps)) : null,

    airTempMax: airTemps.length ? Math.round(Math.max(...airTemps)) : null,

    waterTempMin: waterTemps.length ? Math.round(Math.min(...waterTemps)) : null,

    waterTempMax: waterTemps.length ? Math.round(Math.max(...waterTemps)) : null,

    startTime: start.time,

    endTime: end.time,

    warning: null,

  };

}



function formatHour(isoTime) {

  const date = new Date(isoTime);

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

}



/** Min/max wind and gust across rideable hours only. */
function buildRideableWindStats(hours) {
  const rideable = hours.filter((h) => h.rideable);
  if (!rideable.length) return null;

  let minWind = Infinity;
  let maxWind = -Infinity;
  let minGust = Infinity;
  let maxGust = -Infinity;

  for (const hour of rideable) {
    const wind = hour.windSpeed ?? 0;
    const gust = hour.gusts ?? wind;
    if (wind < minWind) minWind = wind;
    if (wind > maxWind) maxWind = wind;
    if (gust < minGust) minGust = gust;
    if (gust > maxGust) maxGust = gust;
  }

  return { minWind, maxWind, minGust, maxGust };
}

function aggregateRideableWindStats(statsList) {
  const valid = statsList.filter(Boolean);
  if (!valid.length) return null;

  return {
    minWind: Math.min(...valid.map((s) => s.minWind)),
    maxWind: Math.max(...valid.map((s) => s.maxWind)),
    minGust: Math.min(...valid.map((s) => s.minGust)),
    maxGust: Math.max(...valid.map((s) => s.maxGust)),
  };
}

/** @param {ReturnType<typeof analyzeHourlyRideability>} hours */

function summarizeByDay(hours) {

  const days = new Map();

  for (const hour of hours) {

    const day = hour.time.slice(0, 10);

    if (!days.has(day)) {

      days.set(day, { date: day, hours: [], rideableCount: 0, maxWind: 0 });

    }

    const entry = days.get(day);

    entry.hours.push(hour);

    if (hour.rideable) entry.rideableCount++;

    entry.maxWind = Math.max(entry.maxWind, hour.windSpeed);

  }

  for (const entry of days.values()) {
    entry.rideableWind = buildRideableWindStats(entry.hours);
  }

  return [...days.values()];

}



/** For email alerts — uses primary model from mixed forecast. */

function analyzeForecastRideability(forecast, prefs, idealDirections, contextData = null) {

  const contextByTime = contextData ? buildContextByTime(contextData) : new Map();

  const primary = getPrimaryHourlyForecast(forecast);

  if (!primary) return [];

  return analyzeHourlyRideability(primary, prefs, idealDirections, contextByTime);

}



module.exports = {

  analyzeHourlyRideability,

  analyzeMixedRideability,

  analyzeForecastRideability,

  groupRideableWindows,

  markInRideableWindow,

  summarizeByDay,

  buildRideableWindStats,

  formatHour,

  computeSessionWarnings,

  buildContextByTime,

};

