/** Beaufort wind scale — colors aligned with common wind-app palettes (e.g. Windy) */
const WindmateWindColors = (() => {
  /** @type {{ force: number, maxKt: number, color: string, name: string }[]} */
  const BEAUFORT = [
    { force: 0, maxKt: 0.99, color: '#94a3b8', name: 'Calm' },
    { force: 1, maxKt: 3, color: '#cffafe', name: 'Light air' },
    { force: 2, maxKt: 6, color: '#a5f3fc', name: 'Light breeze' },
    { force: 3, maxKt: 10, color: '#67e8f9', name: 'Gentle breeze' },
    { force: 4, maxKt: 16, color: '#4ade80', name: 'Moderate breeze' },
    { force: 5, maxKt: 21, color: '#a3e635', name: 'Fresh breeze' },
    { force: 6, maxKt: 27, color: '#facc15', name: 'Strong breeze' },
    { force: 7, maxKt: 33, color: '#fb923c', name: 'Near gale' },
    { force: 8, maxKt: 40, color: '#f87171', name: 'Gale' },
    { force: 9, maxKt: 47, color: '#ef4444', name: 'Strong gale' },
    { force: 10, maxKt: 55, color: '#dc2626', name: 'Storm' },
    { force: 11, maxKt: 63, color: '#b91c1c', name: 'Violent storm' },
    { force: 12, maxKt: Infinity, color: '#7f1d1d', name: 'Hurricane' },
  ];

  function beaufortForSpeed(knots) {
    const k = Math.max(0, Number(knots) || 0);
    for (const bf of BEAUFORT) {
      if (k <= bf.maxKt) return bf;
    }
    return BEAUFORT[BEAUFORT.length - 1];
  }

  function forSpeed(knots) {
    return beaufortForSpeed(knots).color;
  }

  function ktRangeLabel(bf, index) {
    if (bf.force === 0) return '0 kt';
    const prev = BEAUFORT[index - 1];
    const min = prev ? Math.ceil(prev.maxKt) : 0;
    if (bf.maxKt === Infinity) return `${min}+ kt`;
    return `${min}–${Math.floor(bf.maxKt)} kt`;
  }

  function renderLegend() {
    const segments = BEAUFORT.map((bf, i) => {
      const range = ktRangeLabel(bf, i);
      const darkText = bf.force >= 4;
      const textClass = darkText ? 'wind-legend-seg--dark' : '';
      return `<span class="wind-legend-seg ${textClass}" style="background:${bf.color}" title="Bf ${bf.force} · ${bf.name} · ${range}">${bf.force}</span>`;
    });

    return `
      <div class="wind-legend">
        <span class="text-xs text-slate-400 shrink-0">Beaufort · wind (top) / gust (mid)</span>
        <div class="wind-legend-bar">${segments.join('')}</div>
      </div>`;
  }

  return { forSpeed, beaufortForSpeed, renderLegend, BEAUFORT };
})();
