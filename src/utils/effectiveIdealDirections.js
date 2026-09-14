/**
 * @returns {'shadow' | 'authoritative'}
 */
function getDirectionInferenceMode() {
  const mode = (process.env.DIRECTION_INFERENCE_MODE ?? 'shadow').toLowerCase();
  return mode === 'authoritative' ? 'authoritative' : 'shadow';
}

/**
 * @param {{ ideal_directions?: string[], direction_inference?: { confidence?: string, directions?: string[] } | null }} spot
 * @param {'shadow' | 'authoritative'} [mode]
 * @returns {string[]}
 */
function effectiveIdealDirections(spot, mode = getDirectionInferenceMode()) {
  const stored = spot?.ideal_directions ?? [];
  const computed = spot?.direction_inference;

  if (mode === 'authoritative' && computed?.confidence === 'high' && computed.directions?.length) {
    return computed.directions;
  }

  if (stored.length > 0) {
    return stored;
  }

  if (computed?.confidence === 'high' && computed.directions?.length) {
    return computed.directions;
  }

  return [];
}

module.exports = { effectiveIdealDirections, getDirectionInferenceMode };
