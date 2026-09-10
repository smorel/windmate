const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindData, repairIgetwindHourly } = require('../src/services/igetwind');

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

  it('interpolates direction when WIND is present but WDIR is missing', () => {
    const block = {
      winddata: [
        { ty: 'WIND', t: '2026-09-10 11:00', v: 10 },
        { ty: 'GUST', t: '2026-09-10 11:00', v: 12 },
        { ty: 'WDIR', t: '2026-09-10 11:00', v: 260 },
        { ty: 'WIND', t: '2026-09-10 12:00', v: 10 },
        { ty: 'GUST', t: '2026-09-10 12:00', v: 12 },
        { ty: 'WIND', t: '2026-09-10 13:00', v: 10 },
        { ty: 'GUST', t: '2026-09-10 13:00', v: 12 },
        { ty: 'WDIR', t: '2026-09-10 13:00', v: 280 },
      ],
    };
    const { hourly } = normalizeWindData(block, 'hrrr');
    assert.equal(hourly.wind_direction_10m[1], 270);
  });

  it('repairs legacy cached hours with placeholder 0° direction', () => {
    const hourly = {
      time: ['2026-09-10T12:00:00', '2026-09-10T13:00:00', '2026-09-10T14:00:00'],
      wind_speed_10m: [14, 10.5, 15],
      wind_gusts_10m: [20, 15, 22],
      wind_direction_10m: [270, 0, 268],
    };
    const repaired = repairIgetwindHourly(hourly);
    assert.equal(repaired.time[1], '2026-09-10T13:00');
    assert.equal(repaired.wind_direction_10m[1], 269);
  });

  it('does not create an hour from WINDP-only rows', () => {
    const block = {
      winddata: [
        { ty: 'WIND', t: '2026-09-10 11:00', v: 8 },
        { ty: 'GUST', t: '2026-09-10 11:00', v: 10 },
        { ty: 'WDIR', t: '2026-09-10 11:00', v: 270 },
        { ty: 'WINDP', t: '2026-09-10 12:00', v: 40 },
        { ty: 'WIND', t: '2026-09-10 13:00', v: 9 },
        { ty: 'GUST', t: '2026-09-10 13:00', v: 11 },
        { ty: 'WDIR', t: '2026-09-10 13:00', v: 275 },
      ],
    };
    const { hourly } = normalizeWindData(block, 'hrrr');
    assert.deepEqual(hourly.time, ['2026-09-10T11:00', '2026-09-10T13:00']);
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
