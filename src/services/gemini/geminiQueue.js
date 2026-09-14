const QUOTA_BACKOFF_MS = parseInt(process.env.GEMINI_QUOTA_BACKOFF_MS ?? '90000', 10);
const MAX_429_RETRIES = parseInt(process.env.GEMINI_MAX_429_RETRIES ?? '0', 10);

function minIntervalMs() {
  return parseInt(process.env.GEMINI_MIN_INTERVAL_MS ?? '12000', 10);
}

let chain = Promise.resolve();
let lastRequestAt = 0;
let pausedUntil = 0;
let quotaWarnedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warnQuotaPaused(until) {
  const now = Date.now();
  if (now - quotaWarnedAt < 30_000) return;
  quotaWarnedAt = now;
  const sec = Math.ceil((until - now) / 1000);
  console.warn(
    `[gemini] Quota/rate limit — pausing ~${sec}s. New free-tier projects have low daily caps; ` +
      'earlier bulk runs may have used today\'s quota. See https://ai.dev/rate-limit — ' +
      'set GEMINI_CATALOG_ENABLED=false until Spot Details only, or wait for reset.'
  );
}

/**
 * Run a Gemini API call with global serialization, spacing, and 429 backoff.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function enqueueGeminiRequest(label, fn) {
  const run = async () => {
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const now = Date.now();
      if (pausedUntil > now) {
        warnQuotaPaused(pausedUntil);
        await sleep(pausedUntil - now);
      }

      const spacing = Math.max(0, lastRequestAt + minIntervalMs() - Date.now());
      if (spacing > 0) {
        await sleep(spacing);
      }

      lastRequestAt = Date.now();
      try {
        return await fn();
      } catch (err) {
        const is429 = err?.status === 429;
        const quotaHit =
          is429 &&
          /quota|rate limit|resource exhausted/i.test(String(err.message ?? ''));
        if (is429 && quotaHit) {
          pausedUntil = Date.now() + QUOTA_BACKOFF_MS;
          warnQuotaPaused(pausedUntil);
          err.quotaExceeded = true;
          throw err;
        }
        if (is429 && attempt < MAX_429_RETRIES) {
          const backoff = QUOTA_BACKOFF_MS * (attempt + 1);
          pausedUntil = Date.now() + backoff;
          warnQuotaPaused(pausedUntil);
          await sleep(backoff);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`[gemini] ${label}: exhausted 429 retries`);
  };

  const task = chain.then(run, run);
  chain = task.catch(() => {});
  return task;
}

function getGeminiQueueState() {
  return {
    paused_until: pausedUntil > Date.now() ? pausedUntil : null,
    min_interval_ms: minIntervalMs(),
  };
}

module.exports = { enqueueGeminiRequest, getGeminiQueueState, sleep };
