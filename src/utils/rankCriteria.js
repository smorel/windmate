const DEFAULT_RANK_CRITERIA_ORDER = [
  'rideability',
  'bestWindow',
  'proximity',
  'wind',
  'gust',
  'onshore',
  'waveMatch',
];

const VALID_RANK_CRITERIA = new Set(DEFAULT_RANK_CRITERIA_ORDER);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseRankCriteriaOrder(value) {
  if (value == null || value === '') return [...DEFAULT_RANK_CRITERIA_ORDER];

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [...DEFAULT_RANK_CRITERIA_ORDER];
    }
  }

  if (!Array.isArray(parsed)) return [...DEFAULT_RANK_CRITERIA_ORDER];

  const seen = new Set();
  const order = [];
  for (const key of parsed) {
    if (typeof key !== 'string' || !VALID_RANK_CRITERIA.has(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }

  for (const key of DEFAULT_RANK_CRITERIA_ORDER) {
    if (seen.has(key)) continue;
    if (key === 'gust' && seen.has('wind')) {
      order.splice(order.indexOf('wind') + 1, 0, key);
    } else {
      order.push(key);
    }
    seen.add(key);
  }

  return order;
}

module.exports = {
  DEFAULT_RANK_CRITERIA_ORDER,
  VALID_RANK_CRITERIA,
  parseRankCriteriaOrder,
};
