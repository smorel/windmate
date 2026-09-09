/**
 * Windmate copy — written tone only. Wind personified as your mate.
 */

function formatTempLine(window) {
  const parts = [];
  if (window.airTempMin != null) {
    const range =
      window.airTempMax != null && window.airTempMax !== window.airTempMin
        ? `${window.airTempMin}–${window.airTempMax}`
        : `${window.airTempMin}`;
    parts.push(`${range}°C air`);
  }
  if (window.waterTempMin != null) {
    const range =
      window.waterTempMax != null && window.waterTempMax !== window.waterTempMin
        ? `${window.waterTempMin}–${window.waterTempMax}`
        : `${window.waterTempMin}`;
    parts.push(`${range}°C water`);
  }
  return parts.length ? `\n${parts.join(' / ')}.` : '';
}

function formatWarningLine(warning) {
  return `\n\n⚠️ ${warning.message}`;
}

/**
 * @param {string} spotName
 * @param {{ startHour: string, endHour: string, maxWind: number, direction: string, airTempMin?: number|null, airTempMax?: number|null, waterTempMin?: number|null, waterTempMax?: number|null, warning?: object|null }} window
 */
function formatRideAlert(spotName, window) {
  const subject = `Mate, ${spotName} is on today 🌬️`;
  const tempLine = formatTempLine(window);
  const warningLine = window.warning ? formatWarningLine(window.warning) : '';
  const text =
    `Hey mate — it's blowing at ${spotName}.\n` +
    `${window.maxWind} kts from ${window.direction}, ${window.startHour}–${window.endHour}.\n` +
    `Worth a look.${tempLine}${warningLine}`;

  return {
    subject,
    text,
    html:
      `<p>Hey mate — <strong>it's blowing at ${spotName}</strong>.</p>` +
      `<p>${window.maxWind} kts from ${window.direction}, ` +
      `${window.startHour}–${window.endHour}.</p>` +
      `<p>Worth a look.</p>` +
      (tempLine ? `<p>${tempLine.trim().replace(/^\n/, '')}</p>` : '') +
      (window.warning ? `<p>⚠️ ${window.warning.message}</p>` : ''),
  };
}

module.exports = { formatRideAlert };
