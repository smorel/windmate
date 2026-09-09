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
  horizonPlanner: document.getElementById('horizon-planner'),
  matrixDayLabel: document.getElementById('matrix-day-label'),
  rideabilityMatrix: document.getElementById('rideability-matrix'),
  modelLegend: document.getElementById('model-legend'),
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

function buildPreferencesPayload() {
  return {
    sport: els.sport.value,
    min_wind_knots: parseInt(els.minWind.value, 10),
    max_gust_knots: parseInt(els.maxGust.value, 10),
    min_air_temp_c: els.minAir.value === '' ? null : parseFloat(els.minAir.value),
    min_water_temp_c: els.minWater.value === '' ? null : parseFloat(els.minWater.value),
    rank_criteria_order: getRankCriteriaOrder(),
    favorite_spot_ids: favoriteSpotIds,
    radius_km: getSearchRadiusKm(),
  };
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
  for (const input of [els.searchRadius, els.minWind, els.maxGust, els.minAir, els.minWater]) {
    if (!input) continue;
    input.addEventListener('input', () => schedulePreferencesSave({ fullRefresh: true }));
    input.addEventListener('change', () => schedulePreferencesSave({ fullRefresh: true, delayMs: 0 }));
  }
  els.prefsForm.addEventListener('submit', (e) => e.preventDefault());
}

function openSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  els.settingsBtn?.setAttribute('aria-expanded', 'true');
}

function closeSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  els.settingsBtn?.setAttribute('aria-expanded', 'false');
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
    if (e.key === 'Escape' && !els.settingsModal?.classList.contains('hidden')) {
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
      `<p class="text-slate-400 mb-3">${WindmateCopy.picks.intro(data.spots.length)}</p>` +
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

  const bestRow = rankedRows[0];
  const best = bestRow.entry;
  const dayHours = getSpotDayData(best, today)?.hours ?? best.today ?? [];
  const peakHour = dayHours.reduce(
    (p, h) => (h.windSpeed > (p?.windSpeed ?? 0) ? h : p),
    null
  );
  const maxWind = Math.round(peakHour?.windSpeed ?? best.days?.[0]?.maxWind ?? 0);

  els.matePicksContent.innerHTML =
    `<p class="text-slate-400 mb-2">${WindmateCopy.picks.quiet}</p>` +
    `<p>${WindmateCopy.picks.bestWind(
      best.spot.name,
      maxWind,
      peakHour?.direction ?? '—',
      best.spot.distance_km.toFixed(1)
    )}</p>`;
}

