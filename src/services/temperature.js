const { resolveWaveHeight } = require('./waves');

/**
 * @param {{ min_air_temp_c?: number|null, min_water_temp_c?: number|null }} prefs
 * @param {{ airTempC?: number|null, waterTempC?: number|null }} hour
 */
function isTempOk(prefs, hour) {
  if (prefs.min_air_temp_c != null && hour.airTempC != null && hour.airTempC < prefs.min_air_temp_c) {
    return false;
  }
  if (
    prefs.min_water_temp_c != null &&
    hour.waterTempC != null &&
    hour.waterTempC < prefs.min_water_temp_c
  ) {
    return false;
  }
  return true;
}

/**
 * @param {object[]} rideableHours
 */
function buildTempSummary(rideableHours) {
  const withAir = rideableHours.filter((h) => h.airTempC != null);
  const withWater = rideableHours.filter((h) => h.waterTempC != null);

  if (!withAir.length) {
    return {
      rideableAirMin: null,
      rideableAirMax: null,
      rideableWaterMin: null,
      rideableWaterMax: null,
      waterTempAvailable: withWater.length > 0,
    };
  }

  const airTemps = withAir.map((h) => h.airTempC);
  const waterTemps = withWater.map((h) => h.waterTempC);

  return {
    rideableAirMin: Math.round(Math.min(...airTemps)),
    rideableAirMax: Math.round(Math.max(...airTemps)),
    rideableWaterMin: waterTemps.length ? Math.round(Math.min(...waterTemps)) : null,
    rideableWaterMax: waterTemps.length ? Math.round(Math.max(...waterTemps)) : null,
    waterTempAvailable: waterTemps.length > 0,
  };
}

/**
 * Build time-indexed context map from Open-Meteo hourly arrays.
 * @param {object} data
 */
function buildContextByTime(data) {
  const hourly = data?.hourly;
  if (!hourly?.time) return new Map();

  const map = new Map();
  for (let i = 0; i < hourly.time.length; i++) {
    const time = hourly.time[i];
    const entry = {
      precipitation: hourly.precipitation?.[i] ?? 0,
      weatherCode: hourly.weather_code?.[i] ?? 0,
      airTempC: hourly.temperature_2m?.[i] ?? null,
      apparentTempC: hourly.apparent_temperature?.[i] ?? null,
      waterTempC: hourly.sea_surface_temperature?.[i] ?? hourly.soil_temperature_0cm?.[i] ?? null,
      waterTempSource: hourly.sea_surface_temperature?.[i] != null
        ? 'marine'
        : hourly.soil_temperature_0cm?.[i] != null
          ? 'estimated'
          : null,
      waveHeightM: hourly.wave_height?.[i] ?? null,
      waveSource: hourly.wave_height?.[i] != null ? 'marine' : null,
    };
    map.set(time, entry);
    map.set(time.slice(0, 16), entry);
  }
  return map;
}

/**
 * @param {string} time
 * @param {Map<string, object>} contextByTime
 */
function enrichHourWithContext(time, contextByTime) {
  const key = time.slice(0, 16);
  const ctx =
    contextByTime.get(time) ??
    contextByTime.get(key) ??
    contextByTime.get(`${key}:00`) ??
    {};
  return {
    precipitation: ctx.precipitation ?? 0,
    weatherCode: ctx.weatherCode ?? 0,
    airTempC: ctx.airTempC ?? null,
    apparentTempC: ctx.apparentTempC ?? null,
    waterTempC: ctx.waterTempC ?? null,
    waterTempSource: ctx.waterTempSource ?? null,
    waveHeightM: ctx.waveHeightM ?? null,
    waveSource: ctx.waveSource ?? null,
  };
}

module.exports = {
  isTempOk,
  buildTempSummary,
  buildContextByTime,
  enrichHourWithContext,
};
