/** Mini spot map with ideal onshore arrows + session forecast pill for the selected day. */
const WindmateSpotMap = (() => {
  const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];

  const WIDTH = 176;
  const HEIGHT = 132;
  const DEFAULT_ZOOM = 12;
  const MIN_ZOOM = 8;
  const MAP_PADDING = 14;

  function compassToDeg(direction) {
    const index = COMPASS.indexOf(direction);
    return index >= 0 ? index * 22.5 : 0;
  }

  function latLngToWorldPx(lat, lng, zoom) {
    const scale = 256 * 2 ** zoom;
    const x = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { x, y };
  }

  /** Screen position in map logical pixels (matches viewBox). */
  function latLngToScreen(lat, lng, centerLat, centerLng, zoom) {
    const world = latLngToWorldPx(lat, lng, zoom);
    const center = latLngToWorldPx(centerLat, centerLng, zoom);
    return {
      x: world.x - center.x + WIDTH / 2,
      y: world.y - center.y + HEIGHT / 2,
    };
  }

  function pctAlong(px, span) {
    return (px / span) * 100;
  }

  function tileUrl(zoom, x, y) {
    return `https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${x}/${y}.png`;
  }

  function renderTiles(centerLat, centerLng, zoom, shiftX = 0, shiftY = 0, tileRing = 1) {
    const centerWorld = latLngToWorldPx(centerLat, centerLng, zoom);
    const anchorX = centerWorld.x + shiftX;
    const anchorY = centerWorld.y + shiftY;
    const centerTileX = Math.floor(anchorX / 256);
    const centerTileY = Math.floor(anchorY / 256);
    const tileWpct = pctAlong(256, WIDTH);
    const tileHpct = pctAlong(256, HEIGHT);

    const tiles = [];
    for (let dy = -tileRing; dy <= tileRing; dy++) {
      for (let dx = -tileRing; dx <= tileRing; dx++) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        const left = x * 256 - anchorX + WIDTH / 2;
        const top = y * 256 - anchorY + HEIGHT / 2;
        tiles.push(
          `<img class="spot-map-tile" src="${tileUrl(zoom, x, y)}" alt="" loading="lazy" style="left:${pctAlong(
            left,
            WIDTH
          )}%;top:${pctAlong(top, HEIGHT)}%;width:${tileWpct}%;height:${tileHpct}%" />`
        );
      }
    }
    return tiles.join('');
  }

  function computeViewport(spotLat, spotLng, liveStation) {
    const stationLat = liveStation?.lat;
    const stationLng = liveStation?.lng;
    const wedgeRadius = Math.min(WIDTH, HEIGHT) * 0.42;
    const pad = Math.max(MAP_PADDING, wedgeRadius * 0.35);

    if (stationLat == null || stationLng == null) {
      return {
        centerLat: spotLat,
        centerLng: spotLng,
        zoom: DEFAULT_ZOOM,
        shiftX: 0,
        shiftY: 0,
        spotPin: { x: WIDTH / 2, y: HEIGHT / 2 },
        stationPin: null,
      };
    }

    for (let zoom = DEFAULT_ZOOM; zoom >= MIN_ZOOM; zoom--) {
      const centerLat = (spotLat + stationLat) / 2;
      const centerLng = (spotLng + stationLng) / 2;
      const spotPin = latLngToScreen(spotLat, spotLng, centerLat, centerLng, zoom);
      const stationPin = latLngToScreen(stationLat, stationLng, centerLat, centerLng, zoom);
      const minX = Math.min(spotPin.x, stationPin.x) - pad;
      const maxX = Math.max(spotPin.x, stationPin.x) + pad;
      const minY = Math.min(spotPin.y, stationPin.y) - pad;
      const maxY = Math.max(spotPin.y, stationPin.y) + pad;
      if (maxX - minX <= WIDTH && maxY - minY <= HEIGHT) {
        const shiftX = (minX + maxX) / 2 - WIDTH / 2;
        const shiftY = (minY + maxY) / 2 - HEIGHT / 2;
        return {
          centerLat,
          centerLng,
          zoom,
          shiftX,
          shiftY,
          spotPin: {
            x: spotPin.x - shiftX,
            y: spotPin.y - shiftY,
          },
          stationPin: {
            x: stationPin.x - shiftX,
            y: stationPin.y - shiftY,
          },
        };
      }
    }

    const centerLat = (spotLat + stationLat) / 2;
    const centerLng = (spotLng + stationLng) / 2;
    const zoom = MIN_ZOOM;
    const spotPin = latLngToScreen(spotLat, spotLng, centerLat, centerLng, zoom);
    const stationPin = latLngToScreen(stationLat, stationLng, centerLat, centerLng, zoom);
    const minX = Math.min(spotPin.x, stationPin.x) - pad;
    const maxX = Math.max(spotPin.x, stationPin.x) + pad;
    const minY = Math.min(spotPin.y, stationPin.y) - pad;
    const maxY = Math.max(spotPin.y, stationPin.y) + pad;
    const shiftX = (minX + maxX) / 2 - WIDTH / 2;
    const shiftY = (minY + maxY) / 2 - HEIGHT / 2;
    return {
      centerLat,
      centerLng,
      zoom,
      shiftX,
      shiftY,
      spotPin: { x: spotPin.x - shiftX, y: spotPin.y - shiftY },
      stationPin: { x: stationPin.x - shiftX, y: stationPin.y - shiftY },
    };
  }

  function polarToXY(cx, cy, radius, bearingDeg) {
    const rad = ((bearingDeg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }

  function idealWedge(cx, cy, radius, direction) {
    const center = compassToDeg(direction);
    const start = center - 11.25;
    const end = center + 11.25;
    const [x1, y1] = polarToXY(cx, cy, radius, start);
    const [x2, y2] = polarToXY(cx, cy, radius, end);
    return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
  }

  function expandThreeFromBearingDeg(bearingDeg) {
    const idx = Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16;
    const center = COMPASS[idx];
    const n = COMPASS.length;
    const i = COMPASS.indexOf(center);
    if (i < 0) return [center];
    return [COMPASS[(i - 1 + n) % n], COMPASS[i], COMPASS[(i + 1) % n]];
  }

  /**
   * Wind-from sectors as compass wedges.
   * @param {'stored' | 'onshore' | 'onshore-low'} kind
   */
  function renderSectorWedges(directions, kind, pinX, pinY) {
    if (!directions?.length) return '';
    const radius = Math.min(WIDTH, HEIGHT) * 0.42;
    const cls = `spot-map-sector spot-map-sector--${kind}`;
    return directions
      .map((dir) => `<path d="${idealWedge(pinX, pinY, radius, dir)}" class="${cls}" />`)
      .join('');
  }

  /** Shoreline-inferred onshore (blue), not sport ideal. */
  function getOnshoreDirections(spot) {
    const fromApi = spot?.onshore_directions;
    if (Array.isArray(fromApi) && fromApi.length) {
      return {
        sectors: fromApi.filter(Boolean),
        status: spot.onshore_inference_status ?? 'ok',
        message: spot.onshore_inference_message ?? null,
      };
    }

    const status = spot?.onshore_inference_status;
    const message = spot?.onshore_inference_message ?? null;
    if (status === 'failed' || status === 'unavailable') {
      return { sectors: [], status, message };
    }
    if (status === 'pending' && !spot?.direction_inference) {
      return { sectors: [], status: 'pending', message: null };
    }

    const inference = spot?.direction_inference;
    if (!inference) {
      return { sectors: [], status: 'pending', message: null };
    }
    if (inference.confidence === 'failed') {
      return { sectors: [], status: 'failed', message: inference.error ?? 'inference_failed' };
    }

    let sectors = (inference.directions ?? []).filter(Boolean);
    if (!sectors.length && inference.bearing_deg != null) {
      sectors = expandThreeFromBearingDeg(inference.bearing_deg);
    }
    if (!sectors.length) {
      return { sectors: [], status: 'unavailable', message: inference.error ?? null };
    }

    return {
      sectors,
      status: inference.confidence === 'high' ? 'ok' : 'low',
      message: inference.error ?? null,
    };
  }

  function formatDirectionList(directions) {
    return (directions ?? []).join(' · ');
  }

  function mapHourIsVisible(hour, fullDayMode, dateStr) {
    if (typeof WindmatePlannerFullDay !== 'undefined' && WindmateForecastTime && WindmateRideableWindow) {
      const elapsed = Boolean(
        dateStr &&
          !WindmateForecastTime.isSessionPlanningHour(
            WindmateRideableWindow.hourTimeKey(hour.time),
            dateStr
          )
      );
      return WindmatePlannerFullDay.showMatrixCriterionSegment(hour, elapsed, fullDayMode);
    }
    if (fullDayMode) return hour.windSpeed != null;
    return Boolean(hour.rideable);
  }

  /**
   * Peak wind among hours visible in the matrix direction row.
   * @param {object[]} dayHours
   * @param {boolean} [fullDayMode]
   * @param {string} [dateStr]
   */
  function pickMapHour(dayHours, fullDayMode = false, dateStr = '') {
    if (!dayHours?.length) return null;
    const pool = dayHours.filter((h) => mapHourIsVisible(h, fullDayMode, dateStr));
    if (!pool.length) return null;
    return pool.reduce(
      (best, hour) => ((hour.windSpeed ?? 0) > (best?.windSpeed ?? -1) ? hour : best),
      null
    );
  }

  function resolveMapExposure(hour) {
    if (!hour) return 'unknown';
    if (hour.windExposure === 'onshore' || hour.windExposure === 'cross' || hour.windExposure === 'offshore') {
      return hour.windExposure;
    }
    if (hour.offshoreBlocked) return 'offshore';
    if (hour.idealWind) return 'onshore';
    return 'unknown';
  }

  function windExposureModifier(exposure) {
    if (exposure === 'onshore' || exposure === 'cross' || exposure === 'offshore') {
      return `spot-map-wind--${exposure}`;
    }
    return 'spot-map-wind--unknown';
  }

  function renderGeoPin(cx, cy) {
    return `
      <g class="spot-map-geo-pin" aria-hidden="true">
        <circle cx="${cx}" cy="${cy}" r="9" class="spot-map-geo-pin__ring" />
        <line x1="${cx - 11}" y1="${cy}" x2="${cx + 11}" y2="${cy}" class="spot-map-geo-pin__cross" />
        <line x1="${cx}" y1="${cy - 11}" x2="${cx}" y2="${cy + 11}" class="spot-map-geo-pin__cross" />
        <circle cx="${cx}" cy="${cy}" r="3.5" class="spot-map-geo-pin__dot" />
      </g>`;
  }

  function renderStationPin(cx, cy) {
    const r = 5.5;
    return `
      <g class="spot-map-station-pin" aria-hidden="true">
        <circle cx="${cx}" cy="${cy}" r="${r + 4}" class="spot-map-station-pin__halo" />
        <rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="1.5" class="spot-map-station-pin__body" />
      </g>`;
  }

  function getStoredIdealDirections(spot) {
    const list = spot?.ideal_directions ?? [];
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  /** Green = sport ideal (stored). Blue = shoreline onshore inference. */
  function renderDirectionLayers(spot, pinX, pinY) {
    const stored = getStoredIdealDirections(spot);
    const onshore = getOnshoreDirections(spot);
    const onshoreKind = onshore.status === 'low' ? 'onshore-low' : 'onshore';

    let svg = '';
    if (onshore.sectors.length) {
      svg += renderSectorWedges(onshore.sectors, onshoreKind, pinX, pinY);
    }
    if (stored.length) {
      svg += renderSectorWedges(stored, 'stored', pinX, pinY);
    }

    let legend = '';
    let legendDetail = '';
    if (stored.length && onshore.sectors.length) {
      legend = WindmateCopy.map.legendDual;
      legendDetail = WindmateCopy.map.legendDualDetail(
        formatDirectionList(stored),
        formatDirectionList(onshore.sectors)
      );
    } else if (onshore.sectors.length) {
      legend =
        onshore.status === 'low'
          ? WindmateCopy.map.legendOnshoreLow
          : WindmateCopy.map.legendOnshoreOnly;
      legendDetail = formatDirectionList(onshore.sectors);
    } else if (stored.length) {
      legend = WindmateCopy.map.legendStoredIdealOnly;
      legendDetail = formatDirectionList(stored);
    } else if (onshore.status === 'failed') {
      legend = WindmateCopy.map.legendOnshoreFailed;
      legendDetail = onshore.message ?? '';
    } else if (onshore.status === 'pending') {
      legend = WindmateCopy.map.legendOnshorePending;
    } else {
      legend = WindmateCopy.map.legendNoDirections;
      if (onshore.message) legendDetail = onshore.message;
    }

    return { svg, legend, legendDetail };
  }

  /** Session forecast at peak rideable hour — pill only (no arrow; matrix shows hourly direction). */
  function renderForecastPill(hour, exposure, pinX) {
    if (!hour) return '';
    const exposureCls = windExposureModifier(exposure);
    const label = `${Math.round(hour.windSpeed ?? 0)} kt ${hour.direction ?? ''}`;
    const pillW = Math.max(52, label.length * 5.2);
    const pillH = 12;
    const pillX = pinX - pillW / 2;
    const pillY = HEIGHT - 21;

    return `
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="3" class="spot-map-wind-pill ${exposureCls}" />
      <text x="${pinX}" y="${pillY + 9}" class="spot-map-wind-label ${exposureCls}" text-anchor="middle">${label}</text>`;
  }

  function renderSessionCaption(caption, pinX) {
    if (!caption) return '';
    return `<text x="${pinX}" y="${HEIGHT - 5}" class="spot-map-wind-caption" text-anchor="middle">${caption}</text>`;
  }

  function renderMismatchCallout(validation) {
    if (validation?.status !== 'mismatch') return '';
    return `<p class="spot-map-direction-mismatch" role="note">${WindmateCopy.map.directionMismatch}</p>`;
  }

  function buildAriaLabel(hour, spot, options, hourLabel, liveStation) {
    const storedList = getStoredIdealDirections(spot);
    const onshore = getOnshoreDirections(spot);
    const mismatch = spot?.direction_validation?.status === 'mismatch';

    const idealParts = [];
    if (storedList.length) idealParts.push(`stored sport ideal ${formatDirectionList(storedList)}`);
    if (onshore.sectors.length) {
      idealParts.push(`shoreline onshore ${formatDirectionList(onshore.sectors)}`);
    }
    const idealText = idealParts.length ? `. ${idealParts.join('; ')}` : '';

    const stationText =
      liveStation?.name
        ? `. Live meteo station ${liveStation.name} shown on map`
        : liveStation
          ? '. Live meteo station shown on map'
          : '';

    if (hour) {
      const forecast = `Peak forecast ${Math.round(hour.windSpeed ?? 0)} knots from ${hour.direction ?? ''} around ${hourLabel}`;
      if (mismatch) {
        return `${WindmateCopy.map.ariaMismatch(
          hour.windSpeed,
          hour.direction,
          options.dayLabel,
          hourLabel
        )}${idealText}${stationText}`;
      }
      return `${forecast} for ${options.dayLabel ?? 'session'}${idealText}${stationText}`;
    }
    return `${WindmateCopy.map.ariaEmpty(spot?.name, options.dayLabel)}${idealText}${stationText}`;
  }

  /**
   * @param {object} spot
   * @param {object[]} dayHours — primary model hours for selectedDayDate
   * @param {{ dayLabel?: string, fullDayMode?: boolean, dateStr?: string, liveStation?: { lat: number, lng: number, name?: string } | null }} [options]
   */
  function renderForDay(spot, dayHours, options = {}) {
    const lat = spot?.latitude;
    const lng = spot?.longitude;
    if (lat == null || lng == null) return '';

    const fullDayMode = Boolean(options.fullDayMode);
    const dateStr = options.dateStr ?? '';
    const hour = pickMapHour(dayHours, fullDayMode, dateStr);
    const hourLabel = hour ? WindmateForecastTime.formatForecastClock(hour.time) : '';
    const caption = hour
      ? WindmateCopy.map.sessionPeak(options.dayLabel ?? 'Session', hourLabel)
      : (options.dayLabel ?? '');

    const liveStation = options.liveStation ?? null;
    const view = computeViewport(lat, lng, liveStation);
    const pinX = view.spotPin.x;
    const pinY = view.spotPin.y;
    const exposure = resolveMapExposure(hour);
    const { svg: directionLayers, legend, legendDetail } = renderDirectionLayers(spot, pinX, pinY);
    const forecastPill = renderForecastPill(hour, exposure, pinX);
    const sessionCaption = renderSessionCaption(caption, pinX);
    const geoPin = renderGeoPin(pinX, pinY);
    const stationPin =
      view.stationPin ? renderStationPin(view.stationPin.x, view.stationPin.y) : '';
    const mismatchCallout = renderMismatchCallout(spot.direction_validation);
    const ariaLabel = buildAriaLabel(hour, spot, options, hourLabel, liveStation);
    const mapLegend =
      liveStation && legend
        ? `${legend} · ${WindmateCopy.map.legendLiveStation}`
        : liveStation
          ? WindmateCopy.map.legendLiveStation
          : legend;

    return `
      ${mismatchCallout}
      <div class="spot-map spot-map--forecast" role="img" aria-label="${ariaLabel}">
        <div class="spot-map-tiles">${renderTiles(
          view.centerLat,
          view.centerLng,
          view.zoom,
          view.shiftX ?? 0,
          view.shiftY ?? 0,
          liveStation ? 2 : 1
        )}</div>
        <svg class="spot-map-overlay" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          ${directionLayers}
          ${geoPin}
          ${stationPin}
          ${forecastPill}
          ${sessionCaption}
        </svg>
        ${mapLegend ? `<p class="spot-map-direction-legend">${mapLegend}</p>` : ''}
        ${legendDetail ? `<p class="spot-map-direction-legend spot-map-direction-legend--detail">${legendDetail}</p>` : ''}
      </div>`;
  }

  function replaceInCard(card, spot, dayHours, options = {}) {
    const wrap = card?.querySelector?.('.matrix-panel-map');
    if (!wrap || !spot) return;
    const html = renderForDay(spot, dayHours, options);
    wrap.innerHTML = html ? html.trim() : '';
  }

  return { renderForDay, pickMapHour, replaceInCard, WIDTH, HEIGHT };
})();
