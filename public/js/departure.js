/** Departure planner — leave-by times on spot cards */
const WindmateDeparture = (() => {
  const SESSION_DAY_REFRESH_MS = 10 * 60 * 1000;
  let sessionDayRefreshTimer = null;
  let sessionDayRefreshHandler = null;
  let matrixDepartureGeneration = 0;
  let watchDepartureGeneration = 0;
  let watchDepartureInFlight = null;
  const plannerPlanByKey = new Map();
  const plannerMapsContextByKey = new Map();

  function plannerPlanCacheKey(spotId, dateStr) {
    return `${spotId}|${dateStr}`;
  }

  function rememberPlannerPlan(spotId, dateStr, plan, mapsContext) {
    if (!spotId || !dateStr) return;
    const key = plannerPlanCacheKey(spotId, dateStr);
    if (plan?.onWaterStart && plan?.onWaterEnd) {
      plannerPlanByKey.set(key, plan);
      const origin = mapsContext?.origin;
      const destination = mapsContext?.destination ?? plan.destination;
      if (origin && destination) {
        plannerMapsContextByKey.set(key, { origin, destination });
      }
    } else {
      plannerPlanByKey.delete(key);
      plannerMapsContextByKey.delete(key);
    }
  }

  function plannerMapsContext(spotId, dateStr) {
    return plannerMapsContextByKey.get(plannerPlanCacheKey(spotId, dateStr)) ?? null;
  }

  function cachedPlannerRange(spotId, dateStr) {
    const plan = plannerPlanByKey.get(plannerPlanCacheKey(spotId, dateStr));
    if (!plan?.onWaterStart || !plan?.onWaterEnd) return null;
    return {
      start: hourTimeKey(plan.onWaterStart),
      endExclusive: hourTimeKey(plan.onWaterEnd),
    };
  }

  function cachedPlannerPlan(spotId, dateStr) {
    return plannerPlanByKey.get(plannerPlanCacheKey(spotId, dateStr)) ?? null;
  }

  function samePlannerPlan(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.onWaterStart === b.onWaterStart &&
      a.onWaterEnd === b.onWaterEnd &&
      a.leaveBy === b.leaveBy &&
      a.driveMinutes === b.driveMinutes
    );
  }

  function minRideableHoursForWatchSession(session, curveSyncContext) {
    const prefs = curveSyncContext?.prefsForSession?.(session) ?? curveSyncContext?.prefs;
    return prefs?.min_rideable_window_hours;
  }

  function applyWatchDepartureToCard(
    card,
    session,
    data,
    verdictForSession,
    curveSyncContext,
    { refreshCurve = true } = {}
  ) {
    if (!card || !session || !data) return false;
    const key = watchDepartureKey(session.id);
    const slot = card.querySelector(`[data-departure-for="${key}"]`);
    if (!slot) return false;

    const plan = data.plan ?? null;
    const prevPlan = cachedPlannerPlan(session.spot_id, session.session_date);
    const verdict = verdictForSession?.(session);
    const minHours = minRideableHoursForWatchSession(session, curveSyncContext);
    const unchanged = samePlannerPlan(prevPlan, plan) && slot.querySelector('.departure-line');
    const mapsCtx =
      data.origin && (data.destination ?? plan?.destination)
        ? { origin: data.origin, destination: data.destination ?? plan.destination }
        : plannerMapsContext(session.spot_id, session.session_date);
    const lineData = { ...data, ...mapsCtx, plan };

    if (!plan || data.status === 'no_window') {
      rememberPlannerPlan(session.spot_id, session.session_date, plan, mapsCtx);
      if (!unchanged) slot.innerHTML = renderLine(lineData, verdict, minHours);
      return false;
    }

    rememberPlannerPlan(session.spot_id, session.session_date, plan, mapsCtx);

    if (!unchanged) {
      slot.innerHTML = renderLine(lineData, verdict, minHours);
      card.querySelector(`[data-departure-group="${key}"]`)?.classList.add('has-departure-line');
      if (refreshCurve && curveSyncContext) {
        const obsEntry = curveSyncContext.obsBySpot?.get(session.spot_id);
        const prefs = curveSyncContext.prefsForSession?.(session) ?? curveSyncContext.prefs;
        WindmateObservations.refreshPlannerBandOnCard(card, plan, obsEntry, prefs, {
          warnings: curveSyncContext.warningsBySpot?.get(session.spot_id),
          rideEntry: curveSyncContext.rideEntryBySpot?.get(session.spot_id),
          sessionDate: session.session_date,
        });
      }
    }

    return true;
  }

  function hydrateWatchlistDepartures(container, sessions, verdictForSession, curveSyncContext) {
    if (!container || !sessions?.length) return;
    for (const session of sessions) {
      const plan = cachedPlannerPlan(session.spot_id, session.session_date);
      if (!plan) continue;
      const card = container.querySelector(`[data-watch-id="${session.id}"]`);
      applyWatchDepartureToCard(
        card,
        session,
        { spotId: session.spot_id, plan },
        verdictForSession,
        curveSyncContext,
        { refreshCurve: true }
      );
    }
  }

  function clientTzOffsetMinutes(sessionDate) {
    const tz = WindmateForecastTime.getPlanningTimezoneId();
    if (tz) {
      const ref = sessionDate ? new Date(`${sessionDate}T12:00:00`) : new Date();
      return String(WindmateForecastTime.timezoneOffsetMinutesAt(ref, tz));
    }
    return String(new Date().getTimezoneOffset());
  }

  async function fetchPlan(spotId, date, lat, lng, sport) {
    const params = new URLSearchParams({
      spotId,
      date,
      lat: String(lat),
      lng: String(lng),
      tzOffset: clientTzOffsetMinutes(date),
    });
    if (sport) params.set('sport', sport);

    const response = await fetch(`/api/departure?${params.toString()}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Departure API ${response.status}`);
    }
    return response.json();
  }

  function formatDriveLabel(plan) {
    if (plan.driveSource === 'haversine') {
      return WindmateCopy.departure.noTraffic(plan.driveMinutes);
    }
    const traffic = plan.driveSource === 'google' ? ' (traffic)' : '';
    return `${plan.driveMinutes} min drive${traffic}`;
  }

  function mapsArriveByUnixSeconds(wallClockIso) {
    const m = String(wallClockIso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    return Math.floor(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 1000
    );
  }

  function buildArriveByMapsUrl(origin, destination, arriveAtIso) {
    if (!origin || !destination) return null;
    if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return null;
    if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) return null;
    const arriveUnix = mapsArriveByUnixSeconds(arriveAtIso);
    if (arriveUnix == null) return null;
    const o = `${origin.lat},${origin.lng}`;
    const d = `${destination.lat},${destination.lng}`;
    const timing = `!3m1!1e3!4m6!4m5!2m3!6e1!7e2!8j${arriveUnix}!3e0`;
    return `https://www.google.com/maps/dir/${o}/${d}/data=${timing}`;
  }

  function mapsUrlForDeparture(data, plan) {
    const built = buildArriveByMapsUrl(
      data?.origin,
      data?.destination ?? plan?.destination,
      plan?.arriveAtSpot ?? plan?.readyAtShore
    );
    if (built) return built;
    const legacy = plan?.mapsUrl;
    if (legacy && !legacy.includes('api=1')) return legacy;
    return null;
  }

  function renderLine(data, sessionVerdict, minRideableWindowHours) {
    const plan = data?.plan;
    if (!plan || data.status === 'no_window') return '';

    const minWindow = WindmateRideableWindow.parseMinHours(minRideableWindowHours);
    const consensusWindowHours = sessionVerdict?.windowHours ?? 0;
    if (consensusWindowHours < minWindow) return '';

    const drive = formatDriveLabel(plan);
    const windowRange = `${plan.onWaterStartLabel}–${plan.onWaterEndLabel}`;
    const sessionHours = plan.sessionWindowHours ?? plan.rideableHours;
    const hoursLabel = `${sessionHours} h session`;
    const strikeClass =
      sessionVerdict?.state === 'no_go' ? ' departure-line--caution' : '';
    const cautionNote =
      sessionVerdict?.state === 'no_go'
        ? `<span class="departure-line__caution">${WindmateCopy.departure.checkLive}</span>`
        : '';

    let mainLine = '';
    switch (plan.status) {
      case 'leave_now':
        mainLine = WindmateCopy.departure.leaveNow(plan.onWaterStartLabel);
        break;
      case 'in_window':
        mainLine = WindmateCopy.departure.inWindow(plan.hoursRemaining ?? plan.rideableHours);
        break;
      case 'passed':
        mainLine = WindmateCopy.departure.passed;
        break;
      default:
        mainLine = WindmateCopy.departure.leaveBy(plan.leaveByLabel, plan.driveMinutes);
        break;
    }

    const arriveDetail = plan.arriveAtSpotLabel
      ? `Arrive ${plan.arriveAtSpotLabel} · `
      : '';

    const title = [
      `${data.origin?.label ?? 'Home'} → spot`,
      `Drive: ${drive}`,
      plan.routeSummary ? `via ${plan.routeSummary}` : null,
      `Rig: ${plan.rigMinutes ?? 20} min`,
      `Window: ${windowRange} · ${hoursLabel}`,
      plan.topReasons?.length ? plan.topReasons.join(' · ') : null,
    ]
      .filter(Boolean)
      .join('\n');

    const mapsUrl = mapsUrlForDeparture(data, plan);
    const mapsLink = mapsUrl
      ? `<a href="${escapeAttr(mapsUrl)}" target="_blank" rel="noopener" class="departure-line__maps">${WindmateCopy.departure.openMaps}</a>`
      : '';

    return `
      <div class="departure-line${strikeClass}" title="${escapeAttr(title)}">
        <span class="departure-line__icon" aria-hidden="true">🚗</span>
        <span class="departure-line__main">${escapeHtml(mainLine)}</span>
        <span class="departure-line__detail">${escapeHtml(arriveDetail)}${escapeHtml(drive)} · on the water ${escapeHtml(windowRange)} · ${escapeHtml(hoursLabel)}</span>
        ${cautionNote}
        ${mapsLink}
      </div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function hourTimeKey(time) {
    return WindmateRideableWindow.hourTimeKey(time);
  }

  function exclusiveEndAfterRun(runEndKey) {
    const key = hourTimeKey(runEndKey);
    const match = key.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return key;

    let year = parseInt(match[1], 10);
    let month = parseInt(match[2], 10);
    let day = parseInt(match[3], 10);
    let hour = parseInt(match[4], 10) + 1;
    const minute = match[5];
    if (hour >= 24) {
      hour = 0;
      const next = new Date(year, month - 1, day + 1);
      year = next.getFullYear();
      month = next.getMonth() + 1;
      day = next.getDate();
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}`;
  }

  function syncDepartureWindowOnGrid(grid, plan) {
    if (!grid || !plan?.onWaterStart || !plan?.onWaterEnd) return;
    grid.dataset.departureWindowStart = hourTimeKey(plan.onWaterStart);
    grid.dataset.departureWindowEnd = hourTimeKey(plan.onWaterEnd);
  }

  function resolveDepartureWindowPlan(plan, windowSource) {
    if (!plan?.onWaterStart) return plan;
    if (plan.leaveBy) return plan;

    const start =
      windowSource?.start ??
      windowSource?.dataset?.departureWindowStart ??
      windowSource?.departureWindowStart;
    const end =
      windowSource?.end ??
      windowSource?.dataset?.departureWindowEnd ??
      windowSource?.departureWindowEnd;
    if (!start || !end) return plan;

    const rigMinutes = plan.rigMinutes ?? 20;
    const bufferMinutes = plan.bufferMinutes ?? 5;
    const arriveAtSpot = WindmateForecastTime.subtractForecastMinutes(start, rigMinutes);
    const leaveBy = WindmateForecastTime.subtractForecastMinutes(
      WindmateForecastTime.subtractForecastMinutes(arriveAtSpot, plan.driveMinutes ?? 0),
      bufferMinutes
    );
    const onWaterStart = start.length > 16 ? start : `${start}:00`;
    const onWaterEnd = end.length > 16 ? end : `${end}:00`;

    return {
      ...plan,
      onWaterStart,
      onWaterEnd,
      onWaterStartLabel: WindmateForecastTime.formatForecastClock(start),
      onWaterEndLabel: WindmateForecastTime.formatForecastClock(end),
      arriveAtSpot: `${arriveAtSpot}:00`,
      arriveAtSpotLabel: WindmateForecastTime.formatForecastClock(arriveAtSpot),
      readyAtShore: `${arriveAtSpot}:00`,
      leaveBy: `${leaveBy}:00`,
      leaveByLabel: WindmateForecastTime.formatForecastClock(leaveBy),
      rideableHours: plan.sessionWindowHours ?? plan.rideableHours,
    };
  }

  function findWindowIndices(hourTimes, plan) {
    const start = hourTimeKey(plan.onWaterStart);
    const end = hourTimeKey(plan.onWaterEnd);
    let startIdx = -1;
    let endIdx = -1;
    hourTimes.forEach((time, index) => {
      const key = hourTimeKey(time);
      if (key >= start && key < end) {
        if (startIdx < 0) startIdx = index;
        endIdx = index;
      }
    });
    return startIdx >= 0 ? { startIdx, endIdx } : null;
  }

  function readDepartureRadius(group) {
    if (!group) return 8;
    const raw = getComputedStyle(group).getPropertyValue('--departure-radius').trim();
    if (!raw) return 8;
    const px = parseFloat(raw);
    if (!Number.isFinite(px) || px <= 0) return 8;
    return raw.endsWith('rem') ? px * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) : px;
  }

  function roundedRectPath(x, y, w, h, radius) {
    const rad = Math.max(0, Math.min(radius, w / 2, h / 2));
    const right = x + w;
    const bottom = y + h;
    return [
      `M ${x + rad} ${y}`,
      `H ${right - rad}`,
      `A ${rad} ${rad} 0 0 1 ${right} ${y + rad}`,
      `V ${bottom - rad}`,
      `A ${rad} ${rad} 0 0 1 ${right - rad} ${bottom}`,
      `H ${x + rad}`,
      `A ${rad} ${rad} 0 0 1 ${x} ${bottom - rad}`,
      `V ${y + rad}`,
      `A ${rad} ${rad} 0 0 1 ${x + rad} ${y}`,
      'Z',
    ].join(' ');
  }

  /** Watchlist / no-matrix cards: single rounded banner outline. */
  function buildBannerOnlyShape({ bx, by, bw, bh, radius }) {
    return roundedRectPath(bx, by, bw, bh, radius);
  }

  /** One continuous outline: matrix → necks → banner (no inner gap box). */
  function buildDepartureShape({ mx, my, mw, mh, bx, by, bw, bh, radius }) {
    const r = radius;
    const br = radius;
    const mBottom = my + mh;
    const bBottom = by + bh;
    const mLeft = mx;
    const mRight = mx + mw;
    const bLeft = bx;
    const bRight = bx + bw;
    const bInnerLeft = bLeft + br;
    const bInnerRight = bRight - br;

    const parts = [
      `M ${mLeft + r} ${my}`,
      `H ${mRight - r}`,
      `Q ${mRight} ${my} ${mRight} ${my + r}`,
      `V ${mBottom}`,
      `L ${mRight} ${by}`,
    ];

    if (bInnerRight > mRight + 0.5) {
      parts.push(`L ${bInnerRight} ${by}`);
    }

    parts.push(
      `Q ${bRight} ${by} ${bRight} ${by + br}`,
      `V ${bBottom - br}`,
      `Q ${bRight} ${bBottom} ${bRight - br} ${bBottom}`,
      `H ${bInnerLeft}`,
      `Q ${bLeft} ${bBottom} ${bLeft} ${bBottom - br}`,
      `V ${by + br}`,
      `Q ${bLeft} ${by} ${bInnerLeft} ${by}`,
      `L ${mLeft} ${by}`,
      `L ${mLeft} ${mBottom}`,
      `V ${my + r}`,
      `Q ${mLeft} ${my} ${mLeft + r} ${my}`,
      'Z'
    );

    return parts.join(' ');
  }

  function clearDepartureStroke(card, departureKey) {
    if (!card) return;
    const group = card.querySelector(`[data-departure-group="${departureKey}"]`);
    const svg = card.querySelector(`[data-departure-stroke-for="${departureKey}"]`);
    group?.classList.remove('has-departure-window', 'has-departure-line');
    svg?.querySelector('.departure-plan-stroke__shape')?.removeAttribute('d');
  }

  function applyDepartureStroke(card, departureKey, plan, mode = 'matrix') {
    if (!card) return;
    const group = card.querySelector(`[data-departure-group="${departureKey}"]`);
    const svg = card.querySelector(`[data-departure-stroke-for="${departureKey}"]`);
    const shape = svg?.querySelector('.departure-plan-stroke__shape');
    const slot = card.querySelector(`[data-departure-for="${departureKey}"]`);

    if (!group || !svg || !shape || !slot || !plan?.onWaterStart) {
      clearDepartureStroke(card, departureKey);
      return;
    }

    if (!slot.querySelector('.departure-line')) {
      clearDepartureStroke(card, departureKey);
      return;
    }

    const groupRect = group.getBoundingClientRect();
    const width = group.offsetWidth;
    const height = group.offsetHeight;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const bannerRect = slot.getBoundingClientRect();
    const bx = bannerRect.left - groupRect.left;
    const by = bannerRect.top - groupRect.top;
    const bw = bannerRect.width;
    const bh = bannerRect.height;
    const radius = readDepartureRadius(group);

    if (mode === 'banner') {
      shape.removeAttribute('d');
      group.classList.add('has-departure-line');
      return;
    }

    const grid = card.querySelector(`[data-matrix-grid="${departureKey}"]`);
    if (!grid) {
      clearDepartureStroke(card, departureKey);
      return;
    }

    const hourTimes = (grid.dataset.matrixHourTimes ?? '').split('|').filter(Boolean);
    const windowPlan = resolveDepartureWindowPlan(plan, grid);
    const indices = findWindowIndices(hourTimes, windowPlan);
    if (!indices) {
      clearDepartureStroke(card, departureKey);
      return;
    }

    const blockContainer =
      grid.querySelector('.matrix-hour-blocks') ?? grid.querySelector('.matrix-direction-blocks');
    const rows = grid.querySelectorAll('.matrix-row');
    if (!blockContainer || !rows.length) return;

    const slots = blockContainer.children;
    const startEl = slots[indices.startIdx];
    const endEl = slots[indices.endIdx];
    if (!startEl || !endEl) return;

    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();
    const firstRowRect = rows[0].getBoundingClientRect();
    const lastRowRect = rows[rows.length - 1].getBoundingClientRect();

    const mx = startRect.left - groupRect.left;
    const my = firstRowRect.top - groupRect.top;
    const mw = endRect.right - startRect.left;
    const mh = lastRowRect.bottom - firstRowRect.top;

    shape.setAttribute(
      'd',
      buildDepartureShape({
        mx,
        my,
        mw,
        mh,
        bx,
        by,
        bw,
        bh,
        radius,
      })
    );
    group.classList.add('has-departure-window');
  }

  function scheduleDepartureStroke(card, departureKey, plan, mode = 'matrix') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => applyDepartureStroke(card, departureKey, plan, mode));
    });
  }

  const activeEntries = new Map();
  const observedContainers = new Set();
  let resizeObserver = null;
  let refreshRaf = 0;
  let windowResizeBound = false;

  function refreshAllDepartureStrokes() {
    if (refreshRaf) cancelAnimationFrame(refreshRaf);
    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = 0;
      for (const { card, departureKey, plan, mode } of activeEntries.values()) {
        applyDepartureStroke(card, departureKey, plan, mode);
      }
    });
  }

  function ensureResizeWatch() {
    if (resizeObserver || windowResizeBound) return;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => refreshAllDepartureStrokes());
    } else {
      window.addEventListener('resize', refreshAllDepartureStrokes, { passive: true });
      windowResizeBound = true;
    }
  }

  function observeDepartureLayout(container, card, departureKey, mode) {
    ensureResizeWatch();
    if (container && resizeObserver && !observedContainers.has(container)) {
      resizeObserver.observe(container);
      observedContainers.add(container);
    }
    if (!resizeObserver) return;
    const group = card.querySelector(`[data-departure-group="${departureKey}"]`);
    if (group) resizeObserver.observe(group);
    if (mode === 'matrix') {
      const grid = card.querySelector(`[data-matrix-grid="${departureKey}"]`);
      if (grid) resizeObserver.observe(grid);
    }
  }

  function trackDepartureStroke(container, card, departureKey, plan, mode = 'matrix') {
    activeEntries.set(String(departureKey), {
      card,
      plan,
      departureKey: String(departureKey),
      mode,
      container,
    });
    observeDepartureLayout(container, card, departureKey, mode);
  }

  function untrackContainer(container) {
    for (const [key, entry] of activeEntries) {
      if (entry.container === container) activeEntries.delete(key);
    }
    const containerStillUsed = [...activeEntries.values()].some(
      (entry) => entry.container === container
    );
    if (!containerStillUsed && resizeObserver && observedContainers.has(container)) {
      resizeObserver.unobserve(container);
      observedContainers.delete(container);
    }
    if (activeEntries.size === 0) {
      if (refreshRaf) {
        cancelAnimationFrame(refreshRaf);
        refreshRaf = 0;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      observedContainers.clear();
    }
  }

  function watchDepartureKey(sessionId) {
    return `watch-${sessionId}`;
  }

  function clearSessionDayRefresh() {
    if (sessionDayRefreshTimer) {
      clearInterval(sessionDayRefreshTimer);
      sessionDayRefreshTimer = null;
    }
    if (sessionDayRefreshHandler) {
      document.removeEventListener('visibilitychange', sessionDayRefreshHandler);
      sessionDayRefreshHandler = null;
    }
  }

  function scheduleSessionDayRefresh(isSessionDay, reloadFn) {
    clearSessionDayRefresh();
    if (!isSessionDay || !reloadFn) return;

    sessionDayRefreshHandler = () => {
      if (document.visibilityState === 'visible') reloadFn();
    };
    document.addEventListener('visibilitychange', sessionDayRefreshHandler);
    sessionDayRefreshTimer = setInterval(reloadFn, SESSION_DAY_REFRESH_MS);
  }

  async function loadForMatrix(
    container,
    spotIds,
    dateStr,
    lat,
    lng,
    sport,
    sessionVerdictBySpot,
    minRideableWindowHours,
    curveSyncContext
  ) {
    if (!container || !spotIds.length || !dateStr) return;

    const loadGeneration = ++matrixDepartureGeneration;
    clearSessionDayRefresh();
    untrackContainer(container);

    for (const spotId of spotIds) {
      const card = container.querySelector(`[data-spot-id="${spotId}"]`);
      if (card) clearDepartureStroke(card, spotId);
    }

    const results = await Promise.all(
      spotIds.map((spotId) =>
        fetchPlan(spotId, dateStr, lat, lng, sport).catch(() => null)
      )
    );

    const applyResults = (batch) => {
      if (loadGeneration !== matrixDepartureGeneration) return;
      for (const data of batch) {
        if (!data?.spotId) continue;
        const card = container.querySelector(`[data-spot-id="${data.spotId}"]`);
        const slot = card?.querySelector(`[data-departure-for="${data.spotId}"]`);
        if (!slot) continue;
        const verdict = sessionVerdictBySpot?.get(data.spotId);
        const grid = card?.querySelector(`[data-matrix-grid="${data.spotId}"]`);
        const plan = data.plan;
        rememberPlannerPlan(data.spotId, dateStr, plan, {
          origin: data.origin,
          destination: data.destination ?? plan?.destination,
        });
        syncDepartureWindowOnGrid(grid, plan);
        slot.innerHTML = renderLine({ ...data, plan }, verdict, minRideableWindowHours);
        if (plan) {
          trackDepartureStroke(container, card, data.spotId, plan, 'matrix');
          scheduleDepartureStroke(card, data.spotId, plan, 'matrix');
          if (curveSyncContext) {
            const obsEntry = curveSyncContext.obsBySpot?.get(data.spotId);
            WindmateObservations.refreshPlannerBandOnCard(card, plan, obsEntry, curveSyncContext.prefs, {
              warnings: curveSyncContext.warningsBySpot?.get(data.spotId),
              rideEntry: curveSyncContext.rideEntryBySpot?.get(data.spotId),
              sessionDate: dateStr,
            });
          }
        }
      }
    };

    applyResults(results);

    const isSessionDay =
      dateStr === WindmateForecastTime.planningToday();
    const needsTrafficRefresh = results.some((data) => data?.plan?.driveSource === 'google');
    if (isSessionDay && needsTrafficRefresh && loadGeneration === matrixDepartureGeneration) {
      const reload = () => {
        if (loadGeneration !== matrixDepartureGeneration) return;
        Promise.all(
          spotIds.map((spotId) =>
            fetchPlan(spotId, dateStr, lat, lng, sport).catch(() => null)
          )
        ).then(applyResults);
      };
      scheduleSessionDayRefresh(true, reload);
    }
  }

  function watchDepartureSignature(sessions) {
    return sessions
      .map((session) => `${session.id}:${session.session_date}:${session.sport}:${session.spot_id}`)
      .join('|');
  }

  async function loadForWatchlist(container, sessions, lat, lng, verdictForSession, curveSyncContext) {
    if (!container || !sessions?.length || lat == null || lng == null) return;

    const signature = watchDepartureSignature(sessions);
    if (watchDepartureInFlight?.signature === signature) {
      return watchDepartureInFlight.promise;
    }

    const loadGeneration = ++watchDepartureGeneration;
    clearSessionDayRefresh();
    untrackContainer(container);

    for (const session of sessions) {
      const key = watchDepartureKey(session.id);
      const card = container.querySelector(`[data-watch-id="${session.id}"]`);
      if (card) clearDepartureStroke(card, key);
    }

    hydrateWatchlistDepartures(container, sessions, verdictForSession, curveSyncContext);

    const runLoad = async () => {
    const results = await Promise.all(
      sessions.map((session) =>
        fetchPlan(session.spot_id, session.session_date, lat, lng, session.sport).catch(() => null)
      )
    );

    const applyWatchResults = (batch) => {
      if (loadGeneration !== watchDepartureGeneration) return;
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const data = batch[i];
        const card = container.querySelector(`[data-watch-id="${session.id}"]`);
        applyWatchDepartureToCard(card, session, data, verdictForSession, curveSyncContext, {
          refreshCurve: true,
        });
      }
    };

    applyWatchResults(results);

    const today = WindmateForecastTime.planningToday();
    const hasSessionToday = sessions.some((s) => s.session_date === today);
    const needsTrafficRefresh = results.some((data) => data?.plan?.driveSource === 'google');
    if (hasSessionToday && needsTrafficRefresh && loadGeneration === watchDepartureGeneration) {
      const reload = () => {
        if (loadGeneration !== watchDepartureGeneration) return;
        Promise.all(
          sessions.map((session) =>
            fetchPlan(session.spot_id, session.session_date, lat, lng, session.sport).catch(
              () => null
            )
          )
        ).then(applyWatchResults);
      };
      scheduleSessionDayRefresh(true, reload);
    }
    };

    const promise = runLoad();
    watchDepartureInFlight = { signature, promise };
    try {
      await promise;
    } finally {
      if (watchDepartureInFlight?.promise === promise) watchDepartureInFlight = null;
    }
  }

  return {
    fetchPlan,
    renderLine,
    resolveDepartureWindowPlan,
    loadForMatrix,
    loadForWatchlist,
    applyDepartureStroke,
    refreshAllDepartureStrokes,
    watchDepartureKey,
    exclusiveEndAfterRun,
    cachedPlannerRange,
    hydrateWatchlistDepartures,
  };
})();
