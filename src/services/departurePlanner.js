const { pickBestQualifyingWindow, buildConsensusHours, getDayHours } = require('./sessionRank');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { computeSessionWarnings } = require('./weatherHazards');
const { getDriveDuration, buildMapsUrl, googleMapsTrafficEnabled, localDepartureIsoToEpochMs } = require('./travelTime');
const {
  formatForecastClock,
  subtractForecastMinutes,
  addForecastMinutes,
  planningDateString,
  earliestFeasibleOnWaterStartKey,
  bootstrapDepartureIso,
} = require('../utils/forecastTime');
const { hourTimeKey } = require('../utils/rideableWindow');

const DEFAULT_RIG_MINUTES = parseInt(process.env.DEFAULT_RIG_MINUTES ?? '20', 10);
const DEFAULT_DEPARTURE_BUFFER_MINUTES = parseInt(
  process.env.DEFAULT_DEPARTURE_BUFFER_MINUTES ?? '5',
  10
);

function trimWindowEndForHazards(dayHours, run, prefs) {
  const warnings = computeSessionWarnings(dayHours, prefs);
  if (!warnings.length) {
    return {
      onWaterEnd: addForecastMinutes(run.end, 60),
      rideableHours: run.length,
    };
  }

  let safeEnd = addForecastMinutes(run.end, 60);
  for (const warning of warnings) {
    if (!warning.suggestedFinishBy) continue;
    const warningStart = warning.afterWindowEnd ?? warning.eventTime;
    if (warningStart < run.start || warningStart > run.end) continue;
    if (warning.suggestedFinishBy < safeEnd) {
      safeEnd = warning.suggestedFinishBy;
    }
  }

  const rideableHours = dayHours.filter(
    (hour) => hour.time >= run.start && hour.time < safeEnd && hour.rideable
  ).length;

  return {
    onWaterEnd: safeEnd,
    rideableHours: Math.max(0, rideableHours),
  };
}

function resolveDepartureStatus(dateStr, leaveByIso, onWaterStart, onWaterEnd, tzOffsetMinutes) {
  const today = planningDateString(new Date(), tzOffsetMinutes);
  if (dateStr !== today) return 'planned';

  const nowMs = Date.now();
  const leaveMs = localDepartureIsoToEpochMs(leaveByIso, tzOffsetMinutes);
  const startMs = localDepartureIsoToEpochMs(onWaterStart, tzOffsetMinutes);
  const endMs = localDepartureIsoToEpochMs(onWaterEnd, tzOffsetMinutes);

  if (leaveMs == null || startMs == null || endMs == null) {
    return 'planned';
  }
  if (nowMs >= endMs) return 'passed';
  if (nowMs >= startMs) return 'in_window';
  if (nowMs >= leaveMs) return 'leave_now';
  return 'planned';
}

function remainingWindowHours(onWaterEnd, tzOffsetMinutes) {
  const endMs = localDepartureIsoToEpochMs(onWaterEnd, tzOffsetMinutes);
  if (endMs == null) return 0;
  const remainingMs = endMs - Date.now();
  return Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
}

function hourStartMs(timeKey, tzOffsetMinutes) {
  const key = hourTimeKey(timeKey);
  const ms = localDepartureIsoToEpochMs(key, tzOffsetMinutes);
  return ms == null ? NaN : ms;
}

function isDepartureWindowStillFeasible(
  now,
  onWaterStart,
  onWaterEnd,
  driveMinutes,
  rigMinutes,
  bufferMinutes,
  tzOffsetMinutes
) {
  const nowMs = now.getTime();
  const startMs = hourStartMs(onWaterStart, tzOffsetMinutes);
  const endMs = hourStartMs(onWaterEnd, tzOffsetMinutes);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true;
  if (nowMs >= endMs) return false;
  if (nowMs >= startMs && nowMs < endMs) return true;

  const earliest = earliestFeasibleOnWaterStartKey(
    now,
    driveMinutes,
    rigMinutes,
    bufferMinutes,
    tzOffsetMinutes
  );
  return hourTimeKey(earliest) <= hourTimeKey(onWaterStart);
}

function pickDepartureQualifyingWindow(
  rideEntry,
  dateStr,
  prefs,
  timelineHours,
  { driveMinutes, rigMinutes, bufferMinutes, now, tzOffsetMinutes } = {}
) {
  const rig = rigMinutes ?? DEFAULT_RIG_MINUTES;
  const buffer = bufferMinutes ?? DEFAULT_DEPARTURE_BUFFER_MINUTES;
  const asOf = now ?? new Date();
  const planningContext = { now: asOf, tzOffsetMinutes };

  if (!Number.isFinite(driveMinutes) || dateStr !== planningDateString(asOf, tzOffsetMinutes)) {
    return pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, { planningContext });
  }

  const notBefore = earliestFeasibleOnWaterStartKey(
    asOf,
    driveMinutes,
    rig,
    buffer,
    tzOffsetMinutes
  );
  const pick = pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, {
    notBeforeHourKey: notBefore,
    preferEarliestStart: true,
    planningContext,
  });
  if (!pick) return null;

  const dayHours = buildConsensusHours(rideEntry, dateStr, timelineHours, planningContext);
  const { onWaterEnd } = trimWindowEndForHazards(dayHours, pick.run, prefs);
  if (
    !isDepartureWindowStillFeasible(
      asOf,
      pick.run.start,
      onWaterEnd,
      driveMinutes,
      rig,
      buffer,
      tzOffsetMinutes
    )
  ) {
    return null;
  }

  return pick;
}

