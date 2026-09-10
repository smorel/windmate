const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { warningsWithinWindow, observationCoversSessionDay } = require('../src/services/sessionGoNoGo');
const { computeSessionGoNoGoScore } = require('../src/services/sessionRank');

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
