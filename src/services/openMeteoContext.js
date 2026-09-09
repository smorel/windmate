const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const CONTEXT_CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchMarineHourly(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'sea_surface_temperature,wave_height,wind_wave_height',
    timezone: 'auto',
    forecast_days: '7',
  });

  try {
    const response = await fetch(`${MARINE_URL}?${params}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.hourly ?? null;
  } catch {
    return null;
  }
}

async function fetchOpenMeteoContextRaw(spot) {
  const params = new URLSearchParams({
    latitude: String(spot.latitude),
    longitude: String(spot.longitude),
    hourly: [
      'wind_speed_10m',
      'wind_gusts_10m',
      'wind_direction_10m',
      'precipitation',
      'weather_code',
      'temperature_2m',
      'apparent_temperature',
      'soil_temperature_0cm',
    ].join(','),
    current: [
      'wind_speed_10m',
      'wind_gusts_10m',
      'wind_direction_10m',
      'precipitation',
      'weather_code',
      'temperature_2m',
    ].join(','),
    wind_speed_unit: 'kn',
    cell_selection: 'sea',
    timezone: 'auto',
    forecast_days: '7',
  });

  const response = await fetch(`${OPEN_METEO_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo context error: ${response.status}`);
  }

  const data = await response.json();
  const marine = await fetchMarineHourly(spot.latitude, spot.longitude);
  if (marine?.time && data.hourly?.time) {
    const byTime = new Map(marine.time.map((t, i) => [t, i]));
    data.hourly.sea_surface_temperature = data.hourly.time.map((t) => {
      const i = byTime.get(t);
      return i != null ? marine.sea_surface_temperature?.[i] ?? null : null;
    });
    data.hourly.wave_height = data.hourly.time.map((t) => {
      const i = byTime.get(t);
      if (i == null) return null;
      return marine.wave_height?.[i] ?? marine.wind_wave_height?.[i] ?? null;
    });
  }

  return data;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} spotId
 * @param {{ latitude: number, longitude: number }} spot
 */
async function fetchOpenMeteoContext(db, spotId, spot) {
  const cached = db.prepare(
    'SELECT fetched_at, data FROM context_cache WHERE spot_id = ?'
  ).get(spotId);

  if (cached && Date.now() - cached.fetched_at < CONTEXT_CACHE_TTL_MS) {
    return JSON.parse(cached.data);
  }

  try {
    const data = await fetchOpenMeteoContextRaw(spot);
    db.prepare(`
      INSERT INTO context_cache (spot_id, fetched_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(spot_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data
    `).run(spotId, Date.now(), JSON.stringify(data));
    return data;
  } catch (err) {
    if (cached) {
      return { ...JSON.parse(cached.data), stale: true };
    }
    throw err;
  }
}

module.exports = {
  fetchOpenMeteoContext,
  fetchOpenMeteoContextRaw,
  CONTEXT_CACHE_TTL_MS,
};
