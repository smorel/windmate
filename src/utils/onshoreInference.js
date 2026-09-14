const { degreesToCompass } = require('./geo');
const { expandToThreeSectors } = require('../services/directionInference/geometry');

/**
 * Shoreline-inferred onshore sectors (wind-from), not sport "ideal" preferences.
 * @param {{ confidence?: string, directions?: string[], bearing_deg?: number|null, error?: string|null } | null} inference
 */
function onshoreFromDirectionInference(inference) {
  if (!inference) {
    return {
      onshore_directions: [],
      onshore_inference_status: 'pending',
      onshore_inference_message: null,
    };
  }

  if (inference.confidence === 'failed') {
    return {
      onshore_directions: [],
      onshore_inference_status: 'failed',
      onshore_inference_message: inference.error ?? 'inference_failed',
    };
  }

  let sectors = (inference.directions ?? []).filter(Boolean);
  if (!sectors.length && inference.bearing_deg != null && !Number.isNaN(inference.bearing_deg)) {
    sectors = expandToThreeSectors(degreesToCompass(inference.bearing_deg));
  }

  if (!sectors.length) {
    return {
      onshore_directions: [],
      onshore_inference_status: 'unavailable',
      onshore_inference_message: inference.error ?? 'no_onshore_sectors',
    };
  }

  return {
    onshore_directions: sectors,
    onshore_inference_status: inference.confidence === 'high' ? 'ok' : 'low',
    onshore_inference_message: inference.error ?? null,
  };
}

module.exports = { onshoreFromDirectionInference };
