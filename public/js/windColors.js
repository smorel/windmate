/** Beaufort wind scale — palette from Windy-style Beaufort legend */
const WindmateWindColors = (() => {
  /** @type {{ force: number, maxKt: number, color: string, name: string }[]} */
  const BEAUFORT = [
    { force: 0, maxKt: 0.99, color: '#2b4f92', name: 'Calm' },
    { force: 1, maxKt: 3, color: '#3d70b6', name: 'Light air' },
    { force: 2, maxKt: 6, color: '#559fbe', name: 'Light breeze' },
    { force: 3, maxKt: 10, color: '#58a397', name: 'Gentle breeze' },
    { force: 4, maxKt: 16, color: '#60a059', name: 'Moderate breeze' },
    { force: 5, maxKt: 21, color: '#9eb851', name: 'Fresh breeze' },
    { force: 6, maxKt: 27, color: '#e9bd47', name: 'Strong breeze' },
    { force: 7, maxKt: 33, color: '#e2973f', name: 'Near gale' },
    { force: 8, maxKt: 40, color: '#d9783b', name: 'Gale' },
    { force: 9, maxKt: 47, color: '#c64e36', name: 'Strong gale' },
    { force: 10, maxKt: 55, color: '#be4a3c', name: 'Storm' },
    { force: 11, maxKt: 63, color: '#8a4a90', name: 'Violent storm' },
    { force: 12, maxKt: Infinity, color: '#764c92', name: 'Hurricane' },
  ];

  function prefersLightText(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.55;
  }

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

  function ktBounds(bf, index) {
    if (bf.force === 0) return { min: 0, max: 0 };
    const prev = BEAUFORT[index - 1];
    const min = prev ? Math.ceil(prev.maxKt) : 0;
    const max = bf.maxKt === Infinity ? null : Math.floor(bf.maxKt);
    return { min, max };
  }

  function ktRangeLabel(bf, index) {
    const { min, max } = ktBounds(bf, index);
    if (bf.force === 0) return '0 kt';
    if (max == null) return `${min}+ kt`;
    return `${min}–${max} kt`;
  }

  function ktLegendLabel(bf, index) {
    const { min, max } = ktBounds(bf, index);
    if (bf.force === 0) return '0';
    if (max == null) return `${min}+`;
    if (min === max) return String(min);
    return `${min}-${max}`;
  }

  function renderLegend() {
    const segments = BEAUFORT.map((bf, i) => {
      const range = ktRangeLabel(bf, i);
      const label = ktLegendLabel(bf, i);
      const textClass = prefersLightText(bf.color) ? 'wind-legend-seg--dark' : '';
      return `<span class="wind-legend-seg ${textClass}" style="background:${bf.color}" title="Bf ${bf.force} · ${bf.name} · ${range}">${label}</span>`;
    });

    return `
      <div class="wind-legend">
        <span class="wind-legend-label">Beaufort · wind (top) / gust (mid)</span>
        <div class="wind-legend-bar">${segments.join('')}</div>
      </div>`;
  }

  /** Excitement sticker fill — Beaufort force mapped low → high */
  const EXCITEMENT_TIER_FORCE = { cool: 3, nice: 5, amazing: 7, epic: 9 };

  function colorForExcitementTier(tier) {
    const force = EXCITEMENT_TIER_FORCE[tier];
    if (force == null) return null;
    const bf = BEAUFORT.find((b) => b.force === force);
    return bf?.color ?? null;
  }

  return {
    forSpeed,
    beaufortForSpeed,
    renderLegend,
    colorForExcitementTier,
    BEAUFORT,
  };
})();
