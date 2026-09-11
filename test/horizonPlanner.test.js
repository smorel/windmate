const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function isPlannedHorizonSpot(entry, radiusKm) {
  if (entry.spot?.outside_radius) return false;
  const dist = entry.spot?.distance_km;
  if (Number.isFinite(dist) && dist > radiusKm) return false;
  return true;
}

function isFarFavoritesOnlyHorizonDay(spots, hasWindow, radiusKm) {
  let anyFarWindow = false;
  let anyPlannedWindow = false;
  for (const entry of spots) {
    if (!hasWindow(entry)) continue;
    if (isPlannedHorizonSpot(entry, radiusKm)) anyPlannedWindow = true;
    else anyFarWindow = true;
  }
  return anyFarWindow && !anyPlannedWindow;
}

function isPlannedFavoriteHorizonDay(spots, hasWindow, radiusKm, favoriteSpotIds) {
  const favorites = new Set(favoriteSpotIds ?? []);
  if (favorites.size === 0) return false;
  for (const entry of spots) {
    const id = entry.spot?.id;
    if (!id || !favorites.has(id)) continue;
    if (!isPlannedHorizonSpot(entry, radiusKm)) continue;
    if (hasWindow(entry)) return true;
  }
  return false;
}

describe('isFarFavoritesOnlyHorizonDay', () => {
  it('is true when only distant favorites have windows', () => {
    const spots = [
      { spot: { distance_km: 5000, outside_radius: true } },
      { spot: { distance_km: 40, outside_radius: false } },
    ];
    const hasWindow = (entry) => entry.spot.distance_km > 1000;
    assert.equal(isFarFavoritesOnlyHorizonDay(spots, hasWindow, 150), true);
  });

  it('is false when a nearby spot also has a window', () => {
    const spots = [
      { spot: { distance_km: 5000, outside_radius: true } },
      { spot: { distance_km: 40, outside_radius: false } },
    ];
    const hasWindow = () => true;
    assert.equal(isFarFavoritesOnlyHorizonDay(spots, hasWindow, 150), false);
  });
});

describe('isPlannedFavoriteHorizonDay', () => {
  it('is true when a nearby favorite has a rideable window', () => {
    const spots = [
      { spot: { id: 'fav-1', distance_km: 40, outside_radius: false } },
      { spot: { id: 'other', distance_km: 30, outside_radius: false } },
    ];
    const hasWindow = (entry) => entry.spot.id === 'fav-1';
    assert.equal(isPlannedFavoriteHorizonDay(spots, hasWindow, 150, ['fav-1']), true);
  });

  it('is false when the favorite is outside the search radius', () => {
    const spots = [{ spot: { id: 'fav-1', distance_km: 500, outside_radius: true } }];
    const hasWindow = () => true;
    assert.equal(isPlannedFavoriteHorizonDay(spots, hasWindow, 150, ['fav-1']), false);
  });

  it('is false when only non-favorites have windows nearby', () => {
    const spots = [
      { spot: { id: 'fav-1', distance_km: 40, outside_radius: false } },
      { spot: { id: 'other', distance_km: 30, outside_radius: false } },
    ];
    const hasWindow = (entry) => entry.spot.id === 'other';
    assert.equal(isPlannedFavoriteHorizonDay(spots, hasWindow, 150, ['fav-1']), false);
  });
});
