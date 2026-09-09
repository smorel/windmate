const { pickBestQualifyingWindow, buildConsensusHours, getDayHours } = require('./sessionRank');
const { parseMinRideableWindowHours } = require('../utils/rideableWindow');
const { computeSessionWarnings } = require('./weatherHazards');
const { getDriveDuration, haversineDriveMinutes, buildMapsUrl } = require('./travelTime');
const {
  formatForecastClock,
  subtractForecastMinutes,
  addForecastMinutes,
  localDateString,
} = require('../utils/forecastTime');

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

async function buildDeparturePlan(db, { origin, spot, dateStr, rideEntry, prefs }) {
  const timelineHours = getDayHours(rideEntry, dateStr);
  const dayHours = buildConsensusHours(rideEntry, dateStr, timelineHours);
  const windowPick = pickBestQualifyingWindow(rideEntry, dateStr, prefs, timelineHours);
  if (!windowPick) {
    return {
      status: 'no_window',
      minRideableWindowHours: prefs.min_rideable_window_hours,
    };
  }

  const { run, windowScore, topReasons, sessionWindowHours } = windowPick;
  const minWindowHours = sessionWindowHours ?? parseMinRideableWindowHours(prefs.min_rideable_window_hours);
  const { onWaterEnd, rideableHours } = trimWindowEndForHazards(dayHours, run, prefs);

  if (rideableHours < minWindowHours) {
    return {
      status: 'no_window',
      minRideableWindowHours: prefs.min_rideable_window_hours,
    };
  }

  const rigMinutes = DEFAULT_RIG_MINUTES;
  const bufferMinutes = DEFAULT_DEPARTURE_BUFFER_MINUTES;
  const onWaterStart = run.start;
  const arriveAtSpot = subtractForecastMinutes(onWaterStart, rigMinutes);
  const dest = { lat: spot.latitude, lng: spot.longitude };

  const haversineGuess = haversineDriveMinutes(origin, dest);
  const leaveGuess = subtractForecastMinutes(arriveAtSpot, haversineGuess.driveMinutes);
  const drive = await getDriveDuration(db, origin, dest, leaveGuess);
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
    sessionWindowHours: minWindowHours,
    rideableHours: Math.min(rideableHours, minWindowHours),
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
  DEFAULT_RIG_MINUTES,
  DEFAULT_DEPARTURE_BUFFER_MINUTES,
};
