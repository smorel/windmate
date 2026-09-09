const MONTREAL = { lat: 45.5017, lng: -73.5673 };
const SPORT_COLORS = {
  wingfoiling: '#10b981',
  sailing: '#14b8a6',
  kitesurfing: '#3b82f6',
};

let userLocation = { ...MONTREAL };
let rideabilityData = null;
let observationsData = null;
let locating = false;
let selectedDayDate = null;

const GEO = { DENIED: 1, UNAVAILABLE: 2, TIMEOUT: 3 };

const els = {
  locationStatus: document.getElementById('location-status'),
  locateBtn: document.getElementById('locate-btn'),
  manualLocation: document.getElementById('manual-location'),
  manualLat: document.getElementById('manual-lat'),
  manualLng: document.getElementById('manual-lng'),
  manualLocBtn: document.getElementById('manual-loc-btn'),
  prefsForm: document.getElementById('prefs-form'),
  sport: document.getElementById('sport'),
  minWind: document.getElementById('min-wind'),
  maxGust: document.getElementById('max-gust'),
  searchRadius: document.getElementById('search-radius'),
  minAir: document.getElementById('min-air'),
  minWater: document.getElementById('min-water'),
  offshoreWind: document.getElementById('offshore-wind'),
  offshoreWindHint: document.getElementById('offshore-wind-hint'),
  minRideableWindow: document.getElementById('min-rideable-window'),
  horizonPlanner: document.getElementById('horizon-planner'),
  matrixDayLabel: document.getElementById('matrix-day-label'),
  rideabilityMatrix: document.getElementById('rideability-matrix'),
  modelLegend: document.getElementById('model-legend'),
  legendBtn: document.getElementById('legend-btn'),
  legendModal: document.getElementById('legend-modal'),
  matePicks: document.getElementById('mate-picks'),
  matePicksContent: document.getElementById('mate-picks-content'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  settingsSaveStatus: document.getElementById('settings-save-status'),
  rankSectionTitle: document.getElementById('rank-section-title'),
  rankSectionHint: document.getElementById('rank-section-hint'),
  rankCriteriaList: document.getElementById('rank-criteria-list'),
  rankCriteriaPlanned: document.getElementById('rank-criteria-planned'),
  spotSearch: document.getElementById('spot-search'),
  spotSearchInput: document.getElementById('spot-search-input'),
  spotSearchResults: document.getElementById('spot-search-results'),
};

let rankCriteriaOrder = [...WindmateSessionRank.DEFAULT_ORDER];
let favoriteSpotIds = [];
let rankDragKey = null;
let savePrefsTimer = null;
let persistPrefsPromise = null;
let spotSearchTimer = null;
let spotSearchRequestId = 0;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

function setLocation(lat, lng, label) {
  userLocation = { lat, lng };
  els.locationStatus.textContent = label ?? WindmateCopy.geo.yourLocation(lat, lng);
  refreshDashboard();
}

function setLocateButtonBusy(busy) {
  locating = busy;
  if (!els.locateBtn) return;
  els.locateBtn.disabled = busy;
  els.locateBtn.textContent = busy ? 'Locating…' : 'Use my location';
}

function showManualLocation() {
  els.manualLocation.classList.remove('hidden');
  openSettingsModal();
}

function geoErrorMessage(error) {
  if (!error) return WindmateCopy.geo.unavailablePosition;
  switch (error.code) {
    case GEO.DENIED:
      return WindmateCopy.geo.denied;
    case GEO.TIMEOUT:
      return WindmateCopy.geo.timeout;
    case GEO.UNAVAILABLE:
      return WindmateCopy.geo.unavailablePosition;
    default:
      return WindmateCopy.geo.unavailablePosition;
  }
}

function requestCurrentPosition(options, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject({ code: GEO.UNAVAILABLE, message: 'insecure' });
      return;
    }
    if (!navigator.geolocation) {
      reject({ code: GEO.UNAVAILABLE, message: 'unsupported' });
      return;
    }

    let watchId = null;
    const timer = setTimeout(() => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      reject({ code: GEO.TIMEOUT, message: 'timeout' });
    }, timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(timer);
        navigator.geolocation.clearWatch(watchId);
        resolve(pos);
      },
      (err) => {
        clearTimeout(timer);
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        reject(err);
      },
      options
    );
  });
}

async function requestIpLocation() {
  els.locationStatus.textContent = WindmateCopy.geo.ipLookup;
  const data = await api('/api/location/ip');
  setLocation(data.lat, data.lng, WindmateCopy.geo.ipApprox(data.label));
  return true;
}

