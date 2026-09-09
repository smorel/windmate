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

  function renderLiveStrip(spotId, obsEntry, rideEntry, prefs) {
    const current = obsEntry?.current;
    const warnings = rideEntry?.warnings ?? obsEntry?.today?.warnings ?? [];
    const forecastHour = obsEntry?.today?.forecast?.find((h) => {
      if (!current?.observedAt) return false;
      return new Date(h.time).getHours() === new Date(current.observedAt).getHours();
    });

    if (!current) {
      return `<div class="live-strip live-strip--empty text-xs text-slate-500 mb-3">${WindmateCopy.observations.noCurrent}</div>`;
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

    const warningLines = warnings
      .map(
        (w) =>
          `<div class="text-[10px] mt-1 ${w.type === 'storm_approaching' ? 'text-red-400' : 'text-amber-400'}">⚠️ ${WindmateForecastTime.sessionWarningMessage(w, prefs)}</div>`
      )
      .join('');

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

    return `
      <div class="live-strip mb-3 p-3 rounded-lg bg-base border border-base-border">
        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span class="live-dot ${dotClass(current, forecastHour)}"></span>
          <span class="font-semibold text-emerald-400">LIVE</span>
          <span>${Math.round(current.windSpeed)} kt ${current.direction} · gusts ${Math.round(current.gusts)} kt${tempSegment(current)}${stationMeta}</span>
          <span class="text-slate-500">· ${formatUpdated(current.observedAt)}</span>
          <span class="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">${sourceBadge(current.source)}</span>
        </div>
        ${delta}${hazard}${windowSummary}${warningLines}
        <button type="button" class="curve-toggle mt-2 text-[10px] text-emerald-400 hover:underline" data-spot-id="${spotId}">
          ${expanded.has(spotId) ? WindmateCopy.observations.hideCurve : WindmateCopy.observations.showCurve}
        </button>
        <div id="curve-${spotId}" class="${expanded.has(spotId) ? '' : 'hidden'} mt-3"></div>
      </div>`;
  }

  function renderCurve(spotId, obsEntry, prefs) {
    const container = document.getElementById(`curve-${spotId}`);
    if (!container || !obsEntry) return;

    const actual = obsEntry.today?.actual ?? [];
    const forecast = obsEntry.today?.forecast ?? [];
    const warnings = obsEntry.today?.warnings ?? [];
    const width = 640;
    const height = 140;
    const pad = { l: 32, r: 12, t: 12, b: 24 };
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;

    const allSpeeds = [
      ...actual.map((p) => p.windSpeed),
      ...forecast.map((p) => p.windSpeed),
      prefs.min_wind_knots,
      prefs.max_gust_knots,
    ];
    const maxY = Math.max(20, ...allSpeeds) + 4;
    const minY = 0;

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

    const bandTop = yForSpeed(prefs.max_gust_knots);
    const bandBottom = yForSpeed(prefs.min_wind_knots);

    const hazardMarkers = warnings
      .map((w) => {
        const x = xForHour(w.eventTime);
        const color = w.type === 'storm_approaching' ? '#f87171' : '#fbbf24';
        return `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + innerH}" stroke="${color}" stroke-dasharray="4 3" stroke-width="1.5"/>`;
      })
      .join('');

    const weatherBlocks = forecast
      .filter((h) => !h.weatherOk)
      .map((h) => {
        const x = xForHour(h.time);
        const w = innerW / 24;
        return `<rect x="${x - w / 2}" y="${pad.t}" width="${w}" height="${innerH}" fill="rgba(239,68,68,0.12)"/>`;
      })
      .join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto" role="img" aria-label="Forecast vs actual wind curve">
        <rect x="${pad.l}" y="${bandTop}" width="${innerW}" height="${Math.max(0, bandBottom - bandTop)}" fill="rgba(16,185,129,0.08)"/>
        ${weatherBlocks}
        ${hazardMarkers}
        <path d="${forecastPath}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4"/>
        ${actualPath ? `<path d="${actualPath}" fill="none" stroke="#10b981" stroke-width="2.5"/>` : ''}
        <text x="${pad.l}" y="${height - 4}" class="fill-slate-500" font-size="10">00:00</text>
        <text x="${pad.l + innerW / 2}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="middle">12:00</text>
        <text x="${pad.l + innerW}" y="${height - 4}" class="fill-slate-500" font-size="10" text-anchor="end">23:00</text>
      </svg>
      <div class="flex gap-4 text-[10px] text-slate-500 mt-1">
        <span><span class="inline-block w-4 border-t-2 border-emerald-500 align-middle mr-1"></span>Actual</span>
        <span><span class="inline-block w-4 border-t-2 border-dashed border-slate-500 align-middle mr-1"></span>Forecast</span>
      </div>`;
  }

  function bindToggles(root, observationsBySpot, prefs) {
    root.querySelectorAll('.curve-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const spotId = btn.dataset.spotId;
        if (expanded.has(spotId)) expanded.delete(spotId);
        else expanded.add(spotId);
        const obs = observationsBySpot.get(spotId);
        btn.textContent = expanded.has(spotId)
          ? WindmateCopy.observations.hideCurve
          : WindmateCopy.observations.showCurve;
        const panel = document.getElementById(`curve-${spotId}`);
        if (panel) {
          panel.classList.toggle('hidden', !expanded.has(spotId));
          if (expanded.has(spotId)) renderCurve(spotId, obs, prefs);
        }
      });
    });
  }

  function mapBySpotId(observationsData) {
    const map = new Map();
    for (const entry of observationsData?.spots ?? []) {
      map.set(entry.spot.id, entry);
    }
    return map;
  }

  return { renderLiveStrip, bindToggles, mapBySpotId, renderCurve };
})();
