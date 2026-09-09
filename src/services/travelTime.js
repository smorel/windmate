const { haversineKm } = require('../utils/geo');
const { getTravelTimeCache, upsertTravelTimeCache } = require('../db');

const TRAVEL_CACHE_TTL_MS = parseInt(process.env.TRAVEL_CACHE_TTL_MS ?? '1800000', 10);
const HAVERSINE_SPEED_KMH = parseFloat(process.env.HAVERSINE_DRIVE_SPEED_KMH ?? '55');
const FUTURE_DEPARTURE_TTL_MS = 6 * 60 * 60 * 1000;

function roundCoord(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundDepartureBucket(isoTime) {
  const match = String(isoTime).match(/^(\d{4}-\d{2}-\d{2}T\d{2}):(\d{2})/);
  if (!match) return isoTime;
  const minutes = Math.floor(Number(match[2]) / 15) * 15;
  return `${match[1]}:${String(minutes).padStart(2, '0')}`;
}

function cacheKey(origin, dest, departureIso) {
  return {
    origin_lat: roundCoord(origin.lat),
    origin_lng: roundCoord(origin.lng),
    dest_lat: roundCoord(dest.lat),
    dest_lng: roundCoord(dest.lng),
    departure_bucket: roundDepartureBucket(departureIso),
  };
}

function cacheTtlMs(departureIso) {
  const departureMs = Date.parse(`${departureIso}:00`);
  if (Number.isNaN(departureMs)) return TRAVEL_CACHE_TTL_MS;
  const delta = departureMs - Date.now();
  return delta <= 24 * 60 * 60 * 1000 ? TRAVEL_CACHE_TTL_MS : FUTURE_DEPARTURE_TTL_MS;
}

function haversineDriveMinutes(origin, dest) {
  const distanceKm = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
  const minutes = Math.max(1, Math.round((distanceKm / HAVERSINE_SPEED_KMH) * 60));
  return {
    driveMinutes: minutes,
    distanceM: Math.round(distanceKm * 1000),
    routeSummary: null,
    source: 'haversine',
  };
}

function parseDurationSeconds(duration) {
  if (typeof duration === 'string' && duration.endsWith('s')) {
    return parseInt(duration.slice(0, -1), 10);
  }
  if (typeof duration === 'number') return duration;
  return null;
}

async function fetchGoogleDriveMinutes(origin, dest, departureIso) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const departureTime = `${departureIso}:00Z`;
  const body = {
    origin: {
      location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
    },
    destination: {
      location: { latLng: { latitude: dest.lat, longitude: dest.lng } },
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    departureTime,
  };

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.description',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Routes API ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) return null;

  const durationSeconds = parseDurationSeconds(route.duration);
  if (!durationSeconds) return null;

  return {
    driveMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    distanceM: route.distanceMeters ?? null,
    routeSummary: route.description ?? null,
    source: 'google',
  };
}

async function getDriveDuration(db, origin, dest, departureIso) {
  const key = cacheKey(origin, dest, departureIso);
  const cached = getTravelTimeCache(db, key);
  if (cached && Date.now() - cached.fetched_at < cacheTtlMs(departureIso)) {
    return {
      driveMinutes: Math.max(1, Math.round(cached.duration_seconds / 60)),
      distanceM: cached.distance_m,
      routeSummary: cached.route_summary,
      source: cached.source,
    };
  }

  let result = null;
  try {
    result = await fetchGoogleDriveMinutes(origin, dest, departureIso);
  } catch (err) {
    console.warn('[travelTime] Google Routes failed:', err.message);
  }

  if (!result) {
    result = haversineDriveMinutes(origin, dest);
  }

  upsertTravelTimeCache(db, {
    ...key,
    duration_seconds: result.driveMinutes * 60,
    distance_m: result.distanceM,
    route_summary: result.routeSummary,
    fetched_at: Date.now(),
    source: result.source,
  });

  return result;
}

function buildMapsUrl(origin, dest) {
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${dest.lat},${dest.lng}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

module.exports = {
  roundCoord,
  roundDepartureBucket,
  cacheKey,
  haversineDriveMinutes,
  getDriveDuration,
  buildMapsUrl,
};
