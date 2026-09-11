/** Session excitement stickers — tiers, flair, and card markup */
const WindmateSessionExcitement = (() => {
  const EXCITEMENT_CONFIG = {
    STICKER_FLOOR: 0.2,
    EXCITEMENT_GAMMA: 0.6,
    EPSILON: 1e-6,
    TIER_BREAKS: { cool: 0.35, nice: 0.55, amazing: 0.75 },
  };

  const DURATION_KEYS = ['bestWindow', 'rideability'];
  const POWER_KEYS = ['wind', 'gust', 'waveMatch'];

  const WAVE_PREF_BY_SPORT = {
    wingfoiling: 'flat',
    sailing: 'any',
    kitesurfing: 'small',
    windsurfing: 'small',
    kitefoiling: 'flat',
    parawing: 'flat',
  };

  function resolveStickerKey(tier, flair) {
    if (!tier) return null;
    if (tier === 'bust') return 'bust';
    if (flair) return `${tier}--${flair}`;
    return tier;
  }

  function wavePreferenceFromPrefs(prefs) {
    if (prefs?.wave_preference) return prefs.wave_preference;
    return WAVE_PREF_BY_SPORT[prefs?.sport] ?? 'flat';
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

  function goNoGoWeights(prefs) {
    const order = WindmateSessionRank.normalizeOrder(prefs?.rank_criteria_order).filter(
      (k) => k !== 'proximity'
    );
    return WindmateSessionRank.weightsFromOrder(order);
  }

  function buildAnchorMinFactors(prefs) {
    const minWindow = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);
    const maxGust = Math.max(prefs?.max_gust_knots ?? 25, 1);
    const minWind = prefs?.min_wind_knots ?? 12;
    const windRatio = minWind / maxGust;
    const wavePreference = wavePreferenceFromPrefs(prefs);
    const syntheticHour = {
      windSpeed: minWind,
      waveHeightM: Math.min(2.5, 0.0016 * minWind * minWind),
    };

    return {
      bestWindow: Math.min(1, minWindow / 8),
      rideability: Math.min(1, minWindow / 24),
      wind: windRatio,
      gust: windRatio,
      onshore: 0.5,
      waveMatch: estimateWaveMatch([syntheticHour], wavePreference),
    };
  }

  function buildAnchorMaxFactors() {
    return {
      bestWindow: 1,
      rideability: 1,
      wind: 1,
      gust: 1,
      onshore: 1,
      waveMatch: 1,
    };
  }

  function dotScore(factors, weights) {
    let sum = 0;
    for (const key of Object.keys(weights)) {
      sum += (factors[key] ?? 0) * weights[key];
    }
    return sum;
  }

  function subsetWeights(weights, keys) {
    const picked = {};
    let total = 0;
    for (const key of keys) {
      const w = weights[key] ?? 0;
      if (w > 0) {
        picked[key] = w;
        total += w;
      }
    }
    if (total <= 0) {
      const share = 1 / keys.length;
      for (const key of keys) picked[key] = share;
      return picked;
    }
    for (const key of Object.keys(picked)) {
      picked[key] /= total;
    }
    return picked;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function applyGamma(value, gamma) {
    return value ** gamma;
  }

  function normalizedAxis(factors, minFactors, maxFactors, weights, keys, gamma) {
    const subWeights = subsetWeights(weights, keys);
    const raw = dotScore(factors, subWeights);
    const min = dotScore(minFactors, subWeights);
    const max = dotScore(maxFactors, subWeights);
    const span = max - min;
    if (span < EXCITEMENT_CONFIG.EPSILON) return 0;
    const linear = clamp01((raw - min) / span);
    return applyGamma(linear, gamma);
  }

  function tierFromTPrime(tPrime) {
    const { cool, nice, amazing } = EXCITEMENT_CONFIG.TIER_BREAKS;
    if (tPrime < cool) return 'cool';
    if (tPrime < nice) return 'nice';
    if (tPrime < amazing) return 'amazing';
    return 'epic';
  }

  function resolveFlair({ factors, prefs, t, tier, dPrime, pPrime }) {
    if (!tier || t < EXCITEMENT_CONFIG.STICKER_FLOOR) return null;

    const wavePreference = wavePreferenceFromPrefs(prefs);

    if (pPrime >= 0.55 && dPrime < 0.35) return 'quick-hit';
    if (
      factors.waveMatch >= 0.9 &&
      pPrime >= 0.5 &&
      (wavePreference === 'flat' || wavePreference === 'small')
    ) {
      return 'glass';
    }
    if (dPrime >= 0.65 && pPrime < 0.45) {
      if (tier === 'epic' && dPrime >= 0.75) return null;
      return 'marathon';
    }

    return null;
  }

  function factorsFromAbsoluteMetrics(metrics) {
    return {
      rideability: metrics.rideability,
      bestWindow: metrics.bestWindow,
      wind: metrics.wind,
      gust: metrics.gust,
      onshore: metrics.onshore,
      waveMatch: metrics.waveMatch,
    };
  }

  function computeExcitement({ rideableCount, factors, prefs, windowHours, peakWindKt, peakGustKt }) {
    const minWindow = WindmateRideableWindow.parseMinHours(prefs?.min_rideable_window_hours);

    if (!rideableCount || rideableCount < minWindow) {
      return {
        tier: 'bust',
        flair: null,
        stickerKey: 'bust',
        t: 0,
        tPrime: 0,
        tooltip: null,
      };
    }

    const weights = goNoGoWeights(prefs);
    const minFactors = buildAnchorMinFactors(prefs);
    const maxFactors = buildAnchorMaxFactors();
    const minScore = dotScore(minFactors, weights);
    const maxScore = dotScore(maxFactors, weights);
    const rawScore = dotScore(factors, weights);
    const span = maxScore - minScore;

    if (span < EXCITEMENT_CONFIG.EPSILON) {
      return { tier: null, flair: null, stickerKey: null, t: 0, tPrime: 0, tooltip: null };
    }

    const t = clamp01((rawScore - minScore) / span);
    const { STICKER_FLOOR, EXCITEMENT_GAMMA } = EXCITEMENT_CONFIG;

    if (t < STICKER_FLOOR) {
      return { tier: null, flair: null, stickerKey: null, t, tPrime: 0, tooltip: null };
    }

    const u = (t - STICKER_FLOOR) / (1 - STICKER_FLOOR);
    const tPrime = applyGamma(u, EXCITEMENT_GAMMA);
    const tier = tierFromTPrime(tPrime);
    const gamma = EXCITEMENT_GAMMA;

    const dPrime = normalizedAxis(factors, minFactors, maxFactors, weights, DURATION_KEYS, gamma);
    const pPrime = normalizedAxis(factors, minFactors, maxFactors, weights, POWER_KEYS, gamma);

    const flair = resolveFlair({ factors, prefs, t, tier, dPrime, pPrime });

    return {
      tier,
      flair,
      stickerKey: resolveStickerKey(tier, flair),
      t,
      tPrime,
      tooltip: {
        tier,
        flair,
        tPrime,
        windowHours: windowHours ?? rideableCount,
        peakWindKt: peakWindKt ?? null,
        peakGustKt: peakGustKt ?? null,
      },
    };
  }

  function computeFromEntry(entry, dateStr, prefs, radiusKm) {
    const metrics = WindmateSessionRank.computeAbsoluteGoNoGoMetrics(
      entry,
      dateStr,
      prefs,
      radiusKm
    );
    const factors = factorsFromAbsoluteMetrics(metrics);

    return computeExcitement({
      rideableCount: metrics.rideableCount,
      factors,
      prefs,
      windowHours: metrics.rideableCount,
      peakWindKt: metrics.maxDirectionWind || metrics.maxRideableWind,
      peakGustKt: metrics.maxRideableGust,
    });
  }

  function pickBestHorizonExcitement(spots, dateStr, prefs, radiusKm, rideableMax) {
    if (rideableMax <= 0) {
      return computeExcitement({
        rideableCount: 0,
        factors: buildAnchorMinFactors(prefs),
        prefs,
      });
    }

    let best = null;
    for (const entry of spots) {
      const result = computeFromEntry(entry, dateStr, prefs, radiusKm);
      if (!result.tier || result.tier === 'bust') continue;

      const dist = entry.spot?.distance_km ?? Infinity;
      const windowLen = result.tooltip?.windowHours ?? 0;

      if (
        !best ||
        result.t > best.t ||
        (result.t === best.t && windowLen > (best.tooltip?.windowHours ?? 0)) ||
        (result.t === best.t &&
          windowLen === (best.tooltip?.windowHours ?? 0) &&
          dist < (best._dist ?? Infinity))
      ) {
        best = { ...result, _dist: dist };
      }
    }

    if (!best) return { tier: null, flair: null, stickerKey: null, t: 0, tPrime: 0, tooltip: null };
    const { _dist, ...rest } = best;
    return rest;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tierFromStickerKey(stickerKey) {
    if (!stickerKey || stickerKey === 'bust') return stickerKey;
    return stickerKey.split('--')[0];
  }

  function stickerDisplayHtml(tier, flair) {
    const main = (WindmateCopy.excitement.tierLabel[tier] ?? tier).toUpperCase();
    if (!flair) return escapeHtml(main);
    const sub = (WindmateCopy.excitement.flairLabel[flair] ?? flair).toUpperCase();
    return `${escapeHtml(main)}<span class="session-excitement-sticker__sub">${escapeHtml(sub)}</span>`;
  }

  function formatTooltip(excitement) {
    if (!excitement?.tier) return '';
    if (excitement.tier === 'bust') return WindmateCopy.excitement.bustTooltip;

    const lead = WindmateCopy.excitement.tierLead[excitement.tier] ?? '';
    const flavor = WindmateCopy.excitement.stickerLabel(excitement.tier, excitement.flair);
    const pct = Math.round((excitement.tPrime ?? 0) * 100);
    const stats = WindmateCopy.excitement.statsLine(excitement.tooltip);
    return [flavor, lead, WindmateCopy.excitement.pctLine(pct), stats].filter(Boolean).join('\n');
  }

  function renderStickerText(stickerKey, tier, flair) {
    const tierClass = tierFromStickerKey(stickerKey);
    const label = WindmateCopy.excitement.stickerLabel(tier, flair);
    const inner = stickerDisplayHtml(tier, flair);
    const fill = WindmateWindColors.colorForExcitementTier(tierClass);
    const colorStyle = fill ? ` style="color:${fill}"` : '';
    return `<span class="session-excitement-sticker session-excitement-sticker--${tierClass}"${colorStyle} role="img" aria-label="${escapeHtml(label)}">${inner}</span>`;
  }

  function renderStickers(excitement) {
    if (!excitement?.tier) return '';

    const title = escapeHtml(formatTooltip(excitement));
    const stickerKey =
      excitement.stickerKey ?? resolveStickerKey(excitement.tier, excitement.flair);

    if (stickerKey === 'bust') {
      return `<span class="session-excitement-stack" title="${title}">
        <span class="session-excitement-sticker session-excitement-sticker--bust" role="img" aria-label="${WindmateCopy.excitement.bustLabel}">😢</span>
      </span>`;
    }

    return `<div class="session-excitement-stack" title="${title}">${renderStickerText(stickerKey, excitement.tier, excitement.flair)}</div>`;
  }

  return {
    EXCITEMENT_CONFIG,
    computeExcitement,
    computeFromEntry,
    pickBestHorizonExcitement,
    resolveStickerKey,
    renderStickers,
    formatTooltip,
  };
})();
