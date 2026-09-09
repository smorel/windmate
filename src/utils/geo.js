const DIRECTIONS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** @param {number} degrees */
function degreesToCompass(degrees) {
  const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
  return DIRECTIONS[index];
}

/** @param {string} direction */
function isIdealDirection(direction, idealDirections) {
  if (!idealDirections?.length) return false;
  return idealDirections.includes(direction);
}

/** @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { degreesToCompass, isIdealDirection, haversineKm, DIRECTIONS };
