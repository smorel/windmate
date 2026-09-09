/** Canonical sport slugs — keep in sync with specs and public/index.html */
const VALID_SPORTS = [
  'wingfoiling',
  'sailing',
  'kitesurfing',
  'windsurfing',
  'kitefoiling',
  'parawing',
];

const SPORT_DEFAULTS = {
  wingfoiling: { min_wind_knots: 12, max_gust_knots: 25, min_air_temp_c: 10, min_water_temp_c: 8, offshore_wind_ok: 0 },
  sailing: { min_wind_knots: 8, max_gust_knots: 30, min_air_temp_c: 5, min_water_temp_c: null, offshore_wind_ok: 0 },
  kitesurfing: { min_wind_knots: 14, max_gust_knots: 28, min_air_temp_c: 12, min_water_temp_c: 10, offshore_wind_ok: 0 },
  windsurfing: { min_wind_knots: 10, max_gust_knots: 28, min_air_temp_c: 8, min_water_temp_c: 8, offshore_wind_ok: 0 },
  kitefoiling: { min_wind_knots: 12, max_gust_knots: 25, min_air_temp_c: 10, min_water_temp_c: 8, offshore_wind_ok: 0 },
  parawing: { min_wind_knots: 10, max_gust_knots: 22, min_air_temp_c: 10, min_water_temp_c: 8, offshore_wind_ok: 0 },
};

const SPORT_WAVE_DEFAULTS = {
  wingfoiling: 'flat',
  sailing: 'any',
  kitesurfing: 'small',
  windsurfing: 'small',
  kitefoiling: 'flat',
  parawing: 'flat',
};

const SPORT_COLORS = {
  wingfoiling: { name: 'Emerald', hex: '#10b981', tailwind: 'emerald' },
  sailing: { name: 'Teal', hex: '#14b8a6', tailwind: 'teal' },
  kitesurfing: { name: 'Blue', hex: '#3b82f6', tailwind: 'blue' },
  windsurfing: { name: 'Cyan', hex: '#06b6d4', tailwind: 'cyan' },
  kitefoiling: { name: 'Violet', hex: '#8b5cf6', tailwind: 'violet' },
  parawing: { name: 'Amber', hex: '#f59e0b', tailwind: 'amber' },
};

module.exports = { VALID_SPORTS, SPORT_DEFAULTS, SPORT_WAVE_DEFAULTS, SPORT_COLORS };