async function requestLocation({ accurate = false, allowIpFallback = true } = {}) {
  if (locating) return false;
  setLocateButtonBusy(true);

  if (!window.isSecureContext) {
    els.locationStatus.textContent = WindmateCopy.geo.insecure;
    showManualLocation();
    if (allowIpFallback) {
      try {
        await requestIpLocation();
        setLocateButtonBusy(false);
        return true;
      } catch {
        /* fall through */
      }
    }
    setLocateButtonBusy(false);
    return false;
  }

  if (!navigator.geolocation) {
    els.locationStatus.textContent = WindmateCopy.geo.unavailable;
    showManualLocation();
    if (allowIpFallback) {
      try {
        await requestIpLocation();
        setLocateButtonBusy(false);
        return true;
      } catch {
        /* fall through */
      }
    }
    setLocateButtonBusy(false);
    return false;
  }

  els.locationStatus.textContent = accurate
    ? WindmateCopy.geo.locatingAccurate
    : WindmateCopy.geo.locating;

  const options = accurate
    ? { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    : { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 };

  try {
    const pos = await requestCurrentPosition(options, accurate ? 20000 : 12000);
    const { latitude, longitude } = pos.coords;
    setLocation(latitude, longitude, WindmateCopy.geo.yourLocation(latitude, longitude));
    setLocateButtonBusy(false);
    return true;
  } catch (err) {
    const denied = err?.code === GEO.DENIED;
    if (!accurate && !denied) {
      const ok = await requestLocation({ accurate: true, allowIpFallback: false });
      if (ok) {
        setLocateButtonBusy(false);
        return true;
      }
    }

    if (allowIpFallback) {
      try {
        await requestIpLocation();
        setLocateButtonBusy(false);
        return true;
      } catch {
        /* fall through */
      }
    }

    els.locationStatus.textContent = geoErrorMessage(err);
    showManualLocation();
    setLocateButtonBusy(false);
    return false;
  }
}

async function handleLocateClick() {
  els.locationStatus.textContent = WindmateCopy.geo.locating;
  await requestLocation({ accurate: false, allowIpFallback: true });
}

function initGeolocation() {
  requestLocation();
}

function initRankCriteriaSection() {
  if (els.rankSectionTitle) {
    els.rankSectionTitle.textContent = WindmateCopy.rankCriteria.sectionTitle;
  }
  if (els.rankSectionHint) {
    els.rankSectionHint.textContent = WindmateCopy.rankCriteria.sectionHint;
  }
  if (els.rankCriteriaPlanned) {
    els.rankCriteriaPlanned.textContent = WindmateCopy.rankCriteria.planned;
  }
}

function getRankCriteriaOrder() {
  if (els.rankCriteriaList?.children.length) {
    return [...els.rankCriteriaList.querySelectorAll('[data-criterion]')].map(
      (el) => el.dataset.criterion
    );
  }
  return WindmateSessionRank.normalizeOrder(rankCriteriaOrder);
}

function normalizeFavoriteSpotIds(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const result = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function isFavoriteSpot(spotId) {
  return favoriteSpotIds.includes(spotId);
}

function getSearchRadiusKm() {
  const fromInput = parseInt(els.searchRadius?.value, 10);
  if (!Number.isNaN(fromInput)) {
    return Math.min(300, Math.max(5, fromInput));
  }
  return rideabilityData?.preferences?.radius_km ?? 80;
}

function prefsForRanking(basePrefs) {
  return {
    ...basePrefs,
    rank_criteria_order: getRankCriteriaOrder(),
    favorite_spot_ids: favoriteSpotIds,
  };
}

function applyRankOrderToMatrix() {
  if (!rideabilityData) return;
  const prefs = prefsForRanking(rideabilityData.preferences);
  rankCriteriaOrder = prefs.rank_criteria_order;
  const payload = { ...rideabilityData, preferences: prefs };
  renderMatePicks(payload);
  renderRideabilityMatrix(payload, observationsData);
}

function getMinRideableWindowHours(prefs) {
  return WindmateRideableWindow.parseMinHours(
    prefs?.min_rideable_window_hours ?? els.minRideableWindow?.value
  );
}

function buildPreferencesPayload() {
  return {
    sport: els.sport.value,
    min_wind_knots: parseInt(els.minWind.value, 10),
    max_gust_knots: parseInt(els.maxGust.value, 10),
    min_air_temp_c: els.minAir.value === '' ? null : parseFloat(els.minAir.value),
    min_water_temp_c: els.minWater.value === '' ? null : parseFloat(els.minWater.value),
    offshore_wind_ok: els.offshoreWind?.value === '1' ? 1 : 0,
    min_rideable_window_hours: getMinRideableWindowHours(),
    rank_criteria_order: getRankCriteriaOrder(),
    favorite_spot_ids: favoriteSpotIds,
    radius_km: getSearchRadiusKm(),
  };
}

function syncOffshoreHint(offshoreOk) {
  if (!els.offshoreWindHint) return;
  els.offshoreWindHint.textContent = offshoreOk
    ? WindmateCopy.offshore.okHint
    : WindmateCopy.offshore.avoidHint;
}

function syncPreferencesState(prefs) {
  rankCriteriaOrder = WindmateSessionRank.normalizeOrder(
    prefs.rank_criteria_order ?? rankCriteriaOrder
  );
  favoriteSpotIds = normalizeFavoriteSpotIds(prefs.favorite_spot_ids);
  if (rideabilityData) {
    rideabilityData.preferences = { ...rideabilityData.preferences, ...prefs };
  }
  renderRankCriteriaList(rankCriteriaOrder);
  if (els.offshoreWind) {
    els.offshoreWind.value = prefs.offshore_wind_ok ? '1' : '0';
    syncOffshoreHint(prefs.offshore_wind_ok);
  }
}

function onRankOrderChanged() {
  applyRankOrderToMatrix();
  schedulePreferencesSave({ fullRefresh: false, delayMs: 200 });
}

function setSettingsSaveStatus(text, isError = false) {
  if (!els.settingsSaveStatus) return;
  els.settingsSaveStatus.textContent = text;
  els.settingsSaveStatus.classList.toggle('text-red-400', isError);
  els.settingsSaveStatus.classList.toggle('text-slate-500', !isError);
}

function schedulePreferencesSave({ fullRefresh = true, delayMs = 450 } = {}) {
  clearTimeout(savePrefsTimer);
  savePrefsTimer = setTimeout(() => {
    persistPreferences({ fullRefresh }).catch(() => {});
  }, delayMs);
}

async function persistPreferences({ fullRefresh = true } = {}) {
  if (persistPrefsPromise) {
    await persistPrefsPromise;
  }

  setSettingsSaveStatus(WindmateCopy.settings.saving);

  persistPrefsPromise = (async () => {
    try {
      const updated = await api('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify(buildPreferencesPayload()),
      });
      syncPreferencesState(updated);
      if (fullRefresh) {
        await refreshDashboard({ silent: true });
      } else {
        applyRankOrderToMatrix();
      }
      setSettingsSaveStatus(WindmateCopy.settings.saved);
      window.setTimeout(() => setSettingsSaveStatus(''), 2000);
    } catch (err) {
      setSettingsSaveStatus(WindmateCopy.settings.saveFailed, true);
      throw err;
    } finally {
      persistPrefsPromise = null;
    }
  })();

  return persistPrefsPromise;
}

function bindPreferencesAutoSave() {
  els.sport.addEventListener('change', () => schedulePreferencesSave({ fullRefresh: true, delayMs: 0 }));
  for (const input of [els.searchRadius, els.minWind, els.maxGust, els.minAir, els.minWater, els.minRideableWindow]) {
    if (!input) continue;
    input.addEventListener('input', () => schedulePreferencesSave({ fullRefresh: true }));
    input.addEventListener('change', () => schedulePreferencesSave({ fullRefresh: true, delayMs: 0 }));
  }
  els.offshoreWind?.addEventListener('change', () => {
    syncOffshoreHint(els.offshoreWind.value === '1');
    schedulePreferencesSave({ fullRefresh: true, delayMs: 0 });
  });
  els.prefsForm.addEventListener('submit', (e) => e.preventDefault());
}

function isAnyModalOpen() {
  return (
    !els.settingsModal?.classList.contains('hidden') ||
    !els.legendModal?.classList.contains('hidden')
  );
}

function syncModalOpenClass() {
  document.body.classList.toggle('modal-open', isAnyModalOpen());
}

function openSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.classList.remove('hidden');
  syncModalOpenClass();
  els.settingsBtn?.setAttribute('aria-expanded', 'true');
}

function closeSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.classList.add('hidden');
  syncModalOpenClass();
  els.settingsBtn?.setAttribute('aria-expanded', 'false');
}

