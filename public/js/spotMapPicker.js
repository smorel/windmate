/** Inline Leaflet map for discovering, favoriting, and creating spots. */
const WindmateSpotMapPicker = (() => {
  const MONTREAL = { lat: 45.5017, lng: -73.5673 };
  const BBOX_DEBOUNCE_MS = 300;
  let map = null;
  let markersLayer = null;
  let homeLayer = null;
  let userLocationMarker = null;
  let radiusCircle = null;
  let tempMarker = null;
  let bboxTimer = null;
  let bboxRequestId = 0;
  let open = false;
  let pendingCreate = null;
  let opts = {};
  let els = {};

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status, data });
    }
    return data;
  }

  function showToast(message) {
    if (opts.showToast) {
      opts.showToast(message);
      return;
    }
    let el = document.getElementById('windmate-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'windmate-toast';
      el.className = 'windmate-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('windmate-toast--visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('windmate-toast--visible'), 3000);
  }

  function setHint(text, tone = '') {
    if (!els.hint) return;
    els.hint.textContent = text;
    els.hint.classList.remove('spot-map-panel__hint--warn', 'spot-map-panel__hint--error');
    if (tone === 'warn') els.hint.classList.add('spot-map-panel__hint--warn');
    if (tone === 'error') els.hint.classList.add('spot-map-panel__hint--error');
  }

  function updateToggleUi() {
    if (!els.toggle) return;
    els.toggle.textContent = WindmateCopy.map.label;
    els.toggle.setAttribute(
      'aria-label',
      open ? WindmateCopy.map.closeAria : WindmateCopy.map.openAria
    );
    els.toggle.classList.toggle('spot-map-toggle--open', open);
    els.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (els.panel) {
      els.panel.classList.toggle('hidden', !open);
      els.panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
  }

  function buildUserLocationIcon() {
    if (typeof L === 'undefined') return null;
    return L.divIcon({
      className: 'spot-map-user-location',
      html: '<span class="spot-map-user-location__dot"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function resolveHomeCenter() {
    const home = opts.getHome?.();
    if (home?.lat != null && home?.lng != null) {
      return { lat: home.lat, lng: home.lng };
    }
    return null;
  }

  function getRadiusMeters() {
    const km = opts.getRadiusKm?.();
    const n = Number(km);
    if (!Number.isFinite(n) || n <= 0) return 80_000;
    return n * 1000;
  }

  /** Bounds that contain the search-radius circle (no map projection required). */
  function boundsForHomeRadius(lat, lng, radiusM) {
    return L.latLng(lat, lng).toBounds(radiusM).pad(0.08);
  }

  function updateHomeOverlay({ refit = false } = {}) {
    if (!map || !homeLayer || typeof L === 'undefined') return;

    const center = resolveHomeCenter();
    if (!center) {
      if (userLocationMarker) {
        homeLayer.removeLayer(userLocationMarker);
        userLocationMarker = null;
      }
      if (radiusCircle) {
        homeLayer.removeLayer(radiusCircle);
        radiusCircle = null;
      }
      return;
    }

    const latLng = [center.lat, center.lng];
    const radiusM = getRadiusMeters();

    if (!radiusCircle) {
      radiusCircle = L.circle(latLng, {
        radius: radiusM,
        color: '#3b82f6',
        weight: 2,
        opacity: 0.65,
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        interactive: false,
      });
      homeLayer.addLayer(radiusCircle);
    } else {
      radiusCircle.setLatLng(latLng);
      radiusCircle.setRadius(radiusM);
    }

    if (!userLocationMarker) {
      userLocationMarker = L.marker(latLng, {
        icon: buildUserLocationIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 500,
      });
      homeLayer.addLayer(userLocationMarker);
    } else {
      userLocationMarker.setLatLng(latLng);
    }

    if (refit) {
      map.fitBounds(boundsForHomeRadius(center.lat, center.lng, radiusM));
    }
  }

  function buildMarkerIcon(isFavorite) {
    if (typeof L === 'undefined') return null;
    return L.divIcon({
      className: isFavorite ? 'spot-map-marker spot-map-marker--favorite' : 'spot-map-marker',
      html: isFavorite ? '★' : '',
      iconSize: isFavorite ? [24, 24] : [20, 20],
      iconAnchor: isFavorite ? [12, 12] : [10, 10],
    });
  }

  function renderMarkers(spots) {
    if (!markersLayer || typeof L === 'undefined') return;
    markersLayer.clearLayers();
    const favSet = new Set(opts.getFavoriteIds?.() ?? []);

    for (const spot of spots) {
      const isFavorite = spot.is_favorite || favSet.has(spot.id);
      const marker = L.marker([spot.latitude, spot.longitude], {
        icon: buildMarkerIcon(isFavorite),
        interactive: !isFavorite,
      });
      marker.bindTooltip(spot.name, {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.95,
      });
      if (!isFavorite) {
        marker.on('click', () => {
          if (opts.onFavorite) opts.onFavorite(spot);
        });
      }
      markersLayer.addLayer(marker);
    }
  }

  async function refreshMarkers() {
    if (!map || !open) return;
    const bounds = map.getBounds();
    const requestId = ++bboxRequestId;
    try {
      const sport = opts.getActiveSport?.() ?? '';
      const data = await api(
        `/api/spots/bbox?north=${bounds.getNorth()}&south=${bounds.getSouth()}&east=${bounds.getEast()}&west=${bounds.getWest()}&sport=${encodeURIComponent(sport)}`
      );
      if (requestId !== bboxRequestId || !open) return;
      renderMarkers(data.spots ?? []);
      if (els.hint?.classList.contains('spot-map-panel__hint--error')) {
        setHint(WindmateCopy.map.hint);
      }
    } catch {
      if (requestId !== bboxRequestId || !open) return;
      setHint(WindmateCopy.map.hintError, 'error');
    }
  }

  function scheduleBboxFetch() {
    clearTimeout(bboxTimer);
    bboxTimer = setTimeout(() => refreshMarkers(), BBOX_DEBOUNCE_MS);
  }

  function cancelBboxFetch() {
    clearTimeout(bboxTimer);
    bboxRequestId += 1;
  }

  function initMap() {
    if (map || typeof L === 'undefined' || !els.container) return false;

    map = L.map(els.container, {
      doubleClickZoom: false,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    homeLayer = L.layerGroup().addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    map.on('moveend', scheduleBboxFetch);
    map.on('dblclick', onMapDblClick);

    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return true;
  }

  function destroyMap() {
    cancelBboxFetch();
    clearTempMarker();
    if (map) {
      map.remove();
      map = null;
      markersLayer = null;
      homeLayer = null;
      userLocationMarker = null;
      radiusCircle = null;
    }
  }

  async function setInitialView() {
    if (!map) return;
    updateHomeOverlay({ refit: true });
  }

  function clearTempMarker() {
    if (tempMarker && markersLayer) {
      markersLayer.removeLayer(tempMarker);
      tempMarker = null;
    }
  }

  function hideCreateModal() {
    els.createModal?.classList.add('hidden');
    pendingCreate = null;
    if (els.duplicate) {
      els.duplicate.classList.add('hidden');
      els.duplicate.innerHTML = '';
    }
  }

  function dismissCreateDialog() {
    hideCreateModal();
    clearTempMarker();
  }

  function showDuplicateOffer(spot) {
    if (!els.duplicate) return;
    els.duplicate.classList.remove('hidden');
    els.duplicate.innerHTML = `
      <p>${WindmateCopy.map.duplicate(spot.name)}</p>
      <button type="button" data-favorite-spot-id="${spot.id}">${WindmateCopy.map.favoriteInstead}</button>
    `;
    els.duplicate.querySelector('button')?.addEventListener('click', () => {
      hideCreateModal();
      clearTempMarker();
      if (opts.onFavorite) {
        opts.onFavorite({
          id: spot.id,
          name: spot.name,
          latitude: spot.latitude,
          longitude: spot.longitude,
        });
      }
    });
  }

  async function openCreateDialog(lat, lng) {
    pendingCreate = { lat, lng };
    clearTempMarker();

    if (markersLayer && typeof L !== 'undefined') {
      tempMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'spot-map-marker',
          html: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      });
      markersLayer.addLayer(tempMarker);
    }

    if (els.createLat) els.createLat.value = lat.toFixed(5);
    if (els.createLng) els.createLng.value = lng.toFixed(5);
    if (els.createName) els.createName.value = '';
    if (els.duplicate) {
      els.duplicate.classList.add('hidden');
      els.duplicate.innerHTML = '';
    }

    els.createModal?.classList.remove('hidden');
    els.createName?.focus();

    try {
      const geo = await api(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      if (pendingCreate && els.createName && !els.createName.value) {
        els.createName.value = geo.name ?? '';
      }
    } catch {
      /* user can type a name */
    }
  }

  function onMapDblClick(e) {
    if (!open) return;
    openCreateDialog(e.latlng.lat, e.latlng.lng);
  }

  async function saveCreateSpot() {
    if (!pendingCreate) return;
    const name = els.createName?.value.trim() ?? '';
    if (!name) {
      els.createName?.focus();
      return;
    }

    const sport = opts.getActiveSport?.() ?? '';
    try {
      const created = await api('/api/spots', {
        method: 'POST',
        body: JSON.stringify({
          name,
          latitude: pendingCreate.lat,
          longitude: pendingCreate.lng,
          sport,
        }),
      });
      hideCreateModal();
      clearTempMarker();
      if (opts.onCreated) await opts.onCreated(created);
      showToast(WindmateCopy.map.created(name));
      await refreshMarkers();
    } catch (err) {
      if (err.status === 409 && err.data?.spot) {
        showDuplicateOffer(err.data.spot);
        return;
      }
      showToast(err.message ?? WindmateCopy.errors.loadFailed('save failed'));
    }
  }

  async function openPanel() {
    if (open) return;
    if (typeof L === 'undefined') {
      if (els.toggle) els.toggle.disabled = true;
      return;
    }

    open = true;
    updateToggleUi();
    setHint(WindmateCopy.map.hint);

    if (!initMap()) return;

    requestAnimationFrame(() => {
      map?.invalidateSize();
      setInitialView();
      refreshMarkers();
    });
  }

  function closePanel() {
    if (!open) return;
    open = false;
    dismissCreateDialog();
    destroyMap();
    updateToggleUi();
  }

  function toggle() {
    if (open) closePanel();
    else openPanel();
  }

  function flyTo(lat, lng, zoom = 14) {
    if (!map) return;
    map.flyTo([lat, lng], zoom, { duration: 0.8 });
  }

  function fitSpots(spots, maxZoom = 13) {
    if (!map || !spots?.length) return;
    const bounds = L.latLngBounds(spots.map((s) => [s.latitude, s.longitude]));
    map.fitBounds(bounds.pad(0.12), { maxZoom });
  }

  async function handleSearchEnter(query) {
    if (!open || !map) return;
    const q = String(query ?? '').trim();
    if (q.length < 2) return;

    const sport = opts.getActiveSport?.() ?? '';
    const home = opts.getHome?.() ?? MONTREAL;

    try {
      const search = await api(
        `/api/spots/search?q=${encodeURIComponent(q)}&lat=${home.lat}&lng=${home.lng}&limit=15&sport=${encodeURIComponent(sport)}`
      );
      const spots = search.spots ?? [];
      if (spots.length > 0) {
        fitSpots(spots, 13);
        setHint(WindmateCopy.map.hint);
        scheduleBboxFetch();
        return;
      }

      const geo = await api(`/api/geocode/search?q=${encodeURIComponent(q)}`);
      const results = geo.results ?? [];
      if (!results.length) {
        showToast(WindmateCopy.map.locationNotFound);
        return;
      }

      const place = results[0];
      flyTo(place.lat, place.lng, 12);
      setHint(WindmateCopy.map.hintNoSpots, 'warn');
      scheduleBboxFetch();
    } catch {
      showToast(WindmateCopy.map.locationNotFound);
    }
  }

  function focusSpot(spot) {
    if (!spot) return;
    flyTo(spot.latitude, spot.longitude, 14);
    scheduleBboxFetch();
  }

  function init(options = {}) {
    opts = options;
    els = {
      panel: document.getElementById('spot-map-panel'),
      container: document.getElementById('spot-map-container'),
      toggle: document.getElementById('spot-map-toggle'),
      close: document.getElementById('spot-map-close'),
      hint: document.getElementById('spot-map-hint'),
      createModal: document.getElementById('spot-create-modal'),
      createName: document.getElementById('spot-create-name'),
      createLat: document.getElementById('spot-create-lat'),
      createLng: document.getElementById('spot-create-lng'),
      duplicate: document.getElementById('spot-create-duplicate'),
      createSave: document.getElementById('spot-create-save'),
      createCancel: document.getElementById('spot-create-cancel'),
    };

    if (els.hint) els.hint.textContent = WindmateCopy.map.hint;

    if (typeof L === 'undefined' && els.toggle) {
      els.toggle.disabled = true;
    }

    els.toggle?.addEventListener('click', toggle);
    els.close?.addEventListener('click', closePanel);

    els.createSave?.addEventListener('click', () => saveCreateSpot());
    els.createCancel?.addEventListener('click', dismissCreateDialog);
    document.querySelectorAll('[data-close-spot-create]').forEach((el) => {
      el.addEventListener('click', dismissCreateDialog);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (els.createModal && !els.createModal.classList.contains('hidden')) {
        dismissCreateDialog();
        return;
      }
      if (open) closePanel();
    });
  }

  return {
    init,
    open: openPanel,
    close: closePanel,
    toggle,
    isOpen: () => open,
    flyTo,
    fitBounds: fitSpots,
    refreshMarkers,
    updateHomeOverlay,
    focusSpot,
    handleSearchEnter,
    showToast,
  };
})();
