const { DIRECTIONS, degreesToCompass } = require('../../utils/geo');
const { DEFAULT_PARAMS } = require('./constants');

/** @param {number} lat @param {number} lng @param {number} refLat @param {number} refLng */
function toLocalMeters(lat, lng, refLat, refLng) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  return {
    x: (lng - refLng) * mPerDegLng,
    y: (lat - refLat) * mPerDegLat,
  };
}

/** @param {{ x: number, y: number }} p */
function fromLocalMeters(p, refLat, refLng) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  return {
    lat: refLat + p.y / mPerDegLat,
    lng: refLng + p.x / mPerDegLng,
  };
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function dist(a, b) {
  return Math.sqrt(dist2(a, b));
}

/** Douglas–Peucker in local meters. */
function simplifyPolyline(points, epsilon) {
  if (points.length <= 2) return points.slice();

  function perpDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return dist(point, lineStart);
    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / len2;
    const proj = {
      x: lineStart.x + t * dx,
      y: lineStart.y + t * dy,
    };
    return dist(point, proj);
  }

  function rdp(pts) {
    let maxDist = 0;
    let index = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const d = perpDistance(pts[i], pts[0], pts[end]);
      if (d > maxDist) {
        index = i;
        maxDist = d;
      }
    }
    if (maxDist > epsilon) {
      const left = rdp(pts.slice(0, index + 1));
      const right = rdp(pts.slice(index));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[end]];
  }

  return rdp(points);
}

/** Single Chaikin corner-cutting pass. */
function chaikinOnce(points) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    out.push(
      { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y },
      { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y }
    );
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 */
function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return { point: { x: a.x, y: a.y }, t: 0, dist: dist(p, a) };
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: dist(p, point) };
}

/**
 * Closest point on polyline + cumulative arc length at that point.
 * @param {{ x: number, y: number }[]} polyline
 */
function closestOnPolyline(p, polyline) {
  if (!polyline.length) return null;
  if (polyline.length === 1) {
    return {
      point: polyline[0],
      segmentIndex: 0,
      arcLength: 0,
      dist: dist(p, polyline[0]),
    };
  }

  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum.push(cum[i - 1] + dist(polyline[i - 1], polyline[i]));
  }

  let best = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const hit = closestPointOnSegment(p, polyline[i], polyline[i + 1]);
    const arc = cum[i] + hit.t * dist(polyline[i], polyline[i + 1]);
    if (!best || hit.dist < best.dist) {
      best = { point: hit.point, segmentIndex: i, arcLength: arc, dist: hit.dist };
    }
  }
  return best;
}

/** @param {number} targetArc @param {{ x: number, y: number }[]} polyline @param {number[]} cum */
function pointAtArcLength(targetArc, polyline, cum) {
  const total = cum[cum.length - 1];
  if (total === 0) return polyline[0];
  const s = Math.max(0, Math.min(total, targetArc));

  for (let i = 1; i < polyline.length; i++) {
    if (s <= cum[i]) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen === 0 ? 0 : (s - cum[i - 1]) / segLen;
      return {
        x: polyline[i - 1].x + t * (polyline[i].x - polyline[i - 1].x),
        y: polyline[i - 1].y + t * (polyline[i].y - polyline[i - 1].y),
      };
    }
  }
  return polyline[polyline.length - 1];
}

function bearingFromVector(dx, dy) {
  const mathDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return ((mathDeg % 360) + 360) % 360;
}

function angleBetweenDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Center sector ±1 on 16-point compass. */
function expandToThreeSectors(centerLabel) {
  const idx = DIRECTIONS.indexOf(centerLabel);
  if (idx < 0) return [centerLabel];
  const n = DIRECTIONS.length;
  return [DIRECTIONS[(idx - 1 + n) % n], DIRECTIONS[idx], DIRECTIONS[(idx + 1) % n]];
}

/**
 * @param {number} refLat
 * @param {number} refLng
 * @param {{ lat: number, lng: number }[]} boundaryLatLng
 * @param {{ lat: number, lng: number }} pin
 * @param {Partial<typeof DEFAULT_PARAMS>} [paramOverrides]
 */
