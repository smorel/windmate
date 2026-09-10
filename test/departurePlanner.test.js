const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickBestQualifyingWindow,
  enumerateConsensusRuns,
  enumerateMinLengthWindows,
  buildConsensusHours,
  weightsForDepartureWindow,
  scoreWindowRun,
} = require('../src/services/sessionRank');
const {
  resolveDepartureStatus,
  DEFAULT_RIG_MINUTES,
  DEFAULT_DEPARTURE_BUFFER_MINUTES,
} = require('../src/services/departurePlanner');
const { subtractForecastMinutes } = require('../src/utils/forecastTime');
const { roundDepartureBucket, haversineDriveMinutes } = require('../src/services/travelTime');

function hour(time, overrides = {}) {
  return {
    time,
    rideable: true,
    windOk: true,
    weatherOk: true,
    tempOk: true,
    windSpeed: 16,
    windExposure: 'onshore',
    idealWind: true,
    ...overrides,
  };
}

describe('enumerateMinLengthWindows', () => {
  it('slides min-length windows inside longer rideable blocks', () => {
    const hours = [
      hour('2026-09-12T14:00'),
      hour('2026-09-12T15:00'),
      hour('2026-09-12T16:00'),
      hour('2026-09-12T17:00'),
    ];
    const windows = enumerateMinLengthWindows(hours, 2);
    assert.equal(windows.length, 3);
    assert.equal(windows[0].start, '2026-09-12T14:00');
    assert.equal(windows[2].start, '2026-09-12T16:00');
    assert.equal(windows[0].length, 2);
  });
});

describe('buildConsensusHours', () => {
  it('aligns consensus to the display timeline, ignoring extra model-only slots', () => {
    const primaryHours = [
      hour('2026-09-12T08:00'),
      hour('2026-09-12T09:00'),
      hour('2026-09-12T10:00'),
      hour('2026-09-12T11:00'),
    ];
    const hrdpsHours = [
      hour('2026-09-12T08:00'),
      hour('2026-09-12T08:30', { rideable: false }),
      hour('2026-09-12T09:00'),
      hour('2026-09-12T10:00'),
      hour('2026-09-12T11:00'),
    ];
    const entry = {
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: '2026-09-12', hours: primaryHours }] },
        hrdps: { days: [{ date: '2026-09-12', hours: hrdpsHours }] },
      },
    };

    const consensus = buildConsensusHours(entry, '2026-09-12', primaryHours);
    assert.equal(consensus.length, 4);
    assert.equal(consensus.every((slot) => slot.rideable), true);

    const windows = enumerateMinLengthWindows(consensus, 2);
    assert.equal(windows.length, 3);
    assert.equal(windows[0].start, '2026-09-12T08:00');
    assert.equal(windows[2].start, '2026-09-12T10:00');
  });

  it('ignores models with no data for a timeline slot when building consensus', () => {
    const primaryHours = [
      hour('2026-09-12T08:00'),
      hour('2026-09-12T09:00'),
      hour('2026-09-12T10:00'),
    ];
    const hrrrHours = [hour('2026-09-12T09:00'), hour('2026-09-12T10:00')];
    const entry = {
      primaryModel: 'gfs',
      models: {
        gfs: { days: [{ date: '2026-09-12', hours: primaryHours }] },
        hrrr: { days: [{ date: '2026-09-12', hours: hrrrHours }] },
      },
    };

    const consensus = buildConsensusHours(entry, '2026-09-12', primaryHours);
    assert.equal(consensus.length, 3);
    assert.equal(consensus[0].rideable, true);
    assert.equal(consensus.every((slot) => slot.rideable), true);
  });
});

describe('enumerateConsensusRuns', () => {
  it('finds all qualifying runs, not just the longest', () => {
    const hours = [
      hour('2026-09-12T08:00'),
      hour('2026-09-12T09:00'),
      hour('2026-09-12T10:00', { rideable: false }),
      hour('2026-09-12T14:00', { windSpeed: 22, windExposure: 'offshore', idealWind: false }),
      hour('2026-09-12T15:00', { windSpeed: 22, windExposure: 'offshore', idealWind: false }),
      hour('2026-09-12T16:00', { windSpeed: 22, windExposure: 'offshore', idealWind: false }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const runs = enumerateConsensusRuns(entry, '2026-09-12', 2);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].length, 2);
    assert.equal(runs[1].length, 3);
  });
});

