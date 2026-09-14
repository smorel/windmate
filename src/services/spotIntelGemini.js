const PROFILE_TTL_MS = parseInt(process.env.INTEL_PROFILE_TTL_MS ?? String(30 * 24 * 3600 * 1000), 10);
const DAY_TTL_MS = parseInt(process.env.INTEL_DAY_TTL_MS ?? String(3600 * 1000), 10);

const { geminiEnabled, generateJson } = require('./gemini/geminiClient');
const { WATERSPORTS_SYSTEM, buildWindmateAgentContext } = require('./gemini/windmateAgentContext');
const { mergeIntelSignals } = require('./intelProvenance');
const { normalizeCompassDirections } = require('../utils/compassDirections');
const {
  getSpotIntelProfile,
  setSpotIntelProfile,
  getSpotIntelDayCache,
  setSpotIntelDayCache,
  setSpotIntelCache,
  mergeSpotIdealDirectionsIfEmpty,
} = require('../db');

const detailInFlight = new Map();

function profileEnabled() {
  return geminiEnabled('INTEL_PARSER_ENABLED', false);
}

function profileFresh(fetchedAt) {
  return fetchedAt && Date.now() - fetchedAt < PROFILE_TTL_MS;
}

function dayFresh(fetchedAt) {
  return fetchedAt && Date.now() - fetchedAt < DAY_TTL_MS;
}

function logIntelError(tag, spot, err) {
  if (err?.status === 429) return;
  const name = spot?.name ?? spot?.id ?? 'spot';
  console.warn(`[${tag}] ${name}:`, err.message);
}

function intelUseSearchGrounding() {
  if (!profileEnabled()) return false;
  const raw = process.env.GEMINI_INTEL_USE_SEARCH;
  if (raw == null || raw === '') return true;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function isSearchQuotaError(err) {
  if (err?.status !== 429) return false;
  if (err?.quotaExceeded) return true;
  return /quota|rate limit|resource exhausted/i.test(String(err.message ?? ''));
}

async function generateSpotDetailsJson(userText) {
  const useSearch = intelUseSearchGrounding();
  const baseOpts = {
    systemInstruction: WATERSPORTS_SYSTEM,
    userText,
    tools: useSearch ? [{ google_search: {} }] : undefined,
  };

  try {
    return await generateJson(baseOpts);
  } catch (err) {
    if (useSearch && isSearchQuotaError(err)) {
      console.warn(
        '[spotIntelDetails] Search grounding hit quota — retrying with generateContent only (no search)'
      );
      return generateJson({
        systemInstruction: WATERSPORTS_SYSTEM,
        userText,
      });
    }
    throw err;
  }
}

function persistSpotDetailsPayload(db, spot, sessionDate, data) {
  const profile = data?.profile ?? data;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    setSpotIntelProfile(db, spot.id, {
      profile: JSON.stringify(profile),
      fetched_at: Date.now(),
      profile_version: 1,
    });

    const hintDirs = normalizeCompassDirections(profile.wind_hints?.ideal_directions?.value);
    mergeSpotIdealDirectionsIfEmpty(db, spot.id, hintDirs);
  }

  if (sessionDate && data?.day) {
    storeDayFromPayload(db, spot.id, sessionDate, data.day, data.signals);
  }
}

function storeDayFromPayload(db, spotId, sessionDate, day, signals) {
  const merged = mergeIntelSignals(signals ?? []);
  const headlineField = day?.headline?.value ?? day?.headline ?? null;

  setSpotIntelDayCache(db, spotId, sessionDate, {
    headline: typeof headlineField === 'string' ? headlineField : null,
    overall_level: merged.overall_level,
    day: JSON.stringify(day ?? {}),
    signals: JSON.stringify(merged.signals),
    fetched_at: Date.now(),
  });

  setSpotIntelCache(db, spotId, {
    fetched_at: Date.now(),
    headline: typeof headlineField === 'string' ? headlineField : null,
    overall_level: merged.overall_level,
    valid_for_date: sessionDate,
    signals: JSON.stringify(merged.signals),
  });

  return { day, signals: merged.signals, overall_level: merged.overall_level, headline: headlineField };
}

