/** Wave height bands for matrix bottom third (metres) */
const WindmateWaveColors = (() => {
  const FLAT_MAX = 0.3;
  const SMALL_MAX = 1.0;

  const BANDS = [
    { id: 'flat', max: FLAT_MAX, color: '#134e4a', label: 'Flat' },
    { id: 'small', max: SMALL_MAX, color: '#0891b2', label: 'Small' },
    { id: 'big', max: Infinity, color: '#7e22ce', label: 'Big' },
  ];

  function estimateFromWind(windSpeedKt) {
    const kts = Math.max(0, Number(windSpeedKt) || 0);
    return Math.min(2.5, 0.0016 * kts * kts);
  }

  function resolveHeight(hour) {
    if (hour?.waveHeightM != null && !Number.isNaN(hour.waveHeightM)) {
      return {
        heightM: hour.waveHeightM,
        source: hour.waveSource ?? 'marine',
      };
    }
    return {
      heightM: estimateFromWind(hour?.windSpeed ?? 0),
      source: 'estimated',
    };
  }

  function bandForHeight(heightM) {
    const h = Math.max(0, Number(heightM) || 0);
    for (const band of BANDS) {
      if (h <= band.max) return band;
    }
    return BANDS[BANDS.length - 1];
  }

  function forHour(hour) {
    return bandForHeight(resolveHeight(hour).heightM).color;
  }

  function formatWave(hour) {
    const { heightM, source } = resolveHeight(hour);
    const band = bandForHeight(heightM);
    const est = source === 'estimated' ? ', est.' : '';
    return `${heightM.toFixed(1)} m ${band.label.toLowerCase()}${est}`;
  }

  function renderLegend() {
    const segments = BANDS.map(
      (b) =>
        `<span class="wave-legend-seg" style="background:${b.color}" title="${b.label} · ${b.id === 'flat' ? `< ${FLAT_MAX}` : b.id === 'small' ? `${FLAT_MAX}–${SMALL_MAX}` : `> ${SMALL_MAX}`} m">${b.label}</span>`
    );
    return `
      <div class="wave-legend">
        <span class="text-xs text-slate-400 shrink-0">Waves (bottom third)</span>
        <div class="wave-legend-bar">${segments.join('')}</div>
      </div>`;
  }

  return { forHour, formatWave, resolveHeight, bandForHeight, renderLegend, BANDS };
})();
