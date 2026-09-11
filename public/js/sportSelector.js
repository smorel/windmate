/** Dashboard sport switcher with horizon status dots */
const WindmateSportSelector = (() => {
  const SPORT_ICONS = {
    wingfoiling: '🪽',
    sailing: '⛵',
    kitesurfing: '🪁',
    windsurfing: '🏄',
    kitefoiling: '🦅',
    parawing: '🪂',
  };

  let container = null;
  let open = false;
  let summary = null;
  let profiles = [];
  let activeSport = 'wingfoiling';
  let onSwitch = null;
  let busy = false;

  function dotClass(hasOpportunity) {
    return hasOpportunity ? 'sport-dot sport-dot--green' : 'sport-dot sport-dot--gray';
  }

  function ariaLabel(displayName, hasOpportunity) {
    return hasOpportunity
      ? `${displayName} — session possible this week`
      : `${displayName} — no sessions on horizon`;
  }

  function enabledProfiles() {
    return profiles.filter((p) => p.enabled).sort((a, b) => {
      const nameA = a.display_name ?? a.sport;
      const nameB = b.display_name ?? b.sport;
      return nameA.localeCompare(nameB);
    });
  }

  function profileForSport(sport) {
    return profiles.find((p) => p.sport === sport);
  }

  function summaryForSport(sport) {
    return summary?.sports?.find((s) => s.sport === sport);
  }

  function displayName(sport) {
    const fromSummary = summaryForSport(sport)?.display_name;
    if (fromSummary) return fromSummary;
    const profile = profileForSport(sport);
    return profile?.display_name ?? sport;
  }

  function sportColor(sport) {
    return summaryForSport(sport)?.color ?? '#10b981';
  }

  function closeMenu() {
    open = false;
    render();
  }

  function render() {
    if (!container) return;
    const enabled = enabledProfiles();
    if (!enabled.length) {
      container.innerHTML = '';
      return;
    }

    const active = enabled.find((p) => p.sport === activeSport) ?? enabled[0];
    const activeSummary = summaryForSport(active.sport);
    const hasOpp = activeSummary?.has_opportunity ?? false;
    const icon = SPORT_ICONS[active.sport] ?? '';
    const color = sportColor(active.sport);
    const single = enabled.length === 1;

    const trigger = single
      ? `<div class="sport-selector-trigger sport-selector-trigger--single" style="border-color:${color}40">
          <span class="sport-selector-icon">${icon}</span>
          <span class="sport-selector-label" style="color:${color}">${displayName(active.sport)}</span>
          <span class="${dotClass(hasOpp)}" aria-hidden="true"></span>
        </div>`
      : `<button type="button" class="sport-selector-trigger" aria-expanded="${open}" aria-haspopup="listbox" style="border-color:${color}40">
          <span class="sport-selector-icon">${icon}</span>
          <span class="sport-selector-label" style="color:${color}">${displayName(active.sport)}</span>
          <span class="${dotClass(hasOpp)}" aria-hidden="true"></span>
          <span class="sport-selector-chevron" aria-hidden="true">▾</span>
        </button>`;

    const menu = !single && open
      ? `<ul class="sport-selector-menu" role="listbox">
          ${enabled
            .map((p) => {
              const s = summaryForSport(p.sport);
              const selected = p.sport === activeSport;
              return `<li role="option" aria-selected="${selected}">
                <button type="button" class="sport-selector-option ${selected ? 'sport-selector-option--active' : ''}"
                  data-sport="${p.sport}"
                  style="${selected ? `border-left-color:${sportColor(p.sport)}` : ''}"
                  aria-label="${ariaLabel(displayName(p.sport), s?.has_opportunity ?? false)}">
                  <span>${displayName(p.sport)}</span>
                  <span class="${dotClass(s?.has_opportunity ?? false)}"></span>
                </button>
              </li>`;
            })
            .join('')}
        </ul>`
      : '';

    container.innerHTML = `${trigger}${menu}`;
    container.classList.toggle('sport-selector--open', open);
    container.classList.toggle('sport-selector--busy', busy);

    if (!single) {
      const btn = container.querySelector('.sport-selector-trigger');
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        open = !open;
        render();
      });
      container.querySelectorAll('.sport-selector-option').forEach((opt) => {
        opt.addEventListener('click', async (e) => {
          e.stopPropagation();
          const sport = opt.dataset.sport;
          if (sport === activeSport || busy) {
            closeMenu();
            return;
          }
          activeSport = sport;
          closeMenu();
          if (onSwitch) await onSwitch(sport);
        });
      });
    }
  }

  function isInsideSelector(target) {
    if (!container || !target) return false;
    if (container.contains(target)) return true;
    // After render() replaces innerHTML, the click target may be detached but still
    // belong to this selector — walk up if the node was removed mid-event.
    return Boolean(target.closest?.('#sport-selector'));
  }

  function bindOutsideClick() {
    document.addEventListener('click', (e) => {
      if (!open) return;
      if (!isInsideSelector(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  function init(el, options = {}) {
    container = el;
    onSwitch = options.onSwitch ?? null;
    bindOutsideClick();
    render();
  }

  function setState({ profiles: nextProfiles, activeSport: nextActive, summary: nextSummary }) {
    if (nextProfiles) profiles = nextProfiles;
    if (nextActive) activeSport = nextActive;
    if (nextSummary !== undefined) summary = nextSummary;
    render();
  }

  function getActiveSport() {
    return activeSport;
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    render();
  }

  return { init, setState, getActiveSport, closeMenu, setBusy };
})();
