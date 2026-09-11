const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindData } = require('../src/services/igetwind');
const {
  buildWeatherConsensusByTime,
  majorityRequired,
  lookupWeatherConsensus,
} = require('../src/services/weatherConsensus');
const { buildContextByTime } = require('../src/services/temperature');

describe('normalizeWindData APCP', () => {
  it('derives hourly precipitation increments from cumulative APCP', () => {
    const block = {
      winddata: [
        { ty: 'WIND', t: '2026-09-13 02:00:00', v: 5 },
        { ty: 'GUST', t: '2026-09-13 02:00:00', v: 6 },
        { ty: 'WDIR', t: '2026-09-13 02:00:00', v: 270 },
        { ty: 'APCP', t: '2026-09-13 02:00:00', v: 0.0625 },
        { ty: 'WIND', t: '2026-09-13 03:00:00', v: 5 },
        { ty: 'GUST', t: '2026-09-13 03:00:00', v: 6 },
        { ty: 'WDIR', t: '2026-09-13 03:00:00', v: 270 },
        { ty: 'APCP', t: '2026-09-13 03:00:00', v: 0.75 },
      ],
    };
    const { hourly } = normalizeWindData(block, 'gfs');
    assert.equal(hourly.precipitation[0], 0);
    assert.ok(Math.abs(hourly.precipitation[1] - 0.6875) < 0.001);
  });
});

describe('majorityRequired', () => {
  it('requires more than half of reporting sources', () => {
    assert.equal(majorityRequired(1), 1);
    assert.equal(majorityRequired(2), 2);
    assert.equal(majorityRequired(3), 2);
    assert.equal(majorityRequired(4), 3);
  });
});

describe('buildWeatherConsensusByTime', () => {
  const contextData = {
    hourly: {
      time: ['2026-09-12T18:00', '2026-09-12T19:00', '2026-09-13T08:00'],
      precipitation: [0, 0, 0.8],
      weather_code: [3, 3, 53],
    },
  };
  const contextByTime = buildContextByTime(contextData);

  it('does not flag rain when only one of two sources is wet (majority dry)', () => {
    const mixed = {
      models: {
        gfs: {
          hourly: {
            time: ['2026-09-12T18:00', '2026-09-12T19:00'],
            precipitation: [0.5, 0],
            wind_speed_10m: [10, 10],
            wind_gusts_10m: [12, 12],
            wind_direction_10m: [270, 270],
          },
        },
      },
    };
    const map = buildWeatherConsensusByTime(mixed, contextByTime);
    const hour18 = lookupWeatherConsensus(map, '2026-09-12T18:00');
    assert.equal(hour18.hasForecastRain, false);
    assert.equal(hour18.weatherOk, true);
  });

  it('flags rain when majority sources are rainy', () => {
    const mixed = {
      models: {
        gfs: {
          hourly: {
            time: ['2026-09-13T08:00'],
            precipitation: [0.5],
            wind_speed_10m: [10],
            wind_gusts_10m: [12],
            wind_direction_10m: [270],
          },
        },
        lam: {
          hourly: {
            time: ['2026-09-13T08:00'],
            precipitation: [0.4],
            wind_speed_10m: [10],
            wind_gusts_10m: [12],
            wind_direction_10m: [270],
          },
        },
      },
    };
    const map = buildWeatherConsensusByTime(mixed, contextByTime);
    const hour = lookupWeatherConsensus(map, '2026-09-13T08:00');
    assert.equal(hour.hasForecastRain, true);
    assert.equal(hour.weatherOk, false);
    assert.equal(hour.weatherConsensus.rainy, 3);
  });

  it('hard-blocks weatherOk on Open-Meteo storm code regardless of majority', () => {
    const stormContext = buildContextByTime({
      hourly: {
        time: ['2026-09-12T14:00'],
        precipitation: [0],
        weather_code: [95],
      },
    });
    const mixed = {
      models: {
        gfs: {
          hourly: {
            time: ['2026-09-12T14:00'],
            precipitation: [0],
            wind_speed_10m: [10],
            wind_gusts_10m: [12],
            wind_direction_10m: [270],
          },
        },
      },
    };
    const map = buildWeatherConsensusByTime(mixed, stormContext);
    const hour = lookupWeatherConsensus(map, '2026-09-12T14:00');
    assert.equal(hour.weatherOk, false);
    assert.equal(hour.weatherConsensus.storm, 1);
  });
});
