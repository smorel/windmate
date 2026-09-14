const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createCurveXScale,
  filterCurveDaylightHours,
} = require('../src/utils/curveTimeAxis');

describe('curveTimeAxis', () => {
  it('maps the same hour key to the same x for full-day mode', () => {
    const slots = [{ time: '2026-09-14T07:00' }, { time: '2026-09-14T08:00' }];
    const scale = createCurveXScale({
      slots,
      padL: 44,
      innerW: 584,
      hideNightHours: false,
    });
    const xActual = scale.xForTime('2026-09-14T07:00');
    const xForecast = scale.xForTime('2026-09-14T07:00');
    assert.equal(xActual, xForecast);
    assert.ok(xActual > 44);
  });

  it('compresses daylight hours to fill the chart width', () => {
    const slots = [
      { time: '2026-09-14T06:00', daylightOk: true },
      { time: '2026-09-14T07:00', daylightOk: true },
      { time: '2026-09-14T08:00', daylightOk: true },
    ];
    const scale = createCurveXScale({
      slots,
      padL: 0,
      innerW: 300,
      hideNightHours: true,
    });
    assert.equal(scale.xForSlotStart('2026-09-14T06:00'), 0);
    assert.equal(scale.xForSlotStart('2026-09-14T08:00'), 200);
    assert.equal(scale.xForTime('2026-09-14T07:00'), 150);
  });

  it('filters night hours for daylight-only curves', () => {
    const hours = [
      { time: '2026-09-14T05:00', daylightOk: false },
      { time: '2026-09-14T08:00', daylightOk: true },
    ];
    const filtered = filterCurveDaylightHours(hours, true);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].time, '2026-09-14T08:00');
  });
});