describe('departure window metrics', () => {
  it('scores higher gusts higher when still rideable', () => {
    const hours = [
      hour('2026-09-12T08:00', { windSpeed: 14, gusts: 20 }),
      hour('2026-09-12T09:00', { windSpeed: 14, gusts: 20 }),
      hour('2026-09-12T13:00', { windSpeed: 14, gusts: 35 }),
      hour('2026-09-12T14:00', { windSpeed: 14, gusts: 35 }),
    ];
    const prefs = { min_rideable_window_hours: 2, max_gust_knots: 38, rank_criteria_order: ['wind', 'gust'] };
    const weights = weightsForDepartureWindow(prefs.rank_criteria_order);
    const runLow = {
      start: '2026-09-12T08:00',
      end: '2026-09-12T09:00',
      length: 2,
      hours: hours.slice(0, 2),
    };
    const runHigh = {
      start: '2026-09-12T13:00',
      end: '2026-09-12T14:00',
      length: 2,
      hours: hours.slice(2, 4),
    };
    const low = scoreWindowRun(runLow, hours, prefs, 4, 2, weights);
    const high = scoreWindowRun(runHigh, hours, prefs, 4, 2, weights);
    assert.ok(high.metrics.gust > low.metrics.gust);
    assert.ok(high.metrics.wind === low.metrics.wind);
  });
});

describe('weightsForDepartureWindow', () => {
  it('gives gust the same weight as wind', () => {
    const weights = weightsForDepartureWindow(['wind', 'onshore', 'waveMatch']);
    assert.ok(weights.gust > 0);
    assert.equal(weights.wind, weights.gust);
  });
});

