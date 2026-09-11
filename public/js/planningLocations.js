/** Saved planning places — active origin, map editor, launch GPS snap. */
const WindmatePlanningLocations = (() => {
  let savedLocations = [];
  let activeLocationId = null;
  let activeLocation = null;
  let autoSelectKm = 40;
  let maxAccuracyM = 500;
  let manualActiveChange = false;
  let launchSnapDone = false;
  let opts = {};

  let editorMap = null;
  let editingPlaceId = null;
  let suppressMapCenterSync = false;
  let outsideMenuClickBound = false;

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function showToast(message) {
    if (opts.showToast) opts.showToast(message);
  }

  function activePlace() {
    return activeLocation ?? savedLocations.find((p) => p.id === activeLocationId) ?? null;
  }

  function applyFromPreferences(prefs) {
    savedLocations = prefs.saved_locations ?? [];
    activeLocationId = prefs.active_location_id ?? null;
    activeLocation = prefs.active_location ?? activePlace();
    autoSelectKm = prefs.location_auto_select_km ?? 40;
    maxAccuracyM = prefs.location_gps_max_accuracy_m ?? 500;
    WindmateForecastTime.setPlanningContext(activeLocation);
    renderControl();
    updateStatusLine();
    if (opts.onPlanningContextChange) opts.onPlanningContextChange(activeLocation);
  }

  function hasSavedPlaces() {
    return savedLocations.length > 0;
  }

  function updateStatusLine() {
    const el = opts.locationStatusEl;
    if (!el) return;
    const place = activePlace();
    if (place) {
      el.textContent = WindmateCopy.location.planningFrom(place.nickname);
      return;
    }
    el.textContent = WindmateCopy.geo.defaultMontreal;
  }

  function renderControl() {
    const root = opts.controlEl;
    if (!root) return;
    if (!hasSavedPlaces()) {
      root.innerHTML = '';
      root.hidden = true;
      if (opts.locateBtnEl) opts.locateBtnEl.hidden = false;
      return;
    }
    root.hidden = false;
    if (opts.locateBtnEl) opts.locateBtnEl.hidden = true;

    const place = activePlace();
    const name = place?.nickname ?? '…';
    root.innerHTML = `
      <div class="planning-location">
        <button type="button" class="planning-location__trigger" id="planning-location-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="planning-location__label">${WindmateCopy.location.planningFrom(name)}</span>
          <span class="planning-location__chevron" aria-hidden="true">▾</span>
        </button>
        <div id="planning-location-menu" class="planning-location__menu hidden" role="listbox"></div>
      </div>`;

    const trigger = root.querySelector('#planning-location-trigger');
    const menu = root.querySelector('#planning-location-menu');
    menu.innerHTML = [
      ...savedLocations.map(
        (p) => `
        <button type="button" class="planning-location__item" role="option" data-location-id="${p.id}" aria-selected="${p.id === activeLocationId}">
          <span class="planning-location__radio" aria-hidden="true">${p.id === activeLocationId ? '●' : '○'}</span>
          ${p.nickname}
        </button>`
      ),
      `<div class="planning-location__divider"></div>`,
      `<button type="button" class="planning-location__item planning-location__item--action" data-action="add">${WindmateCopy.location.addPlace}</button>`,
      `<button type="button" class="planning-location__item planning-location__item--action" data-action="edit">${WindmateCopy.location.editPlace}</button>`,
    ].join('');

    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !menu.classList.contains('hidden');
      menu.classList.toggle('hidden', open);
      trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    menu.querySelectorAll('[data-location-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectActivePlace(btn.dataset.locationId, { manual: true });
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      });
    });
    menu.querySelector('[data-action="add"]')?.addEventListener('click', () => {
      menu.classList.add('hidden');
      openEditor(null);
    });
    menu.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
      menu.classList.add('hidden');
      openEditor(activeLocationId);
    });

    if (!outsideMenuClickBound) {
      outsideMenuClickBound = true;
      document.addEventListener('click', (e) => {
        const host = opts.controlEl;
        if (!host || host.hidden) return;
        const menuEl = host.querySelector('#planning-location-menu');
        const triggerEl = host.querySelector('#planning-location-trigger');
        if (!menuEl || menuEl.classList.contains('hidden')) return;
        if (!host.contains(e.target)) {
          menuEl.classList.add('hidden');
          triggerEl?.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  async function selectActivePlace(id, { manual = false } = {}) {
    if (id === activeLocationId) return;
    if (manual) manualActiveChange = true;
    const updated = await opts.api('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ active_location_id: id }),
    });
    opts.applyFullPreferences(updated);
    const place = activePlace();
    if (place && opts.setPlanningOrigin) {
      opts.setPlanningOrigin(place.lat, place.lng);
    }
    if (manual && place) {
      showToast(WindmateCopy.favorites.switchedPlace(place.nickname));
    }
    if (opts.refreshDashboard) await opts.refreshDashboard({ includeHorizonSummary: true });
  }

  function destroyEditorMap() {
    if (editorMap) {
      editorMap.off('moveend', syncCoordsFromMapCenter);
      editorMap.off('zoomend', syncCoordsFromMapCenter);
      editorMap.remove();
      editorMap = null;
    }
  }

  function writeCoordInputs(lat, lng) {
    const modal = opts.editorModalEl;
    if (!modal) return;
    modal.querySelector('[data-place-lat]').value = Number(lat).toFixed(5);
    modal.querySelector('[data-place-lng]').value = Number(lng).toFixed(5);
  }

  function syncCoordsFromMapCenter() {
    if (suppressMapCenterSync || !editorMap) return;
    const { lat, lng } = editorMap.getCenter();
    writeCoordInputs(lat, lng);
  }

  function openEditor(placeId) {
    const modal = opts.editorModalEl;
    if (!modal) return;
    editingPlaceId = placeId;
    const existing = placeId ? savedLocations.find((p) => p.id === placeId) : null;
    const lat = existing?.lat ?? activeLocation?.lat ?? 45.5017;
    const lng = existing?.lng ?? activeLocation?.lng ?? -73.5673;
    const nickname = existing?.nickname ?? (placeId ? '' : 'Home');

    modal.querySelector('[data-place-nickname]').value = nickname;
    modal.querySelector('[data-place-lat]').value = String(lat);
    modal.querySelector('[data-place-lng]').value = String(lng);
    modal.querySelector('[data-place-editor-title]').textContent = existing
      ? WindmateCopy.location.editPlace
      : WindmateCopy.location.addNewPlace;

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => initEditorMap(lat, lng));
    });

    const saveBtn = modal.querySelector('[data-save-place]');
    const deleteBtn = modal.querySelector('[data-delete-place]');
    deleteBtn.hidden = !existing;
  }

  function closeEditor() {
    opts.editorModalEl?.classList.add('hidden');
    destroyEditorMap();
    editingPlaceId = null;
  }

  const PLACE_EDITOR_MAP_ZOOM = 12;

  function flyEditorMapTo(lat, lng, zoom = PLACE_EDITOR_MAP_ZOOM) {
    if (!editorMap) return;
    suppressMapCenterSync = true;
    editorMap.invalidateSize({ pan: false });
    editorMap.setView([lat, lng], zoom, { animate: false });
    writeCoordInputs(lat, lng);
    suppressMapCenterSync = false;
  }

  function initEditorMap(lat, lng) {
    destroyEditorMap();
    const mapEl = opts.editorModalEl?.querySelector('[data-place-map]');
    if (!mapEl || typeof L === 'undefined') return;
    editorMap = L.map(mapEl, { scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(editorMap);
    editorMap.on('moveend', syncCoordsFromMapCenter);
    editorMap.on('zoomend', syncCoordsFromMapCenter);
    flyEditorMapTo(lat, lng);
    editorMap.whenReady(() => flyEditorMapTo(lat, lng));
    setTimeout(() => flyEditorMapTo(lat, lng), 200);
  }

  async function geocodeSearch(query) {
    const data = await opts.api(`/api/geocode/search?q=${encodeURIComponent(query)}`);
    const place = data?.results?.[0];
    if (place?.lat == null || place?.lng == null) {
      throw new Error('no results');
    }
    flyEditorMapTo(place.lat, place.lng, 14);
  }

  async function useGpsForPin() {
    if (!navigator.geolocation) return;
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
    flyEditorMapTo(pos.coords.latitude, pos.coords.longitude, 14);
  }

  async function saveEditor() {
    const modal = opts.editorModalEl;
    const nickname = modal.querySelector('[data-place-nickname]').value.trim();
    const lat = parseFloat(modal.querySelector('[data-place-lat]').value);
    const lng = parseFloat(modal.querySelector('[data-place-lng]').value);
    if (!nickname) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    let updated;
    if (editingPlaceId) {
      updated = await opts.api(`/api/preferences/locations/${editingPlaceId}`, {
        method: 'PUT',
        body: JSON.stringify({ nickname, lat, lng }),
      });
    } else {
      updated = await opts.api('/api/preferences/locations', {
        method: 'POST',
        body: JSON.stringify({ nickname, lat, lng }),
      });
    }
    opts.applyFullPreferences(updated);
    const place = activePlace();
    if (place && opts.setPlanningOrigin) opts.setPlanningOrigin(place.lat, place.lng);
    closeEditor();
    if (opts.refreshDashboard) await opts.refreshDashboard({ includeHorizonSummary: true });
  }

  async function deleteEditorPlace() {
    if (!editingPlaceId) return;
    const updated = await opts.api(`/api/preferences/locations/${editingPlaceId}`, {
      method: 'DELETE',
    });
    opts.applyFullPreferences(updated);
    const place = activePlace();
    if (place && opts.setPlanningOrigin) opts.setPlanningOrigin(place.lat, place.lng);
    closeEditor();
    if (opts.refreshDashboard) await opts.refreshDashboard({ includeHorizonSummary: true });
  }

  function requestCurrentPositionOnce() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });
    });
  }

  async function tryLaunchGpsSnap() {
    if (launchSnapDone || manualActiveChange || !hasSavedPlaces()) return;
    launchSnapDone = true;
    try {
      const pos = await requestCurrentPositionOnce();
      const accuracy = pos.coords.accuracy ?? Infinity;
      if (accuracy > maxAccuracyM) return;

      const { latitude, longitude } = pos.coords;
      let nearest = null;
      let dNearest = Infinity;
      for (const place of savedLocations) {
        const d = haversineKm(latitude, longitude, place.lat, place.lng);
        if (d < dNearest) {
          dNearest = d;
          nearest = place;
        } else if (d === dNearest && nearest && place.created_at < nearest.created_at) {
          nearest = place;
        }
      }
      if (!nearest || dNearest > autoSelectKm) return;
      if (nearest.id === activeLocationId) return;
      await selectActivePlace(nearest.id, { manual: false });
      showToast(WindmateCopy.location.autoSelectedPlace(nearest.nickname));
    } catch {
      /* no GPS — keep persisted active place */
    }
  }

  function bindEditorModal() {
    const modal = opts.editorModalEl;
    if (!modal) return;
    modal.querySelectorAll('[data-close-place-editor]').forEach((el) => {
      el.addEventListener('click', closeEditor);
    });
    modal.querySelector('[data-save-place]')?.addEventListener('click', () => {
      saveEditor().catch((err) => console.error(err));
    });
    modal.querySelector('[data-delete-place]')?.addEventListener('click', () => {
      deleteEditorPlace().catch((err) => console.error(err));
    });
    modal.querySelector('[data-place-gps]')?.addEventListener('click', () => {
      useGpsForPin().catch(() => showToast(WindmateCopy.geo.unavailablePosition));
    });
    const runPlaceSearch = () => {
      const q = modal.querySelector('[data-place-search]')?.value?.trim();
      if (!q || q.length < 2) return;
      geocodeSearch(q).catch(() => showToast(WindmateCopy.map.locationNotFound));
    };
    modal.querySelector('[data-place-search-btn]')?.addEventListener('click', runPlaceSearch);
    modal.querySelector('[data-place-search]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runPlaceSearch();
      }
    });
    ['[data-place-lat]', '[data-place-lng]'].forEach((sel) => {
      modal.querySelector(sel)?.addEventListener('change', () => {
        const lat = parseFloat(modal.querySelector('[data-place-lat]').value);
        const lng = parseFloat(modal.querySelector('[data-place-lng]').value);
        if (Number.isFinite(lat) && Number.isFinite(lng)) flyEditorMapTo(lat, lng);
      });
    });
    const privacy = modal.querySelector('[data-place-privacy]');
    if (privacy) privacy.textContent = WindmateCopy.location.privacyBlurb;
    const mapHint = modal.querySelector('[data-place-map-hint]');
    if (mapHint) mapHint.textContent = WindmateCopy.location.mapPinHint;
  }

  function init(options) {
    opts = options;
    bindEditorModal();
    const settingsBtn = opts.settingsPlacesBtnEl;
    settingsBtn?.addEventListener('click', () => openEditor(activeLocationId));
  }

  function getActiveCoords() {
    const place = activePlace();
    if (place) return { lat: place.lat, lng: place.lng, nickname: place.nickname };
    return null;
  }

  return {
    init,
    applyFromPreferences,
    tryLaunchGpsSnap,
    hasSavedPlaces,
    getActiveCoords,
    openEditor,
    renderControl,
  };
})();
