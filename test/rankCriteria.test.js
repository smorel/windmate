const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseRankCriteriaOrder } = require('../src/utils/rankCriteria');
const { computeSessionScore } = require('../src/services/sessionRank');

function hour(time, overrides = {}) {
  return {
    time,
    rideable: true,
    windOk: true,
    weatherOk: true,
    tempOk: true,
    windSpeed: 16,
    gusts: 24,
    windExposure: 'onshore',
    idealWind: true,
    ...overrides,
  };
}

describe('parseRankCriteriaOrder', () => {
  it('inserts gust after wind for legacy saved orders', () => {
    const order = parseRankCriteriaOrder([
      'rideability',
      'bestWindow',
      'proximity',
      'wind',
      'onshore',
      'waveMatch',
    ]);
    assert.equal(order.indexOf('gust'), order.indexOf('wind') + 1);
  });
});

describe('computeSessionScore gust', () => {
  it('includes gust strength in session metrics', () => {
    const hours = [
      hour('2026-09-12T08:00', { gusts: 34 }),
      hour('2026-09-12T09:00', { gusts: 34 }),
    ];
    const entry = {
      spot: { distance_km: 10 },
      models: {},
      days: [{ date: '2026-09-12', hours }],
    };
    const { metrics } = computeSessionScore(
      entry,
      '2026-09-12',
      { max_gust_knots: 38, rank_criteria_order: ['wind', 'gust'] },
      50
    );
    assert.ok(metrics.gust > 0);
    assert.ok(metrics.gust > metrics.wind * 0.8);
  });
});
