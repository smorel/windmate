const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeFromBoundaryLatLng, simplifyPolyline } = require('../src/services/directionInference/geometry');
const { validateDirections } = require('../src/services/directionInference/validation');
const { effectiveIdealDirections } = require('../src/utils/effectiveIdealDirections');

function straightShoreEastWest(pinLat, pinLng, lengthM = 800) {
  const mPerDegLng = 111320 * Math.cos((pinLat * Math.PI) / 180);
  const half = lengthM / mPerDegLng / 2;
  const points = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    points.push({ lat: pinLat, lng: pinLng - half + t * half * 2 });
  }
  return points;
}

describe('directionInference geometry', () => {
  it('stable bearing on simplified noisy straight shore', () => {
    const pin = { lat: 45.5004, lng: -73.5 };
    const base = straightShoreEastWest(45.5, pin.lng, 1000);
    const noisy = base.flatMap((p, i) => {
      const jitter = (i % 2 === 0 ? 0.00002 : -0.00002);
      return [{ lat: p.lat + jitter, lng: p.lng }];
    });
    const a = computeFromBoundaryLatLng(pin.lat, pin.lng, noisy, pin);
    const b = computeFromBoundaryLatLng(pin.lat, pin.lng, noisy, pin);
    assert.equal(a.confidence, 'high');
    assert.equal(b.confidence, 'high');
    assert.ok(a.directions.includes('N') || a.directions.includes('S'));
    assert.ok(Math.abs(a.bearing_deg - b.bearing_deg) < 1);
  });

  it('simplifyPolyline reduces vertex count', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0.1 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const out = simplifyPolyline(pts, 0.5);
    assert.ok(out.length <= pts.length);
  });
});

describe('directionInference validation', () => {
  it('match when sectors overlap', () => {
    const r = validateDirections(['SW', 'W', 'WNW'], {
      confidence: 'high',
      directions: ['W', 'WNW', 'NW'],
    });
    assert.equal(r.status, 'match');
  });

  it('mismatch when stored seed disagrees with computed', () => {
    const r = validateDirections(['E', 'SE', 'S'], {
      confidence: 'high',
      directions: ['W', 'WNW', 'NW'],
    });
    assert.equal(r.status, 'mismatch');
  });

  it('no_stored when ideal list empty', () => {
    const r = validateDirections([], { confidence: 'high', directions: ['W', 'WNW', 'NW'] });
    assert.equal(r.status, 'no_stored');
  });
});

describe('effectiveIdealDirections shadow mode', () => {
  const spot = {
    ideal_directions: ['E', 'SE', 'S'],
    direction_inference: {
      confidence: 'high',
      directions: ['W', 'WNW', 'NW'],
    },
  };

  it('uses stored in shadow despite mismatch', () => {
    assert.deepEqual(effectiveIdealDirections(spot, 'shadow'), ['E', 'SE', 'S']);
  });

  it('uses computed in authoritative when high', () => {
    assert.deepEqual(effectiveIdealDirections(spot, 'authoritative'), ['W', 'WNW', 'NW']);
  });

  it('gap-fills from computed when stored empty in shadow', () => {
    const empty = {
      ideal_directions: [],
      direction_inference: { confidence: 'high', directions: ['W', 'WNW', 'NW'] },
    };
    assert.deepEqual(effectiveIdealDirections(empty, 'shadow'), ['W', 'WNW', 'NW']);
  });
});
