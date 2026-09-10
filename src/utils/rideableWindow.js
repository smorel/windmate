const DEFAULT_MIN_RIDEABLE_WINDOW_HOURS = 2;
const MAX_MIN_RIDEABLE_WINDOW_HOURS = 24;

const { isElapsedLocalDayHour } = require('./forecastTime');

function hourTimeKey(time) {
  return String(time).replace(' ', 'T').slice(0, 16);
}

function hourKeyToMs(key) {
  const normalized = String(key).replace(' ', 'T');
  const iso = normalized.length === 16 ? `${normalized}:00` : normalized;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

function nearestHourToleranceMs(modelHours) {
  if (!modelHours?.length) return 0;
  if (modelHours.length === 1) return 60 * 60 * 1000;

  const gaps = [];
  for (let i = 1; i < modelHours.length; i += 1) {
    const a = hourKeyToMs(hourTimeKey(modelHours[i - 1].time));
    const b = hourKeyToMs(hourTimeKey(modelHours[i].time));
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) gaps.push(b - a);
  }
  if (!gaps.length) return 60 * 60 * 1000;

  gaps.sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(median / 2, 30 * 60 * 1000);
}

function findNearestModelHour(modelHours, timelineKey, maxOffsetMs, options = {}) {
  if (!modelHours?.length) return null;
  const target = hourKeyToMs(timelineKey);
  if (!Number.isFinite(target)) return null;

  const rideableOnly = options.rideableOnly === true;
  const tolerance = maxOffsetMs ?? nearestHourToleranceMs(modelHours);
  let best = null;
  let bestDelta = Infinity;

  for (const hour of modelHours) {
    if (rideableOnly && !hour.rideable) continue;
    const ms = hourKeyToMs(hourTimeKey(hour.time));
    if (!Number.isFinite(ms)) continue;
    const delta = Math.abs(ms - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = hour;
    }
  }

  if (!best || bestDelta > tolerance) return null;
  const exact = hourTimeKey(best.time) === hourTimeKey(timelineKey);
  return { hour: best, inferred: !exact };
}

function resolveModelHourAtTimeline(modelHours, timelineKey, options = {}) {
  const rideableOnly = options.rideableOnly === true;
  const byKey = new Map();
  for (const hour of modelHours ?? []) byKey.set(hourTimeKey(hour.time), hour);
  const key = hourTimeKey(timelineKey);
  const exact = byKey.get(key);
  if (exact) {
    if (rideableOnly && !exact.rideable) return null;
    return exact;
  }
  return findNearestModelHour(modelHours, key, undefined, { rideableOnly })?.hour ?? null;
}

/**
 * True when every model that still reports this hour marks it rideable.
 * Missing data is ignored. For elapsed hours on `options.today`, models with
 * wind/gust below user thresholds are ignored (retrospective model downgrades).
 */
function allReportingModelsRideable(indexedByKey, key, options) {
  const today = options?.today;
  const now = options?.now ?? new Date();
  let reporting = 0;
  for (const byKey of indexedByKey) {
    const hour = byKey.get(key);
    if (!hour) continue;
    if (today && isElapsedLocalDayHour(key, today, now) && hour.windOk === false) {
      continue;
    }
    reporting += 1;
    if (!hour.rideable) return false;
  }
  if (reporting === 0) return false;
  if (today && isElapsedLocalDayHour(key, today, now)) return false;
  return true;
}

function parseMinRideableWindowHours(value, fallback = DEFAULT_MIN_RIDEABLE_WINDOW_HOURS) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, MAX_MIN_RIDEABLE_WINDOW_HOURS);
}

/** Longest consecutive rideable run that meets minConsecutive (timeline gaps break runs). */
function longestRideableWindow(hours, minConsecutive = 1) {
  return longestRideableWindowSpan(hours, minConsecutive).length;
}

function longestRideableWindowSpan(hours, minConsecutive = 1) {
  const min = Math.max(1, minConsecutive);
  let best = { length: 0, start: null, end: null };
  let current = 0;
  let runStart = null;
  let runEnd = null;

  for (const hour of hours) {
    if (hour.rideable) {
      if (current === 0) runStart = hour.time;
      current += 1;
      runEnd = hour.time;
    } else if (current > 0) {
      if (current >= min && current > best.length) {
        best = { length: current, start: runStart, end: runEnd };
      }
      current = 0;
      runStart = null;
      runEnd = null;
    }
  }

  if (current >= min && current > best.length) {
    best = { length: current, start: runStart, end: runEnd };
  }

  return best;
}

