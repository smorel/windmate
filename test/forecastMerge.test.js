const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeHourlySeries, mergeForecastElapsedToday } = require('../src/services/forecastMerge');
const { currentLocalHourStartKey } = require('../src/utils/forecastTime');
const { allReportingModelsRideable } = require('../src/utils/rideableWindow');

describe('mergeHourlySeries', () => {
  it('keeps the higher wind and gust for elapsed hours on today', () => {
    const now = new Date(2026, 8, 12, 15, 0, 0);
    const today = '2026-09-12';
    const cutover = currentLocalHourStartKey(now);
    const prev = {
      time: ['2026-09-12T08:00', '2026-09-12T16:00'],
      wind_speed_10m: [18, 14],
      wind_gusts_10m: [24, 18],
      wind_direction_10m: [270, 270],
    };
    const next = {
      time: ['2026-09-12T08:00', '2026-09-12T16:00'],
      wind_speed_10m: [9, 20],
      wind_gusts_10m: [12, 22],
      wind_direction_10m: [270, 270],
    };

    const merged = mergeHourlySeries(prev, next, today, cutover);
    assert.equal(merged.wind_speed_10m[0], 18);
    assert.equal(merged.wind_gusts_10m[0], 24);
    assert.equal(merged.wind_speed_10m[1], 20);
  });
});

describe('mergeForecastElapsedToday', () => {
  it('merges each model hourly series in mixed forecasts', () => {
    const now = new Date(2026, 8, 12, 15, 0, 0);
    const previous = {
      models: {
        gfs: {
          hourly: {
            time: ['2026-09-12T09:00'],
            wind_speed_10m: [17],
            wind_gusts_10m: [28],
            wind_direction_10m: [260],
          },
        },
      },
    };
    const next = {
      models: {
        gfs: {
          hourly: {
            time: ['2026-09-12T09:00'],
            wind_speed_10m: [10],
            wind_gusts_10m: [15],
            wind_direction_10m: [260],
          },
        },
      },
    };

    const merged = mergeForecastElapsedToday(previous, next, now);
    assert.equal(merged.models.gfs.hourly.wind_speed_10m[0], 17);
  });
});

describe('allReportingModelsRideable', () => {
  it('requires every reporting model to agree on future hours today', () => {
    const key = '2026-09-12T16:00';
    const now = new Date(2026, 8, 12, 15, 0, 0);
    const low = new Map([[key, { rideable: false, windOk: true }]]);
    const good = new Map([[key, { rideable: true, windOk: true }]]);

    assert.equal(
      allReportingModelsRideable([low, good], key, { today: '2026-09-12', now }),
      false
    );
    assert.equal(
      allReportingModelsRideable([good], key, { today: '2026-09-12', now }),
      true
    );
  });

  it('never counts elapsed hours on today as rideable for session planning', () => {
    const key = '2026-09-12T08:00';
    const now = new Date(2026, 8, 12, 15, 0, 0);
    const good = new Map([[key, { rideable: true, windOk: true }]]);

    assert.equal(
      allReportingModelsRideable([good], key, { today: '2026-09-12', now }),
      false
    );
  });
});
