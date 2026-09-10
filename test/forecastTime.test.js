const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { localDateString } = require('../src/utils/forecastTime');

describe('localDateString', () => {
  it('formats the local calendar date', () => {
    const d = new Date(2026, 8, 9, 20, 34);
    assert.equal(localDateString(d), '2026-09-09');
  });

  it('does not use UTC toISOString slice', () => {
    const d = new Date(2026, 8, 9, 20, 34);
    assert.notEqual(localDateString(d), d.toISOString().slice(0, 10));
  });
});
