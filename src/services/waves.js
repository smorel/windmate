/** Wave height bands aligned with session ranking spec (metres) */
const FLAT_MAX_M = 0.3;
const SMALL_MAX_M = 1.0;

/**
 * Rough lake/river chop estimate from wind (kt) when marine API has no cell.
 * @param {number} windSpeedKt
 */
function estimateWaveHeightFromWind(windSpeedKt) {
  const kts = Math.max(0, Number(windSpeedKt) || 0);
  return Math.min(2.5, 0.0016 * kts * kts);
}

/**
 * @param {number|null|undefined} heightM
 * @returns {'flat'|'small'|'big'|null}
 */
function waveBand(heightM) {
  if (heightM == null || Number.isNaN(heightM)) return null;
  if (heightM < FLAT_MAX_M) return 'flat';
  if (heightM <= SMALL_MAX_M) return 'small';
  return 'big';
}

/**
 * @param {number|null|undefined} marineHeightM
 * @param {number} windSpeedKt
 */
function resolveWaveHeight(marineHeightM, windSpeedKt) {
  if (marineHeightM != null && !Number.isNaN(marineHeightM)) {
    return { waveHeightM: marineHeightM, waveSource: 'marine' };
  }
  return {
    waveHeightM: estimateWaveHeightFromWind(windSpeedKt),
    waveSource: 'estimated',
  };
}

module.exports = {
  FLAT_MAX_M,
  SMALL_MAX_M,
  estimateWaveHeightFromWind,
  waveBand,
  resolveWaveHeight,
};
