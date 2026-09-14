const { DIRECTIONS } = require('../../utils/geo');
const { angleBetweenDeg } = require('./geometry');

/** Middle label of a 3-sector set, or sole label. */
function primaryBearingLabel(directions) {
  if (!directions?.length) return null;
  if (directions.length === 1) return directions[0];
  const mid = Math.floor(directions.length / 2);
  return directions[mid];
}

function labelToDegrees(label) {
  const idx = DIRECTIONS.indexOf(label);
  if (idx < 0) return null;
  return idx * 22.5;
}

/**
 * @param {string[]} stored
 * @param {{ confidence?: string, directions?: string[] } | null} inference
 */
function validateDirections(stored, inference) {
  const storedList = stored ?? [];
  const computed = inference?.directions ?? [];

  if (!storedList.length) {
    return {
      status: 'no_stored',
      stored: storedList,
      computed,
    };
  }

  if (inference?.confidence !== 'high' || !computed.length) {
    return {
      status: 'no_computed',
      stored: storedList,
      computed,
    };
  }

  const storedSet = new Set(storedList);
  const overlap = computed.some((d) => storedSet.has(d));
  const primaryStored = primaryBearingLabel(storedList);
  const primaryComputed = primaryBearingLabel(computed);
  const degStored = labelToDegrees(primaryStored);
  const degComputed = labelToDegrees(primaryComputed);
  const angularOk =
    degStored != null && degComputed != null && angleBetweenDeg(degStored, degComputed) <= 22.5;

  if (overlap || angularOk) {
    return {
      status: 'match',
      stored: storedList,
      computed,
      primary_bearing_stored_deg: degStored,
      primary_bearing_computed_deg: degComputed,
    };
  }

  return {
    status: 'mismatch',
    stored: storedList,
    computed,
    primary_bearing_stored_deg: degStored,
    primary_bearing_computed_deg: degComputed,
  };
}

module.exports = { validateDirections, primaryBearingLabel, labelToDegrees };
