const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { onshoreFromDirectionInference } = require('../src/utils/onshoreInference');

describe('onshoreFromDirectionInference', () => {
  it('maps high-confidence cache to onshore_directions', () => {
    const r = onshoreFromDirectionInference({
      confidence: 'high',
      directions: ['W', 'WNW', 'NW'],
      bearing_deg: 292.5,
    });
    assert.deepEqual(r.onshore_directions, ['W', 'WNW', 'NW']);
    assert.equal(r.onshore_inference_status, 'ok');
  });

  it('shows low confidence sectors for map validation', () => {
    const r = onshoreFromDirectionInference({
      confidence: 'low',
      directions: ['SW', 'W', 'WNW'],
      error: 'pin_too_far_from_shore',
    });
    assert.equal(r.onshore_inference_status, 'low');
    assert.equal(r.onshore_directions.length, 3);
  });

  it('builds sectors from bearing when directions empty', () => {
    const r = onshoreFromDirectionInference({
      confidence: 'high',
      directions: [],
      bearing_deg: 270,
    });
    assert.deepEqual(r.onshore_directions, ['WSW', 'W', 'WNW']);
  });

  it('reports failed inference', () => {
    const r = onshoreFromDirectionInference({
      confidence: 'failed',
      error: 'no_osm_boundary',
    });
    assert.equal(r.onshore_inference_status, 'failed');
    assert.equal(r.onshore_directions.length, 0);
  });
});
