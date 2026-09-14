const { validateDirections } = require('../services/directionInference');
const { effectiveIdealDirections } = require('./effectiveIdealDirections');
const { onshoreFromDirectionInference } = require('./onshoreInference');

/**
 * Rideability / forecast spot payload fields for direction validation.
 * @param {{ ideal_directions?: string[], direction_inference?: object | null }} spot
 */
function buildSpotDirectionFields(spot) {
  const inference = spot.direction_inference ?? null;
  const onshore = onshoreFromDirectionInference(inference);
  return {
    ideal_directions: spot.ideal_directions ?? [],
    direction_inference: inference,
    onshore_directions: onshore.onshore_directions,
    onshore_inference_status: onshore.onshore_inference_status,
    onshore_inference_message: onshore.onshore_inference_message,
    direction_validation: validateDirections(spot.ideal_directions ?? [], inference),
  };
}

/**
 * @param {{ ideal_directions?: string[], direction_inference?: object | null }} spot
 */
function idealDirectionsForRideability(spot) {
  return effectiveIdealDirections(spot);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, latitude: number, longitude: number, direction_inference?: object | null }} spot
 */
async function hydrateSpotDirectionInference(db, spot) {
  const { ensureSpotDirectionInference } = require('../services/directionInference');
  const { getSpotById } = require('../db');
  try {
    await ensureSpotDirectionInference(db, spot);
  } catch (err) {
    console.warn('[direction-inference] hydrate failed:', spot.id, err?.message ?? err);
  }
  return getSpotById(db, spot.id) ?? spot;
}

/**
 * Compute and persist direction inference without blocking the caller (e.g. spot create).
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, latitude: number, longitude: number }} spot
 */
function scheduleSpotDirectionInference(db, spot) {
  const { ensureSpotDirectionInference } = require('../services/directionInference');
  void ensureSpotDirectionInference(db, spot).catch((err) => {
    console.warn('[direction-inference] background failed:', spot.id, err?.message ?? err);
  });
}

module.exports = {
  buildSpotDirectionFields,
  idealDirectionsForRideability,
  hydrateSpotDirectionInference,
  scheduleSpotDirectionInference,
};
