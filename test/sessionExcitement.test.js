const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeExcitement,
  buildAnchorMinFactors,
  buildAnchorMaxFactors,
  resolveStickerKey,
  pickBestHorizonExcitement,
  computeExcitementFromEntry,
} = require('../src/services/sessionExcitement');

const basePrefs = {
  sport: 'wingfoiling',
  min_wind_knots: 12,
  max_gust_knots: 40,
  min_rideable_window_hours: 2,
  rank_criteria_order: ['rideability', 'bestWindow', 'wind', 'gust', 'onshore', 'waveMatch'],
};

describe('sessionExcitement', () => {
  it('returns bust when no qualifying window', () => {
    const min = buildAnchorMinFactors(basePrefs);
    const result = computeExcitement({
      rideableCount: 0,
      factors: min,
      prefs: basePrefs,
    });
    assert.equal(result.tier, 'bust');
    assert.equal(result.flair, null);
  });

  it('returns no tier at anchor minimum factors', () => {
    const min = buildAnchorMinFactors(basePrefs);
    const result = computeExcitement({
      rideableCount: 2,
      factors: min,
      prefs: basePrefs,
    });
    assert.equal(result.tier, null);
    assert.equal(result.t, 0);
  });

  it('assigns higher tier when factors approach max', () => {
    const max = buildAnchorMaxFactors();
    const high = computeExcitement({
      rideableCount: 8,
      factors: max,
      prefs: basePrefs,
    });
    assert.equal(high.tier, 'epic');
    assert.ok(high.tPrime >= 0.75);

    const mid = computeExcitement({
      rideableCount: 4,
      factors: {
        rideability: 0.5,
        bestWindow: 0.5,
        wind: 0.55,
        gust: 0.55,
        onshore: 0.8,
        waveMatch: 0.9,
      },
      prefs: basePrefs,
    });
    assert.ok(mid.tier);
    if (high.tier && mid.tier) {
      const rank = { cool: 1, nice: 2, amazing: 3, epic: 4 };
      assert.ok(rank[high.tier] >= rank[mid.tier]);
    }
  });

  it('horizon picker ignores bust from non-rideable spots when the day is rideable', () => {
    const dateStr = '2026-09-15';
    const prefs = { ...basePrefs, min_wind_knots: 12, max_gust_knots: 40 };
    const bustHour = (time) => ({
      time,
      rideable: false,
      windOk: false,
      weatherOk: true,
      tempOk: true,
      windSpeed: 6,
      gusts: 8,
    });
    const floorHour = (time) => ({
      time,
      rideable: true,
      windOk: true,
      weatherOk: true,
      tempOk: true,
      windSpeed: 12,
      gusts: 12,
      windExposure: 'onshore',
    });
    const dayHours = [
      floorHour(`${dateStr}T09:00`),
      floorHour(`${dateStr}T10:00`),
      bustHour(`${dateStr}T11:00`),
    ];
    const rideableEntry = {
      spot: { ideal_directions: ['E'], distance_km: 5 },
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: dateStr, hours: dayHours }] },
        'open-meteo': { days: [{ date: dateStr, hours: dayHours }] },
      },
      days: [{ date: dateStr }],
    };
    const noWindowEntry = {
      spot: { ideal_directions: ['E'], distance_km: 20 },
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: dateStr, hours: dayHours.map((h) => bustHour(h.time)) }] },
        'open-meteo': { days: [{ date: dateStr, hours: dayHours.map((h) => bustHour(h.time)) }] },
      },
      days: [{ date: dateStr }],
    };

    assert.equal(computeExcitementFromEntry(noWindowEntry, dateStr, prefs, 50).tier, 'bust');

    const horizon = pickBestHorizonExcitement(
      [noWindowEntry, rideableEntry],
      dateStr,
      prefs,
      50,
      2
    );
    assert.notEqual(horizon.tier, 'bust');
  });

  it('can assign quick-hit flair for strong short session', () => {
    const result = computeExcitement({
      rideableCount: 3,
      factors: {
        rideability: 0.2,
        bestWindow: 0.25,
        wind: 0.95,
        gust: 0.95,
        onshore: 0.9,
        waveMatch: 0.95,
      },
      prefs: basePrefs,
    });
    assert.ok(result.tier);
    assert.equal(result.flair, 'quick-hit');
    assert.equal(result.stickerKey, resolveStickerKey(result.tier, result.flair));
    assert.match(result.stickerKey, /^.+--quick-hit$/);
  });
});
