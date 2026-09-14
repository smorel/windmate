const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompassDirections } = require('../src/utils/compassDirections');

describe('compassDirections', () => {
  it('normalizes 16-point labels', () => {
    assert.deepEqual(normalizeCompassDirections(['w', 'NW', 'west']), ['W', 'NW']);
  });
});
