/** Session spot ranking + top-reason banner for the rideability matrix */
const WindmateSessionRank = (() => {
  const DEFAULT_ORDER = [
    'rideability',
    'bestWindow',
    'proximity',
    'wind',
    'onshore',
    'waveMatch',
  ];

  const REASON_LABELS = {
    rideability: () => WindmateCopy.rank.mostGoodHours,
    bestWindow: () => WindmateCopy.rank.longestWindow,
    proximity: () => WindmateCopy.rank.closest,
    wind: () => WindmateCopy.rank.bestWind,
    onshore: () => WindmateCopy.rank.idealDirection,
    waveMatch: () => WindmateCopy.rank.bestWaves,
  };

  const WAVE_PREF_BY_SPORT = {
    wingfoiling: 'flat',
    kitesurfing: 'small',
    sailing: 'any',
  };

  function normalizeOrder(order) {
    const seen = new Set();
    const result = [];
    for (const key of order ?? []) {
      if (!DEFAULT_ORDER.includes(key) || seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
    for (const key of DEFAULT_ORDER) {
      if (!seen.has(key)) result.push(key);
    }
    return result;
  }

  /** Top of list = highest weight (linear decay) */
  function weightsFromOrder(order) {
    const normalized = normalizeOrder(order);
    const n = normalized.length;
    const rawSum = (n * (n + 1)) / 2;
    const weights = {};
    normalized.forEach((key, i) => {
      weights[key] = (n - i) / rawSum;
    });
    return weights;
  }

  function getDayHours(entry, dateStr) {
    const primary = entry.primaryModel;
    if (entry.models?.[primary]?.days) {
      const day = entry.models[primary].days.find((d) => d.date === dateStr);
      if (day?.hours?.length) return day.hours;
    }
    const day = (entry.days ?? []).find((d) => d.date === dateStr);
    return day?.hours ?? [];
  }

  function longestRideableWindow(hours) {
    let best = 0;
    let current = 0;
    for (const hour of hours) {
      if (hour.rideable) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
    return best;
  }

  function estimateWaveMatch(rideableHours, wavePreference) {
    if (!rideableHours.length) return 0;
    const heights = rideableHours.map((h) => {
      if (h.waveHeightM != null) return h.waveHeightM;
      const kts = h.windSpeed ?? 0;
      return Math.min(2.5, 0.0016 * kts * kts);
    });
    const avgH = heights.reduce((sum, v) => sum + v, 0) / heights.length;

    switch (wavePreference) {
      case 'flat':
        return avgH < 0.3 ? 1 : Math.max(0, 1 - (avgH - 0.3) / 0.7);
      case 'small':
        return avgH <= 1.0 ? 1 : Math.max(0, 1 - (avgH - 1.0) / 1.0);
      case 'big':
        return Math.min(1, avgH / 1.0);
      default:
        return 0.85;
    }
  }

  function wavePreferenceFromPrefs(prefs) {
    if (prefs?.wave_preference) return prefs.wave_preference;
    return WAVE_PREF_BY_SPORT[prefs?.sport] ?? 'flat';
  }

  function computeRawMetrics(entry, dateStr) {
    const hours = getDayHours(entry, dateStr);
    const rideableHours = hours.filter((h) => h.rideable);
    const rideableCount = rideableHours.length;
    const maxRideableWind = rideableHours.length
      ? Math.max(...rideableHours.map((h) => h.windSpeed ?? 0))
      : 0;
    const maxWind = hours.length ? Math.max(...hours.map((h) => h.windSpeed ?? 0)) : 0;

    return {
      hours,
      rideableCount,
      maxRideableWind,
      maxWind,
      windowLen: longestRideableWindow(hours),
      idealRideable: rideableHours.filter((h) => h.idealWind).length,
    };
  }

  function buildFactors(metrics, maxDistance, maxRideableWind, wavePreference) {
    const rideableHours = metrics.hours.filter((h) => h.rideable);
    const dist = metrics.distance_km ?? 0;

    return {
      rideability: metrics.rideableCount / 24,
      bestWindow: metrics.windowLen / 24,
      proximity: maxDistance > 0 ? 1 - dist / maxDistance : 1,
      wind:
        maxRideableWind > 0
          ? (metrics.maxRideableWind || metrics.maxWind) / maxRideableWind
          : metrics.maxWind / Math.max(maxRideableWind, 1),
      onshore:
        rideableHours.length > 0 ? metrics.idealRideable / rideableHours.length : 0,
      waveMatch: estimateWaveMatch(rideableHours, wavePreference),
    };
  }

  function sessionScore(factors, weights) {
    return Object.keys(weights).reduce(
      (sum, key) => sum + (factors[key] ?? 0) * weights[key],
      0
    );
  }

  function assignTopReasons(ranked, order, weights) {
    const categoryLeader = {};
    for (const cat of order) {
      let leader = -1;
      let best = -1;
      ranked.forEach((row, i) => {
        const v = row.factors[cat] ?? 0;
        if (v > best) {
          best = v;
          leader = i;
        }
      });
      if (leader >= 0 && best > 0) categoryLeader[cat] = leader;
    }

    for (const row of ranked) row.topReason = null;

    for (const cat of order) {
      const i = categoryLeader[cat];
      if (i == null || ranked[i].topReason) continue;
      ranked[i].topReason = REASON_LABELS[cat]();
    }

    ranked.forEach((row) => {
      if (row.topReason) return;
      let bestCat = order[0];
      let bestScore = -1;
      for (const cat of order) {
        const values = ranked.map((r) => r.factors[cat] ?? 0);
        const max = Math.max(...values, 0.0001);
        const score = ((row.factors[cat] ?? 0) / max) * weights[cat];
        if (score > bestScore) {
          bestScore = score;
          bestCat = cat;
        }
      }
      row.topReason = REASON_LABELS[bestCat]();
    });
  }

  function rankSpotsForDay(spots, dateStr, prefs, radiusKm) {
    const order = normalizeOrder(prefs?.rank_criteria_order);
    const weights = weightsFromOrder(order);
    const wavePreference = wavePreferenceFromPrefs(prefs);
    const maxDistance = Math.max(...spots.map((s) => s.spot.distance_km), radiusKm ?? 1, 1);

    const metricsList = spots.map((entry) => ({
      entry,
      ...computeRawMetrics(entry, dateStr),
      distance_km: entry.spot.distance_km,
    }));

    const maxRideableWind = Math.max(...metricsList.map((m) => m.maxRideableWind), 0);
    const globalMaxWind = Math.max(...metricsList.map((m) => m.maxWind), 1);
    const windNorm = maxRideableWind > 0 ? maxRideableWind : globalMaxWind;

    const ranked = metricsList.map((m) => {
      const factors = buildFactors(m, maxDistance, windNorm, wavePreference);
      return {
        entry: m.entry,
        factors,
        score: sessionScore(factors, weights),
        rideableCount: m.rideableCount,
      };
    });

    assignTopReasons(ranked, order, weights);

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.rideableCount !== a.rideableCount) return b.rideableCount - a.rideableCount;
      return a.entry.spot.distance_km - b.entry.spot.distance_km;
    });

    return applyFavoriteBoost(ranked, prefs?.favorite_spot_ids);
  }

  /** Favorites first; relative rank order preserved within each group. */
  function applyFavoriteBoost(ranked, favoriteSpotIds) {
    const favorites = new Set(favoriteSpotIds ?? []);
    if (!favorites.size) return ranked;
    const favRows = [];
    const otherRows = [];
    for (const row of ranked) {
      if (favorites.has(row.entry.spot.id)) favRows.push(row);
      else otherRows.push(row);
    }
    return [...favRows, ...otherRows];
  }

  function renderBanner(label) {
    return `<span class="spot-rank-banner">${label}</span>`;
  }

  return {
    rankSpotsForDay,
    applyFavoriteBoost,
    renderBanner,
    normalizeOrder,
    weightsFromOrder,
    DEFAULT_ORDER,
    REASON_LABELS,
  };
})();
