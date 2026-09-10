const { pickBestQualifyingWindow, buildConsensusHours, getDayHours } = require('./sessionRank');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { computeSessionWarnings } = require('./weatherHazards');
const { getDriveDuration, buildMapsUrl } = require('./travelTime');
const {
  formatForecastClock,
  subtractForecastMinutes,
  addForecastMinutes,
  localDateString,
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

function resolveDepartureStatus(dateStr, leaveByIso, onWaterStart, onWaterEnd) {
  const today = localDateString();
  if (dateStr !== today) return 'planned';

  const nowMs = Date.now();
  const leaveMs = Date.parse(`${leaveByIso}:00`);
  const startMs = Date.parse(`${onWaterStart}:00`);
  const endMs = Date.parse(`${onWaterEnd}:00`);

  if (Number.isNaN(leaveMs) || Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return 'planned';
  }
  if (nowMs >= endMs) return 'passed';
  if (nowMs >= startMs) return 'in_window';
  if (nowMs >= leaveMs) return 'leave_now';
  return 'planned';
}

function remainingWindowHours(onWaterEnd) {
  const endMs = Date.parse(`${onWaterEnd}:00`);
  if (Number.isNaN(endMs)) return 0;
  const remainingMs = endMs - Date.now();
  return Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
}

function hourStartMs(timeKey) {
  const key = hourTimeKey(timeKey);
  const ms = Date.parse(`${key}:00`);
  return Number.isFinite(ms) ? ms : NaN;
}

function isDepartureWindowStillFeasible(
  now,
  onWaterStart,
  onWaterEnd,
  driveMinutes,
  rigMinutes,
  bufferMinutes
) {
  const nowMs = now.getTime();
  const startMs = hourStartMs(onWaterStart);
  const endMs = hourStartMs(onWaterEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true;
  if (nowMs >= endMs) return false;
  if (nowMs >= startMs && nowMs < endMs) return true;

  const earliest = earliestFeasibleOnWaterStartKey(now, driveMinutes, rigMinutes, bufferMinutes);
  return hourTimeKey(earliest) <= hourTimeKey(onWaterStart);
}

function pickDepartureQualifyingWindow(
  rideEntry,
  dateStr,
  prefs,
  timelineHours,
  { driveMinutes, rigMinutes, bufferMinutes, now } = {}
) {
  const rig = rigMinutes ?? DEFAULT_RIG_MINUTES;
  const buffer = bufferMinutes ?? DEFAULT_DEPARTURE_BUFFER_MINUTES;
  const asOf = now ?? new Date();

  if (!Number.isFinite(driveMinutes) || dateStr !== localDateString(asOf)) {
    return pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours);
  }

  const notBefore = earliestFeasibleOnWaterStartKey(asOf, driveMinutes, rig, buffer);
  const pick = pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, {
    notBeforeHourKey: notBefore,
    preferEarliestStart: true,
  });
  if (!pick) return null;

  const dayHours = buildConsensusHours(rideEntry, dateStr, timelineHours);
  const { onWaterEnd } = trimWindowEndForHazards(dayHours, pick.run, prefs);
  if (
    !isDepartureWindowStillFeasible(
      asOf,
      pick.run.start,
      onWaterEnd,
      driveMinutes,
      rig,
      buffer
    )
  ) {
    return null;
  }

  return pick;
}

async function buildDeparturePlan(db, { origin, spot, dateStr, rideEntry, prefs }) {
  const timelineHours = getDayHours(rideEntry, dateStr);
  const dayHours = buildConsensusHours(rideEntry, dateStr, timelineHours);
  const dest = { lat: spot.latitude, lng: spot.longitude };
  const rigMinutes = DEFAULT_RIG_MINUTES;
  const bufferMinutes = DEFAULT_DEPARTURE_BUFFER_MINUTES;
  const minWindowHours = parseMinRideableWindowHours(prefs.min_rideable_window_hours);
  const asOf = new Date();
  const nowForPick = dateStr === localDateString(asOf) ? asOf : undefined;
  const pickOptions = {
    rigMinutes,
    bufferMinutes,
    now: nowForPick,
  };

  let drive = await getDriveDuration(db, origin, dest, bootstrapDepartureIso(dateStr, asOf));
  let windowPick = pickDepartureQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, {
    ...pickOptions,
    driveMinutes: drive.driveMinutes,
  });

  for (let round = 0; round < 2 && windowPick; round += 1) {
    const { onWaterEnd, rideableHours } = trimWindowEndForHazards(dayHours, windowPick.run, prefs);
    if (rideableHours < minWindowHours) {
      windowPick = null;
      break;
    }

    const arriveAtSpot = subtractForecastMinutes(windowPick.run.start, rigMinutes);
    const leaveGuess = subtractForecastMinutes(arriveAtSpot, drive.driveMinutes);
    const driveAtLeave = await getDriveDuration(db, origin, dest, leaveGuess);
    const nextPick = pickDepartureQualifyingWindow(rideEntry, dateStr, prefs, timelineHours, {
      ...pickOptions,
      driveMinutes: driveAtLeave.driveMinutes,
    });

    const sameDrive = driveAtLeave.driveMinutes === drive.driveMinutes;
    const sameWindow =
      nextPick &&
      hourTimeKey(nextPick.run.start) === hourTimeKey(windowPick.run.start);
    drive = driveAtLeave;
    if (nextPick) windowPick = nextPick;
    if (sameDrive && sameWindow) break;
  }

  if (!windowPick) {
    return {
      status: 'no_window',
      minRideableWindowHours: prefs.min_rideable_window_hours,
    };
  }

  const { run, windowScore, topReasons, sessionWindowHours } = windowPick;
  const resolvedMinHours = sessionWindowHours ?? minWindowHours;
  const { onWaterEnd, rideableHours } = trimWindowEndForHazards(dayHours, run, prefs);

  if (rideableHours < resolvedMinHours) {
    return {
      status: 'no_window',
      minRideableWindowHours: prefs.min_rideable_window_hours,
    };
  }

  const onWaterStart = run.start;
  const arriveAtSpot = subtractForecastMinutes(onWaterStart, rigMinutes);
  const leaveBy = subtractForecastMinutes(
    subtractForecastMinutes(arriveAtSpot, drive.driveMinutes),
    bufferMinutes
  );

  const status = resolveDepartureStatus(dateStr, leaveBy, onWaterStart, onWaterEnd);

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
    mapsUrl: buildMapsUrl(origin, dest),
    rigMinutes,
    bufferMinutes,
    onWaterStartLabel: formatForecastClock(onWaterStart),
    onWaterEndLabel: formatForecastClock(onWaterEnd),
    arriveAtSpotLabel: formatForecastClock(arriveAtSpot),
    leaveByLabel: formatForecastClock(leaveBy),
  };

  if (status === 'in_window') {
    plan.hoursRemaining = remainingWindowHours(onWaterEnd);
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
