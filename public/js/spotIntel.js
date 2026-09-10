/** Collapsible local intel drawer + spot photo/video strip and lightbox on matrix cards. */
const WindmateSpotIntel = (() => {
  const expanded = new Set();
  const loadedBySpot = new Map();
  const loadingSpots = new Set();

  let modalEl = null;
  let modalItems = [];
  let modalIndex = 0;
  let activeSport = 'wingfoiling';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sportLabel(sport) {
    return WindmateCopy.spotIntel.sportLabel(sport);
  }

  function buildGoogleFallbackGallery(spotName, _sport) {
    const query = encodeURIComponent(`${spotName} Montreal Quebec`);
    return {
      strip: [],
      google_images_url: `https://www.google.com/search?tbm=isch&q=${query}`,
      google_videos_url: `https://www.google.com/search?tbm=vid&q=${query}`,
    };
  }

  function renderDrawer(spotId, sport, spotName) {
    const isOpen = expanded.has(spotId);
    return `
      <div class="spot-intel-drawer" data-spot-intel="${spotId}">
        <button
          type="button"
          class="spot-intel-drawer__toggle"
          data-spot-intel-toggle="${spotId}"
          aria-expanded="${isOpen ? 'true' : 'false'}"
        >
          <span class="spot-intel-drawer__toggle-label">${WindmateCopy.spotIntel.drawerTitle}</span>
          <span class="spot-intel-drawer__chevron" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
        </button>
        <div class="spot-intel-drawer__panel ${isOpen ? '' : 'hidden'}" data-spot-intel-panel="${spotId}">
          <div
            class="spot-intel-media"
            data-spot-intel-media="${spotId}"
            data-sport="${escapeHtml(sport)}"
            data-spot-name="${escapeHtml(spotName)}"
          >
            ${
              isOpen
                ? `<p class="spot-intel-media__loading">${WindmateCopy.spotIntel.loading}</p>`
                : ''
            }
          </div>
        </div>
      </div>`;
  }

  function renderGoogleLinks(googleImages, googleVideos) {
    if (!googleImages && !googleVideos) return '';
    const links = [
      googleImages
        ? `<a href="${escapeHtml(googleImages)}" target="_blank" rel="noopener" class="spot-intel-media__link">${WindmateCopy.spotIntel.searchImages}</a>`
        : '',
      googleVideos
        ? `<a href="${escapeHtml(googleVideos)}" target="_blank" rel="noopener" class="spot-intel-media__link">${WindmateCopy.spotIntel.searchVideos}</a>`
        : '',
    ]
      .filter(Boolean)
      .join('');
    return `<div class="spot-intel-media__links">${links}</div>`;
  }

  function renderMediaStrip(gallery, sport) {
    const strip = gallery?.strip ?? [];
    const googleImages = gallery?.google_images_url;
    const googleVideos = gallery?.google_videos_url;
    const googleLinks = renderGoogleLinks(googleImages, googleVideos);

    if (!strip.length) {
      return `
        <div class="spot-intel-media__empty">
          <p class="spot-intel-media__empty-copy">${WindmateCopy.spotIntel.empty}</p>
          ${googleLinks}
        </div>`;
    }

    const tiles = strip
      .map(
        (item, index) => `
        <button
          type="button"
          class="spot-intel-media__tile ${item.type === 'video' ? 'spot-intel-media__tile--video' : ''}"
          data-media-index="${index}"
          aria-label="${escapeHtml(item.title ?? WindmateCopy.spotIntel.openMedia)}"
        >
          <img
            src="${escapeHtml(item.thumbnail_url)}"
            alt=""
            loading="lazy"
            class="spot-intel-media__thumb"
          />
          ${
            item.type === 'video'
              ? `<span class="spot-intel-media__play" aria-hidden="true">▶</span>${
                  item.duration
                    ? `<span class="spot-intel-media__duration">${escapeHtml(item.duration)}</span>`
                    : ''
                }`
              : ''
          }
        </button>`
      )
      .join('');

    return `
      <div class="spot-intel-media__header">
        <span class="spot-intel-media__title">${WindmateCopy.spotIntel.mediaTitle}</span>
        <span class="spot-intel-media__sport">${sportLabel(sport)}</span>
      </div>
      <div class="spot-intel-media__strip" role="list">${tiles}</div>
      <div class="spot-intel-media__footer">
        <p class="spot-intel-media__google-hint">${WindmateCopy.spotIntel.morePhotosHint}</p>
        ${googleLinks}
      </div>`;
  }

  function normalizeGallery(gallery, spotName, sport) {
    const fallback = buildGoogleFallbackGallery(spotName, sport);
    let strip = gallery?.strip;
    if (!strip?.length && gallery) {
      strip = [...(gallery.images ?? []), ...(gallery.videos ?? [])];
    }
    return {
      strip: strip ?? [],
      google_images_url: gallery?.google_images_url ?? fallback.google_images_url,
      google_videos_url: gallery?.google_videos_url ?? fallback.google_videos_url,
    };
  }

  async function fetchIntel(spotId, sport, spotName) {
    const cacheKey = `${spotId}:${sport}`;
    if (loadedBySpot.has(cacheKey)) return loadedBySpot.get(cacheKey);
    if (loadingSpots.has(cacheKey)) return null;

    loadingSpots.add(cacheKey);
    try {
      const res = await fetch(
        `/api/spots/${encodeURIComponent(spotId)}/intel?sport=${encodeURIComponent(sport)}`
      );
      if (!res.ok) throw new Error(`intel ${res.status}`);
      const data = await res.json();
      const gallery = normalizeGallery(data?.media_gallery, spotName, sport);
      if (gallery.strip.length) {
        loadedBySpot.set(cacheKey, data);
      }
      return data;
    } catch {
      return { media_gallery: buildGoogleFallbackGallery(spotName, sport) };
    } finally {
      loadingSpots.delete(cacheKey);
    }
  }

  async function loadMediaPanel(spotId, sport, panelEl) {
    if (!panelEl) return;
    const spotName = panelEl.dataset.spotName ?? '';
    panelEl.innerHTML = `<p class="spot-intel-media__loading">${WindmateCopy.spotIntel.loading}</p>`;
    const intel = await fetchIntel(spotId, sport, spotName);
    const gallery = normalizeGallery(intel?.media_gallery, spotName, sport);
    panelEl.innerHTML = renderMediaStrip(gallery, sport);
    if (gallery.strip.length) {
      panelEl.dataset.loaded = '1';
    } else {
      delete panelEl.dataset.loaded;
    }
    bindMediaTiles(panelEl, gallery);
  }

  function bindMediaTiles(container, gallery) {
    const strip = gallery?.strip ?? [];
    container.querySelectorAll('[data-media-index]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.mediaIndex, 10);
        if (Number.isNaN(index)) return;
        openMediaModal(strip, index);
      });
    });
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.getElementById('spot-media-modal');
    if (!modalEl) return null;

    modalEl.querySelectorAll('[data-close-media-modal]').forEach((el) => {
      el.addEventListener('click', closeMediaModal);
    });
    modalEl.querySelector('[data-media-prev]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      stepMediaModal(-1);
    });
    modalEl.querySelector('[data-media-next]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      stepMediaModal(1);
    });

    document.addEventListener('keydown', onModalKeydown);
    return modalEl;
  }

  function onModalKeydown(e) {
    if (!modalEl || modalEl.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepMediaModal(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepMediaModal(1);
    }
  }

  function renderModalStage(item) {
    const stage = modalEl?.querySelector('[data-media-stage]');
    const caption = modalEl?.querySelector('[data-media-caption]');
    const sourceLink = modalEl?.querySelector('[data-media-source]');
    if (!stage || !item) return;

    const title = escapeHtml(item.title ?? '');
    const sourceUrl = escapeHtml(item.source_url ?? '');

    if (item.type === 'video' && item.media_url) {
      stage.innerHTML = `<video class="spot-media-modal__video" src="${escapeHtml(item.media_url)}" controls autoplay poster="${escapeHtml(item.thumbnail_url)}"></video>`;
    } else {
      stage.innerHTML = `<img class="spot-media-modal__image" src="${escapeHtml(item.thumbnail_url)}" alt="${title}" />`;
    }

    if (caption) {
      caption.textContent = item.title ?? '';
    }
    if (sourceLink) {
      if (sourceUrl) {
        sourceLink.href = sourceUrl;
        sourceLink.classList.remove('hidden');
        sourceLink.textContent = item.type === 'video'
          ? WindmateCopy.spotIntel.openVideoSource
          : WindmateCopy.spotIntel.openImageSource;
      } else {
        sourceLink.classList.add('hidden');
      }
    }

    const counter = modalEl?.querySelector('[data-media-counter]');
    if (counter) {
      counter.textContent = WindmateCopy.spotIntel.counter(modalIndex + 1, modalItems.length);
    }

    const prevBtn = modalEl?.querySelector('[data-media-prev]');
    const nextBtn = modalEl?.querySelector('[data-media-next]');
    if (prevBtn) prevBtn.disabled = modalIndex <= 0;
    if (nextBtn) nextBtn.disabled = modalIndex >= modalItems.length - 1;
  }

  function openMediaModal(items, index) {
    if (!items?.length) return;
    ensureModal();
    if (!modalEl) return;

    modalItems = items;
    modalIndex = Math.max(0, Math.min(index, items.length - 1));
    modalEl.classList.remove('hidden');
    document.body.classList.add('modal-open');
    renderModalStage(modalItems[modalIndex]);
  }

  function closeMediaModal() {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    const stage = modalEl.querySelector('[data-media-stage]');
    if (stage) stage.innerHTML = '';
    if (!document.querySelector('.settings-modal:not(.hidden)')) {
      document.body.classList.remove('modal-open');
    }
  }

  function stepMediaModal(delta) {
    if (!modalItems.length) return;
    const next = modalIndex + delta;
    if (next < 0 || next >= modalItems.length) return;
    modalIndex = next;
    renderModalStage(modalItems[modalIndex]);
  }

  function bindDrawers(root, sport) {
    activeSport = sport ?? activeSport;
    clearCache();
    ensureModal();

    root.querySelectorAll('[data-spot-intel-toggle]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const spotId = btn.dataset.spotIntelToggle;
        const drawer = btn.closest('[data-spot-intel]');
        const panel = drawer?.querySelector(`[data-spot-intel-panel="${spotId}"]`);
        const mediaPanel = drawer?.querySelector(`[data-spot-intel-media="${spotId}"]`);
        const chevron = btn.querySelector('.spot-intel-drawer__chevron');

        if (expanded.has(spotId)) {
          expanded.delete(spotId);
          btn.setAttribute('aria-expanded', 'false');
          panel?.classList.add('hidden');
          if (chevron) chevron.textContent = '▸';
          return;
        }

        expanded.add(spotId);
        btn.setAttribute('aria-expanded', 'true');
        panel?.classList.remove('hidden');
        if (chevron) chevron.textContent = '▾';

        if (mediaPanel && mediaPanel.dataset.loaded !== '1') {
          const panelSport = mediaPanel.dataset.sport || activeSport;
          await loadMediaPanel(spotId, panelSport, mediaPanel);
        }
      });
    });

    root.querySelectorAll('[data-spot-intel-media]').forEach((panel) => {
      const spotId = panel.dataset.spotIntelMedia;
      if (!spotId || !expanded.has(spotId) || panel.dataset.loaded === '1') return;
      const panelSport = panel.dataset.sport || activeSport;
      loadMediaPanel(spotId, panelSport, panel);
    });
  }

  function clearCache() {
    loadedBySpot.clear();
  }

  function init() {
    ensureModal();
  }

  return { init, renderDrawer, bindDrawers, clearCache, closeMediaModal };
})();