function renderRideLegend() {
  return `
    <div class="matrix-ride-legend w-full">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--rideable" aria-hidden="true"></span>
          Good hour
        </span>
        <span class="matrix-ride-legend-item">
          <span class="matrix-ride-legend-swatch matrix-ride-legend-swatch--empty" aria-hidden="true"></span>
          Not good
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
      const pct = Math.round((day.rideableCount / Math.max(24, 1)) * 100);
      const agreement =
        day.modelsAgreeing != null
          ? `<div class="mt-1 text-[10px] text-slate-500">${WindmateCopy.horizon.modelsAgree(day.modelsAgreeing, day.modelCount)}</div>`
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
          <div class="mt-3 text-2xl font-bold" style="color:${sportColor}">${Math.round(day.maxWind)}<span class="text-sm font-normal text-slate-400"> kt</span></div>
          <div class="mt-2 text-xs text-slate-400">${day.rideableCount} rideable hrs · ${pct}%</div>
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

function hourBlockClass(hour) {
  const classes = ['hour-block'];
  if (hour.rideable) classes.push('rideable');
  if (hour.weatherCode >= 95) classes.push('storm-hour');
  return classes.join(' ');
}

function hourBlockStyle(hour) {
  if (!hour.rideable) return '';
  const windColor = WindmateWindColors.forSpeed(hour.windSpeed);
  const gustColor = WindmateWindColors.forSpeed(hour.gusts);
  const waveColor = WindmateWaveColors.forHour(hour);
  return `--wind-color:${windColor};--gust-color:${gustColor};--wave-color:${waveColor}`;
}

function hourTooltip(hour, label) {
  const hourLabel = hour.time.slice(11, 16);
  const temps = [];
  if (hour.airTempC != null) {
    const feels = hour.apparentTempC != null ? ` (feels ${Math.round(hour.apparentTempC)}°C)` : '';
    temps.push(`${Math.round(hour.airTempC)}°C air${feels}`);
  }
  if (hour.waterTempC != null) temps.push(`${Math.round(hour.waterTempC)}°C water`);
  const waveLine = WindmateWaveColors.formatWave(hour);
  const status = hour.rideable
    ? WindmateCopy.rideable.tooltipOk
    : hour.windOk && !hour.weatherOk
      ? 'rain or storm'
      : hour.windOk && !hour.tempOk
        ? 'too cold'
        : 'wind or gusts out of range';
  const bf = WindmateWindColors.beaufortForSpeed(hour.windSpeed);
  const gustBf = WindmateWindColors.beaufortForSpeed(hour.gusts);
  return `${label} ${hourLabel}: ${hour.windSpeed.toFixed(0)} kt Bf ${bf.force} (${hour.direction}), gusts ${hour.gusts.toFixed(0)} kt Bf ${gustBf.force} · waves ${waveLine}${temps.length ? ` · ${temps.join(' · ')}` : ''} · ${status}`;
}

function renderHourRow(hours, label) {
  if (!hours?.length) {
    return `<div class="text-xs text-slate-500 py-1">${WindmateCopy.empty.noModelData(label)}</div>`;
  }

  const blocks = hours
    .map((hour) => {
      const cls = hourBlockClass(hour);
      const style = hourBlockStyle(hour);
      const title = hourTooltip(hour, label);
      return `<div class="${cls}" style="${style}" title="${title}"></div>`;
    })
    .join('');

  return `
    <div class="flex items-center gap-2 mb-1">
      <span class="text-[10px] text-slate-400 w-24 shrink-0 truncate" title="${label}">${label}</span>
      <div class="flex gap-0.5 flex-1">${blocks}</div>
      <span class="text-[10px] text-slate-500 w-8 text-right">${hours.filter((h) => h.rideable).length}h</span>
    </div>`;
}

function renderWarningBanners(warnings, prefs) {
  if (!warnings?.length) return '';
  return warnings
    .map((w) =>
      WindmateCopy.observations.warningBanner(
        WindmateForecastTime.sessionWarningMessage(w, prefs),
        w.type
      )
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
  );
  const obsBySpot = WindmateObservations.mapBySpotId(observations);

  els.rideabilityMatrix.innerHTML = rankedSpots
    .map((row, rank) => {
      const entry = row.entry;
      const { spot, models, primaryModel, warnings } = entry;
      const dayData = getSpotDayData(entry, selectedDayDate);
      const dayHours = dayData?.hours ?? [];
      const rideableCount = dayData?.rideableCount ?? 0;
      const rankBanner = WindmateSessionRank.renderBanner(row.topReason);

      const modelEntries = Object.entries(models ?? {});
      const modelRows =
        modelEntries.length > 0
          ? modelEntries
              .map(([id, model]) =>
                renderHourRow(getModelDayHours(entry, id, selectedDayDate), model.label ?? id)
              )
              .join('')
          : renderHourRow(dayHours, primaryModel ?? 'Forecast');

      const link = spot.source_url
        ? `<a href="${spot.source_url}" target="_blank" rel="noopener" class="text-emerald-500 hover:underline text-xs">iGetwind</a>`
        : '';

      const liveStrip = WindmateObservations.renderLiveStrip(
        spot.id,
        obsBySpot.get(spot.id),
        entry,
        prefsForRanking(data.preferences)
      );

      const dayWarnings = viewingToday
        ? renderWarningBanners(warnings, prefsForRanking(data.preferences))
        : '';

      const favoriteBtn = renderFavoriteButton(spot);

      return `
        <div class="bg-base-card border border-base-border rounded-xl p-5" data-spot-id="${spot.id}">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="font-semibold text-white flex flex-wrap items-center gap-2 min-w-0">
              <span class="text-slate-500 font-normal">#${rank + 1}</span>
              <span class="spot-title">
                <span class="spot-name">${spot.name}</span>
                ${favoriteBtn}
              </span>
              ${rankBanner}
            </h3>
            <span class="text-xs text-slate-400 shrink-0">${spot.distance_km.toFixed(1)} km · ${rideableCount} rideable hrs (${primaryModel ?? 'primary'}) ${link}</span>
          </div>
          ${liveStrip}
          ${modelRows}
          ${dayWarnings}
          <div class="flex justify-between mt-2 ml-28 text-[10px] text-slate-500">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:00</span>
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
