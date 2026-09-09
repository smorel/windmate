const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const { degreesToCompass } = require('../utils/geo');

async function fetchOpenMeteoObservations(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m',
    hourly: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    past_hours: '24',
    wind_speed_unit: 'kn',
    timezone: 'auto',
    forecast_days: '1',
  });

  const response = await fetch(`${OPEN_METEO_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo observations error: ${response.status}`);
  }

  const data = await response.json();
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  const actual = [];
  if (data.hourly?.time) {
    for (let i = 0; i < data.hourly.time.length; i++) {
      const time = data.hourly.time[i];
      if (!time.startsWith(today)) continue;
      const hourDate = new Date(time);
      if (hourDate.getTime() > now) continue;
      actual.push({
        time,
        windSpeed: data.hourly.wind_speed_10m[i] ?? 0,
        gusts: data.hourly.wind_gusts_10m[i] ?? 0,
        direction: degreesToCompass(data.hourly.wind_direction_10m[i] ?? 0),
        directionDeg: data.hourly.wind_direction_10m[i] ?? 0,
      });
    }
  }

  let current = null;
  if (data.current) {
    const observedAt = data.current.time ?? new Date().toISOString();
    current = {
      windSpeed: data.current.wind_speed_10m ?? 0,
      gusts: data.current.wind_gusts_10m ?? 0,
      direction: degreesToCompass(data.current.wind_direction_10m ?? 0),
      directionDeg: data.current.wind_direction_10m ?? 0,
      airTempC: data.current.temperature_2m ?? null,
      waterTempC: null,
      observedAt,
      source: 'open-meteo',
    };
  }

  return { current, actual, source: 'open-meteo' };
}

module.exports = { fetchOpenMeteoObservations };
