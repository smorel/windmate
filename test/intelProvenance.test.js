const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeIntelSignals,
  signalEligibleForRanking,
  unwrapAttributed,
} = require('../src/services/intelProvenance');

describe('intelProvenance', () => {
  it('unwraps attributed fields', () => {
    const { value, provenance } = unwrapAttributed({ value: 'Paid lot', provenance: { source_kind: 'official_feed' } });
    assert.equal(value, 'Paid lot');
    assert.equal(provenance.source_kind, 'official_feed');
  });

  it('rejects low-confidence signals for ranking', () => {
    assert.equal(signalEligibleForRanking({ category: 'access', level: 'closed', confidence: 'low', source_url: 'https://x' }), false);
    assert.equal(
      signalEligibleForRanking({ category: 'access', level: 'closed', confidence: 'high', source_url: 'https://x' }),
      true
    );
  });

  it('merges worst overall level from rank categories', () => {
    const { overall_level } = mergeIntelSignals([
      { category: 'parking', level: 'ok', confidence: 'high', source_url: 'https://a' },
      { category: 'access', level: 'caution', confidence: 'high', source_url: 'https://b' },
    ]);
    assert.equal(overall_level, 'caution');
  });
});