function openLegendModal() {
  if (!els.legendModal) return;
  els.legendModal.classList.remove('hidden');
  syncModalOpenClass();
  els.legendBtn?.setAttribute('aria-expanded', 'true');
}

function closeLegendModal() {
  if (!els.legendModal) return;
  els.legendModal.classList.add('hidden');
  syncModalOpenClass();
  els.legendBtn?.setAttribute('aria-expanded', 'false');
}

function initLegendModal() {
  const title = document.getElementById('legend-modal-title');
  if (title) title.textContent = WindmateCopy.legend.title;

  const closeBtn = els.legendModal?.querySelector('[data-close-legend][aria-label]');
  if (closeBtn) closeBtn.setAttribute('aria-label', WindmateCopy.legend.close);

  if (els.legendBtn) {
    els.legendBtn.textContent = WindmateCopy.legend.button;
    els.legendBtn.setAttribute('aria-haspopup', 'dialog');
    els.legendBtn.setAttribute('aria-expanded', 'false');
    els.legendBtn.addEventListener('click', openLegendModal);
  }

  els.legendModal?.querySelectorAll('[data-close-legend]').forEach((el) => {
    el.addEventListener('click', closeLegendModal);
  });
}

function initSettingsModal() {
  const title = document.getElementById('settings-modal-title');
  if (title) title.textContent = WindmateCopy.settings.title;

  if (els.settingsBtn) {
    els.settingsBtn.textContent = WindmateCopy.settings.button;
    els.settingsBtn.setAttribute('aria-haspopup', 'dialog');
    els.settingsBtn.setAttribute('aria-expanded', 'false');
    els.settingsBtn.addEventListener('click', openSettingsModal);
  }

  els.settingsModal?.querySelectorAll('[data-close-settings]').forEach((el) => {
    el.addEventListener('click', closeSettingsModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.legendModal?.classList.contains('hidden')) {
      closeLegendModal();
    } else if (!els.settingsModal?.classList.contains('hidden')) {
      closeSettingsModal();
    }
  });

  bindPreferencesAutoSave();
}

function moveRankCriterion(key, direction) {
  const order = getRankCriteriaOrder();
  const i = order.indexOf(key);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  rankCriteriaOrder = order;
  renderRankCriteriaList(order);
  onRankOrderChanged();
}

function renderRankCriteriaList(order) {
  if (!els.rankCriteriaList) return;
  rankCriteriaOrder = WindmateSessionRank.normalizeOrder(order);

  els.rankCriteriaList.innerHTML = rankCriteriaOrder
    .map((key, index) => {
      const meta = WindmateCopy.rankCriteria[key];
      if (!meta) return '';
      return `
        <li
          class="rank-criteria-item"
          data-criterion="${key}"
          draggable="true"
          title="${meta.hint}"
        >
          <span class="rank-criteria-handle" aria-hidden="true">⋮⋮</span>
          <span class="rank-criteria-rank">${index + 1}</span>
          <span class="rank-criteria-label">${meta.label}</span>
          <span class="rank-criteria-actions">
            <button type="button" class="rank-criteria-btn" data-move="-1" data-key="${key}" aria-label="Move ${meta.label} up">↑</button>
            <button type="button" class="rank-criteria-btn" data-move="1" data-key="${key}" aria-label="Move ${meta.label} down">↓</button>
          </span>
        </li>`;
    })
    .join('');

  els.rankCriteriaList.querySelectorAll('.rank-criteria-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      moveRankCriterion(btn.dataset.key, parseInt(btn.dataset.move, 10));
    });
  });

  els.rankCriteriaList.querySelectorAll('.rank-criteria-item').forEach((item) => {
    item.addEventListener('dragstart', () => {
      rankDragKey = item.dataset.criterion;
      item.classList.add('rank-criteria-item--dragging');
    });
    item.addEventListener('dragend', () => {
      rankDragKey = null;
      item.classList.remove('rank-criteria-item--dragging');
      els.rankCriteriaList.querySelectorAll('.rank-criteria-item').forEach((el) => {
        el.classList.remove('rank-criteria-item--over');
      });
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (item.dataset.criterion !== rankDragKey) {
        item.classList.add('rank-criteria-item--over');
      }
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('rank-criteria-item--over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('rank-criteria-item--over');
      const targetKey = item.dataset.criterion;
      if (!rankDragKey || rankDragKey === targetKey) return;
      const order = getRankCriteriaOrder();
      const from = order.indexOf(rankDragKey);
      const to = order.indexOf(targetKey);
      if (from < 0 || to < 0) return;
      order.splice(from, 1);
      order.splice(to, 0, rankDragKey);
      rankCriteriaOrder = order;
      renderRankCriteriaList(order);
      onRankOrderChanged();
    });
  });
}

async function loadPreferences() {
  const prefs = await api('/api/preferences');
  els.sport.value = prefs.sport;
  els.minWind.value = prefs.min_wind_knots;
  els.maxGust.value = prefs.max_gust_knots;
  els.minAir.value = prefs.min_air_temp_c ?? '';
  els.minWater.value = prefs.min_water_temp_c ?? '';
  if (els.searchRadius) els.searchRadius.value = prefs.radius_km ?? 80;
  if (els.minRideableWindow) {
    els.minRideableWindow.value = getMinRideableWindowHours(prefs);
  }
  syncPreferencesState(prefs);
}

function setDashboardLoading(message) {
  const html = `<p class="col-span-full text-slate-400">${message}</p>`;
  els.horizonPlanner.innerHTML = html;
  els.rideabilityMatrix.innerHTML = `<p class="text-slate-400">${message}</p>`;
}

async function refreshDashboard({ silent = false } = {}) {
  if (!silent) {
    setDashboardLoading(WindmateCopy.loading.dashboard);
  }
  const radius = getSearchRadiusKm();
  const query = `lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${radius}&limit=12`;
  try {
    const [rideRes, obsRes] = await Promise.all([
      api(`/api/rideability?${query}`),
      api(`/api/observations?${query}`).catch(() => ({ spots: [] })),
    ]);
    rideabilityData = rideRes;
    observationsData = obsRes;
    rideabilityData.preferences = prefsForRanking(rideabilityData.preferences);
    rankCriteriaOrder = rideabilityData.preferences.rank_criteria_order;
    favoriteSpotIds = normalizeFavoriteSpotIds(rideabilityData.preferences.favorite_spot_ids);
    renderRankCriteriaList(rankCriteriaOrder);
    renderMatePicks(rideabilityData);
    renderModelLegend(rideabilityData);
    renderHorizonPlanner(rideabilityData);
    renderRideabilityMatrix(rideabilityData, observationsData);
  } catch (err) {
    const msg = WindmateCopy.errors.loadFailed(err.message);
    els.horizonPlanner.innerHTML = `<p class="col-span-full text-red-400">${msg}</p>`;
    els.rideabilityMatrix.innerHTML = `<p class="text-red-400">${msg}</p>`;
    els.matePicks.classList.add('hidden');
  }
}

