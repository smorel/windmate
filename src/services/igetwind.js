const IGETWIND_BASE = process.env.IGETWIND_BASE_URL ?? 'https://igetwind.com';
const MS_TO_KNOTS = 1.94384;
const STATION_MAX_DISTANCE_KM = parseFloat(process.env.STATION_MAX_DISTANCE_KM ?? '15');

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const { haversineKm, degreesToCompass } = require('../utils/geo');
const { normalizeHourlyTimestamp } = require('../utils/forecastTime');
const { normalizeMeteoProbability } = require('../utils/forecastProbabilityHour');

/** @returns {Promise<{ spots: object[] }>} */
async function fetchAllSpots() {
  const response = await fetch(`${IGETWIND_BASE}/api/spots`, { headers: JSON_HEADERS });
  if (!response.ok) {
    throw new Error(`iGetwind spots error: ${response.status}`);
  }
  return response.json();
}

/**
 * @param {number} lat
 * @param {number} lng
 */
async function fetchNearestSpot(lat, lng) {
  const response = await fetch(`${IGETWIND_BASE}/api/spotnear/${lat}/${lng}`, {
    headers: JSON_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`iGetwind spotnear error: ${response.status}`);
  }
  const data = await response.json();
  return data?._id ? data : null;
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} model
 */
async function fetchModelForecast(lat, lng, model) {
  const response = await fetch(
    `${IGETWIND_BASE}/api/position/${model.toLowerCase()}/${lat}/${lng}`,
    { headers: JSON_HEADERS }
  );
  if (!response.ok) {
    throw new Error(`iGetwind ${model} error: ${response.status}`);
  }
  const payload = await response.json();
  const key = model.toUpperCase();
  const block = payload[key] ?? payload[model.toLowerCase()] ?? Object.values(payload)[0];
  if (!block?.winddata) {
    throw new Error(`iGetwind ${model} missing winddata`);
  }
  return block;
}

function createHourSlot() {
  return {
    wind: 0,
    gust: 0,
    direction: 0,
    windProb: null,
    hasWind: false,
    hasGust: false,
    hasDirection: false,
  };
}

function lerpAngleDeg(fromDeg, toDeg, t) {
  const delta = ((toDeg - fromDeg + 540) % 360) - 180;
  return ((fromDeg + delta * t + 360) % 360);
}

/** iGetwind leaves direction at 0 when WDIR is missing (not a real north wind). */
function isPlaceholderDirection(directionDeg, windSpeed) {
  return (windSpeed ?? 0) > 0 && (directionDeg ?? 0) === 0;
}

function fillDirectionGaps(directions, hasDirection) {
  const n = directions.length;
  const out = directions.map((d) => d ?? 0);
  const known = hasDirection.map(Boolean);

  for (let i = 0; i < n; i += 1) {
    if (known[i]) continue;

    let prev = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (known[j]) {
        prev = j;
        break;
      }
    }
    let next = -1;
    for (let k = i + 1; k < n; k += 1) {
      if (known[k]) {
        next = k;
        break;
      }
    }

    if (prev >= 0 && next >= 0) {
      const t = (i - prev) / (next - prev);
      out[i] = lerpAngleDeg(out[prev], out[next], t);
    } else if (prev >= 0) {
      out[i] = out[prev];
    } else if (next >= 0) {
      out[i] = out[next];
    }
  }

  return out;
}

/** Repair cached or legacy hourly rows (placeholder 0° direction, odd timestamps). */
function repairIgetwindHourly(hourly) {
  if (!hourly?.time?.length) return hourly;

  const winds = hourly.wind_speed_10m ?? [];
  const dirs = hourly.wind_direction_10m ?? [];
  const hasDirection = dirs.map((d, i) => !isPlaceholderDirection(d, winds[i]));

  return {
    ...hourly,
    time: hourly.time.map((t) => normalizeHourlyTimestamp(t)),
    wind_direction_10m: fillDirectionGaps(dirs, hasDirection),
  };
}

