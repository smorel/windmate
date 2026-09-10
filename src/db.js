const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const {
  SPORT_DEFAULTS,
  SPORT_WAVE_DEFAULTS,
  VALID_SPORTS,
  DEFAULT_RANK_ORDER_BY_SPORT,
  DEFAULT_ALERT_SCHEDULE_BY_SPORT,
} = require('./utils/sports');
const { DEFAULT_RANK_CRITERIA_ORDER, parseRankCriteriaOrder } = require('./utils/rankCriteria');
const { parseFavoriteSpotIds } = require('./utils/favoriteSpots');
const { DEFAULT_SEARCH_RADIUS_KM, parseSearchRadiusKm } = require('./utils/searchRadius');
const { parseMinRideableWindowHours } = require('./utils/rideableWindow');
const { haversineKm } = require('./utils/geo');
const { localDateString } = require('./utils/forecastTime');
const MONTREAL_SPOTS = require('./seed/montreal-spots');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'windwatch.db');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** @returns {import('better-sqlite3').Database} */
function initDb() {
  ensureDataDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS spots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      ideal_directions TEXT NOT NULL DEFAULT '[]',
      source_url TEXT,
      igetwind_id TEXT
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sport TEXT NOT NULL DEFAULT 'wingfoiling',
      min_wind_knots INTEGER NOT NULL DEFAULT 12,
      max_gust_knots INTEGER NOT NULL DEFAULT 25,
      min_air_temp_c REAL,
      min_water_temp_c REAL
    );

    CREATE TABLE IF NOT EXISTS forecast_cache (
      spot_id TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observation_cache (
      spot_id TEXT PRIMARY KEY REFERENCES spots(id),
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_cache (
      spot_id TEXT PRIMARY KEY REFERENCES spots(id),
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  migrateDb(db);
  seedPreferences(db);
  seedMontrealIdealDirections(db);
  return db;
}

/** @param {import('better-sqlite3').Database} db */
function migrateDb(db) {
  const spotColumns = db.prepare('PRAGMA table_info(spots)').all().map((c) => c.name);
  if (!spotColumns.includes('igetwind_id')) {
    db.exec('ALTER TABLE spots ADD COLUMN igetwind_id TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spots_igetwind_id
    ON spots(igetwind_id) WHERE igetwind_id IS NOT NULL
  `);

  const prefColumns = db.prepare('PRAGMA table_info(user_preferences)').all().map((c) => c.name);
  if (!prefColumns.includes('min_air_temp_c')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN min_air_temp_c REAL');
  }
  if (!prefColumns.includes('min_water_temp_c')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN min_water_temp_c REAL');
  }
  if (!prefColumns.includes('rank_criteria_order')) {
    db.exec(
      `ALTER TABLE user_preferences ADD COLUMN rank_criteria_order TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_RANK_CRITERIA_ORDER)}'`
    );
  }
  if (!prefColumns.includes('favorite_spot_ids')) {
    db.exec(`ALTER TABLE user_preferences ADD COLUMN favorite_spot_ids TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!prefColumns.includes('radius_km')) {
    db.exec(
      `ALTER TABLE user_preferences ADD COLUMN radius_km INTEGER NOT NULL DEFAULT ${DEFAULT_SEARCH_RADIUS_KM}`
    );
  }
  if (!prefColumns.includes('offshore_wind_ok')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN offshore_wind_ok INTEGER NOT NULL DEFAULT 0');
  }
  if (!prefColumns.includes('min_rideable_window_hours')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN min_rideable_window_hours INTEGER NOT NULL DEFAULT 2');
  }

  const prefs = db.prepare('SELECT sport, min_air_temp_c, min_water_temp_c FROM user_preferences WHERE id = 1').get();
  if (prefs && prefs.min_air_temp_c == null && prefs.min_water_temp_c == null) {
    const defaults = SPORT_DEFAULTS[prefs.sport] ?? SPORT_DEFAULTS.wingfoiling;
    db.prepare(`
      UPDATE user_preferences SET min_air_temp_c = ?, min_water_temp_c = ? WHERE id = 1
    `).run(defaults.min_air_temp_c, defaults.min_water_temp_c);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_cache (
      spot_id TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_cache (
      spot_id TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  if (!prefColumns.includes('active_sport')) {
    db.exec(`ALTER TABLE user_preferences ADD COLUMN active_sport TEXT NOT NULL DEFAULT 'wingfoiling'`);
    db.exec(`UPDATE user_preferences SET active_sport = sport WHERE active_sport IS NULL OR active_sport = ''`);
  }
  if (!prefColumns.includes('alerts_master_enabled')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN alerts_master_enabled INTEGER NOT NULL DEFAULT 1');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sport_profiles (
      sport TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_wind_knots INTEGER NOT NULL,
      max_gust_knots INTEGER NOT NULL,
      min_air_temp_c REAL,
      min_water_temp_c REAL,
      offshore_wind_ok INTEGER NOT NULL DEFAULT 0,
      wave_preference TEXT NOT NULL DEFAULT 'flat',
      min_foil_depth_cm INTEGER,
      radius_km INTEGER NOT NULL DEFAULT 50,
      min_rideable_window_hours INTEGER NOT NULL DEFAULT 2,
      rank_criteria_order TEXT NOT NULL,
      alert_enabled INTEGER NOT NULL DEFAULT 1,
      alert_schedule TEXT NOT NULL,
      favorite_spot_ids TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS watched_sessions (
      id TEXT PRIMARY KEY,
      spot_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      sport TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      notify_email INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      last_status_at INTEGER,
      last_notified_at INTEGER,
      status_snapshot TEXT,
      UNIQUE(spot_id, session_date, sport)
    );

    CREATE TABLE IF NOT EXISTS alert_sent_log (
      id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      spot_id TEXT,
      session_date TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      fingerprint TEXT NOT NULL
    );
  `);

  migrateSportProfiles(db);
  migrateWatchlistUniqueBySport(db);
  migrateSportFavorites(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS travel_time_cache (
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      dest_lat REAL NOT NULL,
      dest_lng REAL NOT NULL,
      departure_bucket TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      distance_m INTEGER,
      route_summary TEXT,
      fetched_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (origin_lat, origin_lng, dest_lat, dest_lng, departure_bucket)
    )
  `);
}

/** @param {import('better-sqlite3').Database} db */
function migrateSportFavorites(db) {
  const columns = db.prepare('PRAGMA table_info(sport_profiles)').all();
  if (!columns.some((c) => c.name === 'favorite_spot_ids')) {
    db.exec(`ALTER TABLE sport_profiles ADD COLUMN favorite_spot_ids TEXT NOT NULL DEFAULT '[]'`);
    const global = db
      .prepare('SELECT favorite_spot_ids, active_sport FROM user_preferences WHERE id = 1')
      .get();
    const favorites = global?.favorite_spot_ids ?? '[]';
    if (favorites !== '[]') {
      const activeSport = global?.active_sport ?? 'wingfoiling';
      db.prepare('UPDATE sport_profiles SET favorite_spot_ids = ? WHERE sport = ?').run(
        favorites,
        activeSport
      );
    }
  }
}

/** @param {import('better-sqlite3').Database} db */
function migrateWatchlistUniqueBySport(db) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'watched_sessions'")
    .get();
  if (!row?.sql || row.sql.includes('UNIQUE(spot_id, session_date, sport)')) return;

  db.exec(`
    CREATE TABLE watched_sessions_new (
      id TEXT PRIMARY KEY,
      spot_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      sport TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      notify_email INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      last_status_at INTEGER,
      last_notified_at INTEGER,
      status_snapshot TEXT,
      UNIQUE(spot_id, session_date, sport)
    );
    INSERT INTO watched_sessions_new (
      id, spot_id, session_date, sport, note, created_at, notify_email,
      last_status, last_status_at, last_notified_at, status_snapshot
    )
    SELECT
      id, spot_id, session_date, sport, note, created_at, notify_email,
      last_status, last_status_at, last_notified_at, status_snapshot
    FROM watched_sessions;
    DROP TABLE watched_sessions;
    ALTER TABLE watched_sessions_new RENAME TO watched_sessions;
  `);
}

/** @param {import('better-sqlite3').Database} db */
function seedPreferences(db) {
  const row = db.prepare('SELECT id FROM user_preferences WHERE id = 1').get();
  if (row) return;

  const defaults = SPORT_DEFAULTS.wingfoiling;
  db.prepare(`
    INSERT INTO user_preferences (id, sport, min_wind_knots, max_gust_knots, min_air_temp_c, min_water_temp_c, rank_criteria_order, favorite_spot_ids, radius_km, offshore_wind_ok)
    VALUES (1, 'wingfoiling', ?, ?, ?, ?, ?, '[]', ?, ?)
  `).run(
    defaults.min_wind_knots,
    defaults.max_gust_knots,
    defaults.min_air_temp_c,
    defaults.min_water_temp_c,
    JSON.stringify(DEFAULT_RANK_CRITERIA_ORDER),
    DEFAULT_SEARCH_RADIUS_KM,
    defaults.offshore_wind_ok
  );
}

/** Merge ideal wind directions from Montreal seed onto synced spots by proximity. */
function seedMontrealIdealDirections(db) {
  const update = db.prepare('UPDATE spots SET ideal_directions = ? WHERE id = ?');
  const spots = db.prepare('SELECT id, latitude, longitude, ideal_directions FROM spots').all();
  const MAX_KM = 12;

  for (const spot of spots) {
    let current = [];
    try {
      current = JSON.parse(spot.ideal_directions || '[]');
    } catch {
      current = [];
    }
    if (current.length > 0) continue;

    let bestSeed = null;
    let bestDist = Infinity;
    for (const seed of MONTREAL_SPOTS) {
      const dist = haversineKm(spot.latitude, spot.longitude, seed.latitude, seed.longitude);
      if (dist < bestDist) {
        bestDist = dist;
        bestSeed = seed;
      }
    }
    if (bestSeed && bestDist <= MAX_KM) {
      update.run(JSON.stringify(bestSeed.ideal_directions), spot.id);
    }
  }
}

/** @param {import('better-sqlite3').Database} db */
function migrateSportProfiles(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM sport_profiles').get().n;
  if (count > 0) return;

  const legacy = db.prepare(`
    SELECT sport, min_wind_knots, max_gust_knots, min_air_temp_c, min_water_temp_c,
           rank_criteria_order, radius_km, offshore_wind_ok, min_rideable_window_hours, active_sport
    FROM user_preferences WHERE id = 1
  `).get();

  const activeSport = legacy?.active_sport ?? legacy?.sport ?? 'wingfoiling';
  const insert = db.prepare(`
    INSERT INTO sport_profiles (
      sport, enabled, min_wind_knots, max_gust_knots, min_air_temp_c, min_water_temp_c,
      offshore_wind_ok, wave_preference, min_foil_depth_cm, radius_km, min_rideable_window_hours,
      rank_criteria_order, alert_enabled, alert_schedule
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  for (const sport of VALID_SPORTS) {
    const defaults = SPORT_DEFAULTS[sport];
    const isActive = sport === activeSport;
    insert.run(
      sport,
      isActive ? legacy.min_wind_knots : defaults.min_wind_knots,
      isActive ? legacy.max_gust_knots : defaults.max_gust_knots,
      isActive ? legacy.min_air_temp_c : defaults.min_air_temp_c,
      isActive ? legacy.min_water_temp_c : defaults.min_water_temp_c,
      isActive ? (legacy.offshore_wind_ok ? 1 : 0) : (defaults.offshore_wind_ok ? 1 : 0),
      SPORT_WAVE_DEFAULTS[sport] ?? 'flat',
      null,
      isActive ? parseSearchRadiusKm(legacy.radius_km) : DEFAULT_SEARCH_RADIUS_KM,
      isActive
        ? parseMinRideableWindowHours(legacy.min_rideable_window_hours)
        : parseMinRideableWindowHours(2),
      JSON.stringify(
        parseRankCriteriaOrder(
          isActive ? legacy.rank_criteria_order : DEFAULT_RANK_ORDER_BY_SPORT[sport]
        )
      ),
      JSON.stringify(DEFAULT_ALERT_SCHEDULE_BY_SPORT[sport])
    );
  }

  if (legacy) {
    db.prepare(`UPDATE user_preferences SET active_sport = ? WHERE id = 1`).run(activeSport);
  }
}

function parseSportProfileRow(row) {
  let alertSchedule;
  try {
    alertSchedule = JSON.parse(row.alert_schedule);
  } catch {
    alertSchedule = DEFAULT_ALERT_SCHEDULE_BY_SPORT[row.sport];
  }
  let favoriteSpotIds = [];
  try {
    favoriteSpotIds = parseFavoriteSpotIds(JSON.parse(row.favorite_spot_ids ?? '[]'));
  } catch {
    favoriteSpotIds = [];
  }
  return {
    sport: row.sport,
    enabled: row.enabled ? 1 : 0,
    min_wind_knots: row.min_wind_knots,
    max_gust_knots: row.max_gust_knots,
    min_air_temp_c: row.min_air_temp_c,
    min_water_temp_c: row.min_water_temp_c,
    offshore_wind_ok: row.offshore_wind_ok ? 1 : 0,
    wave_preference: row.wave_preference,
    min_foil_depth_cm: row.min_foil_depth_cm,
    radius_km: parseSearchRadiusKm(row.radius_km),
    min_rideable_window_hours: parseMinRideableWindowHours(row.min_rideable_window_hours),
    rank_criteria_order: parseRankCriteriaOrder(row.rank_criteria_order),
    alert_enabled: row.alert_enabled ? 1 : 0,
    alert_schedule: alertSchedule,
    favorite_spot_ids: favoriteSpotIds,
  };
}

/** @param {import('better-sqlite3').Database} db */
function getGlobalPreferences(db) {
  const row = db.prepare(`
    SELECT active_sport, favorite_spot_ids, alerts_master_enabled
    FROM user_preferences WHERE id = 1
  `).get();
  if (!row) return null;
  let favoriteIds = [];
  try {
    favoriteIds = parseFavoriteSpotIds(JSON.parse(row.favorite_spot_ids ?? '[]'));
  } catch {
    favoriteIds = [];
  }
  return {
    active_sport: row.active_sport ?? 'wingfoiling',
    favorite_spot_ids: favoriteIds,
    alerts_master_enabled: row.alerts_master_enabled ? 1 : 0,
  };
}

/** @param {import('better-sqlite3').Database} db */
function getSportProfiles(db) {
  return db
    .prepare('SELECT * FROM sport_profiles ORDER BY sport')
    .all()
    .map(parseSportProfileRow);
}

/** @param {import('better-sqlite3').Database} db @param {string} sport */
function getSportProfile(db, sport) {
  const row = db.prepare('SELECT * FROM sport_profiles WHERE sport = ?').get(sport);
  return row ? parseSportProfileRow(row) : null;
}

/** @param {import('better-sqlite3').Database} db @param {string} [sport] */
function getPreferences(db, sport) {
  const global = getGlobalPreferences(db);
  if (!global) return null;

  const activeSport = sport ?? global.active_sport ?? 'wingfoiling';
  const profile = getSportProfile(db, activeSport);
  if (!profile) return null;

  return {
    ...profile,
    sport: activeSport,
    active_sport: global.active_sport,
    alerts_master_enabled: global.alerts_master_enabled,
  };
}

/** @param {import('better-sqlite3').Database} db */
function getFullPreferences(db) {
  const global = getGlobalPreferences(db);
  const profiles = getSportProfiles(db);
  const active = getPreferences(db);
  return {
    ...global,
    ...active,
    sport_profiles: profiles,
  };
}

/** @param {import('better-sqlite3').Database} db */
function updateGlobalPreferences(db, prefs) {
  const current = getGlobalPreferences(db);
  const activeSport = prefs.active_sport ?? current.active_sport;
  db.prepare(`
    UPDATE user_preferences
    SET active_sport = ?, sport = ?, alerts_master_enabled = ?
    WHERE id = 1
  `).run(
    activeSport,
    activeSport,
    prefs.alerts_master_enabled !== undefined ? (prefs.alerts_master_enabled ? 1 : 0) : current.alerts_master_enabled
  );
  return getFullPreferences(db);
}

/** @param {import('better-sqlite3').Database} db @param {string} sport @param {object} prefs */
function updateSportProfile(db, sport, prefs) {
  const current = getSportProfile(db, sport);
  if (!current) return null;

  const enabled = prefs.enabled !== undefined ? (prefs.enabled ? 1 : 0) : current.enabled;
  if (enabled === 0) {
    const enabledCount = db
      .prepare('SELECT COUNT(*) AS n FROM sport_profiles WHERE enabled = 1 AND sport != ?')
      .get(sport).n;
    if (enabledCount < 1) {
      throw new Error('At least one sport must stay enabled');
    }
  }

  const alertSchedule =
    prefs.alert_schedule !== undefined ? prefs.alert_schedule : current.alert_schedule;
  const favoriteSpotIds =
    prefs.favorite_spot_ids !== undefined
      ? parseFavoriteSpotIds(prefs.favorite_spot_ids)
      : current.favorite_spot_ids;

  db.prepare(`
    UPDATE sport_profiles SET
      enabled = ?,
      min_wind_knots = ?,
      max_gust_knots = ?,
      min_air_temp_c = ?,
      min_water_temp_c = ?,
      offshore_wind_ok = ?,
      wave_preference = ?,
      min_foil_depth_cm = ?,
      radius_km = ?,
      min_rideable_window_hours = ?,
      rank_criteria_order = ?,
      alert_enabled = ?,
      alert_schedule = ?,
      favorite_spot_ids = ?
    WHERE sport = ?
  `).run(
    enabled,
    prefs.min_wind_knots ?? current.min_wind_knots,
    prefs.max_gust_knots ?? current.max_gust_knots,
    prefs.min_air_temp_c !== undefined ? prefs.min_air_temp_c : current.min_air_temp_c,
    prefs.min_water_temp_c !== undefined ? prefs.min_water_temp_c : current.min_water_temp_c,
    prefs.offshore_wind_ok !== undefined ? (prefs.offshore_wind_ok ? 1 : 0) : current.offshore_wind_ok,
    prefs.wave_preference ?? current.wave_preference,
    prefs.min_foil_depth_cm !== undefined ? prefs.min_foil_depth_cm : current.min_foil_depth_cm,
    parseSearchRadiusKm(prefs.radius_km ?? current.radius_km),
    parseMinRideableWindowHours(
      prefs.min_rideable_window_hours ?? current.min_rideable_window_hours
    ),
    JSON.stringify(parseRankCriteriaOrder(prefs.rank_criteria_order ?? current.rank_criteria_order)),
    prefs.alert_enabled !== undefined ? (prefs.alert_enabled ? 1 : 0) : current.alert_enabled,
    JSON.stringify(alertSchedule),
    JSON.stringify(favoriteSpotIds),
    sport
  );

  if (enabled === 0) {
    const global = getGlobalPreferences(db);
    if (global.active_sport === sport) {
      const next = db
        .prepare('SELECT sport FROM sport_profiles WHERE enabled = 1 ORDER BY sport LIMIT 1')
        .get();
      if (next) {
        db.prepare('UPDATE user_preferences SET active_sport = ?, sport = ? WHERE id = 1').run(
          next.sport,
          next.sport
        );
      }
    }
  }

  return getSportProfile(db, sport);
}

/** @param {import('better-sqlite3').Database} db @param {object} prefs */
function updatePreferences(db, prefs) {
  const sport = prefs.sport ?? prefs.active_sport ?? getGlobalPreferences(db)?.active_sport;
  updateSportProfile(db, sport, prefs);
  updateGlobalPreferences(db, {
    active_sport: sport,
    alerts_master_enabled: prefs.alerts_master_enabled,
  });
  return getPreferences(db, sport);
}

function todayIsoDate() {
  return localDateString();
}

/** @param {import('better-sqlite3').Database} db */
function getWatchedSessions(db) {
  return db
    .prepare(`
      SELECT ws.*, s.name AS spot_name, s.latitude, s.longitude, s.ideal_directions, s.source_url
      FROM watched_sessions ws
      JOIN spots s ON s.id = ws.spot_id
      WHERE ws.session_date >= ?
      ORDER BY ws.session_date ASC, ws.created_at ASC
    `)
    .all(todayIsoDate())
    .map(parseWatchedSessionRow);
}

/** @param {import('better-sqlite3').Database} db @param {string} id */
function getWatchedSessionById(db, id) {
  const row = db
    .prepare(`
      SELECT ws.*, s.name AS spot_name, s.latitude, s.longitude, s.ideal_directions, s.source_url
      FROM watched_sessions ws
      JOIN spots s ON s.id = ws.spot_id
      WHERE ws.id = ?
    `)
    .get(id);
  return row ? parseWatchedSessionRow(row) : null;
}

function parseWatchedSessionRow(row) {
  let statusSnapshot = null;
  if (row.status_snapshot) {
    try {
      statusSnapshot = JSON.parse(row.status_snapshot);
    } catch {
      statusSnapshot = null;
    }
  }
  return {
    id: row.id,
    spot_id: row.spot_id,
    spot_name: row.spot_name,
    session_date: row.session_date,
    sport: row.sport,
    note: row.note,
    created_at: row.created_at,
    notify_email: row.notify_email ? 1 : 0,
    last_status: row.last_status,
    last_status_at: row.last_status_at,
    last_notified_at: row.last_notified_at,
    status_snapshot: statusSnapshot,
    spot: {
      id: row.spot_id,
      name: row.spot_name,
      latitude: row.latitude,
      longitude: row.longitude,
      ideal_directions: JSON.parse(row.ideal_directions ?? '[]'),
      source_url: row.source_url,
    },
    isToday: row.session_date === todayIsoDate(),
  };
}

/** @param {import('better-sqlite3').Database} db */
function purgeExpiredWatchedSessions(db) {
  return db.prepare('DELETE FROM watched_sessions WHERE session_date < ?').run(todayIsoDate()).changes;
}

/** @param {import('better-sqlite3').Database} db @param {object} row */
function insertWatchedSession(db, row) {
  db.prepare(`
    INSERT INTO watched_sessions (
      id, spot_id, session_date, sport, note, created_at, notify_email,
      last_status, last_status_at, last_notified_at, status_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.spot_id,
    row.session_date,
    row.sport,
    row.note ?? null,
    row.created_at,
    row.notify_email ? 1 : 0,
    row.last_status ?? null,
    row.last_status_at ?? null,
    row.last_notified_at ?? null,
    row.status_snapshot ? JSON.stringify(row.status_snapshot) : null
  );
  return getWatchedSessionById(db, row.id);
}

/** @param {import('better-sqlite3').Database} db @param {string} id */
function deleteWatchedSession(db, id) {
  return db.prepare('DELETE FROM watched_sessions WHERE id = ?').run(id).changes > 0;
}

/** @param {import('better-sqlite3').Database} db @param {string} id @param {object} patch */
function updateWatchedSessionStatus(db, id, patch) {
  db.prepare(`
    UPDATE watched_sessions SET
      last_status = ?,
      last_status_at = ?,
      last_notified_at = ?,
      status_snapshot = ?
    WHERE id = ?
  `).run(
    patch.last_status ?? null,
    patch.last_status_at ?? Date.now(),
    patch.last_notified_at ?? null,
    patch.status_snapshot ? JSON.stringify(patch.status_snapshot) : null,
    id
  );
}

function getObservationCache(db, spotId) {
  return db.prepare('SELECT fetched_at, data FROM observation_cache WHERE spot_id = ?').get(spotId);
}

function setObservationCache(db, spotId, data) {
  db.prepare(`
    INSERT INTO observation_cache (spot_id, fetched_at, data)
    VALUES (?, ?, ?)
    ON CONFLICT(spot_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data
  `).run(spotId, Date.now(), JSON.stringify(data));
}

/** @param {import('better-sqlite3').Database} db */
function getAllSpots(db) {
  return db.prepare('SELECT * FROM spots ORDER BY name').all().map(parseSpot);
}

/** @param {import('better-sqlite3').Database} db @param {string} id */
function getSpotById(db, id) {
  const row = db.prepare('SELECT * FROM spots WHERE id = ?').get(id);
  return row ? parseSpot(row) : null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, name: string, latitude: number, longitude: number }} spot
 */
function insertManualSpot(db, spot) {
  db.prepare(
    `INSERT INTO spots (id, name, latitude, longitude, ideal_directions, source_url, igetwind_id)
     VALUES (@id, @name, @latitude, @longitude, '[]', NULL, NULL)`
  ).run(spot);
  return getSpotById(db, spot.id);
}

/** @param {import('better-sqlite3').Database} db @param {string[]} ids */
function getSpotsByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM spots WHERE id IN (${placeholders}) ORDER BY name`)
    .all(...ids)
    .map(parseSpot);
}

function parseSpot(row) {
  return {
    ...row,
    ideal_directions: JSON.parse(row.ideal_directions),
  };
}

/** @param {import('better-sqlite3').Database} db */
function getTravelTimeCache(db, key) {
  return db
    .prepare(
      `SELECT * FROM travel_time_cache
       WHERE origin_lat = ? AND origin_lng = ? AND dest_lat = ? AND dest_lng = ?
         AND departure_bucket = ?`
    )
    .get(key.origin_lat, key.origin_lng, key.dest_lat, key.dest_lng, key.departure_bucket);
}

/** @param {import('better-sqlite3').Database} db */
function upsertTravelTimeCache(db, row) {
  db.prepare(
    `INSERT INTO travel_time_cache (
       origin_lat, origin_lng, dest_lat, dest_lng, departure_bucket,
       duration_seconds, distance_m, route_summary, fetched_at, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(origin_lat, origin_lng, dest_lat, dest_lng, departure_bucket) DO UPDATE SET
       duration_seconds = excluded.duration_seconds,
       distance_m = excluded.distance_m,
       route_summary = excluded.route_summary,
       fetched_at = excluded.fetched_at,
       source = excluded.source`
  ).run(
    row.origin_lat,
    row.origin_lng,
    row.dest_lat,
    row.dest_lng,
    row.departure_bucket,
    row.duration_seconds,
    row.distance_m ?? null,
    row.route_summary ?? null,
    row.fetched_at,
    row.source
  );
}

module.exports = {
  initDb,
  getPreferences,
  getFullPreferences,
  getGlobalPreferences,
  getSportProfiles,
  getSportProfile,
  updatePreferences,
  updateGlobalPreferences,
  updateSportProfile,
  getAllSpots,
  getSpotById,
  getSpotsByIds,
  insertManualSpot,
  getObservationCache,
  setObservationCache,
  getWatchedSessions,
  getWatchedSessionById,
  insertWatchedSession,
  deleteWatchedSession,
  updateWatchedSessionStatus,
  purgeExpiredWatchedSessions,
  todayIsoDate,
  getTravelTimeCache,
  upsertTravelTimeCache,
  DB_PATH,
};
