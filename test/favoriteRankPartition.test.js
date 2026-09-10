const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { partitionRankedSpots } = require('../src/utils/favoriteRankPartition');

function row(id, dist, score) {
  return { entry: { spot: { id, distance_km: dist } }, score };
}

describe('partitionRankedSpots', () => {
  it('keeps in-radius favorites at the top in score order', () => {
    const ranked = [
      row('near-a', 20, 0.7),
      row('fav-close', 30, 0.65),
      row('near-b', 15, 0.68),
      row('fav-far', 200, 0.8),
    ];
    const result = partitionRankedSpots(ranked, 150, ['fav-close', 'fav-far']);
    assert.deepEqual(
      result.map((r) => r.entry.spot.id),
      ['fav-close', 'near-a', 'near-b', 'fav-far']
    );
  });

  it('does not demote in-radius favorites below non-favorites', () => {
    const ranked = [
      row('l-anse', 27, 0.71),
      row('chateauguay', 19, 0.7),
      row('venise', 61, 0.64),
    ];
    const result = partitionRankedSpots(ranked, 150, ['l-anse', 'venise']);
    assert.deepEqual(
      result.map((r) => r.entry.spot.id),
      ['l-anse', 'venise', 'chateauguay']
    );
  });
});
