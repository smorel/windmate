const { computeSessionScore, longestConsensusWindowLength, getDayHours } = require('./sessionRank');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { computeMismatch } = require('./mismatch');
const { todayIsoDate } = require('../db');

const STATUS_RANK = {
  on_track: 0,
  degrading: 1,
  at_risk: 2,
  no_go: 3,
  unknown: 4,
};

const ON_TRACK_MIN_SCORE = parseFloat(process.env.WATCHLIST_STATUS_ON_TRACK_MIN_SCORE ?? '0.55');
const DEGRADING_SCORE_DELTA = parseFloat(process.env.WATCHLIST_DEGRADING_SCORE_DELTA ?? '0.1');

function formatWindRange(hours) {
  const rideable = hours.filter((h) => h.rideable);
  if (!rideable.length) return null;
  const winds = rideable.map((h) => h.windSpeed ?? 0);
  const min = Math.round(Math.min(...winds));
  const max = Math.round(Math.max(...winds));
  return { min, max, count: rideable.length };
}

/**
 * @param {object} session watched session row
 * @param {object} rideEntry rideability entry for spot
 * @param {object} prefs sport profile
 * @param {object|null} observation observation entry for session day
 */
function evaluateWatchlistStatus(session, rideEntry, prefs, observation = null) {
  const minWindow = parseMinRideableWindowHours(prefs.min_rideable_window_hours);
  const dateStr = session.session_date;
  const hours = getDayHours(rideEntry, dateStr);
  const windowHours = longestConsensusWindowLength(rideEntry, dateStr, minWindow);
  const { score, metrics } = computeSessionScore(rideEntry, dateStr, prefs, prefs.radius_km);
  const windRange = formatWindRange(hours);

  const snapshot = {
    score,
    windowHours,
    rideableCount: metrics.rideableCount,
    maxWind: metrics.maxWind,
    windMin: windRange?.min ?? null,
    windMax: windRange?.max ?? null,
  };

  let status = 'unknown';
  let statusTrend = 'new';

  if (windowHours < minWindow || score < ON_TRACK_MIN_SCORE * 0.85) {
    status = 'no_go';
  } else if (windowHours <= minWindow || score < ON_TRACK_MIN_SCORE) {
    status = 'at_risk';
  } else {
    status = 'on_track';
  }

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

  if (session.session_date === todayIsoDate() && observation?.today?.summary?.mismatch) {
    const mismatch = observation.today.summary.mismatch;
    if (mismatch.state === 'no_go') status = 'no_go';
    else if (mismatch.state === 'caution' && status === 'on_track') status = 'degrading';
    snapshot.mismatch = mismatch;
  }

  return {
    status,
    statusTrend,
    snapshot,
    summary: {
      score,
      windowHours,
      windRange,
      rankLabel: score,
    },
  };
}

function mismatchBannerCopy(mismatch, current) {
  if (!mismatch) return null;
  if (mismatch.state === 'go') {
    return `Looking good mate — ${Math.round(current?.windSpeed ?? 0)} kt, forecast nailed it.`;
  }
  if (mismatch.state === 'caution') {
    const forecastKt =
      current?.deltaKt != null
        ? Math.round((current.windSpeed - current.deltaKt) * 10) / 10
        : '?';
    return `Forecast said ${forecastKt} kt — only seeing ${Math.round(current?.windSpeed ?? 0)}. Might be thin.`;
  }
  if (mismatch.state === 'no_go') {
    return "Don't bother mate — forecast oversold it.";
  }
  return "Can't tell you what's happening right now — don't trust forecast alone.";
}

module.exports = {
  evaluateWatchlistStatus,
  mismatchBannerCopy,
  ON_TRACK_MIN_SCORE,
};
