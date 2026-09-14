const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  regionKey,
  bboxCenterAndRadius,
} = require('../src/services/spotCatalogDiscovery');

describe('spotCatalogDiscovery', () => {
  it('computes bbox center and radius', () => {
    const { centerLat, centerLng, radiusKm } = bboxCenterAndRadius(46, 45, -73, -74);
    assert.equal(centerLat, 45.5);
    assert.equal(centerLng, -73.5);
    assert.ok(radiusKm > 50);
  });

  it('stable region keys for nearby queries', () => {
    const a = regionKey(45.501, -73.567, 40);
    const b = regionKey(45.505, -73.562, 42);
    assert.equal(a, b);
  });
});