async function buildDeparturePlan(
  db,
  { origin, spot, dateStr, rideEntry, prefs, tzOffsetMinutes }
) {
  const timelineHours = getDayHours(rideEntry, dateStr);
  const asOf = new Date();
  const planningContext = { now: asOf, tzOffsetMinutes };
  const dayHours = buildConsensusHours(rideEntry, dateStr, timelineHours, planningContext);
  const dest = { lat: spot.latitude, lng: spot.longitude };
  const rigMinutes = DEFAULT_RIG_MINUTES;
  const bufferMinutes = DEFAULT_DEPARTURE_BUFFER_MINUTES;
  const minWindowHours = parseMinRideableWindowHours(prefs.min_rideable_window_hours);
  const trafficAware = googleMapsTrafficEnabled();
  const sessionIsToday = dateStr === planningDateString(asOf, tzOffsetMinutes);
  const nowForPick = trafficAware && sessionIsToday ? asOf : undefined;
  const pickOptions = {
    rigMinutes,
    bufferMinutes,
    now: nowForPick,
    tzOffsetMinutes,
  };

  const pickWindow = (driveMinutes) => {
    const withContext = { planningContext };
    if (!trafficAware) {
      return pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, withContext);
    }
    return pickDepartureQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, {
      ...pickOptions,
      driveMinutes,
    });
  };

  let drive = await getDriveDuration(
    db,
    origin,
    dest,
    bootstrapDepartureIso(dateStr, asOf, tzOffsetMinutes),
    tzOffsetMinutes
  );
  let windowPick = pickWindow(drive.driveMinutes);

  if (trafficAware) {
    const maxRounds = nowForPick ? 4 : 2;
    for (let round = 0; round < maxRounds && windowPick; round += 1) {
      const { rideableHours } = trimWindowEndForHazards(dayHours, windowPick.run, prefs);
      if (rideableHours < minWindowHours) {
        windowPick = null;
        break;
      }

      const arriveAtSpot = subtractForecastMinutes(windowPick.run.start, rigMinutes);
      const leaveGuess = subtractForecastMinutes(arriveAtSpot, drive.driveMinutes);
      const driveAtLeave = await getDriveDuration(db, origin, dest, leaveGuess, tzOffsetMinutes);
      const nextPick = pickWindow(driveAtLeave.driveMinutes);

      const sameDrive = driveAtLeave.driveMinutes === drive.driveMinutes;
      const sameWindow =
        nextPick &&
        hourTimeKey(nextPick.run.start) === hourTimeKey(windowPick.run.start);
      drive = driveAtLeave;
      if (nextPick) windowPick = nextPick;
      if (sameDrive && sameWindow) break;
    }
  }

  if (!windowPick) {
    const fallback = pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, {
      planningContext,
    });
    if (fallback) {
      const trimmed = trimWindowEndForHazards(dayHours, fallback.run, prefs);
      if (trimmed.rideableHours >= minWindowHours) {
        windowPick = fallback;
      }
    }
  }

  if (!windowPick) {
    return {
      status: 'no_window',
      minRideableWindowHours: prefs.min_rideable_window_hours,
    };
  }

  const { run, windowScore, topReasons, sessionWindowHours } = windowPick;
  const resolvedMinHours = sessionWindowHours ?? minWindowHours;
  let trim = trimWindowEndForHazards(dayHours, run, prefs);
  let { onWaterEnd, rideableHours } = trim;

  if (rideableHours < resolvedMinHours) {
    return {
      status: 'no_window',
      minRideableWindowHours: prefs.min_rideable_window_hours,
    };
  }

  let onWaterStart = run.start;
  let arriveAtSpot = subtractForecastMinutes(onWaterStart, rigMinutes);
  let leaveBy = subtractForecastMinutes(
    subtractForecastMinutes(arriveAtSpot, drive.driveMinutes),
    bufferMinutes
  );

  let status = resolveDepartureStatus(dateStr, leaveBy, onWaterStart, onWaterEnd, tzOffsetMinutes);

  if (status === 'leave_now') {
    const departNowIso = bootstrapDepartureIso(dateStr, asOf, tzOffsetMinutes);
    arriveAtSpot = addForecastMinutes(departNowIso, drive.driveMinutes);
  }

  const plan = {
    leaveBy: `${leaveBy}:00`,
    arriveAtSpot: `${arriveAtSpot}:00`,
    driveMinutes: drive.driveMinutes,
    driveSource: drive.source,
    routeSummary: drive.routeSummary,
    readyAtShore: `${arriveAtSpot}:00`,
    onWaterStart: `${onWaterStart}:00`,
    onWaterEnd: `${onWaterEnd}:00`,
    sessionWindowHours: resolvedMinHours,
    rideableHours: Math.min(rideableHours, resolvedMinHours),
    windowScore,
    topReasons,
    status,
    destination: { lat: dest.lat, lng: dest.lng },
    mapsUrl: buildMapsUrl(origin, dest, `${arriveAtSpot}:00`),
    rigMinutes,
    bufferMinutes,
    onWaterStartLabel: formatForecastClock(onWaterStart),
    onWaterEndLabel: formatForecastClock(onWaterEnd),
    arriveAtSpotLabel: formatForecastClock(arriveAtSpot),
    leaveByLabel: formatForecastClock(leaveBy),
  };

  if (status === 'in_window') {
    plan.hoursRemaining = remainingWindowHours(onWaterEnd, tzOffsetMinutes);
  }

  return { plan, status };
}

module.exports = {
  buildDeparturePlan,
  trimWindowEndForHazards,
  resolveDepartureStatus,
  pickDepartureQualifyingWindow,
  isDepartureWindowStillFeasible,
  DEFAULT_RIG_MINUTES,
  DEFAULT_DEPARTURE_BUFFER_MINUTES,
};
