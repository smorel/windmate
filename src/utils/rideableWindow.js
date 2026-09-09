const DEFAULT_MIN_RIDEABLE_WINDOW_HOURS = 2;
const MAX_MIN_RIDEABLE_WINDOW_HOURS = 24;

function hourTimeKey(time) {
  return String(time).replace(' ', 'T').slice(0, 16);
}

function parseMinRideableWindowHours(value, fallback = DEFAULT_MIN_RIDEABLE_WINDOW_HOURS) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, MAX_MIN_RIDEABLE_WINDOW_HOURS);
}

/** Longest consecutive rideable run that meets minConsecutive (timeline gaps break runs). */
function longestRideableWindow(hours, minConsecutive = 1) {
  const min = Math.max(1, minConsecutive);
  let best = 0;
  let current = 0;

  for (const hour of hours) {
    if (hour.rideable) {
      current += 1;
    } else {
      if (current >= min) best = Math.max(best, current);
      current = 0;
    }
  }

  if (current >= min) best = Math.max(best, current);
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
    const allRideable = indexed.every((byKey) => byKey.get(key)?.rideable === true);
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
      const allRideable = hourSets.every((hours) => hours[index].rideable === true);
      const key = hourTimeKey(hour.time);
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
      const allRideable = indexed.every((byKey) => byKey.get(key)?.rideable === true);
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
  parseMinRideableWindowHours,
  longestRideableWindow,
  markInRideableWindow,
  buildConsensusWindowMaps,
  buildConsensusWindowMapsForTimeline,
};
