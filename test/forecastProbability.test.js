const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sessionForecastProbability,
  maxSessionProbabilityForDay,
  colorForProbability,
  modelQuorumProbability,
} = require('../src/services/forecastProbability');

const prefs = { min_rideable_window_hours: 2, min_wind_knots: 12, max_gust_knots: 50 };

function hour(time, rideable) {
  return {
    time,
    rideable,
    windOk: rideable,
    weatherOk: true,
    tempOk: true,
    windSpeed: rideable ? 16 : 8,
    gusts: 20,
    windExposure: 'onshore',
  };
}

describe('modelQuorumProbability', () => {
  it('is the fraction of models with a qualifying rideable window', () => {
    const twoHour = [hour('2026-09-11T10:00', true), hour('2026-09-11T11:00', true)];
    const oneHour = [hour('2026-09-11T10:00', true), hour('2026-09-11T11:00', false)];
    const entry = {
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: '2026-09-11', hours: twoHour }] },
        lam: { days: [{ date: '2026-09-11', hours: oneHour }] },
      },
    };
    assert.equal(modelQuorumProbability(entry, '2026-09-11', prefs), 0.5);
  });
});

describe('sessionForecastProbability', () => {
  it('requires a consensus window and returns quorum when no explicit probability', () => {
    const dayHours = [
      hour('2026-09-11T10:00', true),
      hour('2026-09-11T11:00', true),
    ];
    const entry = {
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: '2026-09-11', hours: dayHours }] },
        lam: { days: [{ date: '2026-09-11', hours: dayHours }] },
      },
    };
    assert.equal(sessionForecastProbability(entry, '2026-09-11', prefs), 1);
  });

  it('is zero when consensus window is too short', () => {
    const split = [
      hour('2026-09-11T10:00', true),
      hour('2026-09-11T11:00', false),
    ];
    const entry = {
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: '2026-09-11', hours: split }] },
        lam: { days: [{ date: '2026-09-11', hours: split }] },
      },
    };
    assert.equal(sessionForecastProbability(entry, '2026-09-11', prefs), 0);
  });
});

describe('maxSessionProbabilityForDay', () => {
  it('returns the highest session probability among qualifying spots', () => {
    const strong = {
      primaryModel: 'gfs',
      models: {
        gfs: {
          days: [
            {
              date: '2026-09-11',
              hours: [hour('2026-09-11T10:00', true), hour('2026-09-11T11:00', true)],
            },
          ],
        },
        lam: {
          days: [
            {
              date: '2026-09-11',
              hours: [hour('2026-09-11T10:00', true), hour('2026-09-11T11:00', true)],
            },
          ],
        },
      },
    };
    const weak = {
      primaryModel: 'gfs',
      models: {
        gfs: {
          days: [
            {
              date: '2026-09-11',
              hours: [hour('2026-09-11T14:00', true), hour('2026-09-11T15:00', true)],
            },
          ],
        },
        lam: {
          days: [
            {
              date: '2026-09-11',
              hours: [hour('2026-09-11T14:00', false), hour('2026-09-11T15:00', true)],
            },
          ],
        },
      },
    };
    const max = maxSessionProbabilityForDay([weak, strong], '2026-09-11', prefs);
    assert.equal(max, 1);
  });
});

describe('colorForProbability', () => {
  it('maps quartile bands to Beaufort palette colors', () => {
    assert.equal(colorForProbability(0.1), '#c64e36');
    assert.equal(colorForProbability(0.3), '#3d70b6');
    assert.equal(colorForProbability(0.6), '#8a4a90');
    assert.equal(colorForProbability(0.9), '#60a059');
  });
});
