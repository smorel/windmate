const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  warningsWithinWindow,
  observationCoversSessionDay,
  attachSessionGoNoGoByDate,
} = require('../src/services/sessionGoNoGo');
const { computeSessionGoNoGoScore, longestConsensusWindowLength } = require('../src/services/sessionRank');
const { markInRideableWindow } = require('../src/utils/rideableWindow');

describe('markInRideableWindow', () => {
  it('marks every qualifying run, not only the longest block', () => {
    const hours = [
      { time: '2026-09-11T09:00', rideable: true },
      { time: '2026-09-11T10:00', rideable: true },
      { time: '2026-09-11T11:00', rideable: true },
      { time: '2026-09-11T12:00', rideable: true },
      { time: '2026-09-11T13:00', rideable: false },
      { time: '2026-09-11T17:00', rideable: true },
      { time: '2026-09-11T18:00', rideable: true },
      { time: '2026-09-11T19:00', rideable: true },
    ];
    markInRideableWindow(hours, 2);
    const marked = hours.filter((h) => h.inRideableWindow).map((h) => h.time.slice(11, 16));
    assert.deepEqual(marked, ['09:00', '10:00', '11:00', '12:00', '17:00', '18:00', '19:00']);
  });
});

describe('attachSessionGoNoGoByDate', () => {
  it('matches longestConsensusWindowLength for multi-model days', () => {
    const prefs = {
      min_rideable_window_hours: 2,
      min_wind_knots: 12,
      max_gust_knots: 50,
      radius_km: 50,
      rank_criteria_order: ['wind', 'gust', 'bestWindow'],
    };
    const hour = (time, rideable = true) => ({
      time,
      rideable,
      windOk: rideable,
      weatherOk: true,
      tempOk: true,
      windSpeed: 16,
      gusts: 22,
      windExposure: 'onshore',
    });
    const dayHours = Array.from({ length: 8 }, (_, i) =>
      hour(`2026-09-11T${String(9 + i).padStart(2, '0')}:00`)
    );
    const rideEntry = {
      spot: { ideal_directions: ['E'], distance_km: 10 },
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: '2026-09-11', hours: dayHours }] },
        'open-meteo': { days: [{ date: '2026-09-11', hours: dayHours }] },
      },
      days: [{ date: '2026-09-11' }],
    };
    const attached = attachSessionGoNoGoByDate(rideEntry, prefs);
    const expectedLen = longestConsensusWindowLength(rideEntry, '2026-09-11', 2);
    assert.equal(attached['2026-09-11'].windowHours, expectedLen);
    assert.ok(attached['2026-09-11'].windowHours >= 2);
  });
});

describe('warningsWithinWindow', () => {
  it('ignores hazards after the consensus window ends', () => {
    const warnings = [
      {
        type: 'wind_fading',
        eventTime: '2026-09-10T21:00',
        message: "Wind's dying below 12 kt around 21:00.",
      },
    ];
    const windowSpan = { start: '2026-09-10T08:00', end: '2026-09-10T19:00', length: 12 };
    assert.equal(warningsWithinWindow(warnings, windowSpan).length, 0);
  });

  it('keeps hazards during the consensus window', () => {
    const warnings = [
      {
        type: 'storm_approaching',
        eventTime: '2026-09-10T14:00',
        message: 'Heads up mate — storm around 14:00.',
      },
    ];
    const windowSpan = { start: '2026-09-10T08:00', end: '2026-09-10T19:00', length: 12 };
    assert.equal(warningsWithinWindow(warnings, windowSpan).length, 1);
  });
});

describe('observationCoversSessionDay', () => {
  it('returns false when live hours are for a different calendar day', () => {
    const observation = {
      today: {
        forecast: [{ time: '2026-09-09T18:00', windSpeed: 8 }],
        summary: { mismatch: { state: 'caution' } },
      },
    };
    assert.equal(observationCoversSessionDay(observation, '2026-09-10'), false);
  });

  it('returns true when live hours match the session date', () => {
    const observation = {
      today: {
        forecast: [{ time: '2026-09-10T08:00', windSpeed: 12 }],
        summary: { mismatch: { state: 'caution' } },
      },
    };
    assert.equal(observationCoversSessionDay(observation, '2026-09-10'), true);
  });
});

describe('computeSessionGoNoGoScore', () => {
  const prefs = {
    sport: 'wingfoiling',
    min_wind_knots: 12,
    max_gust_knots: 35,
    min_rideable_window_hours: 2,
    radius_km: 50,
    rank_criteria_order: ['rideability', 'bestWindow', 'proximity', 'wind', 'gust', 'onshore', 'waveMatch'],
  };

  const entry = {
    spot: { ideal_directions: ['SW'], distance_km: 49 },
    primaryModel: 'gfs',
    models: {
      gfs: {
        days: [
          {
            date: '2026-09-10',
            hours: Array.from({ length: 12 }, (_, i) => ({
              time: `2026-09-10T${String(8 + i).padStart(2, '0')}:00`,
              rideable: true,
              windOk: true,
              weatherOk: true,
              tempOk: true,
              windSpeed: 16,
              gusts: 22,
              windExposure: 'onshore',
              idealWind: true,
            })),
          },
        ],
      },
    },
    days: [],
  };

  it('does not penalize distance when proximity is ranked highly', () => {
    const withProximity = computeSessionGoNoGoScore(entry, '2026-09-10', prefs, 50).score;
    assert.ok(withProximity >= 0.55);
  });
});
