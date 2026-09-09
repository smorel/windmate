/** Mini spot map with forecast wind direction for the selected session day. */
const WindmateSpotMap = (() => {
  const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];

  const WIDTH = 176;
  const HEIGHT = 132;
  const ZOOM = 12;

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

  function tileUrl(zoom, x, y) {
    return `https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${x}/${y}.png`;
  }

  function renderTiles(lat, lng) {
    const world = latLngToWorldPx(lat, lng, ZOOM);
    const centerTileX = Math.floor(world.x / 256);
    const centerTileY = Math.floor(world.y / 256);

    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        const left = x * 256 - world.x + WIDTH / 2;
        const top = y * 256 - world.y + HEIGHT / 2;
        tiles.push(
          `<img class="spot-map-tile" src="${tileUrl(ZOOM, x, y)}" alt="" loading="lazy" style="left:${left}px;top:${top}px" />`
        );
      }
    }
    return tiles.join('');
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

  function renderIdealSectors(idealDirections) {
    if (!idealDirections?.length) return '';
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const radius = Math.min(WIDTH, HEIGHT) * 0.42;
    return idealDirections
      .map(
        (dir) =>
          `<path d="${idealWedge(cx, cy, radius, dir)}" class="spot-map-ideal-sector" />`
      )
      .join('');
  }

  /** Peak rideable hour for the selected day, else strongest wind hour. */
  function pickMapHour(dayHours) {
    if (!dayHours?.length) return null;
    const rideable = dayHours.filter((h) => h.rideable);
    const pool = rideable.length ? rideable : dayHours;
    return pool.reduce(
      (best, hour) => ((hour.windSpeed ?? 0) > (best?.windSpeed ?? -1) ? hour : best),
      null
    );
  }

  function renderWindArrow(wind, caption) {
    if (!wind) return '';
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const blowTo = ((wind.directionDeg + 180) % 360 + 360) % 360;
    const label = `${Math.round(wind.windSpeed ?? 0)} kt ${wind.direction ?? ''}`;

    return `
      <g class="spot-map-wind" transform="rotate(${blowTo} ${cx} ${cy})">
        <line x1="${cx}" y1="${cy + 18}" x2="${cx}" y2="${cy - 20}" class="spot-map-wind-shaft" />
        <path d="M ${cx} ${cy - 28} L ${cx - 7} ${cy - 12} L ${cx} ${cy - 16} L ${cx + 7} ${cy - 12} Z" class="spot-map-wind-head" />
      </g>
      <text x="${cx}" y="${HEIGHT - 16}" class="spot-map-wind-label" text-anchor="middle">${label}</text>
      ${caption ? `<text x="${cx}" y="${HEIGHT - 5}" class="spot-map-wind-caption" text-anchor="middle">${caption}</text>` : ''}`;
  }

  /**
   * @param {object} spot
   * @param {object[]} dayHours — primary model hours for selectedDayDate
   * @param {{ dayLabel?: string }} [options]
   */
  function renderForDay(spot, dayHours, options = {}) {
    const lat = spot?.latitude;
    const lng = spot?.longitude;
    if (lat == null || lng == null) return '';

    const hour = pickMapHour(dayHours);
    const wind = hour
      ? {
          directionDeg: hour.directionDeg,
          direction: hour.direction,
          windSpeed: hour.windSpeed,
        }
      : null;
    const hourLabel = hour ? WindmateForecastTime.formatForecastClock(hour.time) : '';
    const caption = hour
      ? WindmateCopy.map.sessionPeak(options.dayLabel ?? 'Session', hourLabel)
      : (options.dayLabel ?? '');

    const idealSectors = renderIdealSectors(spot.ideal_directions);
    const windArrow = renderWindArrow(wind, caption);
    const ariaLabel = wind
      ? WindmateCopy.map.aria(wind.windSpeed, wind.direction, options.dayLabel, hourLabel)
      : WindmateCopy.map.ariaEmpty(spot.name, options.dayLabel);

    return `
      <div class="spot-map spot-map--forecast" role="img" aria-label="${ariaLabel}">
        <div class="spot-map-tiles">${renderTiles(lat, lng)}</div>
        <svg class="spot-map-overlay" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">
          ${idealSectors}
          ${windArrow}
          <circle cx="${WIDTH / 2}" cy="${HEIGHT / 2}" r="4" class="spot-map-pin" />
        </svg>
      </div>`;
  }

  return { renderForDay, pickMapHour };
})();