/** Fill gaps where iGetwind emitted direction/probability without WIND/GUST (avoids false 0 kt). */
function dropOrFillMissingWindSamples(byTime, times) {
  const kept = [];

  for (let i = 0; i < times.length; i += 1) {
    const key = times[i];
    const hour = byTime.get(key);

    if (!hour.hasWind) {
      let prev = -1;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (byTime.get(times[j]).hasWind) {
          prev = j;
          break;
        }
      }
      let next = -1;
      for (let k = i + 1; k < times.length; k += 1) {
        if (byTime.get(times[k]).hasWind) {
          next = k;
          break;
        }
      }

      if (prev < 0 && next < 0) {
        byTime.delete(key);
        continue;
      }

      if (prev >= 0 && next >= 0) {
        const t = (i - prev) / (next - prev);
        const a = byTime.get(times[prev]);
        const b = byTime.get(times[next]);
        hour.wind = a.wind + t * (b.wind - a.wind);
      } else if (prev >= 0) {
        hour.wind = byTime.get(times[prev]).wind;
      } else {
        hour.wind = byTime.get(times[next]).wind;
      }
    }

    if (!hour.hasGust) {
      let prev = -1;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (byTime.get(times[j]).hasGust) {
          prev = j;
          break;
        }
      }
      let next = -1;
      for (let k = i + 1; k < times.length; k += 1) {
        if (byTime.get(times[k]).hasGust) {
          next = k;
          break;
        }
      }

      if (prev >= 0 && next >= 0) {
        const t = (i - prev) / (next - prev);
        const a = byTime.get(times[prev]);
        const b = byTime.get(times[next]);
        hour.gust = a.gust + t * (b.gust - a.gust);
      } else if (prev >= 0) {
        hour.gust = byTime.get(times[prev]).gust;
      } else if (next >= 0) {
        hour.gust = byTime.get(times[next]).gust;
      } else {
        hour.gust = hour.wind;
      }
    }

    if (!hour.hasDirection) {
      let prev = -1;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (byTime.get(times[j]).hasDirection) {
          prev = j;
          break;
        }
      }
      let next = -1;
      for (let k = i + 1; k < times.length; k += 1) {
        if (byTime.get(times[k]).hasDirection) {
          next = k;
          break;
        }
      }

      if (prev >= 0 && next >= 0) {
        const t = (i - prev) / (next - prev);
        const a = byTime.get(times[prev]).direction;
        const b = byTime.get(times[next]).direction;
        hour.direction = lerpAngleDeg(a, b, t);
      } else if (prev >= 0) {
        hour.direction = byTime.get(times[prev]).direction;
      } else if (next >= 0) {
        hour.direction = byTime.get(times[next]).direction;
      }
    }

    kept.push(key);
  }

  return kept;
}

/**
 * @param {{ winddata: { ty: string, t: string, v: number }[] }} modelBlock
 * @param {string} modelId
 */
function buildApcpIncrementsByTime(winddata) {
  const cumulative = new Map();
  for (const row of winddata ?? []) {
    if (row.ty !== 'APCP') continue;
    cumulative.set(row.t.replace(' ', 'T'), row.v);
  }
  if (!cumulative.size) return null;

  const sorted = [...cumulative.keys()].sort();
  const increments = new Map();
  let prev = null;
  for (const iso of sorted) {
    const value = cumulative.get(iso);
    const increment = prev == null ? 0 : Math.max(0, value - prev);
    increments.set(normalizeHourlyTimestamp(iso), increment);
    prev = value;
  }
  return increments;
}

