const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { explainMarginalSessionScore } = require('../src/utils/sessionScoreReasons');

describe('explainMarginalSessionScore', () => {
  it('states distance is not what lowers session score for far favorites', () => {
    const metrics = {
      onshore: 0,
      waveMatch: 0,
      wind: 0.39,
      gust: 0.57,
      rideability: 0.5,
      bestWindow: 1,
    };
    const weights = {
      wind: 0.22,
      gust: 0.19,
      waveMatch: 0.17,
      onshore: 0.15,
      rideability: 0.13,
      bestWindow: 0.13,
    };
    const reason = explainMarginalSessionScore(
      metrics,
      weights,
      { spot: { distance_km: 5641, outside_radius: true } },
      { radius_km: 150 }
    );
    assert.match(reason, /5641 km away/);
    assert.match(reason, /doesn’t lower this session score/);
    assert.match(reason, /Wind direction rarely ideal/);
    assert.match(reason, /Waves\/chop/);
    assert.doesNotMatch(reason, /Marginal session score for your setup/);
  });
});
