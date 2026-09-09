/** Windmate UI copy — written tone; wind as your mate. */
const WindmateCopy = {
  tagline: 'Your wind mate — spots, sessions, and heads-ups',

  geo: {
    locating: 'Finding you…',
    locatingAccurate: 'Getting a precise fix…',
    unavailable: "Your browser can't do GPS — enter coordinates below",
    denied: "Location blocked — allow it in the browser, or enter coordinates below",
    timeout: "GPS timed out — trying network location…",
    unavailablePosition: "Couldn't get a GPS fix — trying network location…",
    defaultMontreal: 'Using Montreal until I find you',
    yourLocation: (lat, lng) => `Near you — ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    manual: (lat, lng) => `Your pin — ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    insecure: 'Location needs HTTPS or localhost — try http://localhost:3000',
    ipLookup: 'Getting a rough fix from your network…',
    ipApprox: (label) => `Near ${label} (approx from network)`,
  },

  empty: {
    noSpotsNearby:
      "Bit quiet round here mate — no spots in range. Hang tight for sync, or widen the radius.",
    noSpotsInRange:
      "No spots loaded yet — restart the server so I can sync from iGetwind, or run POST /api/igetwind/sync.",
    noModelData: (label) => `${label}: blank on this one for now`,
    noRideableHoursForDay:
      'Nothing rideable this day mate — tap another day in the planner above.',
  },

  loading: {
    dashboard: 'Checking the forecast for you…',
    saved: 'Saved — refreshing your spots…',
  },

  legend: {
    button: 'Legend',
    title: 'Legend',
    close: 'Close legend',
  },

  settings: {
    button: 'Settings',
    title: 'Your setup',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Could not save — try again',
  },

  favorites: {
    add: (name) => `Favorite ${name}`,
    remove: (name) => `Unfavorite ${name}`,
    inList: 'In your list',
  },

  search: {
    placeholder: 'Search spots to add & favorite…',
    empty: 'No spots match — try another name',
    hint: 'Type at least 2 characters',
    km: (dist) => `${dist.toFixed(1)} km`,
  },

  picks: {
    intro: (count) =>
      `Found ${count} rideable spot${count === 1 ? '' : 's'} nearby — here's what I'd do today:`,
    session: (name, hours, wind, direction, timeRange = '') =>
      `<strong>${name}</strong> — ${hours} rideable hr${hours === 1 ? '' : 's'} today${timeRange}, up to ${wind} kt ${direction}`,
    quiet:
      "Quiet one today mate — nothing hits your wind thresholds. Best bet follows your ranking order below.",
    bestWind: (name, wind, direction, dist) =>
      `Best bet: <strong>${name}</strong> (${dist} km) — up to ${wind} kt ${direction}`,
  },

  horizon: {
    modelsAgree: (agreeing, total) => `${agreeing}/${total} models back me up`,
    spotsWithWindows: (count) =>
      count === 1 ? '1 spot with a shared window' : `${count} spots with shared windows`,
    todayShort: 'Today',
    window: (start, end) => `${start}–${end}`,
    windLine: (range) => `${range} kt wind`,
    gustLine: (range) => `${range} kt gust`,
    noRideableWind: 'No rideable wind',
    rideableHours: (min, max) =>
      min === max
        ? `${max} rideable hr${max === 1 ? '' : 's'}`
        : `${min}–${max} rideable hrs`,
  },

  rank: {
    mostGoodHours: 'Most good hours',
    longestWindow: 'Longest window',
    closest: 'Closest',
    bestWind: 'Best wind',
    idealDirection: 'Ideal direction',
    bestWaves: 'Best waves',
  },

  rankCriteria: {
    sectionTitle: 'Spot ranking',
    sectionHint: 'Drag to reorder — top matters most. Saves automatically.',
    rideability: { label: 'Good hours', hint: 'Hours passing wind, gust, weather, temp, and direction rules' },
    bestWindow: { label: 'Longest window', hint: 'Longest uninterrupted stretch of good hours' },
    proximity: { label: 'Distance', hint: 'Closer spots rank higher' },
    wind: { label: 'Wind strength', hint: 'Peak wind during good hours' },
    onshore: { label: 'Ideal direction', hint: 'Share of good hours with wind from ideal directions' },
    waveMatch: { label: 'Wave / chop', hint: 'Flatter chop scores higher (by sport default)' },
    planned: 'Coming later: water quality, water level',
  },

  offshore: {
    avoidHint: 'Offshore hours never count as rideable. Onshore and cross-shore still OK.',
    okHint: 'Offshore hours can count as rideable when wind and weather are OK.',
  },

  matrix: {
    windRow: 'Wind',
    gustRow: 'Gust',
    waveRow: 'Wave',
  },

  direction: {
    rowLabel: 'Direction',
    exposure: {
      onshore: 'Onshore',
      cross: 'Cross-shore',
      offshore: 'Offshore',
      unknown: 'Unknown',
    },
    legendOnshore: 'Onshore',
    legendCross: 'Cross-shore',
    legendOffshore: 'Offshore',
  },

  map: {
    sessionPeak: (dayLabel, hour) => `${dayLabel} · ${hour}`,
    aria: (speed, direction, dayLabel, hour) =>
      `Forecast map for ${dayLabel}, peak ${Math.round(speed)} knots from ${direction} around ${hour}`,
    ariaEmpty: (name, dayLabel) => `Forecast map for ${name}, ${dayLabel}`,
  },

  rideable: {
    windowStats: (windKt, gustKt, waves) =>
      `Window · ${windKt} kt · gusts ${gustKt} kt · waves ${waves}`,
    windowStatsTitle: 'Min–max during the solid shared window (opaque blocks)',
    matrixHint:
      'Each hour splits by model — compare colors across segments to spot agreement. Solid = longest shared window (min consecutive hrs in settings). Faded = good but outside the best shared window. Striped amber = offshore blocked. Hover for details.',
    legendWindow: 'Best shared window',
    legendIsolated: 'Good hour, not a sure window',
    tooltipOk: 'all models agree — in a session window',
    tooltipIsolated: 'good wind — window too short for your min hours',
    tooltipModelDisagree: 'good in this model — not all models agree',
    tooltipOffshore: 'offshore — blocked by your settings',
    tooltipCross: 'cross-shore — OK for rideability',
    tooltipWrongDirection: 'offshore — not rideable with your settings',
    tooltipBlocked: 'not good for your setup',
    tooltipNight: 'night — not counted as rideable',
  },

  errors: {
    loadFailed: (msg) => `Something went sideways mate — ${msg}`,
  },

  watchlist: {
    verdictLive: {
      go: 'Go',
      caution: 'Caution',
      no_go: 'No go',
      unknown: 'Unknown',
    },
    verdictForecast: {
      go: 'On track',
      caution: 'Unsure',
      no_go: 'Looking bad',
      unknown: 'Unknown',
    },
  },

  observations: {
    noCurrent: "Can't tell you what's happening right now — forecast's still below",
    mismatch: {
      go: 'Go',
      caution: 'Caution',
      no_go: 'No go',
      unknown: 'Unknown',
    },
    mismatchMessage(mismatch, current) {
      if (mismatch.state === 'go') {
        return `Looking good mate — ${Math.round(current?.windSpeed ?? 0)} kt, forecast nailed it.`;
      }
      if (mismatch.state === 'caution') {
        const forecastKt =
          current?.deltaKt != null
            ? Math.round((current.windSpeed - current.deltaKt) * 10) / 10
            : '?';
        return `Forecast said ${forecastKt} kt — only seeing ${Math.round(current?.windSpeed ?? 0)}. Might be thin.`;
      }
      if (mismatch.state === 'no_go') {
        return "Don't bother mate — forecast oversold it.";
      }
      return "Can't tell you what's happening right now — don't trust forecast alone.";
    },
    showCurve: "Today's curve ▾",
    hideCurve: "Hide curve ▴",
    rideableWindow: 'Rideable window',
    windowTemp: (airMin, airMax, waterMin, waterMax) => {
      let line = `Best window temps · ${airMin}–${airMax}°C air`;
      if (waterMin != null) line += ` · ${waterMin}–${waterMax}°C water`;
      return line;
    },
    warningBanner: (message, type) =>
      `<div class="text-xs mt-2 ${type === 'storm_approaching' ? 'text-red-400' : 'text-amber-400'}">⚠️ ${message}</div>`,
  },
};
