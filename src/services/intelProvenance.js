const VALID_SOURCE_KINDS = new Set([
  'manual',
  'official_feed',
  'social_api',
  'community_guide',
  'gemini_search',
  'gemini_parser',
  'windmate',
  'igetwind',
  'unknown',
]);

/** @param {object} signal */
function signalEligibleForRanking(signal) {
  if (!signal || signal.confidence === 'low') return false;
  if (signal.source === 'unknown') return false;
  if (signal.source_url) return true;
  return signal.extracted_by === 'windmate' && Boolean(signal.derivation);
}

/** @param {object} provenance */
function provenanceDisplayable(provenance) {
  if (!provenance) return false;
  if (provenance.source_kind === 'unknown') return false;
  return true;
}

/** @param {object | string | null} field AttributedField or plain string */
function unwrapAttributed(field) {
  if (field == null) return { value: null, provenance: null };
  if (typeof field === 'string' || typeof field === 'number' || Array.isArray(field)) {
    return { value: field, provenance: null };
  }
  if (typeof field === 'object' && 'value' in field) {
    return { value: field.value, provenance: field.provenance ?? null };
  }
  return { value: field, provenance: null };
}

/** @param {object[]} signals */
function mergeIntelSignals(signals) {
  const list = (signals ?? []).filter(Boolean);
  const rankSignals = list.filter(signalEligibleForRanking);

  const severity = { ok: 0, caution: 1, closed: 2, unknown: 0 };
  const categories = ['access', 'parking', 'water'];
  let overall = 'ok';

  for (const cat of categories) {
    const catSignals = rankSignals.filter((s) => s.category === cat);
    for (const s of catSignals) {
      const level = s.level ?? 'unknown';
      if ((severity[level] ?? 0) > (severity[overall] ?? 0)) {
        overall = level;
      }
    }
  }

  return { overall_level: overall, signals: list, rank_signals: rankSignals };
}

/** @param {object} provenance */
function validateProvenanceOnIngest(provenance) {
  if (!provenance) return { ok: true };
  if (provenance.source_kind && !VALID_SOURCE_KINDS.has(provenance.source_kind)) {
    return { ok: false, reason: `invalid source_kind ${provenance.source_kind}` };
  }
  if (provenance.confidence === 'low' && provenance.source_kind === 'unknown') {
    return { ok: false, reason: 'unknown low-confidence provenance' };
  }
  return { ok: true };
}

module.exports = {
  signalEligibleForRanking,
  provenanceDisplayable,
  unwrapAttributed,
  mergeIntelSignals,
  validateProvenanceOnIngest,
};
