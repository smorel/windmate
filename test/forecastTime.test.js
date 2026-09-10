const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  localDateString,
  isSessionPlanningHour,
  isElapsedLocalDayHour,
} = require('../src/utils/forecastTime');

describe('localDateString', () => {
  it('formats the local calendar date', () => {
    const d = new Date(2026, 8, 9, 20, 34);
    assert.equal(localDateString(d), '2026-09-09');
  });

  it('does not use UTC toISOString slice', () => {
    const d = new Date(2026, 8, 9, 20, 34);
    assert.notEqual(localDateString(d), d.toISOString().slice(0, 10));
  });
});

describe('isSessionPlanningHour', () => {
  const sessionDate = '2026-09-10';
  const noon = new Date(2026, 8, 10, 12, 17);

  it('treats earlier hours on today as not available for planning', () => {
    assert.equal(isElapsedLocalDayHour('2026-09-10T08:00', sessionDate, noon), true);
    assert.equal(isSessionPlanningHour('2026-09-10T08:00', sessionDate, noon), false);
    assert.equal(isSessionPlanningHour('2026-09-10T12:00', sessionDate, noon), true);
    assert.equal(isSessionPlanningHour('2026-09-10T14:00', sessionDate, noon), true);
  });

  it('keeps all hours on future session dates', () => {
    assert.equal(isSessionPlanningHour('2026-09-11T08:00', '2026-09-11', noon), true);
  });
});
