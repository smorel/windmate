const { VALID_SPORTS } = require('../utils/sports');
const { parseFavoriteSpotIds } = require('../utils/favoriteSpots');
const {
  getGlobalPreferences,
  getSportProfiles,
  getSavedLocations,
  getActiveLocationId,
  getSpotsByIds,
  updateSportProfile,
  updateGlobalPreferences,
  setActiveLocationId,
  insertManualSpot,
  insertWatchedSession,
  planningTodayIsoDate,
} = require('../db');

const USER_STATE_VERSION = 1;

/** @param {import('better-sqlite3').Database} db */
function getAllLocationSportFavorites(db) {
  return db
    .prepare(
      'SELECT location_id, sport, favorite_spot_ids, updated_at FROM location_sport_favorites'
    )
    .all()
    .map((row) => ({
      location_id: row.location_id,
      sport: row.sport,
      favorite_spot_ids: parseFavoriteSpotIds(JSON.parse(row.favorite_spot_ids ?? '[]')),
      updated_at: row.updated_at,
    }));
}

/** @param {import('better-sqlite3').Database} db */
function exportUserState(db) {
  const today = planningTodayIsoDate(db);
  const watchedRows = db
    .prepare(
      `SELECT id, spot_id, session_date, sport, note, created_at, notify_email,
              last_status, last_status_at, last_notified_at, status_snapshot
       FROM watched_sessions
       WHERE session_date >= ?`
    )
    .all(today);

  const locationSportFavorites = getAllLocationSportFavorites(db);
  const spotIds = new Set();
  for (const row of locationSportFavorites) {
    for (const id of row.favorite_spot_ids) spotIds.add(id);
  }
  for (const row of watchedRows) spotIds.add(row.spot_id);

  const manualSpots = getSpotsByIds(db, [...spotIds])
    .filter((s) => !s.igetwind_id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      ideal_directions: s.ideal_directions ?? [],
    }));

  return {
    version: USER_STATE_VERSION,
    updated_at: Date.now(),
    active_location_id: getActiveLocationId(db),
    global: getGlobalPreferences(db),
    saved_locations: getSavedLocations(db),
    sport_profiles: getSportProfiles(db),
    location_sport_favorites: locationSportFavorites,
    watched_sessions: watchedRows.map((row) => {
      let status_snapshot = null;
      if (row.status_snapshot) {
        try {
          status_snapshot = JSON.parse(row.status_snapshot);
        } catch {
          status_snapshot = null;
        }
      }
      return {
        id: row.id,
        spot_id: row.spot_id,
        session_date: row.session_date,
        sport: row.sport,
        note: row.note,
        created_at: row.created_at,
        notify_email: row.notify_email ? 1 : 0,
        last_status: row.last_status,
        last_status_at: row.last_status_at,
        last_notified_at: row.last_notified_at,
        status_snapshot,
      };
    }),
    manual_spots: manualSpots,
  };
}

function validateBundle(bundle) {
  if (!bundle || bundle.version !== USER_STATE_VERSION) {
    throw new Error('Unsupported user state version');
  }
  if (!Array.isArray(bundle.sport_profiles)) {
    throw new Error('Invalid user state: sport_profiles');
  }
}

/** @param {import('better-sqlite3').Database} db @param {object} bundle */
function restoreUserState(db, bundle) {
  validateBundle(bundle);

  const restore = db.transaction(() => {
    db.prepare('DELETE FROM watched_sessions').run();
    db.prepare('DELETE FROM location_sport_favorites').run();
    db.prepare('DELETE FROM saved_locations').run();

    const insertLocation = db.prepare(`
      INSERT INTO saved_locations (id, nickname, lat, lng, timezone_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const place of bundle.saved_locations ?? []) {
      insertLocation.run(
        place.id,
        place.nickname,
        place.lat,
        place.lng,
        place.timezone_id ?? null,
        place.created_at ?? Date.now(),
        place.updated_at ?? Date.now()
      );
    }

    const insertFav = db.prepare(`
      INSERT INTO location_sport_favorites (location_id, sport, favorite_spot_ids, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const row of bundle.location_sport_favorites ?? []) {
      if (!VALID_SPORTS.includes(row.sport)) continue;
      insertFav.run(
        row.location_id,
        row.sport,
        JSON.stringify(parseFavoriteSpotIds(row.favorite_spot_ids)),
        row.updated_at ?? Date.now()
      );
    }

    for (const profile of bundle.sport_profiles) {
      if (!VALID_SPORTS.includes(profile.sport)) continue;
      updateSportProfile(db, profile.sport, {
        enabled: profile.enabled,
        min_wind_knots: profile.min_wind_knots,
        max_gust_knots: profile.max_gust_knots,
        min_air_temp_c: profile.min_air_temp_c,
        min_water_temp_c: profile.min_water_temp_c,
        offshore_wind_ok: profile.offshore_wind_ok,
        wave_preference: profile.wave_preference,
        min_foil_depth_cm: profile.min_foil_depth_cm,
        radius_km: profile.radius_km,
        min_rideable_window_hours: profile.min_rideable_window_hours,
        rank_criteria_order: profile.rank_criteria_order,
        alert_enabled: profile.alert_enabled,
        alert_schedule: profile.alert_schedule,
        favorites_only: profile.favorites_only,
      });
    }

    const global = bundle.global ?? {};
    updateGlobalPreferences(db, {
      active_sport: global.active_sport,
      alerts_master_enabled: global.alerts_master_enabled,
      planner_full_day_forecast: global.planner_full_day_forecast,
      matrix_hide_night_hours: global.matrix_hide_night_hours,
    });

    if (bundle.active_location_id !== undefined) {
      setActiveLocationId(db, bundle.active_location_id);
    }

    const { scheduleSpotDirectionInference } = require('../utils/spotDirectionApi');
    for (const spot of bundle.manual_spots ?? []) {
      const existing = db.prepare('SELECT id FROM spots WHERE id = ?').get(spot.id);
      if (!existing) {
        const created = insertManualSpot(db, {
          id: spot.id,
          name: spot.name,
          latitude: spot.latitude,
          longitude: spot.longitude,
        });
        scheduleSpotDirectionInference(db, created);
      }
    }

    for (const session of bundle.watched_sessions ?? []) {
      insertWatchedSession(db, session);
    }
  });

  restore();
  return exportUserState(db);
}

module.exports = {
  USER_STATE_VERSION,
  exportUserState,
  restoreUserState,
};