function renderMatePicks(data) {
  if (!els.matePicks || !els.matePicksContent) return;

  if (!data.spots.length) {
    els.matePicks.classList.add('hidden');
    return;
  }

  els.matePicks.classList.remove('hidden');

  const today = WindmateForecastTime.forecastTodayFromRideability(data);
  const prefs = prefsForRanking(data.preferences);
  const rankedRows = sortSpotsForDay(data.spots, today, prefs, data.radius_km);
  const withSessions = rankedRows.filter((row) => row.rideableCount > 0);

  if (withSessions.length > 0) {
    const top = withSessions.slice(0, 3);
    els.matePicksContent.innerHTML =
      `<p class="text-slate-400 mb-3">${WindmateCopy.picks.intro(withSessions.length)}</p>` +
      top
        .map((row) => {
          const entry = row.entry;
          const dayHours = getSpotDayData(entry, today)?.hours ?? entry.today ?? [];
          const peak = dayHours.reduce(
            (best, h) =>
              h.rideable && h.windSpeed > (best?.windSpeed ?? 0) ? h : best,
            null
          );
          return `<p>${WindmateCopy.picks.session(
            entry.spot.name,
            row.rideableCount,
            Math.round(peak?.windSpeed ?? 0),
            peak?.direction ?? '—'
          )}</p>`;
        })
        .join('');
    return;
  }

  els.matePicksContent.innerHTML = `<p class="text-slate-400">${WindmateCopy.picks.quiet}</p>`;
}

function renderRideLegend() {
  return `
    <div class="matrix-ride-legend w-full">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--rideable" aria-hidden="true"></span>
          ${WindmateCopy.rideable.legendWindow}
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--rideable-isolated" aria-hidden="true"></span>
          ${WindmateCopy.rideable.legendIsolated}
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--rideable-rain" aria-hidden="true"></span>
          Good + minor rain
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--offshore" aria-hidden="true"></span>
          Offshore blocked
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--empty" aria-hidden="true"></span>
          Not good
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
        <span class="matrix-ride-legend-item">
          <span class="matrix-direction-legend matrix-direction-legend--onshore" aria-hidden="true"></span>
          ${WindmateCopy.direction.legendOnshore}
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-direction-legend matrix-direction-legend--cross" aria-hidden="true"></span>
          ${WindmateCopy.direction.legendCross}
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-direction-legend matrix-direction-legend--offshore" aria-hidden="true"></span>
          ${WindmateCopy.direction.legendOffshore}
        </span>
      </div>
      <p class="text-xs text-slate-500 mt-2">${WindmateCopy.rideable.matrixHint}</p>
    </div>`;
}

function renderModelLegend(data) {
  if (!els.modelLegend) return;

  const windLegend = WindmateWindColors.renderLegend();
  const waveLegend = WindmateWaveColors.renderLegend();
  const rideLegend = renderRideLegend();
  const first = data.spots.find((s) => s.models && Object.keys(s.models).length);
  if (!first) {
    els.modelLegend.innerHTML = `${windLegend}${waveLegend}${rideLegend}`;
    return;
  }

  const modelLabels = Object.entries(first.models)
    .map(([id, model]) => {
      const err = model.error ? ` · ${model.error}` : '';
      return `<span>${model.label ?? id}${err}</span>`;
    })
    .join('<span class="text-slate-600"> · </span>');

  els.modelLegend.innerHTML = `
    ${windLegend}
    ${waveLegend}
    ${rideLegend}
    <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <span class="text-slate-500">Models:</span>
      ${modelLabels}
    </div>`;
}

function getSpotDayData(entry, dateStr) {
  const primary = entry.primaryModel;
  if (entry.models?.[primary]?.days) {
    const day = entry.models[primary].days.find((d) => d.date === dateStr);
    if (day) return day;
  }
  return (entry.days ?? []).find((d) => d.date === dateStr) ?? null;
}

function getModelDayHours(entry, modelId, dateStr) {
  const day = entry.models?.[modelId]?.days?.find((d) => d.date === dateStr);
  return day?.hours ?? [];
}

function getConsensusRideableHours(entry, dateStr, prefs) {
  const minWindowHours = getMinRideableWindowHours(prefs);
  return WindmateRideableWindow.longestConsensusWindowLength(
    entry,
    dateStr,
    minWindowHours,
    getModelDayHours
  );
}

