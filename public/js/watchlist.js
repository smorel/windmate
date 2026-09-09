/** Session watchlist — planner pins and session-day panel */
const WindmateWatchlist = (() => {
  let sessions = [];
  let onChange = null;
  let onNavigate = null;

  const STATUS_CLASS = {
    on_track: 'watch-status--on-track',
    degrading: 'watch-status--degrading',
    at_risk: 'watch-status--at-risk',
    no_go: 'watch-status--no-go',
    unknown: 'watch-status--unknown',
  };

  const STATUS_LABEL = {
    on_track: 'On track',
    degrading: 'Degrading',
    at_risk: 'At risk',
    no_go: 'No go',
    unknown: 'Unknown',
  };

  async function load() {
    const data = await fetch('/api/watchlist').then((r) => r.json());
    sessions = data.sessions ?? [];
    return sessions;
  }

  function isWatched(spotId, sessionDate, sport) {
    return sessions.some(
      (s) => s.spot_id === spotId && s.session_date === sessionDate && s.sport === sport
    );
  }

  function watchId(spotId, sessionDate, sport) {
    return sessions.find(
      (s) => s.spot_id === spotId && s.session_date === sessionDate && s.sport === sport
    )?.id;
  }

  async function add(spotId, sessionDate, sport) {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId, sessionDate, sport }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? res.statusText);
    }
    await load();
    if (onChange) onChange();
    return res.json();
  }

  async function remove(id) {
    await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
    await load();
    if (onChange) onChange();
  }

  async function toggle(spotId, sessionDate, sport) {
    const id = watchId(spotId, sessionDate, sport);
    if (id) return remove(id);
    return add(spotId, sessionDate, sport);
  }

  function renderStrip(container, { activeSport, observationsBySpot, prefs }) {
    if (!container) return;
    const today = new Date().toISOString().slice(0, 10);
    const sorted = [...sessions].sort((a, b) => {
      if (a.session_date === today && b.session_date !== today) return -1;
      if (b.session_date === today && a.session_date !== today) return 1;
      return a.session_date.localeCompare(b.session_date);
    });

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
          .map((session) => renderCard(session, { observationsBySpot, prefs, today }))
          .join('')}
      </div>`;

    container.querySelectorAll('[data-watch-remove]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await remove(btn.dataset.watchRemove);
      });
    });

    container.querySelectorAll('[data-watch-nav]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-watch-remove], .curve-toggle, button')) return;
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

  function renderCard(session, { observationsBySpot, prefs, today }) {
    const date = new Date(`${session.session_date}T12:00:00`);
    const dayLabel = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const statusClass = STATUS_CLASS[session.status] ?? STATUS_CLASS.unknown;
    const statusLabel = STATUS_LABEL[session.status] ?? session.status;
    const summary = session.summary;
    const wind =
      summary?.windRange
        ? `${summary.windRange.min}–${summary.windRange.max} kt`
        : 'Forecast pending';
    const windowH = summary?.windowHours ?? '?';

    const isToday = session.session_date === today;
    const obs = observationsBySpot?.get(session.spot_id);
    const liveStrip =
      isToday && obs
        ? WindmateObservations.renderLiveStrip(
            session.spot,
            obs,
            null,
            prefs,
            { escalated: true }
          )
        : '';

    const mismatchBanner =
      isToday && session.mismatchBanner
        ? `<div class="watch-mismatch-banner">${session.mismatchBanner}</div>`
        : '';

    return `
      <div
        class="watchlist-card watchlist-card--clickable bg-base-card border border-base-border rounded-xl p-4 ${isToday ? 'watchlist-card--today' : ''}"
        data-watch-nav
        data-spot-id="${session.spot_id}"
        data-session-date="${session.session_date}"
        data-sport="${session.sport}"
        role="button"
        tabindex="0"
        aria-label="Go to ${session.spot_name} on ${dayLabel}"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-white">${dayLabel} · ${session.spot_name}</div>
            <div class="text-xs text-slate-400 mt-0.5">Forecast ${wind} · ${windowH} h window · ${session.sport}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="watch-status-pill ${statusClass}">${statusLabel}</span>
            <button type="button" class="text-slate-500 hover:text-red-400 text-sm" data-watch-remove="${session.id}" aria-label="Remove watch">×</button>
          </div>
        </div>
        ${mismatchBanner}
        ${liveStrip}
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

  function bindWatchButtons(root, sport) {
    root.querySelectorAll('[data-watch-spot]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const spotId = btn.dataset.watchSpot;
        const sessionDate = btn.dataset.watchDate;
        const watchSport = btn.dataset.watchSport ?? sport;
        try {
          await toggle(spotId, sessionDate, watchSport);
        } catch (err) {
          console.error(err);
        }
      });
    });
  }

  function getWatchedSpotIdsForToday(sport) {
    const today = new Date().toISOString().slice(0, 10);
    return sessions
      .filter((s) => s.session_date === today && s.sport === sport)
      .map((s) => s.spot_id);
  }

  function setOnChange(fn) {
    onChange = fn;
  }

  function setOnNavigate(fn) {
    onNavigate = fn;
  }

  return {
    load,
    isWatched,
    toggle,
    remove,
    renderStrip,
    renderWatchButton,
    bindWatchButtons,
    getWatchedSpotIdsForToday,
    setOnChange,
    setOnNavigate,
    getSessions: () => sessions,
  };
})();
