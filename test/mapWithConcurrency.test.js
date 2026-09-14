const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mapWithConcurrency } = require('../src/utils/mapWithConcurrency');

describe('mapWithConcurrency', () => {
  it('preserves order', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => n * 2);
    assert.deepEqual(out, [2, 4, 6]);
  });

  it('limits concurrent work', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return null;
    });
    assert.equal(maxInFlight, 2);
  });
});
