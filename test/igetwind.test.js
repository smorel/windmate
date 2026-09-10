const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindData } = require('../src/services/igetwind');

describe('normalizeWindData WINDP', () => {
  it('parses WINDP as wind probability, not wind speed', () => {
    const block = {
      winddata: [
        { ty: 'WIND', t: '2026-09-12 10:00', v: 5 },
        { ty: 'WINDP', t: '2026-09-12 10:00', v: 80 },
        { ty: 'GUST', t: '2026-09-12 10:00', v: 7 },
        { ty: 'WDIR', t: '2026-09-12 10:00', v: 270 },
      ],
    };
    const { hourly } = normalizeWindData(block, 'lam');
    assert.equal(hourly.wind_probability_10m[0], 0.8);
    assert.ok(hourly.wind_speed_10m[0] < 15);
  });

  it('omits wind_probability_10m when no WINDP rows exist', () => {
    const block = {
      winddata: [{ ty: 'WIND', t: '2026-09-12 10:00', v: 5 }],
    };
    const { hourly } = normalizeWindData(block, 'gfs');
    assert.equal(hourly.wind_probability_10m, undefined);
  });
});

describe('normalizeWindData partial hours', () => {
  const MS_TO_KNOTS = 1.94384;

  it('interpolates wind and gust when only direction is present at a timestep', () => {
    const block = {
      winddata: [
        { ty: 'WIND', t: '2026-09-12 11:00', v: 10 },
        { ty: 'GUST', t: '2026-09-12 11:00', v: 12 },
        { ty: 'WDIR', t: '2026-09-12 12:00', v: 270 },
        { ty: 'WIND', t: '2026-09-12 13:00', v: 14 },
        { ty: 'GUST', t: '2026-09-12 13:00', v: 16 },
      ],
    };
    const { hourly } = normalizeWindData(block, 'lam');
    assert.equal(hourly.time.length, 3);
    assert.equal(hourly.time[1], '2026-09-12T12:00');
    assert.equal(hourly.wind_direction_10m[1], 270);
    const expectedWind = 12 * MS_TO_KNOTS;
    assert.ok(Math.abs(hourly.wind_speed_10m[1] - expectedWind) < 0.05);
    assert.ok(Math.abs(hourly.wind_gusts_10m[1] - 14 * MS_TO_KNOTS) < 0.05);
  });

  it('drops timesteps with no wind samples and nothing to interpolate from', () => {
    const block = {
      winddata: [{ ty: 'WDIR', t: '2026-09-12 12:00', v: 90 }],
    };
    const { hourly } = normalizeWindData(block, 'gfs');
    assert.equal(hourly.time.length, 0);
  });

  it('uses neighbor wind when gust is missing at a timestep', () => {
    const block = {
      winddata: [
        { ty: 'WIND', t: '2026-09-12 11:00', v: 8 },
        { ty: 'GUST', t: '2026-09-12 11:00', v: 10 },
        { ty: 'WIND', t: '2026-09-12 12:00', v: 10 },
        { ty: 'WIND', t: '2026-09-12 13:00', v: 12 },
        { ty: 'GUST', t: '2026-09-12 13:00', v: 14 },
      ],
    };
    const { hourly } = normalizeWindData(block, 'gfs');
    const gustMid = hourly.wind_gusts_10m[1];
    assert.ok(Math.abs(gustMid - 12 * MS_TO_KNOTS) < 0.05);
  });
});