/** Sets inRideableWindow on each hour (mutates objects in place). */
function markInRideableWindow(hours, minConsecutive = DEFAULT_MIN_RIDEABLE_WINDOW_HOURS) {
  if (!hours?.length) return hours;

  const min = Math.max(1, minConsecutive);
  for (const hour of hours) hour.inRideableWindow = false;

  if (min <= 1) {
    for (const hour of hours) {
      if (hour.rideable) hour.inRideableWindow = true;
    }
    return hours;
  }

  let runStart = -1;
  for (let i = 0; i <= hours.length; i++) {
    const rideable = i < hours.length && hours[i].rideable;
    if (rideable) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const runLen = i - runStart;
      if (runLen >= min) {
        for (let j = runStart; j < i; j++) hours[j].inRideableWindow = true;
      }
      runStart = -1;
    }
  }

  return hours;
}

function buildConsensusWindowMapsForTimeline(timelineHours, modelHourLists, minConsecutive = DEFAULT_MIN_RIDEABLE_WINDOW_HOURS) {
  if (!timelineHours?.length || !modelHourLists?.length) {
    return { windowByTime: new Map(), allModelsByTime: new Map() };
  }

  const indexed = modelHourLists
    .filter((hours) => hours?.length)
    .map((hours) => {
      const byKey = new Map();
      for (const hour of hours) byKey.set(hourTimeKey(hour.time), hour);
      return byKey;
    });

  if (!indexed.length) {
    return { windowByTime: new Map(), allModelsByTime: new Map() };
  }

  const allModelsByTime = new Map();
  const consensusHours = timelineHours.map((slot) => {
    const key = hourTimeKey(slot.time);
    const allRideable = allReportingModelsRideable(indexed, key);
    allModelsByTime.set(key, allRideable);
    return { time: key, rideable: allRideable };
  });

  markInRideableWindow(consensusHours, minConsecutive);
  const windowByTime = new Map(
    consensusHours.map((hour) => [hour.time, Boolean(hour.inRideableWindow)])
  );

  return { windowByTime, allModelsByTime };
}

function buildConsensusWindowMaps(modelHourLists, minConsecutive = DEFAULT_MIN_RIDEABLE_WINDOW_HOURS) {
  const hourSets = modelHourLists.filter((hours) => hours?.length);
  if (!hourSets.length) {
    return { windowByTime: new Map(), allModelsByTime: new Map() };
  }

  const allModelsByTime = new Map();
  const baseLen = hourSets[0].length;
  const alignedByIndex = hourSets.every((hours) => hours.length === baseLen);
  let consensusHours;

  if (alignedByIndex) {
    consensusHours = hourSets[0].map((hour, index) => {
      const key = hourTimeKey(hour.time);
      const reporting = hourSets
        .map((hours) => hours[index])
        .filter((slot) => slot && hourTimeKey(slot.time) === key);
      const allRideable =
        reporting.length > 0 && reporting.every((slot) => slot.rideable === true);
      allModelsByTime.set(key, allRideable);
      return { time: key, rideable: allRideable };
    });
  } else {
    const indexed = hourSets.map((hours) => {
      const byKey = new Map();
      for (const hour of hours) byKey.set(hourTimeKey(hour.time), hour);
      return byKey;
    });
    const timeline = [
      ...new Set(hourSets.flatMap((hours) => hours.map((hour) => hourTimeKey(hour.time)))),
    ].sort();

    consensusHours = timeline.map((key) => {
      const allRideable = allReportingModelsRideable(indexed, key);
      allModelsByTime.set(key, allRideable);
      return { time: key, rideable: allRideable };
    });
  }

  markInRideableWindow(consensusHours, minConsecutive);
  const windowByTime = new Map(
    consensusHours.map((hour) => [hour.time, Boolean(hour.inRideableWindow)])
  );

  return { windowByTime, allModelsByTime };
}

module.exports = {
  DEFAULT_MIN_RIDEABLE_WINDOW_HOURS,
  MAX_MIN_RIDEABLE_WINDOW_HOURS,
  hourTimeKey,
  nearestHourToleranceMs,
  findNearestModelHour,
  resolveModelHourAtTimeline,
  allReportingModelsRideable,
  parseMinRideableWindowHours,
  longestRideableWindow,
  longestRideableWindowSpan,
  markInRideableWindow,
  buildConsensusWindowMaps,
  buildConsensusWindowMapsForTimeline,
};
