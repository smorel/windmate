const { DIRECTIONS, isIdealDirection } = require('../utils/geo');

/** @typedef {'onshore' | 'cross' | 'offshore' | 'unknown'} WindExposure */

/**
 * Classify wind direction vs spot onshore sectors (ideal_directions for now).
 * Cross-shore = ±1 compass sector from any onshore direction.
 * @param {string} direction
 * @param {string[]} onshoreDirections
 * @returns {WindExposure}
 */
function classifyWindExposure(direction, onshoreDirections) {
  if (!onshoreDirections?.length) return 'unknown';
  if (isIdealDirection(direction, onshoreDirections)) return 'onshore';

  const index = DIRECTIONS.indexOf(direction);
  if (index < 0) return 'offshore';

  for (const onshore of onshoreDirections) {
    const onshoreIndex = DIRECTIONS.indexOf(onshore);
    if (onshoreIndex < 0) continue;
    const rawDiff = Math.abs(index - onshoreIndex);
    const diff = Math.min(rawDiff, DIRECTIONS.length - rawDiff);
    if (diff === 1) return 'cross';
  }

  return 'offshore';
}

/**
 * @param {WindExposure} exposure
 * @param {{ offshore_wind_ok?: number|boolean }} prefs
 */
function isOffshoreBlocked(exposure, prefs) {
  if (prefs?.offshore_wind_ok) return false;
  return exposure === 'offshore';
}

module.exports = { classifyWindExposure, isOffshoreBlocked };
