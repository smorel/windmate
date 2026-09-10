const MONTREAL = { lat: 45.5017, lng: -73.5673 };
const SPORT_COLORS = {
  wingfoiling: '#10b981',
  sailing: '#14b8a6',
  kitesurfing: '#3b82f6',
  windsurfing: '#06b6d4',
  kitefoiling: '#8b5cf6',
  parawing: '#f59e0b',
};

let userLocation = { ...MONTREAL };
let rideabilityData = null;
let observationsData = null;
let horizonSummary = null;
let sportProfiles = [];
let activeSport = 'wingfoiling';
let settingsSportTab = 'wingfoiling';
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
  sportSelector: document.getElementById('sport-selector'),
  watchlistStrip: document.getElementById('watchlist-strip'),
  mySportsList: document.getElementById('my-sports-list'),
  sportSettingsTabs: document.getElementById('sport-settings-tabs'),
  sportSettingsHint: document.getElementById('sport-settings-hint'),
  alertEnabled: document.getElementById('alert-enabled'),
  alertDaysPreset: document.getElementById('alert-days-preset'),
  minWind: document.getElementById('min-wind'),
  maxGust: document.getElementById('max-gust'),
  searchRadius: document.getElementById('search-radius'),
  minAir: document.getElementById('min-air'),
  minWater: document.getElementById('min-water'),
  offshoreWind: document.getElementById('offshore-wind'),
  offshoreWindHint: document.getElementById('offshore-wind-hint'),
  minRideableWindow: document.getElementById('min-rideable-window'),
  horizonPlanner: document.getElementById('horizon-planner'),
  refreshCountdown: document.getElementById('refresh-countdown'),
  rideabilityMatrix: document.getElementById('rideability-matrix'),
  modelLegend: document.getElementById('model-legend'),
  legendBtn: document.getElementById('legend-btn'),
  legendModal: document.getElementById('legend-modal'),
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
  spotMapToggle: document.getElementById('spot-map-toggle'),
};

const MAX_FAVORITE_SPOTS = 50;

let rankCriteriaOrder = [...WindmateSessionRank.DEFAULT_ORDER];
let favoriteSpotIds = [];
let rankDragKey = null;
let savePrefsTimer = null;
let persistPrefsPromise = null;
let spotSearchTimer = null;
let spotSearchRequestId = 0;

const HOUR_MS = 60 * 60 * 1000;
let hourlyRefreshTimer = null;
let refreshCountdownTimer = null;
let nextHourlyRefreshAt = 0;
let hourlyRefreshInFlight = false;
let lastDashboardFetchAt = 0;

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
  const profile = sportProfiles.find((p) => p.sport === activeSport);
  return profile?.radius_km ?? rideabilityData?.preferences?.radius_km ?? 80;
}

function getActiveProfile() {
  return sportProfiles.find((p) => p.sport === activeSport) ?? rideabilityData?.preferences;
}

function getSettingsProfile() {
  return sportProfiles.find((p) => p.sport === settingsSportTab) ?? getActiveProfile();
}

const SPORT_DISPLAY_NAMES = {
  wingfoiling: 'Wingfoiling',
  sailing: 'Sailing',
  kitesurfing: 'Kitesurfing',
  windsurfing: 'Windsurfing',
  kitefoiling: 'Kitefoiling',
  parawing: 'Parawing',
};

function alertDaysPresetFromSchedule(schedule) {
  const days = schedule?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6];
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'weekends';
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'weekdays';
  return 'any';
}

function alertScheduleFromPreset(preset) {
  if (preset === 'weekends') return { days_of_week: [0, 6] };
  if (preset === 'weekdays') return { days_of_week: [1, 2, 3, 4, 5] };
  return { days_of_week: [0, 1, 2, 3, 4, 5, 6] };
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
  renderRideabilityMatrix(payload, observationsData);
  refreshWatchlistDepartures();
}

function getMinRideableWindowHours(prefs) {
  return WindmateRideableWindow.parseMinHours(
    prefs?.min_rideable_window_hours ?? els.minRideableWindow?.value
  );
}

