const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildUnionDayTimelineHours } = require('../src/utils/dayTimeline');

function getModelDayHours(entry, modelId, dateStr) {
  const day = entry.models?.[modelId]?.days?.find((d) => d.date === dateStr);
  return day?.hours ?? [];
}

describe('buildUnionDayTimelineHours', () => {
  it('merges slots when primary only has overnight hours on a far day', () => {
    const night = (time, wind) => ({
      time,
      windSpeed: wind,
      daylightOk: false,
      rideable: false,
    });
    const day = (time, wind) => ({
      time,
      windSpeed: wind,
      daylightOk: true,
      rideable: false,
    });

    const lamHours = [
      night('2026-09-13T00:00', 5),
      night('2026-09-13T01:00', 6),
      night('2026-09-13T06:00', 9),
    ];
    const gfsHours = Array.from({ length: 24 }, (_, i) =>
      day(`2026-09-13T${String(i).padStart(2, '0')}:00`, 8)
    );

    const entry = {
      primaryModel: 'lam',
      models: {
        lam: { days: [{ date: '2026-09-13', hours: lamHours }] },
        gfs: { days: [{ date: '2026-09-13', hours: gfsHours }] },
      },
    };

    const timeline = buildUnionDayTimelineHours(entry, '2026-09-13', getModelDayHours);
    assert.equal(timeline.length, 24);
    assert.equal(timeline[0].windSpeed, 5);
    assert.equal(timeline[6].windSpeed, 9);
    assert.equal(timeline[7].windSpeed, 8);
    assert.equal(timeline[12].daylightOk, true);
  });
});
