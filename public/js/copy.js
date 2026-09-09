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
  },

  loading: {
    dashboard: 'Checking the forecast for you…',
    saved: 'Saved — refreshing your spots…',
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
    intro: (count) => `Found ${count} spots nearby — here's what I'd do today:`,
    session: (name, hours, wind, direction) =>
      `<strong>${name}</strong> — ${hours} rideable hr${hours === 1 ? '' : 's'} today, up to ${wind} kt ${direction}`,
    quiet:
      "Quiet one today mate — nothing hits your wind thresholds. Best bet follows your ranking order below.",
    bestWind: (name, wind, direction, dist) =>
      `Best bet: <strong>${name}</strong> (${dist} km) — up to ${wind} kt ${direction}`,
  },

  horizon: {
    modelsAgree: (agreeing, total) => `${agreeing}/${total} models back me up`,
    matrixDay: (label) => `${label} — best spots first`,
    matrixToday: 'Today — best spots first',
    window: (start, end) => `${start}–${end}`,
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
    rideability: { label: 'Good hours', hint: 'How many hours pass your wind, gust, weather, and temp limits' },
    bestWindow: { label: 'Longest window', hint: 'Longest uninterrupted stretch of good hours' },
    proximity: { label: 'Distance', hint: 'Closer spots rank higher' },
    wind: { label: 'Wind strength', hint: 'Peak wind during good hours' },
    onshore: { label: 'Ideal direction', hint: 'Share of good hours with wind from ideal directions' },
    waveMatch: { label: 'Wave / chop', hint: 'Flatter chop scores higher (by sport default)' },
    planned: 'Coming later: offshore safety, water quality, water level',
  },

  rideable: {
    matrixHint:
      'Colored blocks = good hours: top wind · mid gust · bottom waves (flat / small / big). Empty = not good. Hover for wave height.',
    tooltipOk: 'good for your setup',
    tooltipBlocked: 'not good for your setup',
  },

  errors: {
    loadFailed: (msg) => `Something went sideways mate — ${msg}`,
  },

  observations: {
    noCurrent: "Can't tell you what's happening right now — forecast's still below",
    showCurve: "Today's curve ▾",
    hideCurve: "Hide curve ▴",
    windowTemp: (airMin, airMax, waterMin, waterMax) => {
      let line = `Best window temps · ${airMin}–${airMax}°C air`;
      if (waterMin != null) line += ` · ${waterMin}–${waterMax}°C water`;
      return line;
    },
    warningBanner: (message, type) =>
      `<div class="text-xs mt-2 ${type === 'storm_approaching' ? 'text-red-400' : 'text-amber-400'}">⚠️ ${message}</div>`,
  },
};