function getDayRideableWindowRange(spots, dateStr, prefs) {
  if (!spots?.length) return { min: 0, max: 0 };

  const values = spots
    .map((entry) => getConsensusRideableHours(entry, dateStr, prefs))
    .filter((hours) => hours > 0);

  if (!values.length) return { min: 0, max: 0 };

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function renderFavoriteButton(spot) {
  const on = isFavoriteSpot(spot.id);
  const label = on
    ? WindmateCopy.favorites.remove(spot.name)
    : WindmateCopy.favorites.add(spot.name);
  return `<button type="button" class="spot-favorite-btn${on ? ' spot-favorite-btn--on' : ''}" data-spot-id="${spot.id}" aria-label="${label}" aria-pressed="${on}" title="${label}">${on ? '★' : '☆'}</button>`;
}

function favoriteToggleNeedsFullRefresh(spotId, wasFavorite) {
  const entry = rideabilityData?.spots?.find((e) => e.spot.id === spotId);
  const radius = getSearchRadiusKm();
  if (!wasFavorite && !entry) return true;
  if (wasFavorite && entry && entry.spot.distance_km > radius) return true;
  return false;
}

function toggleFavorite(spotId) {
  const wasFavorite = isFavoriteSpot(spotId);
  const next = new Set(favoriteSpotIds);
  if (next.has(spotId)) next.delete(spotId);
  else next.add(spotId);
  favoriteSpotIds = [...next];
  if (rideabilityData?.preferences) {
    rideabilityData.preferences.favorite_spot_ids = favoriteSpotIds;
  }

  const fullRefresh = favoriteToggleNeedsFullRefresh(spotId, wasFavorite);
  if (fullRefresh) {
    schedulePreferencesSave({ fullRefresh: true, delayMs: 0 });
  } else {
    applyRankOrderToMatrix();
    schedulePreferencesSave({ fullRefresh: false, delayMs: 0 });
  }

  if (els.spotSearchResults && !els.spotSearchResults.classList.contains('hidden')) {
    const q = els.spotSearchInput?.value.trim();
    if (q.length >= 2) runSpotSearch(q);
  }
}

function setSearchResultsOpen(open) {
  if (els.spotSearchInput) {
    els.spotSearchInput.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

function preserveSearchInputCursor(updateFn) {
  const input = els.spotSearchInput;
  if (!input) {
    updateFn();
    return;
  }
  const start = input.selectionStart;
  const end = input.selectionEnd;
  updateFn();
  if (document.activeElement !== input || start == null || end == null) return;
  const len = input.value.length;
  const nextStart = Math.min(start, len);
  const nextEnd = Math.min(end, len);
  try {
    input.setSelectionRange(nextStart, nextEnd);
  } catch {
    /* ignore if input lost focus */
  }
}

function hideSpotSearchResults() {
  els.spotSearchResults?.classList.add('hidden');
  setSearchResultsOpen(false);
}

function renderSpotSearchResults(spots) {
  if (!els.spotSearchResults) return;
  preserveSearchInputCursor(() => {
    if (!spots.length) {
      els.spotSearchResults.innerHTML = `<p class="spot-search-result text-sm text-slate-500">${WindmateCopy.search.empty}</p>`;
      els.spotSearchResults.classList.remove('hidden');
      setSearchResultsOpen(true);
      return;
    }

    els.spotSearchResults.innerHTML = spots
      .map((spot) => {
        const inList = rideabilityData?.spots?.some((e) => e.spot.id === spot.id);
        const badge = inList
          ? `<span class="spot-search-result__badge">${WindmateCopy.favorites.inList}</span>`
          : '';
        return `
        <div class="spot-search-result" role="option">
          <div class="spot-search-result__meta">
            <span class="spot-search-result__name">${spot.name}${badge}</span>
            <span class="spot-search-result__dist">${WindmateCopy.search.km(spot.distance_km)}</span>
          </div>
          ${renderFavoriteButton(spot)}
        </div>`;
      })
      .join('');
    els.spotSearchResults.classList.remove('hidden');
    setSearchResultsOpen(true);
  });
}

async function runSpotSearch(query) {
  if (!els.spotSearchResults) return;
  const requestId = ++spotSearchRequestId;
  try {
    const data = await api(
      `/api/spots/search?q=${encodeURIComponent(query)}&lat=${userLocation.lat}&lng=${userLocation.lng}&limit=15`
    );
    if (requestId !== spotSearchRequestId) return;
    if (els.spotSearchInput?.value.trim() !== query) return;
    renderSpotSearchResults(data.spots ?? []);
  } catch (err) {
    if (requestId !== spotSearchRequestId) return;
    const msg = err?.message ?? 'search failed';
    preserveSearchInputCursor(() => {
      els.spotSearchResults.innerHTML = `<p class="spot-search-result text-sm text-red-400">${WindmateCopy.errors.loadFailed(msg)}</p>`;
      els.spotSearchResults.classList.remove('hidden');
      setSearchResultsOpen(true);
    });
  }
}

function initSpotSearch() {
  if (els.spotSearchInput) {
    els.spotSearchInput.placeholder = WindmateCopy.search.placeholder;
    els.spotSearchInput.addEventListener('input', () => {
      clearTimeout(spotSearchTimer);
      const raw = els.spotSearchInput.value;
      const q = raw.trim();
      if (q.length < 2) {
        spotSearchRequestId += 1;
        hideSpotSearchResults();
        return;
      }
      spotSearchTimer = setTimeout(() => runSpotSearch(q), 250);
    });
    els.spotSearchInput.addEventListener('focus', () => {
      const q = els.spotSearchInput.value.trim();
      if (q.length >= 2) runSpotSearch(q);
    });
  }

  els.spotSearchResults?.addEventListener('mousedown', (e) => {
    if (e.target.closest('.spot-favorite-btn')) return;
    e.preventDefault();
  });

  document.addEventListener('click', (e) => {
    if (els.spotSearch?.contains(e.target)) return;
    hideSpotSearchResults();
  });
}

function initFavoriteToggles() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.spot-favorite-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(btn.dataset.spotId);
  });
}

function sortSpotsForDay(spots, dateStr, prefs, radiusKm) {
  return WindmateSessionRank.rankSpotsForDay(spots, dateStr, prefs, radiusKm);
}

function isForecastToday(dateStr, data) {
  return dateStr === WindmateForecastTime.forecastTodayFromRideability(data);
}

