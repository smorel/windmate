/** Collapsible spot details drawer: Gemini intel, media strip, lightbox. */
const WindmateSpotIntel = (() => {
  const expanded = new Set();
  const loadedBySpot = new Map();
  /** @type {Map<string, Promise<object>>} */
  const inFlightIntel = new Map();
  let boundSport = null;
  let boundDateKey = null;

  let modalEl = null;
  let modalItems = [];
  let modalIndex = 0;
  let activeSport = 'wingfoiling';
  let getSessionDate = () => null;
  let sourcePopoverEl = null;

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

  function unwrapField(field) {
    if (field == null) return { value: '', provenance: null };
    if (typeof field === 'string' || typeof field === 'number') {
      return { value: String(field), provenance: null };
    }
    if (typeof field === 'object' && 'value' in field) {
      return { value: field.value ?? '', provenance: field.provenance ?? null };
    }
    return { value: '', provenance: null };
  }

  function formatFieldValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
  }

  function buildGoogleFallbackGallery(spotName, _sport) {
    const query = encodeURIComponent(`${spotName} Montreal Quebec`);
    return {
      strip: [],
      google_images_url: `https://www.google.com/search?tbm=isch&q=${query}`,
      google_videos_url: `https://www.google.com/search?tbm=vid&q=${query}`,
    };
  }

  function renderSourceButton(provenance, sectionLabel) {
    const hasProv = provenance && provenance.source_kind !== 'unknown';
    const aria = hasProv
      ? `${WindmateCopy.spotIntel.sourceTitle} — ${sectionLabel}`
      : `${WindmateCopy.spotIntel.sourceMissing} — ${sectionLabel}`;
    const encoded = encodeURIComponent(JSON.stringify(provenance ?? {}));
    return `<button type="button" class="spot-intel-section__source${hasProv ? '' : ' spot-intel-section__source--muted'}" data-intel-source="${encoded}" data-intel-source-title="${escapeHtml(sectionLabel)}" aria-label="${escapeHtml(aria)}">i</button>`;
  }

  function renderSection(title, bodyHtml, provenance) {
    if (!bodyHtml) return '';
    return `
      <section class="spot-intel-section">
        <header class="spot-intel-section__head">
          <h4 class="spot-intel-section__title">${escapeHtml(title)}</h4>
          ${renderSourceButton(provenance, title)}
        </header>
        <div class="spot-intel-section__body">${bodyHtml}</div>
      </section>`;
  }

  function renderIntelSections(intel) {
    if (!intel) {
      return `<p class="spot-intel-sections__loading">${WindmateCopy.spotIntel.intelLoading}</p>`;
    }
    if (intel.enrichment_unavailable) {
      return `<p class="spot-intel-sections__pending">${WindmateCopy.spotIntel.intelUnavailable}</p>`;
    }
    if (intel.enrichment_pending && !intel.profile && !intel.headline) {
      return `<p class="spot-intel-sections__pending">${WindmateCopy.spotIntel.intelPending}</p>`;
    }

    const parts = [];
    const profile = intel.profile ?? {};
    const day = intel.day ?? {};

    const headline = day.headline
      ? unwrapField(day.headline)
      : unwrapField(intel.headline);
    if (headline.value) {
      const level = intel.overall_level;
      const badge =
        level === 'caution' || level === 'closed'
          ? `<span class="spot-intel-level spot-intel-level--${escapeHtml(level)}">${escapeHtml(WindmateCopy.spotIntel.levelBadge(level))}</span>`
          : '';
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.dayHeadline,
          `${badge}<p>${escapeHtml(headline.value)}</p>`,
          headline.provenance
        )
      );
    }

    const launchDepth = unwrapField(profile.launch?.water_depth_description);
    const sportNotes = profile.launch?.sport_notes?.[activeSport];
    const sportNote = unwrapField(sportNotes);
    const launchBody = [launchDepth.value, sportNote.value].filter(Boolean).join(' ');
    if (launchBody) {
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionLaunch,
          `<p>${escapeHtml(launchBody)}</p>`,
          launchDepth.provenance ?? sportNote.provenance
        )
      );
    }

    const access = unwrapField(profile.access_and_hours?.summary);
    if (access.value) {
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionAccess,
          `<p>${escapeHtml(access.value)}</p>`,
          access.provenance
        )
      );
    }

    const parking = unwrapField(profile.parking?.summary);
    if (parking.value) {
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionParking,
          `<p>${escapeHtml(parking.value)}</p>`,
          parking.provenance
        )
      );
    }

    const water = unwrapField(profile.water?.quality_summary);
    const hazards = unwrapField(profile.water?.algae_and_hazards);
    const waterBody = [water.value, hazards.value].filter(Boolean).join(' ');
    if (waterBody) {
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionWater,
          `<p>${escapeHtml(waterBody)}</p>`,
          water.provenance ?? hazards.provenance
        )
      );
    }

    const media = profile.media ?? {};
    const cam = unwrapField(media.webcam_url);
    const windRef = unwrapField(media.wind_reference?.url ?? media.wind_reference);
    const liveParts = [];
    if (cam.value) {
      liveParts.push(
        `<a href="${escapeHtml(cam.value)}" target="_blank" rel="noopener">${WindmateCopy.spotIntel.sourceOpen}</a>`
      );
    }
    if (windRef.value) {
      liveParts.push(
        `<a href="${escapeHtml(windRef.value)}" target="_blank" rel="noopener">${WindmateCopy.spotIntel.sectionWind}</a>`
      );
    }
    if (liveParts.length) {
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionLive,
          liveParts.join(' · '),
          cam.provenance ?? windRef.provenance
        )
      );
    }

    const communityAll = unwrapField(profile.community?.all_time);
    const communityMonth = unwrapField(profile.community?.last_month);
    const communityToday = unwrapField(day.community_today);
    const communityBody = [communityToday.value, communityMonth.value, communityAll.value]
      .filter(Boolean)
      .join(' ');
    if (communityBody) {
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionCommunity,
          `<p>${escapeHtml(communityBody)}</p>`,
          communityToday.provenance ?? communityMonth.provenance ?? communityAll.provenance
        )
      );
    }

    const windNarrative = unwrapField(profile.wind_hints?.narrative);
    const windDirs = unwrapField(profile.wind_hints?.ideal_directions);
    if (windNarrative.value || windDirs.value) {
      const dirLine = windDirs.value ? `<p>${escapeHtml(formatFieldValue(windDirs.value))}</p>` : '';
      parts.push(
        renderSection(
          WindmateCopy.spotIntel.sectionWind,
          `${dirLine}<p>${escapeHtml(windNarrative.value)}</p>`,
          windNarrative.provenance ?? windDirs.provenance
        )
      );
    }

    if (!parts.length) {
      return `<p class="spot-intel-sections__pending">${WindmateCopy.spotIntel.intelPending}</p>`;
    }

    return parts.join('');
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
            class="spot-intel-sections"
            data-spot-intel-sections="${spotId}"
            data-sport="${escapeHtml(sport)}"
            data-spot-name="${escapeHtml(spotName)}"
          >
            ${isOpen ? `<p class="spot-intel-sections__loading">${WindmateCopy.spotIntel.intelLoading}</p>` : ''}
          </div>
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

  function intelCacheKey(spotId, sport, sessionDate) {
    return `${spotId}:${sport}:${sessionDate ?? ''}`;
  }

  function markSectionsLoaded(sectionsEl, intel) {
    if (!sectionsEl || !intel) return;
    if (intel.enrichment_unavailable) {
      delete sectionsEl.dataset.loaded;
      return;
    }
    const hasContent =
      intel.headline ||
      intel.profile ||
      intel.enrichment_pending;
    if (hasContent) {
      sectionsEl.dataset.loaded = '1';
    }
  }

  async function fetchIntel(spotId, sport, spotName, sessionDate) {
    const cacheKey = intelCacheKey(spotId, sport, sessionDate);
    if (loadedBySpot.has(cacheKey)) return loadedBySpot.get(cacheKey);
    const pending = inFlightIntel.get(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      const controller = new AbortController();
      const timeoutMs = parseInt(window.WINDMATE_INTEL_FETCH_TIMEOUT_MS ?? '120000', 10);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const params = new URLSearchParams({ sport, details: '1' });
        if (sessionDate) params.set('date', sessionDate);
        const res = await fetch(`/api/spots/${encodeURIComponent(spotId)}/intel?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const unavailable = res.status === 429 || res.status === 503;
          throw Object.assign(new Error(`intel ${res.status}`), { unavailable });
        }
        const data = await res.json();
        if (!data.enrichment_unavailable) {
          loadedBySpot.set(cacheKey, data);
        }
        return data;
      } catch (err) {
        const quotaLike =
          err?.unavailable ||
          err?.name === 'AbortError' ||
          /intel 429|intel 503/i.test(String(err?.message ?? ''));
        return {
          media_gallery: buildGoogleFallbackGallery(spotName, sport),
          enrichment_pending: !quotaLike,
          enrichment_unavailable: quotaLike,
        };
      } finally {
        clearTimeout(timer);
        inFlightIntel.delete(cacheKey);
      }
    })();

    inFlightIntel.set(cacheKey, promise);
    return promise;
  }

  async function loadIntelPanel(spotId, sport, sectionsEl, sessionDate) {
    if (!sectionsEl) return;
    sectionsEl.innerHTML = `<p class="spot-intel-sections__loading">${WindmateCopy.spotIntel.intelLoading}</p>`;
    const spotName = sectionsEl.dataset.spotName ?? '';
    const intel = await fetchIntel(spotId, sport, spotName, sessionDate);
    sectionsEl.innerHTML = renderIntelSections(intel);
    bindSourceButtons(sectionsEl);
    markSectionsLoaded(sectionsEl, intel);
  }

  async function loadMediaPanel(spotId, sport, panelEl, sessionDate) {
    if (!panelEl) return;
    const spotName = panelEl.dataset.spotName ?? '';
    panelEl.innerHTML = `<p class="spot-intel-media__loading">${WindmateCopy.spotIntel.loading}</p>`;
    const intel = await fetchIntel(spotId, sport, spotName, sessionDate);
    const gallery = normalizeGallery(intel?.media_gallery, spotName, sport);
    panelEl.innerHTML = renderMediaStrip(gallery, sport);
    if (gallery.strip.length) {
      panelEl.dataset.loaded = '1';
    } else {
      delete panelEl.dataset.loaded;
    }
    bindMediaTiles(panelEl, gallery);
  }

  function ensureSourcePopover() {
    if (sourcePopoverEl) return sourcePopoverEl;
    sourcePopoverEl = document.getElementById('spot-intel-source-popover');
    if (!sourcePopoverEl) {
      sourcePopoverEl = document.createElement('div');
      sourcePopoverEl.id = 'spot-intel-source-popover';
      sourcePopoverEl.className = 'spot-intel-source-popover hidden';
      sourcePopoverEl.innerHTML =
        '<div class="spot-intel-source-popover__backdrop" data-close-intel-source></div><div class="spot-intel-source-popover__sheet" role="dialog" aria-modal="true"><button type="button" class="spot-intel-source-popover__close" data-close-intel-source aria-label="Close">×</button><div class="spot-intel-source-popover__content"></div></div>';
      document.body.appendChild(sourcePopoverEl);
      sourcePopoverEl.querySelectorAll('[data-close-intel-source]').forEach((el) => {
        el.addEventListener('click', closeSourcePopover);
      });
    }
    return sourcePopoverEl;
  }

  function renderProvenanceContent(provenance, sectionTitle) {
    if (!provenance || !provenance.source_kind || provenance.source_kind === 'unknown') {
      return `<p>${WindmateCopy.spotIntel.sourceMissing}</p>`;
    }
    const kindLabel =
      WindmateCopy.spotIntel.sourceKind[provenance.source_kind] ?? provenance.source_kind;
    let html = `<h3 class="spot-intel-source-popover__title">${escapeHtml(sectionTitle)}</h3>`;
    if (provenance.confidence === 'low') {
      html += `<p class="spot-intel-source-popover__warn">${WindmateCopy.spotIntel.sourceUnverified}</p>`;
    }
    if (provenance.derivation?.summary) {
      html += `<p class="spot-intel-source-popover__how"><strong>${WindmateCopy.spotIntel.sourceHowWeKnow}</strong> ${escapeHtml(provenance.derivation.summary)}</p>`;
      if (Array.isArray(provenance.derivation.steps)) {
        html += '<ul class="spot-intel-source-popover__steps">';
        for (const step of provenance.derivation.steps) {
          const detail = step.detail ? `<span class="spot-intel-source-popover__step-detail">${escapeHtml(step.detail)}</span>` : '';
          if (step.url) {
            html += `<li><a href="${escapeHtml(step.url)}" target="_blank" rel="noopener">${escapeHtml(step.label ?? step.url)}</a>${detail}</li>`;
          } else {
            html += `<li>${escapeHtml(step.label ?? '')}${detail}</li>`;
          }
        }
        html += '</ul>';
      }
    }
    if (provenance.source_label || provenance.source_url) {
      const label = escapeHtml(provenance.source_label ?? provenance.source_url);
      if (provenance.source_url) {
        html += `<p><a href="${escapeHtml(provenance.source_url)}" target="_blank" rel="noopener">${label}</a></p>`;
      } else {
        html += `<p>${label}</p>`;
      }
    }
    if (Array.isArray(provenance.citations)) {
      for (const c of provenance.citations) {
        if (!c.url) continue;
        html += `<p><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.title ?? c.url)}</a></p>`;
      }
    }
    html += `<p class="spot-intel-source-popover__meta">${escapeHtml(kindLabel)}</p>`;
    return html;
  }

  function openSourcePopover(provenance, sectionTitle) {
    const el = ensureSourcePopover();
    const content = el.querySelector('.spot-intel-source-popover__content');
    if (content) content.innerHTML = renderProvenanceContent(provenance, sectionTitle);
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeSourcePopover() {
    if (!sourcePopoverEl) return;
    sourcePopoverEl.classList.add('hidden');
    if (!document.querySelector('.settings-modal:not(.hidden)')) {
      document.body.classList.remove('modal-open');
    }
  }

  function bindSourceButtons(container) {
    container.querySelectorAll('[data-intel-source]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        let provenance = {};
        try {
          provenance = JSON.parse(decodeURIComponent(btn.getAttribute('data-intel-source') ?? '%7B%7D'));
        } catch {
          provenance = {};
        }
        openSourcePopover(provenance, btn.dataset.intelSourceTitle ?? WindmateCopy.spotIntel.sourceTitle);
      });
    });
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

  function hydrateIntelPanels(root, sport, sessionDate) {
    root.querySelectorAll('[data-spot-intel-sections]').forEach((panel) => {
      const spotId = panel.dataset.spotIntelSections;
      if (!spotId || !expanded.has(spotId)) return;
      const panelSport = panel.dataset.sport || sport || activeSport;
      const cached = loadedBySpot.get(intelCacheKey(spotId, panelSport, sessionDate));
      if (!cached) return;
      panel.innerHTML = renderIntelSections(cached);
      bindSourceButtons(panel);
      markSectionsLoaded(panel, cached);
    });

    root.querySelectorAll('[data-spot-intel-media]').forEach((panel) => {
      const spotId = panel.dataset.spotIntelMedia;
      if (!spotId || !expanded.has(spotId)) return;
      const panelSport = panel.dataset.sport || sport || activeSport;
      const cached = loadedBySpot.get(intelCacheKey(spotId, panelSport, sessionDate));
      if (!cached) return;
      const spotName = panel.dataset.spotName ?? '';
      const gallery = normalizeGallery(cached?.media_gallery, spotName, panelSport);
      panel.innerHTML = renderMediaStrip(gallery, panelSport);
      if (gallery.strip.length) {
        panel.dataset.loaded = '1';
      } else {
        delete panel.dataset.loaded;
      }
      bindMediaTiles(panel, gallery);
    });
  }

  function bindDrawers(root, sport, sessionDateFn) {
    activeSport = sport ?? activeSport;
    if (typeof sessionDateFn === 'function') {
      getSessionDate = sessionDateFn;
    }
    const sessionDate = getSessionDate?.() ?? null;
    const dateKey = sessionDate ?? '';
    if (boundSport !== sport || boundDateKey !== dateKey) {
      clearCache();
      boundSport = sport;
      boundDateKey = dateKey;
    }
    ensureModal();
    ensureSourcePopover();

    root.querySelectorAll('[data-spot-intel-toggle]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const spotId = btn.dataset.spotIntelToggle;
        const drawer = btn.closest('[data-spot-intel]');
        const panel = drawer?.querySelector(`[data-spot-intel-panel="${spotId}"]`);
        const sectionsPanel = drawer?.querySelector(`[data-spot-intel-sections="${spotId}"]`);
        const mediaPanel = drawer?.querySelector(`[data-spot-intel-media="${spotId}"]`);
        const chevron = btn.querySelector('.spot-intel-drawer__chevron');
        const sessionDate = getSessionDate?.() ?? null;

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

        const panelSport = mediaPanel?.dataset.sport || sectionsPanel?.dataset.sport || activeSport;
        if (sectionsPanel && sectionsPanel.dataset.loaded !== '1') {
          await loadIntelPanel(spotId, panelSport, sectionsPanel, sessionDate);
        }
        if (mediaPanel && mediaPanel.dataset.loaded !== '1') {
          await loadMediaPanel(spotId, panelSport, mediaPanel, sessionDate);
        }
      });
    });

    hydrateIntelPanels(root, sport, sessionDate);

    root.querySelectorAll('[data-spot-intel-sections]').forEach((panel) => {
      const spotId = panel.dataset.spotIntelSections;
      if (!spotId || !expanded.has(spotId) || panel.dataset.loaded === '1') return;
      const panelSport = panel.dataset.sport || activeSport;
      loadIntelPanel(spotId, panelSport, panel, getSessionDate?.() ?? null);
    });

    root.querySelectorAll('[data-spot-intel-media]').forEach((panel) => {
      const spotId = panel.dataset.spotIntelMedia;
      if (!spotId || !expanded.has(spotId) || panel.dataset.loaded === '1') return;
      const panelSport = panel.dataset.sport || activeSport;
      loadMediaPanel(spotId, panelSport, panel, getSessionDate?.() ?? null);
    });
  }

  function clearCache() {
    loadedBySpot.clear();
    inFlightIntel.clear();
  }

  function init() {
    ensureModal();
    ensureSourcePopover();
  }

  return { init, renderDrawer, bindDrawers, clearCache, closeMediaModal, closeSourcePopover };
})();
