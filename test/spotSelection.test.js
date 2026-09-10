const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { selectDashboardSpots } = require('../src/utils/spotSelection');

const spots = [
  { id: 'near-1', name: 'Near A', latitude: 45.5, longitude: -73.5 },
  { id: 'near-2', name: 'Near B', latitude: 45.51, longitude: -73.51 },
  { id: 'far-fav', name: 'Far Favorite', latitude: 46.5, longitude: -72.0 },
  { id: 'far-other', name: 'Far Other', latitude: 46.6, longitude: -72.1 },
];

describe('selectDashboardSpots', () => {
  it('includes favorited spots outside the search radius', () => {
    const result = selectDashboardSpots(spots, 45.5, -73.5, 10, 12, ['far-fav']);
    const ids = result.map((s) => s.id);
    assert.ok(ids.includes('near-1'));
    assert.ok(ids.includes('far-fav'));
    assert.ok(!ids.includes('far-other'));
  });

  it('marks outside-radius favorites', () => {
    const result = selectDashboardSpots(spots, 45.5, -73.5, 10, 12, ['far-fav']);
    const far = result.find((s) => s.id === 'far-fav');
    const near = result.find((s) => s.id === 'near-1');
    assert.equal(far.outside_radius, true);
    assert.equal(near.outside_radius, false);
  });

  it('does not mark in-radius favorites beyond the spot limit as outside radius', () => {
    const manyNear = Array.from({ length: 14 }, (_, i) => ({
      id: `near-${i}`,
      name: `Near ${i}`,
      latitude: 45.5 + i * 0.001,
      longitude: -73.5,
    }));
    const inRadiusFav = {
      id: 'in-radius-fav',
      name: 'In radius favorite',
      latitude: 45.52,
      longitude: -73.5,
    };
    const all = [...manyNear, inRadiusFav];
    const result = selectDashboardSpots(all, 45.5, -73.5, 50, 12, ['in-radius-fav']);
    const fav = result.find((s) => s.id === 'in-radius-fav');
    assert.ok(fav);
    assert.equal(fav.outside_radius, false);
  });
});
