const { hourTimeKey } = require('./rideableWindow');

const DEFAULT_MODEL_PRIORITY = [
  'gfs',
  'open-meteo',
  'hrrr',
  'lam',
  'nam5',
  'nam12',
  'ecmwf9',
  'icon',
];

function modelPriorityOrder(entry) {
  const models = entry.models ?? {};
  return [
    entry.primaryModel,
    ...DEFAULT_MODEL_PRIORITY,
    ...Object.keys(models),
  ].filter(Boolean);
}

/**
 * Union of hourly slots for a calendar day across models.
 * Per slot, prefer primary then fallback models (LAM may only cover overnight on day 7).
 */
function buildUnionDayTimelineHours(entry, dateStr, getModelDayHours) {
  const models = entry.models ?? {};
  const modelIds = Object.keys(models).filter((id) => !models[id]?.error);
  if (!modelIds.length) {
    const day = (entry.days ?? []).find((d) => d.date === dateStr);
    return day?.hours ?? [];
  }

  const byModel = new Map();
  const timeKeys = new Set();

  for (const modelId of modelIds) {
    const hours = getModelDayHours(entry, modelId, dateStr) ?? [];
    if (!hours.length) continue;
    const map = new Map();
    for (const hour of hours) {
      const key = hourTimeKey(hour.time);
      if (!key.startsWith(dateStr)) continue;
      map.set(key, hour);
      timeKeys.add(key);
    }
    if (map.size) byModel.set(modelId, map);
  }

  if (!timeKeys.size) {
    const day = (entry.days ?? []).find((d) => d.date === dateStr);
    return day?.hours ?? [];
  }

  const sorted = [...timeKeys].sort();
  const preference = [
    ...new Set(modelPriorityOrder(entry).filter((id) => byModel.has(id))),
  ];
  const pickOrder = preference.length ? preference : [...byModel.keys()];

  return sorted.map((key) => {
    for (const modelId of pickOrder) {
      const hour = byModel.get(modelId)?.get(key);
      if (hour) return hour;
    }
    for (const map of byModel.values()) {
      const hour = map.get(key);
      if (hour) return hour;
    }
    return { time: key };
  });
}

module.exports = {
  buildUnionDayTimelineHours,
  modelPriorityOrder,
};