/**
 * One Gemini call when the user opens Spot Details — profile + optional day brief.
 * @param {import('better-sqlite3').Database} db
 * @param {object} spot
 * @param {string | null} sessionDate
 * @param {string} activeSport
 */
async function fetchSpotDetailsOnDemand(db, spot, sessionDate, activeSport = 'wingfoiling') {
  if (!profileEnabled()) return null;
  if (spot.latitude == null || spot.longitude == null) return null;

  const agent = buildWindmateAgentContext({ spot, activeSport });
  const daySection = sessionDate
    ? `"day": { "session_date": "${sessionDate}", "headline": AttributedField, "community_today": AttributedField, "fetched_posts_count": 0 },
  "signals": [ IntelSignal — category, level, summary, source_url, confidence, extracted_by ]`
    : `"day": null,
  "signals": []`;

  const userText = `Spot Details drawer (JSON only). One spot, user expanded details in the app.

Do NOT repeat map/scoring basics already on the spot row (name, coordinates, ideal_directions).
Focus: launch depth, parking, access, water hazards, live cam / wind graph links, community notes, wind narrative.

Every user-visible string: AttributedField with provenance (see spec). Synthesized fields need derivation.

Input:
${JSON.stringify(
  {
    windmate: agent,
    session_date: sessionDate,
    current_ideal_directions: spot.ideal_directions ?? [],
    direction_inference: spot.direction_inference ?? null,
    igetwind: spot.igetwind_id
      ? { igetwind_id: spot.igetwind_id, source_url: spot.source_url }
      : null,
  },
  null,
  2
)}

Return:
{
  "profile": SpotIntelProfile (meta, launch, access_and_hours, parking, water, media, community, wind_hints),
  ${daySection}
}

Mate tone for day headline when session_date is set. No fabricated closures without citations.`;

  const { data } = await generateSpotDetailsJson(userText);
  persistSpotDetailsPayload(db, spot, sessionDate, data);
  return data;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} spot
 * @param {string | null} sessionDate
 * @param {string} activeSport
 */
async function ensureSpotDetails(db, spot, sessionDate, activeSport = 'wingfoiling') {
  const profileRow = getSpotIntelProfile(db, spot.id);
  const dayRow = sessionDate ? getSpotIntelDayCache(db, spot.id, sessionDate) : null;
  const needsProfile = !profileFresh(profileRow?.fetched_at);
  const needsDay = sessionDate ? !dayFresh(dayRow?.fetched_at) : false;

  if (!needsProfile && !needsDay) {
    return { fetched: false };
  }

  const key = `${spot.id}:${sessionDate ?? ''}`;
  if (detailInFlight.has(key)) {
    return detailInFlight.get(key);
  }

  const task = fetchSpotDetailsOnDemand(db, spot, sessionDate, activeSport)
    .then((data) => ({ fetched: true, data }))
    .catch((err) => {
      logIntelError('spotIntelDetails', spot, err);
      return { fetched: false, error: err };
    })
    .finally(() => detailInFlight.delete(key));

  detailInFlight.set(key, task);
  return task;
}

function parseProfileRow(row) {
  if (!row?.profile) return null;
  try {
    return JSON.parse(row.profile);
  } catch {
    return null;
  }
}

function parseDayRow(row) {
  if (!row) return { day: null, signals: [], headline: null, overall_level: 'unknown' };
  let day = null;
  let signals = [];
  try {
    day = row.day ? JSON.parse(row.day) : null;
  } catch {
    day = null;
  }
  try {
    signals = row.signals ? JSON.parse(row.signals) : [];
  } catch {
    signals = [];
  }
  return {
    day,
    signals,
    headline: row.headline,
    overall_level: row.overall_level ?? 'unknown',
    fetched_at: row.fetched_at,
  };
}

module.exports = {
  profileEnabled,
  intelUseSearchGrounding,
  profileFresh,
  dayFresh,
  ensureSpotDetails,
  fetchSpotDetailsOnDemand,
  parseProfileRow,
  parseDayRow,
};