function formatDayLabel(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatKtRange(min, max) {
  const lo = Math.round(min);
  const hi = Math.round(max);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

function buildRideableWindFromHours(hours) {
  const rideable = (hours ?? []).filter((h) => h.rideable);
  if (!rideable.length) return null;

  let minWind = Infinity;
  let maxWind = -Infinity;
  let minGust = Infinity;
  let maxGust = -Infinity;

  for (const hour of rideable) {
    const wind = hour.windSpeed ?? 0;
    const gust = hour.gusts ?? wind;
    if (wind < minWind) minWind = wind;
    if (wind > maxWind) maxWind = wind;
    if (gust < minGust) minGust = gust;
    if (gust > maxGust) maxGust = gust;
  }

  return { minWind, maxWind, minGust, maxGust };
}

/** Min/max wind, gust, waves during opaque consensus window hours. */
function buildEfficientWindowStats(hours) {
  if (!hours?.length) return null;

  let minWind = Infinity;
  let maxWind = -Infinity;
  let minGust = Infinity;
  let maxGust = -Infinity;
  let minWave = Infinity;
  let maxWave = -Infinity;
  let waveEstimated = false;

  for (const hour of hours) {
    const wind = hour.windSpeed ?? 0;
    const gust = hour.gusts ?? wind;
    if (wind < minWind) minWind = wind;
    if (wind > maxWind) maxWind = wind;
    if (gust < minGust) minGust = gust;
    if (gust > maxGust) maxGust = gust;

    const { heightM, source } = WindmateWaveColors.resolveHeight(hour);
    if (source === 'estimated') waveEstimated = true;
    if (heightM < minWave) minWave = heightM;
    if (heightM > maxWave) maxWave = heightM;
  }

  return {
    minWind,
    maxWind,
    minGust,
    maxGust,
    minWave,
    maxWave,
    waveEstimated,
  };
}

function formatWaveRange(minM, maxM, estimated) {
  const lo = minM.toFixed(1);
  const hi = maxM.toFixed(1);
  const range = lo === hi ? lo : `${lo}–${hi}`;
  return estimated ? `${range} m est.` : `${range} m`;
}

function getEfficientWindowHours(entry, dateStr, prefs) {
  const minWindowHours = getMinRideableWindowHours(prefs);
  return WindmateRideableWindow.getLongestConsensusWindowHours(
    entry,
    dateStr,
    minWindowHours,
    getModelDayHours
  );
}

function renderEfficientWindowStats(entry, dateStr, prefs) {
  const windowHours = getEfficientWindowHours(entry, dateStr, prefs);
  const stats = buildEfficientWindowStats(windowHours);
  if (!stats) return '';

  const wind = formatKtRange(stats.minWind, stats.maxWind);
  const gust = formatKtRange(stats.minGust, stats.maxGust);
  const waves = formatWaveRange(stats.minWave, stats.maxWave, stats.waveEstimated);
  const line = WindmateCopy.rideable.windowStats(wind, gust, waves);

  return `<div class="text-xs text-slate-400 mb-2" title="${escapeHtml(WindmateCopy.rideable.windowStatsTitle)}">${line}</div>`;
}

function aggregateRideableWindStats(statsList) {
  const valid = statsList.filter(Boolean);
  if (!valid.length) return null;

  return {
    minWind: Math.min(...valid.map((s) => s.minWind)),
    maxWind: Math.max(...valid.map((s) => s.maxWind)),
    minGust: Math.min(...valid.map((s) => s.minGust)),
    maxGust: Math.max(...valid.map((s) => s.maxGust)),
  };
}

function getDayHorizonWindStats(spots, dateStr, prefs) {
  const minWindowHours = getMinRideableWindowHours(prefs);
  const statsList = [];

  for (const entry of spots) {
    const windowHours = WindmateRideableWindow.getLongestConsensusWindowHours(
      entry,
      dateStr,
      minWindowHours,
      getModelDayHours
    );
    const stats = buildRideableWindFromHours(windowHours);
    if (stats) statsList.push(stats);
  }

  return aggregateRideableWindStats(statsList);
}

function countSpotsWithSharedWindows(spots, dateStr, prefs) {
  return spots.filter((entry) => getConsensusRideableHours(entry, dateStr, prefs) > 0).length;
}

function renderHorizonWindBlock(spots, dateStr, prefs, sportColor, rideableMax) {
  if (rideableMax <= 0) {
    return `<div class="mt-3 text-sm text-slate-500">${WindmateCopy.horizon.noRideableWind}</div>`;
  }

  const stats = getDayHorizonWindStats(spots, dateStr, prefs);
  if (!stats) {
    return `<div class="mt-3 text-sm text-slate-500">${WindmateCopy.horizon.noRideableWind}</div>`;
  }

  const wind = formatKtRange(stats.minWind, stats.maxWind);
  const gust = formatKtRange(stats.minGust, stats.maxGust);

  return `
    <div class="mt-3 space-y-0.5">
      <div class="text-xl font-bold leading-tight" style="color:${sportColor}">${WindmateCopy.horizon.windLine(wind)}</div>
      <div class="text-sm font-medium text-amber-400/90 leading-tight">${WindmateCopy.horizon.gustLine(gust)}</div>
    </div>`;
}

function selectDay(dateStr) {
  selectedDayDate = dateStr;
  if (!rideabilityData) return;
  renderHorizonPlanner(rideabilityData);
  renderRideabilityMatrix(rideabilityData, observationsData);
  els.rideabilityMatrix?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderHorizonPlanner(data) {
  if (!data.spots.length) {
    els.horizonPlanner.innerHTML =
      `<p class="col-span-full text-slate-400">${WindmateCopy.empty.noSpotsNearby}</p>`;
    return;
  }

  const primary = data.spots[0];
  const days = primary.days.slice(0, 7);
  const forecastToday = WindmateForecastTime.forecastTodayFromRideability(data);
  const sportColor = SPORT_COLORS[data.preferences.sport] ?? SPORT_COLORS.wingfoiling;

  if (!selectedDayDate || !days.some((d) => d.date === selectedDayDate)) {
    selectedDayDate = days[0]?.date ?? null;
  }

  els.horizonPlanner.innerHTML = days
    .map((day, i) => {
      const dayIndex = i + 1;
      const blurClass = dayIndex >= 4 ? `horizon-day-${dayIndex}` : '';
      const selectedClass = day.date === selectedDayDate ? 'selected' : '';
      const date = new Date(day.date + 'T12:00:00');
      const dayName = date.toLocaleDateString([], { weekday: 'short' });
      const monthDay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const rideableRange = getDayRideableWindowRange(data.spots, day.date, data.preferences);
      const rideableLabel = WindmateCopy.horizon.rideableHours(
        rideableRange.min,
        rideableRange.max
      );
      const pct = Math.round((rideableRange.max / Math.max(24, 1)) * 100);
      const spotsWithWindows = countSpotsWithSharedWindows(data.spots, day.date, data.preferences);
      const agreement =
        spotsWithWindows > 0
          ? `<div class="mt-1 text-[10px] text-slate-500">${WindmateCopy.horizon.spotsWithWindows(spotsWithWindows)}</div>`
          : '';

      const isTodayCard = day.date === forecastToday;
      const todayTag = isTodayCard
        ? '<span class="text-[10px] text-emerald-400 font-medium">Today</span>'
        : '';

      return `
        <button
          type="button"
          class="horizon-day-card text-left bg-base-card border border-base-border rounded-xl p-4 ${blurClass} ${selectedClass}"
          data-date="${day.date}"
          aria-pressed="${day.date === selectedDayDate}"
        >
          <div class="flex items-center justify-between gap-1">
            <div class="text-xs text-slate-400 uppercase">${dayName}</div>
            ${todayTag}
          </div>
          <div class="text-lg font-semibold text-white">${monthDay}</div>
          ${renderHorizonWindBlock(data.spots, day.date, data.preferences, sportColor, rideableRange.max)}
          <div class="mt-2 text-xs text-slate-400">${rideableLabel} · ${pct}%</div>
          ${agreement}
          <div class="mt-3 h-1.5 rounded-full bg-base overflow-hidden">
            <div class="h-full rounded-full" style="width:${pct}%;background:${sportColor}"></div>
          </div>
        </button>`;
    })
    .join('');

  els.horizonPlanner.querySelectorAll('.horizon-day-card').forEach((btn) => {
    btn.addEventListener('click', () => selectDay(btn.dataset.date));
  });
}

function criterionColor(hour, criterion) {
  if (criterion === 'wind') return WindmateWindColors.forSpeed(hour.windSpeed);
  if (criterion === 'gust') return WindmateWindColors.forSpeed(hour.gusts);
  return WindmateWaveColors.forHour(hour);
}

function criterionHourBlockClass(timelineSlot, modelHoursAtSlot) {
  const classes = ['hour-block'];
  const anyRideable = modelHoursAtSlot.some((hour) => hour?.rideable);
  if (anyRideable) classes.push('rideable');
  if (anyRideable && !timelineSlot.inRideableWindow) classes.push('rideable-isolated');
  if (!anyRideable && modelHoursAtSlot.some((hour) => hour?.offshoreBlocked && hour?.windOk)) {
    classes.push('offshore-hour');
  }
  if (modelHoursAtSlot.some((hour) => WindmateWeatherHazards.hasForecastRain(hour))) {
    classes.push('rain-hour');
  }
  if (modelHoursAtSlot.some((hour) => (hour?.weatherCode ?? 0) >= 95)) classes.push('storm-hour');
  return classes.join(' ');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function modelHourStatus(hour) {
  if (!hour) return 'No data';
  if (hour.rideable) {
    if (hour.inRideableWindow) {
      return WindmateWeatherHazards.hasForecastRain(hour)
        ? 'All models agree (minor rain)'
        : WindmateCopy.rideable.tooltipOk;
    }
    return hour.allModelsRideable
      ? WindmateCopy.rideable.tooltipIsolated
      : WindmateCopy.rideable.tooltipModelDisagree;
  }
  if (hour.windOk && hour.weatherOk && hour.tempOk && hour.offshoreBlocked) {
    return WindmateCopy.rideable.tooltipOffshore;
  }
  if (hour.windOk && hour.weatherOk && hour.tempOk && hour.daylightOk === false) {
    return WindmateCopy.rideable.tooltipNight;
  }
  if (hour.windOk && hour.weatherOk && hour.tempOk && hour.windExposure === 'cross') {
    return WindmateCopy.rideable.tooltipCross;
  }
  if (hour.windOk && !hour.weatherOk) return 'Rain or storm';
  if (hour.windOk && !hour.tempOk) return 'Too cold';
  return 'Wind or gusts out of range';
}

function criterionValueLine(hour, criterion) {
  if (criterion === 'wind') {
    const bf = WindmateWindColors.beaufortForSpeed(hour.windSpeed);
    return `Wind ${hour.windSpeed.toFixed(0)} kt (Bf ${bf.force}) ${hour.direction}`;
  }
  if (criterion === 'gust') {
    const gustBf = WindmateWindColors.beaufortForSpeed(hour.gusts);
    return `Gusts ${hour.gusts.toFixed(0)} kt (Bf ${gustBf.force})`;
  }
  return `Waves ${WindmateWaveColors.formatWave(hour)}`;
}

function criterionTooltipLines(modelHours, criterion, time) {
  const hourLabel = time.slice(11, 16);
  const criterionLabel =
    criterion === 'wind'
      ? WindmateCopy.matrix.windRow
      : criterion === 'gust'
        ? WindmateCopy.matrix.gustRow
        : WindmateCopy.matrix.waveRow;

  const lines = [`${criterionLabel} · ${hourLabel}`];
  for (const { label, hour } of modelHours) {
    if (!hour?.rideable) {
      lines.push(`${label}: — (${modelHourStatus(hour)})`);
      continue;
    }
    lines.push(`${label}: ${criterionValueLine(hour, criterion)}`);
  }

  const primary = modelHours.find((entry) => entry.hour?.rideable)?.hour ?? modelHours[0]?.hour;
  if (primary) lines.push(modelHourStatus(primary));
  return lines;
}

function criterionTooltipHtml(modelHours, criterion, time) {
  return escapeHtml(criterionTooltipLines(modelHours, criterion, time).join('\n'));
}

function renderMatrixRainOverlay(hours) {
  const count = hours.length;
  if (!count) return '';

  return hours
    .map((hour, index) => {
      if (!WindmateWeatherHazards.hasForecastRain(hour)) return '';
      const left = (index / count) * 100;
      const width = (1 / count) * 100;
      return `<div class="matrix-rain-segment" style="left:${left}%;width:${width}%"></div>`;
    })
    .join('');
}

function renderDirectionRow(hours) {
  if (!hours?.length) return '';

  const blocks = hours
    .map((hour) => {
      const exposure = hour.windExposure ?? 'unknown';
      const exposureLabel = WindmateCopy.direction.exposure[exposure] ?? exposure;
      const hourLabel = hour.time.slice(11, 16);
      const title = `${hourLabel} ${hour.direction} · ${exposureLabel}`;
      return `<div class="matrix-direction matrix-direction--${exposure}" title="${title}"><span>${hour.direction}</span></div>`;
    })
    .join('');

  return `
    <div class="matrix-row flex items-center gap-2 mb-1">
      <span class="text-[10px] text-slate-400 w-24 shrink-0 truncate" title="${WindmateCopy.direction.rowLabel}">${WindmateCopy.direction.rowLabel}</span>
      <div class="matrix-hour-track flex-1">
        <div class="matrix-direction-blocks">${blocks}</div>
      </div>
    </div>`;
}

function buildAlignedModels(timelineHours, modelEntries, getModelHours, windowMaps) {
  return modelEntries.map(([id, model]) => ({
    id,
    label: model.label ?? id,
    hours: WindmateRideableWindow.alignModelHoursToTimeline(
      timelineHours,
      getModelHours(id) ?? [],
      windowMaps
    ),
  }));
}

function renderCriterionSegments(modelHoursAtSlot, criterion) {
  return modelHoursAtSlot
    .map((hour) => {
      if (!hour?.rideable) {
        return '<div class="hour-block-seg hour-block-seg--empty"></div>';
      }
      const color = criterionColor(hour, criterion);
      return `<div class="hour-block-seg" style="background:${color}"></div>`;
    })
    .join('');
}

function renderCriterionRow(timelineHours, alignedModels, criterion, label, windowMaps) {
  if (!timelineHours?.length) {
    return `<div class="text-xs text-slate-500 py-1">${WindmateCopy.empty.noModelData(label)}</div>`;
  }

  const timelineSlots = WindmateRideableWindow.alignModelHoursToTimeline(
    timelineHours,
    timelineHours,
    windowMaps
  );

  const blocks = timelineSlots
    .map((slot, index) => {
      const modelHoursAtSlot = alignedModels.map((model) => model.hours[index]);
      const cls = criterionHourBlockClass(slot, modelHoursAtSlot);
      const segments = renderCriterionSegments(modelHoursAtSlot, criterion);
      const modelHours = alignedModels.map((model) => ({
        label: model.label,
        hour: model.hours[index],
      }));
      const tip = criterionTooltipHtml(modelHours, criterion, slot.time);
      return `<div class="${cls}"><div class="hour-block-segments">${segments}</div><span class="hour-block-tip" role="tooltip">${tip}</span></div>`;
    })
    .join('');

  const rainOverlay = renderMatrixRainOverlay(timelineSlots);

  return `
    <div class="matrix-row flex items-center gap-2 mb-1">
      <span class="text-[10px] text-slate-400 w-24 shrink-0 truncate" title="${label}">${label}</span>
      <div class="matrix-hour-track flex-1">
        <div class="matrix-rain-overlay" aria-hidden="true">${rainOverlay}</div>
        <div class="matrix-hour-blocks">${blocks}</div>
      </div>
    </div>`;
}

function renderCriterionMatrixRows(timelineHours, modelEntries, getModelHours, windowMaps) {
  const alignedModels =
    modelEntries.length > 0
      ? buildAlignedModels(timelineHours, modelEntries, getModelHours, windowMaps)
      : [
          {
            id: 'primary',
            label: 'Forecast',
            hours: WindmateRideableWindow.alignModelHoursToTimeline(
              timelineHours,
              timelineHours,
              windowMaps
            ),
          },
        ];

  const criteria = [
    { key: 'wind', label: WindmateCopy.matrix.windRow },
    { key: 'gust', label: WindmateCopy.matrix.gustRow },
    { key: 'wave', label: WindmateCopy.matrix.waveRow },
  ];

  return criteria
    .map((criterion) =>
      renderCriterionRow(timelineHours, alignedModels, criterion.key, criterion.label, windowMaps)
    )
    .join('');
}

function renderRideabilityMatrix(data, observations) {
  if (!data.spots.length) {
    els.rideabilityMatrix.innerHTML = `<p class="text-slate-400">${WindmateCopy.empty.noSpotsInRange}</p>`;
    return;
  }

  const forecastToday = WindmateForecastTime.forecastTodayFromRideability(data);
  const horizonDays = data.spots[0]?.days?.slice(0, 7) ?? [];
  if (!selectedDayDate || !horizonDays.some((d) => d.date === selectedDayDate)) {
    selectedDayDate = horizonDays[0]?.date ?? forecastToday;
  }

  const viewingToday = isForecastToday(selectedDayDate, data);
  if (els.matrixDayLabel) {
    els.matrixDayLabel.textContent = viewingToday
      ? WindmateCopy.horizon.matrixToday
      : WindmateCopy.horizon.matrixDay(formatDayLabel(selectedDayDate));
  }

  const rankedSpots = sortSpotsForDay(
    data.spots,
    selectedDayDate,
    prefsForRanking(data.preferences),
    data.radius_km
  ).filter((row) => row.rideableCount > 0);
  const minWindowHours = getMinRideableWindowHours(data.preferences);
  const obsBySpot = WindmateObservations.mapBySpotId(observations);

  if (!rankedSpots.length) {
    els.rideabilityMatrix.innerHTML = `<p class="text-slate-400">${WindmateCopy.empty.noRideableHoursForDay}</p>`;
    return;
  }

  els.rideabilityMatrix.innerHTML = rankedSpots
    .map((row, rank) => {
      const entry = row.entry;
      const { spot, models, primaryModel } = entry;
      const dayData = getSpotDayData(entry, selectedDayDate);
      const dayHours = dayData?.hours ?? [];
      const rideableCount = getConsensusRideableHours(entry, selectedDayDate, data.preferences);
      const rankBanners = WindmateSessionRank.renderBanners(row.topReasons);

      const directionRow = renderDirectionRow(dayHours);
      const modelEntries = Object.entries(models ?? {}).filter(([, model]) => !model.error);
      const windowMaps =
        modelEntries.length > 0
          ? WindmateRideableWindow.buildConsensusWindowMapsFromEntry(
              entry,
              selectedDayDate,
              minWindowHours,
              getModelDayHours
            )
          : WindmateRideableWindow.buildSingleModelWindowMaps(dayHours, minWindowHours);
      const criterionRows = renderCriterionMatrixRows(
        dayHours,
        modelEntries,
        (modelId) => getModelDayHours(entry, modelId, selectedDayDate),
        windowMaps
      );

      const matrixRows = `${directionRow}${criterionRows}`;
      const dayLabel = viewingToday
        ? WindmateCopy.horizon.todayShort
        : formatDayLabel(selectedDayDate);
      const spotMap = WindmateSpotMap.renderForDay(spot, dayHours, { dayLabel });

      const link = spot.source_url
        ? `<a href="${spot.source_url}" target="_blank" rel="noopener" class="text-emerald-500 hover:underline text-xs">iGetwind</a>`
        : '';

      const liveStrip = viewingToday
        ? WindmateObservations.renderLiveStrip(
            spot,
            obsBySpot.get(spot.id),
            entry,
            prefsForRanking(data.preferences)
          )
        : '';

      const favoriteBtn = renderFavoriteButton(spot);
      const windowStatsLine = renderEfficientWindowStats(entry, selectedDayDate, data.preferences);

      return `
        <div class="bg-base-card border border-base-border rounded-xl p-5" data-spot-id="${spot.id}">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h3 class="font-semibold text-white flex flex-wrap items-center gap-2 min-w-0">
              <span class="text-slate-500 font-normal">#${rank + 1}</span>
              <span class="spot-title">
                <span class="spot-name">${spot.name}</span>
                ${favoriteBtn}
              </span>
              ${rankBanners}
            </h3>
            <span class="text-xs text-slate-400 shrink-0">${spot.distance_km.toFixed(1)} km · ${rideableCount} rideable hrs ${link}</span>
          </div>
          ${windowStatsLine}
          ${liveStrip}
          <div class="matrix-panel mb-2">
            <div class="matrix-panel-rows">
              ${matrixRows}
              <div class="flex justify-between mt-2 ml-28 text-[10px] text-slate-500">
                <span>00:00</span>
                <span>12:00</span>
                <span>23:00</span>
              </div>
            </div>
            ${spotMap ? `<div class="matrix-panel-map">${spotMap}</div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  WindmateObservations.bindToggles(els.rideabilityMatrix, obsBySpot, data.preferences);
}

if (els.locateBtn) {
  els.locateBtn.addEventListener('click', handleLocateClick);
}
els.manualLocBtn.addEventListener('click', () => {
  const lat = parseFloat(els.manualLat.value);
  const lng = parseFloat(els.manualLng.value);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    setLocation(lat, lng, WindmateCopy.geo.manual(lat, lng));
    closeSettingsModal();
  }
});

(async function init() {
  initRankCriteriaSection();
  initLegendModal();
  initSettingsModal();
  initSpotSearch();
  initFavoriteToggles();
  setDashboardLoading(WindmateCopy.loading.dashboard);
  els.locationStatus.textContent = WindmateCopy.geo.locating;
  await loadPreferences();
  els.locationStatus.textContent = WindmateCopy.geo.defaultMontreal;
  await refreshDashboard();
  initGeolocation();
})();