function normalizeWindData(modelBlock, modelId) {
  const byTime = new Map();

  for (const row of modelBlock.winddata) {
    const iso = row.t.replace(' ', 'T');
    if (row.ty === 'WINDP') {
      if (!byTime.has(iso)) continue;
      const prob = normalizeMeteoProbability(row.v);
      if (prob != null) byTime.get(iso).windProb = prob;
      continue;
    }
    if (!byTime.has(iso)) {
      byTime.set(iso, createHourSlot());
    }
    const hour = byTime.get(iso);
    if (row.ty === 'WIND') {
      hour.wind = Math.max(hour.wind, row.v * MS_TO_KNOTS);
      hour.hasWind = true;
    } else if (row.ty === 'GUST') {
      hour.gust = Math.max(hour.gust, row.v * MS_TO_KNOTS);
      hour.hasGust = true;
    } else if (row.ty === 'WDIR') {
      hour.direction = row.v;
      hour.hasDirection = true;
    }
  }

  const sortedTimes = [...byTime.keys()].sort();
  const times = dropOrFillMissingWindSamples(byTime, sortedTimes);
  const hasWindProbability = times.some((t) => byTime.get(t).windProb != null);
  const hourly = {
    time: times.map((t) => normalizeHourlyTimestamp(t)),
    wind_speed_10m: times.map((t) => byTime.get(t).wind),
    wind_gusts_10m: times.map((t) => byTime.get(t).gust || byTime.get(t).wind),
    wind_direction_10m: times.map((t) => byTime.get(t).direction),
  };
  if (hasWindProbability) {
    hourly.wind_probability_10m = times.map((t) => byTime.get(t).windProb);
  }

  const apcpIncrements = buildApcpIncrementsByTime(modelBlock.winddata);
  if (apcpIncrements) {
    hourly.precipitation = times.map((t) => {
      const key = normalizeHourlyTimestamp(t);
      if (!apcpIncrements.has(key)) return null;
      return apcpIncrements.get(key);
    });
  }

  return {
    hourly,
    provider: 'igetwind',
    model: modelId,
  };
}

function spotProfileUrl(uname) {
  return `${IGETWIND_BASE}/spots#${uname}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try iGetwind wx station endpoints; returns null when unavailable or out of range.
 * @param {number} lat
 * @param {number} lng
 */
async function fetchNearestStation(lat, lng) {
  const candidates = ['wxstationnear', 'stationsnear', 'wxnear'];
  for (const path of candidates) {
    try {
      const response = await fetch(`${IGETWIND_BASE}/api/${path}/${lat}/${lng}`, {
        headers: JSON_HEADERS,
      });
      if (!response.ok) continue;

      const text = await response.text();
      if (!text.startsWith('{')) continue;

      const data = JSON.parse(text);
      const station = parseStationPayload(data, lat, lng);
      if (station && station.distance_km <= STATION_MAX_DISTANCE_KM) {
        return station;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function parseStationPayload(data, spotLat, spotLng) {
  const lat = data.geo?.lat ?? data.latitude ?? data.lat;
  const lng = data.geo?.long ?? data.geo?.lng ?? data.longitude ?? data.lng;
  if (lat == null || lng == null) return null;

  const distance_km = data.distance ?? haversineKm(spotLat, spotLng, lat, lng);
  const windMs = data.wind ?? data.windSpeed ?? data.speed ?? data.w ?? 0;
  const gustMs = data.gust ?? data.gustSpeed ?? data.g ?? windMs;
  const dirDeg = data.wdir ?? data.direction ?? data.windDirection ?? 0;
  const observedAt = data.updatedAt ?? data.observedAt ?? data.t ?? new Date().toISOString();

  if (!windMs && !data.winddata) return null;

  return {
    windSpeed: typeof windMs === 'number' && windMs < 50 ? windMs * MS_TO_KNOTS : windMs,
    gusts: typeof gustMs === 'number' && gustMs < 50 ? gustMs * MS_TO_KNOTS : gustMs,
    direction: degreesToCompass(dirDeg),
    directionDeg: dirDeg,
    airTempC: data.temp ?? data.temperature ?? null,
    waterTempC: null,
    observedAt: typeof observedAt === 'string' ? observedAt : new Date(observedAt).toISOString(),
    source: 'station',
    stationName: data.name ?? data.stationName ?? 'Wx station',
    stationDistance_km: typeof distance_km === 'number' ? distance_km : haversineKm(spotLat, spotLng, lat, lng),
  };
}

module.exports = {
  fetchAllSpots,
  fetchNearestSpot,
  fetchNearestStation,
  fetchModelForecast,
  normalizeWindData,
  repairIgetwindHourly,
  isPlaceholderDirection,
  spotProfileUrl,
  delay,
  IGETWIND_BASE,
  STATION_MAX_DISTANCE_KM,
};
