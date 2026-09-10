const { computeSessionScore, longestConsensusWindowLength, getDayHours } = require('./sessionRank');
const { computeExcitementFromEntry } = require('./sessionExcitement');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { computeSessionGoNoGo, rideableWindRange } = require('./sessionGoNoGo');

const STATUS_RANK = {
  on_track: 0,
  degrading: 1,
  at_risk: 2,
  no_go: 3,
  unknown: 4,
};

const ON_TRACK_MIN_SCORE = parseFloat(process.env.WATCHLIST_STATUS_ON_TRACK_MIN_SCORE ?? '0.55');
const DEGRADING_SCORE_DELTA = parseFloat(process.env.WATCHLIST_DEGRADING_SCORE_DELTA ?? '0.1');

function goNoGoToWatchStatus(goNoGoState) {
  if (goNoGoState === 'go') return 'on_track';
  if (goNoGoState === 'caution') return 'at_risk';
  if (goNoGoState === 'no_go') return 'no_go';
  return 'unknown';
}

/**
 * @param {object} session watched session row
 * @param {object} rideEntry rideability entry for spot
 * @param {object} prefs sport profile
 * @param {object|null} observation observation entry for session day
 */
function evaluateWatchlistStatus(session, rideEntry, prefs, observation = null) {
  const dateStr = session.session_date;
  const hours = getDayHours(rideEntry, dateStr);
  const minWindow = parseMinRideableWindowHours(prefs.min_rideable_window_hours);
  const windowHours = longestConsensusWindowLength(rideEntry, dateStr, minWindow);
  const { score, metrics } = computeSessionScore(rideEntry, dateStr, prefs, prefs.radius_km);
  const windRange = rideableWindRange(hours);
  const sessionGoNoGo = computeSessionGoNoGo({
    rideEntry,
    sessionDate: dateStr,
    prefs,
    observation,
  });

  const snapshot = {
    score,
    windowHours,
    rideableCount: metrics.rideableCount,
    maxWind: metrics.maxWind,
    windMin: windRange?.min ?? null,
    windMax: windRange?.max ?? null,
    goNoGo: sessionGoNoGo.state,
  };

  let status = goNoGoToWatchStatus(sessionGoNoGo.state);
  let statusTrend = 'new';

  const prev = session.status_snapshot;
  if (prev) {
    if (score < prev.score - DEGRADING_SCORE_DELTA || windowHours < prev.windowHours - 0.5) {
      status = status === 'on_track' ? 'degrading' : status;
      statusTrend = 'degrading';
    } else if (score > prev.score + DEGRADING_SCORE_DELTA) {
      statusTrend = 'improving';
    } else {
      statusTrend = 'stable';
    }
    if (STATUS_RANK[status] > STATUS_RANK[session.last_status ?? 'on_track']) {
      statusTrend = 'degrading';
    }
  }

  if (observation?.today?.summary?.mismatch) {
    snapshot.mismatch = observation.today.summary.mismatch;
  }

  const excitement = computeExcitementFromEntry(rideEntry, dateStr, prefs, prefs.radius_km);

  return {
    status,
    statusTrend,
    snapshot,
    sessionGoNoGo,
    excitement,
    summary: {
      score,
      windowHours,
      windRange,
      rankLabel: score,
    },
  };
}

module.exports = {
  evaluateWatchlistStatus,
  ON_TRACK_MIN_SCORE,
};