function computeFromBoundaryLatLng(refLat, refLng, boundaryLatLng, pin, paramOverrides = {}) {
  const params = { ...DEFAULT_PARAMS, ...paramOverrides };
  const pinLocal = toLocalMeters(pin.lat, pin.lng, refLat, refLng);

  const rawLocal = boundaryLatLng.map((pt) => toLocalMeters(pt.lat, pt.lng, refLat, refLng));
  const clipped = rawLocal.filter((pt) => dist(pt, pinLocal) <= params.R_clip_m);
  if (clipped.length < 2) {
    return { confidence: 'low', error: 'insufficient_boundary_points' };
  }

  let polyline = simplifyPolyline(clipped, params.epsilon_simplify_m);
  if (polyline.length > 80) {
    polyline = chaikinOnce(polyline);
    polyline = simplifyPolyline(polyline, params.epsilon_simplify_m);
  }
  if (polyline.length < 2) {
    return { confidence: 'low', error: 'simplified_boundary_too_short' };
  }

  const hit = closestOnPolyline(pinLocal, polyline);
  if (!hit) {
    return { confidence: 'low', error: 'no_closest_point' };
  }

  if (hit.dist > params.max_pin_to_P_m) {
    return {
      confidence: 'low',
      error: 'pin_too_far_from_shore',
      P: fromLocalMeters(hit.point, refLat, refLng),
      pin_to_P_m: hit.dist,
    };
  }

  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum.push(cum[i - 1] + dist(polyline[i - 1], polyline[i]));
  }

  const half = params.tangent_half_length_m;
  const arcBefore = hit.arcLength - half;
  const arcAfter = hit.arcLength + half;
  const arcBeforeClamped = Math.max(0, arcBefore);
  const arcAfterClamped = Math.min(cum[cum.length - 1], arcAfter);
  const arcLeft = hit.arcLength - arcBeforeClamped;
  const arcRight = arcAfterClamped - hit.arcLength;

  const A = pointAtArcLength(arcBeforeClamped, polyline, cum);
  const B = pointAtArcLength(arcAfterClamped, polyline, cum);
  const chordDx = B.x - A.x;
  const chordDy = B.y - A.y;
  const chordLen = Math.hypot(chordDx, chordDy);
  if (chordLen < 1) {
    return { confidence: 'low', error: 'degenerate_chord', P: fromLocalMeters(hit.point, refLat, refLng) };
  }

  const tx = chordDx / chordLen;
  const ty = chordDy / chordLen;
  const n1 = { x: -ty, y: tx };
  const n2 = { x: ty, y: -tx };
  const toPinX = pinLocal.x - hit.point.x;
  const toPinY = pinLocal.y - hit.point.y;
  const dot1 = n1.x * toPinX + n1.y * toPinY;
  const normal = dot1 < 0 ? n1 : n2;

  const bearingDeg = bearingFromVector(-normal.x, -normal.y);
  const toPinBearing = bearingFromVector(toPinX, toPinY);
  const normalVsPin = angleBetweenDeg(bearingDeg, toPinBearing);
  const pinOnWaterSide = toPinX * normal.x + toPinY * normal.y < 0;

  const center = degreesToCompass(bearingDeg);
  const directions = expandToThreeSectors(center);
  const P = fromLocalMeters(hit.point, refLat, refLng);

  let confidence = 'high';
  if (arcLeft < params.min_arc_each_side_m || arcRight < params.min_arc_each_side_m) {
    confidence = 'low';
  }
  if (!pinOnWaterSide || normalVsPin > params.max_normal_vs_pin_deg) {
    confidence = 'low';
  }

  return {
    confidence,
    bearing_deg: bearingDeg,
    directions,
    P,
    pin_to_P_m: hit.dist,
    arc_left_m: arcLeft,
    arc_right_m: arcRight,
    normal_vs_pin_deg: normalVsPin,
    smoothing: {
      R_clip_m: params.R_clip_m,
      epsilon_m: params.epsilon_simplify_m,
      tangent_half_length_m: params.tangent_half_length_m,
    },
  };
}

module.exports = {
  toLocalMeters,
  fromLocalMeters,
  simplifyPolyline,
  chaikinOnce,
  closestOnPolyline,
  computeFromBoundaryLatLng,
  expandToThreeSectors,
  bearingFromVector,
  angleBetweenDeg,
};
