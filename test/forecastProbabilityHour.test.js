const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMeteoProbability,
  readMeteoForecastProbability,
  repairLegacyStoredWindProbability,
} = require('../src/utils/forecastProbabilityHour');

describe('forecastProbabilityHour', () => {
  it('normalizes 0–1, iGetwind 0–10, and 0–100 scales', () => {
    assert.equal(normalizeMeteoProbability(0.6), 0.6);
    assert.equal(normalizeMeteoProbability(7.35), 0.735);
    assert.equal(normalizeMeteoProbability(75), 0.75);
    assert.equal(normalizeMeteoProbability(-1), null);
  });

  it('repairs v2 cache WINDP stored as divide-by-100', () => {
    assert.equal(repairLegacyStoredWindProbability(0.0735), 0.735);
    assert.equal(repairLegacyStoredWindProbability(0.55), 0.55);
    assert.equal(repairLegacyStoredWindProbability(0.735), 0.735);
  });

  it('reads forecastProbability from rideability hours only when set', () => {
    assert.equal(readMeteoForecastProbability({ forecastProbability: 0.4 }), 0.4);
    assert.equal(readMeteoForecastProbability({ rideable: true }), null);
  });
});
