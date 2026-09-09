const WINDY_URL = 'https://api.windy.com/api/point-forecast/v2';
const { degreesToCompass } = require('../utils/geo');

function getWindyModel(lat, lng) {
  const override = process.env.WINDY_MODEL;
  if (override) return override;
  if (lat >= 25 && lat <= 72 && lng >= -141 && lng <= -52) return 'canHrdps';
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return 'hrrrConus';
  return 'gfs';
}

function uvToSpeedDirection(u, v) {
  const speed = Math.sqrt(u * u + v * v);
  const directionDeg = (Math.atan2(u, v) * 180) / Math.PI + 180;
  return { speed, directionDeg: ((directionDeg % 360) + 360) % 360 };
}

async function fetchWindyObservations(lat, lng) {
  const apiKey = process.env.WINDY_API_KEY;
  if (!apiKey) {
    throw new Error('WINDY_API_KEY not configured');
  }

  const model = getWindyModel(lat, lng);
  const response = await fetch(WINDY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat,
      lon: lng,
      model,
      parameters: ['wind', 'windGust'],
      levels: ['surface'],
      key: apiKey,
    }),
  });

  if (!response.ok) {
    throw new Error(`Windy error: ${response.status}`);
  }

  const data = await response.json();
  const times = data.ts ?? [];
  const windU = data['wind_u-surface'] ?? [];
  const windV = data['wind_v-surface'] ?? [];
  const gusts = data['gust-surface'] ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const actual = [];

  let closestIdx = 0;
  let closestDelta = Infinity;

  for (let i = 0; i < times.length; i++) {
    const time = new Date(times[i]).toISOString();
    const localDate = time.slice(0, 10);
    const ts = new Date(times[i]).getTime();
    const delta = Math.abs(ts - now);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestIdx = i;
    }

    if (!localDate.startsWith(today) || ts > now) continue;

    const { speed, directionDeg } = uvToSpeedDirection(windU[i] ?? 0, windV[i] ?? 0);
    actual.push({
      time: time.slice(0, 16),
      windSpeed: speed,
      gusts: gusts[i] ?? speed,
      direction: degreesToCompass(directionDeg),
      directionDeg,
    });
  }

  const { speed, directionDeg } = uvToSpeedDirection(
    windU[closestIdx] ?? 0,
    windV[closestIdx] ?? 0
  );

  const current = {
    windSpeed: speed,
    gusts: gusts[closestIdx] ?? speed,
    direction: degreesToCompass(directionDeg),
    directionDeg,
    airTempC: null,
    waterTempC: null,
    observedAt: new Date(times[closestIdx]).toISOString(),
    source: 'windy',
  };

  return { current, actual, source: 'windy' };
}

module.exports = { fetchWindyObservations, getWindyModel };
