const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMeteoProbability,
  readMeteoForecastProbability,
} = require('../src/utils/forecastProbabilityHour');

describe('forecastProbabilityHour', () => {
  it('normalizes 0–1 and 0–100 scales', () => {
    assert.equal(normalizeMeteoProbability(0.6), 0.6);
    assert.equal(normalizeMeteoProbability(75), 0.75);
    assert.equal(normalizeMeteoProbability(-1), null);
  });

  it('reads forecastProbability from rideability hours only when set', () => {
    assert.equal(readMeteoForecastProbability({ forecastProbability: 0.4 }), 0.4);
    assert.equal(readMeteoForecastProbability({ rideable: true }), null);
  });
});
