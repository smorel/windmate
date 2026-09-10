const WEAK_FACTOR_MESSAGES = {
  onshore: 'Wind direction rarely ideal for this spot',
  waveMatch: 'Waves/chop don’t match your preference',
  wind: 'Peak wind is on the light side for your setup',
  gust: 'Gusts are high relative to your limit',
  rideability: 'Not many rideable hours overall',
  bestWindow: 'Longest shared window is relatively short',
};

const WEAK_FACTOR_THRESHOLD = 0.5;
const MAX_FACTOR_REASONS = 2;

function explainMarginalSessionScore(metrics, weights, entry, prefs) {
  const parts = [];
  const dist = entry?.spot?.distance_km ?? 0;
  const radius = prefs?.radius_km ?? 50;
  const outside =
    Boolean(entry?.spot?.outside_radius) || (Number.isFinite(dist) && dist > radius);

  if (outside && Number.isFinite(dist)) {
    parts.push(
      `${Math.round(dist)} km away (outside ${Math.round(radius)} km) — distance doesn’t lower this session score`
    );
  }

  const drags = Object.keys(weights ?? {})
    .filter((key) => key !== 'proximity')
    .map((key) => {
      const metric = metrics?.[key] ?? 0;
      const weight = weights[key] ?? 0;
      return { key, metric, drag: (1 - metric) * weight };
    })
    .filter((row) => row.metric < WEAK_FACTOR_THRESHOLD && WEAK_FACTOR_MESSAGES[row.key])
    .sort((a, b) => b.drag - a.drag);

  for (const row of drags.slice(0, MAX_FACTOR_REASONS)) {
    parts.push(WEAK_FACTOR_MESSAGES[row.key]);
  }

  if (parts.length === 0 || parts.length === (outside ? 1 : 0)) {
    parts.push('Session score below your on-track bar');
  }

  return parts.join(' · ');
}

module.exports = {
  WEAK_FACTOR_MESSAGES,
  explainMarginalSessionScore,
};
