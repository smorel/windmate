const MODEL_LABELS = {
  lam: 'HRDPS 2.5 km',
  hrrr: 'HRRR 3 km',
  nam5: 'NAM 3 km',
  nam12: 'NAM 12 km',
  gfs: 'GFS 27 km',
  ecmwf9: 'ECMWF 9 km',
  icon: 'ICON 13 km',
  'open-meteo': 'Open-Meteo',
};

const MODEL_COLORS = {
  lam: '#10b981',
  hrrr: '#14b8a6',
  nam5: '#8b5cf6',
  nam12: '#a78bfa',
  gfs: '#3b82f6',
  ecmwf9: '#ec4899',
  icon: '#6366f1',
  'open-meteo': '#f59e0b',
};

const DEFAULT_MODELS_NA = ['lam', 'hrrr', 'gfs', 'open-meteo'];
const DEFAULT_MODELS_GLOBAL = ['gfs', 'ecmwf9', 'open-meteo'];

function parseModelList() {
  const raw = process.env.WEATHER_MODELS;
  if (!raw) return null;
  return raw.split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);
}

function getModelsForLocation(lat, lng) {
  const configured = parseModelList();
  if (configured) return configured;

  if (lat >= 25 && lat <= 72 && lng >= -141 && lng <= -52) {
    return DEFAULT_MODELS_NA;
  }
  return DEFAULT_MODELS_GLOBAL;
}

function getPrimaryModel(lat, lng) {
  return process.env.WEATHER_PRIMARY_MODEL ?? (lat >= 25 && lat <= 72 && lng >= -141 && lng <= -52 ? 'lam' : 'gfs');
}

function getModelLabel(modelId) {
  return MODEL_LABELS[modelId] ?? modelId.toUpperCase();
}

function getModelColor(modelId) {
  return MODEL_COLORS[modelId] ?? '#64748b';
}

module.exports = {
  MODEL_LABELS,
  MODEL_COLORS,
  getModelsForLocation,
  getPrimaryModel,
  getModelLabel,
  getModelColor,
};
