const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  showMatrixCriterionSegment,
  filterMatrixSpotsForDay,
  filterMatrixPlanningHours,
  buildPlanningHourConditionStats,
  formatPlanningHourConditionSummary,
} = require('../src/utils/plannerFullDay');

describe('showMatrixCriterionSegment', () => {
  const hour = { rideable: false, windSpeed: 8, gusts: 12 };

  it('shows rideable hours when full-day mode is off', () => {
    assert.equal(showMatrixCriterionSegment({ rideable: true, windSpeed: 8 }, false, false), true);
    assert.equal(showMatrixCriterionSegment(hour, false, false), false);
  });

  it('shows any hour with forecast data when full-day mode is on', () => {
    assert.equal(showMatrixCriterionSegment(hour, false, true), true);
    assert.equal(showMatrixCriterionSegment({ rideable: false }, false, true), false);
  });

  it('shows elapsed hours with data regardless of mode', () => {
    assert.equal(showMatrixCriterionSegment(hour, true, false), true);
  });
});

describe('filterMatrixSpotsForDay', () => {
  const rows = [
    { rideableCount: 3, entry: { spot: { id: 'ride' } } },
    { rideableCount: 0, entry: { spot: { id: 'fav' } } },
    { rideableCount: 0, entry: { spot: { id: 'other' } } },
  ];

  it('keeps only rideable spots when mode is off', () => {
    const out = filterMatrixSpotsForDay(rows, ['fav'], false);
    assert.deepEqual(out.map((r) => r.entry.spot.id), ['ride']);
  });

  it('includes favorites and rideable spots when mode is on', () => {
    const out = filterMatrixSpotsForDay(rows, ['fav'], true);
    assert.deepEqual(out.map((r) => r.entry.spot.id), ['ride', 'fav']);
  });
});

describe('full-day condition summary', () => {
  const sessionDate = '2026-09-12';

  it('summarizes wind, gust, wave, and air across session planning hours', () => {
    const hours = [
      {
        time: '2026-09-12T08:00',
        windSpeed: 5,
        gusts: 9,
        waveHeightM: 0.2,
        airTempC: 14,
        daylightOk: true,
      },
      {
        time: '2026-09-12T14:00',
        windSpeed: 11,
        gusts: 16,
        waveHeightM: 0.4,
        airTempC: 19,
        daylightOk: true,
      },
      { time: '2026-09-12T22:00', windSpeed: 20, gusts: 30, daylightOk: false },
    ];
    const planning = filterMatrixPlanningHours(hours, sessionDate);
    const stats = buildPlanningHourConditionStats(planning);
    const summary = formatPlanningHourConditionSummary(stats);
    assert.match(summary, /5–11 kt wind/);
    assert.match(summary, /9–16 kt gusts/);
    assert.match(summary, /waves/);
    assert.match(summary, /14–19°C air/);
  });
});
