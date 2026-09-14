#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDb } = require('../src/db');
const { INFERENCE_ALGO_VERSION } = require('../src/services/directionInference/constants');

function parseInference(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function spotNeedsInference(spot, force) {
  if (force) return true;
  if (!spot.direction_inference) return true;
  const cached = parseInference(spot.direction_inference);
  if (!cached) return true;
  if (cached.confidence === 'failed') return true;
  if (cached.algo_version !== INFERENCE_ALGO_VERSION) return true;
  return false;
}

async function main() {
  const db = initDb();
  const force = process.argv.includes('--force');
  const spots = db.prepare('SELECT id, latitude, longitude, direction_inference FROM spots').all();
  const { ensureSpotDirectionInference } = require('../src/services/directionInference');
  const delayMs = parseInt(process.env.INFERENCE_BACKFILL_DELAY_MS ?? '3000', 10);

  const todo = spots.filter((s) => spotNeedsInference(s, force));
  console.log(`[backfill] ${todo.length} of ${spots.length} spot(s) to process${force ? ' (force)' : ''}`);

  let done = 0;
  let high = 0;
  let low = 0;
  let failed = 0;

  for (const spot of todo) {
    const result = await ensureSpotDirectionInference(db, spot, { force: true });
    done++;
    if (result.confidence === 'high') high++;
    else if (result.confidence === 'low') low++;
    else failed++;

    if (done % 10 === 0 || done === todo.length) {
      console.log(`[backfill] ${done}/${todo.length} (high ${high}, low ${low}, failed ${failed})`);
    }

    if (done < todo.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(`[backfill] Finished ${done} spot(s) — high ${high}, low ${low}, failed ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
