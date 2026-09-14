/** Session watchlist — planner pins and session-day panel */
const WindmateWatchlist = (() => {
  let sessions = [];
  let sessionsSyncToken = 0;
  /** @type {Map<string, boolean>} desired watched state while UI/server may differ */
  const watchIntent = new Map();
  /** Deletes started from strip × before server confirms */
  const pendingServerDeletes = [];
  let serverSyncTail = Promise.resolve();
  let changeNotifyRaf = 0;
  let onChange = null;
  let onNavigate = null;
  let onStripError = null;
  let drainGeneration = 0;

  function watchlistDebugEnabled() {
    if (typeof window === 'undefined') return false;
    if (window.WINDMATE_DEBUG_WATCHLIST === true) return true;
    try {
      return window.localStorage?.getItem('windmate.debugWatchlist') === '1';
    } catch {
      return false;
    }
  }

  function wlLog(event, detail) {
    if (!watchlistDebugEnabled()) return;
    const stamp = performance.now().toFixed(1);
    console.debug(`[watchlist ${stamp}ms] ${event}`, detail ?? '');
  }

  function wlSnapshot() {
    return {
      sessions: sessions.length,
      syncToken: sessionsSyncToken,
      intent: [...watchIntent.entries()].map(([k, v]) => ({ key: k, desired: v })),
      pendingDeletes: pendingServerDeletes.map((j) => ({ id: j.id, key: j.key })),
      rows: sessions.map((s) => ({
        id: s.id,
        spot: s.spot_id,
        date: s.session_date,
        sport: s.sport,
      })),
    };
  }

  function bumpSessionsSync() {
    sessionsSyncToken += 1;
    return sessionsSyncToken;
  }

  function getSessionsSyncToken() {
    return sessionsSyncToken;
  }

  function sessionKey(spotId, sessionDate, sport) {
    return `${spotId}|${sessionDate}|${sport}`;
  }

  function parseSessionKey(key) {
    const parts = key.split('|');
    return { spotId: parts[0], sessionDate: parts[1], sport: parts[2] };
  }

  function escapeHtmlAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function isPendingId(id) {
    return typeof id === 'string' && id.startsWith('pending:');
  }

  function findSessionRow(spotId, sessionDate, sport) {
    return sessions.find(
      (s) => s.spot_id === spotId && s.session_date === sessionDate && s.sport === sport
    );
  }

  function notifyChange() {
    if (onChange) onChange();
  }

  function notifyChangeDebounced() {
    if (changeNotifyRaf) return;
    changeNotifyRaf = window.requestAnimationFrame(() => {
      changeNotifyRaf = 0;
      notifyChange();
    });
  }

  function scheduleServerSync() {
    wlLog('scheduleServerSync', wlSnapshot());
    serverSyncTail = serverSyncTail
      .then(() => drainServerSync())
      .catch((err) => {
        wlLog('drainServerSync rejected', { message: err?.message, stack: err?.stack });
        console.error(err);
      });
    return serverSyncTail;
  }

  function upsertSessionRow(row) {
    if (!row?.id) return;
    sessions = sessions.filter(
      (s) =>
        !(
          s.spot_id === row.spot_id &&
          s.session_date === row.session_date &&
          s.sport === row.sport
        )
    );
    sessions.push(row);
  }

  async function reconcileSessions(syncToken) {
    try {
      await load({ light: true, syncToken });
      if (syncToken === sessionsSyncToken) notifyChange();
    } catch (err) {
      console.error(err);
    }
  }

  const GO_NO_GO_CLASS = {
    go: 'go-no-go-pill--go',
    caution: 'go-no-go-pill--caution',
    no_go: 'go-no-go-pill--no_go',
    unknown: 'go-no-go-pill--unknown',
  };

  const LEGACY_STATUS_TO_VERDICT = {
    on_track: 'go',
    degrading: 'caution',
    at_risk: 'caution',
    no_go: 'no_go',
    unknown: 'unknown',
  };

  function resolveVerdict(session) {
    if (session.sessionGoNoGo?.state) return session.sessionGoNoGo;
    const state = LEGACY_STATUS_TO_VERDICT[session.status] ?? 'unknown';
    const summary = session.summary;
    let reason = '';
    if (summary?.windRange) {
      const gust = summary.windRange.gustMin != null
        ? ` · ${summary.windRange.gustMin}–${summary.windRange.gustMax} kt gusts`
        : '';
      reason = `${summary.windowHours ?? '?'} h window · ${summary.windRange.min}–${summary.windRange.max} kt wind${gust}`;
    } else if (summary?.windowHours != null) {
      reason = `${summary.windowHours} h rideable window in forecast`;
    }
    return { state, reason };
  }

  async function load({ light = false, syncToken = sessionsSyncToken } = {}) {
    const url = light ? '/api/watchlist?light=1' : '/api/watchlist';
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? res.statusText);
    }
    const data = await res.json();
    if (syncToken !== sessionsSyncToken) {
      wlLog('load dropped (stale token)', { syncToken, current: sessionsSyncToken, light });
      return sessions;
    }
    sessions = data.sessions ?? [];
    wlLog('load applied', { light, count: sessions.length, syncToken });
    return sessions;
  }

  function isWatched(spotId, sessionDate, sport) {
    const key = sessionKey(spotId, sessionDate, sport);
    if (watchIntent.has(key)) return watchIntent.get(key);
    return Boolean(findSessionRow(spotId, sessionDate, sport));
  }

  function watchId(spotId, sessionDate, sport) {
    return findSessionRow(spotId, sessionDate, sport)?.id;
  }

  function applyLocalWatched(spotId, sessionDate, sport, watched, spotName) {
    const row = findSessionRow(spotId, sessionDate, sport);
    if (watched) {
      if (row) return;
      const key = sessionKey(spotId, sessionDate, sport);
      const label =
        spotName?.trim() ||
        spotNameById.get(String(spotId)) ||
        row?.spot_name ||
        '';
      sessions.push({
        id: `pending:${key}`,
        spot_id: spotId,
        session_date: sessionDate,
        sport,
        spot_name: label,
      });
      bumpSessionsSync();
      return;
    }
    if (!row) return;
    sessions = sessions.filter(
      (s) =>
        !(
          s.spot_id === spotId &&
          s.session_date === sessionDate &&
          s.sport === sport
        )
    );
    bumpSessionsSync();
  }

  function queueServerDeleteForRow(row, key) {
    if (!row || isPendingId(row.id)) return;
    if (pendingServerDeletes.some((j) => j.id === row.id)) return;
    pendingServerDeletes.push({
      id: row.id,
      key,
      spotId: row.spot_id,
      sessionDate: row.session_date,
      sport: row.sport,
      rollbackSnapshot: [...sessions],
    });
  }

  function setWatchDesired(spotId, sessionDate, sport, watched, spotName) {
    const key = sessionKey(spotId, sessionDate, sport);
    if (spotName) rememberSpotName(spotId, spotName);
    if (!watched) {
      queueServerDeleteForRow(findSessionRow(spotId, sessionDate, sport), key);
    }
    watchIntent.set(key, watched);
    applyLocalWatched(spotId, sessionDate, sport, watched, spotName);
    wlLog('setWatchDesired', { spotId, sessionDate, sport, watched, ...wlSnapshot() });
    notifyChangeDebounced();
    return scheduleServerSync();
  }

  async function serverAdd(spotId, sessionDate, sport, key) {
    wlLog('serverAdd start', { spotId, sessionDate, sport, key, intent: watchIntent.get(key) });
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId, sessionDate, sport }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const syncToken = sessionsSyncToken;
        await load({ light: true, syncToken });
        if (watchIntent.get(key) === false) {
          const id = watchId(spotId, sessionDate, sport);
          if (id && !isPendingId(id)) {
            await serverDelete(id, [...sessions], key);
          }
        } else {
          watchIntent.delete(key);
        }
        notifyChangeDebounced();
        return;
      }
      wlLog('serverAdd failed', { status: res.status, error: err.error ?? res.statusText });
      throw new Error(err.error ?? res.statusText);
    }
    const created = await res.json();
    wlLog('serverAdd ok', { id: created.id, key });
    if (watchIntent.get(key) === false) {
      await fetch(`/api/watchlist/${encodeURIComponent(created.id)}`, { method: 'DELETE' });
      watchIntent.delete(key);
      sessions = sessions.filter(
        (s) =>
          !(
            s.spot_id === spotId &&
            s.session_date === sessionDate &&
            s.sport === sport
          )
      );
      bumpSessionsSync();
      notifyChangeDebounced();
      return;
    }
    upsertSessionRow(created);
    watchIntent.delete(key);
    bumpSessionsSync();
    if (typeof WindmateLocalUserState !== 'undefined') {
      WindmateLocalUserState.noteMutation();
    }
    notifyChangeDebounced();
  }

  async function serverDelete(id, rollbackSnapshot, key) {
    wlLog('serverDelete start', { id, key, queueHead: pendingServerDeletes[0]?.id });
    try {
      const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        wlLog('serverDelete failed', { id, status: res.status, error: err.error ?? res.statusText });
        throw new Error(err.error ?? res.statusText);
      }
      if (pendingServerDeletes[0]?.id === id) pendingServerDeletes.shift();
      else {
        const idx = pendingServerDeletes.findIndex((j) => j.id === id);
        if (idx >= 0) pendingServerDeletes.splice(idx, 1);
      }
      wlLog('serverDelete ok', { id, key, ...wlSnapshot() });
      if (watchIntent.get(key) !== true) watchIntent.delete(key);
      if (typeof WindmateLocalUserState !== 'undefined') {
        WindmateLocalUserState.noteMutation();
      }
      notifyChangeDebounced();
    } catch (err) {
      wlLog('serverDelete rollback', { id, key, message: err?.message });
      sessions = rollbackSnapshot;
      bumpSessionsSync();
      watchIntent.set(key, true);
      notifyChange();
      throw err;
    }
  }

  function nextServerSyncJob() {
    if (pendingServerDeletes.length) {
      const job = pendingServerDeletes[0];
      if (watchIntent.get(job.key) === true) {
        pendingServerDeletes.shift();
        applyLocalWatched(job.spotId, job.sessionDate, job.sport, true);
        notifyChangeDebounced();
        return null;
      }
      return { kind: 'delete', ...job };
    }

    for (const [key, desired] of [...watchIntent.entries()]) {
      const { spotId, sessionDate, sport } = parseSessionKey(key);
      const row = findSessionRow(spotId, sessionDate, sport);

      if (desired) {
        if (!row) {
          applyLocalWatched(spotId, sessionDate, sport, true);
          return { kind: 'add', spotId, sessionDate, sport, key };
        }
        if (isPendingId(row.id)) {
          if (watchIntent.get(key) === false) {
            applyLocalWatched(spotId, sessionDate, sport, false);
            watchIntent.delete(key);
            notifyChangeDebounced();
            continue;
          }
          return { kind: 'add', spotId, sessionDate, sport, key };
        }
        watchIntent.delete(key);
        continue;
      }

      if (!row) {
        const deleteQueued = pendingServerDeletes.some((j) => j.key === key);
        if (!deleteQueued) watchIntent.delete(key);
        continue;
      }
      if (isPendingId(row.id)) {
        applyLocalWatched(spotId, sessionDate, sport, false);
        watchIntent.delete(key);
        notifyChangeDebounced();
        continue;
      }
      queueServerDeleteForRow(row, key);
      applyLocalWatched(spotId, sessionDate, sport, false);
      notifyChangeDebounced();
      continue;
    }
    return null;
  }

  async function drainServerSync() {
    const gen = ++drainGeneration;
    wlLog('drain start', { gen, ...wlSnapshot() });
    let progressed = false;
    let guard = 0;
    for (;;) {
      if (++guard > 64) {
        wlLog('drain guard tripped — aborting loop', { gen, ...wlSnapshot() });
        console.warn('[watchlist] drain loop guard tripped', wlSnapshot());
        break;
      }
      const job = nextServerSyncJob();
      if (!job) break;
      progressed = true;
      wlLog('drain job', { gen, job });
      if (job.kind === 'add') {
        if (watchIntent.get(job.key) !== true) {
          wlLog('drain skip add (intent changed)', {
            key: job.key,
            intent: watchIntent.get(job.key),
          });
          applyLocalWatched(job.spotId, job.sessionDate, job.sport, false);
          watchIntent.delete(job.key);
          continue;
        }
        await serverAdd(job.spotId, job.sessionDate, job.sport, job.key);
      } else if (job.kind === 'delete') {
        await serverDelete(job.id, job.rollbackSnapshot, job.key);
      }
    }
    wlLog('drain end', { gen, progressed, ...wlSnapshot() });
    if (progressed && watchIntent.size === 0 && pendingServerDeletes.length === 0) {
      const syncToken = sessionsSyncToken;
      wlLog('reconcile scheduled', { syncToken });
      void reconcileSessions(syncToken);
    }
  }

  async function add(spotId, sessionDate, sport) {
    return setWatchDesired(spotId, sessionDate, sport, true);
  }

  async function removeBySession(spotId, sessionDate, sport) {
    wlLog('removeBySession', { spotId, sessionDate, sport });
    const row = findSessionRow(spotId, sessionDate, sport);
    if (row) return remove(row.id);
    return setWatchDesired(spotId, sessionDate, sport, false);
  }

  /** Strip × — optimistic UI, server catches up in the sync drain. */
  async function remove(id) {
    wlLog('remove', { id });
    if (!id) return scheduleServerSync();
    const row = sessions.find((s) => s.id === id);
    if (!row) {
      wlLog('remove — no row', { id });
      return scheduleServerSync();
    }
    const key = sessionKey(row.spot_id, row.session_date, row.sport);
    watchIntent.set(key, false);
    if (isPendingId(id)) {
      applyLocalWatched(row.spot_id, row.session_date, row.sport, false);
      watchIntent.delete(key);
      notifyChangeDebounced();
      return scheduleServerSync();
    }
    queueServerDeleteForRow(row, key);
    applyLocalWatched(row.spot_id, row.session_date, row.sport, false);
    notifyChangeDebounced();
    return scheduleServerSync();
  }

  async function toggle(spotId, sessionDate, sport, { spotName } = {}) {
    const was = isWatched(spotId, sessionDate, sport);
    const next = !was;
    wlLog('toggle', { spotId, sessionDate, sport, was, next, spotName });
    return setWatchDesired(spotId, sessionDate, sport, next, spotName);
  }

  function whenMutationsIdle() {
    return serverSyncTail;
  }

  function prefsForWatchSession(session, { prefs, sportProfiles }) {
    const profile = sportProfiles?.find((p) => p.sport === session.sport);
    const base = profile ?? prefs;
    if (!base) return null;
    return {
      ...base,
      sport: session.sport,
      rank_criteria_order: base.rank_criteria_order ?? prefs?.rank_criteria_order,
      favorite_spot_ids: prefs?.favorite_spot_ids ?? base.favorite_spot_ids,
    };
  }

  /**
   * Stickers use the watched session's sport profile, not the dashboard sport.
   * Same spot can appear on multiple pins (sailing vs wingfoiling) with different ratings.
   * Matrix ride data is sport-agnostic wind; rideability flags are re-applied via session prefs.
   */
  function resolveSessionExcitement(session, { rideEntryBySpot, prefs, sportProfiles, radiusKm }) {
    const sessionPrefs = prefsForWatchSession(session, { prefs, sportProfiles });
    const entry = rideEntryBySpot?.get(session.spot_id);
    if (entry && sessionPrefs) {
      return WindmateSessionExcitement.computeFromEntry(
        entry,
        session.session_date,
        sessionPrefs,
        radiusKm ?? sessionPrefs.radius_km ?? 50
      );
    }
    return session.excitement ?? { tier: null };
  }

  function patchSessionStickers(card, session, ctx) {
    const excitement = resolveSessionExcitement(session, ctx);
    const html = WindmateSessionExcitement.renderStickers(excitement);
    const stack = card.querySelector('.session-excitement-stack');
    if (!html) {
      stack?.remove();
      return;
    }
    if (stack) {
      const wrap = document.createElement('div');
      wrap.innerHTML = html.trim();
      const next = wrap.firstElementChild;
      if (next) stack.replaceWith(next);
      return;
    }
    card.insertAdjacentHTML('afterbegin', html);
  }

  const spotNameById = new Map();

  function rememberSpotName(spotId, name) {
    const trimmed = name?.trim();
    if (!spotId || !trimmed) return;
    spotNameById.set(String(spotId), trimmed);
    sessions = sessions.map((s) =>
      String(s.spot_id) === String(spotId) && (!s.spot_name || s.spot_name === '…')
        ? { ...s, spot_name: trimmed }
        : s
    );
  }

  function resolveSpotName(session, rideEntryBySpot) {
    if (session.spot_name && session.spot_name !== '…') return session.spot_name;
    const fromMatrix = rideEntryBySpot?.get(session.spot_id)?.spot?.name;
    if (fromMatrix) return fromMatrix;
    const cached = spotNameById.get(String(session.spot_id));
    if (cached) return cached;
    if (session.spot?.name) return session.spot.name;
    return 'Spot';
  }

  function spotForWatchSession(session, rideEntryBySpot) {
    if (session.spot?.id) return session.spot;
    const entry = rideEntryBySpot?.get(session.spot_id);
    if (entry?.spot?.id) return entry.spot;
    return { id: session.spot_id, name: resolveSpotName(session, rideEntryBySpot) };
  }

  function sortedSessions() {
    const today = WindmateForecastTime.planningToday();
    return [...sessions].sort((a, b) => {
      if (a.session_date === today && b.session_date !== today) return -1;
      if (b.session_date === today && a.session_date !== today) return 1;
      return a.session_date.localeCompare(b.session_date);
    });
  }

  function canPatchStrip(container) {
    const sorted = sortedSessions();
    if (!sorted.length || !container) return false;
    const cards = container.querySelectorAll('[data-watch-id]');
    if (cards.length !== sorted.length) return false;
    const ids = [...cards].map((card) => card.dataset.watchId).sort();
    const expected = sorted.map((session) => String(session.id)).sort();
    return ids.every((id, index) => id === expected[index]);
  }

  function patchObservations(
    container,
    { observationsBySpot, prefs, rideEntryBySpot, sportProfiles, radiusKm }
  ) {
    if (!container || !canPatchStrip(container)) return false;
    const today = WindmateForecastTime.planningToday();
    for (const session of sortedSessions()) {
      const card = container.querySelector(`[data-watch-id="${session.id}"]`);
      if (!card) continue;
      const isToday = session.session_date === today;
      const obs = observationsBySpot?.get(session.spot_id);
      const verdict = resolveVerdict(session);
      const sessionPrefs = prefsForWatchSession(session, { prefs, sportProfiles });
      const spot = spotForWatchSession(session, rideEntryBySpot);
      const liveStrip =
        isToday && obs && spot?.id
          ? WindmateObservations.renderLiveStrip(
              spot,
              obs,
              rideEntryBySpot?.get(session.spot_id),
              sessionPrefs ?? prefs,
              {
                curveKey: `watch:${session.id}`,
                sessionDate: session.session_date,
                sessionGoNoGo: verdict,
                suppressVerdictBanner: true,
              }
            )
          : '';
      const existing = card.querySelector('.live-strip');
      if (liveStrip && existing) {
        const wrap = document.createElement('div');
        wrap.innerHTML = liveStrip.trim();
        const next = wrap.firstElementChild;
        existing.replaceWith(next);
        WindmateObservations.syncCurveToggleUi(next, `watch:${session.id}`);
      } else if (liveStrip && !existing) {
        const departureGroup = card.querySelector('[data-departure-group]');
        const wrap = document.createElement('div');
        wrap.innerHTML = liveStrip.trim();
        departureGroup?.insertAdjacentElement('beforebegin', wrap.firstElementChild);
      } else if (!liveStrip && existing) {
        existing.remove();
      }

      const forecastSummary = verdict.summary ?? '';
      const summaryEl = card.querySelector('.session-verdict-banner--go');
      if (forecastSummary) {
        if (summaryEl) summaryEl.textContent = forecastSummary;
        else {
          const banner = document.createElement('div');
          banner.className = 'session-verdict-banner session-verdict-banner--go';
          banner.textContent = forecastSummary;
          card.querySelector('.flex.flex-wrap.items-start')?.insertAdjacentElement('afterend', banner);
        }
      } else if (summaryEl) {
        summaryEl.remove();
      }

      patchSessionStickers(card, session, {
        rideEntryBySpot,
        prefs,
        sportProfiles,
        radiusKm,
      });
    }
    return true;
  }

  function renderStrip(container, { activeSport, observationsBySpot, prefs, rideEntryBySpot, sportProfiles, radiusKm }) {
    if (!container) return;
    const sorted = sortedSessions();
    const today = WindmateForecastTime.planningToday();

    if (!sorted.length) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="watchlist-strip-label"><span class="watchlist-strip-icon" aria-hidden="true">${watchIcon()}</span> Watching</div>
      <div class="watchlist-strip-cards space-y-3">
        ${sorted
          .map((session) =>
            renderCard(session, {
              observationsBySpot,
              prefs,
              today,
              rideEntryBySpot,
              sportProfiles,
              radiusKm,
            })
          )
          .join('')}
      </div>`;

    container.querySelectorAll('button[data-watch-remove]').forEach((removeBtn) => {
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const spotId = removeBtn.dataset.watchSpot;
        const sessionDate = removeBtn.dataset.watchDate;
        const sport = removeBtn.dataset.watchSport;
        wlLog('strip × click', { spotId, sessionDate, sport });
        void removeBySession(spotId, sessionDate, sport).catch((err) => {
          console.error(err);
          if (onStripError) onStripError(err);
        });
      });
    });

    container.querySelectorAll('[data-watch-nav]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (
          e.target.closest(
            '[data-watch-remove], .curve-toggle, .departure-line__maps, .watch-btn, button'
          )
        ) {
          return;
        }
        onNavigate?.({
          spotId: card.dataset.spotId,
          sessionDate: card.dataset.sessionDate,
          sport: card.dataset.sport,
        });
      });
      card.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onNavigate?.({
          spotId: card.dataset.spotId,
          sessionDate: card.dataset.sessionDate,
          sport: card.dataset.sport,
        });
      });
    });
  }

  function renderCard(session, { observationsBySpot, prefs, today, rideEntryBySpot, sportProfiles, radiusKm }) {
    const sessionPrefs = prefsForWatchSession(session, { prefs, sportProfiles }) ?? prefs;
    const date = new Date(`${session.session_date}T12:00:00`);
    const dayLabel = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const verdict = resolveVerdict(session);
    const isToday = session.session_date === today;
    const statusClass = GO_NO_GO_CLASS[verdict.state] ?? GO_NO_GO_CLASS.unknown;
    const verdictLabels = isToday
      ? WindmateCopy.watchlist.verdictLive
      : WindmateCopy.watchlist.verdictForecast;
    const statusLabel = verdictLabels[verdict.state] ?? verdict.state;
    const obs = observationsBySpot?.get(session.spot_id);
    const spot = spotForWatchSession(session, rideEntryBySpot);
    const spotName = escapeHtmlAttr(resolveSpotName(session, rideEntryBySpot));
    const liveStrip =
      isToday && obs && spot?.id
        ? WindmateObservations.renderLiveStrip(spot, obs, rideEntryBySpot?.get(session.spot_id), sessionPrefs, {
            curveKey: `watch:${session.id}`,
            sessionDate: session.session_date,
            sessionGoNoGo: verdict,
            suppressVerdictBanner: true,
          })
        : '';

    const forecastSummary = verdict.summary ?? '';
    const summaryBanner = forecastSummary
      ? `<div class="session-verdict-banner session-verdict-banner--go">${forecastSummary}</div>`
      : '';
    const cautionBanner =
      verdict.state !== 'go' && verdict.reason
        ? `<div class="session-verdict-banner session-verdict-banner--${verdict.state}">${verdict.reason}</div>`
        : '';

    const departureKey = WindmateDeparture.watchDepartureKey(session.id);
    const excitement = resolveSessionExcitement(session, {
      rideEntryBySpot,
      prefs,
      sportProfiles,
      radiusKm,
    });
    const watchStickers = WindmateSessionExcitement.renderStickers(excitement);

    return `
      <div
        class="watchlist-card watchlist-card--clickable watchlist-card--stickers bg-base-card border border-base-border rounded-xl p-4 ${isToday ? 'watchlist-card--today' : ''}"
        data-watch-nav
        data-watch-id="${escapeHtmlAttr(session.id)}"
        data-spot-id="${escapeHtmlAttr(session.spot_id)}"
        data-session-date="${escapeHtmlAttr(session.session_date)}"
        data-sport="${escapeHtmlAttr(session.sport)}"
        role="button"
        tabindex="0"
        aria-label="Go to ${spotName} on ${dayLabel}"
      >
        ${watchStickers}
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-white">${dayLabel} · ${spotName}</div>
            <div class="text-xs text-slate-500 mt-0.5">${session.sport}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="go-no-go-pill ${statusClass}">${statusLabel}</span>
            <button
              type="button"
              class="watchlist-remove-btn text-slate-500 hover:text-red-400 text-sm"
              data-watch-remove
              data-watch-spot="${escapeHtmlAttr(session.spot_id)}"
              data-watch-date="${escapeHtmlAttr(session.session_date)}"
              data-watch-sport="${escapeHtmlAttr(session.sport)}"
              aria-label="Remove watch"
            >×</button>
          </div>
        </div>
        ${summaryBanner}
        ${cautionBanner}
        ${liveStrip}
        <div class="departure-plan-group departure-plan-group--banner-only mt-2" data-departure-group="${departureKey}">
          <div class="departure-line-slot" data-departure-for="${departureKey}"></div>
        </div>
      </div>`;
  }

  function watchIcon(filled = false) {
    return `<svg class="watch-btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="8" cy="8" r="2" fill="${filled ? 'currentColor' : 'none'}"/>
    </svg>`;
  }

  function renderWatchButton(spotId, sessionDate, sport, watched) {
    const label = watched ? 'Remove from watchlist' : 'Watch this session';
    return `<button type="button" class="watch-btn${watched ? ' watch-btn--on' : ''}"
      data-watch-spot="${spotId}" data-watch-date="${sessionDate}" data-watch-sport="${sport}"
      aria-pressed="${watched}" title="${label}">${watchIcon(watched)}</button>`;
  }

  function patchWatchButtonEl(btn, watched) {
    if (!btn) return;
    const label = watched ? 'Remove from watchlist' : 'Watch this session';
    btn.classList.toggle('watch-btn--on', watched);
    btn.setAttribute('aria-pressed', watched ? 'true' : 'false');
    btn.title = label;
    btn.innerHTML = watchIcon(watched);
  }

  /** Unique spot ids for today's watches (all sports — live strip is per session sport). */
  function getWatchedSpotIdsForToday() {
    const today = WindmateForecastTime.planningToday();
    const ids = new Set(
      sessions.filter((s) => s.session_date === today).map((s) => s.spot_id)
    );
    return [...ids];
  }

  /** Unique spot ids across all watched sessions (for rideability include list). */
  function getWatchedSpotIds() {
    return [...new Set(sessions.map((s) => s.spot_id))];
  }

  function setOnChange(fn) {
    onChange = fn;
  }

  function setOnNavigate(fn) {
    onNavigate = fn;
  }

  function setOnStripError(fn) {
    onStripError = fn;
  }

  let stripRootBound = false;

  function bindStripInteractions(root) {
    if (!root || stripRootBound) return;
    stripRootBound = true;
    root.addEventListener(
      'click',
      (e) => {
        const removeBtn = e.target.closest('button[data-watch-remove]');
        if (!removeBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const { watchSpot: spotId, watchDate: sessionDate, watchSport: sport } = removeBtn.dataset;
        if (!spotId || !sessionDate || !sport) return;
        wlLog('strip × click (delegated)', { spotId, sessionDate, sport });
        void removeBySession(spotId, sessionDate, sport).catch((err) => {
          console.error(err);
          if (onStripError) onStripError(err);
        });
      },
      true
    );
  }

  return {
    load,
    isWatched,
    toggle,
    remove,
    renderStrip,
    canPatchStrip,
    patchObservations,
    renderWatchButton,
    patchWatchButtonEl,
    getWatchedSpotIdsForToday,
    getWatchedSpotIds,
    setOnChange,
    setOnNavigate,
    setOnStripError,
    bindStripInteractions,
    getSessionsSyncToken,
    whenMutationsIdle,
    setDebugWatchlist(enabled) {
      if (typeof window !== 'undefined') {
        window.WINDMATE_DEBUG_WATCHLIST = Boolean(enabled);
        try {
          window.localStorage?.setItem('windmate.debugWatchlist', enabled ? '1' : '0');
        } catch {
          /* ignore */
        }
      }
      wlLog('debug enabled', { enabled: Boolean(enabled) });
    },
    getDebugSnapshot: () => wlSnapshot(),
    getSessions: () => sessions,
    resolveVerdict,
    resolveSessionExcitement,
    prefsForWatchSession,
  };
})();
