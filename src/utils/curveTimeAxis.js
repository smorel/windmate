const { hourTimeKey } = require('./rideableWindow');
const { parseForecastParts, formatForecastClock } = require('./forecastTime');

function fractionalHourSlotStart(isoTime) {
  const parts = parseForecastParts(isoTime);
  if (!parts) return null;
  return parts.h + parts.mi / 60;
}

function fractionalHourSlotCenter(isoTime) {
  const start = fractionalHourSlotStart(isoTime);
  if (start == null) return null;
  const parts = parseForecastParts(isoTime);
  return parts.mi === 0 ? start + 0.5 : start;
}

/** Matrix timeline: drop night blocks when daylight-only mode is on. */
function filterCurveDaylightHours(hours, hideNightHours) {
  if (!hideNightHours) return hours ?? [];
  return (hours ?? []).filter((hour) => hour?.daylightOk !== false);
}

/**
 * @param {{ slots: object[], padL: number, innerW: number, hideNightHours: boolean }} config
 */
function createCurveXScale({ slots, padL, innerW, hideNightHours }) {
  const n = Math.max(1, slots?.length ?? 0);

  if (!hideNightHours) {
    const xDay = (frac) => padL + (frac / 24) * innerW;
    return {
      mode: 'full-day',
      barWidth: innerW / 24,
      xForTime(time) {
        const center = fractionalHourSlotCenter(time);
        return center == null ? null : xDay(center);
      },
      xForSlotStart(time) {
        const start = fractionalHourSlotStart(time);
        return start == null ? null : xDay(start);
      },
      xForPlanningNow(nowFrac) {
        return xDay(nowFrac);
      },
      axisLabels() {
        return [
          { x: xDay(0.5), label: '00:00' },
          { x: xDay(12.5), label: '12:00' },
          { x: xDay(23.5), label: '23:00' },
        ];
      },
      hourFromClientX(localX) {
        const clamped = Math.max(padL, Math.min(padL + innerW, localX));
        return ((clamped - padL) / innerW) * 24;
      },
    };
  }

  const keys = slots.map((h) => hourTimeKey(h.time));
  const starts = slots.map((h) => fractionalHourSlotStart(h.time) ?? 0);

  const xAtSlot = (slotIndex, offsetInHour = 0.5) =>
    padL + ((slotIndex + offsetInHour) / n) * innerW;

  return {
    mode: 'daylight',
    barWidth: innerW / n,
    xForTime(time) {
      const idx = keys.indexOf(hourTimeKey(time));
      if (idx < 0) return null;
      return xAtSlot(idx, 0.5);
    },
    xForSlotStart(time) {
      const idx = keys.indexOf(hourTimeKey(time));
      if (idx < 0) return null;
      return padL + (idx / n) * innerW;
    },
    xForPlanningNow(nowFrac) {
      for (let i = 0; i < starts.length; i += 1) {
        const start = starts[i];
        if (nowFrac >= start && nowFrac < start + 1) {
          return xAtSlot(i, nowFrac - start);
        }
      }
      if (starts.length && nowFrac < starts[0]) return padL;
      return padL + innerW;
    },
    axisLabels() {
      if (!slots.length) return [];
      const labels = [
        { x: xAtSlot(0, 0.5), label: formatForecastClock(slots[0].time) },
      ];
      if (slots.length > 2) {
        const mid = Math.floor(slots.length / 2);
        labels.push({
          x: xAtSlot(mid, 0.5),
          label: formatForecastClock(slots[mid].time),
        });
      }
      if (slots.length > 1) {
        labels.push({
          x: xAtSlot(slots.length - 1, 0.5),
          label: formatForecastClock(slots[slots.length - 1].time),
        });
      }
      return labels;
    },
    hourFromClientX(localX) {
      const clamped = Math.max(padL, Math.min(padL + innerW, localX));
      const slotIndex = Math.min(n - 1, Math.floor(((clamped - padL) / innerW) * n));
      return starts[slotIndex] + 0.5;
    },
  };
}

module.exports = {
  fractionalHourSlotStart,
  fractionalHourSlotCenter,
  filterCurveDaylightHours,
  createCurveXScale,
};
