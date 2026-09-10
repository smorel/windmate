/** Session spot ranking + top-reason banner for the rideability matrix */
const WindmateSessionRank = (() => {
  const DEFAULT_ORDER = [
    'rideability',
    'bestWindow',
    'proximity',
    'wind',
    'gust',
    'onshore',
    'waveMatch',
  ];

  const DEPARTURE_WINDOW_CRITERIA = ['wind', 'gust', 'onshore', 'waveMatch'];

  const REASON_LABELS = {
    rideability: () => WindmateCopy.rank.mostGoodHours,
    bestWindow: () => WindmateCopy.rank.longestWindow,
    proximity: () => WindmateCopy.rank.closest,
    wind: () => WindmateCopy.rank.bestWind,
    gust: () => WindmateCopy.rank.bestGust,
    onshore: () => WindmateCopy.rank.idealDirection,
    waveMatch: () => WindmateCopy.rank.bestWaves,
  };

  const WAVE_PREF_BY_SPORT = {
    wingfoiling: 'flat',
    sailing: 'any',
    kitesurfing: 'small',
    windsurfing: 'small',
    kitefoiling: 'flat',
    parawing: 'flat',
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
      if (seen.has(key)) continue;
      if (key === 'gust' && seen.has('wind')) {
        result.splice(result.indexOf('wind') + 1, 0, key);
      } else {
        result.push(key);
      }
      seen.add(key);
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

  /** Departure windows score on conditions only — not spot-ranking factors like good hours or longest window. */
  function departureWindowOrder(userOrder) {
    const normalized = normalizeOrder(userOrder);
    let filtered = normalized.filter((key) => DEPARTURE_WINDOW_CRITERIA.includes(key));
    if (!filtered.length) return [...DEPARTURE_WINDOW_CRITERIA];

    if (!filtered.includes('gust')) {
      const windIndex = filtered.indexOf('wind');
      filtered.splice(windIndex >= 0 ? windIndex + 1 : 0, 0, 'gust');
    }

    for (const key of DEPARTURE_WINDOW_CRITERIA) {
      if (!filtered.includes(key)) filtered.push(key);
    }

    return filtered;
  }

  function weightsForDepartureWindow(userOrder) {
    const order = departureWindowOrder(userOrder);
    const tiers = [];

    for (const key of order) {
      if (key === 'gust') continue;
      if (key === 'wind') {
        tiers.push(['wind', 'gust']);
        continue;
      }
      tiers.push([key]);
    }

    const n = tiers.length;
    const rawSum = (n * (n + 1)) / 2;
    const weights = {};
    tiers.forEach((keys, tierIndex) => {
      const tierWeight = (n - tierIndex) / rawSum;
      const share = tierWeight / keys.length;
      for (const key of keys) weights[key] = share;
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

  function getModelDayHours(entry, modelId, dateStr) {
    const day = entry.models?.[modelId]?.days?.find((d) => d.date === dateStr);
    return day?.hours ?? [];
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

  function computeRawMetrics(entry, dateStr, prefs) {
    const hours = getDayHours(entry, dateStr);
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const rideableHours = hours.filter((h) => h.rideable);
    const viableHours = hours.filter((h) => h.windOk && h.weatherOk && h.tempOk);
    const directionOkViable = viableHours.filter((h) => !h.offshoreBlocked);
    const rideableCount = WindmateRideableWindow.longestConsensusWindowLength(
      entry,
      dateStr,
      minWindowHours,
      getModelDayHours
    );
    const idealDirections = entry.spot?.ideal_directions ?? [];
    const maxRideableWind = rideableHours.length
      ? Math.max(...rideableHours.map((h) => h.windSpeed ?? 0))
      : 0;
    const maxRideableGust = rideableHours.length
      ? Math.max(...rideableHours.map((h) => h.gusts ?? h.windSpeed ?? 0))
      : 0;
    const maxDirectionWind = directionOkViable.length
      ? Math.max(...directionOkViable.map((h) => h.windSpeed ?? 0))
      : 0;
    const maxWind = hours.length ? Math.max(...hours.map((h) => h.windSpeed ?? 0)) : 0;
    const directionAligned = (h) =>
      h.windExposure === 'onshore' || h.windExposure === 'cross' || (h.windExposure == null && h.idealWind);

    return {
      hours,
      rideableCount,
      maxRideableWind,
      maxRideableGust,
      maxDirectionWind,
      maxWind,
      windowLen: rideableCount,
      idealRideable: rideableHours.filter((h) => h.idealWind).length,
      idealViable: viableHours.filter(directionAligned).length,
      viableCount: viableHours.length,
      hasIdealDirections: idealDirections.length > 0,
    };
  }

  /** Absolute go/no-go factors (settings-based caps) — used for excitement stickers, not matrix rank. */
  function computeAbsoluteGoNoGoMetrics(entry, dateStr, prefs, radiusKm) {
    const hours = getDayHours(entry, dateStr);
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const rideableHours = hours.filter((h) => h.rideable);
    const viableHours = hours.filter((h) => h.windOk && h.weatherOk && h.tempOk);
    const directionOkViable = viableHours.filter((h) => !h.offshoreBlocked);
    const rideableCount = WindmateRideableWindow.longestConsensusWindowLength(
      entry,
      dateStr,
      minWindowHours,
      getModelDayHours
    );
    const idealDirections = entry.spot?.ideal_directions ?? [];
    const maxRideableWind = rideableHours.length
      ? Math.max(...rideableHours.map((h) => h.windSpeed ?? 0))
      : 0;
    const maxRideableGust = rideableHours.length
      ? Math.max(...rideableHours.map((h) => h.gusts ?? h.windSpeed ?? 0))
      : 0;
    const maxDirectionWind = directionOkViable.length
      ? Math.max(...directionOkViable.map((h) => h.windSpeed ?? 0))
      : 0;
    const directionAligned = (h) =>
      h.windExposure === 'onshore' || h.windExposure === 'cross' || (h.windExposure == null && h.idealWind);
    const onshoreHours = viableHours.filter(directionAligned).length;
    const wavePreference = wavePreferenceFromPrefs(prefs);
    const maxGust = Math.max(prefs?.max_gust_knots ?? 25, 1);

    return {
      rideableCount,
      maxRideableWind,
      maxRideableGust,
      maxDirectionWind,
      rideability: rideableHours.length / Math.max(hours.length, 1),
      bestWindow: Math.min(1, rideableCount / 8),
      wind: Math.min(1, maxRideableWind / maxGust),
      gust: Math.min(1, maxRideableGust / maxGust),
      onshore:
        viableHours.length > 0
          ? onshoreHours / viableHours.length
          : idealDirections.length
            ? 0.3
            : 0.5,
      waveMatch: estimateWaveMatch(rideableHours, wavePreference),
    };
  }

  function buildFactors(metrics, maxDistance, windNorm, gustNorm, wavePreference, hasIdealDirections) {
    const rideableHours = metrics.hours.filter((h) => h.rideable);
    const dist = metrics.distance_km ?? 0;

    const onshore = !metrics.hasIdealDirections
      ? 0.5
      : metrics.viableCount > 0
        ? metrics.idealViable / metrics.viableCount
        : 0;

    const peakWind = hasIdealDirections ? metrics.maxDirectionWind : metrics.maxRideableWind || metrics.maxWind;
    const peakGust = metrics.maxRideableGust ?? 0;

    return {
      rideability: metrics.rideableCount / 24,
      bestWindow: metrics.windowLen / 24,
      proximity: maxDistance > 0 ? 1 - dist / maxDistance : 1,
      wind: windNorm > 0 ? peakWind / windNorm : 0,
      gust: gustNorm > 0 ? peakGust / gustNorm : 0,
      onshore,
      waveMatch: estimateWaveMatch(rideableHours, wavePreference),
    };
  }

  function sessionScore(factors, weights) {
    return Object.keys(weights).reduce(
      (sum, key) => sum + (factors[key] ?? 0) * weights[key],
      0
    );
  }

  /** One banner per criterion across all spots; a spot may lead multiple criteria. */
  function assignTopReasons(ranked, order) {
    for (const row of ranked) row.topReasons = [];

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
      if (leader < 0 || best <= 0) continue;
      if (cat === 'onshore' && best < 0.5) continue;
      ranked[leader].topReasons.push(REASON_LABELS[cat]());
    }
  }

  function rankSpotsForDay(spots, dateStr, prefs, radiusKm) {
    const order = normalizeOrder(prefs?.rank_criteria_order);
    const weights = weightsFromOrder(order);
    const wavePreference = wavePreferenceFromPrefs(prefs);
    const maxDistance = Math.max(...spots.map((s) => s.spot.distance_km), radiusKm ?? 1, 1);

    const metricsList = spots.map((entry) => ({
      entry,
      ...computeRawMetrics(entry, dateStr, prefs),
      distance_km: entry.spot.distance_km,
    }));

    const maxRideableWind = Math.max(...metricsList.map((m) => m.maxRideableWind), 0);
    const maxRideableGust = Math.max(...metricsList.map((m) => m.maxRideableGust), 0);
    const maxDirectionWind = Math.max(...metricsList.map((m) => m.maxDirectionWind), 0);
    const globalMaxWind = Math.max(...metricsList.map((m) => m.maxWind), 1);
    const windNorm = maxDirectionWind > 0 ? maxDirectionWind : maxRideableWind > 0 ? maxRideableWind : globalMaxWind;
    const gustNorm = maxRideableGust > 0 ? maxRideableGust : 1;

    const ranked = metricsList.map((m) => {
      const factors = buildFactors(m, maxDistance, windNorm, gustNorm, wavePreference, m.hasIdealDirections);
      return {
        entry: m.entry,
        factors,
        score: sessionScore(factors, weights),
        rideableCount: m.rideableCount,
      };
    });

    assignTopReasons(ranked, order);

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.rideableCount !== a.rideableCount) return b.rideableCount - a.rideableCount;
      return a.entry.spot.distance_km - b.entry.spot.distance_km;
    });

    return partitionDistantFavorites(ranked, radiusKm, prefs?.favorite_spot_ids);
  }

  /**
   * In-radius favorites first (score order), then other spots, then distant favorites.
   */
  function partitionDistantFavorites(ranked, radiusKm, favoriteSpotIds) {
    const favorites = new Set(favoriteSpotIds ?? []);
    const radius = radiusKm ?? Infinity;
    const inRadiusFavorites = [];
    const inRadiusOthers = [];
    const distantFavorites = [];

    for (const row of ranked) {
      const dist = row.entry.spot.distance_km ?? 0;
      const id = row.entry.spot.id;
      if (favorites.has(id) && dist > radius) {
        distantFavorites.push(row);
      } else if (favorites.has(id)) {
        inRadiusFavorites.push(row);
      } else {
        inRadiusOthers.push(row);
      }
    }

    return [...inRadiusFavorites, ...inRadiusOthers, ...distantFavorites];
  }

  /** @deprecated use partitionDistantFavorites */
  function applyFavoriteBoost(ranked, favoriteSpotIds, radiusKm) {
    return partitionDistantFavorites(ranked, radiusKm, favoriteSpotIds);
  }

  function renderBanner(label) {
    return `<span class="spot-rank-banner">${label}</span>`;
  }

  function renderBanners(reasons) {
    if (!reasons?.length) return '';
    return reasons.map((label) => renderBanner(label)).join('');
  }

  function hourTimeKey(time) {
    return WindmateRideableWindow.hourTimeKey(time);
  }

  function buildConsensusHours(entry, dateStr, timelineHours) {
    const timeline = timelineHours ?? getDayHours(entry, dateStr);
    const modelEntries = Object.entries(entry.models ?? {}).filter(([, model]) => !model.error);
    if (!modelEntries.length || !timeline.length) {
      return timeline;
    }

    const indexed = modelEntries.map(([, model]) => {
      const day = model.days?.find((d) => d.date === dateStr);
      const hours = day?.hours ?? [];
      const byKey = new Map();
      for (const hour of hours) byKey.set(hourTimeKey(hour.time), hour);
      return byKey;
    });

    return timeline.map((slot) => {
      const key = hourTimeKey(slot.time);
      const allRideable = indexed.every((byKey) => byKey.get(key)?.rideable === true);
      const sample = indexed.map((byKey) => byKey.get(key)).find(Boolean) ?? slot;
      return { ...sample, time: key, rideable: allRideable };
    });
  }

  function buildRunFromHours(hours) {
    const start = hourTimeKey(hours[0].time);
    const end = hourTimeKey(hours[hours.length - 1].time);
    return { start, end, length: hours.length, hours };
  }

  function enumerateRunsFromHours(hours, minWindowHours) {
    const runs = [];
    let current = [];

    for (const hour of hours) {
      if (hour.rideable) {
        current.push(hour);
      } else if (current.length > 0) {
        if (current.length >= minWindowHours) runs.push(buildRunFromHours(current));
        current = [];
      }
    }
    if (current.length >= minWindowHours) runs.push(buildRunFromHours(current));
    return runs;
  }

  function enumerateMinLengthWindows(hours, minWindowHours) {
    const blocks = enumerateRunsFromHours(hours, minWindowHours);
    const windows = [];
    for (const block of blocks) {
      for (let i = 0; i <= block.hours.length - minWindowHours; i += 1) {
        windows.push(buildRunFromHours(block.hours.slice(i, i + minWindowHours)));
      }
    }
    return windows;
  }

  function longestRideableBlockLength(hours, minWindowHours) {
    return Math.max(...enumerateRunsFromHours(hours, minWindowHours).map((run) => run.length), 0);
  }

  function entryHasIdealDirections(dayHours) {
    return dayHours.some((h) => h.idealWind != null);
  }

  function dayWindGustNorms(dayHours) {
    const rideable = (dayHours ?? []).filter((h) => h.rideable);
    const dayMaxWind = rideable.length
      ? Math.max(...rideable.map((h) => h.windSpeed ?? 0))
      : 1;
    const dayMaxGust = rideable.length
      ? Math.max(...rideable.map((h) => h.gusts ?? h.windSpeed ?? 0))
      : dayMaxWind;

    return {
      windNorm: Math.max(dayMaxWind, 1),
      gustNorm: Math.max(dayMaxGust, 1),
    };
  }

  function computeWindowRunMetrics(runHours, dayHours, prefs, longestBlockLength, minWindowHours) {
    const viableHours = runHours.filter((h) => h.windOk && h.weatherOk && h.tempOk);
    const directionAligned = (h) =>
      h.windExposure === 'onshore' ||
      h.windExposure === 'cross' ||
      (h.windExposure == null && h.idealWind);
    const onshoreHours = viableHours.filter(directionAligned).length;
    const maxRideableWind = runHours.length
      ? Math.max(...runHours.map((h) => h.windSpeed ?? 0))
      : 0;
    const maxGust = runHours.length
      ? Math.max(...runHours.map((h) => h.gusts ?? h.windSpeed ?? 0))
      : 0;
    const { windNorm, gustNorm } = dayWindGustNorms(dayHours);
    const wavePreference = wavePreferenceFromPrefs(prefs);
    const normLength = Math.max(longestBlockLength, minWindowHours, 1);

    return {
      rideability: 1,
      bestWindow: minWindowHours / normLength,
      wind: Math.min(1, maxRideableWind / windNorm),
      gust: Math.min(1, maxGust / gustNorm),
      onshore:
        viableHours.length > 0
          ? onshoreHours / viableHours.length
          : entryHasIdealDirections(dayHours)
            ? 0.3
            : 0.5,
      waveMatch: estimateWaveMatch(runHours, wavePreference),
    };
  }

  function scoreWindowRun(run, consensusHours, prefs, longestBlockLength, minWindowHours, weights) {
    const metrics = computeWindowRunMetrics(
      run.hours,
      consensusHours,
      prefs,
      longestBlockLength,
      minWindowHours
    );
    let score = 0;
    for (const key of Object.keys(weights)) {
      if (key === 'proximity') continue;
      score += (metrics[key] ?? 0) * weights[key];
    }
    return {
      run,
      rawScore: score,
      windowScore: Math.round(score * 1000) / 1000,
      metrics,
    };
  }

  function displayWindowScore(rawScore) {
    return Math.round(rawScore * 100) / 100;
  }

  function isBetterWindowPick(candidate, current) {
    if (!current) return true;
    const displayC = displayWindowScore(candidate.rawScore);
    const displayCur = displayWindowScore(current.rawScore);
    if (displayC !== displayCur) return displayC > displayCur;
    if (candidate.rawScore !== current.rawScore) return candidate.rawScore > current.rawScore;
    return candidate.run.start < current.run.start;
  }

  function pickBestDepartureWindow(scored, byStartTime) {
    if (!scored.length) return null;

    let best = null;
    let bestSum = -Infinity;

    for (const item of scored) {
      const sum = item.run.hours.reduce((total, hour) => {
        const hourScored = byStartTime.get(hourTimeKey(hour.time));
        return total + (hourScored ? displayWindowScore(hourScored.windowScore) : 0);
      }, 0);

      if (
        !best ||
        sum > bestSum ||
        (sum === bestSum && item.run.start.localeCompare(best.run.start) < 0)
      ) {
        best = item;
        bestSum = sum;
      }
    }

    return best;
  }

  function pickBestQualifyingWindow(entry, dateStr, prefs, timelineHours) {
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const consensusHours = buildConsensusHours(entry, dateStr, timelineHours);
    const windows = enumerateMinLengthWindows(consensusHours, minWindowHours);
    if (!windows.length) return null;

    const longestBlockLength = longestRideableBlockLength(consensusHours, minWindowHours);
    const weights = weightsForDepartureWindow(prefs?.rank_criteria_order);

    const scored = windows.map((run) =>
      scoreWindowRun(run, consensusHours, prefs, longestBlockLength, minWindowHours, weights)
    );
    const byStartTime = new Map(scored.map((item) => [item.run.start, item]));
    fillTrailingHourScores(byStartTime, consensusHours, minWindowHours);
    const best = pickBestDepartureWindow(scored, byStartTime);
    if (!best) return null;

    return {
      run: best.run,
      windowScore: best.windowScore,
      metrics: best.metrics,
      sessionWindowHours: minWindowHours,
    };
  }

  function fillTrailingHourScores(byStartTime, consensusHours, minWindowHours) {
    const blocks = enumerateRunsFromHours(consensusHours, minWindowHours);
    const tailCount = Math.max(0, minWindowHours - 1);

    for (const block of blocks) {
      const hours = block.hours;
      for (let t = 0; t < tailCount; t += 1) {
        const index = hours.length - 1 - t;
        if (index < 0) break;

        const endKey = hourTimeKey(hours[index].time);
        if (byStartTime.has(endKey)) continue;

        const startIndex = index - minWindowHours + 1;
        if (startIndex < 0) continue;

        const startKey = hourTimeKey(hours[startIndex].time);
        const scored = byStartTime.get(startKey);
        if (scored) byStartTime.set(endKey, scored);
      }
    }
  }

  function scoreWindowsByStartHour(entry, dateStr, prefs, timelineHours) {
    const minWindowHours = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const consensusHours = buildConsensusHours(entry, dateStr, timelineHours);
    const windows = enumerateMinLengthWindows(consensusHours, minWindowHours);
    const longestBlockLength = longestRideableBlockLength(consensusHours, minWindowHours);
    const order = departureWindowOrder(prefs?.rank_criteria_order);
    const weights = weightsForDepartureWindow(prefs?.rank_criteria_order);
    const scored = windows.map((run) => {
      const item = scoreWindowRun(
        run,
        consensusHours,
        prefs,
        longestBlockLength,
        minWindowHours,
        weights
      );
      return { ...item, weights };
    });
    const byStartTime = new Map(scored.map((item) => [item.run.start, item]));

    fillTrailingHourScores(byStartTime, consensusHours, minWindowHours);

    const best = pickBestDepartureWindow(scored, byStartTime);
    const bestPick = best
      ? {
          run: best.run,
          windowScore: best.windowScore,
          metrics: best.metrics,
          sessionWindowHours: minWindowHours,
          weights,
        }
      : null;

    return {
      byStartTime,
      bestPick: bestPick ? { ...bestPick, weights } : null,
      sessionWindowHours: minWindowHours,
      weights,
      order,
    };
  }

  return {
    rankSpotsForDay,
    applyFavoriteBoost,
    partitionDistantFavorites,
    renderBanner,
    renderBanners,
    normalizeOrder,
    weightsFromOrder,
    departureWindowOrder,
    weightsForDepartureWindow,
    pickBestQualifyingWindow,
    scoreWindowsByStartHour,
    computeAbsoluteGoNoGoMetrics,
    DEFAULT_ORDER,
    REASON_LABELS,
  };
})();
