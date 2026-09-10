/** Session banner verdict — uses same consensus windows as matrix ranking (not stale API snapshot). */
const WindmateSessionGoNoGo = (() => {
  const ON_TRACK_MIN_SCORE = 0.55;
  const WEAK_FACTOR_THRESHOLD = 0.5;
  const MAX_FACTOR_REASONS = 2;

  const WEAK_FACTOR_MESSAGES = {
    onshore: 'Wind direction rarely ideal for this spot',
    waveMatch: 'Waves/chop don’t match your preference',
    wind: 'Peak wind is on the light side for your setup',
    gust: 'Gusts are high relative to your limit',
    rideability: 'Not many rideable hours overall',
    bestWindow: 'Longest shared window is relatively short',
  };

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

  function buildVerdict({ windowHours, minWindow, score, metrics, weights, entry, prefs, cached }) {
    let state = 'go';
    const reasons = [];

    if (windowHours < minWindow) {
      if (windowHours > 0) {
        state = 'no_go';
        reasons.push(`Only ${windowHours} h rideable window — need ${minWindow} h for your setup`);
      } else if (cached?.windRange) {
        state = 'caution';
        reasons.push(`Rideable hours don't form a ${minWindow} h window`);
      } else {
        state = 'no_go';
        reasons.push('No rideable wind in the forecast for this session');
      }
    } else {
      if (windowHours === minWindow) {
        state = 'caution';
        reasons.push(`Window barely meets your ${minWindow} h minimum`);
      }
      if (score < ON_TRACK_MIN_SCORE) {
        state = state === 'go' ? 'caution' : state;
        reasons.push(explainMarginalSessionScore(metrics, weights, entry, prefs));
      }
    }

    const hazardReason =
      cached?.warnings?.find((w) => w.type === 'storm_approaching')?.message ??
      cached?.warnings?.find((w) => w.type === 'wind_fading')?.message ??
      cached?.warnings?.[0]?.message ??
      null;

    if (hazardReason) {
      state = state === 'go' ? 'caution' : state;
      reasons.push(hazardReason);
    }

    const reason = [...new Set(reasons.filter(Boolean))].join(' · ');
    const summary =
      windowHours >= minWindow && cached?.summary ? cached.summary : cached?.summary ?? '';

    return {
      ...(cached ?? {}),
      state,
      reason,
      summary,
      windowHours,
      score,
    };
  }

  /**
   * @param {object} entry rideability spot entry
   * @param {string} sessionDate YYYY-MM-DD
   * @param {object} prefs sport profile
   * @param {(entry: object, modelId: string, date: string) => object[]} getModelDayHours
   */
  function forDay(entry, sessionDate, prefs, getModelDayHours) {
    const cached = entry.sessionGoNoGoByDate?.[sessionDate] ?? null;
    const minWindow = WindmateRideableWindow.parseMinHours(prefs.min_rideable_window_hours);
    const windowHours = WindmateRideableWindow.longestConsensusWindowLength(
      entry,
      sessionDate,
      minWindow,
      getModelDayHours
    );
    const order = WindmateSessionRank.normalizeOrder(prefs?.rank_criteria_order).filter(
      (k) => k !== 'proximity'
    );
    const weights = WindmateSessionRank.weightsFromOrder(order);
    const { score, metrics } = WindmateSessionRank.computeSessionGoNoGoScore(
      entry,
      sessionDate,
      prefs,
      prefs?.radius_km ?? 50
    );

    return buildVerdict({
      windowHours,
      minWindow,
      score,
      metrics,
      weights,
      entry,
      prefs,
      cached,
    });
  }

  return { forDay, ON_TRACK_MIN_SCORE, explainMarginalSessionScore };
})();
