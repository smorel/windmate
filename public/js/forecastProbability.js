/** Forecast confidence from model quorum (and provider probability when available). */
const WindmateForecastProbability = (() => {
  const PROBABILITY_BAND_COLORS = {
    low: '#c64e36',
    midLow: '#3d70b6',
    midHigh: '#8a4a90',
    high: '#60a059',
  };

  function colorForProbability(probability) {
    const p = Math.max(0, Math.min(1, Number(probability) || 0));
    if (p < 0.25) return PROBABILITY_BAND_COLORS.low;
    if (p < 0.5) return PROBABILITY_BAND_COLORS.midLow;
    if (p < 0.75) return PROBABILITY_BAND_COLORS.midHigh;
    return PROBABILITY_BAND_COLORS.high;
  }

  function indexModelsByHour(entry, dateStr, getModelDayHours) {
    const modelIds = Object.entries(entry.models ?? {})
      .filter(([, model]) => !model.error)
      .map(([id]) => id);

    return modelIds
      .map((modelId) => {
        const hours = getModelDayHours(entry, modelId, dateStr);
        if (!hours?.length) return null;
        const byKey = new Map();
        for (const hour of hours) {
          byKey.set(WindmateRideableWindow.hourTimeKey(hour.time), hour);
        }
        return byKey;
      })
      .filter(Boolean);
  }

  function hourModelAgreement(indexedByKey, key, options) {
    const today = options?.today;
    const now = options?.now ?? new Date();
    let reporting = 0;
    let rideable = 0;

    for (const byKey of indexedByKey) {
      const hour = byKey.get(key);
      if (!hour) continue;
      if (
        today &&
        WindmateForecastTime.isElapsedLocalDayHour(key, today, now) &&
        hour.windOk === false
      ) {
        continue;
      }
      reporting += 1;
      if (hour.rideable) rideable += 1;
    }

    if (reporting === 0) return null;
    return rideable / reporting;
  }

  function longestRideableSpanLength(hours, minWindowHours) {
    let best = 0;
    let current = 0;
    for (const hour of hours) {
      if (hour.rideable) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
    return best >= minWindowHours ? best : 0;
  }

  function modelQuorumProbability(entry, dateStr, prefs, getModelDayHours) {
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const models = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
    if (!models.length) return 1;

    let reporting = 0;
    let supporting = 0;

    for (const [modelId, model] of models) {
      const hours = getModelDayHours(entry, modelId, dateStr);
      const dayHours =
        hours?.length ? hours : model.days?.find((d) => d.date === dateStr)?.hours ?? [];
      if (!dayHours.length) continue;
      reporting += 1;
      if (longestRideableSpanLength(dayHours, minWindowHours) >= minWindowHours) {
        supporting += 1;
      }
    }

    if (reporting === 0) return 0;
    return supporting / reporting;
  }

  function normalizeMeteoProbability(raw) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return null;
    if (v > 1 && v <= 100) return v / 100;
    if (v <= 1) return v;
    return null;
  }

  function resolveHourMeteoProbability(hour) {
    if (hour == null) return null;
    return normalizeMeteoProbability(hour.forecastProbability);
  }

  function hasMeteoForecastProbability(hour) {
    return resolveHourMeteoProbability(hour) != null;
  }

  function sessionForecastProbability(entry, dateStr, prefs, getModelDayHours) {
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const consensusLen = WindmateRideableWindow.longestConsensusWindowLength(
      entry,
      dateStr,
      minWindowHours,
      getModelDayHours
    );
    if (consensusLen < minWindowHours) return 0;

    const models = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
    const meteoOnRideable = [];
    for (const [modelId] of models) {
      const hours = getModelDayHours(entry, modelId, dateStr) ?? [];
      for (const hour of hours) {
        if (!hour.rideable) continue;
        const p = resolveHourMeteoProbability(hour);
        if (p != null) meteoOnRideable.push(p);
      }
    }
    if (meteoOnRideable.length > 0) {
      return meteoOnRideable.reduce((sum, p) => sum + p, 0) / meteoOnRideable.length;
    }

    return modelQuorumProbability(entry, dateStr, prefs, getModelDayHours);
  }

  /** Meteo probability only (0 when absent). */
  function resolveHourForecastProbability(hour) {
    return resolveHourMeteoProbability(hour) ?? 0;
  }

  /** Matrix segment color: meteo when present, else model agreement (not a provider probability). */
  function resolveSegmentDisplayProbability(hour, slotAgreement) {
    const meteo = resolveHourMeteoProbability(hour);
    if (meteo != null) return meteo;
    const agreement = Number(slotAgreement);
    return Number.isFinite(agreement) ? agreement : 0;
  }

  function renderLegend() {
    const bands = [
      { label: '<25%', color: PROBABILITY_BAND_COLORS.low },
      { label: '25–50%', color: PROBABILITY_BAND_COLORS.midLow },
      { label: '50–75%', color: PROBABILITY_BAND_COLORS.midHigh },
      { label: '75%+', color: PROBABILITY_BAND_COLORS.high },
    ];
    const segments = bands
      .map(
        (band) =>
          `<span class="probability-legend-seg" style="background:${band.color}" title="${band.label}"></span>`
      )
      .join('');
    return `
      <div class="probability-legend">
        <span class="wind-legend-label">${WindmateCopy.matrix.probabilityLegend}</span>
        <div class="probability-legend-bar">${segments}</div>
      </div>`;
  }

  function maxSessionProbabilityForDay(spots, dateStr, prefs, getModelDayHours) {
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    let best = 0;

    for (const entry of spots ?? []) {
      const windowLen = WindmateRideableWindow.longestConsensusWindowLength(
        entry,
        dateStr,
        minWindowHours,
        getModelDayHours
      );
      if (windowLen < minWindowHours) continue;
      const probability = sessionForecastProbability(entry, dateStr, prefs, getModelDayHours);
      if (probability > best) best = probability;
    }

    return best;
  }

  return {
    colorForProbability,
    resolveHourForecastProbability,
    resolveHourMeteoProbability,
    hasMeteoForecastProbability,
    resolveSegmentDisplayProbability,
    renderLegend,
    sessionForecastProbability,
    maxSessionProbabilityForDay,
    hourModelAgreement,
    modelQuorumProbability,
    PROBABILITY_BAND_COLORS,
  };
})();
