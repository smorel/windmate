const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

const ALIASES = {
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
};

/** @param {unknown} raw */
function normalizeCompassDirections(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    let label = String(item ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    if (ALIASES[label]) label = ALIASES[label];
    if (COMPASS_16.includes(label) && !out.includes(label)) {
      out.push(label);
    }
  }
  return out;
}

module.exports = { COMPASS_16, normalizeCompassDirections };
