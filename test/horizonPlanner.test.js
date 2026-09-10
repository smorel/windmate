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
