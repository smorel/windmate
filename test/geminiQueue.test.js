const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('geminiQueue', () => {
  before(() => {
    process.env.GEMINI_MIN_INTERVAL_MS = '0';
  });

  it('runs tasks sequentially', async () => {
    const { enqueueGeminiRequest } = require('../src/services/gemini/geminiQueue');
    const order = [];
    await Promise.all([
      enqueueGeminiRequest('a', async () => {
        order.push('a');
      }),
      enqueueGeminiRequest('b', async () => {
        order.push('b');
      }),
    ]);
    assert.deepEqual(order, ['a', 'b']);
  });
});
