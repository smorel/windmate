const { hourTimeKey } = require('../utils/rideableWindow');
const { localDateString, currentLocalHourStartKey } = require('../utils/forecastTime');

function mergeHourlySeries(prevHourly, nextHourly, today, cutoverKey) {
  if (!nextHourly?.time?.length) return nextHourly;
  if (!prevHourly?.time?.length) return nextHourly;

  const prevByKey = new Map();
  for (let i = 0; i < prevHourly.time.length; i += 1) {
    const key = hourTimeKey(prevHourly.time[i]);
    prevByKey.set(key, {
      wind: prevHourly.wind_speed_10m[i] ?? 0,
      gust: prevHourly.wind_gusts_10m[i] ?? 0,
      dir: prevHourly.wind_direction_10m[i] ?? 0,
    });
  }

  const wind_speed_10m = [];
  const wind_gusts_10m = [];
  const wind_direction_10m = [];

  for (let i = 0; i < nextHourly.time.length; i += 1) {
    const t = nextHourly.time[i];
    const key = hourTimeKey(t);
    const nextWind = nextHourly.wind_speed_10m[i] ?? 0;
    const nextGust = nextHourly.wind_gusts_10m[i] ?? nextWind;
    const nextDir = nextHourly.wind_direction_10m[i] ?? 0;

    if (String(t).slice(0, 10) === today && key < cutoverKey) {
      const prev = prevByKey.get(key);
      if (prev) {
        wind_speed_10m.push(Math.max(prev.wind, nextWind));
        wind_gusts_10m.push(Math.max(prev.gust, nextGust));
        wind_direction_10m.push(nextDir || prev.dir);
        continue;
      }
    }

    wind_speed_10m.push(nextWind);
    wind_gusts_10m.push(nextGust);
    wind_direction_10m.push(nextDir);
  }

  return {
    ...nextHourly,
    time: nextHourly.time,
    wind_speed_10m,
    wind_gusts_10m,
    wind_direction_10m,
  };
}

/** Keep the strongest wind/gust seen today for hours that already started (stabilizes rideability). */
function mergeForecastElapsedToday(previous, next, now = new Date()) {
  if (!previous || !next) return next;

  const today = localDateString(now);
  const cutoverKey = currentLocalHourStartKey(now);

  if (next.models) {
    const models = { ...next.models };
    for (const modelId of Object.keys(models)) {
      const nextModel = models[modelId];
      if (!nextModel?.hourly) continue;
      const prevModel = previous.models?.[modelId];
      models[modelId] = {
        ...nextModel,
        hourly: mergeHourlySeries(prevModel?.hourly, nextModel.hourly, today, cutoverKey),
      };
    }
    return { ...next, models };
  }

  if (next.hourly) {
    return {
      ...next,
      hourly: mergeHourlySeries(previous.hourly, next.hourly, today, cutoverKey),
    };
  }

  return next;
}

module.exports = { mergeForecastElapsedToday, mergeHourlySeries };