function buildSportProfilePayload() {
  const schedulePatch = alertScheduleFromPreset(els.alertDaysPreset?.value ?? 'any');
  const current = getSettingsProfile();
  return {
    min_wind_knots: parseInt(els.minWind.value, 10),
    max_gust_knots: parseInt(els.maxGust.value, 10),
    min_air_temp_c: els.minAir.value === '' ? null : parseFloat(els.minAir.value),
    min_water_temp_c: els.minWater.value === '' ? null : parseFloat(els.minWater.value),
    offshore_wind_ok: els.offshoreWind?.value === '1' ? 1 : 0,
    min_rideable_window_hours: getMinRideableWindowHours(),
    rank_criteria_order: getRankCriteriaOrder(),
    radius_km: getSearchRadiusKm(),
    alert_enabled: els.alertEnabled?.checked ? 1 : 0,
    alert_schedule: {
      ...(current?.alert_schedule ?? {}),
      ...schedulePatch,
      horizon_days: current?.alert_schedule?.horizon_days ?? 7,
      today_alerts: current?.alert_schedule?.today_alerts ?? true,
      min_session_score: current?.alert_schedule?.min_session_score ?? 0.55,
    },
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
      const updated = await api(`/api/preferences/sports/${settingsSportTab}`, {
        method: 'PUT',
        body: JSON.stringify(buildSportProfilePayload()),
      });
      applyFullPreferences(updated);
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

async function persistSportEnabled(sport, enabled) {
  try {
    const updated = await api(`/api/preferences/sports/${sport}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
    });
    applyFullPreferences(updated);
    await refreshDashboard({ silent: true });
  } catch (err) {
    setSettingsSaveStatus(err.message, true);
  }
}

async function switchActiveSport(sport) {
  activeSport = sport;
  const updated = await api('/api/preferences', {
    method: 'PUT',
    body: JSON.stringify({ active_sport: sport }),
  });
  applyFullPreferences(updated);
  await refreshDashboard({ silent: true });
}

function bindPreferencesAutoSave() {
  for (const input of [els.searchRadius, els.minWind, els.maxGust, els.minAir, els.minWater, els.minRideableWindow]) {
    if (!input) continue;
    input.addEventListener('input', () => schedulePreferencesSave({ fullRefresh: true }));
    input.addEventListener('change', () => schedulePreferencesSave({ fullRefresh: true, delayMs: 0 }));
  }
  els.offshoreWind?.addEventListener('change', () => {
    syncOffshoreHint(els.offshoreWind.value === '1');
    schedulePreferencesSave({ fullRefresh: true, delayMs: 0 });
  });
  els.alertEnabled?.addEventListener('change', () =>
    schedulePreferencesSave({ fullRefresh: true, delayMs: 0 })
  );
  els.alertDaysPreset?.addEventListener('change', () =>
    schedulePreferencesSave({ fullRefresh: true, delayMs: 0 })
  );
  els.prefsForm.addEventListener('submit', (e) => e.preventDefault());
}

function renderMySports() {
  if (!els.mySportsList) return;
  const allSports = Object.keys(SPORT_DISPLAY_NAMES);
  els.mySportsList.innerHTML = allSports
    .map((sport) => {
      const profile = sportProfiles.find((p) => p.sport === sport);
      const checked = profile?.enabled ? 'checked' : '';
      return `<label class="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" data-my-sport="${sport}" ${checked} />
        <span>${SPORT_DISPLAY_NAMES[sport]}</span>
      </label>`;
    })
    .join('');

  els.mySportsList.querySelectorAll('[data-my-sport]').forEach((input) => {
    input.addEventListener('change', () => {
      persistSportEnabled(input.dataset.mySport, input.checked);
    });
  });
}

function renderSportSettingsTabs() {
  if (!els.sportSettingsTabs) return;
  const enabled = sportProfiles.filter((p) => p.enabled);
  els.sportSettingsTabs.innerHTML = enabled
    .map((p) => {
      const active = p.sport === settingsSportTab ? 'sport-tab--active' : '';
      return `<button type="button" class="sport-tab text-xs px-3 py-1.5 rounded-lg border border-base-border ${active}" data-settings-sport="${p.sport}">${SPORT_DISPLAY_NAMES[p.sport] ?? p.sport}</button>`;
    })
    .join('');

  els.sportSettingsTabs.querySelectorAll('[data-settings-sport]').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsSportTab = btn.dataset.settingsSport;
      loadSettingsFormForSport(settingsSportTab);
      renderSportSettingsTabs();
    });
  });

  if (els.sportSettingsHint) {
    const profile = sportProfiles.find((p) => p.sport === settingsSportTab);
    const name = SPORT_DISPLAY_NAMES[settingsSportTab] ?? settingsSportTab;
    const alertPreset = alertDaysPresetFromSchedule(profile?.alert_schedule);
    const alertNote =
      alertPreset === 'weekends'
        ? ' Alert emails: weekends only.'
        : alertPreset === 'weekdays'
          ? ' Alert emails: weekdays only.'
          : '';
    els.sportSettingsHint.textContent = `Editing ${name} — switch sport on the dashboard.${alertNote}`;
  }
}

function loadSettingsFormForSport(sport) {
  const profile = sportProfiles.find((p) => p.sport === sport);
  if (!profile) return;
  settingsSportTab = sport;
  els.minWind.value = profile.min_wind_knots;
  els.maxGust.value = profile.max_gust_knots;
  els.minAir.value = profile.min_air_temp_c ?? '';
  els.minWater.value = profile.min_water_temp_c ?? '';
  if (els.searchRadius) els.searchRadius.value = profile.radius_km ?? 80;
  if (els.minRideableWindow) {
    els.minRideableWindow.value = getMinRideableWindowHours(profile);
  }
  if (els.offshoreWind) {
    els.offshoreWind.value = profile.offshore_wind_ok ? '1' : '0';
    syncOffshoreHint(profile.offshore_wind_ok);
  }
  if (els.alertEnabled) els.alertEnabled.checked = Boolean(profile.alert_enabled);
  if (els.alertDaysPreset) {
    els.alertDaysPreset.value = alertDaysPresetFromSchedule(profile.alert_schedule);
  }
  rankCriteriaOrder = WindmateSessionRank.normalizeOrder(profile.rank_criteria_order);
  renderRankCriteriaList(rankCriteriaOrder);
}

function applyFullPreferences(prefs) {
  sportProfiles = prefs.sport_profiles ?? sportProfiles;
  activeSport = prefs.active_sport ?? activeSport;
  settingsSportTab = sportProfiles.some((p) => p.sport === settingsSportTab && p.enabled)
    ? settingsSportTab
    : activeSport;
  const activeProfile = sportProfiles.find((p) => p.sport === activeSport);
  favoriteSpotIds = normalizeFavoriteSpotIds(
    activeProfile?.favorite_spot_ids ?? prefs.favorite_spot_ids
  );
  syncPreferencesState(prefs);
  renderMySports();
  renderSportSettingsTabs();
  loadSettingsFormForSport(settingsSportTab);
  WindmateSportSelector.setState({
    profiles: sportProfiles.map((p) => ({
      ...p,
      display_name: SPORT_DISPLAY_NAMES[p.sport],
    })),
    activeSport,
    summary: horizonSummary,
  });
}

function isAnyModalOpen() {
  return (
    !els.settingsModal?.classList.contains('hidden') ||
    !els.legendModal?.classList.contains('hidden') ||
    !document.getElementById('spot-media-modal')?.classList.contains('hidden')
  );
}

function syncModalOpenClass() {
  document.body.classList.toggle('modal-open', isAnyModalOpen());
}

function openSettingsModal() {
  if (!els.settingsModal) return;
  settingsSportTab = activeSport;
  loadSettingsFormForSport(settingsSportTab);
  renderSportSettingsTabs();
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
    const mediaModal = document.getElementById('spot-media-modal');
    if (mediaModal && !mediaModal.classList.contains('hidden')) {
      WindmateSpotIntel.closeMediaModal();
    } else if (!els.legendModal?.classList.contains('hidden')) {
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
  applyFullPreferences(prefs);
}

function setDashboardLoading(message) {
  const html = `<p class="col-span-full text-slate-400">${message}</p>`;
  els.horizonPlanner.innerHTML = html;
  els.rideabilityMatrix.innerHTML = `<p class="text-slate-400">${message}</p>`;
}

function observationsQueryString({ bypassCache = false } = {}) {
  const profile = getActiveProfile();
  const radius = profile?.radius_km ?? getSearchRadiusKm();
  const sport = activeSport;
  const query = `lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${radius}&limit=12&sport=${sport}`;
  const watchedIds = WindmateWatchlist.getWatchedSpotIdsForToday(sport);
  const watchedQuery = watchedIds.length ? `&watchedSpotIds=${watchedIds.join(',')}` : '';
  const refreshQuery = bypassCache ? '&refresh=1' : '';
  return { query, watchedQuery, refreshQuery };
}

function msUntilNextLocalHour() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

function formatRefreshCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function setRefreshCountdownLayoutActive(active) {
  document.body.classList.toggle('refresh-countdown-active', active);
}

function renderRefreshCountdownBanner() {
  const el = els.refreshCountdown;
  if (!el) return;

  if (hourlyRefreshInFlight) {
    el.hidden = false;
    setRefreshCountdownLayoutActive(true);
    el.classList.add('refresh-countdown-banner--updating');
    el.innerHTML = `<span class="refresh-countdown-banner__pill">
      <span>${WindmateCopy.refreshCountdown.label}</span>
      <span class="refresh-countdown-banner__time">${WindmateCopy.refreshCountdown.updating}</span>
    </span>`;
    return;
  }

  if (!nextHourlyRefreshAt) {
    el.hidden = true;
    setRefreshCountdownLayoutActive(false);
    el.classList.remove('refresh-countdown-banner--updating');
    el.textContent = '';
    return;
  }

  const remaining = nextHourlyRefreshAt - Date.now();
  el.hidden = false;
  setRefreshCountdownLayoutActive(true);
  el.classList.remove('refresh-countdown-banner--updating');
  const time = formatRefreshCountdown(remaining);
  el.innerHTML = `<span class="refresh-countdown-banner__pill">
    <span>${WindmateCopy.refreshCountdown.label}</span>
    <span class="refresh-countdown-banner__time" aria-label="${time} remaining">${time}</span>
  </span>`;
}

function markNextHourlyRefreshDeadline() {
  nextHourlyRefreshAt = Date.now() + msUntilNextLocalHour();
  renderRefreshCountdownBanner();
}

function startRefreshCountdownTicker() {
  if (refreshCountdownTimer) clearInterval(refreshCountdownTimer);
  refreshCountdownTimer = setInterval(() => {
    if (!nextHourlyRefreshAt && !hourlyRefreshInFlight) return;
    renderRefreshCountdownBanner();
  }, 1000);
}

async function runHourlyDashboardRefresh() {
  if (hourlyRefreshInFlight) return;
  hourlyRefreshInFlight = true;
  renderRefreshCountdownBanner();
  try {
    if (!document.hidden) {
      await refreshDashboard({ silent: true, bypassCache: true });
    }
  } finally {
    hourlyRefreshInFlight = false;
    markNextHourlyRefreshDeadline();
  }
}

function restoreScrollAfterSilentRefresh(scrollY) {
  if (scrollY == null) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  });
}

function scheduleHourlyDashboardRefresh() {
  if (hourlyRefreshTimer) clearTimeout(hourlyRefreshTimer);
  markNextHourlyRefreshDeadline();
  hourlyRefreshTimer = setTimeout(() => {
    hourlyRefreshTimer = null;
    void runHourlyDashboardRefresh().then(() => scheduleHourlyDashboardRefresh());
  }, msUntilNextLocalHour());
}

function initHourlyDashboardRefresh() {
  startRefreshCountdownTicker();
  scheduleHourlyDashboardRefresh();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Date.now() - lastDashboardFetchAt >= HOUR_MS) {
      void runHourlyDashboardRefresh().then(() => scheduleHourlyDashboardRefresh());
      return;
    }
    scheduleHourlyDashboardRefresh();
  });
}

function rebindObservationToggles(obsBySpot, matrixPrefs) {
  const warningsBySpot = new Map(
    rideabilityData.spots.map((entry) => [entry.spot.id, entry.warnings ?? []])
  );
  const rideEntryBySpot = new Map(rideabilityData.spots.map((entry) => [entry.spot.id, entry]));
  WindmateObservations.bindToggles(
    els.watchlistStrip,
    obsBySpot,
    matrixPrefs,
    warningsBySpot,
    rideEntryBySpot
  );
}

function applyObservationsToUi(obsRes) {
  observationsData = obsRes;
  if (!rideabilityData) return;
  renderRideabilityMatrix(rideabilityData, observationsData);
  const obsBySpot = WindmateObservations.mapBySpotId(observationsData);
  const matrixPrefs = prefsForRanking(rideabilityData.preferences);
  const rideEntryBySpot = new Map(rideabilityData.spots.map((entry) => [entry.spot.id, entry]));
  WindmateWatchlist.renderStrip(els.watchlistStrip, {
    activeSport,
    observationsBySpot: obsBySpot,
    prefs: matrixPrefs,
    rideEntryBySpot,
    sportProfiles,
    radiusKm: rideabilityData.radius_km ?? getSearchRadiusKm(),
  });
  rebindObservationToggles(obsBySpot, matrixPrefs);
  refreshWatchlistDepartures();
}

async function refreshLiveObservations() {
  if (!WindmateObservations.hasExpandedCurves() || !rideabilityData) return;
  try {
    await WindmateWatchlist.load();
    const { query, watchedQuery } = observationsQueryString();
    const obsRes = await api(`/api/observations?${query}${watchedQuery}&refresh=1`).catch(() => ({
      spots: [],
    }));
    applyObservationsToUi(obsRes);
  } catch {
    /* keep last good data */
  }
}

async function refreshDashboard({ silent = false, bypassCache = false } = {}) {
  const viewingToday =
    selectedDayDate != null && selectedDayDate === WindmateForecastTime.localDateString();
  const scrollY = silent ? window.scrollY : null;

  if (!silent) {
    setDashboardLoading(WindmateCopy.loading.dashboard);
  }
  try {
    await WindmateWatchlist.load();
    const { query, watchedQuery, refreshQuery } = observationsQueryString({ bypassCache });

    const [rideRes, obsRes, summaryRes] = await Promise.all([
      api(`/api/rideability?${query}${refreshQuery}`),
      api(`/api/observations?${query}${watchedQuery}${refreshQuery}`).catch(() => ({ spots: [] })),
      api(
        `/api/sports/horizon-summary?lat=${userLocation.lat}&lng=${userLocation.lng}${refreshQuery}`
      ).catch(() => null),
    ]);
    rideabilityData = rideRes;
    observationsData = obsRes;
    horizonSummary = summaryRes;
    activeSport = rideabilityData.preferences?.sport ?? activeSport;
    rideabilityData.preferences = prefsForRanking(rideabilityData.preferences);
    rankCriteriaOrder = rideabilityData.preferences.rank_criteria_order;
    favoriteSpotIds = normalizeFavoriteSpotIds(rideabilityData.preferences.favorite_spot_ids);
    WindmateSportSelector.setState({
      profiles: sportProfiles.map((p) => ({
        ...p,
        display_name: SPORT_DISPLAY_NAMES[p.sport],
      })),
      activeSport,
      summary: horizonSummary,
    });
    renderRankCriteriaList(rankCriteriaOrder);
    renderModelLegend(rideabilityData);
    if (viewingToday) {
      selectedDayDate = WindmateForecastTime.localDateString();
    }
    renderHorizonPlanner(rideabilityData);
    applyObservationsToUi(observationsData);
    lastDashboardFetchAt = Date.now();
    restoreScrollAfterSilentRefresh(scrollY);
  } catch (err) {
    const msg = WindmateCopy.errors.loadFailed(err.message);
    els.horizonPlanner.innerHTML = `<p class="col-span-full text-red-400">${msg}</p>`;
    els.rideabilityMatrix.innerHTML = `<p class="text-red-400">${msg}</p>`;
  }
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
  const probabilityLegend = WindmateForecastProbability.renderLegend();
  const rideLegend = renderRideLegend();
  const first = data.spots.find((s) => s.models && Object.keys(s.models).length);
  if (!first) {
    els.modelLegend.innerHTML = `${windLegend}${waveLegend}${probabilityLegend}${rideLegend}`;
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
    ${probabilityLegend}
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

function resolveDepartureWindowForSession(session) {
  if (!rideabilityData || session.sport !== rideabilityData.preferences.sport) return null;

  const entry = rideabilityData.spots.find((row) => row.spot.id === session.spot_id);
  if (!entry) return null;

  const dayHours = getSpotDayData(entry, session.session_date)?.hours ?? [];
  if (!dayHours.length) return null;

  const pick = WindmateSessionRank.pickDepartureQualifyingWindow(
    entry,
    session.session_date,
    prefsForRanking(rideabilityData.preferences),
    dayHours
  );
  if (!pick) return null;

  return {
    start: pick.run.start,
    end: WindmateDeparture.exclusiveEndAfterRun(pick.run.end),
  };
}

function refreshWatchlistDepartures() {
  if (!els.watchlistStrip || userLocation.lat == null || userLocation.lng == null) return;
  WindmateDeparture.loadForWatchlist(
    els.watchlistStrip,
    WindmateWatchlist.getSessions(),
    userLocation.lat,
    userLocation.lng,
    (session) => WindmateWatchlist.resolveVerdict(session),
    resolveDepartureWindowForSession
  );
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
  const dist = entry?.spot.distance_km ?? Infinity;
  const outsideRadius = dist > radius;

  if (!wasFavorite) {
    return !entry || outsideRadius;
  }
  return !entry || outsideRadius;
}

async function persistFavorites({ fullRefresh = true } = {}) {
  const updated = await api(`/api/preferences/sports/${activeSport}`, {
    method: 'PUT',
    body: JSON.stringify({ favorite_spot_ids: favoriteSpotIds }),
  });
  applyFullPreferences(updated);
  if (fullRefresh) {
    await refreshDashboard({ silent: true });
  } else {
    applyRankOrderToMatrix();
  }
}

function toggleFavorite(spotId, { allowAdd = true } = {}) {
  const wasFavorite = isFavoriteSpot(spotId);
  const next = new Set(favoriteSpotIds);
  if (next.has(spotId)) next.delete(spotId);
  else if (allowAdd) next.add(spotId);
  else return false;
  favoriteSpotIds = [...next];
  if (rideabilityData?.preferences) {
    rideabilityData.preferences.favorite_spot_ids = favoriteSpotIds;
  }

  const fullRefresh = favoriteToggleNeedsFullRefresh(spotId, wasFavorite);
  persistFavorites({ fullRefresh }).catch((err) => console.error(err));

  if (els.spotSearchResults && !els.spotSearchResults.classList.contains('hidden')) {
    const q = els.spotSearchInput?.value.trim();
    if (q.length >= 2) runSpotSearch(q);
  }
  if (WindmateSpotMapPicker?.isOpen()) {
    WindmateSpotMapPicker.refreshMarkers();
  }
  return true;
}

function favoriteFromMap(spot) {
  if (isFavoriteSpot(spot.id)) return;
  if (favoriteSpotIds.length >= MAX_FAVORITE_SPOTS) {
    WindmateSpotMapPicker.showToast(WindmateCopy.map.favoriteLimit);
    return;
  }
  toggleFavorite(spot.id);
  WindmateSpotMapPicker.showToast(WindmateCopy.map.added(spot.name));
}

async function favoriteCreatedSpot(spot) {
  if (isFavoriteSpot(spot.id)) {
    WindmateSpotMapPicker.refreshMarkers();
    return;
  }
  if (favoriteSpotIds.length >= MAX_FAVORITE_SPOTS) {
    WindmateSpotMapPicker.showToast(WindmateCopy.map.favoriteLimit);
    return;
  }
  favoriteSpotIds = [...favoriteSpotIds, spot.id];
  if (rideabilityData?.preferences) {
    rideabilityData.preferences.favorite_spot_ids = favoriteSpotIds;
  }
  await persistFavorites({ fullRefresh: true });
  WindmateSpotMapPicker.refreshMarkers();
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
        <div class="spot-search-result" role="option" data-spot-id="${spot.id}" data-spot-lat="${spot.latitude}" data-spot-lng="${spot.longitude}" data-spot-name="${spot.name.replace(/"/g, '&quot;')}">
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

function initSpotMapPicker() {
  WindmateSpotMapPicker.init({
    getFavoriteIds: () => favoriteSpotIds,
    getActiveSport: () => activeSport,
    getHome: () => userLocation,
    onFavorite: favoriteFromMap,
    onCreated: favoriteCreatedSpot,
  });
}

function initSpotSearch() {
  if (els.spotSearchInput) {
    els.spotSearchInput.placeholder = WindmateCopy.search.placeholder;
    els.spotSearchInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      if (!WindmateSpotMapPicker.isOpen()) return;
      e.preventDefault();
      const q = els.spotSearchInput.value.trim();
      if (q.length < 2) return;
      await WindmateSpotMapPicker.handleSearchEnter(q);
    });
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

  els.spotSearchResults?.addEventListener('click', (e) => {
    if (e.target.closest('.spot-favorite-btn')) return;
    const row = e.target.closest('.spot-search-result[data-spot-id]');
    if (!row || !WindmateSpotMapPicker.isOpen()) return;
    const lat = parseFloat(row.dataset.spotLat);
    const lng = parseFloat(row.dataset.spotLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    WindmateSpotMapPicker.focusSpot({
      id: row.dataset.spotId,
      name: row.dataset.spotName,
      latitude: lat,
      longitude: lng,
    });
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

function isPlannedHorizonSpot(entry, radiusKm) {
  if (entry.spot?.outside_radius) return false;
  const dist = entry.spot?.distance_km;
  if (Number.isFinite(dist) && dist > radiusKm) return false;
  return true;
}

function plannedHorizonSpots(spots, radiusKm) {
  return spots.filter((entry) => isPlannedHorizonSpot(entry, radiusKm));
}

/** True when only out-of-radius favorites have qualifying windows — not a local planned day. */
function isFarFavoritesOnlyHorizonDay(spots, dateStr, prefs, radiusKm) {
  let anyFarWindow = false;
  let anyPlannedWindow = false;
  for (const entry of spots) {
    if (getConsensusRideableHours(entry, dateStr, prefs) <= 0) continue;
    if (isPlannedHorizonSpot(entry, radiusKm)) anyPlannedWindow = true;
    else anyFarWindow = true;
  }
  return anyFarWindow && !anyPlannedWindow;
}

function renderHorizonFarCuriosityBlock() {
  const line = WindmateCopy.horizon.farAwayCuriosity;
  const title = WindmateCopy.horizon.farAwayCuriosityTitle;
  return `<div class="mt-3 text-sm text-slate-400 leading-snug" title="${escapeHtml(title)}">${escapeHtml(line)}</div>`;
}

function renderHorizonBustSticker() {
  const title = escapeHtml(WindmateCopy.excitement.bustTooltip);
  const label = escapeHtml(WindmateCopy.excitement.bustLabel);
  return `<span class="session-excitement-stack" title="${title}">
        <span class="session-excitement-sticker session-excitement-sticker--bust" role="img" aria-label="${label}">😢</span>
      </span>`;
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

/** Space to leave below the sticky horizon planner when scrolling matrix cards into view. */
function getMatrixScrollOffset(extra = 16) {
  const sticky = document.querySelector('.horizon-planner-sticky');
  return sticky ? sticky.offsetHeight + extra : extra;
}

function scrollToSpot(spotId, { behavior = 'smooth' } = {}) {
  const card = els.rideabilityMatrix?.querySelector(`[data-spot-id="${spotId}"]`);
  if (!card) return false;

  const offset = getMatrixScrollOffset();
  const top = card.getBoundingClientRect().top + window.scrollY - offset;

  window.scrollTo({ top: Math.max(0, top), behavior });
  card.classList.add('spot-card--highlight');
  window.setTimeout(() => card.classList.remove('spot-card--highlight'), 2200);
  return true;
}

function scrollSpotListToTop({ behavior = 'smooth' } = {}) {
  const firstSpot = els.rideabilityMatrix?.firstElementChild;
  if (!firstSpot) return;

  const offset = getMatrixScrollOffset();
  const firstTop = firstSpot.getBoundingClientRect().top;

  if (firstTop >= offset && firstTop < window.innerHeight) return;

  const top = firstTop + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

function selectDay(dateStr, { scroll = 'top', spotId = null } = {}) {
  selectedDayDate = dateStr;
  if (!rideabilityData) return;
  renderHorizonPlanner(rideabilityData);
  renderRideabilityMatrix(rideabilityData, observationsData);
  if (scroll === 'spot' && spotId) {
    // Wait for matrix layout after re-render before measuring scroll offset.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToSpot(spotId));
    });
  } else {
    scrollSpotListToTop();
  }
}

async function goToWatchedSession({ spotId, sessionDate, sport }) {
  if (!spotId || !sessionDate) return;
  selectedDayDate = sessionDate;
  if (sport && sport !== activeSport) {
    await switchActiveSport(sport);
  }
  selectDay(sessionDate, { scroll: 'spot', spotId });
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
    selectedDayDate = WindmateForecastTime.defaultPlannerDayDate(days);
  }

  els.horizonPlanner.innerHTML = days
    .map((day, i) => {
      const dayIndex = i + 1;
      const blurClass = dayIndex >= 4 ? `horizon-day-${dayIndex}` : '';
      const selectedClass = day.date === selectedDayDate ? 'selected' : '';
      const date = new Date(day.date + 'T12:00:00');
      const dayName = date.toLocaleDateString([], { weekday: 'short' });
      const monthDay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const radiusKm = getSearchRadiusKm();
      const farCuriosityOnly = isFarFavoritesOnlyHorizonDay(
        data.spots,
        day.date,
        data.preferences,
        radiusKm
      );
      const plannedSpots = plannedHorizonSpots(data.spots, radiusKm);
      const rideableRange = getDayRideableWindowRange(plannedSpots, day.date, data.preferences);
      const rideableLabel = WindmateCopy.horizon.rideableHours(
        rideableRange.min,
        rideableRange.max
      );
      const maxSessionProbability = WindmateForecastProbability.maxSessionProbabilityForDay(
        plannedSpots,
        day.date,
        data.preferences,
        getModelDayHours
      );
      const pct = Math.round(maxSessionProbability * 100);
      const probabilityBarColor = WindmateForecastProbability.colorForProbability(maxSessionProbability);
      const spotsWithWindows = countSpotsWithSharedWindows(
        plannedSpots,
        day.date,
        data.preferences
      );
      const agreement =
        !farCuriosityOnly && spotsWithWindows > 0
          ? `<div class="mt-1 text-[10px] text-slate-500">${WindmateCopy.horizon.spotsWithWindows(spotsWithWindows)}</div>`
          : '';

      const isTodayCard = day.date === forecastToday;
      const todayTag = isTodayCard
        ? '<span class="text-[10px] text-emerald-400 font-medium">Today</span>'
        : '';

      let horizonStickers;
      let forecastBlock;
      let rideableFooter = '';

      if (farCuriosityOnly) {
        horizonStickers = renderHorizonBustSticker();
        forecastBlock = renderHorizonFarCuriosityBlock();
      } else {
        const horizonExcitement = WindmateSessionExcitement.pickBestHorizonExcitement(
          plannedSpots,
          day.date,
          data.preferences,
          radiusKm,
          rideableRange.max
        );
        horizonStickers = WindmateSessionExcitement.renderStickers(horizonExcitement);
        forecastBlock = renderHorizonWindBlock(
          plannedSpots,
          day.date,
          data.preferences,
          sportColor,
          rideableRange.max
        );
        rideableFooter = `
          <div class="mt-2 text-xs text-slate-400" title="${escapeHtml(WindmateCopy.horizon.forecastProbabilityTitle)}">${rideableLabel} · ${pct}%</div>
          ${agreement}
          <div class="mt-3 h-1.5 rounded-full bg-base overflow-hidden" title="${escapeHtml(WindmateCopy.horizon.forecastProbabilityTitle)}">
            <div class="h-full rounded-full" style="width:${pct}%;background:${probabilityBarColor}"></div>
          </div>`;
      }

      const cardExtraClass = farCuriosityOnly ? ' horizon-day-card--far-curiosity' : '';

      return `
        <button
          type="button"
          class="horizon-day-card horizon-day-card--stickers text-left bg-base-card border border-base-border rounded-xl p-4 ${blurClass} ${selectedClass}${cardExtraClass}"
          data-date="${day.date}"
          aria-pressed="${day.date === selectedDayDate}"
          ${farCuriosityOnly ? `title="${escapeHtml(WindmateCopy.horizon.farAwayCuriosityTitle)}"` : ''}
        >
          ${horizonStickers}
          <div class="flex items-center justify-between gap-1">
            <div class="text-xs text-slate-400 uppercase">${dayName}</div>
            ${todayTag}
          </div>
          <div class="text-lg font-semibold text-white">${monthDay}</div>
          ${forecastBlock}
          ${rideableFooter}
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

function isMatrixSessionPlanningHour(time, dateStr) {
  return WindmateForecastTime.isSessionPlanningHour(
    WindmateRideableWindow.hourTimeKey(time),
    dateStr
  );
}

function isMatrixNightHour(hour) {
  return hour != null && hour.daylightOk === false;
}

function isMatrixNightSlot(timelineSlot, modelHoursAtSlot) {
  if (isMatrixNightHour(timelineSlot)) return true;
  const present = (modelHoursAtSlot ?? []).filter((hour) => hour != null);
  if (!present.length) return false;
  return present.every((hour) => hour.daylightOk === false);
}

function matrixEmptyHourSegments(segmentCount) {
  const count = Math.max(1, segmentCount);
  return Array.from({ length: count }, () => '<div class="hour-block-seg hour-block-seg--empty"></div>').join(
    ''
  );
}

function criterionHourBlockClass(timelineSlot, modelHoursAtSlot, dateStr) {
  const classes = ['hour-block'];
  if (isMatrixNightSlot(timelineSlot, modelHoursAtSlot)) {
    classes.push('hour-block--night');
    return classes.join(' ');
  }
  const elapsed = dateStr && !isMatrixSessionPlanningHour(timelineSlot.time, dateStr);
  if (elapsed) classes.push('hour-block--elapsed');
  const present = modelHoursAtSlot.filter((hour) => hour != null);
  const anyRideable = !elapsed && present.some((hour) => hour.rideable);
  if (anyRideable) classes.push('rideable');
  if (anyRideable && !timelineSlot.inRideableWindow) classes.push('rideable-isolated');
  if (!anyRideable && present.some((hour) => hour.offshoreBlocked && hour.windOk)) {
    classes.push('offshore-hour');
  }
  if (present.some((hour) => WindmateWeatherHazards.hasForecastRain(hour))) {
    classes.push('rain-hour');
  }
  if (present.some((hour) => (hour?.weatherCode ?? 0) >= 95)) classes.push('storm-hour');
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
  if (hour == null) return 'No forecast data for this hour';
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
    if (hour == null) {
      lines.push(`${label}: — (${modelHourStatus(hour)})`);
      continue;
    }
    if (!hour.rideable) {
      lines.push(`${label}: — (${modelHourStatus(hour)})`);
      continue;
    }
    lines.push(`${label}: ${criterionValueLine(hour, criterion)}`);
  }

  const primary =
    modelHours.map((entry) => entry.hour).find((h) => h != null && h.rideable) ??
    modelHours.map((entry) => entry.hour).find((h) => h != null);
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
      if (isMatrixNightHour(hour)) return '';
      if (!WindmateWeatherHazards.hasForecastRain(hour)) return '';
      const left = (index / count) * 100;
      const width = (1 / count) * 100;
      return `<div class="matrix-rain-segment" style="left:${left}%;width:${width}%"></div>`;
    })
    .join('');
}

function renderDirectionRow(hours, dateStr) {
  if (!hours?.length) return '';

  const blocks = hours
    .map((hour) => {
      if (isMatrixNightHour(hour)) {
        return '<div class="matrix-direction matrix-direction--night" aria-hidden="true"></div>';
      }
      const exposure = hour.windExposure ?? 'unknown';
      const exposureLabel = WindmateCopy.direction.exposure[exposure] ?? exposure;
      const hourLabel = hour.time.slice(11, 16);
      const title = `${hourLabel} ${hour.direction} · ${exposureLabel}`;
      const tip = escapeHtml(title);
      const elapsed =
        dateStr && !isMatrixSessionPlanningHour(hour.time, dateStr)
          ? ' matrix-direction--elapsed'
          : '';
      return `<div class="matrix-direction matrix-direction--${exposure}${elapsed}"><span>${hour.direction}</span><span class="hour-block-tip" role="tooltip">${tip}</span></div>`;
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

function hourHasMatrixConditionData(hour) {
  if (hour == null) return false;
  return hour.windSpeed != null || hour.gusts != null || hour.waveHeightM != null;
}

/** Same gate as tooltips: wind/weather/temp OK but direction blocked offshore. */
function isOffshoreBlockedMatrixHour(hour) {
  return (
    hour != null &&
    hour.windOk &&
    hour.weatherOk &&
    hour.tempOk &&
    hour.offshoreBlocked
  );
}

function matrixOffshoreBlockedSegmentHtml() {
  return '<div class="hour-block-seg hour-block-seg--offshore" aria-hidden="true"></div>';
}

function renderCriterionSegments(modelHoursAtSlot, criterion, elapsed, night) {
  if (night) return matrixEmptyHourSegments(modelHoursAtSlot.length);
  return modelHoursAtSlot
    .map((hour) => {
      if (hour == null) return '';
      const showSegment = elapsed ? hourHasMatrixConditionData(hour) : hour.rideable;
      if (!showSegment) {
        if (isOffshoreBlockedMatrixHour(hour)) {
          return matrixOffshoreBlockedSegmentHtml();
        }
        return '<div class="hour-block-seg hour-block-seg--empty"></div>';
      }
      const color = criterionColor(hour, criterion);
      return `<div class="hour-block-seg" style="background:${color}"></div>`;
    })
    .join('');
}

function renderProbabilitySegments(modelHoursAtSlot, slotAgreement) {
  return modelHoursAtSlot
    .map((hour) => {
      if (hour == null || !hour.rideable) {
        if (isOffshoreBlockedMatrixHour(hour)) {
          return matrixOffshoreBlockedSegmentHtml();
        }
        return '<div class="hour-block-seg hour-block-seg--empty"></div>';
      }
      const hasMeteo = WindmateForecastProbability.hasMeteoForecastProbability(hour);
      const probability = WindmateForecastProbability.resolveSegmentDisplayProbability(
        hour,
        slotAgreement
      );
      const color = WindmateForecastProbability.colorForProbability(probability);
      const inferredClass = hasMeteo ? '' : ' hour-block-seg--inferred';
      return `<div class="hour-block-seg${inferredClass}" style="background:${color}"></div>`;
    })
    .join('');
}

function probabilitySlotHasRideable(modelHoursAtSlot, slot) {
  if (modelHoursAtSlot.some((hour) => hour?.rideable)) return true;
  return slot?.rideable === true;
}

function probabilityTooltipLines(modelHours, time, slotAgreement, slotHasMeteo) {
  const hourLabel = time.slice(11, 16);
  const lines = [`${WindmateCopy.matrix.probabilityRow} · ${hourLabel}`];
  if (slotHasMeteo) {
    lines.push(WindmateCopy.matrix.probabilityMeteoHour);
  } else {
    lines.push(
      `${WindmateCopy.matrix.probabilityAgreementFallback}: ${Math.round(
        (Number(slotAgreement) || 0) * 100
      )}%`
    );
  }
  for (const { label, hour } of modelHours) {
    if (hour == null || !hour.rideable) {
      lines.push(`${label}: —`);
      continue;
    }
    const inferred =
      hour.probabilityInferred && hour.time
        ? ` ~ (${String(hour.time).slice(11, 16)} step)`
        : '';
    const meteo = WindmateForecastProbability.resolveHourMeteoProbability(hour);
    if (meteo != null) {
      lines.push(`${label}: ${Math.round(meteo * 100)}% meteo${inferred}`);
    } else {
      lines.push(`${label}: ${WindmateCopy.matrix.probabilityNoMeteo}${inferred}`);
    }
  }
  return lines;
}

function probabilitySlotHasMeteo(modelHoursAtSlot) {
  return modelHoursAtSlot.some((hour) =>
    WindmateForecastProbability.hasMeteoForecastProbability(hour)
  );
}

function renderProbabilityRow(timelineHours, modelEntries, getModelHours, windowMaps, entry, dateStr) {
  if (!timelineHours?.length) return '';

  const hourlyAgreement =
    entry && dateStr && typeof WindmateSessionRank.buildHourlyModelAgreementMap === 'function'
      ? WindmateSessionRank.buildHourlyModelAgreementMap(entry, dateStr)
      : new Map();

  const probAligned =
    modelEntries.length > 0
      ? modelEntries.map(([id, model]) => ({
          label: model.label ?? id,
          hours: WindmateRideableWindow.alignModelHoursToTimeline(
            timelineHours,
            getModelHours(id) ?? [],
            windowMaps,
            { fillNearest: true, rideableOnly: true }
          ),
        }))
      : [
          {
            label: 'Forecast',
            hours: WindmateRideableWindow.alignModelHoursToTimeline(
              timelineHours,
              timelineHours,
              windowMaps,
              { fillNearest: true, rideableOnly: true }
            ),
          },
        ];

  const timelineSlots = WindmateRideableWindow.alignModelHoursToTimeline(
    timelineHours,
    timelineHours,
    windowMaps
  );
  const label = WindmateCopy.matrix.probabilityRow;
  const hint = WindmateCopy.matrix.probabilityRowHint;

  const blocks = timelineSlots
    .map((slot, index) => {
      const modelHoursAtSlot = probAligned.map((model) => model.hours[index]);
      const night = isMatrixNightSlot(slot, modelHoursAtSlot);
      const slotAgreement =
        hourlyAgreement.get(WindmateRideableWindow.hourTimeKey(slot.time)) ?? 0;
      const segments = night
        ? matrixEmptyHourSegments(modelHoursAtSlot.length)
        : renderProbabilitySegments(modelHoursAtSlot, slotAgreement);
      if (night) {
        return `<div class="hour-block hour-block--probability hour-block--night" aria-hidden="true"><div class="hour-block-segments">${segments}</div></div>`;
      }
      const modelHours = probAligned.map((model) => ({
        label: model.label,
        hour: model.hours[index],
      }));
      const slotHasMeteo = probabilitySlotHasMeteo(modelHoursAtSlot);
      const tipText = probabilitySlotHasRideable(modelHoursAtSlot, slot)
        ? probabilityTooltipLines(modelHours, slot.time, slotAgreement, slotHasMeteo).join('\n')
        : `${WindmateCopy.matrix.probabilityRow} · ${slot.time.slice(11, 16)}\n${WindmateCopy.matrix.probabilityNotRideable}`;
      const tip = escapeHtml(tipText);
      return `<div class="hour-block hour-block--probability"><div class="hour-block-segments">${segments}</div><span class="hour-block-tip" role="tooltip">${tip}</span></div>`;
    })
    .join('');

  return `
    <div class="matrix-row matrix-row--probability flex items-center gap-2 mb-1">
      <span class="text-[10px] text-slate-400 w-24 shrink-0 truncate" title="${escapeHtml(hint)}">${label}</span>
      <div class="matrix-hour-track flex-1">
        <div class="matrix-hour-blocks">${blocks}</div>
      </div>
    </div>`;
}

function renderCriterionRow(timelineHours, alignedModels, criterion, label, windowMaps, dateStr) {
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
      const night = isMatrixNightSlot(slot, modelHoursAtSlot);
      const elapsed = !night && dateStr && !isMatrixSessionPlanningHour(slot.time, dateStr);
      const cls = criterionHourBlockClass(slot, modelHoursAtSlot, dateStr);
      const segments = renderCriterionSegments(modelHoursAtSlot, criterion, elapsed, night);
      if (night) {
        return `<div class="${cls}" aria-hidden="true"><div class="hour-block-segments">${segments}</div></div>`;
      }
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

function windowScoreCriterionLabel(key) {
  return WindmateCopy.rankCriteria[key]?.label ?? WindmateCopy.matrix[key + 'Row'] ?? key;
}

function windowScoreConfidenceLabel(source) {
  if (source === 'meteo') {
    return WindmateCopy.rankCriteria.forecastConfidenceMeteo?.label ?? windowScoreCriterionLabel('forecastConfidence');
  }
  if (source === 'agreement') {
    return (
      WindmateCopy.rankCriteria.forecastConfidenceAgreement?.label ??
      windowScoreCriterionLabel('forecastConfidence')
    );
  }
  if (source === 'mixed') {
    return (
      WindmateCopy.rankCriteria.forecastConfidenceMixed?.label ??
      windowScoreCriterionLabel('forecastConfidence')
    );
  }
  return windowScoreCriterionLabel('forecastConfidence');
}

function formatWindowScoreTooltip(scored, sessionWindowHours, order, weights) {
  const startLabel = scored.run.start.slice(11, 16);
  const endHour = scored.run.end.slice(11, 16);
  const lines = [
    `Window score ${scored.windowScore.toFixed(2)}`,
    `${startLabel}–${endHour} (${sessionWindowHours} h)`,
    '',
  ];

  for (const key of order) {
    const value = scored.metrics[key] ?? 0;
    const weight = weights[key] ?? 0;
    const contribution = value * weight;
    const pct = `${(weight * 100).toFixed(0)}%`;
    lines.push(
      `${windowScoreCriterionLabel(key)}: ${value.toFixed(2)} × ${pct} = ${contribution.toFixed(2)}`
    );
  }

  const confidence = scored.metrics.forecastConfidence ?? 1;
  const baseScore = scored.baseScore ?? scored.windowScore / Math.max(confidence, 0.001);
  const confidenceLabel = windowScoreConfidenceLabel(scored.metrics.forecastConfidenceSource);
  lines.push('');
  lines.push(`Conditions subtotal: ${baseScore.toFixed(2)}`);
  lines.push(
    `${confidenceLabel}: ${confidence.toFixed(2)} × subtotal = ${scored.windowScore.toFixed(2)}`
  );

  return lines.join('\n');
}

function matrixScoreDisplayValue(windowScore) {
  return Number(windowScore.toFixed(2));
}

function renderWindowScoreRow(timelineHours, entry, dateStr, prefs) {
  const planningHour = (time) => isMatrixSessionPlanningHour(time, dateStr);
  if (!timelineHours?.length) return '';

  const { byStartTime, sessionWindowHours, weights, order } = WindmateSessionRank.scoreWindowsByStartHour(
    entry,
    dateStr,
    prefs,
    timelineHours
  );
  const scoredValues = [...byStartTime.values()];
  const topDisplayScore = scoredValues.length
    ? Math.max(...scoredValues.map((scored) => matrixScoreDisplayValue(scored.windowScore)))
    : null;

  const blocks = timelineHours
    .map((hour) => {
      const key = WindmateRideableWindow.hourTimeKey(hour.time);
      if (!planningHour(hour.time) || isMatrixNightHour(hour)) {
        return '<div class="matrix-score-cell matrix-score-cell--inactive" aria-hidden="true"></div>';
      }
      const scored = byStartTime.get(key);
      if (!scored) {
        return '<div class="matrix-score-cell" aria-hidden="true"></div>';
      }

      const displayScore = matrixScoreDisplayValue(scored.windowScore);
      const isTopScore = topDisplayScore != null && displayScore === topDisplayScore;
      const cls = isTopScore ? 'matrix-score-cell matrix-score-cell--top' : 'matrix-score-cell';
      const tip = escapeHtml(formatWindowScoreTooltip(scored, sessionWindowHours, order, weights));
      return `<div class="${cls}"><span>${displayScore.toFixed(2)}</span><span class="matrix-score-cell-tip" role="tooltip">${tip}</span></div>`;
    })
    .join('');

  const label = WindmateCopy.matrix.scoreRow;
  const hint = WindmateCopy.matrix.scoreRowHint;

  return `
    <div class="matrix-row matrix-row--score flex items-center gap-2 mb-1">
      <span class="text-[10px] text-slate-500 w-24 shrink-0 truncate" title="${escapeHtml(hint)}">${label}</span>
      <div class="matrix-hour-track flex-1">
        <div class="matrix-score-blocks">${blocks}</div>
      </div>
    </div>`;
}

function matrixHourOfDay(time) {
  return parseInt(String(time).replace(' ', 'T').slice(11, 13), 10);
}

function renderMatrixTimeAxis(timelineHours) {
  if (!timelineHours?.length) return '';

  const markers = new Set([0, 6, 12, 18, 23]);
  const cells = timelineHours
    .map((hour) => {
      const hourOfDay = matrixHourOfDay(hour.time);
      if (!markers.has(hourOfDay)) {
        return '<span class="matrix-time-cell" aria-hidden="true"></span>';
      }
      return `<span class="matrix-time-cell">${hourOfDay}</span>`;
    })
    .join('');

  return `
    <div class="matrix-time-axis flex items-center gap-2 mb-1" aria-hidden="true">
      <span class="w-24 shrink-0"></span>
      <div class="matrix-hour-track flex-1">
        <div class="matrix-time-blocks">${cells}</div>
      </div>
    </div>`;
}

function renderCriterionMatrixRows(
  timelineHours,
  modelEntries,
  getModelHours,
  windowMaps,
  entry,
  dateStr
) {
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

  const criteriaHtml = criteria
    .map((criterion) =>
      renderCriterionRow(
        timelineHours,
        alignedModels,
        criterion.key,
        criterion.label,
        windowMaps,
        dateStr
      )
    )
    .join('');

  return `${criteriaHtml}${renderProbabilityRow(
    timelineHours,
    modelEntries,
    getModelHours,
    windowMaps,
    entry,
    dateStr
  )}`;
}

function resolveSessionVerdictForDay(entry, date, prefs) {
  if (!entry || !prefs) {
    return entry?.sessionGoNoGoByDate?.[date] ?? null;
  }
  return WindmateSessionGoNoGo.forDay(entry, date, prefs, getModelDayHours);
}

function renderRideabilityMatrix(data, observations) {
  if (!data.spots.length) {
    els.rideabilityMatrix.innerHTML = `<p class="text-slate-400">${WindmateCopy.empty.noSpotsInRange}</p>`;
    return;
  }

  const horizonDays = data.spots[0]?.days?.slice(0, 7) ?? [];
  if (!selectedDayDate || !horizonDays.some((d) => d.date === selectedDayDate)) {
    selectedDayDate = WindmateForecastTime.defaultPlannerDayDate(horizonDays);
  }

  const viewingToday = isForecastToday(selectedDayDate, data);
  const obsBySpot = WindmateObservations.mapBySpotId(observations);

  const rankedSpots = sortSpotsForDay(
    data.spots,
    selectedDayDate,
    prefsForRanking(data.preferences),
    getSearchRadiusKm()
  ).filter((row) => row.rideableCount > 0);
  const minWindowHours = getMinRideableWindowHours(data.preferences);

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

      const directionRow = renderDirectionRow(dayHours, selectedDayDate);
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
        windowMaps,
        entry,
        selectedDayDate
      );

      const matrixPrefs = prefsForRanking(data.preferences);
      const departurePick = WindmateSessionRank.pickDepartureQualifyingWindow(
        entry,
        selectedDayDate,
        matrixPrefs,
        dayHours
      );
      const departureWindowStart = departurePick?.run.start ?? '';
      const departureWindowEnd = departurePick
        ? WindmateDeparture.exclusiveEndAfterRun(departurePick.run.end)
        : '';
      const scoreRow = renderWindowScoreRow(dayHours, entry, selectedDayDate, matrixPrefs);
      const matrixRows = `${directionRow}${criterionRows}${scoreRow}`;
      const dayLabel = viewingToday
        ? WindmateCopy.horizon.todayShort
        : formatDayLabel(selectedDayDate);
      const spotMap = WindmateSpotMap.renderForDay(spot, dayHours, { dayLabel });

      const link = spot.source_url
        ? `<a href="${spot.source_url}" target="_blank" rel="noopener" class="text-emerald-500 hover:underline text-xs">iGetwind</a>`
        : '';

      const watched = WindmateWatchlist.isWatched(
        spot.id,
        selectedDayDate,
        data.preferences.sport
      );
      const obsEntry = obsBySpot.get(spot.id);
      const sessionVerdict = resolveSessionVerdictForDay(
        entry,
        selectedDayDate,
        prefsForRanking(data.preferences)
      );
      const verdictBanner = WindmateObservations.renderVerdictBanner(sessionVerdict);
      const liveStrip = viewingToday
        ? WindmateObservations.renderLiveStrip(
            spot,
            obsEntry,
            entry,
            prefsForRanking(data.preferences),
            {
              curveKey: `matrix:${spot.id}`,
              sessionDate: selectedDayDate,
              ...(sessionVerdict ? { sessionGoNoGo: sessionVerdict, suppressVerdictBanner: true } : {}),
            }
          )
        : '';

      const favoriteBtn = renderFavoriteButton(spot);
      const outsideRadiusBadge =
        spot.distance_km > data.radius_km
          ? `<span class="spot-outside-radius-badge" title="${WindmateCopy.favorites.outsideRadius}">far</span>`
          : '';
      const watchBtn = WindmateWatchlist.renderWatchButton(
        spot.id,
        selectedDayDate,
        data.preferences.sport,
        watched
      );
      const windowStatsLine = verdictBanner
        ? ''
        : renderEfficientWindowStats(entry, selectedDayDate, data.preferences);
      const sessionExcitement = WindmateSessionExcitement.computeFromEntry(
        entry,
        selectedDayDate,
        matrixPrefs,
        getSearchRadiusKm()
      );
      const sessionStickers = WindmateSessionExcitement.renderStickers(sessionExcitement);

      return `
        <div class="bg-base-card border border-base-border rounded-xl p-5 session-card--stickers" data-spot-id="${spot.id}">
          ${sessionStickers}
          <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h3 class="font-semibold text-white flex flex-wrap items-center gap-2 min-w-0">
              <span class="text-slate-500 font-normal">#${rank + 1}</span>
              <span class="spot-title">
                <span class="spot-name">${spot.name}</span>
                ${outsideRadiusBadge}
                ${favoriteBtn}
                ${watchBtn}
              </span>
              ${rankBanners}
            </h3>
            <span class="text-xs text-slate-400 shrink-0">${spot.distance_km.toFixed(1)} km · ${rideableCount} rideable hrs ${link}</span>
          </div>
          ${windowStatsLine}
          ${verdictBanner}
          ${liveStrip}
          <div class="departure-plan-group" data-departure-group="${spot.id}">
            <div class="matrix-panel mb-0">
              <div class="matrix-panel-rows">
                <div
                  class="matrix-grid-wrap"
                  data-matrix-grid="${spot.id}"
                  data-matrix-hour-times="${dayHours.map((h) => WindmateRideableWindow.hourTimeKey(h.time)).join('|')}"
                  data-departure-window-start="${departureWindowStart}"
                  data-departure-window-end="${departureWindowEnd}"
                >
                  ${renderMatrixTimeAxis(dayHours)}
                  ${matrixRows}
                </div>
              </div>
              ${spotMap ? `<div class="matrix-panel-map">${spotMap}</div>` : ''}
            </div>
            <div class="departure-line-slot" data-departure-for="${spot.id}"></div>
            <svg class="departure-plan-stroke" data-departure-stroke-for="${spot.id}" aria-hidden="true">
              <path class="departure-plan-stroke__shape"></path>
            </svg>
          </div>
          ${WindmateSpotIntel.renderDrawer(spot.id, data.preferences.sport, spot.name)}
        </div>`;
    })
    .join('');

  const warningsBySpot = new Map(
    data.spots.map((entry) => [entry.spot.id, entry.warnings ?? []])
  );
  const rideEntryBySpot = new Map(data.spots.map((entry) => [entry.spot.id, entry]));
  WindmateObservations.bindToggles(
    els.rideabilityMatrix,
    obsBySpot,
    data.preferences,
    warningsBySpot,
    rideEntryBySpot
  );
  WindmateWatchlist.bindWatchButtons(els.rideabilityMatrix, data.preferences.sport);

  const spotIds = rankedSpots.map((row) => row.entry.spot.id);
  const sessionVerdictBySpot = new Map(
    rankedSpots.map((row) => [
      row.entry.spot.id,
      resolveSessionVerdictForDay(row.entry, selectedDayDate, prefsForRanking(data.preferences)),
    ])
  );
  WindmateDeparture.loadForMatrix(
    els.rideabilityMatrix,
    spotIds,
    selectedDayDate,
    userLocation.lat,
    userLocation.lng,
    data.preferences.sport,
    sessionVerdictBySpot
  );
  WindmateSpotIntel.bindDrawers(els.rideabilityMatrix, data.preferences.sport);
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
  WindmateSpotIntel.init();
  initSpotMapPicker();
  initSpotSearch();
  initFavoriteToggles();
  WindmateSportSelector.init(els.sportSelector, { onSwitch: switchActiveSport });
  WindmateWatchlist.setOnChange(() => refreshDashboard({ silent: true }));
  WindmateWatchlist.setOnNavigate(goToWatchedSession);
  WindmateObservations.setAutoRefreshCallback(() => refreshLiveObservations());
  setDashboardLoading(WindmateCopy.loading.dashboard);
  els.locationStatus.textContent = WindmateCopy.geo.locating;
  await loadPreferences();
  els.locationStatus.textContent = WindmateCopy.geo.defaultMontreal;
  await refreshDashboard();
  initHourlyDashboardRefresh();
  initGeolocation();
})();
