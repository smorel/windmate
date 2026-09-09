/** Live strip, expand/collapse, and forecast-vs-actual curve per spot. */
const WindmateObservations = (() => {
  const expanded = new Set();

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

  function formatUpdated(observedAt) {
    if (!observedAt) return '';
    const mins = Math.round((Date.now() - new Date(observedAt).getTime()) / 60000);
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
        ? `<button type="button" class="curve-toggle mt-2 text-[10px] text-emerald-400 hover:underline" data-spot-id="${spotId}">
            ${expanded.has(spotId) ? WindmateCopy.observations.hideCurve : WindmateCopy.observations.showCurve}
          </button>
          <div class="curve-panel ${expanded.has(spotId) ? '' : 'hidden'} mt-3" data-spot-id="${spotId}"></div>`
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
            <span class="text-slate-500">· ${formatUpdated(current.observedAt)}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 sm:ml-auto">${sourceBadge(current.source)}</span>
          </div>
          ${delta}${hazard}${windowSummary}${verdictBanner}
        </div>
        <button type="button" class="curve-toggle mt-2 text-[10px] text-emerald-400 hover:underline" data-spot-id="${spotId}">
          ${expanded.has(spotId) ? WindmateCopy.observations.hideCurve : WindmateCopy.observations.showCurve}
        </button>
        <div class="curve-panel ${expanded.has(spotId) ? '' : 'hidden'} mt-3" data-spot-id="${spotId}"></div>
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

  function qualifyingWindowHours(forecast, rideEntry, prefs) {
    if (!forecast.length) return [];
    const minWindow = WindmateRideableWindow.parseMinHours(prefs.min_rideable_window_hours);
    const dateStr = forecast[0].time.slice(0, 10);
    if (rideEntry?.models && Object.keys(rideEntry.models).length) {
      return WindmateRideableWindow.getLongestConsensusWindowHours(
        rideEntry,
        dateStr,
        minWindow,
        getModelDayHours
      );
    }
    const hours = forecast.map((hour) => ({ ...hour }));
    WindmateRideableWindow.markLongestQualifyingWindows(hours, minWindow);
    return hours.filter((hour) => hour.inRideableWindow);
  }

  function renderRideableWindowBands(windowHours, xForHour, pad, innerH, innerW) {
    const barW = innerW / 24;
    return windowHours
      .map((hour) => {
        const x = xForHour(hour.time);
        return `<rect x="${x - barW / 2}" y="${pad.t}" width="${barW}" height="${innerH}" fill="rgba(16,185,129,0.22)" stroke="#10b981" stroke-width="0.75" stroke-opacity="0.4"/>`;
      })
      .join('');
  }

  function renderHazardBands(warnings, xForHour, pad, innerH, innerW) {
    const barW = Math.max(innerW / 24, 8);
    return warnings
      .filter((w) => w.eventTime)
      .map((w) => {
        const x = xForHour(w.eventTime);
        const fill =
          w.type === 'storm_approaching' ? 'rgba(239,68,68,0.22)' : 'rgba(251,191,36,0.2)';
        const stroke = w.type === 'storm_approaching' ? '#f87171' : '#fbbf24';
        return `<rect x="${x - barW / 2}" y="${pad.t}" width="${barW}" height="${innerH}" fill="${fill}" stroke="${stroke}" stroke-width="0.75" stroke-opacity="0.45"/>`;
      })
      .join('');
  }

  function renderCurve(panel, obsEntry, prefs, options = {}) {
    if (!panel || !obsEntry) return;
    const container = panel;

    const actual = obsEntry.today?.actual ?? [];
    const forecast = obsEntry.today?.forecast ?? [];
    const warnings = options.warnings ?? obsEntry.today?.warnings ?? [];
    const width = 640;
    const height = 156;
    const pad = { l: 44, r: 12, t: 16, b: 24 };
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;

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

    const xForHour = (time) => {
      const h = new Date(time).getHours() + new Date(time).getMinutes() / 60;
      return pad.l + (h / 24) * innerW;
    };
    const yForSpeed = (speed) => pad.t + innerH - ((speed - minY) / (maxY - minY)) * innerH;

    const actualPath = actual
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForHour(p.time).toFixed(1)},${yForSpeed(p.windSpeed).toFixed(1)}`)
      .join(' ');

    const forecastPath = forecast
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForHour(p.time).toFixed(1)},${yForSpeed(p.windSpeed).toFixed(1)}`)
      .join(' ');

    const forecastGustPath = forecast
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${xForHour(p.time).toFixed(1)},${yForSpeed(p.gusts ?? p.windSpeed).toFixed(1)}`
      )
      .join(' ');

    const bandTop = yForSpeed(prefs.max_gust_knots);
    const bandBottom = yForSpeed(prefs.min_wind_knots);

    const rideableWindowHours = qualifyingWindowHours(forecast, options.rideEntry, prefs);
    const rideableWindowBands = renderRideableWindowBands(
      rideableWindowHours,
      xForHour,
      pad,
      innerH,
      innerW
    );
    const hazardBands = renderHazardBands(warnings, xForHour, pad, innerH, innerW);

    const weatherBlocks = forecast
      .filter((h) => WindmateWeatherHazards.hasForecastRain(h))
      .map((h) => {
        const x = xForHour(h.time);
        const w = innerW / 24;
        return `<rect x="${x - w / 2}" y="${pad.t}" width="${w}" height="${innerH}" fill="rgba(127,29,29,0.2)"/>`;
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
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto" role="img" aria-label="Forecast vs actual wind curve in knots">
        <text x="${pad.l - 8}" y="${pad.t - 4}" class="fill-slate-500" font-size="9" text-anchor="end">kt</text>
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + innerH}" stroke="#334155" stroke-width="1"/>
        <line x1="${pad.l}" y1="${pad.t + innerH}" x2="${pad.l + innerW}" y2="${pad.t + innerH}" stroke="#334155" stroke-width="1"/>
        ${yAxis}
        <rect x="${pad.l}" y="${bandTop}" width="${innerW}" height="${Math.max(0, bandBottom - bandTop)}" fill="rgba(16,185,129,0.08)"/>
        ${rideableWindowBands}
        ${weatherBlocks}
        ${hazardBands}
        <path d="${forecastGustPath}" fill="none" stroke="#f59e0b" stroke-width="1.75" stroke-dasharray="3 4" opacity="0.9"/>
        <path d="${forecastPath}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4"/>
        ${actualPath ? `<path d="${actualPath}" fill="none" stroke="#10b981" stroke-width="2.5"/>` : ''}
        <text x="${pad.l}" y="${height - 4}" class="fill-slate-500" font-size="10">00:00</text>
        <text x="${pad.l + innerW / 2}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="middle">12:00</text>
        <text x="${pad.l + innerW}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="end">23:00</text>
      </svg>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 mt-1">
        <span><span class="inline-block w-4 border-t-2 border-emerald-500 align-middle mr-1"></span>Actual wind</span>
        <span><span class="inline-block w-4 border-t-2 border-dashed border-slate-500 align-middle mr-1"></span>Forecast wind</span>
        <span><span class="inline-block w-4 border-t-2 border-dashed border-amber-500 align-middle mr-1"></span>Forecast gusts</span>
        <span><span class="inline-block w-3 h-3 rounded-sm bg-emerald-500/25 border border-emerald-500/40 align-middle mr-1"></span>${WindmateCopy.observations.rideableWindow}</span>
      </div>`;
  }

  function curveWarningsFor(spotId, observationsBySpot, warningsBySpot) {
    const obs = observationsBySpot.get(spotId);
    return warningsBySpot?.get(spotId) ?? obs?.today?.warnings ?? [];
  }

  function curveRenderOptions(spotId, observationsBySpot, warningsBySpot, rideEntryBySpot) {
    return {
      warnings: curveWarningsFor(spotId, observationsBySpot, warningsBySpot),
      rideEntry: rideEntryBySpot?.get(spotId) ?? null,
    };
  }

  function refreshExpandedCurves(root, observationsBySpot, prefs, warningsBySpot, rideEntryBySpot) {
    root.querySelectorAll('.curve-panel').forEach((panel) => {
      const spotId = panel.dataset.spotId;
      if (!spotId || !expanded.has(spotId)) return;
      const obs = observationsBySpot.get(spotId);
      if (!obs) return;
      renderCurve(panel, obs, prefs, curveRenderOptions(spotId, observationsBySpot, warningsBySpot, rideEntryBySpot));
    });
  }

  function bindToggles(root, observationsBySpot, prefs, warningsBySpot = null, rideEntryBySpot = null) {
    root.querySelectorAll('.curve-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const spotId = btn.dataset.spotId;
        const strip = btn.closest('.live-strip');
        const panel = strip?.querySelector('.curve-panel');
        if (expanded.has(spotId)) expanded.delete(spotId);
        else expanded.add(spotId);
        const obs = observationsBySpot.get(spotId);
        btn.textContent = expanded.has(spotId)
          ? WindmateCopy.observations.hideCurve
          : WindmateCopy.observations.showCurve;
        if (panel) {
          panel.classList.toggle('hidden', !expanded.has(spotId));
          if (expanded.has(spotId)) {
            renderCurve(
              panel,
              obs,
              prefs,
              curveRenderOptions(spotId, observationsBySpot, warningsBySpot, rideEntryBySpot)
            );
          }
        }
      });
    });
    refreshExpandedCurves(root, observationsBySpot, prefs, warningsBySpot, rideEntryBySpot);
  }

  function renderVerdictBanner(verdict) {
    if (!verdict?.reason) return '';
    return `<div class="session-verdict-banner session-verdict-banner--${verdict.state} mb-3">${verdict.reason}</div>`;
  }

  function mapBySpotId(observationsData) {
    const map = new Map();
    for (const entry of observationsData?.spots ?? []) {
      map.set(entry.spot.id, entry);
    }
    return map;
  }

  return { renderLiveStrip, bindToggles, mapBySpotId, renderCurve, renderVerdictBanner };
})();
