/**
 * Forecast vs actual go/no-go state machine for session day live strip.
 * @see docs/superpowers/specs/2026-09-08-realtime-wind-design.md#forecast-vs-actual-mismatch
 */

const CURRENT_DELTA_CAUTION_KT = 4;

/**
 * @param {object|null} current
 * @param {object[]} forecastHours today's analyzed forecast hours
 * @param {{ hoursCompared: number, avgDeltaKt: number|null, forecastRideableHours: number, actualRideableHours: number }} summary
 * @param {{ min_wind_knots: number, max_gust_knots: number }} prefs
 * @param {{ escalated?: boolean }} [options]
 */
function computeMismatch(current, forecastHours, summary, prefs, options = {}) {
  const escalated = Boolean(options.escalated);

  if (!current) {
    return {
      state: 'unknown',
      currentDeltaKt: null,
      severity: escalated ? 'high' : 'medium',
      messageKey: 'unknown',
    };
  }

  const currentDeltaKt = current.deltaKt ?? null;
  const nowHour = forecastHours.find((h) => {
    if (!current.observedAt) return false;
    return new Date(h.time).getHours() === new Date(current.observedAt).getHours();
  });

  const currentRideable = isHourRideable(current, nowHour, prefs);
  const forecastRideableNow = Boolean(nowHour?.rideable);
  const absDelta = currentDeltaKt != null ? Math.abs(currentDeltaKt) : 0;

  if (
    summary.forecastRideableHours > 0 &&
    summary.actualRideableHours === 0 &&
    current.windSpeed < prefs.min_wind_knots
  ) {
    return {
      state: 'no_go',
      currentDeltaKt,
      severity: escalated ? 'high' : 'high',
      messageKey: 'no_go',
    };
  }

  if (currentRideable) {
    return {
      state: 'go',
      currentDeltaKt,
      severity: 'low',
      messageKey: 'go',
    };
  }

  if (
    absDelta >= CURRENT_DELTA_CAUTION_KT ||
    (forecastRideableNow && !currentRideable)
  ) {
    return {
      state: 'caution',
      currentDeltaKt,
      severity: escalated ? 'high' : 'medium',
      messageKey: 'caution',
    };
  }

  if (summary.forecastRideableHours > 0 && summary.actualRideableHours === 0) {
    return {
      state: 'no_go',
      currentDeltaKt,
      severity: escalated ? 'high' : 'high',
      messageKey: 'no_go',
    };
  }

  return {
    state: currentRideable ? 'go' : 'caution',
    currentDeltaKt,
    severity: escalated ? 'high' : 'low',
    messageKey: currentRideable ? 'go' : 'caution',
  };
}

function isHourRideable(current, forecastHour, prefs) {
  const windOk =
    current.windSpeed >= prefs.min_wind_knots && current.gusts <= prefs.max_gust_knots;
  if (!windOk) return false;
  if (forecastHour) {
    return forecastHour.weatherOk && forecastHour.tempOk && !forecastHour.offshoreBlocked;
  }
  return true;
}

module.exports = { computeMismatch, CURRENT_DELTA_CAUTION_KT };
