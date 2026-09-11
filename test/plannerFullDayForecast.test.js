const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  showMatrixCriterionSegment,
  filterMatrixSpotsForDay,
} = require('../src/utils/plannerFullDay');

describe('showMatrixCriterionSegment', () => {
  const hour = { rideable: false, windSpeed: 8, gusts: 12 };

  it('shows rideable hours when full-day mode is off', () => {
    assert.equal(showMatrixCriterionSegment({ rideable: true, windSpeed: 8 }, false, false), true);
    assert.equal(showMatrixCriterionSegment(hour, false, false), false);
  });

  it('shows any hour with forecast data when full-day mode is on', () => {
    assert.equal(showMatrixCriterionSegment(hour, false, true), true);
    assert.equal(showMatrixCriterionSegment({ rideable: false }, false, true), false);
  });

  it('shows elapsed hours with data regardless of mode', () => {
    assert.equal(showMatrixCriterionSegment(hour, true, false), true);
  });
});

describe('filterMatrixSpotsForDay', () => {
  const rows = [
    { rideableCount: 3, entry: { spot: { id: 'ride' } } },
    { rideableCount: 0, entry: { spot: { id: 'fav' } } },
    { rideableCount: 0, entry: { spot: { id: 'other' } } },
  ];

  it('keeps only rideable spots when mode is off', () => {
    const out = filterMatrixSpotsForDay(rows, ['fav'], false);
    assert.deepEqual(out.map((r) => r.entry.spot.id), ['ride']);
  });

  it('includes favorites and rideable spots when mode is on', () => {
    const out = filterMatrixSpotsForDay(rows, ['fav'], true);
    assert.deepEqual(out.map((r) => r.entry.spot.id), ['ride', 'fav']);
  });
});
