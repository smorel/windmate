const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  selectDashboardSpots,
  selectFavoriteOnlySpots,
  selectSpotsForProfile,
} = require('../src/utils/spotSelection');

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

describe('selectFavoriteOnlySpots', () => {
  it('returns only starred spots sorted by distance', () => {
    const result = selectFavoriteOnlySpots(spots, 45.5, -73.5, 10, ['far-fav', 'near-1']);
    assert.deepEqual(result.map((s) => s.id), ['near-1', 'far-fav']);
    assert.ok(!result.some((s) => s.id === 'near-2'));
  });

  it('returns empty when no favorites', () => {
    assert.deepEqual(selectFavoriteOnlySpots(spots, 45.5, -73.5, 10, []), []);
  });

  it('skips unknown favorite ids', () => {
    const result = selectFavoriteOnlySpots(spots, 45.5, -73.5, 10, ['missing', 'near-1']);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'near-1');
  });
});

describe('selectSpotsForProfile', () => {
  const profile = {
    radius_km: 10,
    favorite_spot_ids: ['far-fav'],
    favorites_only: 0,
  };

  it('uses radius mode when favorites_only is off', () => {
    const result = selectSpotsForProfile(spots, 45.5, -73.5, profile, 12);
    assert.ok(result.some((s) => s.id === 'near-1'));
    assert.ok(!result.some((s) => s.id === 'far-other'));
  });

  it('uses favorites only when favorites_only is on', () => {
    const onlyFav = { ...profile, favorites_only: 1, favorite_spot_ids: ['far-fav'] };
    const result = selectSpotsForProfile(spots, 45.5, -73.5, onlyFav, 12);
    assert.deepEqual(result.map((s) => s.id), ['far-fav']);
  });
});
