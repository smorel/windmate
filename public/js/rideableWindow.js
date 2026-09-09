/** Consecutive rideable-hour window helpers for matrix display and ranking */
const WindmateRideableWindow = (() => {
  const DEFAULT_MIN_HOURS = 2;
  const MAX_MIN_HOURS = 24;

  function hourTimeKey(time) {
    return String(time).replace(' ', 'T').slice(0, 16);
  }

  function parseMinHours(value, fallback = DEFAULT_MIN_HOURS) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 1) return fallback;
    return Math.min(n, MAX_MIN_HOURS);
  }

  function longestWindow(hours, minConsecutive = 1) {
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

  function markHours(hours, minConsecutive = DEFAULT_MIN_HOURS) {
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

  /** Mark only hour slots in the longest qualifying consecutive runs (ties included). */
  function markLongestQualifyingWindows(hours, minConsecutive = DEFAULT_MIN_HOURS) {
    if (!hours?.length) return hours;

    const min = Math.max(1, minConsecutive);
    for (const hour of hours) hour.inRideableWindow = false;

    const runs = [];
    let runStart = -1;
    for (let i = 0; i <= hours.length; i++) {
      const rideable = i < hours.length && hours[i].rideable;
      if (rideable) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        const runLen = i - runStart;
        if (runLen >= min) runs.push({ start: runStart, end: i, len: runLen });
        runStart = -1;
      }
    }

    if (!runs.length) return hours;

    const bestLen = Math.max(...runs.map((run) => run.len));
    for (const run of runs) {
      if (run.len !== bestLen) continue;
      for (let j = run.start; j < run.end; j++) hours[j].inRideableWindow = true;
    }

    return hours;
  }

  function buildConsensusHours(entry, dateStr, getModelDayHours) {
    const modelIds = Object.entries(entry.models ?? {})
      .filter(([, model]) => !model.error)
      .map(([modelId]) => modelId);

    const timeline =
      getModelDayHours(entry, entry.primaryModel, dateStr) ||
      modelIds.map((modelId) => getModelDayHours(entry, modelId, dateStr)).find((hours) => hours?.length) ||
      [];

    if (!timeline.length || !modelIds.length) {
      return { timeline, consensusHours: [] };
    }

    const indexed = modelIds
      .map((modelId) => {
        const hours = getModelDayHours(entry, modelId, dateStr);
        if (!hours?.length) return null;
        const byKey = new Map();
        for (const hour of hours) byKey.set(hourTimeKey(hour.time), hour);
        return byKey;
      })
      .filter(Boolean);

    if (!indexed.length) {
      return { timeline, consensusHours: [] };
    }

    const consensusHours = timeline.map((slot) => {
      const key = hourTimeKey(slot.time);
      const allRideable = indexed.every((byKey) => byKey.get(key)?.rideable === true);
      return { time: key, rideable: allRideable };
    });

    return { timeline, consensusHours };
  }

  function longestConsensusWindowLength(entry, dateStr, minConsecutive, getModelDayHours) {
    const { timeline, consensusHours } = buildConsensusHours(entry, dateStr, getModelDayHours);
    if (!consensusHours.length) {
      const hours = timeline ?? [];
      return longestWindow(
        hours.map((hour) => ({ rideable: hour.rideable === true })),
        minConsecutive
      );
    }
    return longestWindow(consensusHours, minConsecutive);
  }

  function getLongestConsensusWindowHours(entry, dateStr, minConsecutive, getModelDayHours) {
    const { timeline, consensusHours } = buildConsensusHours(entry, dateStr, getModelDayHours);

    if (!timeline.length) return [];

    const marked = consensusHours.length
      ? consensusHours.map((hour) => ({ ...hour }))
      : timeline.map((hour) => ({
          time: hourTimeKey(hour.time),
          rideable: hour.rideable === true,
        }));

    markLongestQualifyingWindows(marked, minConsecutive);
    const windowKeys = new Set(
      marked.filter((hour) => hour.inRideableWindow).map((hour) => hour.time)
    );

    return timeline.filter((slot) => windowKeys.has(hourTimeKey(slot.time)));
  }

  /** Hours where every model with data agrees the hour is rideable. */
  function buildConsensusWindowMaps(modelHourLists, minConsecutive = DEFAULT_MIN_HOURS) {
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

    markHours(consensusHours, minConsecutive);
    const windowByTime = new Map(
      consensusHours.map((hour) => [hour.time, Boolean(hour.inRideableWindow)])
    );

    return { windowByTime, allModelsByTime };
  }

  function buildConsensusWindowMapsFromEntry(entry, dateStr, minConsecutive, getModelDayHours) {
    const { timeline, consensusHours } = buildConsensusHours(entry, dateStr, getModelDayHours);

    if (!consensusHours.length) {
      return buildSingleModelWindowMaps(timeline, minConsecutive);
    }

    const allModelsByTime = new Map(
      consensusHours.map((hour) => [hour.time, hour.rideable])
    );

    markLongestQualifyingWindows(consensusHours, minConsecutive);
    const windowByTime = new Map(
      consensusHours.map((hour) => [hour.time, Boolean(hour.inRideableWindow)])
    );

    return { windowByTime, allModelsByTime };
  }

  function alignModelHoursToTimeline(timelineHours, modelHours, windowMaps) {
    if (!timelineHours?.length) return [];
    const byKey = new Map(modelHours.map((hour) => [hourTimeKey(hour.time), hour]));

    return timelineHours.map((slot) => {
      const key = hourTimeKey(slot.time);
      const hour = byKey.get(key) ?? {
        time: slot.time,
        rideable: false,
        windSpeed: 0,
        gusts: 0,
        direction: '—',
      };

      return {
        ...hour,
        time: slot.time,
        allModelsRideable: allModelsRideableAt(hour, windowMaps),
        inRideableWindow: isInWindow(hour, windowMaps),
      };
    });
  }

  function buildSingleModelWindowMaps(hours, minConsecutive = DEFAULT_MIN_HOURS) {
    if (!hours?.length) {
      return { windowByTime: new Map(), allModelsByTime: new Map() };
    }

    const marked = hours.map((hour) => ({ ...hour }));
    markLongestQualifyingWindows(marked, minConsecutive);
    return {
      windowByTime: new Map(
        marked.map((hour) => [hourTimeKey(hour.time), Boolean(hour.inRideableWindow)])
      ),
      allModelsByTime: new Map(
        marked.map((hour) => [hourTimeKey(hour.time), Boolean(hour.rideable)])
      ),
    };
  }

  function isInWindow(hour, windowMaps) {
    if (!hour?.rideable || !windowMaps?.windowByTime) return false;
    return Boolean(windowMaps.windowByTime.get(hourTimeKey(hour.time)));
  }

  function allModelsRideableAt(hour, windowMaps) {
    if (!windowMaps?.allModelsByTime) return hour?.rideable ?? false;
    const key = hourTimeKey(hour.time);
    if (windowMaps.allModelsByTime.has(key)) {
      return windowMaps.allModelsByTime.get(key);
    }
    return hour?.rideable ?? false;
  }

  return {
    DEFAULT_MIN_HOURS,
    hourTimeKey,
    parseMinHours,
    longestWindow,
    markHours,
    markLongestQualifyingWindows,
    buildConsensusHours,
    longestConsensusWindowLength,
    getLongestConsensusWindowHours,
    buildConsensusWindowMaps,
    buildConsensusWindowMapsFromEntry,
    buildSingleModelWindowMaps,
    alignModelHoursToTimeline,
    isInWindow,
    allModelsRideableAt,
  };
})();