describe('pickBestQualifyingWindow', () => {
  it('picks the globally highest-scoring departure window on the display timeline', () => {
    const shared = { gusts: 28, waveHeightM: 0.4 };
    const hours = [
      hour('2026-09-12T08:00', { windSpeed: 12, ...shared }),
      hour('2026-09-12T09:00', { windSpeed: 12, ...shared }),
      hour('2026-09-12T10:00', { windSpeed: 12, ...shared }),
      hour('2026-09-12T11:00', { windSpeed: 12, ...shared }),
      hour('2026-09-12T12:00', { windSpeed: 12, ...shared }),
      hour('2026-09-12T13:00', { windSpeed: 12, ...shared }),
      hour('2026-09-12T14:00', { windSpeed: 22, ...shared }),
      hour('2026-09-12T15:00', { windSpeed: 22, ...shared }),
      hour('2026-09-12T16:00', { windSpeed: 22, ...shared }),
      hour('2026-09-12T17:00', { windSpeed: 22, ...shared }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['wind', 'gust', 'onshore', 'waveMatch'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs, hours);
    const peakWind = Math.max(...pick.run.hours.map((h) => h.windSpeed));
    assert.equal(peakWind, 22);
    assert.ok(pick.run.start >= '2026-09-12T13:00');
    assert.ok(pick.run.start < '2026-09-12T16:00');
  });

  it('prefers onshore afternoon block when onshore ranks above wind', () => {
    const hours = [
      hour('2026-09-12T08:00', { windSpeed: 24, windExposure: 'offshore', idealWind: false }),
      hour('2026-09-12T09:00', { windSpeed: 24, windExposure: 'offshore', idealWind: false }),
      hour('2026-09-12T10:00', { rideable: false }),
      hour('2026-09-12T14:00', { windSpeed: 16 }),
      hour('2026-09-12T15:00', { windSpeed: 16 }),
      hour('2026-09-12T16:00', { windSpeed: 16 }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['onshore', 'bestWindow', 'wind'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs);
    assert.ok(pick.run.start >= '2026-09-12T14:00');
    assert.notEqual(pick.run.start, '2026-09-12T08:00');
    assert.equal(pick.sessionWindowHours, 2);
  });

  it('picks highest-scoring min-length slice inside a longer block', () => {
    const shared = { gusts: 28, waveHeightM: 0.4 };
    const hours = [
      hour('2026-09-12T14:00', { windSpeed: 8, ...shared }),
      hour('2026-09-12T15:00', { windSpeed: 22, ...shared }),
      hour('2026-09-12T16:00', { windSpeed: 18, ...shared }),
      hour('2026-09-12T17:00', { windSpeed: 8, ...shared }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['wind', 'onshore'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs);
    assert.equal(pick.run.start, '2026-09-12T14:00');
  });

  it('ties equal scores to earliest start in a contiguous block', () => {
    const hours = [
      hour('2026-09-12T14:00'),
      hour('2026-09-12T15:00'),
      hour('2026-09-12T16:00'),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['bestWindow'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs);
    assert.equal(pick.run.start, '2026-09-12T14:00');
  });

  it('ignores spot-ranking criteria like longest window when scoring departure windows', () => {
    const shared = { gusts: 28, waveHeightM: 0.4 };
    const shortBlock = [
      hour('2026-09-12T08:00', { windSpeed: 10, ...shared }),
      hour('2026-09-12T09:00', { windSpeed: 10, ...shared }),
    ];
    const longBlock = [
      hour('2026-09-12T14:00', { windSpeed: 24, ...shared }),
      hour('2026-09-12T15:00', { windSpeed: 24, ...shared }),
      hour('2026-09-12T16:00', { windSpeed: 24, ...shared }),
      hour('2026-09-12T17:00', { windSpeed: 24, ...shared }),
    ];
    const hours = [...shortBlock, hour('2026-09-12T10:00', { rideable: false }), ...longBlock];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['bestWindow', 'rideability', 'wind'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs);
    assert.equal(pick.run.start, '2026-09-12T14:00');
  });

  it('slides to earliest top-scoring window before conditions fade', () => {
    const shared = { gusts: 28, waveHeightM: 0.4 };
    const hours = [
      hour('2026-09-12T11:00', { windSpeed: 16, ...shared }),
      hour('2026-09-12T12:00', { windSpeed: 16, ...shared }),
      hour('2026-09-12T13:00', { windSpeed: 16, ...shared }),
      hour('2026-09-12T14:00', { windSpeed: 14, ...shared }),
      hour('2026-09-12T15:00', { windSpeed: 12, ...shared }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['wind', 'onshore'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs);
    assert.equal(pick.run.start, '2026-09-12T11:00');
  });

  it('maximizes the sum of per-hour score-row values across the session window', () => {
    const shared = { gusts: 28, waveHeightM: 0.4 };
    const hours = [
      hour('2026-09-12T12:00', { windSpeed: 20, ...shared }),
      hour('2026-09-12T13:00', { windSpeed: 20, ...shared }),
      hour('2026-09-12T14:00', { windSpeed: 22, ...shared }),
      hour('2026-09-12T15:00', { windSpeed: 22, ...shared }),
      hour('2026-09-12T16:00', { windSpeed: 18, ...shared }),
      hour('2026-09-12T17:00', { windSpeed: 14, ...shared }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['wind', 'onshore'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs, hours);
    assert.equal(pick.run.start, '2026-09-12T13:00');
  });

  it('prefers higher score over later start when scores differ', () => {
    const shared = { gusts: 28, waveHeightM: 0.4 };
    const hours = [
      hour('2026-09-12T14:00', { windSpeed: 24, ...shared }),
      hour('2026-09-12T15:00', { windSpeed: 20, ...shared }),
      hour('2026-09-12T16:00', { windSpeed: 18, ...shared }),
      hour('2026-09-12T17:00', { windSpeed: 16, ...shared }),
    ];
    const entry = { models: {}, days: [{ date: '2026-09-12', hours }] };
    const prefs = {
      min_rideable_window_hours: 2,
      max_gust_knots: 30,
      rank_criteria_order: ['wind', 'onshore'],
    };
    const pick = pickBestQualifyingWindow(entry, '2026-09-12', prefs);
    assert.equal(pick.run.start, '2026-09-12T14:00');
  });
});

describe('leave-by math', () => {
  it('subtracts drive, rig, and buffer from session start to arrive at spot on time', () => {
    const onWaterStart = '2026-09-12T14:00';
    const arriveAtSpot = subtractForecastMinutes(onWaterStart, DEFAULT_RIG_MINUTES);
    const driveMinutes = 50;
    const leaveBy = subtractForecastMinutes(
      subtractForecastMinutes(arriveAtSpot, driveMinutes),
      DEFAULT_DEPARTURE_BUFFER_MINUTES
    );
    assert.equal(arriveAtSpot, '2026-09-12T13:40');
    assert.equal(leaveBy, '2026-09-12T12:45');
  });
});

describe('travelTime helpers', () => {
  it('rounds departure bucket to 15 minutes', () => {
    assert.equal(roundDepartureBucket('2026-09-12T12:47'), '2026-09-12T12:45');
    assert.equal(roundDepartureBucket('2026-09-12T12:52'), '2026-09-12T12:45');
  });

  it('estimates haversine drive minutes', () => {
    const origin = { lat: 45.5017, lng: -73.5673 };
    const dest = { lat: 45.3167, lng: -74.05 };
    const result = haversineDriveMinutes(origin, dest);
    assert.ok(result.driveMinutes >= 30);
    assert.equal(result.source, 'haversine');
  });
});

describe('resolveDepartureStatus', () => {
  it('returns planned for future dates', () => {
    assert.equal(
      resolveDepartureStatus('2099-01-01', '2099-01-01T08:00', '2099-01-01T10:00', '2099-01-01T13:00'),
      'planned'
    );
  });
});
