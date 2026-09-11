/** Live strip, expand/collapse, and forecast-vs-actual curve per spot. */
const WindmateObservations = (() => {
  const expanded = new Set();
  const EXPANDED_REFRESH_MS = 5 * 60 * 1000;
  const NOW_MARKER_REFRESH_MS = 60 * 1000;
  let autoRefreshTimer = null;
  let nowMarkerTimer = null;
  let autoRefreshCallback = null;
  const toggleContextByRoot = new WeakMap();

  function syncCurveToggleUi(strip, curveKey) {
    if (!strip) return;
    const btn = strip.querySelector('.curve-toggle');
    const panel = strip.querySelector('.curve-panel');
    const isOpen = expanded.has(curveKey);
    if (btn) {
      btn.textContent = isOpen
        ? WindmateCopy.observations.hideCurve
        : WindmateCopy.observations.showCurve;
    }
    if (panel) panel.classList.toggle('hidden', !isOpen);
  }

  function handleCurveToggleClick(event) {
    const btn = event.target.closest('.curve-toggle');
    if (!btn) return;
    const root = btn.closest('[data-curve-toggle-root]');
    if (!root) return;
    const ctx = toggleContextByRoot.get(root);
    if (!ctx) return;

    event.stopPropagation();
    const { observationsBySpot, prefs, warningsBySpot, rideEntryBySpot, resolveCurvePrefs } = ctx;
    const spotId = btn.dataset.spotId;
    const curveKey = btn.dataset.curveKey ?? spotId;
    const strip = btn.closest('.live-strip');
    const panel = strip?.querySelector('.curve-panel');
    if (expanded.has(curveKey)) expanded.delete(curveKey);
    else expanded.add(curveKey);
    syncAutoRefresh();
    const obs = observationsBySpot.get(spotId);
    syncCurveToggleUi(strip, curveKey);
    if (panel && expanded.has(curveKey)) {
      const curvePrefs = resolveCurvePrefs?.(panel) ?? prefs;
      renderCurve(
        panel,
        obs,
        curvePrefs,
        curveRenderOptions(
          spotId,
          observationsBySpot,
          warningsBySpot,
          rideEntryBySpot,
          panel,
          curvePrefs
        )
      );
      if (autoRefreshCallback) void autoRefreshCallback();
    }
  }

  function ensureToggleRoot(root) {
    if (!root || root.dataset.curveToggleRoot === '1') return;
    root.dataset.curveToggleRoot = '1';
    root.addEventListener('click', handleCurveToggleClick);
  }

  function collapseAll() {
    expanded.clear();
    clearAutoRefresh();
    clearNowMarkerRefresh();
  }

  function clearAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function clearNowMarkerRefresh() {
    if (nowMarkerTimer) {
      clearInterval(nowMarkerTimer);
      nowMarkerTimer = null;
    }
  }

  function syncNowMarkerRefresh() {
    clearNowMarkerRefresh();
    if (!expanded.size) return;
    nowMarkerTimer = setInterval(() => {
      if (!expanded.size) {
        clearNowMarkerRefresh();
        return;
      }
      updateAllNowMarkers();
    }, NOW_MARKER_REFRESH_MS);
  }

  function fractionalHourNow() {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }

  function xFromDayHour(padL, innerW, hour) {
    return padL + (hour / 24) * innerW;
  }

  function xFromDayFraction(padL, innerW, dayFraction) {
    return xFromDayHour(padL, innerW, dayFraction);
  }

  function isTodayCurveDate(sessionDate, forecast) {
    const today = WindmateForecastTime.planningToday();
    const dateStr = sessionDate ?? forecast[0]?.time?.slice(0, 10);
    return dateStr === today;
  }

  function nowMarkerBeaufortColor() {
    const bf = WindmateWindColors.BEAUFORT.find((band) => band.force === 9);
    return bf?.color ?? '#c64e36';
  }

  function nowMarkerLayout(padL, innerW) {
    const hour = fractionalHourNow();
    return {
      x: xFromDayHour(padL, innerW, hour),
      timeLabel: formatFractionalHour(hour),
    };
  }

  function renderNowMarker(showNow, pad, innerH, innerW) {
    if (!showNow) return '';
    const color = nowMarkerBeaufortColor();
    const { x, timeLabel } = nowMarkerLayout(pad.l, innerW);
    const labelY = pad.t - 5;
    return `<g class="curve-now-marker-group" pointer-events="none">
      <text class="curve-now-marker__label" x="${x}" y="${labelY}" text-anchor="middle" fill="${color}">${timeLabel}</text>
      <line class="curve-now-marker" x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + innerH}" stroke="${color}"/>
    </g>`;
  }

  function updateAllNowMarkers() {
    document.querySelectorAll('.curve-chart[data-curve-show-now="1"]').forEach((chartRoot) => {
      const padL = Number(chartRoot.dataset.curvePadL);
      const innerW = Number(chartRoot.dataset.curveInnerW);
      const padT = Number(chartRoot.dataset.curvePadT);
      const innerH = Number(chartRoot.dataset.curveInnerH);
      if (!Number.isFinite(padL) || !Number.isFinite(innerW)) return;
      const { x, timeLabel } = nowMarkerLayout(padL, innerW);
      const line = chartRoot.querySelector('.curve-now-marker');
      const label = chartRoot.querySelector('.curve-now-marker__label');
      if (!line || !label) return;
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', String(padT));
      line.setAttribute('y2', String(padT + innerH));
      label.setAttribute('x', String(x));
      label.textContent = timeLabel;
    });
  }

  function syncAutoRefresh() {
    clearAutoRefresh();
    syncNowMarkerRefresh();
    if (!expanded.size || !autoRefreshCallback) return;
    autoRefreshTimer = setInterval(() => {
      if (!expanded.size) {
        clearAutoRefresh();
        return;
      }
      if (autoRefreshCallback) void autoRefreshCallback();
    }, EXPANDED_REFRESH_MS);
  }

  function setAutoRefreshCallback(fn) {
    autoRefreshCallback = fn;
    syncAutoRefresh();
  }

  function hasExpandedCurves() {
    return expanded.size > 0;
  }

  function sourceBadge(source) {
    if (source === 'station') return 'Station';
    if (source === 'windy') return 'Windy model';
    return 'Open-Meteo';
  }

  function dotClass(current, forecastHour) {
    if (!current) return 'live-dot--gray';
    if (forecastHour && !forecastHour.weatherOk) return 'live-dot--red';
    if (forecastHour?.rideable) return 'live-dot--green';
    if (forecastHour?.windOk && !forecastHour?.weatherOk) return 'live-dot--amber';
    if (forecastHour?.windOk && forecastHour?.tempOk === false) return 'live-dot--blue';
    if (forecastHour?.windOk) return 'live-dot--amber';
    return 'live-dot--gray';
  }

  function formatUpdated(obsEntry) {
    const current = obsEntry?.current;
    const freshnessAt = obsEntry?.fetchedAt ?? current?.observedAt;
    if (!freshnessAt) return '';
    const mins = Math.round((Date.now() - new Date(freshnessAt).getTime()) / 60000);
    if (mins < 1) return 'updated just now';
    return `updated ${mins} min ago`;
  }

  function tempSegment(current) {
    const parts = [];
    if (current.airTempC != null) parts.push(`${Math.round(current.airTempC)}°C air`);
    if (current.waterTempC != null) parts.push(`${Math.round(current.waterTempC)}°C water`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  }

  function renderWarningLines(warnings, prefs) {
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

  function renderGoNoGoPill(verdict) {
    if (!verdict?.state) return '';
    const labels = WindmateCopy.observations.mismatch;
    const label = labels[verdict.state] ?? verdict.state;
    const cls = `go-no-go-pill go-no-go-pill--${verdict.state}`;
    return `<span class="${cls}" role="status">${label}</span>`;
  }

  function renderLiveStrip(spot, obsEntry, rideEntry, prefs, options = {}) {
    const spotId = spot.id;
    const curveKey = options.curveKey ?? `spot:${spotId}`;
    const curveExpanded = expanded.has(curveKey);
    const current = obsEntry?.current;
    const warnings = rideEntry?.warnings ?? obsEntry?.today?.warnings ?? [];
    const warningLines = renderWarningLines(warnings, prefs);
    const forecastHour = obsEntry?.today?.forecast?.find((h) => {
      if (!current?.observedAt) return false;
      return new Date(h.time).getHours() === new Date(current.observedAt).getHours();
    });

    const hasCurveData =
      (obsEntry?.today?.actual?.length ?? 0) > 0 || (obsEntry?.today?.forecast?.length ?? 0) > 0;

    if (!current) {
      const curveToggle = hasCurveData
        ? `<button type="button" class="curve-toggle mt-2 text-[10px] text-emerald-400 hover:underline" data-spot-id="${spotId}" data-curve-key="${curveKey}">
            ${curveExpanded ? WindmateCopy.observations.hideCurve : WindmateCopy.observations.showCurve}
          </button>
          <div class="curve-panel ${curveExpanded ? '' : 'hidden'} mt-3" ${curvePanelAttrs(spotId, curveKey, options.sessionDate)}></div>`
        : '';
      return `
        <div class="live-strip live-strip--empty mb-3 p-3 rounded-lg bg-base border border-base-border">
          <div class="text-xs text-slate-500">${WindmateCopy.observations.noCurrent}</div>
          ${curveToggle}
          ${warningLines}
        </div>`;
    }

    const delta =
      current.deltaKt != null
        ? `<div class="text-[10px] text-slate-500 mt-0.5">Forecast said ${Math.round((current.windSpeed - current.deltaKt) * 10) / 10} kt — ${current.deltaKt >= 0 ? '▲' : '▼'} ${Math.abs(current.deltaKt)} kt</div>`
        : '';

    const stationMeta =
      current.stationName
        ? ` · ${current.stationName} (${current.stationDistance_km?.toFixed?.(1) ?? '?'} km)`
        : '';

    const hazard =
      current.hazardLabel
        ? `<div class="text-[10px] text-red-400 mt-0.5">${current.hazardLabel}</div>`
        : '';

    const tempSummary = rideEntry?.tempSummary;
    const windowSummary =
      tempSummary?.rideableAirMin != null
        ? `<div class="text-[10px] text-slate-500 mt-1">${WindmateCopy.observations.windowTemp(
            tempSummary.rideableAirMin,
            tempSummary.rideableAirMax,
            tempSummary.rideableWaterMin,
            tempSummary.rideableWaterMax
          )}</div>`
        : '';

    const sessionVerdict = options.sessionGoNoGo;
    const mismatch = obsEntry?.today?.summary?.mismatch;
    const verdict = sessionVerdict ?? mismatch;
    const pill = sessionVerdict ? '' : renderGoNoGoPill(mismatch);
    const verdictBanner =
      sessionVerdict?.reason && !options.suppressVerdictBanner
        ? `<div class="session-verdict-banner session-verdict-banner--${sessionVerdict.state} mt-2">${sessionVerdict.reason}</div>`
        : options.escalated && mismatch && (mismatch.state === 'caution' || mismatch.state === 'no_go')
          ? `<div class="watch-mismatch-banner mt-2">${WindmateCopy.observations.mismatchMessage(mismatch, current)}</div>`
          : '';

    const stripState = verdict?.state;
    return `
      <div class="live-strip mb-3 p-3 rounded-lg bg-base border border-base-border ${stripState === 'no_go' ? 'live-strip--no-go' : stripState === 'caution' ? 'live-strip--caution' : ''}">
        <div class="live-strip-content min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span class="live-dot ${dotClass(current, forecastHour)}"></span>
            <span class="font-semibold text-emerald-400">LIVE</span>
            ${pill}
            <span>${Math.round(current.windSpeed)} kt ${current.direction} · gusts ${Math.round(current.gusts)} kt${tempSegment(current)}${stationMeta}</span>
            <span class="text-slate-500">· ${formatUpdated(obsEntry)}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 sm:ml-auto">${sourceBadge(current.source)}</span>
          </div>
          ${delta}${hazard}${windowSummary}${verdictBanner}
        </div>
        <button type="button" class="curve-toggle mt-2 text-[10px] text-emerald-400 hover:underline" data-spot-id="${spotId}" data-curve-key="${curveKey}">
          ${curveExpanded ? WindmateCopy.observations.hideCurve : WindmateCopy.observations.showCurve}
        </button>
        <div class="curve-panel ${curveExpanded ? '' : 'hidden'} mt-3" ${curvePanelAttrs(spotId, curveKey, options.sessionDate)}></div>
        ${warningLines}
      </div>`;
  }

  function pickYStep(maxSpeed) {
    if (maxSpeed <= 18) return 5;
    if (maxSpeed <= 36) return 6;
    if (maxSpeed <= 54) return 10;
    return 15;
  }

  function buildYAxisTicks(maxY) {
    const step = pickYStep(maxY);
    const top = Math.ceil(maxY / step) * step;
    const ticks = [];
    for (let speed = 0; speed <= top; speed += step) ticks.push(speed);
    return { ticks, top };
  }

  function getModelDayHours(entry, modelId, dateStr) {
    const day = entry.models?.[modelId]?.days?.find((d) => d.date === dateStr);
    return day?.hours ?? [];
  }

  function plannerRangeFromDeparturePlan(plan) {
    if (!plan?.onWaterStart || !plan?.onWaterEnd) return null;
    return {
      start: WindmateRideableWindow.hourTimeKey(plan.onWaterStart),
      endExclusive: WindmateRideableWindow.hourTimeKey(plan.onWaterEnd),
    };
  }

  function plannerRangeFromMatrixGrid(card) {
    const grid = card?.querySelector('[data-matrix-grid]');
    const start = grid?.dataset?.departureWindowStart;
    const end = grid?.dataset?.departureWindowEnd;
    if (!start || !end) return null;
    return { start, endExclusive: end };
  }

  function resolvePlannerWindowRange(rideEntry, dateStr, prefs) {
    if (!rideEntry || !dateStr) return null;
    const dayHours = WindmateSessionRank.getDayHours(rideEntry, dateStr, getModelDayHours);
    if (!dayHours.length) return null;
    const pick = WindmateSessionRank.pickDepartureQualifyingWindow(
      rideEntry,
      dateStr,
      prefs,
      dayHours,
      { distanceKm: rideEntry.spot?.distance_km }
    );
    if (!pick) return null;
    return {
      start: WindmateRideableWindow.hourTimeKey(pick.run.start),
      endExclusive: WindmateDeparture.exclusiveEndAfterRun(pick.run.end),
    };
  }

  function qualifyingWindowHours(forecast, rideEntry, prefs) {
    if (!forecast.length) return [];
    const minWindow = WindmateRideableWindow.parseMinHours(prefs.min_rideable_window_hours);
    const dateStr = forecast[0].time.slice(0, 10);
    if (rideEntry?.models && Object.keys(rideEntry.models).length) {
      return WindmateRideableWindow.getQualifyingConsensusWindowHours(
        rideEntry,
        dateStr,
        minWindow,
        getModelDayHours,
        prefs
      );
    }
    const hours = forecast.map((hour) => ({
      ...hour,
      rideable: WindmateRideableWindow.rideableForPrefs(hour, prefs),
    }));
    WindmateRideableWindow.markHours(hours, minWindow);
    return hours.filter((hour) => hour.inRideableWindow);
  }

  function renderRideableWindowBands(windowHours, xSlotStart, pad, innerH, innerW) {
    const barW = innerW / 24;
    return windowHours
      .map((hour) => {
        const x = xSlotStart(hour.time);
        return `<rect x="${x}" y="${pad.t}" width="${barW}" height="${innerH}" fill="rgba(16,185,129,0.18)" stroke="#10b981" stroke-width="0.75" stroke-opacity="0.35"/>`;
      })
      .join('');
  }

  function renderPlannerWindowBand(plannerRange, xSlotStart, pad, innerH, innerW) {
    if (!plannerRange?.start || !plannerRange?.endExclusive) return '';
    const barW = innerW / 24;
    const x1 = xSlotStart(plannerRange.start);
    const x2 = xSlotStart(plannerRange.endExclusive);
    const w = Math.max(x2 - x1, barW);
    const y1 = pad.t;
    const y2 = pad.t + innerH;
    return `<rect x="${x1}" y="${y1}" width="${w}" height="${innerH}" fill="rgba(16,185,129,0.5)" stroke="#34d399" stroke-width="1.5" stroke-opacity="0.95"/>
      <line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y2}" stroke="#a7f3d0" stroke-width="2" opacity="0.9"/>
      <line x1="${x2}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#a7f3d0" stroke-width="2" opacity="0.9"/>`;
  }

  function curvePanelAttrs(spotId, curveKey, sessionDate) {
    const dateAttr = sessionDate ? ` data-session-date="${sessionDate}"` : '';
    return `data-spot-id="${spotId}" data-curve-key="${curveKey}"${dateAttr}`;
  }

  const LIVE_NOW_TIME_KEY = '__live_now__';

  function fractionalHourFromTime(time) {
    if (time === LIVE_NOW_TIME_KEY) return fractionalHourNow();
    if (WindmateForecastTime.parseForecastParts(time)) {
      return WindmateForecastTime.fractionalHourSlotCenter(time);
    }
    const d = new Date(time);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  function actualSeriesThroughNow(actual, current, showNow) {
    if (!showNow || !current) return actual;
    const last = actual[actual.length - 1];
    if (last && last.time === LIVE_NOW_TIME_KEY) return actual;
    return [
      ...actual,
      {
        time: LIVE_NOW_TIME_KEY,
        windSpeed: current.windSpeed,
        gusts: current.gusts ?? current.windSpeed,
      },
    ];
  }

  function fractionalHourSlotStart(time) {
    const parts = WindmateForecastTime.parseForecastParts(time);
    if (parts) return parts.h + parts.mi / 60;
    const d = new Date(time);
    return d.getHours() + d.getMinutes() / 60;
  }

  function formatFractionalHour(hour) {
    const h = Math.floor(hour) % 24;
    const m = Math.round((hour - Math.floor(hour)) * 60) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function roundKt(value) {
    return Math.round(value * 10) / 10;
  }

  /** Linear sample of wind/gust along the day axis; null if series empty or hour past last point. */
  function sampleSeriesAtHour(points, hour, allowBeyondLast = false) {
    if (!points?.length) return null;
    const sorted = [...points].sort(
      (a, b) => fractionalHourFromTime(a.time) - fractionalHourFromTime(b.time)
    );
    const samples = sorted.map((p) => ({
      h: fractionalHourFromTime(p.time),
      wind: p.windSpeed,
      gust: p.gusts ?? p.windSpeed,
    }));
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (hour < first.h) {
      return { wind: first.wind, gust: first.gust };
    }
    if (hour > last.h) {
      if (!allowBeyondLast) return null;
      return { wind: last.wind, gust: last.gust };
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      if (hour >= a.h && hour <= b.h) {
        const span = b.h - a.h;
        const t = span > 0 ? (hour - a.h) / span : 0;
        return {
          wind: a.wind + t * (b.wind - a.wind),
          gust: a.gust + t * (b.gust - a.gust),
        };
      }
    }
    return { wind: last.wind, gust: last.gust };
  }

  function bindCurveHover(chartRoot, layout) {
    const svg = chartRoot.querySelector('svg');
    const hit = chartRoot.querySelector('.curve-hit-area');
    const crosshair = chartRoot.querySelector('.curve-crosshair');
    const tooltip = chartRoot.querySelector('.curve-chart-tooltip');
    if (!svg || !hit || !crosshair || !tooltip) return;

    const { pad, innerW, innerH, height, actual, forecast } = layout;

    const hide = () => {
      crosshair.setAttribute('opacity', '0');
      tooltip.classList.add('curve-chart-tooltip--hidden');
    };

    const hourFromClientX = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const localX = ((clientX - rect.left) / rect.width) * layout.width;
      const clamped = Math.max(pad.l, Math.min(pad.l + innerW, localX));
      return ((clamped - pad.l) / innerW) * 24;
    };

    hit.addEventListener('mousemove', (e) => {
      const hour = hourFromClientX(e.clientX);
      const rect = svg.getBoundingClientRect();
      const viewBoxW = layout.width;
      const localX = ((e.clientX - rect.left) / rect.width) * viewBoxW;
      const x = Math.max(pad.l, Math.min(pad.l + innerW, localX));

      crosshair.setAttribute('x1', String(x));
      crosshair.setAttribute('x2', String(x));
      crosshair.setAttribute('y1', String(pad.t));
      crosshair.setAttribute('y2', String(pad.t + innerH));
      crosshair.setAttribute('opacity', '1');

      const actualSample = sampleSeriesAtHour(actual, hour, false);
      const forecastSample = sampleSeriesAtHour(forecast, hour, true);
      const lines = [
        `<div class="curve-chart-tooltip__time">${WindmateCopy.observations.curveTooltipTime(formatFractionalHour(hour))}</div>`,
      ];
      if (actualSample) {
        lines.push(
          `<div>${WindmateCopy.observations.curveTooltipActual(
            roundKt(actualSample.wind),
            roundKt(actualSample.gust)
          )}</div>`
        );
      }
      if (forecastSample) {
        lines.push(
          `<div>${WindmateCopy.observations.curveTooltipForecast(
            roundKt(forecastSample.wind),
            roundKt(forecastSample.gust)
          )}</div>`
        );
      }
      tooltip.innerHTML = lines.join('');
      tooltip.classList.remove('curve-chart-tooltip--hidden');

      const chartRect = chartRoot.getBoundingClientRect();
      let left = e.clientX - chartRect.left + 12;
      let top = e.clientY - chartRect.top - 8;
      const tipW = tooltip.offsetWidth || 160;
      const tipH = tooltip.offsetHeight || 48;
      if (left + tipW > chartRect.width - 4) left = e.clientX - chartRect.left - tipW - 12;
      if (top < 4) top = 4;
      if (top + tipH > chartRect.height - 4) top = chartRect.height - tipH - 4;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });

    hit.addEventListener('mouseleave', hide);
    chartRoot.addEventListener('mouseleave', hide);
  }

  function renderHazardBands(warnings, pad, innerH, innerW) {
    const barW = Math.max(innerW / 24, 8);
    return warnings
      .filter((w) => w.eventTime)
      .map((w) => {
        const center = WindmateForecastTime.parseForecastParts(w.eventTime)
          ? WindmateForecastTime.fractionalHourSlotCenter(w.eventTime)
          : fractionalHourFromTime(w.eventTime);
        const x = xFromDayFraction(pad.l, innerW, center) - barW / 2;
        const fill =
          w.type === 'storm_approaching' ? 'rgba(239,68,68,0.22)' : 'rgba(251,191,36,0.2)';
        const stroke = w.type === 'storm_approaching' ? '#f87171' : '#fbbf24';
        return `<rect x="${x}" y="${pad.t}" width="${barW}" height="${innerH}" fill="${fill}" stroke="${stroke}" stroke-width="0.75" stroke-opacity="0.45"/>`;
      })
      .join('');
  }

  function renderCurve(panel, obsEntry, prefs, options = {}) {
    if (!panel || !obsEntry) return;
    const container = panel;

    const actualRaw = obsEntry.today?.actual ?? [];
    const forecast = obsEntry.today?.forecast ?? [];
    const warnings = options.warnings ?? obsEntry.today?.warnings ?? [];
    const width = 640;
    const height = 156;
    const pad = { l: 44, r: 12, t: 16, b: 24 };
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;

    const sessionDate = options.sessionDate ?? forecast[0]?.time?.slice(0, 10);
    const showNow = isTodayCurveDate(sessionDate, forecast);
    const actual = actualSeriesThroughNow(actualRaw, obsEntry.current, showNow);

    const allSpeeds = [
      ...actual.map((p) => p.windSpeed),
      ...actual.map((p) => p.gusts ?? p.windSpeed),
      ...forecast.map((p) => p.windSpeed),
      ...forecast.map((p) => p.gusts ?? p.windSpeed),
      prefs.min_wind_knots,
      prefs.max_gust_knots,
    ];
    const rawMaxY = Math.max(20, ...allSpeeds) + 4;
    const minY = 0;
    const { ticks: yTicks, top: maxY } = buildYAxisTicks(rawMaxY);

    const xAtDayFraction = (dayFraction) => xFromDayFraction(pad.l, innerW, dayFraction);

    const xSlotStart = (time) =>
      xAtDayFraction(fractionalHourSlotStart(time));

    const xForSeriesPoint = (time) =>
      xAtDayFraction(fractionalHourFromTime(time));
    const yForSpeed = (speed) => pad.t + innerH - ((speed - minY) / (maxY - minY)) * innerH;

    const actualPath = actual
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForSeriesPoint(p.time).toFixed(1)},${yForSpeed(p.windSpeed).toFixed(1)}`)
      .join(' ');

    const actualGustPath = actual
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${xForSeriesPoint(p.time).toFixed(1)},${yForSpeed(p.gusts ?? p.windSpeed).toFixed(1)}`
      )
      .join(' ');

    const forecastPath = forecast
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForSeriesPoint(p.time).toFixed(1)},${yForSpeed(p.windSpeed).toFixed(1)}`)
      .join(' ');

    const forecastGustPath = forecast
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${xForSeriesPoint(p.time).toFixed(1)},${yForSpeed(p.gusts ?? p.windSpeed).toFixed(1)}`
      )
      .join(' ');

    const bandTop = yForSpeed(prefs.max_gust_knots);
    const bandBottom = yForSpeed(prefs.min_wind_knots);
    let plannerRange = options.plannerRange;
    if (plannerRange === undefined) {
      plannerRange = resolvePlannerWindowRange(options.rideEntry, sessionDate, prefs);
    }
    const rideableWindowHours = qualifyingWindowHours(forecast, options.rideEntry, prefs);
    const rideableWindowBands = renderRideableWindowBands(
      rideableWindowHours,
      xSlotStart,
      pad,
      innerH,
      innerW
    );
    const plannerWindowBand = renderPlannerWindowBand(plannerRange, xSlotStart, pad, innerH, innerW);
    const hazardBands = renderHazardBands(warnings, pad, innerH, innerW);

    const weatherBlocks = forecast
      .filter((h) => WindmateWeatherHazards.hasForecastRain(h))
      .map((h) => {
        const x = xSlotStart(h.time);
        const w = innerW / 24;
        return `<rect x="${x}" y="${pad.t}" width="${w}" height="${innerH}" fill="rgba(127,29,29,0.2)"/>`;
      })
      .join('');

    const yAxis = yTicks
      .map((speed) => {
        const y = yForSpeed(speed);
        const grid =
          speed > 0
            ? `<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="#1a2235" stroke-width="1"/>`
            : '';
        const label = `<text x="${pad.l - 8}" y="${y + 3.5}" class="fill-slate-500" font-size="10" text-anchor="end">${speed}</text>`;
        const tick = `<line x1="${pad.l - 4}" y1="${y}" x2="${pad.l}" y2="${y}" stroke="#475569" stroke-width="1"/>`;
        return `${grid}${tick}${label}`;
      })
      .join('');

    container.innerHTML = `
      <div class="curve-chart relative">
        <div class="curve-chart-tooltip curve-chart-tooltip--hidden" aria-hidden="true"></div>
        <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto" role="img" aria-label="Forecast vs actual wind curve in knots">
          <text x="${pad.l - 8}" y="${pad.t - 4}" class="fill-slate-500" font-size="9" text-anchor="end">kt</text>
          <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + innerH}" stroke="#334155" stroke-width="1"/>
          <line x1="${pad.l}" y1="${pad.t + innerH}" x2="${pad.l + innerW}" y2="${pad.t + innerH}" stroke="#334155" stroke-width="1"/>
          ${yAxis}
          <rect x="${pad.l}" y="${bandTop}" width="${innerW}" height="${Math.max(0, bandBottom - bandTop)}" fill="rgba(16,185,129,0.08)"/>
          ${rideableWindowBands}
          ${plannerWindowBand}
          ${weatherBlocks}
          ${hazardBands}
          <path d="${forecastGustPath}" fill="none" stroke="#f59e0b" stroke-width="1.75" stroke-dasharray="3 4" opacity="0.9"/>
          <path d="${forecastPath}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4"/>
          ${actualGustPath ? `<path d="${actualGustPath}" fill="none" stroke="#6ee7b7" stroke-width="1.75" stroke-dasharray="2 3" opacity="0.95"/>` : ''}
          ${actualPath ? `<path d="${actualPath}" fill="none" stroke="#10b981" stroke-width="2.5"/>` : ''}
          ${renderNowMarker(showNow, pad, innerH, innerW)}
          <line class="curve-crosshair" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + innerH}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
          <rect class="curve-hit-area" x="${pad.l}" y="${pad.t}" width="${innerW}" height="${innerH}" fill="transparent"/>
          <text x="${xAtDayFraction(0.5)}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="middle">00:00</text>
          <text x="${xAtDayFraction(12.5)}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="middle">12:00</text>
          <text x="${xAtDayFraction(23.5)}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="middle">23:00</text>
        </svg>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 mt-1">
          <span><span class="inline-block w-4 border-t-2 border-emerald-500 align-middle mr-1"></span>Actual wind</span>
          <span><span class="inline-block w-4 border-t-2 border-dashed border-emerald-300 align-middle mr-1"></span>${WindmateCopy.observations.actualGusts}</span>
          <span><span class="inline-block w-4 border-t-2 border-dashed border-slate-500 align-middle mr-1"></span>Forecast wind</span>
          <span><span class="inline-block w-4 border-t-2 border-dashed border-amber-500 align-middle mr-1"></span>Forecast gusts</span>
          <span><span class="inline-block w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/35 align-middle mr-1"></span>${WindmateCopy.observations.rideableWindow}</span>
          ${
            plannerRange
              ? `<span title="${WindmateCopy.observations.plannerWindowHint}"><span class="inline-block w-3 h-3 rounded-sm bg-emerald-400/55 border-2 border-emerald-300 align-middle mr-1"></span>${WindmateCopy.observations.plannerWindow}</span>`
              : ''
          }
        </div>
      </div>`;

    const chartRoot = container.querySelector('.curve-chart');
    if (chartRoot) {
      if (showNow) {
        chartRoot.dataset.curveShowNow = '1';
        chartRoot.dataset.curvePadL = String(pad.l);
        chartRoot.dataset.curveInnerW = String(innerW);
        chartRoot.dataset.curvePadT = String(pad.t);
        chartRoot.dataset.curveInnerH = String(innerH);
      } else {
        chartRoot.removeAttribute('data-curve-show-now');
      }
      bindCurveHover(chartRoot, { width, height, pad, innerW, innerH, actual, forecast });
    }
  }

  function curveWarningsFor(spotId, observationsBySpot, warningsBySpot) {
    const obs = observationsBySpot.get(spotId);
    return warningsBySpot?.get(spotId) ?? obs?.today?.warnings ?? [];
  }

  function cardExpectsDeparturePlan(card) {
    return Boolean(card?.querySelector('[data-departure-group]'));
  }

  /** Planner band must match /api/departure — no client-side guess on matrix cards. */
  function resolvePlannerRangeForCurve(card, spotId, sessionDate, rideEntry, prefs) {
    const fromGrid = plannerRangeFromMatrixGrid(card);
    if (fromGrid) return fromGrid;
    if (spotId && sessionDate && WindmateDeparture.cachedPlannerRange) {
      const fromCache = WindmateDeparture.cachedPlannerRange(spotId, sessionDate);
      if (fromCache) return fromCache;
    }
    if (cardExpectsDeparturePlan(card)) return null;
    if (sessionDate && rideEntry && prefs) return resolvePlannerWindowRange(rideEntry, sessionDate, prefs);
    return null;
  }

  function curveRenderOptions(spotId, observationsBySpot, warningsBySpot, rideEntryBySpot, panel, prefs) {
    const rideEntry = rideEntryBySpot?.get(spotId) ?? null;
    const sessionDate = panel?.dataset?.sessionDate;
    const card = panel?.closest('[data-spot-id]');
    return {
      warnings: curveWarningsFor(spotId, observationsBySpot, warningsBySpot),
      rideEntry,
      sessionDate,
      plannerRange: resolvePlannerRangeForCurve(card, spotId, sessionDate, rideEntry, prefs),
    };
  }

  function refreshPlannerBandOnCard(card, plan, obsEntry, prefs, extras = {}) {
    const panel = card?.querySelector('.curve-panel');
    if (!panel || panel.classList.contains('hidden') || !obsEntry) return;
    const spotId = panel.dataset.spotId;
    if (!spotId) return;
    const fromPlan = plannerRangeFromDeparturePlan(plan);
    renderCurve(panel, obsEntry, prefs, {
      warnings: extras.warnings,
      rideEntry: extras.rideEntry,
      sessionDate: extras.sessionDate ?? panel.dataset.sessionDate,
      plannerRange: fromPlan ?? plannerRangeFromMatrixGrid(card) ?? extras.fallbackPlannerRange,
    });
  }

  function patchLiveStripsInRoot(root, observationsBySpot, prefs, rideEntryBySpot) {
    if (!root) return;
    root.querySelectorAll('.live-strip').forEach((strip) => {
      const card = strip.closest('[data-spot-id]');
      if (!card) return;
      const spotId = card.dataset.spotId;
      const obs = observationsBySpot.get(spotId);
      if (!obs) return;
      const rideEntry = rideEntryBySpot?.get(spotId);
      const panel = strip.querySelector('.curve-panel');
      const sessionDate = panel?.dataset?.sessionDate;
      const curveToggle = strip.querySelector('.curve-toggle');
      const curveKey = curveToggle?.dataset?.curveKey ?? `spot:${spotId}`;
      const html = renderLiveStrip({ id: spotId }, obs, rideEntry, prefs, {
        curveKey,
        sessionDate,
        suppressVerdictBanner: true,
      });
      const wrap = document.createElement('div');
      wrap.innerHTML = html.trim();
      const next = wrap.firstElementChild;
      if (next) {
        strip.replaceWith(next);
        syncCurveToggleUi(next, curveKey);
      }
    });
  }

  function refreshExpandedCurves(
    root,
    observationsBySpot,
    prefs,
    warningsBySpot,
    rideEntryBySpot,
    resolveCurvePrefs = null
  ) {
    root.querySelectorAll('.curve-panel').forEach((panel) => {
      const spotId = panel.dataset.spotId;
      const curveKey = panel.dataset.curveKey ?? spotId;
      if (!spotId || !curveKey || !expanded.has(curveKey)) return;
      const obs = observationsBySpot.get(spotId);
      if (!obs) return;
      const curvePrefs = resolveCurvePrefs?.(panel) ?? prefs;
      renderCurve(
        panel,
        obs,
        curvePrefs,
        curveRenderOptions(
          spotId,
          observationsBySpot,
          warningsBySpot,
          rideEntryBySpot,
          panel,
          curvePrefs
        )
      );
    });
  }

  function bindToggles(
    root,
    observationsBySpot,
    prefs,
    warningsBySpot = null,
    rideEntryBySpot = null,
    resolveCurvePrefs = null
  ) {
    if (!root) return;
    ensureToggleRoot(root);
    toggleContextByRoot.set(root, {
      observationsBySpot,
      prefs,
      warningsBySpot,
      rideEntryBySpot,
      resolveCurvePrefs,
    });
    root.querySelectorAll('.live-strip').forEach((strip) => {
      const curveKey =
        strip.querySelector('.curve-toggle')?.dataset?.curveKey ??
        strip.querySelector('.curve-panel')?.dataset?.curveKey ??
        strip.querySelector('.curve-panel')?.dataset?.spotId;
      if (curveKey) syncCurveToggleUi(strip, curveKey);
    });
    refreshExpandedCurves(
      root,
      observationsBySpot,
      prefs,
      warningsBySpot,
      rideEntryBySpot,
      resolveCurvePrefs
    );
  }

  function renderVerdictBanner(verdict) {
    if (!verdict) return '';
    const summary = verdict.summary ?? '';
    const caution = verdict.state !== 'go' && verdict.reason ? verdict.reason : '';
    const text = caution || summary || verdict.reason;
    if (!text) return '';
    const tone = caution ? verdict.state : 'go';
    return `<div class="session-verdict-banner session-verdict-banner--${tone} mb-3">${text}${caution && summary ? `<span class="session-verdict-banner__summary"> · ${summary}</span>` : ''}</div>`;
  }

  function mapBySpotId(observationsData) {
    const map = new Map();
    for (const entry of observationsData?.spots ?? []) {
      map.set(entry.spot.id, entry);
    }
    return map;
  }

  return {
    renderLiveStrip,
    bindToggles,
    mapBySpotId,
    renderCurve,
    patchLiveStripsInRoot,
    syncCurveToggleUi,
    refreshPlannerBandOnCard,
    renderVerdictBanner,
    setAutoRefreshCallback,
    hasExpandedCurves,
    collapseAll,
    EXPANDED_REFRESH_MS,
  };
})();
